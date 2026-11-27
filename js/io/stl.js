// Leitor de STL (binário e texto) direto para a malha compacta.

import { ArrayCrescente, Soldador, criarMalha } from '../core/malha.js';
import { lerNumero, ehEspaco, comecaCom, codigos, textoDe } from './texto.js';

const VERTEX = codigos('vertex');
const SOLID = codigos('solid');
const ENDSOLID = codigos('endsolid');
const FACET = codigos('facet');

/** Diz se o arquivo é STL binário (pelo tamanho, que é o jeito confiável). */
export function ehStlBinario(bytes) {
  if (bytes.length < 84) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  if (84 + n * 50 === bytes.length) return true;
  // Começa com "solid" e tem "facet" logo no início: é texto.
  let i = 0;
  while (i < bytes.length && ehEspaco(bytes[i])) i++;
  if (comecaCom(bytes, i, SOLID)) {
    const inicio = bytes.subarray(0, Math.min(bytes.length, 2048));
    for (let k = 0; k < inicio.length - 5; k++) if (comecaCom(inicio, k, FACET)) return false;
  }
  // Binário com lixo no fim ainda é binário.
  return 84 + n * 50 <= bytes.length && n > 0;
}

/**
 * @param {ArrayBuffer|Uint8Array} entrada
 * @param {(fracao:number)=>void} [aoProgresso]
 */
export function lerStl(entrada, aoProgresso) {
  const bytes = entrada instanceof Uint8Array ? entrada : new Uint8Array(entrada);
  return ehStlBinario(bytes) ? lerBinario(bytes, aoProgresso) : lerTexto(bytes, aoProgresso);
}

function lerBinario(bytes, aoProgresso) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = dv.getUint32(80, true);
  const avisos = [];
  if (84 + total * 50 !== bytes.length) avisos.push('O arquivo STL tem bytes sobrando no fim; foram ignorados.');
  const soldador = new Soldador(Math.ceil(total * 0.6) + 16);
  const indices = new ArrayCrescente(Uint32Array, total * 3);
  let degenerados = 0, invalidos = 0;
  const passo = Math.max(1, Math.floor(total / 50));
  for (let t = 0; t < total; t++) {
    const o = 84 + t * 50 + 12; // pula a normal
    const x0 = dv.getFloat32(o, true), y0 = dv.getFloat32(o + 4, true), z0 = dv.getFloat32(o + 8, true);
    const x1 = dv.getFloat32(o + 12, true), y1 = dv.getFloat32(o + 16, true), z1 = dv.getFloat32(o + 20, true);
    const x2 = dv.getFloat32(o + 24, true), y2 = dv.getFloat32(o + 28, true), z2 = dv.getFloat32(o + 32, true);
    if (!(Number.isFinite(x0 + y0 + z0 + x1 + y1 + z1 + x2 + y2 + z2))) { invalidos++; continue; }
    const a = soldador.indice(x0, y0, z0);
    const b = soldador.indice(x1, y1, z1);
    const c = soldador.indice(x2, y2, z2);
    if (a === b || b === c || a === c) { degenerados++; continue; }
    indices.push3(a, b, c);
    if (aoProgresso && t % passo === 0) aoProgresso(t / total);
  }
  if (degenerados) avisos.push(`${degenerados} triângulo(s) sem área foram removidos.`);
  if (invalidos) avisos.push(`${invalidos} triângulo(s) com números inválidos foram ignorados.`);
  const posicoes = soldador.final();
  const idx = indices.final();
  return criarMalha({ posicoes, indices: idx, avisos });
}

function lerTexto(bytes, aoProgresso) {
  const n = bytes.length;
  const soldador = new Soldador(Math.ceil(n / 500) + 16);
  const indices = new ArrayCrescente(Uint32Array, Math.ceil(n / 80));
  const objetos = [];
  const fim = { i: 0 };
  const avisos = [];
  let atual = null;
  const v = [0, 0, 0];
  let nv = 0;
  let degenerados = 0;
  const tri = [0, 0, 0];
  const passo = Math.max(1, Math.floor(n / 50));
  let proximo = passo;
  let i = 0;

  const fecharObjeto = () => {
    if (atual) {
      atual.numTriangulos = indices.tamanho / 3 - atual.primeiroTriangulo;
      if (atual.numTriangulos > 0) objetos.push(atual);
      atual = null;
    }
  };

  while (i < n) {
    const c = bytes[i];
    if (ehEspaco(c)) { i++; continue; }
    const inicioPalavra = i === 0 || ehEspaco(bytes[i - 1]);
    if (inicioPalavra && c === 118 /* v */ && comecaCom(bytes, i, VERTEX)) {
      i += 6;
      for (let k = 0; k < 3; k++) {
        while (i < n && (bytes[i] === 32 || bytes[i] === 9)) i++;
        v[k] = lerNumero(bytes, i, fim);
        i = fim.i;
      }
      tri[nv++] = soldador.indice(v[0], v[1], v[2]);
      if (nv === 3) {
        nv = 0;
        if (!atual) atual = { nome: 'Peça', primeiroTriangulo: indices.tamanho / 3, numTriangulos: 0 };
        if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) degenerados++;
        else indices.push3(tri[0], tri[1], tri[2]);
      }
    } else if (inicioPalavra && c === 101 /* e */ && comecaCom(bytes, i, ENDSOLID)) {
      fecharObjeto();
      i += 8;
    } else if (inicioPalavra && c === 115 /* s */ && comecaCom(bytes, i, SOLID)) {
      fecharObjeto();
      i += 5;
      let j = i;
      while (j < n && bytes[j] !== 10 && bytes[j] !== 13) j++;
      const nome = textoDe(bytes, i, j).trim();
      atual = { nome: nome || 'Peça', primeiroTriangulo: indices.tamanho / 3, numTriangulos: 0 };
      i = j;
    } else {
      // pula a palavra
      while (i < n && !ehEspaco(bytes[i])) i++;
    }
    if (aoProgresso && i >= proximo) {
      aoProgresso(i / n);
      proximo += passo;
    }
  }
  fecharObjeto();
  if (degenerados) avisos.push(`${degenerados} triângulo(s) sem área foram removidos.`);
  const posicoes = soldador.final();
  return criarMalha({ posicoes, indices: indices.final(), objetos, avisos });
}
