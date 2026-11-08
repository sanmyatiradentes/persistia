// PersisteIA — service worker: deixa o app instalável e o estudo aberto disponível sem internet.
// Sempre busca a versão nova na rede; o guardado só entra quando não há conexão.
// Da API, guarda só o que é leitura do estudo (aula, plano, painel e revisão); nada de
// pagamento, login ou painel da gestora. Ao sair da conta, o app apaga o que foi guardado.
const CACHE = 'persisteia-v1';
const CACHE_API = 'persisteia-api';
const BASE = ['/', '/manifest.webmanifest', '/icone-192.png', '/logo-persisteia.png', '/css/leitura.css', '/js/leitura.js', '/conteudo/diario.js'];
const API_LEITURA = /^\/api\/(conteudo|cronograma|dashboard|revisao|aluno|flashcard)$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== CACHE_API).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => {
  if (e.data === 'limpar') caches.delete(CACHE_API);
});

function redePrimeiro(req, nomeCache, reserva) {
  return fetch(req)
    .then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(nomeCache).then(c => c.put(req, copia)); }
      return r;
    })
    .catch(() => caches.open(nomeCache).then(c => c.match(req)).then(r => r || (reserva ? caches.match(reserva) : Response.error())));
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (API_LEITURA.test(url.pathname) && !url.searchParams.has('finalizar') && !url.searchParams.has('refazer')) {
      e.respondWith(redePrimeiro(e.request, CACHE_API));
    }
    return;
  }
  e.respondWith(redePrimeiro(e.request, CACHE, e.request.mode === 'navigate' ? '/' : null));
});
