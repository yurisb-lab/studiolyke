// Seleção (estilo Photoshop) na malha COMPLETA, triângulo por triângulo.
//
// A seleção é um Uint8Array com um byte por triângulo:
//   0          fora
//   255        o triângulo inteiro
//   1 … 18     só os pedaços da pintura fina na cor (filamento) F  — borda da pintura
//   101 … 118  o triângulo todo MENOS os pedaços na cor F           (100 + F)
// Assim a varinha por cor guarda o contorno exato do desenho do Bambu (para a
// incrustação da etapa 1.7) sem copiar nada da malha.
//
// "Cor" de um lugar = o filamento que sai ali: a cor da pintura, ou, onde não há
// pintura, o filamento da parte.
//
// Tudo cresce por vizinhança na superfície (triângulos que dividem uma aresta);
// nunca atravessa o modelo. "Só faces visíveis" usa a profundidade da tela.

import { todasAsPartes, filamentoDaParte } from './projeto.js';
import { corSimples, parteEspelhada } from './pintura.js';
import { analisar, pedacos, ESTADO_MAXIMO } from '../io/pintura-bambu.js';
import { ArrayCrescente } from './malha.js';

export const INTEIRO = 255;
export const MENOS = 100;

// ---------------------------------------------------------------------------
// contexto: vizinhança e partes (montado uma vez por modelo)

/**
 * Vizinho de cada aresta: viz[t*3+k] = triângulo do outro lado da aresta
 * (v[k], v[k+1]) de t, ou -1 (borda aberta). Arestas com 3+ triângulos ligam
 * ao primeiro que achar.
 */
export function vizinhanca(malha) {
  const idx = malha.indices;
  const nTri = idx.length / 3;
  const nV = malha.posicoes.length / 3;
  // triângulos de cada vértice (CSR)
  const inicio = new Uint32Array(nV + 1);
  for (let i = 0; i < idx.length; i++) inicio[idx[i] + 1]++;
  for (let v = 0; v < nV; v++) inicio[v + 1] += inicio[v];
  const pos = inicio.slice(0, nV);
  const lista = new Uint32Array(idx.length);
  for (let t = 0; t < nTri; t++) {
    lista[pos[idx[t * 3]]++] = t;
    lista[pos[idx[t * 3 + 1]]++] = t;
    lista[pos[idx[t * 3 + 2]]++] = t;
  }
  const viz = new Int32Array(nTri * 3).fill(-1);
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      if (viz[t * 3 + k] !== -1) continue;
      const a = idx[t * 3 + k], b = idx[t * 3 + (k + 1) % 3];
      for (let j = inicio[a], fim = inicio[a + 1]; j < fim; j++) {
        const u = lista[j];
        if (u === t) continue;
        // u tem a aresta (a, b)? acha qual
        let ku = -1;
        for (let q = 0; q < 3; q++) {
          const x = idx[u * 3 + q], y = idx[u * 3 + (q + 1) % 3];
          if ((x === b && y === a) || (x === a && y === b)) { ku = q; break; }
        }
        if (ku < 0) continue;
        viz[t * 3 + k] = u;
        if (viz[u * 3 + ku] === -1) viz[u * 3 + ku] = t;
        break;
      }
    }
  }
  return viz;
}

/** Índice (em todasAsPartes) da parte de cada triângulo. */
export function partePorTriangulo(malha) {
  const nTri = malha.indices.length / 3;
  const partes = todasAsPartes(malha);
  const de = partes.length < 65535 ? new Uint16Array(nTri) : new Uint32Array(nTri);
  partes.forEach(({ parte }, k) => de.fill(k, parte.primeiroTriangulo, parte.primeiroTriangulo + parte.numTriangulos));
  return de;
}

/**
 * Lado de fora de cada parte: +1 normal, -1 se a parte está "do avesso" (volume
 * negativo, comum em STL ruim). Usado no teste de "virado para a câmera".
 */
export function sinalDasPartes(malha) {
  const p = malha.posicoes, idx = malha.indices;
  return todasAsPartes(malha).map(({ parte }) => {
    let vol = 0;
    const fim = parte.primeiroTriangulo + parte.numTriangulos;
    for (let t = parte.primeiroTriangulo; t < fim; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
        - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
        + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return vol < 0 ? -1 : 1;
  });
}

/** Tudo o que a seleção precisa saber do modelo (montado uma vez, ~13 MB para 1 milhão de triângulos). */
export function criarContexto(malha) {
  return {
    viz: vizinhanca(malha),
    parteDe: partePorTriangulo(malha),
    sinal: sinalDasPartes(malha),
    nTri: malha.indices.length / 3,
  };
}

/** Filamento de cada parte (muda quando o usuário troca o filamento: é refeito a cada uso). */
function filamentosDasPartes(malha) {
  return todasAsPartes(malha).map(({ parte, objeto }) => filamentoDaParte(parte, objeto));
}

// ---------------------------------------------------------------------------
// geometria

function normal(p, idx, t, saida) {
  const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  saida[0] = nx / l; saida[1] = ny / l; saida[2] = nz / l;
  return saida;
}

function centro(p, idx, t, saida) {
  const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
  saida[0] = (p[a] + p[b] + p[c]) / 3;
  saida[1] = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
  saida[2] = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
  return saida;
}

export function areaTriangulo(p, idx, t) {
  const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/**
 * Raio contra a malha completa (todos os triângulos; ~50 ms para 1 milhão).
 * origem e direcao em mm, no espaço do modelo. Devolve { triangulo, distancia, ponto } ou null.
 */
export function raioNaMalha(malha, origem, direcao) {
  const p = malha.posicoes, idx = malha.indices;
  const [ox, oy, oz] = origem, [dx, dy, dz] = direcao;
  let melhor = Infinity, achou = -1;
  const n = idx.length / 3;
  for (let t = 0; t < n; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-12 && det < 1e-12) continue;
    const inv = 1 / det;
    const tx = ox - p[a], ty = oy - p[a + 1], tz = oz - p[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (d > 1e-9 && d < melhor) { melhor = d; achou = t; }
  }
  if (achou < 0) return null;
  return { triangulo: achou, distancia: melhor, ponto: [ox + dx * melhor, oy + dy * melhor, oz + dz * melhor] };
}

// ---------------------------------------------------------------------------
// cor

/** Vértices do triângulo na ordem do arquivo (a árvore da pintura depende dela). */
function verticesNaOrdem(malha, t, espelhada) {
  const p = malha.posicoes, idx = malha.indices;
  const a = idx[t * 3] * 3, b = idx[t * 3 + (espelhada ? 2 : 1)] * 3, c = idx[t * 3 + (espelhada ? 1 : 2)] * 3;
  return [[p[a], p[a + 1], p[a + 2]], [p[b], p[b + 1], p[b + 2]], [p[c], p[c + 1], p[c + 2]]];
}

/** Filamento que sai num ponto do triângulo t (pintura fina incluída). */
export function corNoPonto(malha, ctx, t, ponto) {
  const partes = todasAsPartes(malha);
  const k = ctx.parteDe[t];
  const { parte, objeto } = partes[k];
  const fil = filamentoDaParte(parte, objeto);
  const cor = malha.pinturaCor;
  if (!cor) return fil;
  const e = corSimples(cor, t);
  if (e > 0) return e;
  if (e !== -1) return fil;
  // pintura fina: o pedaço mais perto do ponto
  const [A, B, C] = verticesNaOrdem(malha, t, parteEspelhada(objeto, parte));
  let melhor = Infinity, estado = 0;
  pedacos(cor.codigos, cor.inicio[t], cor.inicio[t + 1], A, B, C, (es, x0, y0, z0, x1, y1, z1, x2, y2, z2) => {
    const d = distanciaPontoTriangulo(ponto, x0, y0, z0, x1, y1, z1, x2, y2, z2);
    if (d < melhor) { melhor = d; estado = es; }
  });
  return estado > 0 ? estado : fil;
}

/** Distância (ao quadrado) de um ponto a um triângulo, pelo método das regiões de Voronoi. */
function distanciaPontoTriangulo(pt, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = pt[0] - ax, apy = pt[1] - ay, apz = pt[2] - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const q = (x, y, z) => { const dx = pt[0] - x, dy = pt[1] - y, dz = pt[2] - z; return dx * dx + dy * dy + dz * dz; };
  if (d1 <= 0 && d2 <= 0) return q(ax, ay, az);
  const bpx = pt[0] - bx, bpy = pt[1] - by, bpz = pt[2] - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return q(bx, by, bz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return q(ax + v * abx, ay + v * aby, az + v * abz); }
  const cpx = pt[0] - cx, cpy = pt[1] - cy, cpz = pt[2] - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return q(cx, cy, cz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return q(ax + w * acx, ay + w * acy, az + w * acz); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return q(bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz));
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  return q(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
}

/**
 * Quanto do triângulo t é da cor F: 0 = nada, INTEIRO = tudo, F = só uma parte
 * (pintura fina com outras cores).
 */
function quantoDaCor(cor, t, fil, F) {
  if (!cor) return fil === F ? INTEIRO : 0;
  const e = corSimples(cor, t);
  if (e > 0) return e === F ? INTEIRO : 0;
  if (e !== -1) return fil === F ? INTEIRO : 0;
  const a = analisar(cor.codigos, cor.inicio[t], cor.inicio[t + 1]);
  if (!a.valido) return fil === F ? INTEIRO : 0;
  let tem = false, outra = false;
  for (let s = 0; s <= ESTADO_MAXIMO; s++) {
    if (!(a.areas[s] > 0)) continue;
    const efetiva = s > 0 ? s : fil;
    if (efetiva === F) tem = true; else outra = true;
  }
  if (!tem) return 0;
  return outra ? F : INTEIRO;
}

/** Fração da área do triângulo que está selecionada (para a área em cm²). */
function fracaoSelecionada(cor, t, fil, v) {
  if (v === INTEIRO) return 1;
  const F = v > MENOS ? v - MENOS : v;
  let fr = 0;
  if (cor && corSimples(cor, t) === -1) {
    const a = analisar(cor.codigos, cor.inicio[t], cor.inicio[t + 1]);
    if (a.valido) for (let s = 0; s <= ESTADO_MAXIMO; s++) if (a.areas[s] > 0 && (s > 0 ? s : fil) === F) fr += a.areas[s];
  } else fr = quantoDaCor(cor, t, fil, F) ? 1 : 0;
  return v > MENOS ? 1 - fr : fr;
}

// ---------------------------------------------------------------------------
// visibilidade

/**
 * Triângulos que aparecem na tela (não escondidos atrás de outros nem virados de costas).
 * vista = {
 *   matriz:      Float64Array(16), modelo -> recorte (coluna a coluna, como o three.js)
 *   largura, altura: tamanho do mapa de profundidade (pixels)
 *   profundidade: Float32Array(largura*altura), distância da câmera (mm) da superfície em cada
 *                 pixel (linha 0 = embaixo); Infinity = fundo
 *   olho:        [x, y, z] da câmera no espaço do modelo
 *   fatorPixel:  tamanho de um pixel em mm a 1 mm de distância
 *   tolerancia:  folga mínima em mm (erro da malha leve da tela)
 * }
 * Devolve Uint8Array(nTri): 1 = visível.
 */
export function visiveis(malha, ctx, vista) {
  const p = malha.posicoes, idx = malha.indices;
  const n = idx.length / 3;
  const { matriz: m, largura: W, altura: H, profundidade: prof, olho, fatorPixel, tolerancia } = vista;
  const vis = new Uint8Array(n);
  const N = [0, 0, 0];
  // projeta (x,y,z): devolve 0 = atrás da câmera, 1 = fora da tela, 2 = passou, 3 = escondido
  const testar = (x, y, z) => {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 1e-6) return 0;
    const px = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * W;
    const py = ((m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5 + 0.5) * H;
    if (px < 0 || py < 0 || px >= W || py >= H) return 1;
    const ix = px | 0, iy = py | 0;
    // a superfície mais longe na vizinhança 3×3 (mais tolerante nas bordas e quinas)
    let maxD = 0;
    for (let yy = Math.max(0, iy - 1); yy <= Math.min(H - 1, iy + 1); yy++) {
      for (let xx = Math.max(0, ix - 1); xx <= Math.min(W - 1, ix + 1); xx++) {
        const d = prof[yy * W + xx];
        if (d > maxD) maxD = d;
      }
    }
    const tol = Math.max(tolerancia, w * fatorPixel * 2);
    return w <= maxD + tol ? 2 : 3;
  };
  for (let t = 0; t < n; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    normal(p, idx, t, N);
    const virado = (N[0] * (olho[0] - cx) + N[1] * (olho[1] - cy) + N[2] * (olho[2] - cz)) * ctx.sinal[ctx.parteDe[t]];
    if (!(virado > 0)) continue;
    let r = testar(cx, cy, cz);
    if (r === 3) {
      // triângulo grande meio escondido: tenta os cantos (puxados um pouco para dentro)
      for (const v of [a, b, c]) {
        const x = p[v] * 0.8 + cx * 0.2, y = p[v + 1] * 0.8 + cy * 0.2, z = p[v + 2] * 0.8 + cz * 0.2;
        if (testar(x, y, z) === 2) { r = 2; break; }
      }
    }
    if (r === 1 || r === 2) vis[t] = 1; // fora da tela conta como visível se está virado para a câmera
  }
  return vis;
}

// ---------------------------------------------------------------------------
// varinha

/**
 * Varinha mágica a partir do triângulo "semente".
 * opcoes = {
 *   modo: 'cor' | 'angulo' | 'casca',
 *   cor:      filamento procurado (modo 'cor'; veja corNoPonto)
 *   contiguo: só a região ligada à semente (modo 'cor'; padrão true)
 *   angulo:   graus (modo 'angulo'; padrão 30): para numa quina mais forte que isso
 *   visivel:  Uint8Array de visiveis() ou null (casca ignora)
 * }
 * Devolve a seleção nova (Uint8Array).
 */
export function varinha(malha, ctx, semente, opcoes) {
  const { modo = 'cor', contiguo = true, angulo = 30 } = opcoes;
  const visivel = modo === 'casca' ? null : opcoes.visivel || null;
  const n = ctx.nTri;
  const sel = new Uint8Array(n);
  const p = malha.posicoes, idx = malha.indices, viz = ctx.viz;
  const fils = filamentosDasPartes(malha);
  const cor = malha.pinturaCor;
  const F = opcoes.cor;
  const valor = (t) => quantoDaCor(cor, t, fils[ctx.parteDe[t]], F);

  if (modo === 'cor' && !contiguo) {
    for (let t = 0; t < n; t++) {
      if (visivel && !visivel[t] && t !== semente) continue;
      const v = valor(t);
      if (v) sel[t] = v;
    }
    return sel;
  }

  const fila = new Uint32Array(n);
  let ini = 0, fim = 0;
  const visto = new Uint8Array(n);
  const cosLimite = Math.cos((Math.min(180, Math.max(0, angulo)) * Math.PI) / 180);
  const N1 = [0, 0, 0], N2 = [0, 0, 0];
  const v0 = modo === 'cor' ? valor(semente) || INTEIRO : INTEIRO;
  sel[semente] = v0;
  visto[semente] = 1;
  fila[fim++] = semente;
  while (ini < fim) {
    const t = fila[ini++];
    if (modo === 'angulo') normal(p, idx, t, N1);
    for (let k = 0; k < 3; k++) {
      const u = viz[t * 3 + k];
      if (u < 0 || visto[u]) continue;
      if (visivel && !visivel[u]) continue;
      if (modo === 'cor') {
        const v = valor(u);
        if (!v) continue;
        visto[u] = 1;
        sel[u] = v;
      } else if (modo === 'angulo') {
        normal(p, idx, u, N2);
        if (N1[0] * N2[0] + N1[1] * N2[1] + N1[2] * N2[2] < cosLimite) continue;
        visto[u] = 1;
        sel[u] = INTEIRO;
      } else {
        visto[u] = 1;
        sel[u] = INTEIRO;
      }
      fila[fim++] = u;
    }
  }
  return sel;
}

// ---------------------------------------------------------------------------
// laço

/**
 * Laço: triângulos cujo centro, na tela, cai dentro do polígono.
 * poligono: [[x, y], …] em pixels do mesmo tamanho de vista.largura/altura, com y para CIMA
 * (linha 0 embaixo, como o mapa de profundidade). visivel: Uint8Array ou null.
 */
export function laco(malha, poligono, vista, visivel = null) {
  const p = malha.posicoes, idx = malha.indices;
  const n = idx.length / 3;
  const sel = new Uint8Array(n);
  if (poligono.length < 3) return sel;
  const m = vista.matriz, W = vista.largura, H = vista.altura;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const xs = new Float64Array(poligono.length), ys = new Float64Array(poligono.length);
  poligono.forEach(([x, y], i) => {
    xs[i] = x; ys[i] = y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  });
  const np = poligono.length;
  for (let t = 0; t < n; t++) {
    if (visivel && !visivel[t]) continue;
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    const w = m[3] * cx + m[7] * cy + m[11] * cz + m[15];
    if (w <= 1e-6) continue;
    const px = ((m[0] * cx + m[4] * cy + m[8] * cz + m[12]) / w * 0.5 + 0.5) * W;
    const py = ((m[1] * cx + m[5] * cy + m[9] * cz + m[13]) / w * 0.5 + 0.5) * H;
    if (px < x0 || px > x1 || py < y0 || py > y1) continue;
    let dentro = false;
    for (let i = 0, j = np - 1; i < np; j = i++) {
      if ((ys[i] > py) !== (ys[j] > py) && px < ((xs[j] - xs[i]) * (py - ys[i])) / (ys[j] - ys[i]) + xs[i]) dentro = !dentro;
    }
    if (dentro) sel[t] = INTEIRO;
  }
  return sel;
}

// ---------------------------------------------------------------------------
// combinar e ajustar

function somarValor(a, b) {
  if (!a) return b;
  if (!b || a === b) return a;
  if (a === INTEIRO || b === INTEIRO) return INTEIRO;
  // só F + todo menos F = tudo; outras misturas de pedaços: o triângulo inteiro (aproximação)
  return INTEIRO;
}

function tirarValor(a, b) {
  if (!a || !b) return a;
  if (b === INTEIRO) return 0;
  if (b < MENOS) {
    // tira só os pedaços da cor b
    if (a === INTEIRO) return MENOS + b;
    if (a === b) return 0;
    return a; // outra cor, ou "todo menos" alguma cor: fica (aproximação)
  }
  const F = b - MENOS; // tira tudo menos a cor F: sobra só a cor F do que havia
  if (a === INTEIRO) return F;
  if (a === F) return F;
  if (a < MENOS) return 0;
  return a - MENOS === F ? 0 : F;
}

/** 'nova' troca, 'somar' junta, 'tirar' tira a nova da atual. Devolve um array novo. */
export function combinar(atual, nova, modo = 'nova') {
  if (modo === 'nova' || !atual) return modo === 'tirar' ? new Uint8Array(nova.length) : nova.slice();
  const r = new Uint8Array(atual.length);
  const f = modo === 'somar' ? somarValor : tirarValor;
  for (let t = 0; t < r.length; t++) r[t] = f(atual[t], nova[t]);
  return r;
}

export function inverter(sel) {
  const r = new Uint8Array(sel.length);
  for (let t = 0; t < sel.length; t++) {
    const v = sel[t];
    r[t] = v === 0 ? INTEIRO : v === INTEIRO ? 0 : v > MENOS ? v - MENOS : MENOS + v;
  }
  return r;
}

export function tudo(nTri) {
  return new Uint8Array(nTri).fill(INTEIRO);
}

/**
 * Cresce a seleção pela superfície: o anel de vizinhos e mais "mm" de distância (pelos centros).
 * Pedaços de pintura viram o triângulo inteiro. visivel: Uint8Array ou null.
 */
export function crescer(malha, ctx, sel, mm, visivel = null) {
  const p = malha.posicoes, idx = malha.indices, viz = ctx.viz;
  const n = sel.length;
  const r = new Uint8Array(n);
  const dist = new Float32Array(n).fill(Infinity);
  const fila = [];
  const pode = (u) => !sel[u] && (!visivel || visivel[u]);
  for (let t = 0; t < n; t++) {
    if (!sel[t]) continue;
    r[t] = INTEIRO;
    // o anel de vizinhos que encosta na seleção entra sempre (malhas de triângulos grandes também crescem)
    for (let k = 0; k < 3; k++) {
      const u = viz[t * 3 + k];
      if (u >= 0 && pode(u) && dist[u] !== 0) { dist[u] = 0; r[u] = INTEIRO; fila.push(u); }
    }
  }
  propagar(p, idx, viz, fila, dist, mm, pode, (u) => { r[u] = INTEIRO; });
  return r;
}

/** Encolhe a seleção: tira o que está a até "mm" da borda dela. */
export function encolher(malha, ctx, sel, mm) {
  const p = malha.posicoes, idx = malha.indices, viz = ctx.viz;
  const n = sel.length;
  const r = sel.slice();
  const dist = new Float32Array(n).fill(Infinity);
  const fila = [];
  for (let t = 0; t < n; t++) {
    if (!sel[t]) continue;
    if (sel[t] !== INTEIRO) { r[t] = 0; dist[t] = 0; fila.push(t); continue; }
    for (let k = 0; k < 3; k++) {
      const u = viz[t * 3 + k];
      if (u >= 0 && !sel[u]) { r[t] = 0; dist[t] = 0; fila.push(t); break; }
    }
  }
  propagar(p, idx, viz, fila, dist, mm, (u) => sel[u] !== 0, (u) => { r[u] = 0; });
  return r;
}

function propagar(p, idx, viz, fila, dist, mm, pode, marcar) {
  const C1 = [0, 0, 0], C2 = [0, 0, 0];
  for (let i = 0; i < fila.length; i++) {
    const t = fila[i];
    centro(p, idx, t, C1);
    for (let k = 0; k < 3; k++) {
      const u = viz[t * 3 + k];
      if (u < 0 || !pode(u)) continue;
      centro(p, idx, u, C2);
      const d = dist[t] + Math.hypot(C1[0] - C2[0], C1[1] - C2[1], C1[2] - C2[2]);
      if (d < dist[u] && d <= mm) {
        dist[u] = d;
        marcar(u);
        fila.push(u);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// resumo e formato compacto

/** { triangulos, inteiros, pedacos, area (mm²) } */
export function resumir(malha, ctx, sel) {
  if (!sel) return { triangulos: 0, inteiros: 0, pedacos: 0, area: 0 };
  const p = malha.posicoes, idx = malha.indices;
  const fils = filamentosDasPartes(malha);
  const cor = malha.pinturaCor;
  let triangulos = 0, inteiros = 0, area = 0;
  for (let t = 0; t < sel.length; t++) {
    const v = sel[t];
    if (!v) continue;
    triangulos++;
    if (v === INTEIRO) { inteiros++; area += areaTriangulo(p, idx, t); } else area += areaTriangulo(p, idx, t) * fracaoSelecionada(cor, t, fils[ctx.parteDe[t]], v);
  }
  return { triangulos, inteiros, pedacos: triangulos - inteiros, area };
}

export function vazia(sel) {
  if (!sel) return true;
  for (let t = 0; t < sel.length; t++) if (sel[t]) return false;
  return true;
}

/**
 * Formato compacto para o histórico e o projeto: trechos [início, tamanho, valor]
 * (seleções da varinha costumam ser trechos seguidos), ou o array bruto se ficar menor.
 */
export function compactar(sel) {
  if (!sel || vazia(sel)) return null;
  const n = sel.length;
  const trechos = [];
  let t = 0;
  while (t < n) {
    const v = sel[t];
    if (!v) { t++; continue; }
    let f = t + 1;
    while (f < n && sel[f] === v) f++;
    trechos.push(t, f - t, v);
    if (trechos.length * 4 > n) return { n, bruto: sel.slice() };
    t = f;
  }
  return { n, trechos: Uint32Array.from(trechos) };
}

/** O contrário de compactar(). Devolve null se a seleção é de outra malha. */
export function expandir(c, nTri) {
  if (!c) return null;
  if (c.n !== nTri) return null;
  if (c.bruto) return c.bruto.slice();
  const sel = new Uint8Array(nTri);
  const tr = c.trechos;
  for (let i = 0; i < tr.length; i += 3) sel.fill(tr[i + 2], tr[i], tr[i] + tr[i + 1]);
  return sel;
}

// ---------------------------------------------------------------------------
// destaque na tela

/**
 * O que desenhar por cima da peça para mostrar a seleção, sem copiar a malha:
 *   indices:  triângulos da malha DA TELA (mesmas posições da peça) a destacar
 *   pedacos:  Float32Array (9 por triângulo) com os pedaços exatos da pintura fina
 *             selecionados (e triângulos que só existem na malha da pintura fina)
 * tela = estado.tela (null = a tela usa a própria malha). Com a malha leve, o destaque
 * é aproximado pelos vértices (tela.origem diz de qual vértice da malha completa cada
 * vértice da tela veio).
 */
export function destaque(malha, ctx, sel, tela) {
  const idx = malha.indices, p = malha.posicoes;
  const n = sel.length;
  const cor = malha.pinturaCor;
  const partes = todasAsPartes(malha);
  const fils = filamentosDasPartes(malha);
  const pedacosLista = new ArrayCrescente(Float32Array, 9 * 256);
  const empurrar = (q) => pedacosLista.push1(q);
  const mesmaMalha = !tela || !tela.posicoes;
  // triângulos com pintura fina: pedaços exatos (a malha da tela não tem esses triângulos inteiros)
  const fino = (t) => cor && cor.inicio[t + 1] - cor.inicio[t] > 1 && corSimples(cor, t) === -1;
  const juntarPedacos = (t, v) => {
    const k = ctx.parteDe[t];
    const { parte, objeto } = partes[k];
    const fil = fils[k];
    const [A, B, C] = verticesNaOrdem(malha, t, parteEspelhada(objeto, parte));
    const F = v > MENOS ? v - MENOS : v;
    pedacos(cor.codigos, cor.inicio[t], cor.inicio[t + 1], A, B, C, (es, ...xyz) => {
      const efetiva = es > 0 ? es : fil;
      const entra = v === INTEIRO || (v < MENOS ? efetiva === F : efetiva !== F);
      if (entra) for (const q of xyz) empurrar(q);
    });
  };
  let indices;
  if (mesmaMalha) {
    // a tela usa os vértices da malha completa: destaque exato
    let k = 0;
    for (let t = 0; t < n; t++) if (sel[t] === INTEIRO && !(tela && fino(t))) k++;
    indices = new Uint32Array(k * 3);
    k = 0;
    for (let t = 0; t < n; t++) {
      const v = sel[t];
      if (!v) continue;
      if (v === INTEIRO && !(tela && fino(t))) {
        indices[k++] = idx[t * 3]; indices[k++] = idx[t * 3 + 1]; indices[k++] = idx[t * 3 + 2];
      } else if (cor && fino(t)) juntarPedacos(t, v);
      else if (v !== INTEIRO) {
        // "só a cor F" num triângulo de uma cor só não acontece; por garantia, o triângulo todo
        for (const q of [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]) pedacosLista.push3(p[q * 3], p[q * 3 + 1], p[q * 3 + 2]);
      }
    }
  } else {
    // malha leve: vértices marcados -> triângulos da tela com 2 ou 3 vértices marcados
    const marcado = new Uint8Array(p.length / 3);
    for (let t = 0; t < n; t++) {
      const v = sel[t];
      if (!v) continue;
      if (v === INTEIRO && !fino(t)) {
        marcado[idx[t * 3]] = 1; marcado[idx[t * 3 + 1]] = 1; marcado[idx[t * 3 + 2]] = 1;
      } else if (cor && fino(t)) juntarPedacos(t, v);
    }
    const ti = tela.indices, origem = tela.origem;
    const lista = new ArrayCrescente(Uint32Array, 3 * 1024);
    for (let i = 0; i < ti.length; i += 3) {
      const m = marcado[origem[ti[i]]] + marcado[origem[ti[i + 1]]] + marcado[origem[ti[i + 2]]];
      if (m >= 2) lista.push3(ti[i], ti[i + 1], ti[i + 2]);
    }
    indices = lista.final();
  }
  return { indices, pedacos: pedacosLista.final() };
}
