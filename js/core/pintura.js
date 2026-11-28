// Pintura de cor do Bambu na malha: resumo por parte, troca de cor e a malha da tela
// separada por cor (com os pedaços reais dos triângulos subdivididos).
//
// A pintura fica em malha.pinturaCor = { codigos, inicio, resumo } (ver projeto.js).
// Cor (estado) 0 = sem pintura (usa o filamento da parte); n = filamento n.

import { IDENTIDADE, todasAsPartes, faixasDasPartes } from './projeto.js';
import { ArrayCrescente, compactar } from './malha.js';
import { malhaDaTela, simplificarTrecho, semTriangulosFinos, emFloat32 } from './simplificar.js';
import { multiplicar, determinante } from '../io/3mf.js';
import { ESTADO_MAXIMO, analisar, pedacos, trocarCores, percorrer } from '../io/pintura-bambu.js';

// Parte da tela reservada para os pedaços da pintura fina (o resto fica para a malha).
const FRACAO_DETALHE = 0.5;

/** A parte está espelhada na placa? (a leitura inverteu a ordem dos vértices dela) */
export function parteEspelhada(objeto, parte) {
  return determinante(multiplicar(parte.matriz || IDENTIDADE, objeto.matriz || IDENTIDADE)) < 0;
}

/**
 * Cor de um triângulo sem montar nada: a cor, se ele é de uma cor só;
 * -1 = tem várias cores (subdividido); -2 = código quebrado; 0 = sem pintura.
 */
export function corSimples(cor, t) {
  const i0 = cor.inicio[t], i1 = cor.inicio[t + 1];
  const n = i1 - i0;
  if (n === 0) return 0;
  const c = cor.codigos[i0];
  if (n === 1) return (c & 3) === 0 && c !== 12 ? c >> 2 : -2;
  if (n === 2 && c === 12) return cor.codigos[i0 + 1] + 3;
  const a = analisar(cor.codigos, i0, i1);
  return a.valido ? a.unico : -2;
}

function areaTriangulo(p, a, b, c) {
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
}

/**
 * Resumo da pintura: área de cada cor em cada parte (mm²), cores usadas, contagens.
 * Guardado em malha.pinturaCor.resumo.
 */
export function resumirPintura(malha) {
  const cor = malha.pinturaCor;
  if (!cor) return null;
  const p = malha.posicoes, idx = malha.indices;
  const partes = [];
  let pintados = 0, subdivididos = 0, quebrados = 0, maiorEstado = 0;
  const usados = new Set();
  for (const { parte } of todasAsPartes(malha)) {
    const areas = new Array(ESTADO_MAXIMO + 1).fill(0);
    let tem = false;
    const fim = parte.primeiroTriangulo + parte.numTriangulos;
    for (let t = parte.primeiroTriangulo; t < fim; t++) {
      const i0 = cor.inicio[t], i1 = cor.inicio[t + 1];
      if (i1 === i0) continue;
      const area = areaTriangulo(p, idx[t * 3] * 3, idx[t * 3 + 1] * 3, idx[t * 3 + 2] * 3);
      const e = corSimples(cor, t);
      if (e === -2) { quebrados++; continue; }
      pintados++;
      if (e >= 0) {
        areas[e] += area;
      } else {
        subdivididos++;
        percorrer(cor.codigos, i0, i1, (es, fr) => { areas[es] += area * fr; });
      }
    }
    for (let e = 1; e <= ESTADO_MAXIMO; e++) {
      if (areas[e] > 0) { tem = true; usados.add(e); if (e > maiorEstado) maiorEstado = e; }
    }
    partes.push({ areas, pintada: tem });
  }
  return { partes, estados: [...usados].sort((a, b) => a - b), maiorEstado, pintados, subdivididos, quebrados };
}

/** Atualiza o resumo guardado (e solta a pintura se não sobrou nada pintado). */
export function atualizarResumo(malha) {
  if (!malha.pinturaCor) return null;
  const r = resumirPintura(malha);
  malha.pinturaCor.resumo = r;
  return r;
}

/**
 * Troca a cor "de" por "para" (0 = tirar a pintura dessa cor) numa parte (índice
 * em todasAsPartes) ou no modelo todo (parteIndice = null). de = 'todas' apaga
 * toda a pintura do trecho. Triângulos sem a cor "de" ficam exatamente como estavam.
 * Devolve quantos triângulos mudaram.
 */
export function trocarCorDaPintura(malha, { de, para, parteIndice = null }) {
  const cor = malha.pinturaCor;
  if (!cor) return 0;
  const apagar = de === 'todas';
  if (!apagar && !(de >= 1 && de <= ESTADO_MAXIMO)) throw new Error(`Cor ${de} não existe na pintura.`);
  if (!apagar && !(para >= 0 && para <= ESTADO_MAXIMO)) throw new Error(`A pintura do Bambu só guarda os filamentos 1 a ${ESTADO_MAXIMO}.`);
  const mapa = new Array(ESTADO_MAXIMO + 1).fill(null);
  if (apagar) mapa.fill(0);
  else mapa[de] = para;
  const nTri = cor.inicio.length - 1;
  let t0 = 0, t1 = nTri;
  if (parteIndice != null) {
    const item = todasAsPartes(malha)[parteIndice];
    if (!item) throw new Error('Parte não encontrada.');
    t0 = item.parte.primeiroTriangulo;
    t1 = t0 + item.parte.numTriangulos;
  }
  const novos = new ArrayCrescente(Uint8Array, cor.codigos.length + 64);
  const inicio = new Uint32Array(nTri + 1);
  let mudaram = 0;
  for (let t = 0; t < nTri; t++) {
    inicio[t] = novos.tamanho;
    const i0 = cor.inicio[t], i1 = cor.inicio[t + 1];
    if (i1 === i0) continue;
    let r = null;
    if (t >= t0 && t < t1) {
      const e = corSimples(cor, t);
      if (e > 0 && (apagar || e === de)) r = apagar ? [] : trocarCores(cor.codigos, i0, i1, mapa);
      else if (e === -1) {
        const a = analisar(cor.codigos, i0, i1);
        if (apagar || a.areas[de] > 0) r = trocarCores(cor.codigos, i0, i1, mapa);
      }
    }
    if (r) {
      mudaram++;
      novos.garantir(novos.tamanho + r.length);
      novos.dados.set(r, novos.tamanho);
      novos.tamanho += r.length;
    } else {
      novos.garantir(novos.tamanho + (i1 - i0));
      novos.dados.set(cor.codigos.subarray(i0, i1), novos.tamanho);
      novos.tamanho += i1 - i0;
    }
  }
  inicio[nTri] = novos.tamanho;
  if (novos.tamanho === 0) {
    malha.pinturaCor = null; // não sobrou pintura nenhuma
    malha.pinturaApagada = true;
  } else {
    malha.pinturaCor = { codigos: novos.final(), inicio, resumo: null };
    atualizarResumo(malha);
  }
  if (mudaram) malha.trianguloPintados = contarPintados(malha);
  return mudaram;
}

function contarPintados(malha) {
  const cor = malha.pinturaCor;
  if (!cor) return 0;
  let n = 0;
  for (let t = 0; t + 1 < cor.inicio.length; t++) if (cor.inicio[t + 1] > cor.inicio[t]) n++;
  return n;
}

/** Na tela já montada: as faixas da cor "de" (na parte, ou em todas) passam a ser "para". */
export function trocarCorNaTela(tela, { de, para, parteIndice = null }) {
  if (!tela) return;
  const lista = [...(tela.faixas || []), ...((tela.detalhe && tela.detalhe.faixas) || [])];
  for (const f of lista) {
    if (parteIndice != null && f.parte !== parteIndice) continue;
    if (de === 'todas' ? f.estado > 0 : f.estado === de) f.estado = de === 'todas' ? 0 : para;
  }
}

/**
 * Malha da tela. Sem pintura: a mesma de antes (simplificar.js). Com pintura:
 *   - os triângulos são agrupados por parte e por cor (cada grupo vira uma faixa
 *     { primeiroTriangulo, numTriangulos, parte, estado });
 *   - acima do limite, cada grupo é simplificado separado, com a borda travada,
 *     para o contorno da pintura não borrar nem abrir frestas;
 *   - os triângulos subdivididos (pintura fina) viram os pedaços reais na malha
 *     "detalhe", até FRACAO_DETALHE do limite; os que não couberem aparecem
 *     na cor que ocupa mais área deles.
 * Devolve null quando a tela pode usar a própria malha (sem pintura e abaixo do limite).
 * Com posicoes = null, a tela usa as posições da própria malha (sem cópia).
 */
export function prepararTela(Meshopt, malha, limite) {
  const cor = malha.pinturaCor;
  const nTri = malha.indices.length / 3;
  if (!cor || !cor.resumo || cor.resumo.pintados === 0) {
    if (nTri <= limite) return null;
    return malhaDaTela(Meshopt, malha, limite);
  }
  const partes = todasAsPartes(malha);
  const faixasPartes = faixasDasPartes(malha);

  // 1) classe de cada triângulo: a cor do grupo, ou 255 = vai em pedaços para o detalhe
  const classe = new Uint8Array(nTri);
  const orcamento = Math.floor(limite * FRACAO_DETALHE);
  let noDetalhe = 0;
  for (let t = 0; t < nTri; t++) {
    const e = corSimples(cor, t);
    if (e >= 0) { classe[t] = e; continue; }
    if (e === -2) { classe[t] = 0; continue; }
    const a = analisar(cor.codigos, cor.inicio[t], cor.inicio[t + 1]);
    if (noDetalhe + a.pedacos <= orcamento) {
      classe[t] = 255;
      noDetalhe += a.pedacos;
    } else classe[t] = a.dominante;
  }

  // 2) índices reagrupados por parte e cor
  const NC = ESTADO_MAXIMO + 1;
  const indices = new Uint32Array(nTri * 3);
  const grupos = []; // { parte, estado, ini, n } em triângulos
  let o = 0, inteiros = 0;
  const cont = new Uint32Array(NC);
  const pos = new Uint32Array(NC);
  faixasPartes.forEach((f, k) => {
    cont.fill(0);
    const fim = f.primeiroTriangulo + f.numTriangulos;
    for (let t = f.primeiroTriangulo; t < fim; t++) if (classe[t] !== 255) cont[classe[t]]++;
    for (let e = 0; e < NC; e++) {
      if (!cont[e]) continue;
      grupos.push({ parte: k, estado: e, ini: o / 3, n: cont[e] });
      pos[e] = o;
      o += cont[e] * 3;
    }
    for (let t = f.primeiroTriangulo; t < fim; t++) {
      const e = classe[t];
      if (e === 255) continue;
      const d = pos[e];
      indices[d] = malha.indices[t * 3];
      indices[d + 1] = malha.indices[t * 3 + 1];
      indices[d + 2] = malha.indices[t * 3 + 2];
      pos[e] = d + 3;
    }
  });
  inteiros = o / 3;

  // 3) simplificação por grupo, se passar do limite
  let tela;
  if (inteiros + noDetalhe <= limite) {
    tela = {
      posicoes: null,
      indices: o === indices.length ? indices : indices.slice(0, o),
      faixas: grupos.map((g) => ({ primeiroTriangulo: g.ini, numTriangulos: g.n, parte: g.parte, estado: g.estado })),
    };
  } else {
    const proporcao = Math.max(0.02, (limite - noDetalhe) / Math.max(1, inteiros));
    let todas32 = null;
    const pos32 = () => todas32 || (todas32 = emFloat32(malha.posicoes));
    const pintadas = new Set();
    for (const g of grupos) if (g.estado > 0) pintadas.add(g.parte);
    for (let t = 0; t < nTri; t++) if (classe[t] === 255) pintadas.add(parteDoTriangulo(faixasPartes, t));
    const resultados = [];
    let total = 0;
    for (const g of grupos) {
      const sub = indices.subarray(g.ini * 3, (g.ini + g.n) * 3);
      const alvo = Math.max(12, Math.round(g.n * proporcao));
      const r = simplificarTrecho(Meshopt, malha, partes[g.parte].parte, sub, alvo, { travarBorda: pintadas.has(g.parte) }, pos32);
      resultados.push(r);
      total += r.length;
    }
    const juntos = new Uint32Array(total);
    const faixas = [];
    let q = 0;
    grupos.forEach((g, k) => {
      juntos.set(resultados[k], q);
      faixas.push({ primeiroTriangulo: q / 3, numTriangulos: resultados[k].length / 3, parte: g.parte, estado: g.estado });
      q += resultados[k].length;
    });
    const limpos = semTriangulosFinos(malha.posicoes, juntos, faixas);
    tela = { ...compactar(malha.posicoes, limpos), faixas };
  }

  // 4) pedaços reais da pintura fina
  tela.detalhe = noDetalhe ? montarDetalhe(malha, classe, faixasPartes, partes, noDetalhe) : null;
  tela.comPintura = true;
  return tela;
}

function parteDoTriangulo(faixas, t) {
  for (let k = 0; k < faixas.length; k++) {
    const f = faixas[k];
    if (t >= f.primeiroTriangulo && t < f.primeiroTriangulo + f.numTriangulos) return k;
  }
  return 0;
}

/** Os pedaços de cada triângulo subdividido, agrupados por parte e cor (9 números por pedaço). */
function montarDetalhe(malha, classe, faixasPartes, partes, total) {
  const cor = malha.pinturaCor;
  const p = malha.posicoes, idx = malha.indices;
  const posicoes = new Float32Array(total * 9);
  const faixas = [];
  const NC = ESTADO_MAXIMO + 1;
  const porCor = Array.from({ length: NC }, () => null);
  let o = 0;
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  faixasPartes.forEach((f, k) => {
    const espelhada = parteEspelhada(partes[k].objeto, partes[k].parte);
    for (let e = 0; e < NC; e++) porCor[e] = null;
    const fim = f.primeiroTriangulo + f.numTriangulos;
    for (let t = f.primeiroTriangulo; t < fim; t++) {
      if (classe[t] !== 255) continue;
      // volta à ordem de vértices do arquivo: a árvore depende dela
      const a = idx[t * 3] * 3;
      const b = idx[t * 3 + (espelhada ? 2 : 1)] * 3;
      const c = idx[t * 3 + (espelhada ? 1 : 2)] * 3;
      A[0] = p[a]; A[1] = p[a + 1]; A[2] = p[a + 2];
      B[0] = p[b]; B[1] = p[b + 1]; B[2] = p[b + 2];
      C[0] = p[c]; C[1] = p[c + 1]; C[2] = p[c + 2];
      pedacos(cor.codigos, cor.inicio[t], cor.inicio[t + 1], A, B, C, (e, x0, y0, z0, x1, y1, z1, x2, y2, z2) => {
        const lista = porCor[e] || (porCor[e] = new ArrayCrescente(Float32Array, 9 * 64));
        // na tela, a parte espelhada usa a ordem invertida (como a malha principal)
        if (espelhada) {
          lista.push3(x0, y0, z0); lista.push3(x2, y2, z2); lista.push3(x1, y1, z1);
        } else {
          lista.push3(x0, y0, z0); lista.push3(x1, y1, z1); lista.push3(x2, y2, z2);
        }
      });
    }
    for (let e = 0; e < NC; e++) {
      const lista = porCor[e];
      if (!lista) continue;
      const n = lista.tamanho / 9;
      posicoes.set(lista.dados.subarray(0, lista.tamanho), o * 9);
      faixas.push({ primeiroTriangulo: o, numTriangulos: n, parte: k, estado: e });
      o += n;
    }
  });
  return { posicoes: o * 9 === posicoes.length ? posicoes : posicoes.slice(0, o * 9), faixas };
}
