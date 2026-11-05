/* ==========================================================================
   public/sw.js — Service Worker (aplicativo utilizável sem conexão)
   --------------------------------------------------------------------------
   O que este arquivo faz — e, principalmente, o que ele NÃO faz:

     • guarda o "esqueleto" do aplicativo (HTML, CSS, JS) para que a
       aplicação abra mesmo sem rede;
     • NÃO guarda respostas de `/api/*`: a rede viária tem vários MB e muda
       com frequência, e o roteiro de dados coletados (sensíveis) não tem
       por que ficar duplicado no cache do navegador;
     • NÃO baixa tiles de mapas de terceiros: os tiles do OpenStreetMap
       têm política de uso e o download massivo depende de autorização.

   Estratégia: **rede primeiro, cache como reserva** (network-first). Com
   rede, o usuário sempre recebe a versão atual do aplicativo (sem risco de
   servir código velho); sem rede, o esqueleto salvo é usado.

   Os dados coletados (rota, pontos GPS, localizações) NÃO passam por aqui:
   ficam no IndexedDB, que é do aplicativo (`core/armazenamentoLocal.js`).
   ========================================================================== */

const CACHE = 'siga-rotas-v8';

/** Arquivos do esqueleto do aplicativo. */
const ESQUELETO = [
  '/',
  '/index.html',
  '/styles.css',
  '/logo-siga-app.png',
  '/app.js',
  '/coletaUI.js',
  '/planoPersistido.js',
  '/planejamentoCircuito.js',
  '/revisoesEndereco.js',
  '/resumoRota.js',
  '/navegacaoUI.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/vendor/ol/ol.js',
  '/vendor/ol/ol.css',
  '/core/pontoTrajeto.js',
  '/core/coresTrechos.js',
  '/core/enderecoDigital.js',
  '/core/geo.js',
  '/core/config.js',
  '/core/fonteGPS.js',
  '/core/simulador.js',
  '/core/instrucoes.js',
  '/core/navegacao.js',
  '/core/coleta.js',
  '/core/recuperacaoColeta.js',
  '/core/armazenamentoLocal.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `addAll` falha inteiro se um item não estiver disponível: cada item
      // é buscado individualmente para que a instalação nunca quebre.
      await Promise.all(
        ESQUELETO.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // recursos externos
  if (url.pathname.startsWith('/api/')) return; // a API nunca é cacheada
  if (url.pathname === '/sw.js') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const resposta = await fetch(req);
        if (resposta && resposta.ok) {
          cache.put(req, resposta.clone()).catch(() => null);
        }
        return resposta;
      } catch (e) {
        const guardada = await cache.match(req);
        if (guardada) return guardada;
        if (req.mode === 'navigate') {
          const pagina = await cache.match('/index.html');
          if (pagina) return pagina;
        }
        throw e;
      }
    })(),
  );
});
