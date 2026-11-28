// Service worker: deixa o app instalável e funcionando offline com o que já foi baixado.
// Arquivos do app: busca na rede primeiro (para as atualizações chegarem logo) e usa
// a cópia guardada quando estiver sem internet.
// Bibliotecas do CDN: têm versão fixa, então a cópia guardada vale para sempre.

const VERSAO = 'v0.0.5'; // igual a js/config.js (um teste confere)
const CACHE_APP = `fatiador-app-${VERSAO}`;
const CACHE_CDN = 'fatiador-cdn';

const ARQUIVOS_APP = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/config.js',
  'js/core/armazenamento.js',
  'js/core/capacidade.js',
  'js/core/historico.js',
  'js/core/malha.js',
  'js/core/memoria.js',
  'js/core/pacote.js',
  'js/core/pintura.js',
  'js/core/projeto.js',
  'js/core/projetos.js',
  'js/core/selecao.js',
  'js/core/simplificar.js',
  'js/core/tarefas.js',
  'js/io/3mf.js',
  'js/io/3mf-gravar.js',
  'js/io/obj.js',
  'js/io/pintura-bambu.js',
  'js/io/stl.js',
  'js/io/texto.js',
  'js/io/xml-simples.js',
  'js/io/zip-gravar.js',
  'js/io/zip-indice.js',
  'js/ops/filamento.js',
  'js/ops/index.js',
  'js/ops/pintura-trocar.js',
  'js/ui/atalhos.js',
  'js/ui/dialogo-projetos.js',
  'js/ui/gestos.js',
  'js/ui/painel-historico.js',
  'js/ui/painel-selecao.js',
  'js/ui/paineis.js',
  'js/ui/propriedades.js',
  'js/ui/visualizador.js',
  'js/workers/carregar.js',
  'assets/icones/icone.svg',
  'assets/icones/icone-192.png',
  'assets/icones/icone-512.png',
  'assets/icones/icone-maskable-512.png',
];

const ARQUIVOS_CDN = [
  'https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.core.js',
  'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/controls/OrbitControls.js',
  'https://cdn.jsdelivr.net/npm/meshoptimizer@1.3.0/meshopt_simplifier.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const app = await caches.open(CACHE_APP);
    await app.addAll(ARQUIVOS_APP);
    const cdn = await caches.open(CACHE_CDN);
    // Se o CDN falhar agora, as bibliotecas são guardadas no primeiro uso.
    await Promise.all(ARQUIVOS_CDN.map(async (url) => {
      if (await cdn.match(url)) return;
      try {
        // No máximo 15 s por biblioteca: internet ruim não pode travar a instalação.
        const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (resp.ok) await cdn.put(url, resp);
      } catch { /* fica para depois */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const nome of await caches.keys()) {
      if (nome.startsWith('fatiador-app-') && nome !== CACHE_APP) await caches.delete(nome);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(redePrimeiro(req));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(guardadoPrimeiro(req));
  }
});

async function redePrimeiro(req) {
  const cache = await caches.open(CACHE_APP);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (erro) {
    const guardado = await cache.match(req, { ignoreSearch: true });
    if (guardado) return guardado;
    if (req.mode === 'navigate') {
      const inicio = await cache.match('./');
      if (inicio) return inicio;
    }
    throw erro;
  }
}

async function guardadoPrimeiro(req) {
  const cache = await caches.open(CACHE_CDN);
  const guardado = await cache.match(req);
  if (guardado) return guardado;
  const resp = await fetch(req);
  if (resp.ok) cache.put(req, resp.clone());
  return resp;
}
