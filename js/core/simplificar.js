// Simplificação de malha com o meshoptimizer (MIT).
// Usada para a malha leve da tela e para "simplificar ao abrir" modelos grandes.
// O módulo do meshoptimizer é passado como parâmetro: no worker vem do CDN,
// nos testes vem do node_modules.

import { compactar, criarMalha } from './malha.js';

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

/** Malha leve para a tela: só os vértices usados, sem guardar faixas de objeto. */
export function malhaDaTela(Meshopt, malha, alvoTriangulos) {
  const idx = simplificarIndices(Meshopt, malha.posicoes, malha.indices, alvoTriangulos);
  return compactar(malha.posicoes, idx === malha.indices ? idx : semTriangulosFinos(malha.posicoes, idx));
}

/**
 * Tira triângulos quase sem área que a simplificação deixa. Na tela eles viram
 * pontinhos pretos (a normal calculada pela placa de vídeo sai inválida).
 */
export function semTriangulosFinos(p, idx) {
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; }
  const escala = Math.max(x1 - x0, 1e-3);
  const minimo = (escala * 1e-6) ** 2; // área² mínima
  const saida = new Uint32Array(idx.length);
  let n = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz > minimo) {
      saida[n++] = idx[t]; saida[n++] = idx[t + 1]; saida[n++] = idx[t + 2];
    }
  }
  return n === idx.length ? idx : saida.slice(0, n);
}

/**
 * Simplificação de verdade (troca a malha de trabalho). Mantém os objetos
 * separados quando são poucos.
 */
export function simplificarMalha(Meshopt, malha, alvoTriangulos) {
  const total = malha.indices.length / 3;
  if (total <= alvoTriangulos) return malha;
  const proporcao = alvoTriangulos / total;
  const avisos = [...malha.avisos];
  let partes;
  let objetos;
  if (malha.objetos.length <= 16) {
    partes = [];
    objetos = [];
    let inicio = 0;
    for (const o of malha.objetos) {
      const sub = malha.indices.subarray(o.primeiroTriangulo * 3, (o.primeiroTriangulo + o.numTriangulos) * 3);
      const alvo = Math.max(12, Math.round(o.numTriangulos * proporcao));
      const r = simplificarIndices(Meshopt, malha.posicoes, sub, alvo, { esparso: true });
      partes.push(r);
      objetos.push({ ...o, primeiroTriangulo: inicio, numTriangulos: r.length / 3 });
      inicio += r.length / 3;
    }
  } else {
    partes = [simplificarIndices(Meshopt, malha.posicoes, malha.indices, alvoTriangulos)];
    objetos = [{ nome: 'Peça', primeiroTriangulo: 0, numTriangulos: partes[0].length / 3 }];
    avisos.push('Os objetos foram juntados numa peça só ao simplificar (eram muitos).');
  }
  let n = 0;
  for (const p of partes) n += p.length;
  const todos = new Uint32Array(n);
  let o = 0;
  for (const p of partes) { todos.set(p, o); o += p.length; }
  const c = compactar(malha.posicoes, todos);
  avisos.push(`Modelo simplificado de ${total.toLocaleString('pt-BR')} para ${(n / 3).toLocaleString('pt-BR')} triângulos.`);
  const { posicoes: _p, indices: _i, objetos: _o, avisos: _a, ...extras } = malha;
  return criarMalha({ posicoes: c.posicoes, indices: c.indices, objetos, avisos, extras });
}
