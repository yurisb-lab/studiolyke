// Arquivo de projeto ".lyke" (para levar do PC para o celular ou guardar de backup).
// É um ZIP com:
//   projeto.json          receitas do histórico, seleções salvas, vista… (ver js/core/projetos.js)
//   modelo/<nome>         o arquivo original (STL, OBJ ou 3MF), guardado sem recomprimir
// Os typed arrays (seleções) viram { $tipo, b64 } dentro do JSON.

import { GravadorZip } from '../io/zip-gravar.js';

export const FORMATO_PROJETO = 'fatiador-lyke-projeto';
export const VERSAO_FORMATO = 1;

const TIPOS = { Uint8Array, Uint16Array, Uint32Array, Int32Array, Float32Array, Float64Array };

function paraBase64(bytes) {
  let s = '';
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) s += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
  return btoa(s);
}

function deBase64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

/** Objeto com typed arrays -> objeto que cabe em JSON. */
export function paraJson(valor) {
  if (ArrayBuffer.isView(valor)) {
    const nome = valor.constructor.name;
    if (!TIPOS[nome]) throw new Error(`Tipo ${nome} não pode ir para o projeto.`);
    return { $tipo: nome, b64: paraBase64(new Uint8Array(valor.buffer, valor.byteOffset, valor.byteLength)) };
  }
  if (Array.isArray(valor)) return valor.map(paraJson);
  if (valor && typeof valor === 'object') {
    const saida = {};
    for (const [k, v] of Object.entries(valor)) if (v !== undefined) saida[k] = paraJson(v);
    return saida;
  }
  return valor;
}

/** O contrário de paraJson(). */
export function deJson(valor) {
  if (Array.isArray(valor)) return valor.map(deJson);
  if (valor && typeof valor === 'object') {
    if (typeof valor.$tipo === 'string' && typeof valor.b64 === 'string' && TIPOS[valor.$tipo]) {
      const bytes = deBase64(valor.b64);
      const T = TIPOS[valor.$tipo];
      return new T(bytes.buffer, 0, bytes.byteLength / T.BYTES_PER_ELEMENT);
    }
    const saida = {};
    for (const [k, v] of Object.entries(valor)) saida[k] = deJson(v);
    return saida;
  }
  return valor;
}

async function* pedacosDoBlob(blob) {
  const leitor = blob.stream().getReader();
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) return;
    yield value;
  }
}

/**
 * Monta o .lyke. registro = o projeto (js/core/projetos.js), modelo = Blob/File do original.
 * @returns {Promise<Blob>}
 */
export async function gravarPacote(registro, modelo) {
  const zip = new GravadorZip();
  const nomeModelo = (registro.base && registro.base.nome) || modelo.name || 'modelo';
  const json = { formato: FORMATO_PROJETO, versaoFormato: VERSAO_FORMATO, ...paraJson(registro) };
  delete json.base?.chaveArquivo; // a chave só vale no navegador de origem
  await zip.adicionar('projeto.json', JSON.stringify(json, null, 1));
  await zip.adicionar(`modelo/${nomeModelo.replace(/[\\/]/g, '_')}`, pedacosDoBlob(modelo), { comprimir: !/\.3mf$/i.test(nomeModelo) });
  return new Blob(zip.finalizar(), { type: 'application/zip' });
}

/**
 * Lê um .lyke. JSZip é injetado (worker e testes).
 * @returns {Promise<{projeto:object, modelo:File}>}
 */
export async function lerPacote(arquivo, JSZip) {
  let zip;
  try {
    zip = await JSZip.loadAsync(arquivo);
  } catch {
    throw new Error('Este arquivo .lyke está danificado (não é um ZIP).');
  }
  const pj = zip.file('projeto.json');
  if (!pj) throw new Error('Este arquivo .lyke não tem o projeto dentro.');
  let projeto;
  try {
    projeto = deJson(JSON.parse(await pj.async('string')));
  } catch {
    throw new Error('O projeto dentro do .lyke está danificado.');
  }
  if (projeto.formato !== FORMATO_PROJETO) throw new Error('Este .lyke não é um projeto do Fatiador.');
  if (projeto.versaoFormato > VERSAO_FORMATO) throw new Error('Este projeto foi salvo numa versão mais nova do app. Atualize a página.');
  const entrada = zip.file(/^modelo\/[^/]+$/)[0];
  if (!entrada) throw new Error('O modelo original não está dentro do .lyke.');
  const nome = entrada.name.slice('modelo/'.length);
  const bytes = await entrada.async('uint8array');
  const modelo = new File([bytes], nome);
  if (!Array.isArray(projeto.passos)) projeto.passos = [];
  projeto.posicao = Math.max(0, Math.min(projeto.passos.length, projeto.posicao | 0));
  return { projeto, modelo };
}
