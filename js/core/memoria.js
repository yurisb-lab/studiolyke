// Controle de memória: estimativa antes de abrir e números para o medidor.

import { listarZip } from '../io/zip-indice.js';

export const MB = 1048576;

// Bytes por triângulo durante a leitura (pico) e depois (malha guardada).
// Medidos nos leitores: STL binário ~50 B/tri do arquivo + ~70 B/tri de trabalho.
const PICO_POR_TRI = { stl: 75, obj: 70, '3mf': 96 };
// 12 (índices) + vértices (~metade do nº de triângulos): 6 B em precisão simples,
// 12 B no 3MF (precisão dupla, para a exportação voltar idêntica).
const FINAL_POR_TRI = { stl: 18, obj: 18, '3mf': 24 };

export function extensao(nome) {
  const m = /\.([a-z0-9]+)$/i.exec(nome || '');
  return m ? m[1].toLowerCase() : '';
}

export const FORMATOS = ['stl', 'obj', '3mf'];

/**
 * Estima triângulos e memória de um arquivo antes de abrir.
 * @returns {Promise<{triangulos:number, picoMB:number, finalMB:number, exato:boolean}>}
 */
export async function estimarAbertura(arquivo) {
  const ext = extensao(arquivo.name);
  let triangulos = 0;
  let bytesTexto = arquivo.size;
  let exato = false;
  if (ext === 'stl') {
    const cab = new Uint8Array(await arquivo.slice(0, 84).arrayBuffer());
    const n = cab.length >= 84 ? new DataView(cab.buffer).getUint32(80, true) : 0;
    if (84 + n * 50 === arquivo.size) { triangulos = n; exato = true; } else triangulos = Math.round(arquivo.size / 250);
  } else if (ext === 'obj') {
    triangulos = Math.round(arquivo.size / 40);
  } else if (ext === '3mf') {
    try {
      const lista = await listarZip(arquivo);
      bytesTexto = lista.filter((e) => /\.model$/i.test(e.nome)).reduce((s, e) => s + e.tamanho, 0);
    } catch {
      bytesTexto = arquivo.size * 6;
    }
    triangulos = Math.round(bytesTexto / 85);
  }
  const extra = ext === '3mf' ? bytesTexto : 0; // o XML descompactado fica na memória enquanto lê
  const picoMB = (arquivo.size + extra + triangulos * (PICO_POR_TRI[ext] || 80)) / MB;
  const finalMB = (triangulos * (FINAL_POR_TRI[ext] || 18)) / MB;
  return { triangulos, picoMB: Math.ceil(picoMB), finalMB: Math.ceil(finalMB), exato };
}

/** Uso atual de memória. heap só existe no Chrome (performance.memory). */
export function usoAtual(bytesModelo = 0, bytesTela = 0) {
  const pm = typeof performance !== 'undefined' ? performance.memory : null;
  return {
    heapMB: pm ? pm.usedJSHeapSize / MB : null,
    limiteHeapMB: pm ? pm.jsHeapSizeLimit / MB : null,
    modeloMB: bytesModelo / MB,
    telaMB: bytesTela / MB,
  };
}

/** Texto curto, ex.: "312 MB" ou "1,2 GB". */
export function formatarMB(mb) {
  if (mb == null || !Number.isFinite(mb)) return '—';
  if (mb >= 1024) return `${(mb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

export function formatarNumero(n) {
  return Math.round(n).toLocaleString('pt-BR');
}

/** "1,2 milhão", "350 mil" */
export function formatarTriangulos(n) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${n >= 2e6 ? 'milhões' : 'milhão'}`;
  if (n >= 1e4) return `${Math.round(n / 1000).toLocaleString('pt-BR')} mil`;
  return formatarNumero(n);
}
