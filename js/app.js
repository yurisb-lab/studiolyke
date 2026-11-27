// Ponto de partida do Fatiador L.Y.K.E 3D.

import { VERSAO } from './config.js';
import { medirCapacidade, perfilEmUso } from './core/capacidade.js';
import { estimarAbertura, usoAtual, formatarMB, formatarTriangulos, extensao, FORMATOS, MB } from './core/memoria.js';
import { bytesDaMalha, transferiveis } from './core/malha.js';
import { aparenciaDasPartes, faixasDasPartes, trocarFilamento } from './core/projeto.js';
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
};

let visualizador;
let paineis;
let menu;

async function iniciar() {
  document.querySelectorAll('[data-versao]').forEach((el) => { el.textContent = VERSAO; });

  estado.capacidade = medirCapacidade();
  estado.preferenciaLeve = await armazenamento.ler('preferencias', 'modoLeve', 'auto');
  estado.ondeSalva = await armazenamento.onde();
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
  window.__fatiador = { estado, visualizador, abrirArquivo, mudarModoLeve, exportar3mf, versao: VERSAO };
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
    const b = e.target.closest('[data-modo-leve]');
    if (b) mudarModoLeve(b.dataset.modoLeve);
  });
  $('painel-propriedades').addEventListener('change', (e) => {
    const sel = e.target.closest('.seletor-filamento');
    if (sel) mudarFilamento(Number(sel.dataset.objeto), Number(sel.dataset.parte), Number(sel.value));
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
    visualizador.mostrar(r.tela || r.malha, r.caixa, aparencia());
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
  const precisa = tri <= limite ? !!estado.tela : (naTela > limite * 1.15 || naTela < Math.min(tri, limite) * 0.6);
  if (!precisa) return;
  if (tri <= limite) {
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
    visualizador.mostrar(r.tela || r.malha, estado.caixa, aparencia());
  } catch (erro) {
    avisar(`Não consegui refazer a malha da tela: ${erro.message}. Abra o modelo de novo.`, 'erro', 0);
    visualizador.limpar();
  } finally {
    esconderProgresso();
  }
}

// --- filamentos e exportação ----------------------------------------------------

/** Cores das partes na tela: faixas da malha leve (ou da completa) + cor de cada parte. */
function aparencia() {
  const m = estado.malha;
  if (!m) return null;
  const faixas = estado.tela && estado.tela.faixas ? estado.tela.faixas : faixasDasPartes(m);
  return { faixas, partes: aparenciaDasPartes(m) };
}

function mudarFilamento(io, ip, n) {
  if (!estado.malha || estado.ocupado) return;
  try {
    trocarFilamento(estado.malha, io, ip, n);
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
  const a = aparencia();
  visualizador.colorir(a.faixas, a.partes);
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
    if (!estado.tela) visualizador.mostrar(estado.malha, estado.caixa, aparencia());
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
