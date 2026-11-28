// Teste do app no navegador (Chromium automático), simulando os aparelhos de teste:
//   - "PC de 4 GB" (computador, modo leve automático)
//   - tablet (gavetas)
//   - Galaxy S23 Ultra (celular, toque, aparelho forte)
//   - aparelho fraco (aviso "melhor em outro aparelho")
// As bibliotecas do CDN são servidas do node_modules, nas MESMAS versões fixas.
//
// Uso: npm test   (ou  node testes/navegador/rodar.mjs)

import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { gerarTodos, esfera } from '../gerar-modelos.mjs';
import { VERSAO } from '../../js/config.js';
import { ler3mf } from '../../js/io/3mf.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RESULTADOS = join(RAIZ, 'testes', 'resultados');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

// Rodar só algumas partes: SO="histórico" node testes/navegador/rodar.mjs
const SO = (process.env.SO || '').toLowerCase();
const rodar = (nome) => !SO || nome.toLowerCase().includes(SO);

// ---------- mini-asserções ----------
let falhas = 0, passou = 0;
function confere(cond, texto, detalhe = '') {
  if (cond) {
    passou++;
    console.log(`  ok  ${texto}`);
  } else {
    falhas++;
    console.log(`  FALHOU  ${texto} ${detalhe}`);
  }
}

// ---------- servidor local ----------
function servidor() {
  const srv = createServer(async (req, res) => {
    try {
      let caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (caminho.endsWith('/')) caminho += 'index.html';
      const arquivo = join(RAIZ, caminho);
      if (!arquivo.startsWith(RAIZ)) throw new Error('fora');
      const dados = await readFile(arquivo);
      res.writeHead(200, { 'content-type': TIPOS[extname(arquivo)] || 'application/octet-stream' });
      res.end(dados);
    } catch {
      res.writeHead(404);
      res.end('não achei');
    }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// ---------- CDN -> node_modules ----------
const errosCdn = [];
async function rotaCdn(route) {
  const url = new URL(route.request().url());
  const m = /^\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\/(.*)$/.exec(url.pathname);
  if (!m) { errosCdn.push(url.href); return route.abort(); }
  const [, nome, versao, resto] = m;
  const pkg = JSON.parse(readFileSync(join(RAIZ, 'node_modules', nome, 'package.json'), 'utf8'));
  if (pkg.version !== versao) {
    errosCdn.push(`${nome}@${versao} (node_modules tem ${pkg.version})`);
    return route.fulfill({ status: 404, body: 'versão diferente' });
  }
  const arquivo = join(RAIZ, 'node_modules', nome, resto);
  if (!existsSync(arquivo)) { errosCdn.push(url.href); return route.fulfill({ status: 404 }); }
  return route.fulfill({
    status: 200,
    body: readFileSync(arquivo),
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'access-control-allow-origin': '*' },
  });
}

// ---------- simulação de aparelho ----------
function scriptAparelho({ memoria, gpu }) {
  return `(() => {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => ${JSON.stringify(memoria)}, configurable: true });
    const GPU = ${JSON.stringify(gpu)};
    for (const C of [self.WebGLRenderingContext, self.WebGL2RenderingContext]) {
      if (!C) continue;
      const orig = C.prototype.getParameter;
      C.prototype.getParameter = function (p) {
        if (p === 0x9246) return GPU;
        if (p === 0x9245) return 'Teste';
        return orig.call(this, p);
      };
    }
  })();`;
}

const APARELHOS = {
  pc4gb: {
    nome: 'PC de 4 GB',
    contexto: { viewport: { width: 1366, height: 768 } },
    sim: { memoria: 4, gpu: 'ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  },
  tablet: {
    nome: 'tablet',
    contexto: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    sim: { memoria: 8, gpu: 'Mali-G78' },
  },
  s23: {
    nome: 'Galaxy S23 Ultra',
    contexto: {
      viewport: { width: 384, height: 824 },
      deviceScaleFactor: 3.75,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    },
    sim: { memoria: 8, gpu: 'Adreno (TM) 740' },
  },
  fraco: {
    nome: 'aparelho fraco',
    contexto: { viewport: { width: 1280, height: 720 } },
    sim: { memoria: 2, gpu: 'ANGLE (Intel, Intel(R) HD Graphics Direct3D9Ex)' },
  },
};

async function abrirApp(navegador, base, aparelho) {
  const contexto = await navegador.newContext({ ...aparelho.contexto, serviceWorkers: 'block' });
  await contexto.route('https://cdn.jsdelivr.net/**', rotaCdn);
  await contexto.addInitScript(scriptAparelho(aparelho.sim));
  const pagina = await contexto.newPage();
  const erros = [];
  pagina.on('pageerror', (e) => erros.push(String(e)));
  pagina.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  pagina.on('worker', (w) => w.on('console', (m) => { if (m.type() === 'error') erros.push(`worker: ${m.text()}`); }));
  await pagina.goto(base, { waitUntil: 'load' });
  await pagina.waitForFunction(() => document.documentElement.dataset.pronto === 'sim' || !document.getElementById('erro-inicio').hidden, null, { timeout: 30000 });
  return { contexto, pagina, erros };
}

async function abrirModelo(pagina, caminho, { esperarDialogo = false } = {}) {
  const t0 = Date.now();
  await pagina.setInputFiles('#entrada-arquivo', caminho);
  if (esperarDialogo) return;
  await esperarCarregar(pagina, caminho.split(/[\\/]/).pop());
  return Date.now() - t0;
}

async function esperarCarregar(pagina, nome = null) {
  await pagina.waitForFunction((n) => {
    const e = window.__fatiador.estado;
    const certo = e.malha && (!n || e.malha.nome === n);
    return !e.ocupado && (certo || document.querySelector('.aviso-rapido.erro'));
  }, nome, { timeout: 120000 });
  await pagina.waitForTimeout(100);
}

const estado = (pagina) => pagina.evaluate(() => {
  const e = window.__fatiador.estado;
  return {
    modoLeve: e.perfil.modoLeve,
    limiteTela: e.perfil.limiteTela,
    nivel: e.capacidade.nivel,
    triangulos: e.malha ? e.malha.indices.length / 3 : 0,
    naTela: e.tela ? e.tela.indices.length / 3 : (e.malha ? e.malha.indices.length / 3 : 0),
    temTela: !!e.tela,
    objetos: e.malha ? e.malha.objetos.map((o) => o.nome) : [],
    avisos: e.malha ? e.malha.avisos : [],
    original: e.malha ? e.malha.trianguloOriginal : 0,
    heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    // heap do JS + typed arrays da malha (que ficam fora do heap)
    totalMB: (performance.memory ? performance.memory.usedJSHeapSize : 0) / 1048576
      + ((e.malha ? e.malha.posicoes.byteLength + e.malha.indices.byteLength : 0)
      + (e.tela ? (e.tela.posicoes ? e.tela.posicoes.byteLength : 0) + e.tela.indices.byteLength
        + (e.tela.detalhe ? e.tela.detalhe.posicoes.byteLength : 0) : 0)) / 1048576,
    pintura: e.malha && e.malha.pinturaCor ? e.malha.pinturaCor.resumo : null,
    pedacosNaTela: e.tela && e.tela.detalhe ? e.tela.detalhe.posicoes.length / 9 : 0,
    erroVisivel: document.querySelector('.aviso-rapido.erro')?.textContent || '',
  };
});

/** Desenha agora e conta pixels que não são o fundo (a peça apareceu?). */
const pixelsDaPeca = (pagina) => pagina.evaluate(() => {
  const v = window.__fatiador.visualizador;
  const gl = v.renderer.getContext();
  v.renderer.render(v.cena, v.camera);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(4);
  let claros = 0;
  for (let i = 1; i < 20; i++) {
    for (let j = 1; j < 20; j++) {
      gl.readPixels(Math.floor((w * i) / 20), Math.floor((h * j) / 20), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[0] > 110 && px[1] > 110 && px[2] > 110) claros++;
    }
  }
  return claros;
});

const camera = (pagina) => pagina.evaluate(() => {
  const v = window.__fatiador.visualizador;
  const p = v.camera.position, t = v.controles.target;
  return { p: [p.x, p.y, p.z], t: [t.x, t.y, t.z], d: p.distanceTo(t) };
});

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Alvos de toque visíveis menores que 44 px. */
const alvosPequenos = (pagina) => pagina.evaluate(() => {
  const ruins = [];
  for (const el of document.querySelectorAll('button, select, [role="menuitem"], input:not([hidden])')) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || st.visibility === 'hidden') continue;
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
    if (r.width < 43.5 || r.height < 43.5) ruins.push(`${el.textContent.trim().slice(0, 20) || el.getAttribute('aria-label')} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return ruins;
});

const visivelNaTela = (pagina, seletor) => pagina.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el || el.hidden) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1 && getComputedStyle(el).display !== 'none';
}, seletor);

// ---------- exportação ----------
/** Faz a ação que exporta, espera o download e devolve o arquivo baixado. */
async function exportar(pagina, acao) {
  const [download] = await Promise.all([
    pagina.waitForEvent('download', { timeout: 300000 }),
    acao(),
  ]);
  const nome = download.suggestedFilename();
  const caminho = join(RESULTADOS, nome);
  await download.saveAs(caminho);
  await pagina.waitForFunction(() => !window.__fatiador.estado.ocupado && window.__fatiador.estado.malha, null, { timeout: 60000 });
  return { nome, buffer: readFileSync(caminho) };
}

/** O XML abre sem erro no leitor estrito do navegador? Devolve '' ou o erro. */
const erroXml = (pagina, texto) => pagina.evaluate((t) => {
  const d = new DOMParser().parseFromString(t, 'application/xml');
  const e = d.getElementsByTagName('parsererror')[0];
  return e ? e.textContent.slice(0, 200) : '';
}, texto);

async function conferirXml(pagina, buffer, rotulo) {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const erros = [];
  for (const c of ['3D/3dmodel.model', 'Metadata/model_settings.config', '[Content_Types].xml', '_rels/.rels']) {
    const e = await erroXml(pagina, await zip.file(c).async('string'));
    if (e) erros.push(`${c}: ${e}`);
  }
  confere(erros.length === 0, `${rotulo}: XML válido no leitor estrito do navegador`, erros.join(' | '));
  return zip;
}

/** Impressão digital da pintura inteira (para conferir "igual letra por letra"). */
const assinaturaPintura = (pagina) => pagina.evaluate(() => {
  const c = window.__fatiador.estado.malha.pinturaCor;
  if (!c) return 'sem';
  let h = 2166136261;
  for (const a of [c.codigos, c.inicio]) for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619);
  return `${c.codigos.length}:${c.inicio.length}:${h >>> 0}`;
});

/** Espera o app terminar o que está fazendo (desfazer, refazer…). */
async function esperarLivre(pagina) {
  await pagina.waitForTimeout(50);
  await pagina.waitForFunction(() => !window.__fatiador.estado.ocupado && window.__fatiador.estado.malha, null, { timeout: 120000 });
  await pagina.waitForTimeout(50);
}

const coresNaTela = (pagina) => pagina.evaluate(() => window.__fatiador.visualizador.coresNaTela().map((c) => c.cor));

// ---------- toque (Chrome DevTools Protocol) ----------
async function toque(cdp, tipo, pontos) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: tipo,
    touchPoints: pontos.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })),
  });
}

async function arrastarDedos(cdp, inicio, fim, passos = 12) {
  await toque(cdp, 'touchStart', inicio);
  for (let k = 1; k <= passos; k++) {
    const f = k / passos;
    await toque(cdp, 'touchMove', inicio.map(([x, y], i) => [x + (fim[i][0] - x) * f, y + (fim[i][1] - y) * f]));
  }
  await toque(cdp, 'touchEnd', []);
}

// ======================================================================

async function principal() {
  await mkdir(RESULTADOS, { recursive: true });
  console.log('Gerando modelos de teste…');
  const arq = await gerarTodos();
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const navegador = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-precise-memory-info'],
  });
  const triEsfera = esfera(20, 48, 96).indices.length / 3;

  try {
    // ---------------- PC de 4 GB ----------------
    console.log('\n[PC de 4 GB]');
    if (rodar('PC de 4 GB')) {
      const { contexto, pagina, erros } = await abrirApp(navegador, base, APARELHOS.pc4gb);
      confere(await pagina.textContent('#versao') === VERSAO, `mostra a versão ${VERSAO}`);
      confere(await pagina.isDisabled('.painel [data-acao="exportar"]'), 'Exportar 3MF desligado sem modelo');
      let e = await estado(pagina);
      confere(e.modoLeve === true && e.limiteTela === 300000, 'modo leve liga sozinho com 4 GB', JSON.stringify(e));
      confere(await pagina.textContent('#chip-modo-leve') === 'Modo leve', 'chip "Modo leve" no topo');
      confere(await visivelNaTela(pagina, '#painel-ferramentas') && await visivelNaTela(pagina, '#painel-propriedades'), 'ferramentas à esquerda e propriedades à direita');
      confere(!(await visivelNaTela(pagina, '.barra-inferior')), 'sem barra inferior no computador');
      confere(/MB/.test(await pagina.textContent('#medidor .texto')), 'medidor de memória mostra MB');

      await abrirModelo(pagina, arq.esferaStl);
      e = await estado(pagina);
      confere(e.triangulos === triEsfera, `STL binário abre (${e.triangulos} triângulos)`);
      confere(await pixelsDaPeca(pagina) > 20, 'a peça aparece na tela');
      confere((await pagina.textContent('#info-medidas')).includes('40 × 40 × 40'), 'medidas 40 × 40 × 40 mm', await pagina.textContent('#info-medidas'));

      await abrirModelo(pagina, arq.bambu);
      e = await estado(pagina);
      confere(e.objetos.length === 2 && e.objetos[0] === 'Boneco & olho', '3MF do Bambu abre com os objetos', JSON.stringify(e.objetos));
      confere(e.avisos.length === 0 && e.pintura && e.pintura.pintados === 6, 'pintura do Bambu lida, sem aviso', JSON.stringify(e.avisos));

      // ---- pintura do Bambu (etapa 1.3) ----
      await abrirModelo(pagina, arq.conferencia);
      e = await estado(pagina);
      const AZUL = '#1B2A6B', BEGE = '#D9C49A', BRANCO = '#FFFFFF', PRETO = '#1A1A1A';
      confere(e.pintura && e.pintura.subdivididos === 8 && e.pedacosNaTela > 500, `cubo de conferência: pintura fina na tela (${e.pedacosNaTela} pedaços)`);
      let coresP = await coresNaTela(pagina);
      confere([AZUL, BEGE, BRANCO].every((c) => coresP.includes(c)), `pintura aparece nas cores dos filamentos (${coresP.join(' ')})`);
      confere(await pagina.locator('#lista-cores-pintura li').count() === 2, 'painel lista as 2 cores da pintura com a área');
      confere(await pagina.locator('[data-apagar-pintura]').count() === 2, 'cada cubo pintado tem "Apagar pintura"');
      await pagina.evaluate(() => window.__fatiador.visualizador.enquadrar('cima'));
      await pagina.screenshot({ path: join(RESULTADOS, 'pintura-cima.png') });
      await pagina.evaluate(() => window.__fatiador.visualizador.enquadrar('frente'));
      await pagina.screenshot({ path: join(RESULTADOS, 'pintura-frente.png') });
      await pagina.uncheck('#mostrar-pintura');
      coresP = await coresNaTela(pagina);
      confere(!coresP.includes(AZUL) && !coresP.includes(BEGE) && coresP.includes(BRANCO), '"Mostrar pintura" desligado: só a cor das peças', coresP.join(' '));
      await pagina.keyboard.press('p');
      coresP = await coresNaTela(pagina);
      confere(coresP.includes(AZUL) && await pagina.isChecked('#mostrar-pintura'), 'tecla P mostra a pintura de novo');
      await pagina.selectOption('#pintura-de', '3');
      await pagina.selectOption('#pintura-para', '1');
      await pagina.selectOption('#pintura-onde', '');
      await pagina.click('#pintura-trocar');
      coresP = await coresNaTela(pagina);
      e = await estado(pagina);
      confere(coresP.includes(PRETO) && !coresP.includes(BEGE) && e.pintura.estados.join() === '1,2', 'trocar a cor bege pela preta no modelo todo', coresP.join(' '));
      await pagina.click('[data-apagar-pintura="0"]');
      await pagina.waitForSelector('#dialogo-confirmar[open]');
      await pagina.click('#confirmar-sim');
      e = await estado(pagina);
      confere(!e.pintura.partes[0].pintada && e.pintura.partes[1].pintada, 'apagar a pintura do primeiro cubo (com confirmação)');
      const baixadoP = await exportar(pagina, () => pagina.click('.painel [data-acao="exportar"]'));
      const voltaP = await ler3mf(baixadoP.buffer, JSZip);
      {
        const c = voltaP.pinturaCor;
        const p0 = voltaP.objetos[0].partes[0], p1 = voltaP.objetos[1].partes[0];
        const usados = (p) => c.inicio[p.primeiroTriangulo + p.numTriangulos] - c.inicio[p.primeiroTriangulo];
        const xml = await (await JSZip.loadAsync(baixadoP.buffer)).file('3D/3dmodel.model').async('string');
        confere(usados(p0) === 0 && usados(p1) > 0 && xml.includes('paint_color="085"') && xml.includes('paint_color="400A"') && !xml.includes('paint_color="0C00A"'),
          'exportado: primeiro cubo sem pintura, segundo com o canto trocado para o filamento 1');
      }
      await conferirXml(pagina, baixadoP.buffer, 'cubo de conferência exportado');

      // ---- 3MF ida e volta (etapa 1.2) ----
      await abrirModelo(pagina, arq.projeto);
      e = await estado(pagina);
      confere(e.objetos.length === 4, `projeto do Bambu abre com 4 objetos (${e.objetos.join(', ')})`);
      confere(await pagina.locator('#lista-filamentos li').count() === 4, 'painel mostra os 4 filamentos');
      confere(await pagina.locator('#conteudo-modelo .placa').count() === 2, 'painel mostra as 2 placas');
      confere((await pagina.textContent('#conteudo-modelo')).includes('modificador'), 'parte modificadora aparece na lista');
      // a pintura do projeto também usa essas cores: desligada aqui para olhar só as partes
      await pagina.uncheck('#mostrar-pintura');
      let cores = await coresNaTela(pagina);
      confere(['#1A1A1A', '#1B2A6B', '#D9C49A'].every((c) => cores.includes(c)) && !cores.includes('#FFFFFF'), `cada parte na cor do filamento; a que não imprime fica apagada (${cores.join(' ')})`);
      await pagina.selectOption('.seletor-filamento[data-objeto="0"][data-parte="1"]', '4');
      const trocou = await pagina.evaluate(() => window.__fatiador.estado.malha.objetos[0].partes[1].extrusora);
      cores = await coresNaTela(pagina);
      confere(trocou === 4 && !cores.includes('#D9C49A'), 'trocar o filamento do olho muda a cor na tela', cores.join(' '));
      await pagina.check('#mostrar-pintura');
      confere(!(await pagina.isDisabled('.painel [data-acao="exportar"]')), 'Exportar 3MF ligado com modelo');
      let baixado = await exportar(pagina, () => pagina.click('.painel [data-acao="exportar"]'));
      confere(baixado.nome === 'projeto-bambu_fatiador.3mf', `botão Exportar baixa "${baixado.nome}"`);
      let volta = await ler3mf(baixado.buffer, JSZip);
      confere(volta.objetos.length === 4 && volta.objetos[0].partes.length === 3 && volta.placas.length === 2, 'arquivo exportado tem os mesmos objetos, partes e placas');
      confere(volta.objetos[0].partes[1].extrusora === 4, 'filamento trocado foi para o arquivo');
      confere(volta.trianguloPintados === 19, `pintura foi junto (${volta.trianguloPintados} triângulos)`);
      await conferirXml(pagina, baixado.buffer, 'projeto exportado');
      e = await estado(pagina);
      const naTela = await pagina.evaluate(() => {
        const v = window.__fatiador.visualizador;
        return { pos: v.peca.geometry.attributes.position.array.length, tri: v.trianguloNaTela, cores: v.coresNaTela().length };
      });
      confere(e.objetos.length === 4 && naTela.pos > 0 && naTela.tri === e.naTela + e.pedacosNaTela && naTela.cores >= 3, 'depois de exportar o modelo continua aberto na tela', JSON.stringify(naTela));

      // STL pelo atalho Ctrl+E: ganha miniatura e vai para o centro da placa
      await abrirModelo(pagina, arq.cubosObj);
      e = await estado(pagina);
      confere(e.triangulos === 24 && e.objetos.length === 2, 'OBJ abre com 2 objetos');
      baixado = await exportar(pagina, () => pagina.keyboard.press('Control+e'));
      volta = await ler3mf(baixado.buffer, JSZip);
      const zipObj = await conferirXml(pagina, baixado.buffer, 'OBJ exportado');
      const png = await zipObj.file('Metadata/plate_1.png')?.async('uint8array');
      confere(png && png[0] === 0x89 && png[1] === 0x50 && png.length > 2000, `Ctrl+E exporta, com miniatura da peça (${png ? png.length : 0} bytes)`);
      confere(volta.objetos.map((o) => o.nome).join() === 'Cubo grande,Cubo pequeno', 'objetos do OBJ viram objetos no 3MF');
      const cx = volta.posicoes.reduce((a, v, i) => (i % 3 === 0 ? a + v : a), 0) / (volta.posicoes.length / 3);
      confere(cx > 100 && cx < 160, `peças no meio da placa da A1 (x médio ${cx.toFixed(1)} mm)`);

      await abrirModelo(pagina, arq.cuboTexto);
      e = await estado(pagina);
      confere(e.triangulos === 12, 'STL em texto abre');

      // modelo pesado no modo leve
      const ms = await abrirModelo(pagina, arq.pesado);
      e = await estado(pagina);
      confere(e.triangulos === 998000, `modelo de 1 milhão abre em ${(ms / 1000).toFixed(1)} s`);
      confere(e.temTela && e.naTela <= 300000 * 1.15, `malha leve na tela: ${e.naTela} triângulos`);
      confere(await pixelsDaPeca(pagina) > 20, 'a peça pesada aparece');
      console.log(`      memória do app depois de abrir: ${e.totalMB.toFixed(0)} MB (JS ${e.heapMB ? e.heapMB.toFixed(0) : '?'} MB + malhas)`);
      confere(e.totalMB < 250, 'memória dentro do previsto para o modo leve (< 250 MB)');
      const medidor = await pagina.evaluate(() => parseFloat(document.querySelector('#medidor .texto').textContent));
      confere(medidor >= e.totalMB * 0.8, `medidor conta a malha (${medidor} MB)`);
      await pagina.screenshot({ path: join(RESULTADOS, 'pc-4gb.png') });

      // desligar o modo leve: a tela passa a usar a malha completa
      await pagina.click('[data-modo-leve="desligado"]');
      await pagina.waitForFunction(() => !window.__fatiador.estado.ocupado);
      e = await estado(pagina);
      confere(!e.modoLeve && !e.temTela && e.triangulos === 998000, 'modo leve desligado: tela com a malha completa');
      // religar: a malha vai ao worker e volta (transferida) com a malha leve nova
      await pagina.click('[data-modo-leve="ligado"]');
      await pagina.waitForFunction(() => !window.__fatiador.estado.ocupado && window.__fatiador.estado.malha);
      e = await estado(pagina);
      confere(e.modoLeve && e.temTela && e.naTela <= 345000 && e.triangulos === 998000, 'modo leve religado: malha leve refeita, completa preservada', JSON.stringify(e));

      // preferência salva pela camada de armazenamento
      await pagina.click('[data-modo-leve="desligado"]');
      await pagina.waitForFunction(() => !window.__fatiador.estado.ocupado && !window.__fatiador.estado.perfil.modoLeve);
      await pagina.waitForTimeout(300);
      await pagina.reload();
      await pagina.waitForFunction(() => document.documentElement.dataset.pronto === 'sim');
      e = await estado(pagina);
      confere(!e.modoLeve && await pagina.textContent('#chip-modo-leve') === 'Completo', 'preferência do modo leve fica salva depois de recarregar');
      await pagina.click('[data-modo-leve="auto"]');
      await pagina.waitForFunction(() => !window.__fatiador.estado.ocupado);

      // modelo grande demais: sugere simplificar
      await pagina.evaluate(() => { window.__fatiador.estado.perfil.orcamentoMB = 40; });
      await abrirModelo(pagina, arq.pesado, { esperarDialogo: true });
      await pagina.waitForSelector('#dialogo-grande[open]');
      confere(true, 'modelo grande abre o aviso "simplificar ao abrir"');
      await pagina.click('#dlg-simplificar');
      await esperarCarregar(pagina);
      e = await estado(pagina);
      confere(e.original === 998000 && e.triangulos <= 600000 * 1.15, `simplificado ao abrir: ${e.triangulos} triângulos`);

      // segurar o clique abre o menu
      const caixa = await pagina.locator('#area-3d').boundingBox();
      await pagina.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
      await pagina.mouse.down();
      await pagina.waitForTimeout(750);
      await pagina.mouse.up();
      confere(await visivelNaTela(pagina, '#menu-contexto'), 'segurar abre o menu');
      confere(await pagina.getByRole('menuitem', { name: 'Exportar 3MF' }).count() === 1, 'menu tem "Exportar 3MF"');
      await pagina.getByRole('menuitem', { name: 'Vista de cima' }).click();
      await pagina.waitForTimeout(100);
      const cima = await camera(pagina);
      confere(!(await visivelNaTela(pagina, '#menu-contexto')) && (cima.p[2] - cima.t[2]) / cima.d > 0.99, 'menu "Vista de cima" funciona');

      // arquivo errado
      await pagina.setInputFiles('#entrada-arquivo', { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('x') });
      await pagina.waitForSelector('.aviso-rapido.erro');
      confere(true, 'arquivo que não é modelo mostra erro claro');

      confere(erros.length === 0, 'sem erros no console', erros.join(' | '));
      await contexto.close();
    }

    // ---------------- histórico e projetos (etapa 1.4) ----------------
    console.log('\n[histórico e projetos]');
    if (rodar('histórico e projetos (etapa 1.4)')) {
      const { contexto, pagina, erros } = await abrirApp(navegador, base, APARELHOS.pc4gb);
      await abrirModelo(pagina, arq.conferencia);
      const original = await assinaturaPintura(pagina);
      confere(await pagina.locator('#lista-historico .passo').count() === 1, 'histórico começa com "Modelo aberto"');
      confere(await pagina.isDisabled('.topo [data-acao="desfazer"]'), 'Desfazer desligado sem passos');
      await pagina.selectOption('#pintura-de', '3');
      await pagina.selectOption('#pintura-para', '1');
      await pagina.selectOption('#pintura-onde', '');
      await pagina.click('#pintura-trocar');
      let e = await estado(pagina);
      confere(e.pintura.estados.join() === '1,2' && await pagina.locator('#lista-historico .passo').count() === 2, 'troca de cor vira um passo do histórico');
      await pagina.selectOption('.seletor-filamento[data-objeto="0"][data-parte="0"]', '3');
      confere(await pagina.locator('#lista-historico .passo').count() === 3, 'troca de filamento vira outro passo');
      await pagina.keyboard.press('Control+z');
      await esperarLivre(pagina);
      confere(await pagina.evaluate(() => window.__fatiador.estado.malha.objetos[0].partes[0].extrusora) !== 3, 'Ctrl+Z desfaz o filamento');
      const t0 = Date.now();
      await pagina.click('.topo [data-acao="desfazer"]');
      await esperarLivre(pagina);
      const msDesfazer = Date.now() - t0;
      e = await estado(pagina);
      let cores = await coresNaTela(pagina);
      confere(e.pintura.estados.join() === '2,3' && cores.includes('#D9C49A') && await assinaturaPintura(pagina) === original,
        `botão Desfazer volta a pintura igual letra por letra e a cor na tela (${msDesfazer} ms)`);
      confere(await pagina.locator('#lista-historico .passo.futuro').count() === 2, 'passos desfeitos ficam riscados (para refazer)');
      await pagina.keyboard.press('Control+y');
      await esperarLivre(pagina);
      e = await estado(pagina);
      confere(e.pintura.estados.join() === '1,2', 'Ctrl+Y refaz');
      // editar o passo 1: a cor 3 vai para o filamento 2 em vez do 1
      await pagina.click('[data-editar-passo="0"]');
      await pagina.selectOption('.editor-passo [data-campo="para"]', '2');
      await pagina.click('[data-aplicar-edicao]');
      await esperarLivre(pagina);
      e = await estado(pagina);
      confere(e.pintura.estados.join() === '2' && /→ 2/.test(await pagina.textContent('#lista-historico')), 'editar um passo antigo refaz o modelo com a receita nova');
      // tocar no "Modelo aberto" volta ao começo; tocar no último vai até o fim
      await pagina.click('[data-ir="0"]');
      await esperarLivre(pagina);
      confere(await assinaturaPintura(pagina) === original, 'tocar em "Modelo aberto" volta ao original');
      await pagina.click('[data-ir="2"]');
      await esperarLivre(pagina);
      e = await estado(pagina);
      confere(e.pintura.estados.join() === '2' && await pagina.evaluate(() => window.__fatiador.estado.malha.objetos[0].partes[0].extrusora) === 3, 'tocar no último passo refaz tudo');
      await pagina.screenshot({ path: join(RESULTADOS, 'historico.png') });
      const exportado = await exportar(pagina, () => pagina.click('.painel [data-acao="exportar"]'));
      const volta = await ler3mf(exportado.buffer, JSZip);
      confere(volta.objetos[0].partes[0].extrusora === 3 && !volta.pinturaCor.codigos.includes(3 << 2), 'o 3MF exportado sai com os passos do histórico');
      // salvar projeto com nome
      await pagina.keyboard.press('Control+s');
      await pagina.waitForSelector('#dialogo-nome[open]');
      await pagina.fill('#nome-valor', 'Conferência de pintura');
      await pagina.press('#nome-valor', 'Enter');
      await pagina.waitForFunction(() => window.__fatiador.estado.projeto.id, null, { timeout: 10000 });
      confere((await pagina.textContent('#info-historico')).includes('Conferência de pintura'), 'Ctrl+S salva o projeto com nome');
      // recarregar: oferece continuar de onde parou
      await pagina.reload();
      await pagina.waitForSelector('#dialogo-confirmar[open]', { timeout: 30000 });
      confere(/Continuar de onde parou/.test(await pagina.textContent('#confirmar-titulo')), 'ao reabrir o app pergunta "Continuar de onde parou?"');
      await pagina.click('#confirmar-sim');
      await esperarCarregar(pagina);
      e = await estado(pagina);
      confere(e.pintura && e.pintura.estados.join() === '2' && await pagina.locator('#lista-historico .passo').count() === 3
        && await pagina.evaluate(() => window.__fatiador.estado.projeto.id !== null), 'continuou com os mesmos passos e o mesmo projeto');
      await pagina.keyboard.press('Control+z');
      await esperarLivre(pagina);
      await pagina.keyboard.press('Control+z');
      await esperarLivre(pagina);
      confere(await assinaturaPintura(pagina) === original, 'depois de recarregar ainda dá para desfazer até o original');
      await pagina.keyboard.press('Control+y');
      await esperarLivre(pagina);
      await pagina.keyboard.press('Control+y');
      await esperarLivre(pagina);
      // lista de projetos e .lyke
      await pagina.click('.painel [data-acao="projetos"]');
      await pagina.waitForSelector('#dialogo-projetos[open]');
      confere(await pagina.locator('.lista-projetos li').count() === 1, 'Projetos salvos lista o projeto');
      const [dl] = await Promise.all([pagina.waitForEvent('download'), pagina.click('[data-baixar-projeto]')]);
      const caminhoLyke = join(RESULTADOS, dl.suggestedFilename());
      await dl.saveAs(caminhoLyke);
      confere(/\.lyke$/.test(dl.suggestedFilename()), `baixa o projeto como ${dl.suggestedFilename()}`);
      await pagina.click('#projetos-fechar');
      // abrir outro modelo com passos não salvos: o trabalho fica guardado como "não salvo"
      await abrirModelo(pagina, arq.bambu);
      await pagina.selectOption('.seletor-filamento[data-objeto="0"][data-parte="0"]', '2');
      await pagina.waitForTimeout(900);
      await abrirModelo(pagina, arq.esferaStl);
      await pagina.click('.painel [data-acao="projetos"]');
      await pagina.waitForSelector('#dialogo-projetos[open]');
      confere(await pagina.locator('.lista-projetos li').count() === 2 && (await pagina.textContent('#lista-projetos')).includes('não salvo'), 'trabalho sem nome não se perde ao abrir outro modelo');
      await pagina.click('[data-abrir-projeto]:first-of-type');
      await esperarCarregar(pagina);
      e = await estado(pagina);
      confere(e.objetos.length === 2 && await pagina.evaluate(() => window.__fatiador.estado.malha.objetos[0].partes[0].extrusora) === 2, 'abrir um projeto da lista volta com os passos');
      confere(erros.length === 0, 'sem erros no console', erros.join(' | '));
      await contexto.close();

      // o .lyke no celular (outro aparelho, outro navegador)
      const cel = await abrirApp(navegador, base, APARELHOS.s23);
      await cel.pagina.setInputFiles('#entrada-arquivo', caminhoLyke);
      await esperarCarregar(cel.pagina);
      e = await estado(cel.pagina);
      confere(e.pintura && e.pintura.estados.join() === '2' && await cel.pagina.evaluate(() => window.__fatiador.estado.historico.passos.length) === 2, 'o .lyke abre no S23 com os mesmos passos');
      await cel.pagina.locator('.barra-inferior [data-acao="desfazer"]').tap();
      await esperarLivre(cel.pagina);
      await cel.pagina.locator('.barra-inferior [data-acao="desfazer"]').tap();
      await esperarLivre(cel.pagina);
      confere(await assinaturaPintura(cel.pagina) === original, 'no celular, Desfazer da barra de baixo volta ao original');
      await cel.pagina.screenshot({ path: join(RESULTADOS, 'historico-celular.png') });
      confere(cel.erros.length === 0, 'sem erros no console', cel.erros.join(' | '));
      await cel.contexto.close();
    }

    // ---------------- tablet ----------------
    console.log('\n[tablet]');
    if (rodar('tablet')) {
      const { contexto, pagina, erros } = await abrirApp(navegador, base, APARELHOS.tablet);
      const e = await estado(pagina);
      confere(!e.modoLeve, 'tablet forte não liga o modo leve');
      confere(!(await visivelNaTela(pagina, '#painel-propriedades')), 'propriedades escondidas (gaveta)');
      await pagina.click('.topo [data-abre="painel-propriedades"]');
      await pagina.waitForTimeout(350);
      confere(await visivelNaTela(pagina, '#painel-propriedades'), 'botão abre a gaveta de propriedades');
      await pagina.mouse.click(60, 600);
      await pagina.waitForTimeout(350);
      confere(!(await visivelNaTela(pagina, '#painel-propriedades')), 'tocar fora fecha a gaveta');
      await pagina.click('.topo [data-abre="painel-ferramentas"]');
      await pagina.waitForTimeout(350);
      confere(await visivelNaTela(pagina, '#painel-ferramentas'), 'gaveta de ferramentas abre');
      const pequenos = await alvosPequenos(pagina);
      confere(pequenos.length === 0, 'alvos de toque com 44 px ou mais', pequenos.join(', '));
      await pagina.screenshot({ path: join(RESULTADOS, 'tablet.png') });
      confere(erros.length === 0, 'sem erros no console', erros.join(' | '));
      await contexto.close();
    }

    // ---------------- Galaxy S23 Ultra ----------------
    console.log('\n[Galaxy S23 Ultra]');
    if (rodar('Galaxy S23 Ultra')) {
      const { contexto, pagina, erros } = await abrirApp(navegador, base, APARELHOS.s23);
      let e = await estado(pagina);
      confere(!e.modoLeve && e.nivel === 'forte' && e.limiteTela === 1500000, 'S23 Ultra: aparelho forte, modo leve desligado', JSON.stringify(e));
      confere(await visivelNaTela(pagina, '.barra-inferior'), 'barra de ferramentas embaixo');
      confere(!(await visivelNaTela(pagina, '#painel-propriedades')) && !(await visivelNaTela(pagina, '#painel-ferramentas')), 'peça em tela cheia (painéis fechados)');
      const largura = await pagina.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      confere(largura[0] <= largura[1], 'sem rolagem para o lado', JSON.stringify(largura));
      let pequenos = await alvosPequenos(pagina);
      confere(pequenos.length === 0, 'alvos de toque com 44 px ou mais', pequenos.join(', '));

      await abrirModelo(pagina, arq.conferencia);
      e = await estado(pagina);
      let cores = await coresNaTela(pagina);
      confere(e.pedacosNaTela > 500 && cores.includes('#1B2A6B') && cores.includes('#D9C49A'), `S23: pintura fina na tela (${e.pedacosNaTela} pedaços)`);
      await pagina.locator('.barra-inferior [data-abre="painel-propriedades"]').tap();
      await pagina.waitForTimeout(350);
      await pagina.locator('#sec-modelo h3', { hasText: 'Pintura' }).scrollIntoViewIfNeeded();
      pequenos = await alvosPequenos(pagina);
      confere(pequenos.length === 0, 'controles da pintura com 44 px ou mais', pequenos.join(', '));
      await pagina.locator('#mostrar-pintura').tap();
      cores = await coresNaTela(pagina);
      confere(!cores.includes('#1B2A6B'), 'S23: tocar em "Mostrar pintura" esconde a pintura');
      await pagina.screenshot({ path: join(RESULTADOS, 's23-pintura.png') });
      await pagina.locator('#mostrar-pintura').tap();
      await pagina.locator('.barra-inferior [data-abre="painel-propriedades"]').tap();
      await pagina.waitForTimeout(350);

      await abrirModelo(pagina, arq.projeto);
      const baixado = await exportar(pagina, () => pagina.locator('.barra-inferior [data-acao="exportar"]').tap());
      const volta = await ler3mf(baixado.buffer, JSZip);
      confere(volta.objetos.length === 4 && volta.trianguloPintados === 19, `"Exportar" na barra de baixo baixa o 3MF (${baixado.nome})`);
      await pagina.locator('.barra-inferior [data-abre="painel-propriedades"]').tap();
      await pagina.waitForTimeout(350);
      pequenos = await alvosPequenos(pagina);
      confere(pequenos.length === 0, 'seletores de filamento com 44 px ou mais', pequenos.join(', '));
      await pagina.screenshot({ path: join(RESULTADOS, 's23-placas.png') });
      await pagina.locator('.barra-inferior [data-abre="painel-propriedades"]').tap();
      await pagina.waitForTimeout(350);

      const ms = await abrirModelo(pagina, arq.pesado);
      e = await estado(pagina);
      confere(e.triangulos === 998000 && !e.temTela, `modelo de 1 milhão inteiro na tela (abriu em ${(ms / 1000).toFixed(1)} s)`);
      confere(await pixelsDaPeca(pagina) > 20, 'a peça aparece');

      const cdp = await contexto.newCDPSession(pagina);
      const c = await pagina.locator('#area-3d').boundingBox();
      const cx = c.x + c.width / 2, cy = c.y + c.height / 2;

      let a = await camera(pagina);
      await arrastarDedos(cdp, [[cx, cy]], [[cx + 120, cy + 30]]);
      let b = await camera(pagina);
      confere(dist(a.p, b.p) > 1 && dist(a.t, b.t) < 1e-6, 'um dedo gira');

      a = b;
      await arrastarDedos(cdp, [[cx - 40, cy], [cx + 40, cy]], [[cx - 140, cy], [cx + 140, cy]]);
      b = await camera(pagina);
      confere(b.d < a.d * 0.9, `pinça dá zoom (${a.d.toFixed(0)} → ${b.d.toFixed(0)} mm)`);

      a = b;
      await arrastarDedos(cdp, [[cx - 50, cy], [cx + 50, cy]], [[cx - 50, cy - 120], [cx + 50, cy - 120]]);
      b = await camera(pagina);
      confere(dist(a.t, b.t) > 1, 'dois dedos arrastam');

      await toque(cdp, 'touchStart', [[cx, cy]]);
      await pagina.waitForTimeout(750);
      await toque(cdp, 'touchEnd', []);
      confere(await visivelNaTela(pagina, '#menu-contexto'), 'segurar o dedo abre o menu');
      pequenos = await alvosPequenos(pagina);
      confere(pequenos.length === 0, 'itens do menu com 44 px ou mais', pequenos.join(', '));
      await pagina.screenshot({ path: join(RESULTADOS, 's23-menu.png') });
      await pagina.getByRole('menuitem', { name: 'Enquadrar a peça' }).tap();
      confere(!(await visivelNaTela(pagina, '#menu-contexto')), 'menu fecha depois de escolher');

      await pagina.locator('.barra-inferior [data-abre="painel-propriedades"]').tap();
      await pagina.waitForTimeout(350);
      confere(await visivelNaTela(pagina, '#painel-propriedades'), 'Info abre a folha deslizante');
      await pagina.screenshot({ path: join(RESULTADOS, 's23-info.png') });
      const alca = await pagina.locator('#painel-propriedades .alca').boundingBox();
      await arrastarDedos(cdp, [[alca.x + alca.width / 2, alca.y + 10]], [[alca.x + alca.width / 2, alca.y + 220]]);
      await pagina.waitForTimeout(350);
      confere(!(await visivelNaTela(pagina, '#painel-propriedades')), 'arrastar a alça para baixo fecha a folha');
      await pagina.screenshot({ path: join(RESULTADOS, 's23.png') });

      confere(erros.length === 0, 'sem erros no console', erros.join(' | '));
      await contexto.close();
    }

    // ---------------- aparelho fraco ----------------
    console.log('\n[aparelho fraco]');
    if (rodar('aparelho fraco')) {
      const { contexto, pagina, erros } = await abrirApp(navegador, base, APARELHOS.fraco);
      const e = await estado(pagina);
      confere(e.nivel === 'fraco' && e.modoLeve && e.limiteTela === 150000, 'aparelho fraco: modo leve mais forte');
      confere((await pagina.textContent('#avisos')).includes('outro aparelho'), 'mostra o aviso "melhor em outro aparelho"');
      confere(erros.length === 0, 'sem erros no console', erros.join(' | '));
      await contexto.close();
    }

    // ---------------- app instalável e offline ----------------
    console.log('\n[app instalável e offline]');
    if (rodar('app instalável e offline')) {
      const contexto = await navegador.newContext({ viewport: { width: 1280, height: 720 } });
      await contexto.route('https://cdn.jsdelivr.net/**', rotaCdn);
      const pagina = await contexto.newPage();
      const erros = [];
      pagina.on('pageerror', (e) => erros.push(String(e)));
      await pagina.goto(base);
      await pagina.evaluate(() => navigator.serviceWorker.ready);
      await pagina.waitForFunction(async () => {
        const n = (await (await caches.open('fatiador-cdn')).keys()).length;
        return n >= 5;
      }, null, { timeout: 30000 });
      confere(true, 'service worker guardou o app e as bibliotecas');
      await contexto.setOffline(true);
      await pagina.reload();
      await pagina.waitForFunction(() => document.documentElement.dataset.pronto === 'sim', null, { timeout: 30000 });
      confere(await pagina.textContent('#versao') === VERSAO, 'sem internet o app abre do mesmo jeito');
      await abrirModelo(pagina, arq.bambu);
      const e = await estado(pagina);
      confere(e.objetos.length === 2, 'sem internet ainda abre 3MF (worker e JSZip guardados)');
      const baixado = await exportar(pagina, () => pagina.click('.painel [data-acao="exportar"]'));
      confere(baixado.buffer.length > 500, 'sem internet também exporta 3MF');
      confere(erros.length === 0, 'sem erros no console', erros.join(' | '));
      await contexto.close();
    }

    // ---------------- modelos de referência do Yuri ----------------
    const pastaModelos = join(RAIZ, 'testes', 'modelos');
    const modelos = existsSync(pastaModelos)
      ? (await readdir(pastaModelos)).filter((n) => /\.(stl|obj|3mf)$/i.test(n))
      : [];
    console.log(`\n[modelos de referência: ${modelos.length ? modelos.join(', ') : 'nenhum em testes/modelos/'}]`);
    if (modelos.length && rodar("modelos de referência")) {
      const { contexto, pagina, erros } = await abrirApp(navegador, base, APARELHOS.pc4gb);
      for (const nome of modelos) {
        const ms = await abrirModelo(pagina, join(pastaModelos, nome));
        const e = await estado(pagina);
        confere(e.triangulos > 0 && !e.erroVisivel, `${nome}: ${e.triangulos} triângulos, ${e.naTela} na tela, ${(ms / 1000).toFixed(1)} s, ${e.totalMB.toFixed(0)} MB`, e.erroVisivel);
        const selo = await pagina.textContent('#conteudo-modelo .selo');
        console.log(`      mesa: ${selo}`);
        if (/arco|smile/i.test(nome)) confere(/^Cab|^Cada objeto cabe/.test(selo), `${nome}: cada peça cabe na mesa da A1`, selo);
        await pagina.screenshot({ path: join(RESULTADOS, `modelo-${nome}.png`) });
        if (/\.3mf$/i.test(nome)) {
          const original = await ler3mf(readFileSync(join(pastaModelos, nome)), JSZip);
          const t0 = Date.now();
          const baixado = await exportar(pagina, () => pagina.click('.painel [data-acao="exportar"]'));
          const seg = (Date.now() - t0) / 1000;
          const depois = await estado(pagina);
          const volta = await ler3mf(baixado.buffer, JSZip);
          let iguais = volta.indices.length === original.indices.length && volta.posicoes.length === original.posicoes.length;
          for (let i = 0; iguais && i < original.posicoes.length; i++) if (Math.abs(original.posicoes[i] - volta.posicoes[i]) > 1e-9) iguais = false;
          const mesmo = (a, b, campo) => (!a && !b) || (a && b && Buffer.compare(Buffer.from(a[campo]), Buffer.from(b[campo])) === 0
            && a.inicio.every((v, i) => v === b.inicio[i]));
          const pinturaIgual = mesmo(original.pinturaCor, volta.pinturaCor, 'codigos') && mesmo(original.pinturaOutros, volta.pinturaOutros, 'atributos');
          confere(iguais && pinturaIgual && volta.objetos.length === original.objetos.length
            && JSON.stringify(volta.placas.map((p) => p.objetos)) === JSON.stringify(original.placas.map((p) => p.objetos))
            && JSON.stringify(volta.objetos.map((o) => o.partes.map((p) => p.extrusora))) === JSON.stringify(original.objetos.map((o) => o.partes.map((p) => p.extrusora))),
          `${nome}: exportado e relido igual (${seg.toFixed(1)} s, ${(baixado.buffer.length / 1048576).toFixed(1)} MB, pintura ${volta.trianguloPintados} triângulos, ${depois.totalMB.toFixed(0)} MB em uso depois)`);
          if (/smile/i.test(nome)) {
            await conferirXml(pagina, baixado.buffer, nome);
            confere(e.pintura && e.pintura.pintados === 147643 && e.pintura.estados.join() === '2', `${nome}: pintura azul dos tênis lida (${e.pintura ? e.pintura.pintados : 0} triângulos)`);
            // histórico no modelo grande: trocar a cor e desfazer (rápido e pela receita)
            const antes = await assinaturaPintura(pagina);
            let t0h = Date.now();
            await pagina.evaluate(() => window.__fatiador.trocarPintura({ de: 2, para: 1 }));
            const msTroca = Date.now() - t0h;
            t0h = Date.now();
            await pagina.evaluate(() => window.__fatiador.desfazer());
            await esperarLivre(pagina);
            const msRapido = Date.now() - t0h;
            const igualRapido = await assinaturaPintura(pagina) === antes;
            await pagina.evaluate(() => window.__fatiador.refazer());
            await esperarLivre(pagina);
            // sem a volta guardada (como acima do limite de memória): reabre e refaz
            await pagina.evaluate(() => { for (const p of window.__fatiador.estado.historico.passos) { p.volta = null; p.voltaBytes = 0; } });
            t0h = Date.now();
            await pagina.evaluate(() => window.__fatiador.desfazer());
            await esperarLivre(pagina);
            const msReabrir = Date.now() - t0h;
            const depoisH = await estado(pagina);
            confere(igualRapido && await assinaturaPintura(pagina) === antes && depoisH.pintura.estados.join() === '2',
              `${nome}: trocar cor ${msTroca} ms; desfazer rápido ${msRapido} ms; desfazer reabrindo ${(msReabrir / 1000).toFixed(1)} s, ${depoisH.totalMB.toFixed(0)} MB; pintura volta igual`);
          }
        }
      }
      confere(erros.length === 0, 'sem erros no console', erros.join(' | '));
      await contexto.close();
    }

    confere(errosCdn.length === 0, 'bibliotecas do CDN batem com as versões fixas', errosCdn.join(', '));
  } finally {
    await navegador.close();
    srv.close();
  }
  console.log(`\n${passou} ok, ${falhas} falha(s). Capturas de tela em testes/resultados/`);
  process.exit(falhas ? 1 : 0);
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
