// Worker de processamento: lê o arquivo (ou o projeto .lyke), aplica as receitas do
// histórico, monta a malha compacta, gera a malha leve da tela e grava o 3MF. Roda fora da tela para a página não travar. Cada tarefa usa um worker novo, que é
// encerrado no fim: assim a memória de trabalho (inclusive a do WASM) é devolvida.

import { CDN } from '../config.js';
import { lerStl } from '../io/stl.js';
import { lerObj } from '../io/obj.js';
import { ler3mf } from '../io/3mf.js';
import { gravar3mf } from '../io/3mf-gravar.js';
import { garantirEstrutura } from '../core/projeto.js';
import { caixaDaMalha, caixasDosObjetos, transferiveis } from '../core/malha.js';
import { simplificarMalha } from '../core/simplificar.js';
import { prepararTela, atualizarResumo } from '../core/pintura.js';
import { aplicarReceitas, transferiveisDasVoltas } from '../ops/index.js';
import { lerPacote } from '../core/pacote.js';
import * as armazenamento from '../core/armazenamento.js';

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

/**
 * Abre um arquivo (STL, OBJ, 3MF ou projeto .lyke) e, se vierem receitas, aplica
 * em ordem (é assim que o histórico volta no tempo e que um projeto reabre).
 *   ponto: chave de um ponto de restauração (modelo já pronto, no IndexedDB)
 *   guardarVolta: as receitas devolvem a volta (para o desfazer rápido continuar valendo)
 */
async function abrir(id, { arquivo, limiteTela, simplificarPara, receitas = null, ponto = null, guardarVolta = false }) {
  let nome = arquivo ? arquivo.name || 'modelo' : 'modelo';
  let ext = (/\.([a-z0-9]+)$/i.exec(nome) || [])[1]?.toLowerCase();
  let projeto = null;
  let modeloDoPacote = null;
  if (ext === 'lyke') {
    avisar(id, 'Lendo o projeto…', 0);
    const pacote = await lerPacote(arquivo, await obterJSZip());
    projeto = pacote.projeto;
    modeloDoPacote = pacote.modelo;
    arquivo = pacote.modelo;
    nome = arquivo.name;
    ext = (/\.([a-z0-9]+)$/i.exec(nome) || [])[1]?.toLowerCase();
    simplificarPara = projeto.base && projeto.base.simplificarPara ? projeto.base.simplificarPara : simplificarPara;
    receitas = projeto.passos.slice(0, projeto.posicao).map((p) => ({ tipo: p.tipo, params: p.params }));
    guardarVolta = true;
  }

  let malha = null;
  let trianguloOriginal = 0;
  if (ponto) {
    avisar(id, 'Lendo o ponto de restauração…', 0);
    malha = await armazenamento.ler('pontos-restauracao', ponto, null);
    if (!malha) throw new Error('O ponto de restauração sumiu do navegador.');
    trianguloOriginal = malha.trianguloOriginal || malha.indices.length / 3;
  } else {
    avisar(id, 'Lendo o arquivo…', 0);
    if (ext === '3mf') {
      const JSZip = await obterJSZip();
      malha = await ler3mf(arquivo, JSZip, (f) => avisar(id, 'Lendo o 3MF…', f));
    } else {
      let buffer = await arquivo.arrayBuffer();
      if (ext === 'stl') malha = lerStl(buffer, (f) => avisar(id, 'Lendo o STL…', f));
      else if (ext === 'obj') malha = lerObj(buffer, (f) => avisar(id, 'Lendo o OBJ…', f));
      else throw new Error(`Formato .${ext || '?'} não suportado. Use STL, OBJ, 3MF ou um projeto .lyke.`);
      buffer = null;
    }
    if (malha.indices.length === 0) throw new Error('O arquivo não tem nenhum triângulo.');
    garantirEstrutura(malha);
    trianguloOriginal = malha.indices.length / 3;
    if (simplificarPara && trianguloOriginal > simplificarPara) {
      avisar(id, 'Simplificando o modelo…', 0);
      malha = simplificarMalha(await obterMeshopt(), malha, simplificarPara);
    }
    if (malha.pinturaCor) {
      avisar(id, 'Lendo a pintura…', 0);
      atualizarResumo(malha);
    }
  }
  let resultado = { falhas: [], voltas: [] };
  if (receitas && receitas.length) {
    resultado = aplicarReceitas(malha, receitas, {
      guardarVolta,
      aoProgresso: (f) => avisar(id, 'Refazendo os passos…', f),
    });
  }
  const tela = await gerarTela(id, malha, limiteTela);
  malha.nome = nome;
  malha.trianguloOriginal = trianguloOriginal;
  const caixa = caixaDaMalha(malha);
  caixasDosObjetos(malha).forEach((t, i) => { malha.objetos[i].tamanho = t; });
  postMessage({
    id, tipo: 'pronto', malha, tela, caixa,
    falhas: resultado.falhas, voltas: resultado.voltas,
    projeto, modelo: modeloDoPacote,
  }, [...new Set([...transferiveis(malha, tela), ...transferiveisDasVoltas(resultado.voltas)])]);
}

async function gerarTela(id, malha, limiteTela) {
  const precisaSimplificar = malha.indices.length / 3 > limiteTela;
  // sem pintura e abaixo do limite: a tela usa a própria malha
  if (!precisaSimplificar && !malha.pinturaCor) return null;
  avisar(id, malha.pinturaCor ? 'Preparando a pintura na tela…' : 'Preparando a malha leve da tela…', 0);
  return prepararTela(precisaSimplificar ? await obterMeshopt() : null, malha, limiteTela);
}

/** Recebe a malha emprestada (transferida), gera a tela e devolve as duas. */
async function refazerTela(id, { malha, limiteTela }) {
  const tela = await gerarTela(id, malha, limiteTela);
  postMessage({ id, tipo: 'pronto', malha, tela }, transferiveis(malha, tela));
}

/**
 * Recebe a malha emprestada (transferida), grava o 3MF aos pedaços e devolve
 * o arquivo pronto (Blob) junto com a malha.
 */
async function exportar(id, { malha, miniatura }) {
  avisar(id, 'Gravando o 3MF…', 0);
  let r;
  try {
    r = await gravar3mf(malha, { miniatura, aoProgresso: (fase, f) => avisar(id, fase, f) });
  } catch (erro) {
    // devolve a malha mesmo com erro, para o app não perder o modelo
    postMessage({ id, tipo: 'pronto', malha, erro: erro && erro.message ? erro.message : String(erro) }, transferiveis(malha));
    return;
  }
  avisar(id, 'Terminando o arquivo…', 1);
  const arquivo = new Blob(r.pedacos, { type: 'model/3mf' });
  r.pedacos.length = 0;
  postMessage({ id, tipo: 'pronto', malha, arquivo, info: r.info }, transferiveis(malha));
}

self.onmessage = async (e) => {
  const { id, tipo, dados } = e.data;
  try {
    if (tipo === 'abrir') await abrir(id, dados);
    else if (tipo === 'tela') await refazerTela(id, dados);
    else if (tipo === 'exportar') await exportar(id, dados);
    else throw new Error(`Tarefa desconhecida: ${tipo}`);
  } catch (erro) {
    postMessage({ id, tipo: 'erro', mensagem: erro && erro.message ? erro.message : String(erro) });
  }
};
