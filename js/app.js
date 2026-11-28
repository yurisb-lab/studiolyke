// Ponto de partida do Fatiador L.Y.K.E 3D.

import { VERSAO } from './config.js';
import { medirCapacidade, perfilEmUso } from './core/capacidade.js';
import { estimarAbertura, usoAtual, formatarMB, formatarTriangulos, extensao, FORMATOS, MB } from './core/memoria.js';
import { bytesDaMalha, transferiveis } from './core/malha.js';
import { aparenciaDasPartes, faixasDasPartes, trocarFilamento, corDoFilamento, todasAsPartes, rotuloFilamento } from './core/projeto.js';
import { trocarCorDaPintura, trocarCorNaTela } from './core/pintura.js';
import * as armazenamento from './core/armazenamento.js';
import { executar } from './core/tarefas.js';
import { Visualizador } from './ui/visualizador.js';
import { ligarGestos } from './ui/gestos.js';
import { iniciarPaineis, criarMenuContexto, avisar, modoGaveta } from './ui/paineis.js';
import { ligarAtalhos } from './ui/atalhos.js';
import { renderizarModelo, renderizarAparelho, renderizarMemoria } from './ui/propriedades.js';

const $ = (id) => document.getElementById(id);

const estado = {
  capacidade: null,
  preferenciaLeve: 'auto',
  perfil: null,
  ondeSalva: '',
  malha: null, // malha completa (a única cópia)
  tela: null, // malha leve da tela, ou null quando a tela usa a própria malha
  caixa: null,
  ocupado: false,
  mostrarPintura: true,
  limiteDaTela: 0, // limite de triângulos usado para montar a tela atual
};

let visualizador;
let paineis;
let menu;

async function iniciar() {
  document.querySelectorAll('[data-versao]').forEach((el) => { el.textContent = VERSAO; });

  estado.capacidade = medirCapacidade();
  estado.preferenciaLeve = await armazenamento.ler('preferencias', 'modoLeve', 'auto');
  estado.ondeSalva = await armazenamento.onde();
  estado.mostrarPintura = await armazenamento.ler('preferencias', 'mostrarPintura', true);
  estado.perfil = perfilEmUso(estado.capacidade, estado.preferenciaLeve);
  document.documentElement.dataset.modoLeve = estado.perfil.modoLeve ? 'ligado' : 'desligado';

  visualizador = new Visualizador($('area-3d'), estado.perfil, {
    aoPerderContexto: () => avisar('A placa de vídeo pediu uma pausa. Se a peça sumir, recarregue a página.', 'aviso', 0),
  });

  paineis = iniciarPaineis();
  menu = criarMenuContexto(() => [
    { texto: 'Enquadrar a peça', acao: () => visualizador.enquadrar() },
    { texto: 'Vista de cima', acao: () => visualizador.enquadrar('cima') },
    { texto: 'Vista de frente', acao: () => visualizador.enquadrar('frente') },
    { texto: 'Vista de lado', acao: () => visualizador.enquadrar('lado') },
    { texto: 'Vista 3D', acao: () => visualizador.enquadrar('iso') },
    '-',
    { texto: estado.perfil.modoLeve ? 'Desligar o modo leve' : 'Ligar o modo leve', acao: () => mudarModoLeve(estado.perfil.modoLeve ? 'desligado' : 'ligado') },
    ...(temPintura() ? [{ texto: estado.mostrarPintura ? 'Esconder a pintura' : 'Mostrar a pintura', acao: () => mudarMostrarPintura(!estado.mostrarPintura) }] : []),
    { texto: 'Abrir modelo…', acao: escolherArquivo },
    ...(estado.malha ? [{ texto: 'Exportar 3MF', acao: exportar3mf }] : []),
  ]);

  ligarGestos(visualizador.renderer.domElement, {
    aoToque: () => {
      // A varinha mágica entra aqui na etapa 1.5. Por enquanto o toque só fecha gavetas.
      if (modoGaveta()) paineis.fechar();
    },
    aoSegurar: ({ x, y }) => menu.abrir(x, y),
  });

  ligarAtalhos({
    abrir: escolherArquivo,
    exportar: exportar3mf,
    enquadrar: () => visualizador.enquadrar(),
    vista: (v) => visualizador.enquadrar(v),
    pintura: () => { if (temPintura()) mudarMostrarPintura(!estado.mostrarPintura); },
  });

  ligarBotoes();
  ligarArrastarESoltar();
  atualizarPaineis();
  atualizarMedidor();
  setInterval(atualizarMedidor, 2000);

  if (estado.capacidade.avisarOutroAparelho) {
    const visto = await armazenamento.ler('preferencias', 'avisoAparelhoVisto', false);
    if (!visto) mostrarAvisoAparelho();
  }

  registrarServiceWorker();

  // Para os testes automáticos e para diagnóstico no console.
  window.__fatiador = { estado, visualizador, abrirArquivo, mudarModoLeve, exportar3mf, mudarMostrarPintura, trocarPintura, versao: VERSAO };
  document.documentElement.dataset.pronto = 'sim';
}

function ligarBotoes() {
  const entrada = $('entrada-arquivo');
  // No celular o filtro por extensão às vezes esconde o .3mf; lá deixamos sem filtro.
  if (!window.matchMedia('(pointer: coarse)').matches) entrada.accept = '.stl,.obj,.3mf';
  entrada.addEventListener('change', () => {
    const arquivo = entrada.files && entrada.files[0];
    entrada.value = '';
    if (arquivo) abrirArquivo(arquivo);
  });
  document.querySelectorAll('[data-acao]').forEach((b) => {
    b.addEventListener('click', () => {
      const acao = b.dataset.acao;
      if (acao === 'abrir') escolherArquivo();
      else if (acao === 'exportar') exportar3mf();
      else if (acao === 'enquadrar') visualizador.enquadrar();
      else if (acao.startsWith('vista-')) visualizador.enquadrar(acao.slice(6));
      if (modoGaveta() && b.closest('.painel')) paineis.fechar();
    });
  });
  $('painel-propriedades').addEventListener('click', (e) => {
    // só os botões: a própria página (<html data-modo-leve>) também tem esse atributo
    const b = e.target.closest('button[data-modo-leve]');
    if (b) mudarModoLeve(b.dataset.modoLeve);
  });
  $('painel-propriedades').addEventListener('change', (e) => {
    if (e.target.id === 'mostrar-pintura') {
      mudarMostrarPintura(e.target.checked);
      return;
    }
    const sel = e.target.closest('.seletor-filamento[data-objeto]');
    if (sel) mudarFilamento(Number(sel.dataset.objeto), Number(sel.dataset.parte), Number(sel.value));
  });
  $('painel-propriedades').addEventListener('click', (e) => {
    if (e.target.closest('#pintura-trocar')) {
      const onde = $('pintura-onde').value;
      trocarPintura({ de: Number($('pintura-de').value), para: Number($('pintura-para').value), parteIndice: onde === '' ? null : Number(onde) });
      return;
    }
    const apagar = e.target.closest('[data-apagar-pintura]');
    if (apagar) apagarPinturaDaParte(Number(apagar.dataset.apagarPintura));
  });
  $('chip-modo-leve').addEventListener('click', () => mudarModoLeve(estado.perfil.modoLeve ? 'desligado' : 'ligado'));
  $('medidor').addEventListener('click', () => {
    if (modoGaveta()) paineis.abrir('painel-propriedades');
    $('sec-memoria').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function escolherArquivo() {
  if (estado.ocupado) return;
  $('entrada-arquivo').click();
}

function ligarArrastarESoltar() {
  const area = document.body;
  let contador = 0;
  area.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    contador++;
    document.body.classList.add('soltando');
  });
  area.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault();
  });
  area.addEventListener('dragleave', () => {
    contador = Math.max(0, contador - 1);
    if (!contador) document.body.classList.remove('soltando');
  });
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    contador = 0;
    document.body.classList.remove('soltando');
    const arquivo = e.dataTransfer && e.dataTransfer.files[0];
    if (arquivo) abrirArquivo(arquivo);
  });
}

// --- abrir modelo -------------------------------------------------------------

async function abrirArquivo(arquivo) {
  if (estado.ocupado) {
    avisar('Espere o modelo atual terminar de abrir.', 'aviso');
    return;
  }
  const ext = extensao(arquivo.name);
  if (!FORMATOS.includes(ext)) {
    avisar(`O arquivo "${arquivo.name}" não é STL, OBJ nem 3MF.`, 'erro');
    return;
  }
  const est = await estimarAbertura(arquivo);
  let simplificarPara = null;
  if (est.picoMB > estado.perfil.orcamentoMB) {
    const escolha = await perguntarModeloGrande(arquivo, est);
    if (escolha === 'cancelar') return;
    if (escolha === 'simplificar') simplificarPara = alvoSimplificacao();
  }

  estado.ocupado = true;
  // Libera o modelo anterior ANTES de abrir o novo (no PC de 4 GB isso faz diferença).
  estado.malha = null;
  estado.tela = null;
  estado.caixa = null;
  visualizador.limpar();
  atualizarPaineis();
  mostrarProgresso('Abrindo…', 0);
  const t0 = performance.now();
  try {
    const r = await executar('abrir', {
      arquivo,
      limiteTela: estado.perfil.limiteTela,
      simplificarPara,
    }, [], mostrarProgresso);
    estado.malha = r.malha;
    estado.tela = r.tela;
    estado.caixa = r.caixa;
    estado.limiteDaTela = estado.perfil.limiteTela;
    visualizador.mostrar(telaParaMostrar(), r.caixa, aparencia());
    visualizador.enquadrar('iso');
    const s = ((performance.now() - t0) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    avisar(`${arquivo.name} aberto em ${s} s (${formatarTriangulos(r.malha.indices.length / 3)} triângulos).`);
    for (const a of r.malha.avisos) avisar(a, 'aviso', 8000);
    document.body.classList.add('com-modelo');
  } catch (erro) {
    console.error(erro);
    avisar(`Não consegui abrir "${arquivo.name}": ${erro.message}`, 'erro', 0);
  } finally {
    estado.ocupado = false;
    esconderProgresso();
    atualizarPaineis();
    atualizarMedidor();
  }
}

function alvoSimplificacao() {
  return estado.perfil.limiteTela * 2;
}

function perguntarModeloGrande(arquivo, est) {
  const dialogo = $('dialogo-grande');
  const alvo = alvoSimplificacao();
  $('dlg-texto').textContent = `"${arquivo.name}" tem cerca de ${formatarTriangulos(est.triangulos)} triângulos e deve usar uns ${formatarMB(est.picoMB)} para abrir. Neste aparelho o seguro é até ${formatarMB(estado.perfil.orcamentoMB)}.`;
  $('dlg-sugestao').textContent = est.triangulos > alvo
    ? `Sugestão: simplificar para ${formatarTriangulos(alvo)} triângulos ao abrir. A forma quase não muda e tudo fica mais rápido.`
    : 'Feche outros programas (como o Bambu Studio) e abas antes de abrir.';
  $('dlg-simplificar').hidden = est.triangulos <= alvo;
  $('dlg-outro-aparelho').hidden = !estado.capacidade.avisarOutroAparelho;
  return new Promise((resolver) => {
    const responder = (valor) => {
      dialogo.close();
      resolver(valor);
    };
    $('dlg-simplificar').onclick = () => responder('simplificar');
    $('dlg-completo').onclick = () => responder('completo');
    $('dlg-cancelar').onclick = () => responder('cancelar');
    dialogo.oncancel = (e) => { e.preventDefault(); responder('cancelar'); };
    dialogo.showModal();
  });
}

function mostrarProgresso(fase, fracao) {
  const el = $('progresso');
  el.hidden = false;
  $('progresso-texto').textContent = fase;
  $('progresso-barra').style.width = `${Math.round((fracao || 0) * 100)}%`;
}

function esconderProgresso() {
  $('progresso').hidden = true;
}

// --- modo leve ----------------------------------------------------------------

async function mudarModoLeve(preferencia) {
  if (estado.ocupado) return;
  estado.ocupado = true;
  try {
    estado.preferenciaLeve = preferencia;
    estado.perfil = perfilEmUso(estado.capacidade, preferencia);
    document.documentElement.dataset.modoLeve = estado.perfil.modoLeve ? 'ligado' : 'desligado';
    try {
      await armazenamento.gravar('preferencias', 'modoLeve', preferencia);
    } catch (e) {
      console.warn('Não salvou a preferência do modo leve', e);
    }
    visualizador.aplicarPerfil(estado.perfil);
    await refazerTelaSePreciso();
  } finally {
    estado.ocupado = false;
    atualizarPaineis();
    atualizarMedidor();
  }
}

/** Com outro limite de triângulos, a malha leve da tela é refeita a partir da completa. */
async function refazerTelaSePreciso() {
  const m = estado.malha;
  if (!m) return;
  const tri = m.indices.length / 3;
  const limite = estado.perfil.limiteTela;
  const naTela = estado.tela ? estado.tela.indices.length / 3 : tri;
  // com pintura a tela é sempre montada no worker (por cor); refaz se o limite mudou
  const precisa = m.pinturaCor
    ? estado.limiteDaTela !== limite
    : (tri <= limite ? !!estado.tela : (naTela > limite * 1.15 || naTela < Math.min(tri, limite) * 0.6));
  if (!precisa) return;
  if (tri <= limite && !m.pinturaCor) {
    estado.tela = null;
    visualizador.mostrar(m, estado.caixa, aparencia());
    return;
  }
  mostrarProgresso('Refazendo a malha leve…', 0);
  try {
    // A malha vai emprestada ao worker (transferida, sem cópia) e volta junto com a tela.
    estado.malha = null;
    const r = await executar('tela', { malha: m, limiteTela: limite }, transferiveis(m), mostrarProgresso);
    estado.malha = r.malha;
    estado.tela = r.tela;
    estado.limiteDaTela = limite;
    visualizador.mostrar(telaParaMostrar(), estado.caixa, aparencia());
  } catch (erro) {
    avisar(`Não consegui refazer a malha da tela: ${erro.message}. Abra o modelo de novo.`, 'erro', 0);
    visualizador.limpar();
  } finally {
    esconderProgresso();
  }
}

// --- filamentos e exportação ----------------------------------------------------

/**
 * Cores na tela: cada faixa (da malha leve ou da completa) é uma parte, ou, com
 * pintura, uma parte numa cor da pintura (estado 0 = cor da parte).
 */
function aparencia() {
  const m = estado.malha;
  if (!m) return null;
  const partes = aparenciaDasPartes(m);
  const faixas = estado.tela && estado.tela.faixas ? estado.tela.faixas : faixasDasPartes(m);
  const de = (f, k) => {
    const base = partes[f.parte ?? k] || partes[0];
    if (f.estado > 0 && estado.mostrarPintura) return { ...base, cor: corDoFilamento(m, f.estado) };
    return base;
  };
  const det = estado.tela && estado.tela.detalhe;
  return {
    faixas,
    partes: faixas.map(de),
    detalhe: det ? { faixas: det.faixas, partes: det.faixas.map(de) } : null,
  };
}

/** O que vai para a tela: a malha leve, ou a completa (a tela com pintura pode usar as posições dela). */
function telaParaMostrar() {
  const m = estado.malha, t = estado.tela;
  if (!t) return m;
  return { posicoes: t.posicoes || m.posicoes, indices: t.indices, detalhe: t.detalhe || null };
}

function temPintura() {
  return !!(estado.malha && estado.malha.pinturaCor && estado.malha.pinturaCor.resumo && estado.malha.pinturaCor.resumo.estados.length);
}

function recolorir() {
  const a = aparencia();
  if (a) visualizador.colorir(a.faixas, a.partes, a.detalhe);
}

async function mudarMostrarPintura(mostrar) {
  estado.mostrarPintura = !!mostrar;
  recolorir();
  atualizarPaineis();
  try {
    await armazenamento.gravar('preferencias', 'mostrarPintura', estado.mostrarPintura);
  } catch (e) {
    console.warn('Não salvou a preferência da pintura', e);
  }
}

/**
 * Troca uma cor da pintura por outra (para = 0 tira a pintura dessa cor), numa
 * parte ou no modelo todo. Nesta etapa é uma troca direta; entra no histórico na 1.4.
 */
function trocarPintura({ de, para, parteIndice = null }) {
  const m = estado.malha;
  if (!m || !m.pinturaCor || estado.ocupado) return 0;
  if (de !== 'todas' && de === para) {
    avisar('Escolha uma cor diferente para trocar.', 'aviso');
    return 0;
  }
  let n;
  try {
    n = trocarCorDaPintura(m, { de, para, parteIndice });
  } catch (erro) {
    avisar(erro.message, 'erro');
    return 0;
  }
  trocarCorNaTela(estado.tela, { de, para, parteIndice });
  recolorir();
  atualizarPaineis();
  atualizarMedidor();
  const onde = parteIndice == null ? 'no modelo todo' : `em ${nomeDaParte(parteIndice)}`;
  if (de === 'todas') avisar(`Pintura apagada ${onde} (${n.toLocaleString('pt-BR')} triângulos).`, 'ok');
  else if (!n) avisar(`A cor ${de} não aparece ${onde}.`, 'aviso');
  else {
    const para2 = para === 0 ? 'sem pintura' : `filamento ${rotuloFilamento(m, para)}`;
    avisar(`Cor ${rotuloFilamento(m, de)} trocada por ${para2} ${onde} (${n.toLocaleString('pt-BR')} triângulos).`, 'ok');
  }
  return n;
}

function nomeDaParte(k) {
  const item = todasAsPartes(estado.malha)[k];
  if (!item) return 'parte';
  return item.objeto.partes.length > 1 ? `"${item.objeto.nome} › ${item.parte.nome}"` : `"${item.objeto.nome}"`;
}

async function apagarPinturaDaParte(k) {
  if (!estado.malha || estado.ocupado) return;
  const ok = await confirmar(`Apagar toda a pintura de ${nomeDaParte(k)}? Ainda não dá para desfazer (o desfazer chega na próxima etapa).`, 'Apagar pintura');
  if (ok) trocarPintura({ de: 'todas', parteIndice: k });
}

function confirmar(texto, botao) {
  const dialogo = $('dialogo-confirmar');
  $('confirmar-texto').textContent = texto;
  $('confirmar-sim').textContent = botao;
  return new Promise((resolver) => {
    const responder = (v) => { dialogo.close(); resolver(v); };
    $('confirmar-sim').onclick = () => responder(true);
    $('confirmar-nao').onclick = () => responder(false);
    dialogo.oncancel = (e) => { e.preventDefault(); responder(false); };
    dialogo.showModal();
  });
}

function mudarFilamento(io, ip, n) {
  if (!estado.malha || estado.ocupado) return;
  try {
    trocarFilamento(estado.malha, io, ip, n);
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
  recolorir();
  atualizarPaineis();
}

/** Nome do arquivo exportado: "boneco.3mf" vira "boneco_fatiador.3mf". */
export function nomeExportado(nome) {
  const base = String(nome || 'modelo').replace(/\.[a-z0-9]+$/i, '').replace(/_fatiador$/i, '');
  return `${base}_fatiador.3mf`;
}

async function exportar3mf() {
  if (!estado.malha) {
    avisar('Abra um modelo antes de exportar.', 'aviso');
    return;
  }
  if (estado.ocupado) {
    avisar('Espere terminar o que está em andamento.', 'aviso');
    return;
  }
  estado.ocupado = true;
  atualizarBotoes();
  const m = estado.malha;
  const nome = nomeExportado(m.nome);
  mostrarProgresso('Preparando o 3MF…', 0);
  const t0 = performance.now();
  let miniatura = null;
  const temMiniatura = m.arquivo3mf && m.arquivo3mf.extras.some((e) => e.caminho === 'Metadata/plate_1.png');
  if (!temMiniatura) {
    try {
      miniatura = await visualizador.capturarMiniatura(512);
    } catch (e) {
      console.warn('Sem miniatura:', e);
    }
  }
  // A malha vai emprestada ao worker (transferida, sem cópia) e volta junto com o arquivo.
  estado.malha = null;
  try {
    const r = await executar('exportar', { malha: m, miniatura }, transferiveis(m), mostrarProgresso);
    estado.malha = r.malha;
    // Sem malha leve, a tela usava os próprios dados da malha: mostra de novo.
    if (!estado.tela || !estado.tela.posicoes) visualizador.mostrar(telaParaMostrar(), estado.caixa, aparencia());
    if (r.erro) throw new Error(r.erro);
    baixar(r.arquivo, nome);
    estado.ultimaExportacao = { nome, bytes: r.arquivo.size, info: r.info };
    const seg = (performance.now() - t0) / 1000;
    const tamanho = r.arquivo.size < MB
      ? `${Math.max(1, Math.round(r.arquivo.size / 1024)).toLocaleString('pt-BR')} KB`
      : formatarMB(r.arquivo.size / MB);
    const tempo = seg >= 1 ? `, ${seg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : '';
    avisar(`Pronto: ${nome} (${tamanho}${tempo}). Abra no Bambu Studio.`, 'ok', 8000);
  } catch (erro) {
    console.error(erro);
    avisar(`Não consegui exportar: ${erro.message}`, 'erro', 0);
    if (!estado.malha) {
      avisar('O modelo se perdeu no processo. Abra o arquivo de novo.', 'erro', 0);
      visualizador.limpar();
      estado.tela = null;
    }
  } finally {
    estado.ocupado = false;
    esconderProgresso();
    atualizarPaineis();
    atualizarMedidor();
  }
}

function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function atualizarBotoes() {
  const pode = !!estado.malha && !estado.ocupado;
  document.querySelectorAll('[data-acao="exportar"]').forEach((b) => { b.disabled = !pode; });
}

// --- painéis e medidor --------------------------------------------------------

function atualizarPaineis() {
  renderizarModelo($('conteudo-modelo'), estado);
  renderizarAparelho($('conteudo-aparelho'), estado);
  const chip = $('chip-modo-leve');
  chip.textContent = estado.perfil.modoLeve ? 'Modo leve' : 'Completo';
  chip.setAttribute('aria-pressed', String(estado.perfil.modoLeve));
  chip.title = estado.perfil.modoLeve
    ? 'Modo leve ligado: menos detalhe na tela, sem sombras. Toque para desligar.'
    : 'Modo leve desligado. Toque para ligar.';
  document.body.classList.toggle('com-modelo', !!estado.malha);
  atualizarBotoes();
}

function atualizarMedidor() {
  const uso = usoAtual(bytesDaMalha(estado.malha), bytesDaMalha(estado.tela) + (visualizador.bytesCopia || 0));
  // Os typed arrays da malha ficam fora do "heap" do JavaScript: somamos à parte.
  const usado = (uso.heapMB || 0) + uso.modeloMB + uso.telaMB;
  const fracao = usado / estado.perfil.orcamentoMB;
  const medidor = $('medidor');
  medidor.querySelector('.texto').textContent = formatarMB(usado);
  medidor.querySelector('.barra > span').style.width = `${Math.min(100, Math.round(fracao * 100))}%`;
  medidor.dataset.nivel = fracao < 0.5 ? 'ok' : fracao < 0.8 ? 'atencao' : 'perigo';
  medidor.title = `Memória em uso: ${formatarMB(usado)} de ${formatarMB(estado.perfil.orcamentoMB)} seguros neste aparelho`;
  medidor.setAttribute('aria-label', medidor.title);
  renderizarMemoria($('conteudo-memoria'), uso, estado.perfil);
}

function mostrarAvisoAparelho() {
  const el = avisar(
    'Este aparelho parece fraco para modelos grandes. Dá para usar, mas as operações pesadas vão melhor em outro aparelho.',
    'aviso',
    0,
  );
  el.querySelector('.fechar-aviso').addEventListener('click', () => {
    armazenamento.gravar('preferencias', 'avisoAparelhoVisto', true).catch(() => {});
  });
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker não registrado:', e));
}

iniciar().catch((erro) => {
  console.error(erro);
  const el = document.getElementById('erro-inicio');
  if (el) {
    el.hidden = false;
    el.textContent = `O app não conseguiu iniciar: ${erro.message}`;
  }
});
