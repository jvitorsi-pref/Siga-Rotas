/**
 * TESTES DO MOTOR DE ROTEAMENTO
 * =============================
 *
 * Cobrem os cenÃ¡rios exigidos no escopo:
 *  - origem e destino no mesmo segmento;
 *  - rota entre ruas conectadas;
 *  - rota envolvendo trechos oficiais e nÃ£o oficiais;
 *  - rede desconectada (sem caminho viÃ¡vel);
 *  - origem/destino distante da rede;
 *  - coordenadas invÃ¡lidas;
 *  - caminho mais curto diferente da linha reta;
 *  - continuidade das arestas, ordem da geometria e consistÃªncia da distÃ¢ncia.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGraph } from '../src/core/graph.js';
import { routeOnGraph, validatePathContinuity } from '../src/core/router.js';
import { project, unproject, haversine } from '../src/core/geo.js';
import { feature, official, unofficial, loadRealFeatures } from './helpers.js';

const BASE = [-46.545, -23.66];
// Metros por grau no paralelo de Santo AndrÃ© (~23,66Â°S):
//   longitude: 111.320 * cos(23,66Â°) ~ 101.990 m/grau
//   latitude : 110.574 m/grau
const M_PER_DEG_LON = 101990;
const M_PER_DEG_LAT = 110574;
const mLon = 1 / M_PER_DEG_LON;
const mLat = 1 / M_PER_DEG_LAT;

/* ------------------------------------------------------------------ */
/* CENÃRIO 1 â€” origem e destino no mesmo segmento                       */
/* ------------------------------------------------------------------ */

test('origem e destino no mesmo segmento produzem a fraÃ§Ã£o do trecho', () => {
  const features = [
    feature(official(1, 'RUA LONGA'), [
      [BASE[0] - 200 * mLon, BASE[1]],
      [BASE[0] + 200 * mLon, BASE[1]],
    ]),
  ];
  const g = buildGraph(features);

  const origem = { lon: BASE[0] - 50 * mLon, lat: BASE[1] };
  const destino = { lon: BASE[0] + 50 * mLon, lat: BASE[1] };

  const r = routeOnGraph(g, origem, destino);
  assert.equal(r.ok, true, r.message);
  assert.ok(Math.abs(r.distance - 100) < 3, `distÃ¢ncia ${r.distance} deve ser ~100 m`);
  assert.equal(r.legs.length, 1, 'deve percorrer um Ãºnico trecho');
  assert.equal(r.legs[0].street, 'RUA LONGA');
});

test('origem e destino no mesmo segmento, na mesma direÃ§Ã£o invertida', () => {
  const features = [
    feature(official(1, 'RUA LONGA'), [
      [BASE[0] - 200 * mLon, BASE[1]],
      [BASE[0] + 200 * mLon, BASE[1]],
    ]),
  ];
  const g = buildGraph(features);
  const r = routeOnGraph(
    g,
    { lon: BASE[0] + 50 * mLon, lat: BASE[1] },
    { lon: BASE[0] - 50 * mLon, lat: BASE[1] }
  );
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.distance - 100) < 3);
});

/* ------------------------------------------------------------------ */
/* CENÃRIO 2 â€” rota entre ruas conectadas                              */
/* ------------------------------------------------------------------ */

test('rota entre duas ruas que se cruzam usa a rede viÃ¡ria', () => {
  const features = [
    feature(official(1, 'RUA HORIZONTAL'), [
      [BASE[0] - 100 * mLon, BASE[1]],
      [BASE[0] + 100 * mLon, BASE[1]],
    ]),
    feature(official(2, 'RUA VERTICAL'), [
      [BASE[0], BASE[1] - 100 * mLat],
      [BASE[0], BASE[1] + 100 * mLat],
    ]),
  ];
  const g = buildGraph(features);

  const r = routeOnGraph(
    g,
    { lon: BASE[0] - 50 * mLon, lat: BASE[1] },
    { lon: BASE[0], lat: BASE[1] + 50 * mLat }
  );

  assert.equal(r.ok, true, r.message);
  // o caminho real sÃ£o 50 m na horizontal + 50 m na vertical
  assert.ok(Math.abs(r.distance - 100) < 3, `distÃ¢ncia ${r.distance} deve ser ~100 m`);
  assert.deepEqual(r.streets, ['RUA HORIZONTAL', 'RUA VERTICAL']);
});

/* ------------------------------------------------------------------ */
/* CENÃRIO 3 â€” trechos oficiais e nÃ£o oficiais                          */
/* ------------------------------------------------------------------ */

test('rota pode combinar logradouros oficiais e nÃ£o oficializados', () => {
  const features = [
    feature(unofficial(1, 'RUA NÃƒO OFICIALIZADA'), [
      [BASE[0] - 100 * mLon, BASE[1]],
      [BASE[0], BASE[1]],
    ]),
    feature(official(2, 'RUA OFICIAL'), [
      [BASE[0], BASE[1]],
      [BASE[0] + 100 * mLon, BASE[1]],
    ]),
  ];
  const g = buildGraph(features);

  const r = routeOnGraph(
    g,
    { lon: BASE[0] - 50 * mLon, lat: BASE[1] },
    { lon: BASE[0] + 50 * mLon, lat: BASE[1] }
  );

  assert.equal(r.ok, true, r.message);
  assert.equal(r.legs.length, 2);
  assert.equal(r.legs[0].official, false, 'o primeiro trecho deve ser nÃ£o oficial');
  assert.equal(r.legs[1].official, true, 'o segundo trecho deve ser oficial');
  assert.ok(Math.abs(r.distance - 100) < 4);
});

test('eixo nÃ£o oficializado pode ser excluÃ­do do cÃ¡lculo', () => {
  const features = [
    feature(unofficial(1, 'RUA NÃƒO OFICIALIZADA'), [
      [BASE[0] - 100 * mLon, BASE[1]],
      [BASE[0], BASE[1]],
    ]),
    feature(official(2, 'RUA OFICIAL'), [
      [BASE[0], BASE[1]],
      [BASE[0] + 100 * mLon, BASE[1]],
    ]),
  ];
  const g = buildGraph(features, { includeUnofficialAxes: false });
  const r = routeOnGraph(
    g,
    { lon: BASE[0] - 50 * mLon, lat: BASE[1] },
    { lon: BASE[0] + 50 * mLon, lat: BASE[1] }
  );
  // o trecho nÃ£o oficializado foi removido do grafo: a rota nÃ£o pode usÃ¡-lo.
  // A origem passa a se ajustar ao logradouro oficial que sobrou.
  assert.equal(r.ok, true, r.message);
  for (const leg of r.legs) {
    assert.notEqual(leg.street, 'RUA NÃƒO OFICIALIZADA');
  }
  assert.ok(
    r.origin.distanceToNetwork > 40,
    `a origem deve se ajustar mais longe Ã  rede (${r.origin.distanceToNetwork} m)`
  );
});

/* ------------------------------------------------------------------ */
/* CENÃRIO 4 â€” rede desconectada                                       */
/* ------------------------------------------------------------------ */

test('rede desconectada informa ausÃªncia de caminho viÃ¡vel', () => {
  const features = [
    feature(official(1, 'RUA A'), [
      [BASE[0] - 50 * mLon, BASE[1]],
      [BASE[0] + 50 * mLon, BASE[1]],
    ]),
    feature(official(2, 'RUA B'), [
      [BASE[0] + 0.02, BASE[1] + 0.02],
      [BASE[0] + 0.03, BASE[1] + 0.02],
    ]),
  ];
  const g = buildGraph(features);

  const r = routeOnGraph(
    g,
    { lon: BASE[0], lat: BASE[1] },
    { lon: BASE[0] + 0.025, lat: BASE[1] + 0.02 }
  );

  assert.equal(r.ok, false);
  assert.equal(r.reason, 'SEM_CAMINHO');
  assert.match(r.message, /caminho/i);
});

/* ------------------------------------------------------------------ */
/* CENÃRIO 5 â€” pontos distantes da rede                                 */
/* ------------------------------------------------------------------ */

test('origem distante da rede Ã© recusada com a distÃ¢ncia medida', () => {
  const features = [
    feature(official(1, 'RUA'), [
      [BASE[0] - 50 * mLon, BASE[1]],
      [BASE[0] + 50 * mLon, BASE[1]],
    ]),
  ];
  const g = buildGraph(features);

  const r = routeOnGraph(
    g,
    { lon: BASE[0], lat: BASE[1] + 0.005 }, // ~500 m ao norte
    { lon: BASE[0] + 10 * mLon, lat: BASE[1] }
  );

  assert.equal(r.ok, false);
  assert.equal(r.reason, 'FORA_DA_REDE');
  assert.equal(r.side, 'origem');
  assert.ok(r.distanceToNetwork > 400, `distÃ¢ncia informada ${r.distanceToNetwork}`);
});

test('ponto fora da Ã¡rea coberta pela rede Ã© recusado', () => {
  const features = [
    feature(official(1, 'RUA'), [
      [BASE[0] - 50 * mLon, BASE[1]],
      [BASE[0] + 50 * mLon, BASE[1]],
    ]),
  ];
  const g = buildGraph(features);
  const r = routeOnGraph(
    g,
    { lon: -46.2, lat: -23.4 }, // ~40 km de distÃ¢ncia
    { lon: BASE[0], lat: BASE[1] }
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'FORA_DA_REDE');
  assert.ok(r.distanceToNetwork > 1000);
});

/* ------------------------------------------------------------------ */
/* CENÃRIO 6 â€” coordenadas invÃ¡lidas                                   */
/* ------------------------------------------------------------------ */

test('coordenadas invÃ¡lidas sÃ£o rejeitadas com mensagem clara', () => {
  const features = [
    feature(official(1, 'RUA'), [
      [BASE[0] - 50 * mLon, BASE[1]],
      [BASE[0] + 50 * mLon, BASE[1]],
    ]),
  ];
  const g = buildGraph(features);

  const casos = [
    [{ lon: NaN, lat: BASE[1] }, { lon: BASE[0], lat: BASE[1] }],
    [{ lon: BASE[0], lat: 'abc' }, { lon: BASE[0], lat: BASE[1] }],
    [{ lon: 999, lat: 999 }, { lon: BASE[0], lat: BASE[1] }],
    [{ lon: -200, lat: BASE[1] }, { lon: BASE[0], lat: BASE[1] }],
    [{ lon: BASE[0], lat: 120 }, { lon: BASE[0], lat: BASE[1] }],
    [null, { lon: BASE[0], lat: BASE[1] }],
  ];

  for (const [o, d] of casos) {
    const r = routeOnGraph(g, o, d);
    assert.equal(r.ok, false, `deveria rejeitar ${JSON.stringify(o)}`);
    assert.equal(r.reason, 'COORDENADA_INVALIDA');
  }
});

/* ------------------------------------------------------------------ */
/* CENÃRIO 7 â€” o caminho mais curto nÃ£o Ã© a linha reta                   */
/* ------------------------------------------------------------------ */

test('rota em rede em "U" Ã© bem mais longa que a linha reta', () => {
  // Duas ruas paralelas ligadas por uma transversal: o caminho viÃ¡rio
  // obriga a dar a volta, enquanto a linha reta cortaria o quarteirÃ£o.
  const features = [
    feature(official(1, 'RUA SUPERIOR'), [
      [BASE[0] - 50 * mLon, BASE[1]],
      [BASE[0] + 50 * mLon, BASE[1]],
    ]),
    feature(official(2, 'RUA INFERIOR'), [
      [BASE[0] - 50 * mLon, BASE[1] + 100 * mLon],
      [BASE[0] + 50 * mLon, BASE[1] + 100 * mLat],
    ]),
    feature(official(3, 'RUA TRANSVERSAL'), [
      [BASE[0] + 50 * mLon, BASE[1]],
      [BASE[0] + 50 * mLon, BASE[1] + 100 * mLat],
    ]),
  ];
  const g = buildGraph(features);

  const origem = { lon: BASE[0] - 30 * mLon, lat: BASE[1] };
  const destino = { lon: BASE[0] + 30 * mLon, lat: BASE[1] + 100 * mLat };

  const r = routeOnGraph(g, origem, destino);
  assert.equal(r.ok, true, r.message);

  const linhaReta = haversine(origem.lon, origem.lat, destino.lon, destino.lat);
  assert.ok(
    r.distance > linhaReta * 1.5,
    `a rota viÃ¡ria (${r.distance} m) deve ser bem maior que a linha reta (${linhaReta} m)`
  );
  assert.ok(r.distance > 200, `a rota deve incluir o desvio de ~200 m (${r.distance} m)`);
});

/* ------------------------------------------------------------------ */
/* CENÃRIO 8 â€” integridade do resultado                                */
/* ------------------------------------------------------------------ */

test('a rota devolvida tem arestas conectadas, geometria ordenada e soma coerente', () => {
  const features = [
    feature(official(1, 'RUA HORIZONTAL'), [
      [BASE[0] - 100 * mLon, BASE[1]],
      [BASE[0] + 100 * mLon, BASE[1]],
    ]),
    feature(official(2, 'RUA VERTICAL'), [
      [BASE[0], BASE[1] - 100 * mLat],
      [BASE[0], BASE[1] + 100 * mLat],
    ]),
    feature(official(3, 'RUA DIAGONAL'), [
      [BASE[0] + 100 * mLon, BASE[1]],
      [BASE[0] + 150 * mLon, BASE[1] + 50 * mLon],
    ]),
  ];
  const g = buildGraph(features);
  const r = routeOnGraph(
    g,
    { lon: BASE[0] - 50 * mLon, lat: BASE[1] },
    { lon: BASE[0] + 120 * mLon, lat: BASE[1] + 20 * mLat }
  );

  assert.equal(r.ok, true, r.message);

  // 1) a soma dos trechos equivale Ã  distÃ¢ncia total
  const soma = r.legs.reduce((s, l) => s + l.length, 0);
  assert.ok(Math.abs(soma - r.distance) < 1e-6, `soma ${soma} vs distÃ¢ncia ${r.distance}`);

  // 2) a geometria final comeÃ§a na origem projetada e termina no destino projetado
  const coords = r.geometry.coordinates;
  assert.ok(coords.length >= 2);
  const inicio = coords[0];
  const fim = coords[coords.length - 1];
  assert.ok(
    haversine(inicio[0], inicio[1], r.origin.snapped.lon, r.origin.snapped.lat) < 0.5,
    'a geometria deve comeÃ§ar no ponto projetado da origem'
  );
  assert.ok(
    haversine(fim[0], fim[1], r.destination.snapped.lon, r.destination.snapped.lat) < 0.5,
    'a geometria deve terminar no ponto projetado do destino'
  );

  // 3) continuidade entre trechos: o fim de um trecho Ã© o comeÃ§o do seguinte
  for (const leg of r.legs) {
    assert.ok(leg.coords.length >= 2, 'cada trecho deve ter ao menos dois vÃ©rtices');
  }
  for (let i = 1; i < r.legs.length; i++) {
    const a = r.legs[i - 1].coords;
    const b = r.legs[i].coords;
    const d = haversine(a[a.length - 1][0], a[a.length - 1][1], b[0][0], b[0][1]);
    assert.ok(d < 1, `trecho ${i} comeÃ§a a ${d.toFixed(2)} m do fim do anterior`);
  }

  // 4) a geometria reconstruÃ­da tem a mesma extensÃ£o da rota
  let geod = 0;
  for (let i = 1; i < coords.length; i++) {
    geod += haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  assert.ok(Math.abs(geod - r.distance) < 1, `geometria (${geod} m) vs rota (${r.distance} m)`);

  // 5) a geometria tem um vÃ©rtice a mais que a soma dos trechos (os pontos
  //    de junÃ§Ã£o sÃ£o compartilhados): nenhum salto desconexo Ã© introduzido.
  const verticesDosTrechos = r.legs.reduce((s, l) => s + l.coords.length, 0);
  assert.equal(coords.length, verticesDosTrechos - (r.legs.length - 1));
});

test('a rota nunca usa a linha reta como substituto do trajeto viÃ¡rio', () => {
  const features = [
    feature(official(1, 'RUA A'), [
      [BASE[0] - 50 * mLon, BASE[1]],
      [BASE[0] + 50 * mLon, BASE[1]],
    ]),
    feature(official(2, 'RUA B'), [
      [BASE[0] + 0.02, BASE[1] + 0.02],
      [BASE[0] + 0.03, BASE[1] + 0.02],
    ]),
  ];
  const g = buildGraph(features);
  const r = routeOnGraph(
    g,
    { lon: BASE[0], lat: BASE[1] },
    { lon: BASE[0] + 0.025, lat: BASE[1] + 0.02 }
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'SEM_CAMINHO', 'nÃ£o pode haver rota reta entre componentes separados');
});

/* ------------------------------------------------------------------ */
/* CENÃRIO 9 â€” integraÃ§Ã£o com a rede real                               */
/* ------------------------------------------------------------------ */

test('rede real: rota entre dois pontos do centro de Santo AndrÃ©', () => {
  const g = buildGraph(loadRealFeatures());

  const r = routeOnGraph(
    g,
    { lon: -46.5449, lat: -23.66 },
    { lon: -46.52, lat: -23.65 }
  );

  assert.equal(r.ok, true, r.message);
  assert.ok(r.distance > 1000 && r.distance < 8000, `distÃ¢ncia ${r.distance}`);
  assert.ok(r.legs.length > 1);
  assert.ok(r.streets.length > 0);
  // todos os trechos tÃªm nome de logradouro vindo dos atributos confirmados
  for (const leg of r.legs) {
    assert.ok(leg.street, 'todo trecho deve ter logradouro');
    assert.ok(['RUA', 'AVN', 'TRV', 'PCA', 'EST', 'LGO', 'ALM', 'PRQ', 'VID', 'PSL', 'CAM', 'ROD'].includes(leg.type),
      `tipo de logradouro inesperado: ${leg.type}`);
  }
});

test('rede real: o trajeto Ã© contÃ­nuo e a distÃ¢ncia bate com a soma dos trechos', () => {
  const g = buildGraph(loadRealFeatures());
  const r = routeOnGraph(
    g,
    { lon: -46.5451, lat: -23.661 },
    { lon: -46.533, lat: -23.669 }
  );

  assert.equal(r.ok, true, r.message);

  // continuidade: cada trecho termina onde o prÃ³ximo comeÃ§a
  for (let i = 1; i < r.legs.length; i++) {
    const a = r.legs[i - 1].coords;
    const b = r.legs[i].coords;
    const d = haversine(a[a.length - 1][0], a[a.length - 1][1], b[0][0], b[0][1]);
    assert.ok(d < 1.0, `trecho ${i} comeÃ§a a ${d.toFixed(2)} m do fim do anterior`);
  }

  const soma = r.legs.reduce((s, l) => s + l.length, 0);
  assert.ok(Math.abs(soma - r.distance) < 1e-6);

  // a geometria projetada reconstrÃ³i a mesma distÃ¢ncia
  const coords = r.geometry.coordinates;
  let geod = 0;
  for (let i = 1; i < coords.length; i++) {
    geod += haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  assert.ok(Math.abs(geod - r.distance) < 1, `geometria (${geod}) vs distÃ¢ncia (${r.distance})`);
});

test('a rota atravessa uma junÃ§Ã£o com 50 cm de lacuna e soma a lacuna', () => {
  // A rua A chega a 50 cm da rua B sem tocÃ¡-la. A rota deve atravessar a
  // junÃ§Ã£o pelo conector, sem dar a volta, e a distÃ¢ncia deve incluir a
  // lacuna percorrida.
  const features = [
    feature(official(1, 'RUA A'), [
      [BASE[0] - 100 * mLon, BASE[1]],
      [BASE[0] - 0.5 * mLon, BASE[1]],
    ]),
    feature(official(2, 'RUA B'), [
      [BASE[0], BASE[1] - 100 * mLat],
      [BASE[0], BASE[1] + 100 * mLat],
    ]),
  ];

  const semConector = buildGraph(features, { junctionTolerance: 0 });
  const rSem = routeOnGraph(
    semConector,
    { lon: BASE[0] - 50 * mLon, lat: BASE[1] },
    { lon: BASE[0], lat: BASE[1] + 50 * mLat }
  );
  assert.equal(rSem.ok, false, 'sem a junÃ§Ã£o nÃ£o pode existir caminho');

  const g = buildGraph(features);
  const r = routeOnGraph(
    g,
    { lon: BASE[0] - 50 * mLon, lat: BASE[1] },
    { lon: BASE[0], lat: BASE[1] + 50 * mLat }
  );

  assert.equal(r.ok, true, r.message);
  // 50 m em A + 0,5 m de conector + 50 m em B
  assert.ok(Math.abs(r.distance - 100.5) < 2,
    `distÃ¢ncia ${r.distance} deve ser ~100,5 m`);
  assert.ok(r.streets.includes('RUA B'), `ruas: ${r.streets.join(', ')}`);
});

test('A* e Dijkstra devolvem exatamente a mesma rota (A* Ã© Ã³timo)', () => {
  const g = buildGraph(loadRealFeatures());
  const origem = { lon: -46.5449, lat: -23.66 };
  const destino = { lon: -46.52, lat: -23.65 };

  const astar = routeOnGraph(g, origem, destino);
  const dijkstra = routeOnGraph(g, origem, destino, { algorithm: 'dijkstra' });

  assert.equal(astar.ok, true);
  assert.equal(dijkstra.ok, true);
  assert.equal(astar.distance, dijkstra.distance);
  assert.equal(astar.legs.length, dijkstra.legs.length);
  assert.deepEqual(astar.streets, dijkstra.streets);
});

test('rede real: a distÃ¢ncia da rota Ã© medida na projeÃ§Ã£o mÃ©trica', () => {
  const g = buildGraph(loadRealFeatures());
  // um trecho reto conhecido de ~100 m
  const e = g.edges.find((x) => x.length > 98 && x.length < 102 && x.coords.length === 2);
  assert.ok(e, 'deve existir uma aresta de ~100 m');
  const [x1, y1] = e.coords[0];
  const [x2, y2] = e.coords[1];
  const [lon1, lat1] = unproject(x1, y1);
  const [lon2, lat2] = unproject(x2, y2);
  const h = haversine(lon1, lat1, lon2, lat2);
  assert.ok(Math.abs(h - e.length) < 0.5, `haversine ${h} vs UTM ${e.length}`);
});

