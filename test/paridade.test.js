import test from 'node:test';
import assert from 'node:assert/strict';
import * as web from '../core/rotaParadas.js';
import * as mobile from '../APK/src/core/rotaParadas.js';
import { buildGraph } from '../core/graph.js';
import { project, unproject } from '../core/geo.js';
import { feature, official } from './helpers.js';

for (const name of ['config', 'enderecoDigital', 'enderecoDigitalService', 'geo', 'graph', 'pontoTrajeto', 'rotaParadas', 'router', 'spatialIndex']) {
  test(`Android e Web compartilham a implementação de ${name}`, async () => {
    const webModule = await import(`../core/${name}.js`);
    const nativeModule = await import(`../APK/src/core/${name}.js`);
    assert.deepEqual(Object.keys(nativeModule), Object.keys(webModule));
    for (const key of Object.keys(webModule)) assert.equal(nativeModule[key], webModule[key]);
  });
}

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
