// Painel "Histórico": a lista de passos, com voltar até um passo, editar e apagar.

import { ehModelo } from '../core/historico.js';
import { operacao } from '../ops/index.js';
import { numFilamentos, rotuloFilamento, todasAsPartes } from '../core/projeto.js';
import { ESTADO_MAXIMO } from '../io/pintura-bambu.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const hora = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * @param {HTMLElement} el
 * @param {{historico, malha, editando:number|null, projeto, salvoEm:number|null, ocupado:boolean}} estado
 */
export function renderizarHistorico(el, estado) {
  const h = estado.historico;
  if (!estado.malha) {
    el.innerHTML = '<p class="vazio-texto">Abra um modelo: cada mudança aparece aqui e dá para voltar.</p>';
    return;
  }
  const itens = [`<li class="passo inicio${h.posicao === 0 ? ' atual' : ''}">
    <button type="button" class="ir" data-ir="0"${h.posicao === 0 ? ' aria-current="step"' : ''}>
      <span class="num">0</span><span class="rotulo">Modelo aberto</span></button></li>`];
  h.passos.forEach((p, i) => {
    const feito = i < h.posicao;
    const atual = i === h.posicao - 1;
    const classes = ['passo', feito ? 'feito' : 'futuro', atual ? 'atual' : '', p.erro ? 'com-erro' : '', p.tipo === 'selecao' ? 'de-selecao' : ''].filter(Boolean).join(' ');
    let editavel = false;
    try { editavel = ehModelo(p) && operacao(p.tipo).editavel; } catch { /* tipo desconhecido */ }
    itens.push(`<li class="${classes}" data-indice="${i}">
      <button type="button" class="ir" data-ir="${i + 1}"${atual ? ' aria-current="step"' : ''} title="${feito ? 'Voltar até aqui' : 'Refazer até aqui'}">
        <span class="num">${i + 1}</span><span class="rotulo">${esc(p.rotulo)}${p.erro ? ` <span class="erro-passo">(não deu certo: ${esc(p.erro)})</span>` : ''}</span>
        <span class="quando">${hora(p.quando)}</span></button>
      ${editavel ? `<button type="button" class="botao-icone pequeno" data-editar-passo="${i}" aria-label="Editar o passo ${i + 1}" title="Editar"><svg aria-hidden="true"><use href="#i-editar"/></svg></button>` : ''}
      <button type="button" class="botao-icone pequeno" data-apagar-passo="${i}" aria-label="Apagar o passo ${i + 1}" title="Apagar"><svg aria-hidden="true"><use href="#i-lixo"/></svg></button>
      ${estado.editando === i ? editor(estado.malha, p) : ''}
    </li>`);
  });
  const nModelo = h.numModelo;
  const salvo = estado.projeto && estado.projeto.id ? `Projeto "${esc(estado.projeto.nome)}"` : 'Não salvo como projeto';
  const quando = estado.salvoEm ? ` · guardado às ${hora(estado.salvoEm)}` : '';
  el.innerHTML = `
    <ol class="lista-historico" id="lista-historico">${itens.join('')}</ol>
    <p class="nota" id="info-historico" data-passos="${h.passos.length}" data-posicao="${h.posicao}">${h.passos.length} passo${h.passos.length === 1 ? '' : 's'} (${nModelo} no modelo) · ${salvo}${quando}</p>`;
  // rola só a lista (não o painel inteiro) até o passo atual
  const lista = el.querySelector('.lista-historico');
  const atual = el.querySelector('.passo.atual');
  if (lista && atual) {
    const topo = atual.offsetTop; // a lista é position: relative
    if (topo < lista.scrollTop || topo + atual.offsetHeight > lista.scrollTop + lista.clientHeight) {
      lista.scrollTop = Math.max(0, topo - lista.clientHeight + atual.offsetHeight + 4);
    }
  }
}

/** Formulário para editar a receita de um passo. */
function editor(malha, passo) {
  const p = passo.params;
  let campos = '';
  if (passo.tipo === 'filamento') {
    let ops = '';
    for (let k = 1; k <= numFilamentos(malha); k++) ops += `<option value="${k}"${k === p.filamento ? ' selected' : ''}>${esc(rotuloFilamento(malha, k))}</option>`;
    campos = `<label><span class="rotulo">Filamento</span><select class="seletor-filamento" data-campo="filamento">${ops}</select></label>`;
  } else if (passo.tipo === 'pintura-trocar') {
    let de = `<option value="todas"${p.de === 'todas' ? ' selected' : ''}>toda a pintura (apagar)</option>`;
    let para = `<option value="0"${p.para === 0 ? ' selected' : ''}>sem pintura</option>`;
    const n = Math.min(ESTADO_MAXIMO, Math.max(numFilamentos(malha), typeof p.de === 'number' ? p.de : 0, p.para || 0));
    for (let k = 1; k <= n; k++) {
      de += `<option value="${k}"${k === p.de ? ' selected' : ''}>${esc(rotuloFilamento(malha, k))}</option>`;
      para += `<option value="${k}"${k === p.para ? ' selected' : ''}>${esc(rotuloFilamento(malha, k))}</option>`;
    }
    let onde = `<option value=""${p.parteIndice == null ? ' selected' : ''}>o modelo todo</option>`;
    todasAsPartes(malha).forEach(({ objeto, parte }, k) => {
      const nome = objeto.partes.length > 1 ? `${objeto.nome} › ${parte.nome}` : objeto.nome;
      onde += `<option value="${k}"${k === p.parteIndice ? ' selected' : ''}>${esc(nome)}</option>`;
    });
    campos = `<label><span class="rotulo">Cor</span><select class="seletor-filamento" data-campo="de">${de}</select></label>
      <label><span class="rotulo">por</span><select class="seletor-filamento" data-campo="para">${para}</select></label>
      <label class="largo"><span class="rotulo">em</span><select class="seletor-filamento" data-campo="parteIndice">${onde}</select></label>`;
  }
  return `<div class="editor-passo" data-editor="${passo.id}">${campos}
    <div class="editor-botoes"><button type="button" class="botao principal" data-aplicar-edicao>Aplicar</button>
    <button type="button" class="botao discreto" data-cancelar-edicao>Cancelar</button></div></div>`;
}

/** Lê o formulário do editor: os novos parâmetros do passo. */
export function lerEditor(el, passo) {
  const campo = (nome) => el.querySelector(`[data-campo="${nome}"]`);
  if (passo.tipo === 'filamento') return { filamento: Number(campo('filamento').value) };
  if (passo.tipo === 'pintura-trocar') {
    const de = campo('de').value;
    const onde = campo('parteIndice').value;
    return {
      de: de === 'todas' ? 'todas' : Number(de),
      para: Number(campo('para').value),
      parteIndice: onde === '' ? null : Number(onde),
      nome: onde === '' ? null : campo('parteIndice').selectedOptions[0].textContent,
    };
  }
  return {};
}
