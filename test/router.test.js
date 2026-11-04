/**
 * TESTES DO MOTOR DE ROTEAMENTO
 * =============================
 *
 * Cobrem os cenários exigidos no escopo:
 *  - origem e destino no mesmo segmento;
 *  - rota entre ruas conectadas;
 *  - rota envolvendo trechos oficiais e não oficiais;
 *  - rede desconectada (sem caminho viável);
 *  - origem/destino distante da rede;
 *  - coordenadas inválidas;
 *  - caminho mais curto diferente da linha reta;
 *  - continuidade das arestas, ordem da geometria e consistência da distância.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGraph } from '../core/graph.js';
import { routeOnGraph, validatePathContinuity } from '../core/router.js';
import { project, unproject, haversine } from '../core/geo.js';
import { feature, official, unofficial, loadRealFeatures } from './helpers.js';

const BASE = [-46.545, -23.66];
// Metros por grau no paralelo de Santo André (~23,66°S):
//   longitude: 111.320 * cos(23,66°) ~ 101.990 m/grau
//   latitude : 110.574 m/grau
const M_PER_DEG_LON = 101990;
const M_PER_DEG_LAT = 110574;
const mLon = 1 / M_PER_DEG_LON;
const mLat = 1 / M_PER_DEG_LAT;

/* ------------------------------------------------------------------ */
/* CENÁRIO 1 — origem e destino no mesmo segmento                       */
/* ------------------------------------------------------------------ */

test('origem e destino no mesmo segmento produzem a fração do trecho', () => {
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
  assert.ok(Math.abs(r.distance - 100) < 3, `distância ${r.distance} deve ser ~100 m`);
  assert.equal(r.legs.length, 1, 'deve percorrer um único trecho');
  assert.equal(r.legs[0].street, 'RUA LONGA');
});

test('origem e destino no mesmo segmento, na mesma direção invertida', () => {
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
/* CENÁRIO 2 — rota entre ruas conectadas                              */
/* ------------------------------------------------------------------ */

test('rota entre duas ruas que se cruzam usa a rede viária', () => {
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
  // o caminho real são 50 m na horizontal + 50 m na vertical
  assert.ok(Math.abs(r.distance - 100) < 3, `distância ${r.distance} deve ser ~100 m`);
  assert.deepEqual(r.streets, ['RUA HORIZONTAL', 'RUA VERTICAL']);
});

/* ------------------------------------------------------------------ */
/* CENÁRIO 3 — trechos oficiais e não oficiais                          */
/* ------------------------------------------------------------------ */

test('rota pode combinar logradouros oficiais e não oficializados', () => {
  const features = [
    feature(unofficial(1, 'RUA NÃO OFICIALIZADA'), [
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
  assert.equal(r.legs[0].official, false, 'o primeiro trecho deve ser não oficial');
  assert.equal(r.legs[1].official, true, 'o segundo trecho deve ser oficial');
  assert.ok(Math.abs(r.distance - 100) < 4);
});

test('eixo não oficializado pode ser excluído do cálculo', () => {
  const features = [
    feature(unofficial(1, 'RUA NÃO OFICIALIZADA'), [
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
  // o trecho não oficializado foi removido do grafo: a rota não pode usá-lo.
  // A origem passa a se ajustar ao logradouro oficial que sobrou.
  assert.equal(r.ok, true, r.message);
  for (const leg of r.legs) {
    assert.notEqual(leg.street, 'RUA NÃO OFICIALIZADA');
  }
  assert.ok(
    r.origin.distanceToNetwork > 40,
    `a origem deve se ajustar mais longe à rede (${r.origin.distanceToNetwork} m)`
  );
});

/* ------------------------------------------------------------------ */
/* CENÁRIO 4 — rede desconectada                                       */
/* ------------------------------------------------------------------ */

test('rede desconectada informa ausência de caminho viável', () => {
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
/* CENÁRIO 5 — pontos distantes da rede                                 */
/* ------------------------------------------------------------------ */

test('origem distante da rede é recusada com a distância medida', () => {
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
  assert.ok(r.distanceToNetwork > 400, `distância informada ${r.distanceToNetwork}`);
});

test('ponto fora da área coberta pela rede é recusado', () => {
  const features = [
    feature(official(1, 'RUA'), [
      [BASE[0] - 50 * mLon, BASE[1]],
      [BASE[0] + 50 * mLon, BASE[1]],
    ]),
  ];
  const g = buildGraph(features);
  const r = routeOnGraph(
    g,
    { lon: -46.2, lat: -23.4 }, // ~40 km de distância
    { lon: BASE[0], lat: BASE[1] }
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'FORA_DA_REDE');
  assert.ok(r.distanceToNetwork > 1000);
});

/* ------------------------------------------------------------------ */
/* CENÁRIO 6 — coordenadas inválidas                                   */
/* ------------------------------------------------------------------ */

test('coordenadas inválidas são rejeitadas com mensagem clara', () => {
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
/* CENÁRIO 7 — o caminho mais curto não é a linha reta                   */
/* ------------------------------------------------------------------ */

test('rota em rede em "U" é bem mais longa que a linha reta', () => {
  // Duas ruas paralelas ligadas por uma transversal: o caminho viário
  // obriga a dar a volta, enquanto a linha reta cortaria o quarteirão.
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
    `a rota viária (${r.distance} m) deve ser bem maior que a linha reta (${linhaReta} m)`
  );
  assert.ok(r.distance > 200, `a rota deve incluir o desvio de ~200 m (${r.distance} m)`);
});

/* ------------------------------------------------------------------ */
/* CENÁRIO 8 — integridade do resultado                                */
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

  // 1) a soma dos trechos equivale à distância total
  const soma = r.legs.reduce((s, l) => s + l.length, 0);
  assert.ok(Math.abs(soma - r.distance) < 1e-6, `soma ${soma} vs distância ${r.distance}`);

  // 2) a geometria final começa na origem projetada e termina no destino projetado
  const coords = r.geometry.coordinates;
  assert.ok(coords.length >= 2);
  const inicio = coords[0];
  const fim = coords[coords.length - 1];
  assert.ok(
    haversine(inicio[0], inicio[1], r.origin.snapped.lon, r.origin.snapped.lat) < 0.5,
    'a geometria deve começar no ponto projetado da origem'
  );
  assert.ok(
    haversine(fim[0], fim[1], r.destination.snapped.lon, r.destination.snapped.lat) < 0.5,
    'a geometria deve terminar no ponto projetado do destino'
  );

  // 3) continuidade entre trechos: o fim de um trecho é o começo do seguinte
  for (const leg of r.legs) {
    assert.ok(leg.coords.length >= 2, 'cada trecho deve ter ao menos dois vértices');
  }
  for (let i = 1; i < r.legs.length; i++) {
    const a = r.legs[i - 1].coords;
    const b = r.legs[i].coords;
    const d = haversine(a[a.length - 1][0], a[a.length - 1][1], b[0][0], b[0][1]);
    assert.ok(d < 1, `trecho ${i} começa a ${d.toFixed(2)} m do fim do anterior`);
  }

  // 4) a geometria reconstruída tem a mesma extensão da rota
  let geod = 0;
  for (let i = 1; i < coords.length; i++) {
    geod += haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  assert.ok(Math.abs(geod - r.distance) < 1, `geometria (${geod} m) vs rota (${r.distance} m)`);

  // 5) a geometria tem um vértice a mais que a soma dos trechos (os pontos
  //    de junção são compartilhados): nenhum salto desconexo é introduzido.
  const verticesDosTrechos = r.legs.reduce((s, l) => s + l.coords.length, 0);
  assert.equal(coords.length, verticesDosTrechos - (r.legs.length - 1));
});

test('a rota nunca usa a linha reta como substituto do trajeto viário', () => {
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
  assert.equal(r.reason, 'SEM_CAMINHO', 'não pode haver rota reta entre componentes separados');
});

/* ------------------------------------------------------------------ */
/* CENÁRIO 9 — integração com a rede real                               */
/* ------------------------------------------------------------------ */

test('rede real: rota entre dois pontos do centro de Santo André', () => {
  const g = buildGraph(loadRealFeatures());

  const r = routeOnGraph(
    g,
    { lon: -46.5449, lat: -23.66 },
    { lon: -46.52, lat: -23.65 }
  );

  assert.equal(r.ok, true, r.message);
  assert.ok(r.distance > 1000 && r.distance < 8000, `distância ${r.distance}`);
  assert.ok(r.legs.length > 1);
  assert.ok(r.streets.length > 0);
  // todos os trechos têm nome de logradouro vindo dos atributos confirmados
  for (const leg of r.legs) {
    assert.ok(leg.street, 'todo trecho deve ter logradouro');
    assert.ok(['RUA', 'AVN', 'TRV', 'PCA', 'EST', 'LGO', 'ALM', 'PRQ', 'VID', 'PSL', 'CAM', 'ROD'].includes(leg.type),
      `tipo de logradouro inesperado: ${leg.type}`);
  }
});

test('rede real: o trajeto é contínuo e a distância bate com a soma dos trechos', () => {
  const g = buildGraph(loadRealFeatures());
  const r = routeOnGraph(
    g,
    { lon: -46.5451, lat: -23.661 },
    { lon: -46.533, lat: -23.669 }
  );

  assert.equal(r.ok, true, r.message);

  // continuidade: cada trecho termina onde o próximo começa
  for (let i = 1; i < r.legs.length; i++) {
    const a = r.legs[i - 1].coords;
    const b = r.legs[i].coords;
    const d = haversine(a[a.length - 1][0], a[a.length - 1][1], b[0][0], b[0][1]);
    assert.ok(d < 1.0, `trecho ${i} começa a ${d.toFixed(2)} m do fim do anterior`);
  }

  const soma = r.legs.reduce((s, l) => s + l.length, 0);
  assert.ok(Math.abs(soma - r.distance) < 1e-6);

  // a geometria projetada reconstrói a mesma distância
  const coords = r.geometry.coordinates;
  let geod = 0;
  for (let i = 1; i < coords.length; i++) {
    geod += haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  assert.ok(Math.abs(geod - r.distance) < 1, `geometria (${geod}) vs distância (${r.distance})`);
});

test('a rota atravessa uma junção com 50 cm de lacuna e soma a lacuna', () => {
  // A rua A chega a 50 cm da rua B sem tocá-la. A rota deve atravessar a
  // junção pelo conector, sem dar a volta, e a distância deve incluir a
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
  assert.equal(rSem.ok, false, 'sem a junção não pode existir caminho');

  const g = buildGraph(features);
  const r = routeOnGraph(
    g,
    { lon: BASE[0] - 50 * mLon, lat: BASE[1] },
    { lon: BASE[0], lat: BASE[1] + 50 * mLat }
  );

  assert.equal(r.ok, true, r.message);
  // 50 m em A + 0,5 m de conector + 50 m em B
  assert.ok(Math.abs(r.distance - 100.5) < 2,
    `distância ${r.distance} deve ser ~100,5 m`);
  assert.ok(r.streets.includes('RUA B'), `ruas: ${r.streets.join(', ')}`);
});

test('A* e Dijkstra devolvem exatamente a mesma rota (A* é ótimo)', () => {
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

test('rede real: a distância da rota é medida na projeção métrica', () => {
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
