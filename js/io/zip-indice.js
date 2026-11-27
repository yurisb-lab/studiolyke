// Lê só o índice (diretório central) de um arquivo ZIP, sem abrir o resto.
// Serve para estimar a memória de um 3MF antes de abrir: o índice diz o
// tamanho descompactado de cada arquivo lá dentro.

/**
 * @param {Blob} arquivo
 * @returns {Promise<Array<{nome:string, tamanho:number, comprimido:number}>>}
 */
export async function listarZip(arquivo) {
  const tamanho = arquivo.size;
  const fimLeitura = Math.min(tamanho, 65557);
  const cauda = new Uint8Array(await arquivo.slice(tamanho - fimLeitura).arrayBuffer());
  const dvC = new DataView(cauda.buffer);
  let eocd = -1;
  for (let i = cauda.length - 22; i >= 0; i--) {
    if (dvC.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Não parece um arquivo ZIP/3MF válido.');
  const total = dvC.getUint16(eocd + 10, true);
  const tamDir = dvC.getUint32(eocd + 12, true);
  const iniDir = dvC.getUint32(eocd + 16, true);
  const dir = new Uint8Array(await arquivo.slice(iniDir, iniDir + tamDir).arrayBuffer());
  const dv = new DataView(dir.buffer);
  const lista = [];
  const dec = new TextDecoder();
  let p = 0;
  for (let k = 0; k < total && p + 46 <= dir.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const comprimido = dv.getUint32(p + 20, true);
    const tam = dv.getUint32(p + 24, true);
    const nNome = dv.getUint16(p + 28, true);
    const nExtra = dv.getUint16(p + 30, true);
    const nCom = dv.getUint16(p + 32, true);
    const nome = dec.decode(dir.subarray(p + 46, p + 46 + nNome));
    lista.push({ nome, tamanho: tam, comprimido });
    p += 46 + nNome + nExtra + nCom;
  }
  return lista;
}
