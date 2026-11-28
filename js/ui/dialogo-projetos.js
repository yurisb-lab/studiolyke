// Janela "Projetos": lista dos projetos salvos neste navegador.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const data = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * @param {HTMLElement} el
 * @param {{id, nome, alterado, modelo, numPassos, numSelecoes, auto}[]} lista
 * @param {string|null} atual  id do projeto aberto
 */
export function renderizarProjetos(el, lista, atual = null) {
  if (!lista.length) {
    el.innerHTML = '<p class="vazio-texto">Nenhum projeto salvo neste navegador ainda. Use "Salvar projeto" (Ctrl+S) com um modelo aberto.</p>';
    return;
  }
  el.innerHTML = `<ul class="lista-projetos">${lista.map((p) => `
    <li data-projeto="${esc(p.id)}"${p.id === atual ? ' class="atual"' : ''}>
      <div class="proj-info">
        <strong class="proj-nome">${esc(p.nome)}${p.auto ? ' <span class="nota">(não salvo)</span>' : ''}${p.id === atual ? ' <span class="nota">(aberto)</span>' : ''}</strong>
        <span class="nota">${esc(p.modelo)} · ${p.numPassos} passo${p.numPassos === 1 ? '' : 's'}${p.numSelecoes ? ` · ${p.numSelecoes} seleç${p.numSelecoes === 1 ? 'ão salva' : 'ões salvas'}` : ''} · ${data(p.alterado)}</span>
      </div>
      <div class="proj-botoes">
        <button type="button" class="botao principal pequeno-largo" data-abrir-projeto="${esc(p.id)}">Abrir</button>
        <button type="button" class="botao pequeno-largo" data-baixar-projeto="${esc(p.id)}" title="Baixar o arquivo .lyke (para levar a outro aparelho)">Baixar .lyke</button>
        <button type="button" class="botao discreto pequeno-largo" data-apagar-projeto="${esc(p.id)}">Apagar</button>
      </div>
    </li>`).join('')}</ul>`;
}
