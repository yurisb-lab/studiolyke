// Conteúdo do painel de propriedades: modelo, aparelho e memória.

import { IMPRESSORA } from '../config.js';
import { formatarMB, formatarNumero, formatarTriangulos } from '../core/memoria.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const mm = (v) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}`;

export function renderizarModelo(el, estado) {
  const m = estado.malha;
  if (!m) {
    el.innerHTML = '<p class="vazio-texto">Nenhum modelo aberto.</p>';
    return;
  }
  const c = estado.caixa;
  const tri = m.indices.length / 3;
  const naTela = estado.tela ? estado.tela.indices.length / 3 : tri;
  const cabe = c.tamanho[0] <= IMPRESSORA.mesaX && c.tamanho[1] <= IMPRESSORA.mesaY && c.tamanho[2] <= IMPRESSORA.alturaMax;
  const objetos = m.objetos.slice(0, 50).map((o) => `<li><span>${esc(o.nome)}</span><span class="num">${formatarTriangulos(o.numTriangulos)}</span></li>`).join('');
  const maisObjetos = m.objetos.length > 50 ? `<li class="mais">e mais ${m.objetos.length - 50}…</li>` : '';
  const avisos = m.avisos.length
    ? `<ul class="lista-avisos">${m.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
    : '';
  let situacaoMesa;
  if (cabe) situacaoMesa = `<span class="selo ok">Cabe na mesa da ${IMPRESSORA.nome.replace('Bambu Lab ', '')}</span>`;
  else situacaoMesa = '<span class="selo perigo">Maior que a mesa: vai precisar dividir</span>';

  el.innerHTML = `
    <dl class="dados">
      <dt>Arquivo</dt><dd class="quebra" id="info-nome">${esc(m.nome)}</dd>
      <dt>Medidas</dt><dd id="info-medidas">${mm(c.tamanho[0])} × ${mm(c.tamanho[1])} × ${mm(c.tamanho[2])} mm</dd>
      <dt>Triângulos</dt><dd id="info-triangulos" data-valor="${tri}">${formatarNumero(tri)}</dd>
      <dt>Na tela</dt><dd id="info-tela" data-valor="${naTela}">${estado.tela ? `${formatarNumero(naTela)} <span class="nota">(malha leve)</span>` : 'malha completa'}</dd>
      ${m.trianguloOriginal && m.trianguloOriginal !== tri ? `<dt>Original</dt><dd>${formatarNumero(m.trianguloOriginal)} <span class="nota">(simplificado ao abrir)</span></dd>` : ''}
    </dl>
    <p>${situacaoMesa}</p>
    <h3>Objetos (${m.objetos.length})</h3>
    <ul class="lista-objetos">${objetos}${maisObjetos}</ul>
    ${avisos}
  `;
}

const NOMES_NIVEL = { forte: 'Forte', medio: 'Médio', fraco: 'Fraco' };

export function renderizarAparelho(el, estado) {
  const cap = estado.capacidade;
  const p = estado.perfil;
  const pref = estado.preferenciaLeve;
  const autoTexto = cap.modoLeveAuto ? 'ligado' : 'desligado';
  const opcao = (valor, texto) => `<button type="button" class="segmento${pref === valor ? ' ativo' : ''}" data-modo-leve="${valor}" aria-pressed="${pref === valor}">${texto}</button>`;
  el.innerHTML = `
    <div class="campo">
      <span class="rotulo">Modo leve</span>
      <div class="segmentos" role="group" aria-label="Modo leve">
        ${opcao('auto', `Automático <small>(${autoTexto})</small>`)}
        ${opcao('ligado', 'Ligado')}
        ${opcao('desligado', 'Desligado')}
      </div>
    </div>
    <dl class="dados">
      <dt>Aparelho</dt><dd id="info-nivel" data-nivel="${cap.nivel}">${NOMES_NIVEL[cap.nivel]}${cap.motivos.length ? ` <span class="nota">(${esc(cap.motivos.join(', '))})</span>` : ''}</dd>
      <dt>Memória</dt><dd>${cap.memoriaGB ? `${cap.memoriaGB} GB${cap.memoriaGB >= 8 ? ' ou mais' : ''}` : '<span class="nota">o navegador não informa</span>'}</dd>
      <dt>Vídeo</dt><dd class="quebra">${esc(cap.gpu.renderizador || 'desconhecido')}</dd>
      <dt>Teste rápido</dt><dd>${cap.testeMs.toLocaleString('pt-BR')} ms <span class="nota">(menor é melhor)</span></dd>
      <dt>Núcleos</dt><dd>${cap.nucleos || '—'}</dd>
      <dt>Limite na tela</dt><dd id="info-limite" data-valor="${p.limiteTela}">${formatarTriangulos(p.limiteTela)} triângulos</dd>
      <dt>Sombras</dt><dd>${p.sombras ? 'sim' : 'não'}</dd>
      <dt>Salva em</dt><dd>${esc(estado.ondeSalva || 'navegador')}</dd>
    </dl>
  `;
}

export function renderizarMemoria(el, uso, perfil) {
  el.innerHTML = `
    <dl class="dados">
      <dt>Total</dt><dd>${formatarMB((uso.heapMB || 0) + uso.modeloMB + uso.telaMB)}</dd>
      <dt>JavaScript</dt><dd>${uso.heapMB != null ? formatarMB(uso.heapMB) : '<span class="nota">o navegador não informa</span>'}</dd>
      <dt>Modelo</dt><dd>${formatarMB(uso.modeloMB)}</dd>
      <dt>Malha da tela</dt><dd>${uso.telaMB ? formatarMB(uso.telaMB) : 'usa a do modelo'}</dd>
      <dt>Seguro até</dt><dd>${formatarMB(perfil.orcamentoMB)}</dd>
    </dl>
    <p class="dica">Dica: feche o Bambu Studio e deixe poucas abas abertas enquanto usa o app.</p>
  `;
}
