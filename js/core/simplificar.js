// Simplificação de malha com o meshoptimizer (MIT).
// Usada para a malha leve da tela e para "simplificar ao abrir" modelos grandes.
// O módulo do meshoptimizer é passado como parâmetro: no worker vem do CDN,
// nos testes vem do node_modules.

import { compactar, criarMalha } from './malha.js';
import { faixasDasPartes, todasAsPartes } from './projeto.js';

/**
 * Reduz os índices para perto de alvoTriangulos. Devolve índices que apontam
 * para as MESMAS posições (sem copiar as posições).
 */
export function simplificarIndices(Meshopt, posicoes, indices, alvoTriangulos, opcoes = {}) {
  const tri = indices.length / 3;
  if (tri <= alvoTriangulos) return indices;
  const alvoIdx = Math.max(3, Math.floor(alvoTriangulos) * 3);
  // Regularize: triângulos mais bem formados (sem lascas finas que viram pontos pretos na tela)
  const flags = opcoes.esparso ? ['Sparse', 'Regularize'] : ['Regularize'];
  let [res] = Meshopt.simplify(indices, posicoes, 3, alvoIdx, opcoes.erroMax ?? 0.02, flags);
  // Se a forma "boa" não chegou ao alvo, termina com a simplificação rápida.
  if (res.length > alvoIdx * 1.15) {
    [res] = Meshopt.simplifySloppy(res, posicoes, 3, null, alvoIdx, 1);
  }
  return res;
}

/**
 * Malha leve para a tela. Cada parte é simplificada separada, para a tela saber
 * onde começa e termina cada uma (e pintar cada parte na cor do seu filamento).
 * Devolve { posicoes, indices, faixas } — faixas na mesma ordem de faixasDasPartes().
 */
export function malhaDaTela(Meshopt, malha, alvoTriangulos) {
  const faixas = faixasDasPartes(malha);
  const total = malha.indices.length / 3;
  if (total <= alvoTriangulos) return { ...compactar(malha.posicoes, malha.indices), faixas };
  const { indices, faixas: novas } = simplificarPorFaixa(Meshopt, malha, faixas, alvoTriangulos / total, {});
  return { ...compactar(malha.posicoes, semTriangulosFinos(malha.posicoes, indices, novas)), faixas: novas };
}

/**
 * Simplifica cada faixa (parte) separada. Usa a faixa de vértices da parte quando
 * existe (o simplificador trabalha só com os vértices dela, bem mais rápido).
 */
function simplificarPorFaixa(Meshopt, malha, faixas, proporcao, opcoes) {
  const partes = todasAsPartes(malha);
  // O simplificador só aceita precisão simples; a cópia é feita só se precisar.
  let todas32 = null;
  const pos32 = () => todas32 || (todas32 = emFloat32(malha.posicoes));
  const resultados = [];
  let n = 0;
  faixas.forEach((f, k) => {
    const sub = malha.indices.subarray(f.primeiroTriangulo * 3, (f.primeiroTriangulo + f.numTriangulos) * 3);
    const alvo = Math.max(12, Math.round(f.numTriangulos * proporcao));
    let r;
    const p = partes[k] && partes[k].parte;
    if (sub.length / 3 <= alvo) {
      r = sub;
    } else if (p && p.numVertices > 0) {
      const v0 = p.primeiroVertice;
      const local = new Uint32Array(sub.length);
      let dentro = true;
      for (let i = 0; i < sub.length; i++) {
        const v = sub[i] - v0;
        if (v < 0 || v >= p.numVertices) { dentro = false; break; }
        local[i] = v;
      }
      if (dentro) {
        const pos = emFloat32(malha.posicoes.subarray(v0 * 3, (v0 + p.numVertices) * 3));
        r = simplificarIndices(Meshopt, pos, local, alvo, opcoes);
        if (r === local) r = sub;
        else for (let i = 0; i < r.length; i++) r[i] += v0;
      } else {
        r = simplificarIndices(Meshopt, pos32(), sub, alvo, opcoes);
      }
    } else {
      r = simplificarIndices(Meshopt, pos32(), sub, alvo, opcoes);
    }
    resultados.push(r);
    n += r.length;
  });
  const indices = new Uint32Array(n);
  const novas = [];
  let o = 0;
  for (const r of resultados) {
    indices.set(r, o);
    novas.push({ primeiroTriangulo: o / 3, numTriangulos: r.length / 3 });
    o += r.length;
  }
  return { indices, faixas: novas };
}

function emFloat32(a) {
  return a instanceof Float32Array ? a : new Float32Array(a);
}

/**
 * Tira triângulos quase sem área que a simplificação deixa. Na tela eles viram
 * pontinhos pretos (a normal calculada pela placa de vídeo sai inválida).
 */
export function semTriangulosFinos(p, idx, faixas = null) {
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; }
  const escala = Math.max(x1 - x0, 1e-3);
  const minimo = (escala * 1e-6) ** 2; // área² mínima
  const saida = new Uint32Array(idx.length);
  let n = 0;
  const lista = faixas || [{ primeiroTriangulo: 0, numTriangulos: idx.length / 3 }];
  for (const f of lista) {
    const inicio = n / 3;
    for (let t = f.primeiroTriangulo * 3, fim = (f.primeiroTriangulo + f.numTriangulos) * 3; t < fim; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * nx + ny * ny + nz * nz > minimo) {
        saida[n++] = idx[t]; saida[n++] = idx[t + 1]; saida[n++] = idx[t + 2];
      }
    }
    // as faixas acompanham os triângulos que sobraram
    f.primeiroTriangulo = inicio;
    f.numTriangulos = n / 3 - inicio;
  }
  return n === idx.length ? idx : saida.slice(0, n);
}

/**
 * Simplificação de verdade (troca a malha de trabalho). Cada parte é simplificada
 * separada, então objetos, partes, filamentos e placas continuam os mesmos.
 * A pintura do Bambu não sobrevive (os triângulos mudam) e é descartada com aviso.
 */
export function simplificarMalha(Meshopt, malha, alvoTriangulos) {
  const total = malha.indices.length / 3;
  if (total <= alvoTriangulos) return malha;
  const avisos = [...malha.avisos];
  const faixas = faixasDasPartes(malha);
  const { indices, faixas: novas } = simplificarPorFaixa(Meshopt, malha, faixas, alvoTriangulos / total, { esparso: true });
  const c = compactar(malha.posicoes, indices);
  const n = indices.length / 3;
  avisos.push(`Modelo simplificado de ${total.toLocaleString('pt-BR')} para ${n.toLocaleString('pt-BR')} triângulos.`);
  let k = 0;
  const objetos = malha.objetos.map((o) => {
    const partes = o.partes.map((p) => {
      const f = novas[k++];
      // a faixa de vértices mudou com a compactação: a exportação recalcula
      return { ...p, primeiroTriangulo: f.primeiroTriangulo, numTriangulos: f.numTriangulos, primeiroVertice: 0, numVertices: 0 };
    });
    const primeiro = partes.length ? partes[0].primeiroTriangulo : 0;
    const soma = partes.reduce((s2, p) => s2 + p.numTriangulos, 0);
    return { ...o, partes, primeiroTriangulo: primeiro, numTriangulos: soma };
  });
  if (malha.pintura) {
    avisos.push('A pintura do Bambu foi descartada ao simplificar (os triângulos mudaram). Para manter a pintura, abra o modelo completo.');
  }
  const { posicoes: _p, indices: _i, objetos: _o, avisos: _a, pintura: _t, ...extras } = malha;
  return criarMalha({ posicoes: c.posicoes, indices: c.indices, objetos, avisos, extras: { ...extras, pintura: null, trianguloPintados: 0 } });
}
