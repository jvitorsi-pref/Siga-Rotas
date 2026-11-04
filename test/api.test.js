/**
 * TESTES DA API HTTP
 * ===================
 *
 * Exercitam o servidor de ponta a ponta usando o snapshot local (nenhuma
 * dependência da rede do município).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { createServer, parsePoint } from '../server/index.js';
import { ROOT } from './helpers.js';

async function startServer() {
  const server = createServer({
    networkOptions: {
      snapshotPath: path.join(ROOT, 'data', 'network.snapshot.json'),
      allowWfs: false,
      // TTL infinito: o teste quer "usar o snapshot local", e não "usar um
      // snapshot fresco". Sem isto o teste passaria a depender da hora em
      // que é executado.
      snapshotTtl: Number.MAX_SAFE_INTEGER,
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

/* ------------------------------------------------------------------ */

test('parsePoint aceita os formatos de entrada', () => {
  assert.deepEqual(parsePoint('-46.545,-23.660'), { lon: -46.545, lat: -23.66 });
  assert.deepEqual(parsePoint('-46.545 -23.660'), { lon: -46.545, lat: -23.66 });
  assert.deepEqual(parsePoint('-46.545;-23.660'), { lon: -46.545, lat: -23.66 });
  assert.deepEqual(parsePoint('{"lon":-46.5,"lat":-23.6}'), { lon: -46.5, lat: -23.6 });
  assert.equal(parsePoint('abc'), null);
  assert.equal(parsePoint(''), null);
  assert.equal(parsePoint('12'), null);
});

test('GET /api/health responde com o estado do cache', async (t) => {
  const s = await startServer();
  t.after(s.close);

  const res = await fetch(`${s.base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok('ready' in body);
});

test('GET /api/network devolve a rede completa em GeoJSON', async (t) => {
  const s = await startServer();
  t.after(s.close);

  const res = await fetch(`${s.base}/api/network`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'FeatureCollection');
  assert.ok(body.features.length > 1000, `recebidas ${body.features.length} feições`);
  assert.ok(body.meta.attributes.includes('DSC_LOGRADOURO'));
});

test('GET /api/route devolve a rota com distância e logradouros', async (t) => {
  const s = await startServer();
  t.after(s.close);

  const res = await fetch(
    `${s.base}/api/route?origin=-46.5449,-23.6600&destination=-46.5200,-23.6500`
  );
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.ok, true);
  assert.ok(body.distance > 0);
  assert.ok(body.distanceMeters > 0);
  assert.ok(body.distanceKm > 0);
  assert.equal(body.geometry.type, 'LineString');
  assert.ok(body.geometry.coordinates.length > 1);
  assert.ok(body.legs.length > 0);
  assert.ok(body.streets.length > 0);
  // a soma dos trechos bate com a distância total
  const soma = body.legs.reduce((s2, l) => s2 + l.length, 0);
  assert.ok(Math.abs(soma - body.distance) < 1e-6);
});

test('GET /api/route sem parâmetros responde 400 com mensagem', async (t) => {
  const s = await startServer();
  t.after(s.close);

  const res = await fetch(`${s.base}/api/route`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'PARAMETROS_INVALIDOS');
  assert.match(body.message, /longitude/i);
});

test('GET /api/route sem caminho viável responde 422', async (t) => {
  const s = await startServer();
  t.after(s.close);

  const res = await fetch(
    `${s.base}/api/route?origin=-46.40,-23.50&destination=-46.52,-23.65`
  );
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'FORA_DA_REDE');
});

test('GET /api/diagnostics expõe o diagnóstico do grafo', async (t) => {
  const s = await startServer();
  t.after(s.close);

  const res = await fetch(`${s.base}/api/diagnostics`);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.ok(d.nodes > 1000);
  assert.ok(d.edges > 1000);
  assert.ok(d.crossings > 0);
  assert.equal(d.junctionsLost, 0);
  assert.ok(d.components > 1);
  assert.ok(Array.isArray(d.attributes));
});

test('a aplicação estática é servida na raiz', async (t) => {
  const s = await startServer();
  t.after(s.close);

  const res = await fetch(`${s.base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Roteamento vi.rio de Santo Andr./i);
  assert.match(html, /vendor\/ol\/ol\.js/);
});

test('o OpenLayers está vendorizado localmente (funciona sem internet)', async (t) => {
  const s = await startServer();
  t.after(s.close);

  const res = await fetch(`${s.base}/vendor/ol/ol.js`);
  assert.equal(res.status, 200);
  const js = await res.text();
  assert.ok(js.length > 100000, 'o bundle do OpenLayers deve estar completo');

  const css = await fetch(`${s.base}/vendor/ol/ol.css`);
  assert.equal(css.status, 200);
});

test('a aplicação não referencia a API de roteamento externa', async (t) => {
  const s = await startServer();
  t.after(s.close);

  const res = await fetch(`${s.base}/app.js`);
  const js = await res.text();
  assert.ok(!/graphhopper|mapbox|osrm|openrouteservice/i.test(js),
    'a aplicação não pode depender de API de roteamento externa');
});
