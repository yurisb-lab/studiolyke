// Painel "Seleção" (ferramentas da esquerda) e a barrinha da seleção sobre a peça.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const NOMES_MODO = { cor: 'Cor', angulo: 'Ângulo', casca: 'Casca' };
export const NOMES_COMBINAR = { nova: 'Nova', somar: '＋ Somar', tirar: '− Tirar' };

const segmento = (grupo, valor, atual, texto, titulo = '') => `<button type="button" class="segmento${valor === atual ? ' ativo' : ''}" data-${grupo}="${valor}" aria-pressed="${valor === atual}"${titulo ? ` title="${esc(titulo)}"` : ''}>${texto}</button>`;

const cm2 = (mm2) => {
  const v = mm2 / 100;
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 2 : 1 })} cm²`;
};

/** Texto curto do que está selecionado. */
export function textoResumo(resumo) {
  if (!resumo || !resumo.triangulos) return 'Nada selecionado';
  const pedacos = resumo.pedacos ? ` (${resumo.pedacos.toLocaleString('pt-BR')} na borda da pintura)` : '';
  return `${resumo.triangulos.toLocaleString('pt-BR')} triângulos${pedacos} · ${cm2(resumo.area)}`;
}

/**
 * @param {HTMLElement} el
 * @param {{opcoes, resumo, salvas: {nome}[], temModelo:boolean}} s
 */
export function renderizarSelecao(el, s) {
  const o = s.opcoes;
  const tem = !!(s.resumo && s.resumo.triangulos);
  const desl = s.temModelo ? '' : ' disabled';
  const salvas = (s.salvas || []).map((x, i) => `
    <li data-salva="${i}"><span class="nome-salva">${esc(x.nome)}</span>
      <span class="botoes-salva">
        <button type="button" class="botao pequeno-largo" data-usar-salva="${i}" title="Usar esta seleção">Usar</button>
        <button type="button" class="botao pequeno-largo" data-somar-salva="${i}" title="Somar à seleção atual" aria-label="Somar ${esc(x.nome)}">＋</button>
        <button type="button" class="botao discreto pequeno-largo" data-apagar-salva="${i}" aria-label="Apagar ${esc(x.nome)}">×</button>
      </span></li>`).join('');
  el.innerHTML = `
    <div class="segmentos" role="group" aria-label="Ferramenta de seleção">
      ${segmento('sel-ferramenta', 'varinha', o.ferramenta, 'Varinha', 'Varinha mágica (W): toque na peça')}
      ${segmento('sel-ferramenta', 'laco', o.ferramenta, 'Laço', 'Laço (L): desenhe um contorno na peça')}
    </div>
    ${o.ferramenta === 'varinha' ? `
    <div class="segmentos" role="group" aria-label="A varinha pega pela">
      ${segmento('sel-modo', 'cor', o.modo, 'Cor', 'A região da mesma cor (pintura ou filamento)')}
      ${segmento('sel-modo', 'angulo', o.modo, 'Ângulo', 'Cresce até achar uma quina mais forte que o limite')}
      ${segmento('sel-modo', 'casca', o.modo, 'Casca', 'A peça solta inteira')}
    </div>
    ${o.modo === 'angulo' ? `<label class="campo-faixa"><span>Quina até <strong id="sel-angulo-valor">${o.angulo}°</strong></span>
      <input type="range" id="sel-angulo" min="5" max="180" step="1" value="${o.angulo}"></label>` : ''}
    ${o.modo === 'cor' ? `<label class="interruptor"><input type="checkbox" id="sel-contiguo"${o.contiguo ? ' checked' : ''}><span class="chave" aria-hidden="true"></span><span>Só a região tocada</span></label>` : ''}
    ` : '<p class="dica">Desenhe um contorno em volta do que quer pegar. Dois dedos (ou o botão direito) ainda mexem na vista.</p>'}
    ${o.ferramenta === 'varinha' && o.modo === 'casca' ? '' : `<label class="interruptor"><input type="checkbox" id="sel-visivel"${o.soVisivel ? ' checked' : ''}><span class="chave" aria-hidden="true"></span><span>Só faces visíveis</span></label>`}
    <div class="segmentos" role="group" aria-label="Juntar com a seleção atual">
      ${segmento('sel-combinar', 'nova', o.combinar, 'Nova')}
      ${segmento('sel-combinar', 'somar', o.combinar, '＋ Somar', 'Somar à seleção (Shift)')}
      ${segmento('sel-combinar', 'tirar', o.combinar, '− Tirar', 'Tirar da seleção (Alt)')}
    </div>
    <p class="info-selecao" id="info-selecao" data-triangulos="${s.resumo ? s.resumo.triangulos : 0}">${textoResumo(s.resumo)}</p>
    <div class="ajustes-selecao">
      <label class="campo-mm" title="Quanto crescer ou encolher"><input type="number" id="sel-mm" min="0.1" max="50" step="0.1" value="${o.mm}" inputmode="decimal"><span>mm</span></label>
      <button type="button" class="botao" data-sel-ajuste="crescer"${tem ? '' : ' disabled'}>Crescer</button>
      <button type="button" class="botao" data-sel-ajuste="encolher"${tem ? '' : ' disabled'}>Encolher</button>
      <button type="button" class="botao" data-sel-ajuste="inverter"${desl} title="Inverter (Ctrl+I)">Inverter</button>
      <button type="button" class="botao" data-sel-ajuste="tudo"${desl} title="Selecionar tudo (Ctrl+A)">Tudo</button>
      <button type="button" class="botao discreto" data-sel-ajuste="limpar"${tem ? '' : ' disabled'} title="Limpar (Ctrl+D)">Limpar</button>
    </div>
    <h3>Seleções salvas</h3>
    <form class="salvar-selecao" id="form-salvar-selecao">
      <input type="text" id="sel-nome" placeholder="Nome (ex.: olho esquerdo)" maxlength="60" autocomplete="off"${tem ? '' : ' disabled'}>
      <button type="submit" class="botao"${tem ? '' : ' disabled'}>Salvar</button>
    </form>
    ${salvas ? `<ul class="lista-salvas" id="lista-salvas">${salvas}</ul>` : '<p class="nota">Nenhuma ainda. Elas vão junto com o projeto.</p>'}
    <p class="dica so-computador">Clique na peça para usar a varinha. Shift soma, Alt tira. W varinha · L laço · Ctrl+D limpa.</p>
    <p class="dica so-toque">Toque rápido na peça = varinha. Use ＋ e − para somar ou tirar.</p>
  `;
}

/** Barrinha sobre a peça: ferramenta, quanto está selecionado, somar/tirar e limpar. */
export function renderizarBarraSelecao(el, s) {
  if (!s.temModelo) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const o = s.opcoes;
  const n = s.resumo ? s.resumo.triangulos : 0;
  el.innerHTML = `
    <button type="button" class="chip-sel" data-sel-ferramenta="${o.ferramenta === 'varinha' ? 'laco' : 'varinha'}" title="Trocar a ferramenta">${o.ferramenta === 'varinha' ? 'Varinha' : 'Laço'}</button>
    <span class="conta-sel">${n ? `${n.toLocaleString('pt-BR')} sel.` : 'nada sel.'}</span>
    <button type="button" class="chip-sel${o.combinar === 'somar' ? ' ativo' : ''}" data-sel-combinar="${o.combinar === 'somar' ? 'nova' : 'somar'}" aria-pressed="${o.combinar === 'somar'}" aria-label="Somar à seleção">＋</button>
    <button type="button" class="chip-sel${o.combinar === 'tirar' ? ' ativo' : ''}" data-sel-combinar="${o.combinar === 'tirar' ? 'nova' : 'tirar'}" aria-pressed="${o.combinar === 'tirar'}" aria-label="Tirar da seleção">−</button>
    <button type="button" class="chip-sel" data-sel-ajuste="limpar"${n ? '' : ' disabled'} aria-label="Limpar a seleção">✕</button>`;
}
