// Leitor de OBJ (só geometria) direto para a malha compacta.
// Lê "v", "f" (com a/b/c e índices negativos), "o" e "g". Polígonos viram leque de triângulos.
// OBJ não tem unidade: considera milímetros.

import { ArrayCrescente, criarMalha } from '../core/malha.js';
import { lerNumero, lerInteiro, textoDe } from './texto.js';

export function lerObj(entrada, aoProgresso) {
  const bytes = entrada instanceof Uint8Array ? entrada : new Uint8Array(entrada);
  const n = bytes.length;
  const posicoes = new ArrayCrescente(Float32Array, Math.ceil(n / 30));
  const indices = new ArrayCrescente(Uint32Array, Math.ceil(n / 15));
  const objetos = [];
  const avisos = [];
  const fim = { i: 0 };
  const poligono = [];
  let atual = null;
  let invalidos = 0, degenerados = 0;
  const passo = Math.max(1, Math.floor(n / 50));
  let proximo = passo;

  const fecharObjeto = () => {
    if (atual) {
      atual.numTriangulos = indices.tamanho / 3 - atual.primeiroTriangulo;
      if (atual.numTriangulos > 0) objetos.push(atual);
    }
    atual = null;
  };

  let i = 0;
  while (i < n) {
    // início de linha
    while (i < n && (bytes[i] === 32 || bytes[i] === 9)) i++;
    const c0 = bytes[i], c1 = bytes[i + 1];
    const separador = c1 === 32 || c1 === 9;
    if (c0 === 118 /* v */ && separador) {
      i += 2;
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 3; k++) {
        while (i < n && (bytes[i] === 32 || bytes[i] === 9)) i++;
        const val = lerNumero(bytes, i, fim);
        i = fim.i;
        if (k === 0) x = val; else if (k === 1) y = val; else z = val;
      }
      posicoes.push3(x, y, z);
    } else if (c0 === 102 /* f */ && separador) {
      i += 2;
      poligono.length = 0;
      const nv = posicoes.tamanho / 3;
      for (;;) {
        while (i < n && (bytes[i] === 32 || bytes[i] === 9)) i++;
        if (i >= n || bytes[i] === 10 || bytes[i] === 13 || bytes[i] === 35) break;
        let idx = lerInteiro(bytes, i, fim);
        i = fim.i;
        // pula "/t/n" de textura e normal
        while (i < n && bytes[i] !== 32 && bytes[i] !== 9 && bytes[i] !== 10 && bytes[i] !== 13) i++;
        if (Number.isNaN(idx)) { invalidos++; continue; }
        idx = idx < 0 ? nv + idx : idx - 1;
        poligono.push(idx);
      }
      let ok = poligono.length >= 3;
      for (const v of poligono) if (v < 0 || v >= nv) ok = false;
      if (!ok) {
        invalidos++;
      } else {
        if (!atual) atual = { nome: 'Peça', primeiroTriangulo: indices.tamanho / 3, numTriangulos: 0 };
        const a = poligono[0];
        for (let k = 1; k + 1 < poligono.length; k++) {
          const b = poligono[k], c = poligono[k + 1];
          if (a === b || b === c || a === c) degenerados++;
          else indices.push3(a, b, c);
        }
      }
    } else if ((c0 === 111 /* o */ || c0 === 103 /* g */) && separador) {
      i += 2;
      let j = i;
      while (j < n && bytes[j] !== 10 && bytes[j] !== 13) j++;
      const nome = textoDe(bytes, i, j).trim();
      // "g" repetido com o mesmo nome não abre objeto novo
      if (!atual || atual.nome !== nome) {
        fecharObjeto();
        atual = { nome: nome || 'Peça', primeiroTriangulo: indices.tamanho / 3, numTriangulos: 0 };
      }
      i = j;
    }
    // vai para a próxima linha
    while (i < n && bytes[i] !== 10) i++;
    i++;
    if (aoProgresso && i >= proximo) {
      aoProgresso(Math.min(1, i / n));
      proximo += passo;
    }
  }
  fecharObjeto();
  if (invalidos) avisos.push(`${invalidos} face(s) com índices inválidos foram ignoradas.`);
  if (degenerados) avisos.push(`${degenerados} triângulo(s) sem área foram removidos.`);
  return criarMalha({ posicoes: posicoes.final(), indices: indices.final(), objetos, avisos });
}
