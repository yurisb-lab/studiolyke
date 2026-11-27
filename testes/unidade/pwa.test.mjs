// Confere o app instalável (PWA) e as versões fixas das bibliotecas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSAO, CDN } from '../../js/config.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ler = (c) => readFileSync(join(RAIZ, c), 'utf8');

function arquivosJs(pasta) {
  const lista = [];
  for (const nome of readdirSync(join(RAIZ, pasta))) {
    const c = join(pasta, nome);
    if (statSync(join(RAIZ, c)).isDirectory()) lista.push(...arquivosJs(c));
    else if (nome.endsWith('.js')) lista.push(c.replaceAll('\\', '/'));
  }
  return lista;
}

test('versão igual no config, no service worker e na página', () => {
  const sw = ler('sw.js');
  assert.match(sw, new RegExp(`const VERSAO = '${VERSAO.replaceAll('.', '\\.')}'`));
  assert.ok(ler('index.html').includes(`>${VERSAO}<`));
});

test('service worker guarda todos os arquivos do app (para funcionar offline)', () => {
  const sw = ler('sw.js');
  const lista = [...sw.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]).filter((c) => !c.startsWith('http'));
  for (const c of lista) if (c !== './') assert.ok(existsSync(join(RAIZ, c)), `${c} não existe`);
  for (const js of arquivosJs('js')) assert.ok(lista.includes(js), `${js} falta no sw.js`);
});

test('manifest válido com ícones que existem', () => {
  const m = JSON.parse(ler('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  const tamanhos = m.icons.map((i) => i.sizes);
  assert.ok(tamanhos.includes('192x192') && tamanhos.includes('512x512'));
  for (const i of m.icons) assert.ok(existsSync(join(RAIZ, i.src)), i.src);
});

test('bibliotecas do CDN com versão fixa e iguais ao package.json dos testes', () => {
  const pkg = JSON.parse(ler('package.json'));
  const html = ler('index.html');
  const sw = ler('sw.js');
  const todos = [...Object.values(CDN), ...html.matchAll(/https:\/\/cdn\.jsdelivr\.net\/[^"']+/g), ...sw.matchAll(/https:\/\/cdn\.jsdelivr\.net\/[^"']+/g)].map(String);
  for (const url of todos) {
    const m = /\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\//.exec(url);
    assert.ok(m, `sem versão: ${url}`);
    assert.match(m[2], /^\d+\.\d+\.\d+$/, `versão não fixa: ${url}`);
    assert.equal(pkg.devDependencies[m[1]], m[2], `${m[1]} difere do package.json`);
  }
});

test('só caminhos relativos (o app pode mudar de endereço)', () => {
  const html = ler('index.html');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const c = m[1];
    if (c.startsWith('#') || c.startsWith('https://cdn.jsdelivr.net/')) continue;
    assert.ok(!c.startsWith('/') && !/^https?:/.test(c), `caminho absoluto: ${c}`);
  }
  for (const js of arquivosJs('js')) {
    assert.ok(!/github\.io/.test(ler(js)), `${js} depende do endereço do GitHub Pages`);
  }
});

test('nenhuma "senha" ou segredo no código', () => {
  for (const js of [...arquivosJs('js'), 'sw.js']) {
    const t = ler(js);
    assert.ok(!/(api[_-]?key|client_secret|password|senha\s*[:=])/i.test(t), `${js} parece ter segredo`);
  }
  assert.match(ler('js/config.js'), /GOOGLE_CLIENT_ID = '';/);
});
