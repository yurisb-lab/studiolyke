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
import { gerarTodos, esfera } from '../gerar-modelos.mjs';

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
  await esperarCarregar(pagina);
  return Date.now() - t0;
}

async function esperarCarregar(pagina) {
  await pagina.waitForFunction(() => {
    const e = window.__fatiador.estado;
    return !e.ocupado && (e.malha || document.querySelector('.aviso-rapido.erro'));
  }, null, { timeout: 120000 });
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
      + (e.tela ? e.tela.posicoes.byteLength + e.tela.indices.byteLength : 0)) / 1048576,
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
  for (const el of document.querySelectorAll('button, [role="menuitem"], input:not([hidden])')) {
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
    {
      const { contexto, pagina, erros } = await abrirApp(navegador, base, APARELHOS.pc4gb);
      confere(await pagina.textContent('#versao') === 'v0.0.1', 'mostra a versão v0.0.1');
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
      confere(e.avisos.some((a) => a.includes('Pintura do Bambu')), 'avisa que a pintura chega na etapa 1.3');

      await abrirModelo(pagina, arq.cubosObj);
      e = await estado(pagina);
      confere(e.triangulos === 24 && e.objetos.length === 2, 'OBJ abre com 2 objetos');

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

    // ---------------- tablet ----------------
    console.log('\n[tablet]');
    {
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
    {
      const { contexto, pagina, erros } = await abrirApp(navegador, base, APARELHOS.s23);
      let e = await estado(pagina);
      confere(!e.modoLeve && e.nivel === 'forte' && e.limiteTela === 1500000, 'S23 Ultra: aparelho forte, modo leve desligado', JSON.stringify(e));
      confere(await visivelNaTela(pagina, '.barra-inferior'), 'barra de ferramentas embaixo');
      confere(!(await visivelNaTela(pagina, '#painel-propriedades')) && !(await visivelNaTela(pagina, '#painel-ferramentas')), 'peça em tela cheia (painéis fechados)');
      const largura = await pagina.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      confere(largura[0] <= largura[1], 'sem rolagem para o lado', JSON.stringify(largura));
      let pequenos = await alvosPequenos(pagina);
      confere(pequenos.length === 0, 'alvos de toque com 44 px ou mais', pequenos.join(', '));

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
    {
      const { contexto, pagina, erros } = await abrirApp(navegador, base, APARELHOS.fraco);
      const e = await estado(pagina);
      confere(e.nivel === 'fraco' && e.modoLeve && e.limiteTela === 150000, 'aparelho fraco: modo leve mais forte');
      confere((await pagina.textContent('#avisos')).includes('outro aparelho'), 'mostra o aviso "melhor em outro aparelho"');
      confere(erros.length === 0, 'sem erros no console', erros.join(' | '));
      await contexto.close();
    }

    // ---------------- app instalável e offline ----------------
    console.log('\n[app instalável e offline]');
    {
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
      confere(await pagina.textContent('#versao') === 'v0.0.1', 'sem internet o app abre do mesmo jeito');
      await abrirModelo(pagina, arq.bambu);
      const e = await estado(pagina);
      confere(e.objetos.length === 2, 'sem internet ainda abre 3MF (worker e JSZip guardados)');
      confere(erros.length === 0, 'sem erros no console', erros.join(' | '));
      await contexto.close();
    }

    // ---------------- modelos de referência do Yuri ----------------
    const pastaModelos = join(RAIZ, 'testes', 'modelos');
    const modelos = existsSync(pastaModelos)
      ? (await readdir(pastaModelos)).filter((n) => /\.(stl|obj|3mf)$/i.test(n))
      : [];
    console.log(`\n[modelos de referência: ${modelos.length ? modelos.join(', ') : 'nenhum em testes/modelos/'}]`);
    if (modelos.length) {
      const { contexto, pagina, erros } = await abrirApp(navegador, base, APARELHOS.pc4gb);
      for (const nome of modelos) {
        const ms = await abrirModelo(pagina, join(pastaModelos, nome));
        const e = await estado(pagina);
        confere(e.triangulos > 0 && !e.erroVisivel, `${nome}: ${e.triangulos} triângulos, ${e.naTela} na tela, ${(ms / 1000).toFixed(1)} s, ${e.totalMB.toFixed(0)} MB`, e.erroVisivel);
        await pagina.screenshot({ path: join(RESULTADOS, `modelo-${nome}.png`) });
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
