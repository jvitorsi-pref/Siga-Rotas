import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as web from '../core/rotaParadas.js';
import * as mobile from '../APK/src/core/rotaParadas.js';
import { routeOnGraph } from '../core/router.js';
import { criarServicoEnderecoDigital, MODOS } from '../core/enderecoDigitalService.js';
import { buildGraph } from '../core/graph.js';
import { project, unproject } from '../core/geo.js';
import { createServer } from '../server/index.js';
import { feature, official, ROOT, loadRealFeatures } from './helpers.js';

for (const name of ['config', 'enderecoDigital', 'enderecoDigitalService', 'geo', 'graph', 'pontoTrajeto', 'rotaParadas', 'router', 'spatialIndex']) {
  test(`Android e Web compartilham a implementação de ${name}`, async () => {
    const webModule = await import(`../core/${name}.js`);
    const nativeModule = await import(`../APK/src/core/${name}.js`);
    assert.deepEqual(Object.keys(nativeModule), Object.keys(webModule));
    for (const key of Object.keys(webModule)) assert.equal(nativeModule[key], webModule[key]);
  });
}

test('Android e Web compartilham a configuração de camada base (OSM padrão / Satélite Esri)', async () => {
  const webModule = await import('../public/camadaBase.js');
  const nativeModule = await import('../APK/src/map/camadaBase.js');
  assert.deepEqual(Object.keys(nativeModule), Object.keys(webModule));
  for (const key of Object.keys(webModule)) assert.equal(nativeModule[key], webModule[key]);
});

const [x, y] = project(-46.545, -23.66);
const coord = (dx, dy) => unproject(x + dx, y + dy);
const features = [
  feature(official(1, 'PRINCIPAL'), [coord(0, 0), coord(400, 0)]),
  feature(official(2, 'RAMAL B'), [coord(100, 0), coord(100, 200)]),
  feature(official(3, 'RAMAL C'), [coord(300, 0), coord(300, 200)]),
];
const graph = buildGraph(features);
const pontos = [[0, 0], [300, 200], [100, 200], [400, 0]].map(([dx, dy], i) => {
  const [longitude, latitude] = coord(dx, dy);
  return { rotulo: String.fromCharCode(65 + i), longitude, latitude };
});
for (const modo of ['usuario', 'otimizada', 'saida_curta']) {
  for (const circular of [false, true]) {
    test(`Mesmo cenário Web/Android: ${modo}, circuito=${circular}`, () => {
      const options = { modo, circular };
      const expected = web.calcularRotaComParadas(graph, pontos, options);
      const actual = mobile.calcularRotaComParadas(graph, pontos, options);
      assert.equal(actual.ok, true);
      // Tempo de execução é telemetria, não resultado funcional.
      const functional = (value) => JSON.parse(JSON.stringify(value, (key, item) => key === 'ms' ? undefined : item));
      assert.deepEqual(functional(actual), functional(expected));
      assert.equal(actual.legs.length, circular ? pontos.length : pontos.length - 1);
      assert.ok(Math.abs(actual.distance - actual.legs.reduce((sum, leg) => sum + leg.distance, 0)) < 1e-6);
      if (circular) assert.equal(actual.legs.at(-1).para, 'A');
      for (const leg of actual.legs) {
        assert.ok(leg.geometry.coordinates.length >= 2);
        assert.match(leg.cor, /^#[0-9a-f]{6}$/i);
      }
    });
  }
}

test('Regressão de paridade: API HTTP Node.js e núcleo puro (Web/APK) devolvem rotas e CEP Digital idênticos na rede real', async (t) => {
  const server = createServer({
    networkOptions: {
      snapshotPath: path.join(ROOT, 'data', 'network.snapshot.json'),
      allowWfs: false,
      snapshotTtl: Number.MAX_SAFE_INTEGER,
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const realGraph = buildGraph(loadRealFeatures());
  const pontosReais = [
    { rotulo: 'A', latitude: -23.6639, longitude: -46.5333 },
    { rotulo: 'B', latitude: -23.6665, longitude: -46.5290 },
    { rotulo: 'C', latitude: -23.6612, longitude: -46.5301 },
  ];

  const stripMs = (value) => JSON.parse(JSON.stringify(value, (k, v) => (k === 'ms' ? undefined : v)));

  for (const modo of ['usuario', 'otimizada']) {
    const res = await fetch(`${base}/api/rota-paradas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pontos: pontosReais, modo, circular: true }),
    });
    assert.equal(res.status, 200);
    const apiBody = await res.json();
    const coreWeb = web.calcularRotaComParadas(realGraph, pontosReais, { modo, circular: true });
    const coreApk = mobile.calcularRotaComParadas(realGraph, pontosReais, { modo, circular: true });
    assert.deepEqual(stripMs(apiBody), stripMs(coreWeb));
    assert.deepEqual(stripMs(apiBody), stripMs(coreApk));
  }

  const simplesRes = await fetch(`${base}/api/route?origin=-46.5333,-23.6639&destination=-46.5290,-23.6665`);
  assert.equal(simplesRes.status, 200);
  const simplesApi = await simplesRes.json();
  const simplesCore = routeOnGraph(realGraph, { lon: -46.5333, lat: -23.6639 }, { lon: -46.5290, lat: -23.6665 });
  assert.deepEqual(stripMs(simplesApi), stripMs(simplesCore));

  const endSvc = criarServicoEnderecoDigital({ modo: MODOS.LOCAL });
  for (const codigo of ['8FP9+J6', '8FP8+CM', 'INVALIDO']) {
    const expected = await endSvc.resolver(codigo);
    const res = await fetch(`${base}/api/endereco-digital?modo=local&codigo=${encodeURIComponent(codigo)}`);
    const body = await res.json();
    assert.equal(body.ok, expected.ok);
    assert.equal(body.status, expected.status);
    assert.equal(body.latitude, expected.latitude);
    assert.equal(body.longitude, expected.longitude);
  }
});
