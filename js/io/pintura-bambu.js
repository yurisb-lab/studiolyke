// Pintura do Bambu Studio (atributo paint_color de cada triângulo do 3MF).
//
// Escrito do zero a partir do formato do arquivo (nada copiado do Bambu Studio
// nem do PrusaSlicer, que são AGPL).
//
// Como o formato funciona:
//   - Cada triângulo pintado guarda uma "árvore de subdivisão" escrita em
//     hexadecimal. O texto é lido DE TRÁS PARA FRENTE: o último caractere é o
//     primeiro "nibble" (grupo de 4 bits).
//   - Cada nó da árvore é um nibble:
//       bits 0-1 = quantos lados foram divididos (0 = folha, 1, 2 ou 3)
//       bits 2-3 = numa divisão: o "lado especial" (0, 1 ou 2)
//                  numa folha:   a cor (0, 1 ou 2); 3 = a cor vem no próximo
//                                nibble, somada a 3 (cores 3 a 18)
//   - Cor 0 = sem pintura (usa o filamento da parte); cor n = filamento n.
//   - Um nó dividido tem 2, 3 ou 4 filhos (lados + 1). Os filhos vêm logo
//     depois dele, do ÚLTIMO para o primeiro.
//   - Como os filhos são montados (vértices girados para o lado especial ficar
//     em r0; m = ponto do meio da aresta):
//       1 lado:  [r0, r1, m12] [m12, r2, r0]
//       2 lados: [r0, m01, m20] [m01, r1, m20] [r1, r2, m20]
//       3 lados: [r0, m01, m20] [m01, r1, m12] [m12, r2, m20] [m01, m12, m20]
//
// No app a pintura fica como uma lista de nibbles (um por byte, já na ordem de
// leitura) + o início de cada triângulo nela. Nada de objetos por triângulo.

export const ESTADO_MAXIMO = 18; // maior cor que o formato guarda
export const PROFUNDIDADE_MAXIMA = 40;

// Fração da área de cada filho, por número de lados divididos.
const FRACOES = [null, [0.5, 0.5], [0.25, 0.25, 0.5], [0.25, 0.25, 0.25, 0.25]];

const HEX = Uint8Array.from('0123456789ABCDEF', (c) => c.charCodeAt(0));

/** Valor de um caractere hexadecimal (código ASCII), ou -1. */
export function valorHex(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}

/** O texto (bytes ASCII) é todo hexadecimal? */
export function hexValido(bytes, ini, fim) {
  if (fim <= ini) return false;
  for (let i = ini; i < fim; i++) if (valorHex(bytes[i]) < 0) return false;
  return true;
}

/** Texto hexadecimal (bytes) -> nibbles na ordem de leitura, escritos em destino a partir de pos. */
export function hexParaNibbles(bytes, ini, fim, destino, pos) {
  for (let i = fim - 1; i >= ini; i--) destino[pos++] = valorHex(bytes[i]);
  return pos;
}

/** Nibbles (ordem de leitura) -> texto hexadecimal em bytes ASCII. */
export function nibblesParaHex(nib, ini, fim, destino = new Uint8Array(fim - ini)) {
  let p = 0;
  for (let i = fim - 1; i >= ini; i--) destino[p++] = HEX[nib[i] & 15];
  return destino;
}

/** Texto -> nibbles (para testes e para o gerador de modelos). */
export function textoParaNibbles(texto) {
  const b = Uint8Array.from(texto, (c) => c.charCodeAt(0));
  if (!hexValido(b, 0, b.length)) throw new Error(`Código de pintura inválido: "${texto}"`);
  const n = new Uint8Array(b.length);
  hexParaNibbles(b, 0, b.length, n, 0);
  return n;
}

/** Nibbles -> texto (para testes e para o gerador). */
export function nibblesParaTexto(nib, ini = 0, fim = nib.length) {
  return String.fromCharCode(...nibblesParaHex(nib, ini, fim));
}

/**
 * Percorre a árvore de um triângulo sem montar geometria.
 * aoFolha(estado, fracaoDaArea) é chamado para cada pedaço.
 * Devolve o índice logo depois da árvore, ou -1 se o código estiver quebrado.
 */
export function percorrer(nib, i, fim, aoFolha, fracao = 1, prof = 0) {
  if (i >= fim || prof > PROFUNDIDADE_MAXIMA) return -1;
  const c = nib[i++];
  const lados = c & 3;
  if (lados === 0) {
    let estado = c >> 2;
    if (estado === 3) {
      if (i >= fim) return -1;
      estado = nib[i++] + 3;
    }
    if (aoFolha) aoFolha(estado, fracao);
    return i;
  }
  if ((c >> 2) > 2) return -1; // lado especial só vai de 0 a 2
  const fr = FRACOES[lados];
  for (let k = lados; k >= 0; k--) {
    i = percorrer(nib, i, fim, aoFolha, fracao * fr[k], prof + 1);
    if (i < 0) return -1;
  }
  return i;
}

/**
 * Confere um código inteiro: válido, quantos pedaços tem, cor única (ou -1 se tem
 * mais de uma) e a cor com mais área.
 */
export function analisar(nib, ini, fim) {
  const areas = new Float64Array(ESTADO_MAXIMO + 1);
  let pedacos = 0;
  const f = percorrer(nib, ini, fim, (e, fr) => { areas[e] += fr; pedacos++; });
  if (f !== fim) return { valido: false, pedacos: 0, unico: -1, dominante: 0, areas: null };
  let dominante = 0, unico = -1, usados = 0;
  for (let e = 0; e <= ESTADO_MAXIMO; e++) {
    if (areas[e] > 0) { usados++; unico = e; }
    if (areas[e] > areas[dominante]) dominante = e;
  }
  return { valido: true, pedacos, unico: usados === 1 ? unico : -1, dominante, areas };
}

/**
 * Monta os pedaços reais do triângulo (a, b, c = [x, y, z] na ordem do arquivo).
 * aoPedaco(estado, ax, ay, az, bx, by, bz, cx, cy, cz) para cada folha.
 * Devolve o índice depois da árvore, ou -1 se o código estiver quebrado.
 */
export function pedacos(nib, ini, fim, a, b, c, aoPedaco) {
  return montar(nib, ini, fim, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], aoPedaco, 0);
}

function montar(nib, i, fim, x0, y0, z0, x1, y1, z1, x2, y2, z2, aoPedaco, prof) {
  if (i >= fim || prof > PROFUNDIDADE_MAXIMA) return -1;
  const c = nib[i++];
  const lados = c & 3;
  if (lados === 0) {
    let estado = c >> 2;
    if (estado === 3) {
      if (i >= fim) return -1;
      estado = nib[i++] + 3;
    }
    aoPedaco(estado, x0, y0, z0, x1, y1, z1, x2, y2, z2);
    return i;
  }
  const esp = c >> 2;
  if (esp > 2) return -1;
  // gira os vértices: o lado especial vira r0
  let ax, ay, az, bx, by, bz, cx, cy, cz;
  if (esp === 0) { ax = x0; ay = y0; az = z0; bx = x1; by = y1; bz = z1; cx = x2; cy = y2; cz = z2; }
  else if (esp === 1) { ax = x1; ay = y1; az = z1; bx = x2; by = y2; bz = z2; cx = x0; cy = y0; cz = z0; }
  else { ax = x2; ay = y2; az = z2; bx = x0; by = y0; bz = z0; cx = x1; cy = y1; cz = z1; }
  const p = prof + 1;
  // filhos do último para o primeiro (é a ordem em que aparecem no código)
  if (lados === 1) {
    const mx = (bx + cx) / 2, my = (by + cy) / 2, mz = (bz + cz) / 2;
    i = montar(nib, i, fim, mx, my, mz, cx, cy, cz, ax, ay, az, aoPedaco, p); if (i < 0) return -1;
    return montar(nib, i, fim, ax, ay, az, bx, by, bz, mx, my, mz, aoPedaco, p);
  }
  const m01x = (ax + bx) / 2, m01y = (ay + by) / 2, m01z = (az + bz) / 2;
  const m20x = (cx + ax) / 2, m20y = (cy + ay) / 2, m20z = (cz + az) / 2;
  if (lados === 2) {
    i = montar(nib, i, fim, bx, by, bz, cx, cy, cz, m20x, m20y, m20z, aoPedaco, p); if (i < 0) return -1;
    i = montar(nib, i, fim, m01x, m01y, m01z, bx, by, bz, m20x, m20y, m20z, aoPedaco, p); if (i < 0) return -1;
    return montar(nib, i, fim, ax, ay, az, m01x, m01y, m01z, m20x, m20y, m20z, aoPedaco, p);
  }
  const m12x = (bx + cx) / 2, m12y = (by + cy) / 2, m12z = (bz + cz) / 2;
  i = montar(nib, i, fim, m01x, m01y, m01z, m12x, m12y, m12z, m20x, m20y, m20z, aoPedaco, p); if (i < 0) return -1;
  i = montar(nib, i, fim, m12x, m12y, m12z, cx, cy, cz, m20x, m20y, m20z, aoPedaco, p); if (i < 0) return -1;
  i = montar(nib, i, fim, m01x, m01y, m01z, bx, by, bz, m12x, m12y, m12z, aoPedaco, p); if (i < 0) return -1;
  return montar(nib, i, fim, ax, ay, az, m01x, m01y, m01z, m20x, m20y, m20z, aoPedaco, p);
}

/** Nibbles de uma folha com a cor e. */
export function folha(e) {
  if (!(e >= 0 && e <= ESTADO_MAXIMO)) throw new Error(`A pintura do Bambu só guarda cores de 0 a ${ESTADO_MAXIMO}.`);
  return e < 3 ? [e << 2] : [12, e - 3];
}

/**
 * Troca as cores de um código (mapa[estadoAntigo] = estadoNovo) e junta os
 * pedaços que ficaram todos da mesma cor (como o Bambu faz ao pintar).
 * Devolve os nibbles novos (array; vazio = triângulo sem pintura) ou null se o
 * código estiver quebrado.
 */
export function trocarCores(nib, ini, fim, mapa) {
  const pos = { i: ini };
  const r = reescrever(nib, pos, fim, mapa, 0);
  if (r == null || pos.i !== fim) return null;
  if (typeof r === 'number') return r === 0 ? [] : folha(r);
  return r;
}

// Devolve um número (folha daquela cor) ou um array de nibbles (nó dividido).
function reescrever(nib, pos, fim, mapa, prof) {
  if (pos.i >= fim || prof > PROFUNDIDADE_MAXIMA) return null;
  const c = nib[pos.i++];
  const lados = c & 3;
  if (lados === 0) {
    let e = c >> 2;
    if (e === 3) {
      if (pos.i >= fim) return null;
      e = nib[pos.i++] + 3;
    }
    const novo = mapa[e];
    return novo == null ? e : novo;
  }
  if ((c >> 2) > 2) return null;
  const filhos = [];
  for (let k = 0; k <= lados; k++) {
    const f = reescrever(nib, pos, fim, mapa, prof + 1);
    if (f == null) return null;
    filhos.push(f);
  }
  if (filhos.every((f) => typeof f === 'number' && f === filhos[0])) return filhos[0];
  const saida = [c];
  for (const f of filhos) {
    if (typeof f === 'number') saida.push(...folha(f));
    else for (const v of f) saida.push(v);
  }
  return saida;
}

/**
 * Cria o código de um triângulo pintando por região: corDe(x, y, z) diz a cor em
 * cada ponto. Divide em 4 (3 lados) até a profundidade pedida onde a cor muda.
 * Até "minima" divide sempre (para não pular detalhes menores que o triângulo);
 * pedaços que ficam da mesma cor são juntados de volta.
 * Serve para o gerador de modelos de teste e, mais tarde, para o pincel.
 * Devolve os nibbles (array; vazio = sem pintura).
 */
export function pintarPorRegiao(a, b, c, corDe, profundidade, minima = 0) {
  const r = regiao(a, b, c, corDe, profundidade, minima);
  if (typeof r === 'number') return r === 0 ? [] : folha(r);
  return r;
}

function regiao(a, b, c, corDe, prof, minima) {
  const meio = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  const centro = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  const ec = corDe(...centro);
  if (prof <= 0) return ec;
  const m01 = meio(a, b), m12 = meio(b, c), m20 = meio(c, a);
  const amostras = [a, b, c, m01, m12, m20, meio(a, centro), meio(b, centro), meio(c, centro)];
  if (minima <= 0 && amostras.every((p) => corDe(...p) === ec)) return ec;
  // filhos de uma divisão em 3 lados, lado especial 0 (r0 = a)
  const filhos = [
    regiao(a, m01, m20, corDe, prof - 1, minima - 1),
    regiao(m01, b, m12, corDe, prof - 1, minima - 1),
    regiao(m12, c, m20, corDe, prof - 1, minima - 1),
    regiao(m01, m12, m20, corDe, prof - 1, minima - 1),
  ];
  if (filhos.every((f) => typeof f === 'number' && f === filhos[0])) return filhos[0];
  const saida = [3];
  for (let k = 3; k >= 0; k--) {
    const f = filhos[k];
    if (typeof f === 'number') saida.push(...folha(f));
    else saida.push(...f);
  }
  return saida;
}
