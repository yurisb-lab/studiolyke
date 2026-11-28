// Malha compacta: tudo em typed arrays, nunca objetos soltos por vértice ou triângulo.
//
// Formato de uma malha:
//   posicoes  Float32Array  [x0, y0, z0, x1, y1, z1, ...] em mm
//   indices   Uint32Array   [a0, b0, c0, a1, b1, c1, ...] (3 por triângulo)
//   objetos   [{ nome, primeiroTriangulo, numTriangulos, partes: [...] }]  faixas de triângulos
//   avisos    [texto]  coisas que o leitor corrigiu ou ignorou
//   (filamentos, placas, pintura e arquivo3mf: ver js/core/projeto.js)
//
// Regra do modo leve: existe UMA cópia da malha completa. Para mandar ao worker,
// os buffers são transferidos (não copiados) com transferiveis().

import { garantirEstrutura } from './projeto.js';

/** Array que cresce sozinho, para os leitores não saberem o tamanho de antemão. */
export class ArrayCrescente {
  constructor(Tipo, capacidade = 1024) {
    this.Tipo = Tipo;
    this.dados = new Tipo(Math.max(16, capacidade | 0));
    this.tamanho = 0;
  }

  garantir(n) {
    if (n <= this.dados.length) return;
    let c = this.dados.length;
    while (c < n) c = Math.ceil(c * 1.5);
    const novo = new this.Tipo(c);
    novo.set(this.dados.subarray(0, this.tamanho));
    this.dados = novo;
  }

  push1(a) {
    if (this.tamanho + 1 > this.dados.length) this.garantir(this.tamanho + 1);
    this.dados[this.tamanho++] = a;
  }

  push3(a, b, c) {
    const t = this.tamanho;
    if (t + 3 > this.dados.length) this.garantir(t + 3);
    const d = this.dados;
    d[t] = a;
    d[t + 1] = b;
    d[t + 2] = c;
    this.tamanho = t + 3;
  }

  /** Devolve um array do tamanho exato (só copia se sobrou espaço). */
  final() {
    if (this.tamanho === this.dados.length) return this.dados;
    const exato = this.dados.slice(0, this.tamanho);
    this.dados = new this.Tipo(16);
    this.tamanho = 0;
    return exato;
  }
}

/**
 * Junta vértices com a mesma posição (STL guarda cada triângulo separado).
 * Tabela de espalhamento em Int32Array, sem Map nem strings.
 */
export class Soldador {
  constructor(estimativaVertices = 1024) {
    this.posicoes = new ArrayCrescente(Float32Array, estimativaVertices * 3);
    this.n = 0;
    this._criarTabela(estimativaVertices * 2);
    this._f = new Float32Array(3);
    this._u = new Uint32Array(this._f.buffer);
  }

  _criarTabela(minimo) {
    let cap = 1024;
    while (cap < minimo) cap *= 2;
    this.tabela = new Int32Array(cap).fill(-1);
    this.mascara = cap - 1;
  }

  _espalhar(u0, u1, u2) {
    let h = Math.imul(u0, 73856093) ^ Math.imul(u1, 19349663) ^ Math.imul(u2, 83492791);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return h & this.mascara;
  }

  _crescer() {
    const p = this.posicoes.dados;
    const u = new Uint32Array(p.buffer, p.byteOffset, this.n * 3);
    this._criarTabela((this.tabela.length) * 2);
    const tab = this.tabela;
    const m = this.mascara;
    for (let i = 0; i < this.n; i++) {
      let h = this._espalhar(u[i * 3], u[i * 3 + 1], u[i * 3 + 2]);
      while (tab[h] !== -1) h = (h + 1) & m;
      tab[h] = i;
    }
  }

  /** Índice do vértice (x, y, z); cria se ainda não existe. */
  indice(x, y, z) {
    const f = this._f;
    // +0 junta -0 com 0
    f[0] = x + 0;
    f[1] = y + 0;
    f[2] = z + 0;
    const u = this._u;
    const tab = this.tabela;
    const m = this.mascara;
    const p = this.posicoes.dados;
    let h = this._espalhar(u[0], u[1], u[2]);
    for (;;) {
      const i = tab[h];
      if (i === -1) break;
      const k = i * 3;
      if (p[k] === f[0] && p[k + 1] === f[1] && p[k + 2] === f[2]) return i;
      h = (h + 1) & m;
    }
    const novo = this.n++;
    this.posicoes.push3(f[0], f[1], f[2]);
    tab[h] = novo;
    if (this.n * 2 > tab.length) this._crescer();
    return novo;
  }

  final() {
    this.tabela = null;
    return this.posicoes.final();
  }
}

export function criarMalha({ posicoes, indices, objetos, avisos = [], extras = {} }) {
  const numTriangulos = indices.length / 3;
  return garantirEstrutura({
    posicoes,
    indices,
    objetos: objetos && objetos.length
      ? objetos
      : [{ nome: 'Peça', primeiroTriangulo: 0, numTriangulos }],
    avisos,
    ...extras,
  });
}

export function numTriangulos(malha) {
  return malha ? malha.indices.length / 3 : 0;
}

export function numVertices(malha) {
  return malha ? malha.posicoes.length / 3 : 0;
}

export function bytesDaMalha(malha) {
  if (!malha) return 0;
  // (a tela com pintura pode usar as posições da própria malha: posicoes = null)
  let b = (malha.posicoes ? malha.posicoes.byteLength : 0) + malha.indices.byteLength;
  if (malha.pinturaOutros) b += malha.pinturaOutros.atributos.byteLength + malha.pinturaOutros.inicio.byteLength;
  if (malha.pinturaCor) b += malha.pinturaCor.codigos.byteLength + malha.pinturaCor.inicio.byteLength;
  if (malha.detalhe) b += malha.detalhe.posicoes.byteLength;
  if (malha.arquivo3mf) for (const e of malha.arquivo3mf.extras || []) b += e.bytes.byteLength;
  return b;
}

/** Caixa que envolve a malha, em mm. */
export function caixaDaMalha(malha) {
  const p = malha.posicoes;
  if (p.length === 0) return { min: [0, 0, 0], max: [0, 0, 0], tamanho: [0, 0, 0], centro: [0, 0, 0] };
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return {
    min: [x0, y0, z0],
    max: [x1, y1, z1],
    tamanho: [x1 - x0, y1 - y0, z1 - z0],
    centro: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  };
}

/** Medidas de cada objeto (para saber se cada um cabe na mesa). */
export function caixasDosObjetos(malha) {
  const p = malha.posicoes, idx = malha.indices;
  return malha.objetos.map((o) => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    const fim = (o.primeiroTriangulo + o.numTriangulos) * 3;
    for (let i = o.primeiroTriangulo * 3; i < fim; i++) {
      const v = idx[i] * 3;
      const x = p[v], y = p[v + 1], z = p[v + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    return [x1 - x0, y1 - y0, z1 - z0];
  });
}

/**
 * Buffers para postMessage(..., transfer): passam ao worker sem copiar.
 * Inclui a pintura guardada e os arquivos extras do 3MF (configurações, miniaturas).
 */
export function transferiveis(...malhas) {
  const lista = [];
  const juntar = (a) => {
    if (a && a.buffer && a.buffer.byteLength && !lista.includes(a.buffer)) lista.push(a.buffer);
  };
  for (const m of malhas) {
    if (!m) continue;
    juntar(m.posicoes);
    juntar(m.indices);
    if (m.pinturaOutros) {
      juntar(m.pinturaOutros.atributos);
      juntar(m.pinturaOutros.inicio);
    }
    if (m.pinturaCor) {
      juntar(m.pinturaCor.codigos);
      juntar(m.pinturaCor.inicio);
    }
    if (m.detalhe) juntar(m.detalhe.posicoes);
    if (m.arquivo3mf) for (const e of m.arquivo3mf.extras || []) juntar(e.bytes);
  }
  return lista;
}

/** Copia só os vértices usados pelos índices (para a malha leve da tela). */
export function compactar(posicoes, indices) {
  const nv = posicoes.length / 3;
  const mapa = new Int32Array(nv).fill(-1);
  let usados = 0;
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (mapa[v] === -1) mapa[v] = usados++;
  }
  const novasPos = new Float32Array(usados * 3);
  for (let v = 0; v < nv; v++) {
    const d = mapa[v];
    if (d !== -1) {
      novasPos[d * 3] = posicoes[v * 3];
      novasPos[d * 3 + 1] = posicoes[v * 3 + 1];
      novasPos[d * 3 + 2] = posicoes[v * 3 + 2];
    }
  }
  const novosIdx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) novosIdx[i] = mapa[indices[i]];
  return { posicoes: novasPos, indices: novosIdx };
}
