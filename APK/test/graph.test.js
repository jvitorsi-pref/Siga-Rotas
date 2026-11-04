/**
 * TESTES DA CONSTRUÃ‡ÃƒO DO GRAFO
 * ==============================
 *
 * Cobrem os cenÃ¡rios exigidos no escopo:
 *  - nÃ³s e arestas a partir de interseÃ§Ãµes reais;
 *  - tolerÃ¢ncia de junÃ§Ã£o (snap) em extremidades com pequenos desvios;
 *  - recusa de junÃ§Ã£o entre ruas apenas prÃ³ximas;
 *  - recusa de cruzamento em nÃ­vel diferente (quando a sinalizaÃ§Ã£o existe);
 *  - remoÃ§Ã£o de duplicidades geomÃ©tricas sem descartar ruas paralelas;
 *  - rede desconectada;
 *  - camada com mais de mil feiÃ§Ãµes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGraph } from '../src/core/graph.js';
import { project, unproject } from '../src/core/geo.js';
import { feature, official, unofficial, road, loadRealFeatures } from './helpers.js';

const BASE = [-46.545, -23.66];
// Metros por grau no paralelo de Santo AndrÃ© (~23,66Â°S)
const M_PER_DEG_LON = 101990;
const M_PER_DEG_LAT = 110574;
const mLon = 1 / M_PER_DEG_LON;
const mLat = 1 / M_PER_DEG_LAT;

/* ------------------------------------------------------------------ */

test('projeÃ§Ã£o UTM 23S: ida e volta preserva a coordenada', () => {
  const [lon, lat] = [-46.54524029, -23.62344761];
  const [x, y] = project(lon, lat);
  const [lon2, lat2] = unproject(x, y);
  assert.ok(Math.abs(lon2 - lon) < 1e-9, 'longitude deve voltar com precisÃ£o de sub-nanometro');
  assert.ok(Math.abs(lat2 - lat) < 1e-9, 'latitude deve voltar com precisÃ£o de sub-nanometro');
});

test('projeÃ§Ã£o UTM 23S: as coordenadas batem com o EPSG:32723 do GeoServer', () => {
  // Valor publicado pelo GeoServer para a feature ID 4160 (mesma geometria,
  // consultada com srsName=EPSG:32723).
  const [x, y] = project(-46.54516549, -23.6235705);
  assert.ok(Math.abs(x - 342372.74239203) < 0.001, `easting ${x} vs 342372.742`);
  assert.ok(Math.abs(y - 7386596.55823931) < 0.001, `northing ${y} vs 7386596.558`);
});

/* ------------------------------------------------------------------ */

test('eixo Ãºnico gera uma aresta com o comprimento correto', () => {
  // 100 m a leste (dLon â‰ˆ 0,000983Â°) sobre o paralelo de Santo AndrÃ©
  const features = [feature(official(1, 'RUA SOLITARIA'), [
    [BASE[0], BASE[1]],
    [BASE[0] + 0.000983, BASE[1]],
  ])];

  const g = buildGraph(features);
  assert.equal(g.edges.length, 1);
  const edge = g.edges[0];
  assert.ok(Math.abs(edge.length - 100) < 1.5, `comprimento ${edge.length} deve ser ~100 m`);
  assert.equal(edge.props.DSC_LOGRADOURO, 'RUA SOLITARIA');
});

test('cruzamento real gera nÃ³ compartilhado entre os dois eixos', () => {
  // Reta horizontal e reta vertical que se cruzam no ponto mÃ©dio.
  const features = [
    feature(official(1, 'RUA HORIZONTAL'), [
      [BASE[0] - 0.001, BASE[1]],
      [BASE[0] + 0.001, BASE[1]],
    ]),
    feature(official(2, 'RUA VERTICAL'), [
      [BASE[0], BASE[1] - 0.0009],
      [BASE[0], BASE[1] + 0.0009],
    ]),
  ];

  const g = buildGraph(features);
  // cada eixo deve ser partido no cruzamento -> 2 arestas por eixo
  assert.equal(g.edges.length, 4, 'esperadas 4 arestas (2 por eixo, partidas no cruzamento)');
  assert.equal(g.diagnostics.crossings, 1);
  // o nÃ³ do cruzamento Ã© comum aos dois eixos
  const mid = g.nodes.find((n) => Math.abs(n.x - project(BASE[0], BASE[1])[0]) < 0.01);
  assert.ok(mid, 'deve existir um nÃ³ no cruzamento');
  const touching = g.edges.filter((e) => e.from === mid.id || e.to === mid.id);
  assert.equal(touching.length, 4, 'as 4 arestas devem convergir no cruzamento');
});

test('extremidades com 2 cm de diferenÃ§a sÃ£o unidas (tolerÃ¢ncia de 5 cm)', () => {
  // 2 cm â‰ˆ 0,0000002 em longitude
  const dLon = 0.0000002;
  const features = [
    feature(official(1, 'RUA A'), [
      [BASE[0] - 0.001, BASE[1]],
      [BASE[0], BASE[1]],
    ]),
    feature(official(2, 'RUA B'), [
      [BASE[0] + dLon, BASE[1]],
      [BASE[0] + 0.001, BASE[1]],
    ]),
  ];

  const g = buildGraph(features);
  const touching = countJunctions(g);
  assert.ok(touching >= 1, 'as duas ruas devem ser unidas em um nÃ³');
  assert.equal(g.diagnostics.components, 1, 'a rede deve formar uma Ãºnica componente');
});

test('ruas apenas prÃ³ximas (3 m) NÃƒO sÃ£o conectadas', () => {
  // Duas ruas paralelas separadas por 3 m: nÃ£o hÃ¡ interseÃ§Ã£o nem sobreposiÃ§Ã£o.
  const dLat = 3 / 101700;
  const features = [
    feature(official(1, 'RUA PARALELA A'), [
      [BASE[0] - 0.001, BASE[1]],
      [BASE[0] + 0.001, BASE[1]],
    ]),
    feature(official(2, 'RUA PARALELA B'), [
      [BASE[0] - 0.001, BASE[1] + dLat],
      [BASE[0] + 0.001, BASE[1] + dLat],
    ]),
  ];

  const g = buildGraph(features);
  assert.equal(g.diagnostics.components, 2, 'ruas paralelas devem ficar em componentes distintas');
  assert.equal(g.diagnostics.crossings, 0);
});

test('cruzamento com rodovia Ã© recusado quando excludeRoadCrossings estÃ¡ ativo', () => {
  const features = [
    feature(road(1, 'RODOVIA ANEL'), [
      [BASE[0] - 0.001, BASE[1]],
      [BASE[0] + 0.001, BASE[1]],
    ]),
    feature(official(2, 'RUA TRANSVERSAL'), [
      [BASE[0], BASE[1] - 0.0009],
      [BASE[0], BASE[1] + 0.0009],
    ]),
  ];

  const conectado = buildGraph(features);
  assert.equal(conectado.diagnostics.crossings, 1);
  assert.equal(conectado.diagnostics.components, 1, 'por padrÃ£o o cruzamento geomÃ©trico conecta');

  const recusado = buildGraph(features, { excludeRoadCrossings: true });
  assert.equal(recusado.diagnostics.rejectedCrossingsCount, 1, 'o cruzamento deve ser reportado');
  assert.equal(recusado.diagnostics.components, 2, 'com a recusa ativa a rede fica desconectada');
});

test('geometrias duplicadas sÃ£o removidas sem descartar ruas paralelas', () => {
  const features = [
    feature(official(1, 'RUA DUPLICADA'), [
      [BASE[0] - 0.001, BASE[1]],
      [BASE[0] + 0.001, BASE[1]],
    ]),
    feature(official(2, 'RUA DUPLICADA'), [
      [BASE[0] - 0.001, BASE[1]],
      [BASE[0] + 0.001, BASE[1]],
    ]),
    // rua paralela legÃ­tima, 30 m acima
    feature(official(3, 'RUA PARALELA'), [
      [BASE[0] - 0.001, BASE[1] + 0.0003],
      [BASE[0] + 0.001, BASE[1] + 0.0003],
    ]),
  ];

  const g = buildGraph(features);
  assert.equal(g.diagnostics.duplicatesRemoved, 1, 'a duplicata exata deve ser removida');
  const streets = new Set(g.edges.map((e) => e.props.DSC_LOGRADOURO));
  assert.ok(streets.has('RUA PARALELA'), 'a rua paralela legÃ­tima deve permanecer');
});

test('rede desconectada produz mais de uma componente', () => {
  const features = [
    feature(official(1, 'RUA ISOLADA 1'), [
      [BASE[0] - 0.001, BASE[1]],
      [BASE[0] + 0.001, BASE[1]],
    ]),
    feature(official(2, 'RUA ISOLADA 2'), [
      [BASE[0] + 0.05, BASE[1] + 0.05],
      [BASE[0] + 0.06, BASE[1] + 0.05],
    ]),
  ];
  const g = buildGraph(features);
  assert.equal(g.diagnostics.components, 2);
  assert.equal(g.diagnostics.largestComponent, 2);
});

test('eixo com repetiÃ§Ã£o de vÃ©rtice (ida e volta) nÃ£o vira beco sem saÃ­da infinito', () => {
  // A -> B -> A: o trecho de retorno Ã© a mesma geometria.
  const features = [
    feature(official(1, 'RUA EM U'), [
      [BASE[0], BASE[1]],
      [BASE[0] + 0.001, BASE[1]],
      [BASE[0], BASE[1]],
    ]),
  ];
  const g = buildGraph(features);
  const total = g.edges.reduce((s, e) => s + e.length, 0);
  assert.ok(total < 400, `o comprimento total deve contar o trecho uma vez (${total} m)`);
});

test('camada com mais de mil feiÃ§Ãµes Ã© processada integralmente', () => {
  const features = loadRealFeatures();
  assert.ok(features.length > 1000, `o snapshot deve ter mais de mil feiÃ§Ãµes (${features.length})`);

  const g = buildGraph(features);
  assert.equal(g.diagnostics.featuresRead, features.length);
  assert.ok(g.edges.length > 1000, `deve haver mais de mil arestas (${g.edges.length})`);
  assert.ok(g.nodes.length > 1000);
  // a rede real deve ter uma componente dominante
  assert.ok(
    g.diagnostics.largestComponent > 5000,
    `a maior componente deve ser dominante (${g.diagnostics.largestComponent})`
  );
});

/**
 * Rede de teste: a rua A chega a 50 cm da rua B, sem tocÃ¡-la.
 * A rua B corre norte-sul, logo o deslocamento Ã© em longitude.
 */
function redeComLacuna() {
  return [
    feature(official(1, 'RUA A'), [
      [BASE[0] - 100 * mLon, BASE[1]],
      [BASE[0] - 0.5 * mLon, BASE[1]], // 50 cm a oeste da rua B
    ]),
    feature(official(2, 'RUA B'), [
      [BASE[0], BASE[1] - 100 * mLat],
      [BASE[0], BASE[1] + 100 * mLat],
    ]),
  ];
}

test('extremidade 50 cm antes de outra rua Ã© ligada por conector (sem mexer na geometria)', () => {
  // Com a tolerÃ¢ncia de "snap" (5 cm) as duas ruas nÃ£o se tocam, e a rota
  // precisa dar a volta. Com a tolerÃ¢ncia de junÃ§Ã£o (1 m) a ligaÃ§Ã£o Ã© feita
  // por um conector, sem alterar a geometria original.
  const semConector = buildGraph(redeComLacuna(), { junctionTolerance: 0 });
  const comConector = buildGraph(redeComLacuna());

  assert.equal(semConector.diagnostics.connectors, 0);
  assert.ok(comConector.diagnostics.connectors >= 1,
    `esperado ao menos 1 conector, obtido ${comConector.diagnostics.connectors}`);
  assert.equal(comConector.diagnostics.components, 1,
    'as duas ruas devem ficar na mesma componente');

  // a geometria original NÃƒO pode ser alterada pelo conector
  const arestaA = comConector.edges.find((e) => e.props?.DSC_LOGRADOURO === 'RUA A');
  assert.ok(arestaA);
  const ultimo = arestaA.coords[arestaA.coords.length - 1];
  const esperado = project(BASE[0] - 0.5 * mLon, BASE[1]);
  assert.ok(Math.hypot(ultimo[0] - esperado[0], ultimo[1] - esperado[1]) < 0.01,
    'a ponta da rua A deve permanecer exatamente onde estava');
});

test('o conector tem o comprimento real da lacuna', () => {
  const g = buildGraph(redeComLacuna());
  const conector = g.edges.find((e) => e.connector);
  assert.ok(conector, 'deve existir uma aresta de conexÃ£o');
  assert.ok(Math.abs(conector.length - 0.5) < 0.05,
    `o conector deve medir ~0,5 m, mede ${conector.length}`);
});

test('nenhuma junÃ§Ã£o Ã© perdida durante a deduplicaÃ§Ã£o de cortes', () => {
  const g = buildGraph(loadRealFeatures());
  assert.equal(g.diagnostics.junctionsLost, 0, 'nenhuma junÃ§Ã£o pode ser descartada');
  assert.ok(g.diagnostics.junctionsUnified > 1000);
});

/* ------------------------------------------------------------------ */

/** Conta junÃ§Ãµes: pares de arestas que compartilham um nÃ³. */
function countJunctions(g) {
  const byNode = new Map();
  for (const e of g.edges) {
    byNode.set(e.from, (byNode.get(e.from) || 0) + 1);
    byNode.set(e.to, (byNode.get(e.to) || 0) + 1);
  }
  return Array.from(byNode.values()).filter((n) => n >= 2).length;
}

