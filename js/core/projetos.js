// Projetos: o arquivo original + as receitas do histórico + seleções salvas + vista.
// Tudo passa pela camada única de armazenamento (js/core/armazenamento.js): hoje no
// navegador (IndexedDB); depois o Google Drive entra lá sem mudar nada aqui.
//
// Registro de um projeto (coleção "projetos"):
//   { id, nome, criado, alterado, versaoApp,
//     base: { nome, tamanho, chaveArquivo, simplificarPara },   (arquivo original)
//     passos: [{ id, tipo, params, rotulo, quando }], posicao,   (receitas, ver historico.js)
//     selecoes: [{ nome, selecao }], selecaoAtual,               (seleções compactas)
//     vista: { posicao: [x,y,z], alvo: [x,y,z] } }
// O original fica na coleção "arquivos" (Blob), pela chave; vários registros podem
// apontar para o mesmo arquivo (o rascunho e o projeto salvo, por exemplo).
//
// Rascunho: o trabalho atual é gravado sozinho a cada mudança, no registro especial
// RASCUNHO. Se a página fechar ou o aparelho travar, o app oferece continuar dali.
// Se o trabalho já é um projeto salvo, o projeto também é atualizado sozinho.

import * as armazenamento from './armazenamento.js';
import { novoId } from './historico.js';

export const RASCUNHO = '__rascunho';

export function novoRegistro({ nome, base, versaoApp = '' }) {
  const agora = Date.now();
  return {
    id: null,
    nome: nome || 'Projeto',
    criado: agora,
    alterado: agora,
    versaoApp,
    base: { nome: base.nome, tamanho: base.tamanho || 0, chaveArquivo: base.chaveArquivo || null, simplificarPara: base.simplificarPara || null },
    passos: [],
    posicao: 0,
    selecoes: [],
    selecaoAtual: null,
    vista: null,
  };
}

/** Nome do projeto a partir do arquivo ("boneco.3mf" -> "boneco"). */
export function nomeDoArquivo(nome) {
  return String(nome || 'Projeto').replace(/\.[a-z0-9]+$/i, '').replace(/_fatiador$/i, '') || 'Projeto';
}

/** Guarda o arquivo original e devolve a chave. */
export async function guardarArquivo(blob) {
  const chave = `arq-${novoId()}`;
  await armazenamento.gravar('arquivos', chave, blob);
  return chave;
}

export async function lerArquivo(chave) {
  if (!chave) return null;
  return armazenamento.ler('arquivos', chave, null);
}

export async function gravarRascunho(registro) {
  await armazenamento.gravar('projetos', RASCUNHO, { ...registro, alterado: Date.now() });
}

export async function lerRascunho() {
  return armazenamento.ler('projetos', RASCUNHO, null);
}

export async function descartarRascunho() {
  await armazenamento.apagar('projetos', RASCUNHO);
}

/** Grava como projeto com nome (cria o id na primeira vez). Devolve o registro gravado. */
export async function salvarProjeto(registro) {
  const r = { ...registro, id: registro.id || `proj-${novoId()}`, alterado: Date.now() };
  await armazenamento.gravar('projetos', r.id, r);
  return r;
}

export async function lerProjeto(id) {
  return armazenamento.ler('projetos', id, null);
}

/** Projetos salvos, do mais recente para o mais antigo (sem o rascunho). */
export async function listarProjetos() {
  const chaves = (await armazenamento.listar('projetos')).filter((k) => typeof k === 'string' && !k.startsWith('__'));
  const lista = [];
  for (const k of chaves) {
    const r = await armazenamento.ler('projetos', k, null);
    if (!r) continue;
    lista.push({
      id: r.id,
      nome: r.nome,
      alterado: r.alterado,
      modelo: r.base ? r.base.nome : '',
      numPassos: (r.passos || []).length,
      numSelecoes: (r.selecoes || []).length,
      auto: !!r.auto,
    });
  }
  return lista.sort((a, b) => b.alterado - a.alterado);
}

/**
 * Trabalho sem nome que ia se perder ao abrir outro modelo: fica guardado como
 * projeto "não salvo" (auto). Só os MAX_AUTO mais recentes ficam.
 */
export const MAX_AUTO = 3;
export async function guardarAutomatico(registro) {
  const r = await salvarProjeto({ ...registro, auto: true });
  const autos = (await listarProjetos()).filter((p) => p.auto);
  for (const velho of autos.slice(MAX_AUTO)) await armazenamento.apagar('projetos', velho.id);
  await limparArquivos();
  return r;
}

export async function apagarProjeto(id) {
  await armazenamento.apagar('projetos', id);
  await limparArquivos();
}

/** Apaga os arquivos originais que nenhum projeto (nem o rascunho) usa mais. */
export async function limparArquivos(manter = []) {
  const usados = new Set(manter.filter(Boolean));
  for (const k of await armazenamento.listar('projetos')) {
    const r = await armazenamento.ler('projetos', k, null);
    if (r && r.base && r.base.chaveArquivo) usados.add(r.base.chaveArquivo);
  }
  let apagados = 0;
  for (const k of await armazenamento.listar('arquivos')) {
    if (!usados.has(k)) {
      await armazenamento.apagar('arquivos', k);
      apagados++;
    }
  }
  return apagados;
}

/** Ponto de restauração: o modelo pronto, gravado no IndexedDB (não fica na memória). */
export async function gravarPonto(malha) {
  const chave = `ponto-${novoId()}`;
  await armazenamento.gravar('pontos-restauracao', chave, malha);
  return chave;
}

export async function apagarPontos(chaves) {
  for (const c of chaves || []) await armazenamento.apagar('pontos-restauracao', c);
}

/** Pontos de restauração de sessões antigas (eles só valem enquanto o app está aberto). */
export async function apagarTodosOsPontos() {
  for (const c of await armazenamento.listar('pontos-restauracao')) await armazenamento.apagar('pontos-restauracao', c);
}
