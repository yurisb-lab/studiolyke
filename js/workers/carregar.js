// Worker de carregamento: lê o arquivo, monta a malha compacta e gera a malha leve da tela.
// Roda fora da tela para a página não travar. Cada tarefa usa um worker novo, que é
// encerrado no fim: assim a memória de trabalho (inclusive a do WASM) é devolvida.

import { CDN } from '../config.js';
import { lerStl } from '../io/stl.js';
import { lerObj } from '../io/obj.js';
import { ler3mf } from '../io/3mf.js';
import { caixaDaMalha, transferiveis } from '../core/malha.js';
import { malhaDaTela, simplificarMalha } from '../core/simplificar.js';

let meshopt = null;
async function obterMeshopt() {
  if (!meshopt) {
    const m = await import(CDN.meshoptSimplificador);
    meshopt = m.MeshoptSimplifier;
    await meshopt.ready;
  }
  return meshopt;
}

let jszip = null;
async function obterJSZip() {
  if (!jszip) {
    // O JSZip só existe em formato UMD; carregado assim ele se registra em self.JSZip.
    await import(CDN.jszip);
    jszip = self.JSZip;
    if (!jszip) throw new Error('Não consegui carregar o leitor de ZIP (JSZip).');
  }
  return jszip;
}

const avisar = (id, fase, fracao) => postMessage({ id, tipo: 'progresso', fase, fracao });

async function abrir(id, { arquivo, limiteTela, simplificarPara }) {
  const nome = arquivo.name || 'modelo';
  const ext = (/\.([a-z0-9]+)$/i.exec(nome) || [])[1]?.toLowerCase();
  avisar(id, 'Lendo o arquivo…', 0);
  let malha;
  if (ext === '3mf') {
    const JSZip = await obterJSZip();
    malha = await ler3mf(arquivo, JSZip, (f) => avisar(id, 'Lendo o 3MF…', f));
  } else {
    let buffer = await arquivo.arrayBuffer();
    if (ext === 'stl') malha = lerStl(buffer, (f) => avisar(id, 'Lendo o STL…', f));
    else if (ext === 'obj') malha = lerObj(buffer, (f) => avisar(id, 'Lendo o OBJ…', f));
    else throw new Error(`Formato .${ext || '?'} não suportado. Use STL, OBJ ou 3MF.`);
    buffer = null;
  }
  if (malha.indices.length === 0) throw new Error('O arquivo não tem nenhum triângulo.');
  const trianguloOriginal = malha.indices.length / 3;
  if (simplificarPara && trianguloOriginal > simplificarPara) {
    avisar(id, 'Simplificando o modelo…', 0);
    malha = simplificarMalha(await obterMeshopt(), malha, simplificarPara);
  }
  const tela = await gerarTela(id, malha, limiteTela);
  malha.nome = nome;
  malha.trianguloOriginal = trianguloOriginal;
  const caixa = caixaDaMalha(malha);
  postMessage({ id, tipo: 'pronto', malha, tela, caixa }, transferiveis(malha, tela));
}

async function gerarTela(id, malha, limiteTela) {
  if (malha.indices.length / 3 <= limiteTela) return null; // a tela usa a própria malha
  avisar(id, 'Preparando a malha leve da tela…', 0);
  return malhaDaTela(await obterMeshopt(), malha, limiteTela);
}

/** Recebe a malha emprestada (transferida), gera a tela e devolve as duas. */
async function refazerTela(id, { malha, limiteTela }) {
  const tela = await gerarTela(id, malha, limiteTela);
  postMessage({ id, tipo: 'pronto', malha, tela }, transferiveis(malha, tela));
}

self.onmessage = async (e) => {
  const { id, tipo, dados } = e.data;
  try {
    if (tipo === 'abrir') await abrir(id, dados);
    else if (tipo === 'tela') await refazerTela(id, dados);
    else throw new Error(`Tarefa desconhecida: ${tipo}`);
  } catch (erro) {
    postMessage({ id, tipo: 'erro', mensagem: erro && erro.message ? erro.message : String(erro) });
  }
};
