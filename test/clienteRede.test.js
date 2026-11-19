import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { criarClienteRede, detectarConfiguracaoAmbiente } from '../public/clienteRede.js';
import { gerarGpxRota } from '../public/gpx.js';
import { createServer } from '../server/index.js';
import { feature } from './helpers.js';

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
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/public/index.html?apiBase=https://api.sa.gov.br/&wfsProxy=../WfsProxy.ashx&apiProxy=../CustomProxy.ashx',
      search: '?apiBase=https://api.sa.gov.br/&wfsProxy=../WfsProxy.ashx&apiProxy=../CustomProxy.ashx',
    },
    { apiBase: 'https://ignorado.local', snapshotUrl: '../ignorado.json', allowLocalFallback: false },
  );

  assert.equal(cfg.apiBase, 'https://api.sa.gov.br');
  assert.equal(cfg.proxyPath, '../CustomProxy.ashx');
  assert.equal(cfg.wfsProxy, '../WfsProxy.ashx');
  assert.equal(cfg.snapshotUrl, '../custom.json');
  assert.equal(cfg.allowLocalFallback, false);
  assert.equal(cfg.modo, 'servidor');
});

test('iframe WebForms (../../SigaApp/SigaRotas/public/index.html) consome Node.js real via ApiProxy.ashx sem rodar grafo no navegador', async (t) => {
  const nodeServer = createServer({
    networkOptions: {
      snapshotPath: path.join(ROOT_DIR, 'data', 'network.snapshot.json'),
      allowWfs: false,
    },
  });
  await new Promise((resolve) => nodeServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => nodeServer.close(resolve)));
  const nodeBase = `http://127.0.0.1:${nodeServer.address().port}`;

  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
  };

  const chamadasProxy = [];
  const snapshotLocalPedido = [];

  const iisServer = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    const { pathname, searchParams } = reqUrl;

    if (pathname === '/Portal/Paginas/Mapa.aspx') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<div id="iframeContainer"><iframe src="../../SigaApp/SigaRotas/public/index.html" style="border:none;width:100%; min-height:700px; display: block;"></iframe></div>',
      );
      return;
    }

    // Simula exatamente webforms/ApiProxy.ashx encaminhando para 127.0.0.1:<porta_node>
    if (pathname === '/SigaApp/SigaRotas/ApiProxy.ashx') {
      const endpoint = searchParams.get('endpoint') || '';
      chamadasProxy.push(endpoint);
      const forwardQs = new URLSearchParams(searchParams);
      forwardQs.delete('endpoint');
      const destino = `${nodeBase}${endpoint}${forwardQs.toString() ? `?${forwardQs.toString()}` : ''}`;

      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);

      const upstream = await fetch(destino, {
        method: req.method,
        headers: req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : undefined,
        body: req.method === 'POST' ? body : undefined,
      });
      const respBuf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      });
      res.end(respBuf);
      return;
    }

    const prefix = '/SigaApp/SigaRotas/';
    if (pathname.startsWith(prefix)) {
      const rel = pathname.slice(prefix.length);
      if (rel.startsWith('data/') || rel === 'public/network.snapshot.js') {
        snapshotLocalPedido.push(rel);
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
    res.end('Not Found');
  });

  await new Promise((resolve) => iisServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => iisServer.close(resolve)));
  const iisBase = `http://127.0.0.1:${iisServer.address().port}`;

  const aspxHtml = await (await fetch(`${iisBase}/Portal/Paginas/Mapa.aspx`)).text();
  const iframeSrc = aspxHtml.match(/<iframe\s+src="([^"]+)"/i)?.[1];
  assert.equal(iframeSrc, '../../SigaApp/SigaRotas/public/index.html');
  const iframeUrl = new URL(iframeSrc, `${iisBase}/Portal/Paginas/Mapa.aspx`);

  // Verifica que todos os assets relativos do HTML (inclusive config.js) carregam sem '/' inicial
  const indexHtml = await (await fetch(iframeUrl.href)).text();
  const htmlRefs = [...indexHtml.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)]
    .map((m) => m[1])
    .filter((r) => !/^https?:/i.test(r));
  for (const rel of htmlRefs) {
    assert.equal(rel.startsWith('/'), false, `referência absoluta quebraria subpasta WebForms: ${rel}`);
    const assetRes = await fetch(new URL(rel, iframeUrl).href);
    assert.equal(assetRes.status, 200, `falha HTTP em asset do iframe: ${rel}`);
  }

  const cliente = criarClienteRede({
    location: {
      pathname: iframeUrl.pathname,
      href: iframeUrl.href,
      search: iframeUrl.search,
    },
    fetchImpl: fetch,
  });

  const modo = await cliente.resolverModo();
  assert.equal(modo.modo, 'servidor');
  assert.equal(modo.transport, 'ashx');

  const net = await (await cliente.fetchApi('/api/network')).json();
  assert.equal(net.type, 'FeatureCollection');
  assert.ok(net.features.length > 4000);
  assert.equal(net.meta.originMode, 'snapshot');

  const end = await (await cliente.fetchApi('/api/endereco-digital?modo=local&codigo=8FP9%2BJ6')).json();
  assert.equal(end.ok, true);
  assert.equal(end.status, 'CONVERTIDO');

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
  assert.equal(rota.legs.length, 3);
  const gpxXml = gerarGpxRota(rota);
  assert.match(gpxXml, /<gpx[^>]*version="1\.1"/);

  assert.deepEqual(snapshotLocalPedido, [], 'navegador NÃO pode baixar snapshot local como caminho principal');
  assert.deepEqual(chamadasProxy, ['/api/health', '/api/network', '/api/endereco-digital', '/api/rota-paradas']);
});

test('iframe WebForms com API Node.js indisponível NÃO mascara falha com roteamento local por padrão', async () => {
  const cliente = criarClienteRede({
    location: {
      pathname: '/SigaApp/SigaRotas/public/index.html',
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/public/index.html',
      search: '',
    },
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: false, reason: 'API_INDISPONIVEL' }),
    }),
  });

  const modoRes = await cliente.resolverModo();
  assert.equal(modoRes.modo, 'indisponivel');

  const resNet = await cliente.fetchApi('/api/network');
  assert.equal(resNet.status, 503);
  const body = await resNet.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'API_INDISPONIVEL');
  assert.match(body.message, /Node\.js/i);
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

test('contingência local explícita (?modo=cliente / allowLocalFallback) preserva snapshot, wfsProxy e fallback ESM', async () => {
  const snap = snapshotSintetico();
  const requisicoes = [];
  const cliente = criarClienteRede({
    location: {
      pathname: '/SigaApp/SigaRotas/public/index.html',
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/public/index.html?modo=cliente&wfsProxy=../WfsProxy.ashx',
      search: '?modo=cliente&wfsProxy=../WfsProxy.ashx',
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
  assert.equal(net.meta.fallbackActive, true);
  assert.ok(net.meta.warnings.some((w) => /Proxy WFS indisponível/i.test(w)));
});

test('quando IIS/ASP.NET devolve HTML para .json em contingência explícita (?fallback=local), clienteRede cai para public/network.snapshot.js', async () => {
  const cliente = criarClienteRede({
    location: {
      pathname: '/SigaApp/SigaRotas/public/index.html',
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/public/index.html?fallback=local',
      search: '?fallback=local',
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
      href: 'https://portal.sa.gov.br/SigaApp/SigaRotas/public/index.html?modo=cliente&snapshotUrl=../custom.json',
      search: '?modo=cliente&snapshotUrl=../custom.json',
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

test('integração WebForms: ApiProxy.ashx encaminha endpoints permitidos e config.js declara fallback desativado por padrão', () => {
  const appSrc = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const navSrc = readFileSync(new URL('../public/navegacaoUI.js', import.meta.url), 'utf8');
  const configSrc = readFileSync(new URL('../public/config.js', import.meta.url), 'utf8');
  const webConfig = readFileSync(new URL('../web.config', import.meta.url), 'utf8');
  const apiProxyAshx = readFileSync(new URL('../webforms/ApiProxy.ashx', import.meta.url), 'utf8');
  const wfsProxyAshx = readFileSync(new URL('../webforms/WfsProxy.ashx', import.meta.url), 'utf8');

  assert.match(appSrc, /const clienteRede = criarClienteRede\(\)/);
  assert.match(appSrc, /if \('serviceWorker' in navigator && window\.isSecureContext !== false && !emIframe && naRaiz\)/);
  assert.match(navSrc, /const fetchFn = typeof app\?\.fetchApi === 'function' \? app\.fetchApi : fetch;/);
  assert.match(configSrc, /proxyPath:\s*'\.\.\/ApiProxy\.ashx'/);
  assert.match(configSrc, /allowLocalFallback:\s*false/);

  for (const ext of ['.json', '.geojson', '.webmanifest', '.js']) {
    assert.ok(webConfig.includes(`<remove fileExtension="${ext}" />`), ext);
    assert.ok(webConfig.includes(`<mimeMap fileExtension="${ext}"`), ext);
  }
  for (const ep of ['/api/health', '/api/network', '/api/route', '/api/rota-paradas', '/api/endereco-digital', '/api/diagnostics']) {
    assert.ok(apiProxyAshx.includes(`"${ep}"`), ep);
  }
  assert.match(apiProxyAshx, /SigaRotas\.NodeApiBase/);
  assert.match(wfsProxyAshx, /https:\/\/sigamapa\.santoandre\.sp\.gov\.br\/geoserver\/siga\/wfs/);
});
