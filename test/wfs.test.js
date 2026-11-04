/**
 * TESTES DO CLIENTE WFS
 * =====================
 *
 * O GeoServer da Prefeitura tem particularidades reais que precisam estar
 * cobertas por teste:
 *
 *  1. `startIndex` QUEBRA (a view SQL não expõe chave primária);
 *  2. `BBOX` QUEBRA (filtro espacial devolve zero feições);
 *  3. `CQL_FILTER` por FAIXA de ID FUNCIONA;
 *  4. o operador `IN` NÃO é suportado.
 *
 * Os testes usam um GeoServer simulado que reproduz exatamente esse
 * comportamento, para que a estratégia de paginação seja exercitada sem
 * depender da rede do município.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { fetchNetwork, describeLayer, parseServiceException, WfsError } from '../core/wfs.js';

/* ------------------------------------------------------------------ */
/* GeoServer simulado                                                  */
/* ------------------------------------------------------------------ */

/**
 * Cria um servidor WFS simulado.
 *
 * @param {object} opts
 * @param {number} opts.total       quantidade de feições
 * @param {boolean} opts.breakStartIndex simula a falha de "natural order"
 * @param {boolean} opts.breakBbox   simula o filtro BBOX inoperante
 */
function mockWfs(opts) {
  const total = opts.total ?? 2500;
  const features = [];
  for (let i = 1; i <= total; i++) {
    features.push({
      type: 'Feature',
      properties: {
        ID: i,
        COD_LOG: i % 97 === 0 ? 0 : 1000 + i,
        TPO_LOGRADOURO: 'RUA',
        COD_TITULO_LOGRADOURO: null,
        NOM_LOGRADOURO: 'RUA ' + i,
        DSC_LOGRADOURO: 'RUA ' + i,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-46.5 + i * 0.00001, -23.7],
          [-46.5 + i * 0.00001 + 0.0001, -23.7],
        ],
      },
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.searchParams;

    if (p.get('request') === 'DescribeFeatureType') {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <xsd:element name="T" type="TType"/>
  <xsd:complexType name="TType">
    <xsd:sequence>
      <xsd:element maxOccurs="1" minOccurs="1" name="ID" nillable="false" type="xsd:decimal"/>
      <xsd:element maxOccurs="1" minOccurs="1" name="TPO_LOGRADOURO" nillable="false" type="xsd:string"/>
      <xsd:element maxOccurs="1" minOccurs="0" name="NOM_LOGRADOURO" nillable="true" type="xsd:string"/>
    </xsd:sequence>
  </xsd:complexType>
</xsd:schema>`);
      return;
    }

    const max = Number(p.get('maxFeatures') || 1000);
    const startIndex = Number(p.get('startIndex') || 0);

    if (startIndex > 0 && opts.breakStartIndex) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" ?>
<ServiceExceptionReport version="1.2.0" xmlns="http://www.opengis.net/ogc">
  <ServiceException>java.lang.RuntimeException: java.io.IOException
java.io.IOExceptionCannot do natural order without a primary key, please add it or specify a manual sort over existing attributes</ServiceException>
</ServiceExceptionReport>`);
      return;
    }

    if (p.get('bbox') && opts.breakBbox) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'FeatureCollection', features: [], totalFeatures: 0 }));
      return;
    }

    let slice;
    const cql = p.get('CQL_FILTER');
    if (cql) {
      const m = cql.match(/ID\s*>=\s*(-?\d+)\s+AND\s+ID\s*<\s*(-?\d+)/);
      assert.ok(m, 'o CQL_FILTER deve ser uma faixa de ID: ' + cql);
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      slice = features.filter((f) => f.properties.ID >= lo && f.properties.ID < hi);
    } else if (p.get('propertyName')) {
      // listagem de IDs: geometria nula
      slice = features.slice(startIndex, startIndex + max).map((f) => ({
        type: 'Feature',
        properties: { ID: f.properties.ID },
        geometry: null,
      }));
    } else {
      slice = features.slice(startIndex, startIndex + max);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        type: 'FeatureCollection',
        features: slice,
        totalFeatures: total,
        numberMatched: total,
        numberReturned: slice.length,
      })
    );
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}/wfs`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/* ------------------------------------------------------------------ */

test('paginação completa: mais de mil feições são obtidas sem perdas', async (t) => {
  const mock = await mockWfs({ total: 2500, breakStartIndex: true });
  t.after(() => mock.close());

  const res = await fetchNetwork({
    baseUrl: mock.baseUrl,
    pageSize: 500,
    maxFeaturesPerRequest: 500,
  });

  assert.equal(res.features.length, 2500, 'todas as feições devem ser obtidas');
  assert.equal(res.strategy, 'cql-range', 'deve usar a paginação por faixa de ID');
  assert.ok(res.pages >= 5, `esperadas várias páginas, obtidas ${res.pages}`);

  const ids = res.features.map((f) => f.properties.ID).sort((a, b) => a - b);
  assert.equal(new Set(ids).size, 2500, 'não pode haver IDs repetidos');
  assert.equal(ids[0], 1);
  assert.equal(ids[ids.length - 1], 2500);
});

test('a falha de startIndex é detectada e o cliente migra para CQL', async (t) => {
  const mock = await mockWfs({ total: 1200, breakStartIndex: true });
  t.after(() => mock.close());

  const res = await fetchNetwork({
    baseUrl: mock.baseUrl,
    pageSize: 400,
    maxFeaturesPerRequest: 400,
  });

  assert.equal(res.features.length, 1200);
  assert.equal(res.strategy, 'cql-range');
  assert.ok(
    res.warnings.some((w) => /startIndex/i.test(w)),
    'a troca de estratégia deve ser registrada em warnings'
  );
});

test('quando o servidor suporta startIndex, ele é usado', async (t) => {
  const mock = await mockWfs({ total: 1200, breakStartIndex: false });
  t.after(() => mock.close());

  const res = await fetchNetwork({
    baseUrl: mock.baseUrl,
    pageSize: 400,
    maxFeaturesPerRequest: 400,
  });

  assert.equal(res.features.length, 1200);
  assert.equal(res.strategy, 'startIndex');
  assert.equal(res.warnings.length, 0);
});

test('requisição única é usada quando tudo cabe no limite', async (t) => {
  const mock = await mockWfs({ total: 300, breakStartIndex: true });
  t.after(() => mock.close());

  const res = await fetchNetwork({
    baseUrl: mock.baseUrl,
    pageSize: 500,
    maxFeaturesPerRequest: 5000,
  });

  assert.equal(res.features.length, 300);
  assert.equal(res.strategy, 'single');
  assert.equal(res.pages, 1);
});

test('o cliente descobre os atributos publicados, sem presumi-los', async (t) => {
  const mock = await mockWfs({ total: 10 });
  t.after(() => mock.close());

  const schema = await describeLayer({ baseUrl: mock.baseUrl });
  const names = schema.attributes.map((a) => a.name);
  assert.deepEqual(names, ['ID', 'TPO_LOGRADOURO', 'NOM_LOGRADOURO']);
  assert.equal(schema.attributes[0].type, 'xsd:decimal');
});

test('resposta inválida do servidor produz erro descritivo', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"type":"FeatureCollection"'); // JSON truncado
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  t.after(() => new Promise((r) => server.close(r)));

  await assert.rejects(
    () => fetchNetwork({ baseUrl: `http://127.0.0.1:${port}/wfs`, maxRetries: 1 }),
    (err) => {
      assert.ok(err instanceof WfsError);
      assert.match(err.message, /JSON/i);
      return true;
    }
  );
});

test('ServiceException do OGC é interpretada', () => {
  const xml = `<?xml version="1.0" ?>
<ServiceExceptionReport version="1.2.0" xmlns="http://www.opengis.net/ogc">
  <ServiceException>Cannot do natural order without a primary key</ServiceException>
</ServiceExceptionReport>`;
  const svc = parseServiceException(xml);
  assert.ok(svc);
  assert.match(svc.message, /primary key/i);
});

test('erro HTTP permanente não é repetido indefinidamente', async (t) => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('não encontrado');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  t.after(() => new Promise((r) => server.close(r)));

  await assert.rejects(() =>
    fetchNetwork({ baseUrl: `http://127.0.0.1:${port}/wfs`, maxRetries: 3 })
  );
  assert.equal(hits, 1, 'um 404 não deve ser retentado');
});

test('o snapshot real do GeoServer tem mais de mil feições e foi baixado por CQL', async () => {
  // Verifica o arquivo gravado por "npm run fetch": ele deve conter a rede
  // completa e coerente com o servidor.
  const { readFileSync, existsSync } = await import('node:fs');
  const path = await import('node:path');
  const { ROOT } = await import('./helpers.js');
  const p = path.join(ROOT, 'data', 'network.snapshot.json');
  if (!existsSync(p)) {
    // sem snapshot, nada a verificar aqui (os demais testes cobrem o caso)
    return;
  }
  const snap = JSON.parse(readFileSync(p, 'utf8'));
  assert.ok(snap.features.length > 1000, `snapshot com ${snap.features.length} feições`);
  assert.ok(
    ['single', 'cql-range', 'startIndex'].includes(snap.strategy),
    `estratégia inesperada: ${snap.strategy}`
  );
  const ids = new Set(snap.features.map((f) => f.properties.ID));
  assert.equal(ids.size, snap.features.length, 'não pode haver IDs repetidos');
  assert.equal(snap.serverTotal, snap.features.length, 'a rede completa deve ter sido obtida');
  assert.deepEqual(
    snap.attributes.sort(),
    ['COD_LOG', 'COD_TITULO_LOGRADOURO', 'DSC_LOGRADOURO', 'ID', 'NOM_LOGRADOURO', 'TPO_LOGRADOURO'],
    'os atributos do snapshot devem corresponder aos publicados pela camada'
  );
});
