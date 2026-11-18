import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { criarClienteRede, detectarConfiguracaoAmbiente } from '../public/clienteRede.js';
import { gerarGpxRota } from '../public/gpx.js';
import { loadRealFeatures, feature } from './helpers.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function snapshotSintetico() {
  return {
    savedAt: '2026-10-20T00:00:00.000Z',
    source: 'snapshot',
    strategy: 'single',
    serverTotal: 2,
    attributes: ['ID', 'NOM_LOGRADOURO'],
    warnings: [],
    features: [
      feature(
        { ID: 1, NOM_LOGRADOURO: 'Rua Alfa' },
        [
          [-46.5325, -23.6635],
          [-46.5315, -23.6635],
        ],
      ),
      feature(
        { ID: 2, NOM_LOGRADOURO: 'Rua Beta' },
        [
          [-46.5315, -23.6635],
          [-46.5315, -23.6625],
        ],
      ),
    ],
  };
}

test('detectarConfiguracaoAmbiente respeita precedência: opções > querystring > __SIGA_CONFIG__', () => {
  const cfg = detectarConfiguracaoAmbiente(
    { snapshotUrl: '../custom.json' },
    {
      pathname: '/SigaApp/SigaRotas/public/index.html',
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/public/index.html?apiBase=https://api.sa.gov.br/&wfsProxy=../WfsProxy.ashx',
      search: '?apiBase=https://api.sa.gov.br/&wfsProxy=../WfsProxy.ashx',
    },
    { apiBase: 'https://ignorado.local', snapshotUrl: '../ignorado.json' },
  );

  assert.equal(cfg.apiBase, 'https://api.sa.gov.br');
  assert.equal(cfg.wfsProxy, '../WfsProxy.ashx');
  assert.equal(cfg.snapshotUrl, '../custom.json');
  assert.equal(cfg.modo, 'servidor');
});

test('iframe WebForms estático (../../SigaApp/SigaRotas/public/index.html) entra em modo cliente sem sondar /api/health e calcula rota local', async () => {
  const urlsChamadas = [];
  const snapshotReal = {
    source: 'snapshot',
    strategy: 'single',
    features: loadRealFeatures(),
  };

  const cliente = criarClienteRede({
    location: {
      pathname: '/SigaApp/SigaRotas/public/index.html',
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/public/index.html',
      search: '',
    },
    fetchImpl: async (url) => {
      urlsChamadas.push(String(url));
      assert.equal(
        String(url),
        'https://portal.sa.gov.br/SigaApp/SigaRotas/data/network.snapshot.json',
      );
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => snapshotReal,
      };
    },
  });

  const modoRes = await cliente.resolverModo();
  assert.equal(modoRes.modo, 'cliente');
  assert.equal(urlsChamadas.length, 0, 'não deve causar 404 em /api/health dentro de /public/');

  const resNet = await cliente.fetchApi('/api/network');
  assert.equal(resNet.status, 200);
  const net = await resNet.json();
  assert.equal(net.type, 'FeatureCollection');
  assert.ok(net.features.length > 4000);
  assert.equal(net.meta.source, 'snapshot');
  assert.equal(urlsChamadas.length, 1);

  const resDiag = await cliente.fetchApi('/api/diagnostics');
  assert.equal(resDiag.status, 200);
  const diag = await resDiag.json();
  assert.ok(diag.nodes > 1000);
  assert.equal(urlsChamadas.length, 1, 'diagnóstico reaproveita o grafo já construído');

  const resEnd = await cliente.fetchApi('/api/endereco-digital?modo=local&codigo=8FP9%2BJ6');
  assert.equal(resEnd.status, 200);
  const end = await resEnd.json();
  assert.equal(end.ok, true);
  assert.equal(end.status, 'CONVERTIDO');
  assert.ok(Math.abs(end.latitude - -23.663) < 0.05);

  const resRota = await cliente.fetchApi('/api/rota-paradas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modo: 'otimizada',
      circular: true,
      pontos: [
        { rotulo: 'A', latitude: -23.6635, longitude: -46.5320 },
        { rotulo: 'B', latitude: -23.6650, longitude: -46.5300 },
        { rotulo: 'C', latitude: -23.6615, longitude: -46.5340 },
      ],
    }),
  });
  assert.equal(resRota.status, 200);
  const rota = await resRota.json();
  assert.equal(rota.ok, true);
  assert.equal(rota.circular, true);
  assert.ok(rota.distance > 0);
  assert.equal(rota.legs.length, 3);
  assert.ok(rota.geometry.coordinates.length > 4);
});

test('proxy reverso em subcaminho (/SigaApp/SigaRotas/) usa servidor quando /api/health responde JSON válido', async () => {
  const chamadas = [];
  const cliente = criarClienteRede({
    location: {
      pathname: '/SigaApp/SigaRotas/index.html',
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/index.html',
      search: '',
    },
    fetchImpl: async (url, init) => {
      chamadas.push({ url: String(url), init });
      if (String(url).endsWith('/SigaApp/SigaRotas/api/health')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json; charset=utf-8' },
          json: async () => ({ ready: true }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true, forwarded: true }),
      };
    },
  });

  const modoRes = await cliente.resolverModo();
  assert.equal(modoRes.modo, 'servidor');
  assert.equal(modoRes.apiPrefix, '/SigaApp/SigaRotas');

  const res = await cliente.fetchApi('/api/rota-paradas', {
    method: 'POST',
    body: '{"pontos":[]}',
  });
  const json = await res.json();
  assert.equal(json.forwarded, true);
  assert.equal(chamadas[1].url, '/SigaApp/SigaRotas/api/rota-paradas');
});

test('subcaminho sem Node (/api/health retorna HTML 404 do IIS) cai automaticamente para modo cliente', async () => {
  const snap = snapshotSintetico();
  const cliente = criarClienteRede({
    location: {
      pathname: '/SigaApp/SigaRotas/',
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/',
      search: '',
    },
    fetchImpl: async (url) => {
      if (String(url).includes('/api/health')) {
        return {
          ok: false,
          status: 404,
          headers: { get: () => 'text/html' },
          json: async () => {
            throw new Error('not json');
          },
        };
      }
      if (String(url).endsWith('/SigaApp/SigaRotas/data/network.snapshot.json')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => snap,
        };
      }
      return { ok: false, status: 404, headers: { get: () => 'text/plain' } };
    },
  });

  const modoRes = await cliente.resolverModo();
  assert.equal(modoRes.modo, 'cliente');

  const net = await (await cliente.fetchApi('/api/network')).json();
  assert.equal(net.features.length, 2);
});

test('?apiBase=... força modo servidor mesmo quando aberto em /public/index.html', async () => {
  const urls = [];
  const cliente = criarClienteRede({
    location: {
      pathname: '/SigaApp/SigaRotas/public/index.html',
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/public/index.html?apiBase=https://node.sa.gov.br:8094/',
      search: '?apiBase=https://node.sa.gov.br:8094/',
    },
    fetchImpl: async (url) => {
      urls.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ ready: true }),
      };
    },
  });

  const res = await cliente.fetchApi('/api/health');
  assert.equal((await res.json()).ready, true);
  assert.deepEqual(urls, ['https://node.sa.gov.br:8094/api/health']);
});

test('?wfsProxy relativo resolve contra location.href e cai no snapshot com aviso se WFS falhar', async () => {
  const snap = snapshotSintetico();
  const requisicoes = [];
  const cliente = criarClienteRede({
    location: {
      pathname: '/SigaApp/SigaRotas/public/index.html',
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/public/index.html?wfsProxy=../WfsProxy.ashx',
      search: '?wfsProxy=../WfsProxy.ashx',
    },
    fetchImpl: async (url) => {
      requisicoes.push(String(url));
      if (String(url).includes('/WfsProxy.ashx')) {
        return {
          ok: false,
          status: 502,
          headers: { get: () => 'application/json' },
          text: async () => '{"error":"bad gateway"}',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => snap,
      };
    },
  });

  const net = await (await cliente.fetchApi('/api/network')).json();
  assert.ok(
    requisicoes.some((u) => u.startsWith('https://portal.sa.gov.br/SigaApp/SigaRotas/WfsProxy.ashx?')),
    'wfsProxy relativo deve resolver na URL completa da aplicação',
  );
  assert.equal(net.features.length, 2);
  assert.equal(net.meta.source, 'snapshot');
  assert.ok(net.meta.warnings.some((w) => /Proxy WFS indisponível/i.test(w)));
});

test('integração estática WebForms: SW protegido para iframe/subpasta, navegacaoUI usa app.fetchApi e web.config mapeia MIME types', () => {
  const appSrc = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const navSrc = readFileSync(new URL('../public/navegacaoUI.js', import.meta.url), 'utf8');
  const webConfig = readFileSync(new URL('../web.config', import.meta.url), 'utf8');
  const ashx = readFileSync(new URL('../webforms/WfsProxy.ashx', import.meta.url), 'utf8');

  assert.match(appSrc, /const clienteRede = criarClienteRede\(\)/);
  assert.match(appSrc, /if \('serviceWorker' in navigator && window\.isSecureContext !== false && !emIframe && naRaiz\)/);
  assert.match(navSrc, /const fetchFn = typeof app\?\.fetchApi === 'function' \? app\.fetchApi : fetch;/);

  for (const ext of ['.json', '.geojson', '.webmanifest', '.js']) {
    assert.ok(webConfig.includes(`<remove fileExtension="${ext}" />`), ext);
    assert.ok(webConfig.includes(`<mimeMap fileExtension="${ext}"`), ext);
  }
  assert.match(ashx, /https:\/\/sigamapa\.santoandre\.sp\.gov\.br\/geoserver\/siga\/wfs/);
});

test('simulação HTTP estática estilo IIS/WebForms (<iframe src="../../SigaApp/SigaRotas/public/index.html">) carrega módulos, rede, rota e GPX sem Node API', async (t) => {
  const solicitadas = [];
  const naoEncontradas = [];
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
  };

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    solicitadas.push(pathname);

    if (pathname === '/Portal/Paginas/Mapa.aspx') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<div id="iframeContainer"><iframe src="../../SigaApp/SigaRotas/public/index.html" style="border:none;width:100%; min-height:700px; display: block;"></iframe></div>',
      );
      return;
    }

    const prefix = '/SigaApp/SigaRotas/';
    if (pathname.startsWith(prefix)) {
      const rel = pathname.slice(prefix.length);
      const abs = path.resolve(ROOT_DIR, rel);
      if (abs.startsWith(ROOT_DIR + path.sep) && existsSync(abs) && statSync(abs).isFile()) {
        const ext = path.extname(abs).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(abs));
        return;
      }
    }

    naoEncontradas.push(pathname);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 Not Found (IIS Static)</h1>');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const aspxRes = await fetch(`${base}/Portal/Paginas/Mapa.aspx`);
  assert.equal(aspxRes.status, 200);
  const aspxHtml = await aspxRes.text();
  const iframeSrc = aspxHtml.match(/<iframe\s+src="([^"]+)"/i)?.[1];
  assert.equal(iframeSrc, '../../SigaApp/SigaRotas/public/index.html');

  const iframeUrl = new URL(iframeSrc, `${base}/Portal/Paginas/Mapa.aspx`);
  assert.equal(iframeUrl.pathname, '/SigaApp/SigaRotas/public/index.html');

  // Todos os assets referenciados no HTML e o grafo ESM estático existem no servidor IIS simulado
  const indexRes = await fetch(iframeUrl.href);
  assert.equal(indexRes.status, 200);
  const indexHtml = await indexRes.text();
  const htmlRefs = [...indexHtml.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)]
    .map((m) => m[1])
    .filter((r) => !/^https?:/i.test(r));
  for (const rel of htmlRefs) {
    assert.equal(rel.startsWith('/'), false, `referência absoluta quebraria subpasta WebForms: ${rel}`);
    const assetRes = await fetch(new URL(rel, iframeUrl).href);
    assert.equal(assetRes.status, 200, `falha HTTP em asset do iframe: ${rel}`);
  }
  for (const mod of [
    './app.js',
    './clienteRede.js',
    '../core/pontoTrajeto.js',
    '../core/coresTrechos.js',
    '../core/graph.js',
    '../core/rotaParadas.js',
    '../core/enderecoDigitalService.js',
  ]) {
    const modRes = await fetch(new URL(mod, iframeUrl).href);
    assert.equal(modRes.status, 200, `módulo ESM ausente: ${mod}`);
    assert.match(modRes.headers.get('content-type') || '', /javascript/i);
  }

  // O clienteRede roda integralmente contra o servidor estático sem gerar qualquer 404
  const cliente = criarClienteRede({
    location: {
      pathname: iframeUrl.pathname,
      href: iframeUrl.href,
      search: iframeUrl.search,
    },
    fetchImpl: fetch,
  });

  const net = await (await cliente.fetchApi('/api/network')).json();
  assert.ok(net.features.length > 4000);
  const rota = await (
    await cliente.fetchApi('/api/rota-paradas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modo: 'otimizada',
        circular: true,
        pontos: [
          { rotulo: 'A', latitude: -23.6635, longitude: -46.5320 },
          { rotulo: 'B', latitude: -23.6650, longitude: -46.5300 },
          { rotulo: 'C', latitude: -23.6615, longitude: -46.5340 },
        ],
      }),
    })
  ).json();

  assert.equal(rota.ok, true);
  assert.equal(rota.circular, true);
  assert.ok(rota.geometry.coordinates.length > 4);
  const gpxXml = gerarGpxRota(rota);
  assert.match(gpxXml, /<gpx[^>]*version="1\.1"/);
  assert.deepEqual(naoEncontradas, [], 'não deve ocorrer nenhum 404 em /api/health ou /sw.js');
  assert.equal(solicitadas.includes('/api/health'), false);
  assert.equal(solicitadas.includes('/sw.js'), false);
});

test('quando IIS/ASP.NET devolve HTML (<!DOCTYPE ...) para .json, clienteRede cai automaticamente para public/network.snapshot.js', async () => {
  const cliente = criarClienteRede({
    location: {
      pathname: '/SigaApp/SigaRotas/public/index.html',
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/public/index.html',
      search: '',
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: 'https://portal.sa.gov.br/SigaApp/SigaRotas/Erro.aspx',
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => ' <!DOCTYPE html><html><head><title>Portal SIGA</title></head><body>Erro</body></html>',
    }),
  });

  const resNet = await cliente.fetchApi('/api/network');
  assert.equal(resNet.status, 200);
  const net = await resNet.json();
  assert.ok(net.features.length > 4000, 'deve carregar a rede real via fallback ESM');
  assert.deepEqual(net.meta.warnings, [], 'fallback bem-sucedido não deve gerar alerta vermelho');

  const resRota = await cliente.fetchApi('/api/rota-paradas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modo: 'usuario',
      circular: true,
      pontos: [
        { rotulo: 'A', latitude: -23.6635, longitude: -46.5320 },
        { rotulo: 'B', latitude: -23.6650, longitude: -46.5300 },
      ],
    }),
  });
  const rota = await resRota.json();
  assert.equal(rota.ok, true);
  assert.ok(rota.distance > 0);
});

test('snapshotUrl explícito que devolve HTML produz erro diagnóstico claro em vez de Unexpected token <', async () => {
  const cliente = criarClienteRede({
    location: {
      pathname: '/SigaApp/SigaRotas/public/index.html',
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/public/index.html?snapshotUrl=../custom.json',
      search: '?snapshotUrl=../custom.json',
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: 'https://portal.sa.gov.br/Login.aspx',
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => ' <!DOCTYPE html><html><head><title>Autenticação</title></head></html>',
    }),
  });

  await assert.rejects(
    () => cliente.fetchApi('/api/network'),
    /Login\.aspx.*devolveu HTML.*Autenticação/i,
  );
});

test('simulação HTTP estática no IIS sem pasta data/ e com customErrors HTML funciona via import(./network.snapshot.js)', async (t) => {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
  };

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const prefix = '/SigaApp/SigaRotas/';
    if (pathname.startsWith(prefix)) {
      const rel = pathname.slice(prefix.length);
      // Simula ambiente onde data/network.snapshot.json foi interceptado por .aspx HTML
      if (rel.startsWith('data/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(' <!DOCTYPE html><html><head><title>Erro customizado</title></head></html>');
        return;
      }
      const abs = path.resolve(ROOT_DIR, rel);
      if (abs.startsWith(ROOT_DIR + path.sep) && existsSync(abs) && statSync(abs).isFile()) {
        const ext = path.extname(abs).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(abs));
        return;
      }
    }
    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const iframeUrl = `${base}/SigaApp/SigaRotas/public/index.html`;

  const modHttpRes = await fetch(new URL('./network.snapshot.js', iframeUrl).href);
  assert.equal(modHttpRes.status, 200);
  assert.match(modHttpRes.headers.get('content-type') || '', /javascript/i);

  const cliente = criarClienteRede({
    location: {
      pathname: '/SigaApp/SigaRotas/public/index.html',
      href: iframeUrl,
      search: '',
    },
    fetchImpl: fetch,
  });

  const net = await (await cliente.fetchApi('/api/network')).json();
  assert.ok(net.features.length > 4000);
});

