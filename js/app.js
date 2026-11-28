// Ponto de partida do Fatiador L.Y.K.E 3D.

import { VERSAO } from './config.js';
import { medirCapacidade, perfilEmUso } from './core/capacidade.js';
import { estimarAbertura, usoAtual, formatarMB, formatarTriangulos, extensao, FORMATOS, MB } from './core/memoria.js';
import { bytesDaMalha, transferiveis } from './core/malha.js';
import { aparenciaDasPartes, faixasDasPartes, corDoFilamento, todasAsPartes, rotuloFilamento, filamentoDaParte } from './core/projeto.js';
import * as armazenamento from './core/armazenamento.js';
import { Historico } from './core/historico.js';
import { operacao } from './ops/index.js';
import * as projetos from './core/projetos.js';
import { gravarPacote } from './core/pacote.js';
import { renderizarHistorico, lerEditor } from './ui/painel-historico.js';
import { renderizarProjetos } from './ui/dialogo-projetos.js';
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
  versaoTela: 0, // muda sempre que a malha da tela é refeita
  historico: null, // receitas das operações (js/core/historico.js)
  arquivoBase: null, // o arquivo original (File/Blob, fica no disco, não na memória)
  projeto: null, // registro do projeto (js/core/projetos.js)
  guardandoBase: Promise.resolve(), // gravação do original no navegador
  editando: null, // passo do histórico sendo editado
  salvoEm: null,
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
  // Voltas rápidas do desfazer: limite de memória menor no modo leve.
  estado.historico = new Historico(estado.perfil.modoLeve
    ? { orcamentoVolta: 16 * MB, orcamentoSelecao: 16 * MB, maxSelecoes: 40 }
    : { orcamentoVolta: 96 * MB, orcamentoSelecao: 64 * MB, maxSelecoes: 100 });

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
    ...(estado.historico.podeDesfazer ? [{ texto: 'Desfazer', acao: desfazer }] : []),
    ...(estado.historico.podeRefazer ? [{ texto: 'Refazer', acao: refazer }] : []),
    { texto: estado.perfil.modoLeve ? 'Desligar o modo leve' : 'Ligar o modo leve', acao: () => mudarModoLeve(estado.perfil.modoLeve ? 'desligado' : 'ligado') },
    ...(temPintura() ? [{ texto: estado.mostrarPintura ? 'Esconder a pintura' : 'Mostrar a pintura', acao: () => mudarMostrarPintura(!estado.mostrarPintura) }] : []),
    { texto: 'Abrir modelo…', acao: escolherArquivo },
    ...(estado.malha ? [{ texto: 'Exportar 3MF', acao: exportar3mf }, { texto: 'Salvar projeto', acao: salvarProjetoAgora }] : []),
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
    desfazer,
    refazer,
    salvar: salvarProjetoAgora,
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
  window.__fatiador = {
    estado, visualizador, abrirArquivo, mudarModoLeve, exportar3mf, mudarMostrarPintura, trocarPintura,
    mudarFilamento, desfazer, refazer, irPara, salvarAgora, versao: VERSAO,
  };
  document.documentElement.dataset.pronto = 'sim';

  // Pontos de restauração só valem enquanto o app está aberto.
  projetos.apagarTodosOsPontos().catch(() => {});
  await oferecerContinuar();
}

function ligarBotoes() {
  const entrada = $('entrada-arquivo');
  // No celular o filtro por extensão às vezes esconde o .3mf; lá deixamos sem filtro.
  if (!window.matchMedia('(pointer: coarse)').matches) entrada.accept = '.stl,.obj,.3mf,.lyke';
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
      else if (acao === 'desfazer') desfazer();
      else if (acao === 'refazer') refazer();
      else if (acao === 'salvar-projeto') salvarProjetoAgora();
      else if (acao === 'projetos') abrirListaProjetos();
      else if (acao === 'baixar-projeto') baixarProjetoAtual();
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
  ligarHistorico();
  ligarProjetos();
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
  if (!FORMATOS.includes(ext) && ext !== 'lyke') {
    avisar(`O arquivo "${arquivo.name}" não é STL, OBJ, 3MF nem projeto .lyke.`, 'erro');
    return;
  }
  let simplificarPara = null;
  if (ext !== 'lyke') {
    const est = await estimarAbertura(arquivo);
    if (est.picoMB > estado.perfil.orcamentoMB) {
      const escolha = await perguntarModeloGrande(arquivo, est);
      if (escolha === 'cancelar') return;
      if (escolha === 'simplificar') simplificarPara = alvoSimplificacao();
    }
  }
  await guardarTrabalhoAnterior();
  const t0 = performance.now();
  const r = await carregar({ arquivo, simplificarPara, novo: true, texto: ext === 'lyke' ? 'Abrindo o projeto…' : 'Abrindo…' });
  if (!r) return;
  const s = ((performance.now() - t0) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  estado.historico.limpar();
  estado.editando = null;
  if (r.projeto) {
    // projeto .lyke: o worker já refez as receitas
    const modelo = r.modelo;
    estado.arquivoBase = modelo;
    estado.historico.carregar(r.projeto);
    estado.historico.depoisDeReabrir(estado.historico.receitasAte().passos, r);
    estado.projeto = {
      ...projetos.novoRegistro({ nome: r.projeto.nome, base: { nome: modelo.name, tamanho: modelo.size, simplificarPara: r.projeto.base && r.projeto.base.simplificarPara } }),
      selecoes: r.projeto.selecoes || [],
      selecaoAtual: r.projeto.selecaoAtual || null,
      criado: r.projeto.criado || Date.now(),
    };
    guardarBase(modelo); // (a vista do outro aparelho não serve aqui: a peça é enquadrada)
    avisarFalhas(r.falhas);
    avisar(`Projeto "${r.projeto.nome}" aberto em ${s} s (${estado.historico.passos.length} passos).`, 'ok');
    // um .lyke aberto aqui vira projeto salvo neste navegador
    estado.guardandoBase.then(() => salvarProjetoAgora({ silencioso: true }));
  } else {
    estado.arquivoBase = arquivo;
    estado.projeto = projetos.novoRegistro({
      nome: projetos.nomeDoArquivo(arquivo.name),
      base: { nome: arquivo.name, tamanho: arquivo.size, simplificarPara },
      versaoApp: VERSAO,
    });
    guardarBase(arquivo);
    avisar(`${arquivo.name} aberto em ${s} s (${formatarTriangulos(r.malha.indices.length / 3)} triângulos).`);
    for (const a of r.malha.avisos) avisar(a, 'aviso', 8000);
  }
  document.body.classList.add('com-modelo');
  depoisDeMudar();
}

/**
 * Abre um arquivo no worker (com receitas, se vierem) e põe na tela.
 *   novo = modelo novo (limpa a tela e enquadra); senão é o histórico refazendo
 *   (a câmera fica onde está).
 * Devolve a resposta do worker, ou null se deu erro.
 */
async function carregar({ arquivo, simplificarPara = null, receitas = null, ponto = null, guardarVolta = false, novo = true, texto = 'Abrindo…' }) {
  estado.ocupado = true;
  // Libera o modelo anterior ANTES de abrir o novo (no PC de 4 GB isso faz diferença).
  estado.malha = null;
  estado.tela = null;
  if (novo) {
    estado.caixa = null;
    visualizador.limpar();
  }
  atualizarPaineis();
  mostrarProgresso(texto, 0);
  try {
    const r = await executar('abrir', {
      arquivo,
      limiteTela: estado.perfil.limiteTela,
      simplificarPara,
      receitas,
      ponto,
      guardarVolta,
    }, [], mostrarProgresso);
    estado.malha = r.malha;
    estado.tela = r.tela;
    estado.caixa = r.caixa;
    estado.limiteDaTela = estado.perfil.limiteTela;
    estado.versaoTela++;
    visualizador.mostrar(telaParaMostrar(), r.caixa, aparencia());
    if (novo) visualizador.enquadrar('iso');
    return r;
  } catch (erro) {
    console.error(erro);
    if (novo) avisar(`Não consegui abrir "${arquivo.name}": ${erro.message}`, 'erro', 0);
    else {
      avisar(`Não consegui refazer os passos: ${erro.message}. Abra o modelo ou o projeto de novo.`, 'erro', 0);
      visualizador.limpar();
    }
    return null;
  } finally {
    estado.ocupado = false;
    esconderProgresso();
    atualizarPaineis();
    atualizarMedidor();
  }
}

function avisarFalhas(falhas) {
  for (const f of falhas || []) avisar(`Um passo do histórico não deu certo e foi pulado: ${f.mensagem}`, 'aviso', 8000);
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

/**
 * Com outro limite de triângulos, a malha leve da tela é refeita a partir da completa.
 * forcar: refaz de qualquer jeito (o desfazer da pintura sem os estados da tela guardados).
 */
async function refazerTelaSePreciso(forcar = false) {
  const m = estado.malha;
  if (!m) return;
  const tri = m.indices.length / 3;
  const limite = estado.perfil.limiteTela;
  const naTela = estado.tela ? estado.tela.indices.length / 3 : tri;
  // com pintura a tela é sempre montada no worker (por cor); refaz se o limite mudou
  const precisa = forcar || (m.pinturaCor
    ? estado.limiteDaTela !== limite
    : (tri <= limite ? !!estado.tela : (naTela > limite * 1.15 || naTela < Math.min(tri, limite) * 0.6)));
  if (!precisa) return;
  if (tri <= limite && !m.pinturaCor) {
    estado.tela = null;
    estado.versaoTela++;
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
    estado.versaoTela++;
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
 * parte ou no modelo todo. Entra no histórico (dá para desfazer e editar).
 */
function trocarPintura({ de, para, parteIndice = null }) {
  const m = estado.malha;
  if (!m || !m.pinturaCor || estado.ocupado) return 0;
  if (de !== 'todas' && de === para) {
    avisar('Escolha uma cor diferente para trocar.', 'aviso');
    return 0;
  }
  const onde = parteIndice == null ? 'no modelo todo' : `em ${nomeDaParte(parteIndice)}`;
  const resumo = m.pinturaCor.resumo;
  const partesR = parteIndice == null ? resumo.partes : [resumo.partes[parteIndice]];
  const tem = de === 'todas' ? partesR.some((p) => p && p.pintada) : partesR.some((p) => p && p.areas[de] > 0);
  if (!tem) {
    avisar(de === 'todas' ? `Não há pintura ${onde}.` : `A cor ${de} não aparece ${onde}.`, 'aviso');
    return 0;
  }
  let r;
  try {
    r = aplicarOperacao('pintura-trocar', { de, para, parteIndice, nome: parteIndice == null ? null : nomeDaParte(parteIndice).replace(/"/g, '') });
  } catch (erro) {
    avisar(erro.message, 'erro');
    return 0;
  }
  const n = r.mudaram;
  if (de === 'todas') avisar(`Pintura apagada ${onde} (${n.toLocaleString('pt-BR')} triângulos). Ctrl+Z desfaz.`, 'ok');
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
  const ok = await confirmar(`Apagar toda a pintura de ${nomeDaParte(k)}? Dá para desfazer depois (Ctrl+Z ou o Histórico).`, 'Apagar pintura');
  if (ok) trocarPintura({ de: 'todas', parteIndice: k });
}

function confirmar(texto, botao, { titulo = 'Confirmar', nao = 'Cancelar' } = {}) {
  const dialogo = $('dialogo-confirmar');
  $('confirmar-titulo').textContent = titulo;
  $('confirmar-texto').textContent = texto;
  $('confirmar-sim').textContent = botao;
  $('confirmar-nao').textContent = nao;
  return new Promise((resolver) => {
    const responder = (v) => { dialogo.close(); resolver(v); };
    $('confirmar-sim').onclick = () => responder(true);
    $('confirmar-nao').onclick = () => responder(false);
    dialogo.oncancel = (e) => { e.preventDefault(); responder(false); };
    dialogo.showModal();
  });
}

function mudarFilamento(io, ip, n) {
  const m = estado.malha;
  if (!m || estado.ocupado) return;
  const o = m.objetos[io];
  const p = o && o.partes[ip];
  if (!p) return;
  const de = filamentoDaParte(p, o);
  if (de === n) return;
  const nome = o.partes.length > 1 ? `${o.nome} › ${p.nome}` : o.nome;
  try {
    aplicarOperacao('filamento', { objeto: io, parte: ip, filamento: n, de, nome });
  } catch (erro) {
    avisar(erro.message, 'erro');
    atualizarPaineis();
  }
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
  const nome = nomeSeguro(nomeExportado(m.nome));
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

/**
 * Nome de arquivo sem acento nem caractere especial: alguns Chrome trocam um nome
 * com "ê" por "download" (e o arquivo perde a extensão).
 */
export function nomeSeguro(nome) {
  return String(nome || 'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_(?=\.)/g, '') || 'arquivo';
}

function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeSeguro(nome);
  a.hidden = true;
  // com uma janela aberta, o resto da página fica "inerte": o link vai dentro dela
  (document.querySelector('dialog[open]') || document.body).append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function atualizarBotoes() {
  const pode = !!estado.malha && !estado.ocupado;
  const h = estado.historico;
  const liga = (acao, sim) => document.querySelectorAll(`[data-acao="${acao}"]`).forEach((b) => { b.disabled = !sim; });
  liga('exportar', pode);
  liga('salvar-projeto', pode);
  liga('baixar-projeto', pode);
  liga('desfazer', pode && h.podeDesfazer);
  liga('refazer', pode && h.podeRefazer);
  const ultimo = h.passos[h.posicao - 1];
  const proximo = h.passos[h.posicao];
  document.querySelectorAll('[data-acao="desfazer"]').forEach((b) => { b.title = ultimo ? `Desfazer: ${ultimo.rotulo} (Ctrl+Z)` : 'Desfazer (Ctrl+Z)'; });
  document.querySelectorAll('[data-acao="refazer"]').forEach((b) => { b.title = proximo ? `Refazer: ${proximo.rotulo} (Ctrl+Y)` : 'Refazer (Ctrl+Y)'; });
}

// --- histórico ----------------------------------------------------------------

/** Aplica uma operação nova (entra no histórico) e atualiza a tela. */
function aplicarOperacao(tipo, params) {
  const antes = fotoDaTela();
  const { passo, resultado } = estado.historico.aplicarNovo(estado.malha, tipo, params);
  passo.telaAntes = antes;
  const op = operacao(tipo);
  if (op.naTela && estado.tela) op.naTela(estado.tela, params);
  estado.editando = null;
  recolorir();
  depoisDeMudar();
  return resultado;
}

/** Cores (estados) das faixas da tela: guardadas para o desfazer não refazer a tela. */
function fotoDaTela() {
  const t = estado.tela;
  if (!t || !t.faixas) return null;
  return {
    versao: estado.versaoTela,
    faixas: t.faixas.map((f) => f.estado),
    detalhe: t.detalhe ? t.detalhe.faixas.map((f) => f.estado) : null,
  };
}

function restaurarTela(foto) {
  const t = estado.tela;
  if (!foto || !t || foto.versao !== estado.versaoTela || !t.faixas || t.faixas.length !== foto.faixas.length) return false;
  t.faixas.forEach((f, i) => { f.estado = foto.faixas[i]; });
  if (t.detalhe && foto.detalhe && t.detalhe.faixas.length === foto.detalhe.length) {
    t.detalhe.faixas.forEach((f, i) => { f.estado = foto.detalhe[i]; });
  }
  return true;
}

function desfazer() {
  if (estado.historico.podeDesfazer) return irPara(estado.historico.posicao - 1);
  return null;
}

function refazer() {
  if (estado.historico.podeRefazer) return irPara(estado.historico.posicao + 1);
  return null;
}

/** Leva o modelo (e a seleção) até a posição "alvo" do histórico. */
async function irPara(alvo) {
  const h = estado.historico;
  if (!estado.malha || estado.ocupado || alvo === h.posicao) return;
  const plano = h.plano(alvo);
  if (plano.reabrir) {
    if (!(await reabrirAte(plano.alvo))) return;
  } else {
    let refazerATela = false;
    for (const { passo, acao } of plano.passos) {
      const op = operacao(passo.tipo);
      try {
        if (acao === 'desfazer') {
          op.desfazer(estado.malha, passo.params, passo.volta);
          if (op.naTela && estado.tela && !restaurarTela(passo.telaAntes)) refazerATela = true;
          passo.volta = null; // no "refazer" a receita é aplicada de novo
          passo.voltaBytes = 0;
        } else {
          const antes = fotoDaTela();
          const r = op.aplicar(estado.malha, passo.params, { guardarVolta: true });
          passo.volta = r.volta || null;
          passo.voltaBytes = r.volta ? r.voltaBytes || 0 : 0;
          passo.telaAntes = antes;
          passo.erro = null;
          if (op.naTela && estado.tela) op.naTela(estado.tela, passo.params);
        }
      } catch (erro) {
        passo.erro = erro.message;
        avisar(`O passo "${passo.rotulo}" não deu certo: ${erro.message}`, 'aviso', 8000);
      }
    }
    if (refazerATela) await refazerTelaSePreciso(true);
  }
  h.irPara(plano.alvo);
  recolorir();
  depoisDeMudar();
}

/** Reabre o original (ou o ponto de restauração) e refaz as receitas até "alvo". */
async function reabrirAte(alvo) {
  if (!estado.arquivoBase) {
    avisar('O arquivo original não está mais disponível. Abra o modelo de novo.', 'erro', 0);
    return false;
  }
  const h = estado.historico;
  const { ponto, receitas, passos } = h.receitasAte(alvo);
  const r = await carregar({
    arquivo: estado.arquivoBase,
    simplificarPara: estado.projeto && estado.projeto.base.simplificarPara,
    receitas,
    ponto,
    guardarVolta: true,
    novo: false,
    texto: 'Refazendo os passos…',
  });
  if (!r) return false;
  h.depoisDeReabrir(passos, r);
  avisarFalhas(r.falhas);
  return true;
}

function ligarHistorico() {
  const el = $('conteudo-historico');
  el.addEventListener('click', async (e) => {
    const editar = e.target.closest('[data-editar-passo]');
    if (editar) {
      const i = Number(editar.dataset.editarPasso);
      estado.editando = estado.editando === i ? null : i;
      renderizarHistorico(el, estado);
      return;
    }
    if (e.target.closest('[data-cancelar-edicao]')) {
      estado.editando = null;
      renderizarHistorico(el, estado);
      return;
    }
    if (e.target.closest('[data-aplicar-edicao]')) {
      await aplicarEdicao(e.target.closest('.editor-passo'));
      return;
    }
    const apagar = e.target.closest('[data-apagar-passo]');
    if (apagar) {
      await apagarPasso(Number(apagar.dataset.apagarPasso));
      return;
    }
    const ir = e.target.closest('[data-ir]');
    if (ir) {
      await irPara(Number(ir.dataset.ir));
      if (modoGaveta() && window.matchMedia('(max-width: 699px)').matches) paineis.fechar();
    }
  });
}

async function aplicarEdicao(form) {
  const h = estado.historico;
  const i = estado.editando;
  const passo = h.passos[i];
  if (!passo || estado.ocupado) return;
  const params = lerEditor(form, passo);
  const pontos = h.editar(i, params);
  projetos.apagarPontos(pontos).catch(() => {});
  estado.editando = null;
  if (i < h.posicao) {
    // o modelo é refeito pelas receitas, já com o passo editado
    if (await reabrirAte(h.posicao)) avisar(`Passo ${i + 1} editado: ${passo.rotulo}.`, 'ok');
  }
  depoisDeMudar();
}

async function apagarPasso(i) {
  const h = estado.historico;
  const passo = h.passos[i];
  if (!passo || estado.ocupado) return;
  const noModelo = passo.tipo !== 'selecao' && i < h.posicao;
  if (noModelo) {
    const ok = await confirmar(`Apagar o passo ${i + 1} ("${passo.rotulo}")? O app refaz os passos seguintes sem ele.`, 'Apagar passo');
    if (!ok) return;
  }
  const r = h.apagar(i);
  projetos.apagarPontos(r.pontos).catch(() => {});
  if (estado.editando != null) estado.editando = null;
  if (noModelo) await reabrirAte(h.posicao);
  depoisDeMudar();
}

/** Depois de qualquer mudança: painéis, botões e salvamento automático. */
function depoisDeMudar() {
  atualizarPaineis();
  atualizarMedidor();
  agendarSalvamento();
}

// --- projetos e salvamento automático -------------------------------------------

let timerSalvar = 0;
let avisouFalhaSalvar = false;

function agendarSalvamento() {
  if (!estado.projeto || !estado.malha) return;
  clearTimeout(timerSalvar);
  timerSalvar = setTimeout(() => { salvarAgora(); }, 700);
}

/** O registro do projeto como está agora (receitas, seleções, vista). */
function montarRegistro() {
  return {
    ...estado.projeto,
    ...estado.historico.paraSalvar(),
    vista: visualizador.vista(),
    versaoApp: VERSAO,
    base: { ...estado.projeto.base },
  };
}

/** Grava o rascunho (e o projeto, se ele já tem nome). */
async function salvarAgora() {
  clearTimeout(timerSalvar);
  if (!estado.projeto || !estado.malha) return false;
  try {
    await estado.guardandoBase;
    if (!estado.projeto.base.chaveArquivo) return false;
    const r = montarRegistro();
    await projetos.gravarRascunho(r);
    if (r.id) await projetos.salvarProjeto(r);
    estado.salvoEm = Date.now();
    renderizarHistorico($('conteudo-historico'), estado);
    return true;
  } catch (erro) {
    console.warn('Não salvou o trabalho', erro);
    if (!avisouFalhaSalvar) {
      avisouFalhaSalvar = true;
      avisar('Não deu para guardar o trabalho no navegador (pode estar sem espaço). O desfazer continua funcionando.', 'aviso', 8000);
    }
    return false;
  }
}

/** Guarda o arquivo original no navegador (para reabrir o projeto depois). */
function guardarBase(arquivo) {
  const projeto = estado.projeto;
  estado.guardandoBase = projetos.guardarArquivo(arquivo)
    .then((chave) => {
      projeto.base.chaveArquivo = chave;
      return projetos.gravarRascunho({ ...projeto, ...estado.historico.paraSalvar() });
    })
    .then(() => projetos.limparArquivos())
    .catch((erro) => {
      console.warn('Não guardou o original', erro);
      avisar('Não deu para guardar o original no navegador (pode estar sem espaço). O desfazer funciona, mas o projeto não fica salvo.', 'aviso', 8000);
    });
  return estado.guardandoBase;
}

/** Antes de abrir outro modelo: trabalho sem nome com passos vira um projeto "não salvo". */
async function guardarTrabalhoAnterior() {
  if (!estado.projeto || !estado.malha) return;
  try {
    await salvarAgora();
    if (!estado.projeto.id && estado.historico.numModelo > 0 && estado.projeto.base.chaveArquivo) {
      await projetos.guardarAutomatico(montarRegistro());
      avisar(`O trabalho em "${estado.projeto.nome}" ficou em Projetos salvos (não salvo).`, 'info', 6000);
    }
  } catch (erro) {
    console.warn('Não guardou o trabalho anterior', erro);
  }
}

async function salvarProjetoAgora({ silencioso = false } = {}) {
  if (!estado.malha || !estado.projeto || estado.ocupado) return false;
  if (!estado.projeto.id && !silencioso) {
    const nome = await perguntarNome(estado.projeto.nome);
    if (!nome) return false;
    estado.projeto.nome = nome;
  }
  await estado.guardandoBase;
  if (!estado.projeto.base.chaveArquivo) {
    avisar('O original não ficou guardado no navegador; use "Baixar projeto (.lyke)".', 'erro', 8000);
    return false;
  }
  try {
    const salvo = await projetos.salvarProjeto({ ...montarRegistro(), auto: false });
    estado.projeto.id = salvo.id;
    estado.projeto.auto = false;
    await projetos.gravarRascunho(montarRegistro());
    estado.salvoEm = Date.now();
    if (!silencioso) avisar(`Projeto "${estado.projeto.nome}" salvo neste navegador. Daqui em diante ele se salva sozinho.`, 'ok', 6000);
    atualizarPaineis();
    return true;
  } catch (erro) {
    avisar(`Não consegui salvar o projeto: ${erro.message}`, 'erro', 0);
    return false;
  }
}

function perguntarNome(atual) {
  const dialogo = $('dialogo-nome');
  const campo = $('nome-valor');
  campo.value = atual || '';
  return new Promise((resolver) => {
    const responder = (v) => { dialogo.close(); resolver(v); };
    $('form-nome').onsubmit = (e) => {
      e.preventDefault();
      const v = campo.value.trim();
      if (v) responder(v);
    };
    $('nome-cancelar').onclick = () => responder(null);
    dialogo.oncancel = (e) => { e.preventDefault(); responder(null); };
    dialogo.showModal();
    campo.select();
  });
}

function ligarProjetos() {
  $('projetos-fechar').addEventListener('click', () => $('dialogo-projetos').close());
  $('lista-projetos').addEventListener('click', async (e) => {
    const abrir = e.target.closest('[data-abrir-projeto]');
    const baixar = e.target.closest('[data-baixar-projeto]');
    const apagar = e.target.closest('[data-apagar-projeto]');
    if (abrir) {
      $('dialogo-projetos').close();
      await abrirProjetoSalvo(abrir.dataset.abrirProjeto);
    } else if (baixar) {
      await baixarProjeto(baixar.dataset.baixarProjeto);
    } else if (apagar) {
      const id = apagar.dataset.apagarProjeto;
      const r = await projetos.lerProjeto(id);
      $('dialogo-projetos').close();
      const ok = await confirmar(`Apagar o projeto "${r ? r.nome : ''}" deste navegador? Isso não dá para desfazer.`, 'Apagar projeto');
      if (ok) {
        await projetos.apagarProjeto(id);
        if (estado.projeto && estado.projeto.id === id) estado.projeto.id = null;
        avisar('Projeto apagado.', 'ok');
        atualizarPaineis();
      }
      await abrirListaProjetos();
    }
  });
}

async function abrirListaProjetos() {
  if (estado.ocupado) return;
  await salvarAgora();
  const lista = await projetos.listarProjetos();
  renderizarProjetos($('lista-projetos'), lista, estado.projeto && estado.projeto.id);
  const d = $('dialogo-projetos');
  if (!d.open) d.showModal();
  if (modoGaveta()) paineis.fechar();
}

async function abrirProjetoSalvo(id) {
  const r = await projetos.lerProjeto(id);
  if (!r) {
    avisar('Este projeto não existe mais.', 'erro');
    return;
  }
  await abrirRegistro(r);
}

/** Abre um registro (projeto salvo ou rascunho): original + receitas. */
async function abrirRegistro(registro) {
  if (estado.ocupado) return;
  const blob = await projetos.lerArquivo(registro.base && registro.base.chaveArquivo);
  if (!blob) {
    avisar(`O modelo original de "${registro.nome}" não está mais no navegador.`, 'erro', 0);
    return;
  }
  if (!estado.projeto || estado.projeto.id !== registro.id) await guardarTrabalhoAnterior();
  const arquivo = blob instanceof File ? blob : new File([blob], registro.base.nome);
  const h = estado.historico;
  h.carregar(registro);
  const { receitas, passos } = h.receitasAte();
  const r = await carregar({
    arquivo,
    simplificarPara: registro.base.simplificarPara,
    receitas,
    guardarVolta: true,
    novo: true,
    texto: `Abrindo "${registro.nome}"…`,
  });
  if (!r) {
    h.limpar();
    atualizarPaineis();
    return;
  }
  h.depoisDeReabrir(passos, r);
  estado.arquivoBase = arquivo;
  estado.projeto = { ...registro, passos: undefined, posicao: undefined };
  estado.guardandoBase = Promise.resolve();
  estado.editando = null;
  if (registro.vista) visualizador.aplicarVista(registro.vista);
  avisarFalhas(r.falhas);
  avisar(`Projeto "${registro.nome}" aberto (${h.passos.length} passos).`, 'ok');
  document.body.classList.add('com-modelo');
  depoisDeMudar();
}

async function baixarProjetoAtual() {
  if (!estado.malha || !estado.projeto || !estado.arquivoBase) return;
  await baixarPacote(montarRegistro(), estado.arquivoBase);
}

async function baixarProjeto(id) {
  const r = await projetos.lerProjeto(id);
  const blob = r && await projetos.lerArquivo(r.base.chaveArquivo);
  if (!blob) {
    avisar('O modelo original deste projeto não está mais no navegador.', 'erro');
    return;
  }
  await baixarPacote(r, blob);
}

async function baixarPacote(registro, modelo) {
  try {
    const pacote = await gravarPacote(registro, modelo);
    const nome = nomeSeguro(`${projetos.nomeDoArquivo(registro.nome)}.lyke`);
    baixar(pacote, nome);
    estado.ultimoPacote = { nome, bytes: pacote.size };
    avisar(`Pronto: ${nome}. Abra este arquivo no outro aparelho com "Abrir modelo".`, 'ok', 8000);
  } catch (erro) {
    avisar(`Não consegui montar o .lyke: ${erro.message}`, 'erro', 0);
  }
}

/** Ao abrir o app: se ficou trabalho de antes, oferece continuar. */
async function oferecerContinuar() {
  let r;
  try {
    r = await projetos.lerRascunho();
  } catch {
    return;
  }
  if (!r || !r.base || !r.base.chaveArquivo) return;
  if (!((r.passos && r.passos.length) || (r.selecoes && r.selecoes.length) || r.id)) return;
  const blob = await projetos.lerArquivo(r.base.chaveArquivo);
  if (!blob || estado.malha) return;
  const quando = new Date(r.alterado).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const n = (r.passos || []).length;
  const ok = await confirmar(
    `"${r.nome}" (${r.base.nome}), com ${n} passo${n === 1 ? '' : 's'}, mexido em ${quando}.`,
    'Continuar',
    { titulo: 'Continuar de onde parou?', nao: 'Agora não' },
  );
  if (ok) await abrirRegistro(r);
}

// --- painéis e medidor --------------------------------------------------------

function atualizarPaineis() {
  renderizarHistorico($('conteudo-historico'), estado);
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
