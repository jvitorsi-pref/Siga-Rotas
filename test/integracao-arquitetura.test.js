import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { project, unproject } from '../core/geo.js';
import { NetworkService } from '../server/networkService.js';
import { createServer } from '../server/index.js';
import { criarClienteRede } from '../public/clienteRede.js';
import { MobileNetworkServiceCore } from '../APK/src/services/mobileNetworkServiceCore.js';
import { gerarGpxRota as gerarGpxApk } from '../APK/src/utils/gpx.js';
import { gerarGpxRota as gerarGpxWeb } from '../public/gpx.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [cx, cy] = project(-46.53, -23.66);
function pt(dx, dy) {
  const [lon, lat] = unproject(cx + dx, cy + dy);
  return { lon, lat, longitude: lon, latitude: lat };
}

function makeRoad(id, name, coords) {
  return {
    type: 'Feature',
    properties: {
      ID: id,
      COD_LOG: id * 10,
      TPO_LOGRADOURO: 'RUA',
      NOM_LOGRADOURO: name,
      DSC_LOGRADOURO: `RUA ${name}`,
    },
    geometry: {
      type: 'LineString',
      coordinates: coords.map(([dx, dy]) => {
        const p = pt(dx, dy);
        return [p.lon, p.lat];
      }),
    },
  };
}

function makeSyntheticFeatures(suffix = 'A') {
  return [
    makeRoad(1, `ALFA ${suffix}`, [[0, 0], [180, 0]]),
    makeRoad(2, `BETA ${suffix}`, [[180, 0], [180, 140]]),
    makeRoad(3, `GAMA ${suffix}`, [[180, 140], [0, 140]]),
    makeRoad(4, `DELTA ${suffix}`, [[0, 140], [0, 0]]),
  ];
}

function createMemoryStorage() {
  const map = new Map();
  return {
    async getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    async setItem(k, v) {
      map.set(k, String(v));
    },
    dump: map,
  };
}

function listenServer(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

function startMockWfsServer(initialFeatures) {
  let mode = 'ok';
  let features = initialFeatures;

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const requestType = u.searchParams.get('request') || '';

    if (mode === 'offline') {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('WFS temporariamente indisponivel');
      return;
    }

    if (requestType === 'DescribeFeatureType') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(
        '<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
          '<xsd:element name="ID"/><xsd:element name="COD_LOG"/><xsd:element name="DSC_LOGRADOURO"/>' +
          '</xsd:schema>',
      );
      return;
    }

    if (u.searchParams.get('resultType') === 'hits') {
      const total = mode === 'empty' ? features.length : features.length;
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(`<wfs:FeatureCollection numberMatched="${total}" />`);
      return;
    }

    const payloadFeatures = mode === 'empty' ? [] : features;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        type: 'FeatureCollection',
        totalFeatures: features.length,
        numberMatched: features.length,
        numberReturned: payloadFeatures.length,
        features: payloadFeatures,
      }),
    );
  });

  return {
    server,
    setMode(m) {
      mode = m;
    },
    setFeatures(f) {
      features = f;
    },
  };
}

test('Cenários 1 e 2: Backend Node.js prioriza WFS na carga, protege snapshot contra WFS inválido e cai para snapshot local se WFS falhar', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'siga-c12-'));
  const wfsMock = startMockWfsServer(makeSyntheticFeatures('WFS-OK'));
  try {
    const wfsPort = await listenServer(wfsMock.server);
    const wfsUrl = `http://127.0.0.1:${wfsPort}/geoserver/wfs`;
    const snapPath = path.join(dir, 'network.snapshot.json');

    // Cenário 1: WFS ativo (mesmo quando snapshot já existe) -> sobe em modo 'wfs' e atualiza snapshot
    writeFileSync(
      snapPath,
      JSON.stringify({
        savedAt: Date.now() - 1000,
        serverTotal: 4,
        strategy: 'single',
        features: makeSyntheticFeatures('SNAP-ANTIGO'),
      }),
    );

    const svcWfs = new NetworkService({
      snapshotPath: snapPath,
      allowWfs: true,
      baseUrl: wfsUrl,
      autoUpdate: { enabled: false },
    });
    const st1 = await svcWfs.ensureReady();
    assert.equal(st1.source, 'wfs');
    assert.equal(svcWfs.status().originMode, 'wfs');
    assert.equal(st1.features[0].properties.NOM_LOGRADOURO, 'ALFA WFS-OK');
    const snapGravado = JSON.parse(readFileSync(snapPath, 'utf8'));
    assert.equal(snapGravado.features[0].properties.NOM_LOGRADOURO, 'ALFA WFS-OK');

    // Refresh com WFS devolvendo payload vazio: NÃO destrói estado ativo nem sobrescreve snapshot
    wfsMock.setMode('empty');
    const refreshRes = await svcWfs.refresh();
    assert.equal(refreshRes.refreshFallback, true);
    assert.ok(refreshRes.refreshError);
    assert.equal(svcWfs.state.source, 'wfs');
    assert.equal(JSON.parse(readFileSync(snapPath, 'utf8')).features[0].properties.NOM_LOGRADOURO, 'ALFA WFS-OK');

    // Cenário 2: Boot com WFS indisponível -> cai automaticamente para snapshot local sem destruir snapshot
    wfsMock.setMode('offline');
    const svcFallback = new NetworkService({
      snapshotPath: snapPath,
      allowWfs: true,
      baseUrl: wfsUrl,
      autoUpdate: { enabled: false },
    });
    const st2 = await svcFallback.ensureReady();
    assert.equal(st2.source, 'snapshot');
    assert.equal(svcFallback.status().originMode, 'snapshot');
    assert.ok(st2.warnings.some((w) => /GeoServer WFS indisponível/i.test(w)));
    assert.ok(svcFallback.status().lastWfsError);
  } finally {
    await closeServer(wfsMock.server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Cenários 3 e 4: Web/WebForms (iframe) consome Node.js via ApiProxy.ashx e não mascara API caída sem contingência explícita', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'siga-c34-'));
  const feats = makeSyntheticFeatures('NODE');
  const wfsMock = startMockWfsServer(feats);
  let nodeServer;
  try {
    const wfsPort = await listenServer(wfsMock.server);
    const snapPath = path.join(dir, 'network.snapshot.json');
    writeFileSync(
      snapPath,
      JSON.stringify({ savedAt: Date.now(), serverTotal: feats.length, strategy: 'single', features: feats }),
    );

    const ns = new NetworkService({
      snapshotPath: snapPath,
      allowWfs: true,
      baseUrl: `http://127.0.0.1:${wfsPort}/geoserver/wfs`,
      autoUpdate: { enabled: false },
    });

    nodeServer = createServer({ port: 0, host: '127.0.0.1', service: ns });
    const nodePort = await listenServer(nodeServer);

    // Simula WebForms IIS hospedando iframe em /SigaApp/SigaRotas/public/index.html + ../ApiProxy.ashx
    const pageHref = 'https://intranet.sa.sp.gov.br/SigaApp/SigaRotas/public/index.html';
    const proxyFetch = async (url, init = {}) => {
      const parsed = new URL(url, pageHref);
      if (parsed.pathname === '/SigaApp/SigaRotas/ApiProxy.ashx') {
        const endpoint = parsed.searchParams.get('endpoint') || '';
        const passthrough = new URLSearchParams(parsed.searchParams);
        passthrough.delete('endpoint');
        const qs = passthrough.toString();
        const target = `http://127.0.0.1:${nodePort}${endpoint}${qs ? (endpoint.includes('?') ? '&' : '?') + qs : ''}`;
        return fetch(target, { method: init.method || 'GET', headers: init.headers, body: init.body });
      }
      return new Response('Not Found', { status: 404 });
    };

    // Cenário 3: Node.js online -> WebForms opera 100% pelo servidor sem rodar grafo no cliente
    const clienteOnline = criarClienteRede({
      location: new URL(pageHref),
      fetchImpl: proxyFetch,
      globalConfig: { apiBase: '', proxyPath: '../ApiProxy.ashx', allowLocalFallback: false },
    });
    const resolucao = await clienteOnline.resolverModo();
    assert.equal(resolucao.modo, 'servidor');
    assert.equal(resolucao.transport, 'ashx');

    const netRes = await clienteOnline.fetchApi('/api/network');
    assert.equal(netRes.ok, true);
    const rede = await netRes.json();
    assert.equal(rede.meta.originMode, 'wfs');

    const a = pt(10, 0);
    const b = pt(180, 100);
    const rotaRes = await clienteOnline.fetchApi('/api/rota-paradas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pontos: [
          { rotulo: 'A', longitude: a.lon, latitude: a.lat },
          { rotulo: 'B', longitude: b.lon, latitude: b.lat },
        ],
        modo: 'usuario',
        circular: true,
      }),
    });
    assert.equal(rotaRes.ok, true);
    const rotaWeb = await rotaRes.json();
    assert.equal(rotaWeb.ok, true);
    assert.equal(rotaWeb.circular, true);
    assert.ok(rotaWeb.distance > 500);

    const gpxWeb = gerarGpxWeb(rotaWeb, { agora: new Date('2026-11-16T12:00:00Z') });
    assert.match(gpxWeb, /<gpx[\s\S]*<\/gpx>/);

    // Cenário 4: Node.js offline -> expõe erro explícito (503 / API_INDISPONIVEL) sem mascarar com cálculo local
    await closeServer(nodeServer);
    nodeServer = null;

    const clienteOffline = criarClienteRede({
      href: 'https://intranet.sa.sp.gov.br/SigaApp/SigaRotas/public/index.html',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ ok: false, reason: 'API_INDISPONIVEL', message: 'Backend Node.js offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
      globalConfig: { apiBase: '', proxyPath: '../ApiProxy.ashx', allowLocalFallback: false },
    });
    const modoOffline = await clienteOffline.resolverModo();
    assert.equal(modoOffline.modo, 'indisponivel');
    const netOffline = await clienteOffline.fetchApi('/api/network');
    assert.equal(netOffline.status, 503);
    const bodyOffline = await netOffline.json();
    assert.equal(bodyOffline.reason, 'API_INDISPONIVEL');
  } finally {
    await closeServer(nodeServer);
    await closeServer(wfsMock.server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Cenários 5, 6 e 7: APK online (Node.js) -> offline (cache/snapshot local) -> reconexão e paridade Web/APK/GPX', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'siga-c567-'));
  const featsV1 = makeSyntheticFeatures('V1');
  const featsV2 = makeSyntheticFeatures('V2');
  const wfsMock = startMockWfsServer(featsV1);
  let nodeServer;
  try {
    const wfsPort = await listenServer(wfsMock.server);
    const wfsUrl = `http://127.0.0.1:${wfsPort}/geoserver/wfs`;
    const snapPath = path.join(dir, 'network.snapshot.json');
    writeFileSync(
      snapPath,
      JSON.stringify({ savedAt: Date.now(), serverTotal: featsV1.length, strategy: 'single', features: featsV1 }),
    );

    const ns1 = new NetworkService({
      snapshotPath: snapPath,
      allowWfs: true,
      baseUrl: wfsUrl,
      autoUpdate: { enabled: false },
    });
    nodeServer = createServer({ port: 0, host: '127.0.0.1', service: ns1 });
    const port = await listenServer(nodeServer);
    const apiUrl = `http://127.0.0.1:${port}`;

    const storage = createMemoryStorage();
    const apk = new MobileNetworkServiceCore({
      storage,
      embeddedSnapshot: { savedAt: 1000, serverTotal: featsV1.length, strategy: 'single', features: featsV1 },
      remoteApiUrl: apiUrl,
      fetchImpl: fetch,
      allowWfs: false,
      autoUpdate: { enabled: false },
    });

    // Cenário 5: APK online consome servidor Node.js real e bate 100% com cliente Web
    const stApk = await apk.ensureReady();
    assert.equal(stApk.source, 'api-node');
    assert.equal(apk.getNetworkMeta().remoteApi.online, true);
    assert.equal(apk.getNetworkMeta().remoteApi.execution, 'remote');
    assert.equal(apk.getNetworkMeta().remoteApi.backendSource, 'wfs');

    const a = pt(10, 0);
    const b = pt(180, 100);
    const stops = [
      { rotulo: 'A', longitude: a.lon, latitude: a.lat },
      { rotulo: 'B', longitude: b.lon, latitude: b.lat },
    ];

    const clienteWeb = criarClienteRede({
      href: 'https://web.siga.local/index.html',
      apiBase: apiUrl,
      fetchImpl: fetch,
    });

    const [rotaApkOnline, rotaWebRes] = await Promise.all([
      apk.calcularRotaParadas(stops, { modo: 'usuario', circular: true }),
      clienteWeb.fetchApi('/api/rota-paradas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pontos: stops, modo: 'usuario', circular: true }),
      }),
    ]);
    const rotaWeb = await rotaWebRes.json();
    assert.equal(rotaApkOnline.ok, true);
    assert.equal(rotaApkOnline.distance.toFixed(6), rotaWeb.distance.toFixed(6));
    assert.deepEqual(rotaApkOnline.streets, rotaWeb.streets);
    assert.deepEqual(rotaApkOnline.geometry, rotaWeb.geometry);

    const [endApk, endWebRes] = await Promise.all([
      apk.resolverEnderecoDigital('8FP9+J6'),
      clienteWeb.fetchApi('/api/endereco-digital?modo=local&codigo=8FP9%2BJ6'),
    ]);
    const endWeb = await endWebRes.json();
    assert.deepEqual(endApk, endWeb);

    // Cenário 6: Servidor Node.js sai do ar -> APK cai automaticamente para cache/snapshot local
    await closeServer(nodeServer);
    nodeServer = null;

    const rotaApkOffline = await apk.calcularRotaParadas(stops, { modo: 'usuario', circular: true });
    assert.equal(rotaApkOffline.ok, true);
    assert.equal(rotaApkOffline.distance.toFixed(6), rotaWeb.distance.toFixed(6));
    assert.deepEqual(rotaApkOffline.geometry, rotaWeb.geometry);
    assert.equal(apk.getNetworkMeta().remoteApi.online, false);
    assert.equal(apk.getNetworkMeta().remoteApi.execution, 'local-fallback');
    assert.equal(apk.getNetworkMeta().remoteApi.pendingSyncCount, 1);

    // GPX export continua funcional offline e idêntico ao Web
    const agora = new Date('2026-11-16T12:00:00Z');
    const gpxApk = gerarGpxApk(rotaApkOffline, { agora });
    const gpxWebParidade = gerarGpxWeb(rotaWeb, { agora });
    assert.match(gpxApk, /<gpx[\s\S]*<\/gpx>/);
    assert.equal(gpxApk, gpxWebParidade);

    // Cenário 7: Servidor Node.js volta ao ar (agora em fallback snapshot com V2) -> APK sincroniza na reconexão
    wfsMock.setMode('offline');
    writeFileSync(
      snapPath,
      JSON.stringify({ savedAt: Date.now() + 5000, serverTotal: featsV2.length, strategy: 'single', features: featsV2 }),
    );
    const ns2 = new NetworkService({
      snapshotPath: snapPath,
      allowWfs: true,
      baseUrl: wfsUrl,
      autoUpdate: { enabled: false },
    });
    nodeServer = createServer({ port, host: '127.0.0.1', service: ns2 });
    await listenServer(nodeServer, port);

    const sync = await apk.syncWithServer();
    assert.equal(sync.synced, true);
    assert.equal(sync.changed, true);
    assert.equal(sync.pendingFlushed, 1);
    assert.equal(sync.backendSource, 'snapshot');
    assert.equal(apk.state.features[0].properties.NOM_LOGRADOURO, 'ALFA V2');
    assert.equal(apk.getNetworkMeta().remoteApi.online, true);
    assert.equal(apk.getNetworkMeta().remoteApi.execution, 'remote');
    assert.equal(apk.getNetworkMeta().remoteApi.pendingSyncCount, 0);
  } finally {
    await closeServer(nodeServer);
    await closeServer(wfsMock.server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Paridade de snapshots entre data/, public/ e APK/ e existência dos artefatos Windows/WebForms', async () => {
  const dataSnap = JSON.parse(readFileSync(path.join(ROOT, 'data', 'network.snapshot.json'), 'utf8'));
  const apkSnap = JSON.parse(readFileSync(path.join(ROOT, 'APK', 'src', 'data', 'network.snapshot.json'), 'utf8'));
  const pubSnapMod = await import('../public/network.snapshot.js');
  const pubSnap = pubSnapMod.default;

  assert.equal(dataSnap.features.length, pubSnap.features.length);
  assert.equal(dataSnap.features.length, apkSnap.features.length);
  assert.equal(dataSnap.savedAt, pubSnap.savedAt);
  assert.equal(dataSnap.savedAt, apkSnap.savedAt);
  assert.equal(JSON.stringify(dataSnap.features), JSON.stringify(apkSnap.features));

  for (const rel of [
    'webforms/ApiProxy.ashx',
    'webforms/README-WEBFORMS.md',
    'public/config.js',
    'scripts/siga-node.ps1',
    'scripts/siga-node.cmd',
    'APK/src/config/apiConfig.js',
  ]) {
    assert.equal(existsSync(path.join(ROOT, rel)), true, `Artefato ausente: ${rel}`);
  }
});
