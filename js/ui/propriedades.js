// Conteúdo do painel de propriedades: modelo, aparelho e memória.

import { IMPRESSORA } from '../config.js';
import { formatarMB, formatarNumero, formatarTriangulos } from '../core/memoria.js';
import { corDoFilamento, filamentoDaParte, numFilamentos, rotuloFilamento, todasAsPartes, NOMES_SUBTIPO } from '../core/projeto.js';
import { ESTADO_MAXIMO } from '../io/pintura-bambu.js';

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
  const cabeNaMesa = (t) => t[0] <= IMPRESSORA.mesaX && t[1] <= IMPRESSORA.mesaY && t[2] <= IMPRESSORA.alturaMax;
  const cabe = cabeNaMesa(c.tamanho);
  const grandes = m.objetos.filter((o) => o.tamanho && !cabeNaMesa(o.tamanho));
  const avisos = m.avisos.length
    ? `<ul class="lista-avisos">${m.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
    : '';
  const a1 = IMPRESSORA.nome.replace('Bambu Lab ', '');
  let situacaoMesa;
  if (cabe) situacaoMesa = `<span class="selo ok">Cabe na mesa da ${a1}</span>`;
  else if (m.objetos.length > 1 && grandes.length === 0) {
    situacaoMesa = `<span class="selo ok">Cada objeto cabe na mesa da ${a1}</span> <span class="nota">(estão espalhados em mais de uma placa)</span>`;
  } else if (m.objetos.length > 1) {
    situacaoMesa = `<span class="selo perigo">${grandes.length} objeto(s) maior(es) que a mesa: vai precisar dividir</span>`;
  } else situacaoMesa = '<span class="selo perigo">Maior que a mesa: vai precisar dividir</span>';

  el.innerHTML = `
    <dl class="dados">
      <dt>Arquivo</dt><dd class="quebra" id="info-nome">${esc(m.nome)}</dd>
      <dt>Medidas</dt><dd id="info-medidas">${mm(c.tamanho[0])} × ${mm(c.tamanho[1])} × ${mm(c.tamanho[2])} mm</dd>
      <dt>Triângulos</dt><dd id="info-triangulos" data-valor="${tri}">${formatarNumero(tri)}</dd>
      <dt>Na tela</dt><dd id="info-tela" data-valor="${naTela}">${textoNaTela(estado, naTela)}</dd>
      ${m.trianguloOriginal && m.trianguloOriginal !== tri ? `<dt>Original</dt><dd>${formatarNumero(m.trianguloOriginal)} <span class="nota">(simplificado ao abrir)</span></dd>` : ''}
    </dl>
    <p>${situacaoMesa}</p>
    ${htmlFilamentos(m)}
    ${htmlPintura(m, estado)}
    ${htmlPlacas(m)}
    ${avisos}
  `;
}

const MAX_OBJETOS = 200;

/** "malha completa", ou quantos triângulos a malha leve tem (+ pedaços da pintura fina). */
function textoNaTela(estado, naTela) {
  const t = estado.tela;
  const pedacos = t && t.detalhe ? t.detalhe.posicoes.length / 9 : 0;
  const mais = pedacos ? ` <span class="nota">+ ${formatarNumero(pedacos)} pedaços da pintura</span>` : '';
  if (!t || !t.posicoes) return `malha completa${mais}`;
  return `${formatarNumero(naTela)} <span class="nota">(malha leve)</span>${mais}`;
}

const cm2 = (mm2) => {
  const v = mm2 / 100;
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 2 : 1 })} cm²`;
};

/** Nome de cada parte para as listas ("Objeto › parte" quando o objeto tem várias). */
function nomesDasPartes(m) {
  return todasAsPartes(m).map(({ parte, objeto }) => (objeto.partes.length > 1 ? `${objeto.nome} › ${parte.nome}` : objeto.nome));
}

/** Índice de cada parte em todasAsPartes(), por objeto e parte. */
function indicesDasPartes(m) {
  const mapa = new Map();
  todasAsPartes(m).forEach(({ indiceObjeto, objeto, parte }, k) => mapa.set(`${indiceObjeto}:${objeto.partes.indexOf(parte)}`, k));
  return mapa;
}

/** Seção "Pintura": cores usadas, área, mostrar/esconder, trocar cor e apagar. */
function htmlPintura(m, estado) {
  const resumo = m.pinturaCor && m.pinturaCor.resumo;
  if (!resumo || !resumo.estados.length) {
    if (m.pinturaApagada) {
      return '<h3>Pintura</h3><p class="nota" id="info-pintura">A pintura foi toda apagada. O 3MF exportado sai sem pintura de cor.</p>';
    }
    return '';
  }
  const total = new Array(ESTADO_MAXIMO + 1).fill(0);
  for (const p of resumo.partes) for (let e = 1; e <= ESTADO_MAXIMO; e++) total[e] += p.areas[e];
  const nFil = m.filamentos.length || 4;
  const cores = resumo.estados.map((e) => `
    <li data-cor-pintura="${e}">${bolinha(corDoFilamento(m, e))}
      <span>Filamento ${esc(rotuloFilamento(m, e))}</span>
      <span class="num">${cm2(total[e])}</span>
    </li>`).join('');
  const avisos = [];
  if (resumo.maiorEstado > nFil) {
    avisos.push(`A pintura usa o filamento ${resumo.maiorEstado}, mas o projeto só tem ${nFil}. No Bambu Studio, essa cor fica sem filamento: troque-a abaixo.`);
  } else if (resumo.maiorEstado > 4) {
    avisos.push(`A pintura usa o filamento ${resumo.maiorEstado}: o AMS tem 4 slots.`);
  }
  if (resumo.quebrados) avisos.push(`${resumo.quebrados.toLocaleString('pt-BR')} triângulo(s) com pintura que o app não entendeu (voltam iguais ao exportar).`);
  const nomes = nomesDasPartes(m);
  const ondeOpcoes = ['<option value="">o modelo todo</option>',
    ...resumo.partes.map((p, k) => (p.pintada ? `<option value="${k}">${esc(nomes[k])}</option>` : '')).filter(Boolean)].join('');
  const deOpcoes = resumo.estados.map((e) => `<option value="${e}">${esc(rotuloFilamento(m, e))}</option>`).join('');
  let paraOpcoes = '<option value="0">sem pintura</option>';
  for (let k = 1; k <= Math.min(ESTADO_MAXIMO, numFilamentos(m)); k++) paraOpcoes += `<option value="${k}">${esc(rotuloFilamento(m, k))}</option>`;
  const fina = resumo.subdivididos ? ` · ${resumo.subdivididos.toLocaleString('pt-BR')} com pintura fina` : '';
  const telaFina = estado.tela && estado.tela.detalhe ? estado.tela.detalhe.posicoes.length / 9 : 0;
  return `
    <h3>Pintura</h3>
    <p class="nota" id="info-pintura" data-pintados="${resumo.pintados}" data-finos="${resumo.subdivididos}">${resumo.pintados.toLocaleString('pt-BR')} triângulos pintados${fina}.${telaFina ? ` Na tela: ${telaFina.toLocaleString('pt-BR')} pedaços da pintura fina.` : ''}</p>
    <label class="interruptor"><input type="checkbox" id="mostrar-pintura"${estado.mostrarPintura ? ' checked' : ''}><span class="chave" aria-hidden="true"></span><span>Mostrar pintura</span></label>
    <ul class="lista-cores-pintura" id="lista-cores-pintura">${cores}</ul>
    ${avisos.length ? `<ul class="lista-avisos">${avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    <div class="trocar-pintura" id="trocar-pintura">
      <label><span class="rotulo">Trocar a cor</span><select id="pintura-de" class="seletor-filamento">${deOpcoes}</select></label>
      <label><span class="rotulo">por</span><select id="pintura-para" class="seletor-filamento">${paraOpcoes}</select></label>
      <label class="largo"><span class="rotulo">em</span><select id="pintura-onde" class="seletor-filamento">${ondeOpcoes}</select></label>
      <button type="button" class="botao" id="pintura-trocar">Trocar</button>
    </div>
  `;
}

/** Linha da pintura de uma parte (cores e área) com o botão de apagar. */
function htmlPinturaDaParte(m, k) {
  const resumo = m.pinturaCor && m.pinturaCor.resumo;
  const p = resumo && resumo.partes[k];
  if (!p || !p.pintada) return '';
  const itens = [];
  for (let e = 1; e <= ESTADO_MAXIMO; e++) {
    if (p.areas[e] > 0) itens.push(`<span class="cor-area">${bolinha(corDoFilamento(m, e))}${e} · ${cm2(p.areas[e])}</span>`);
  }
  return `<div class="pintura-parte" data-pintura-parte="${k}"><span class="nota">Pintura:</span> ${itens.join(' ')}
    <button type="button" class="botao discreto pequeno" data-apagar-pintura="${k}">Apagar pintura</button></div>`;
}

function bolinha(cor) {
  return `<span class="bolinha" style="background:${esc(cor)}" aria-hidden="true"></span>`;
}

function htmlFilamentos(m) {
  if (!m.filamentos.length) {
    return '<h3>Filamentos</h3><p class="nota">Este arquivo não diz quais filamentos usar: as cores na tela são só de exemplo. No Bambu Studio vale o filamento de cada slot do AMS.</p>';
  }
  const itens = m.filamentos.map((f, i) => `
    <li data-filamento="${i + 1}">${bolinha(corDoFilamento(m, i + 1))}
      <span class="fil-num">${i + 1}</span>
      <span class="fil-nome">${esc(f.tipo || 'Filamento')} <span class="nota">${esc(f.cor.toUpperCase())}</span></span>
      ${f.perfil ? `<span class="nota fil-perfil">${esc(f.perfil.replace(/ @BBL.*$/, ''))}</span>` : ''}
    </li>`).join('');
  return `<h3>Filamentos (${m.filamentos.length})</h3><ul class="lista-filamentos" id="lista-filamentos">${itens}</ul>`;
}

/** Seletor de filamento de uma parte. */
function seletor(m, io, ip, nomeParte) {
  const o = m.objetos[io];
  const p = o.partes[ip];
  const atual = filamentoDaParte(p, o);
  const n = numFilamentos(m);
  let opcoes = '';
  for (let k = 1; k <= n; k++) opcoes += `<option value="${k}"${k === atual ? ' selected' : ''}>${esc(rotuloFilamento(m, k))}</option>`;
  return `<label class="filamento-parte">${bolinha(corDoFilamento(m, atual))}
    <select class="seletor-filamento" data-objeto="${io}" data-parte="${ip}" aria-label="Filamento de ${esc(nomeParte)}">${opcoes}</select></label>`;
}

function htmlObjeto(m, io, indices) {
  const o = m.objetos[io];
  const medidas = o.tamanho ? `<span class="nota">${o.tamanho.map((v) => Math.round(v)).join(' × ')} mm</span>` : '';
  const fora = o.imprimivel === false ? ' <span class="nota">(não imprime)</span>' : '';
  const normais = o.partes.length;
  if (normais === 1) {
    return `<li class="objeto" data-objeto="${io}">
      <div class="linha"><span class="nome">${esc(o.nome)}${fora} ${medidas}</span>${seletor(m, io, 0, o.nome)}</div>
      ${htmlPinturaDaParte(m, indices.get(`${io}:0`))}
    </li>`;
  }
  const partes = o.partes.map((p, ip) => {
    const tipo = p.subtipo && p.subtipo !== 'normal_part' ? ` <span class="nota">(${esc(NOMES_SUBTIPO[p.subtipo] || p.subtipo)})</span>` : '';
    return `<li class="parte"><div class="linha"><span class="nome">${esc(p.nome)}${tipo}</span>${seletor(m, io, ip, p.nome)}</div>${htmlPinturaDaParte(m, indices.get(`${io}:${ip}`))}</li>`;
  }).join('');
  return `<li class="objeto" data-objeto="${io}">
    <div class="linha"><span class="nome">${esc(o.nome)}${fora} ${medidas}</span><span class="num">${o.partes.length} partes</span></div>
    <ul class="lista-partes">${partes}</ul>
  </li>`;
}

function htmlPlacas(m) {
  let mostrados = 0;
  const indicesPartes = indicesDasPartes(m);
  const lista = (indices) => {
    let html = '';
    for (const io of indices) {
      if (mostrados >= MAX_OBJETOS) break;
      html += htmlObjeto(m, io, indicesPartes);
      mostrados++;
    }
    return html;
  };
  const naPlaca = new Set(m.placas.flatMap((p) => p.objetos));
  const fora = m.objetos.map((_, i) => i).filter((i) => !naPlaca.has(i));
  let html = `<h3>${m.placas.length > 1 ? `Placas (${m.placas.length})` : 'Placa'} · ${m.objetos.length} objeto${m.objetos.length > 1 ? 's' : ''}</h3>`;
  for (const [ip, pl] of m.placas.entries()) {
    const titulo = `Placa ${pl.id || ip + 1}${pl.nome ? ` · ${esc(pl.nome)}` : ''}${pl.bloqueada ? ' <span class="nota">(travada)</span>' : ''}`;
    html += `<div class="placa" data-placa="${ip}"><h4>${titulo} <span class="nota">${pl.objetos.length} objeto${pl.objetos.length === 1 ? '' : 's'}</span></h4>
      <ul class="lista-objetos">${lista(pl.objetos)}</ul></div>`;
  }
  if (fora.length) {
    html += `<div class="placa"><h4>Fora das placas <span class="nota">${fora.length}</span></h4><ul class="lista-objetos">${lista(fora)}</ul></div>`;
  }
  if (m.objetos.length > mostrados) html += `<p class="nota">e mais ${m.objetos.length - mostrados} objetos…</p>`;
  return html;
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
