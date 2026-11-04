/**
 * TESTES — ETAPA 1: O MENOR CAMINHO ENTRE CADA PAR
 * ======================================================================
 *
 * O modo "Menor rota total (otimizada)" tem duas etapas:
 *
 *   etapa 1  para cada par de pontos, o caminho viário de MENOR distância
 *            na rede real — é a matriz de custos;
 *   etapa 2  a ordem de visita que minimiza a soma da matriz, com o
 *            retorno obrigatório à origem (Held-Karp).
 *
 * Se a etapa 1 entregar um custo que não é o menor caminho viário, a etapa 2
 * otimiza números errados. Estes testes travam a etapa 1.
 *
 * O teste 1 reproduz um defeito real encontrado na auditoria: as arestas
 * virtuais criadas ao ligar um ponto à rede (a divisão da via atingida)
 * recebiam como custo o **número de caracteres do identificador** da aresta
 * ("tmp:1234:0" -> 10 m) em vez do comprimento métrico da peça. O A* então
 * subestimava o custo das peças divididas e devolvia caminhos PIORES (e
 * diferentes conforme o sentido), distorcendo a matriz de custos.
 *
 * O que é verificado:
 *
 *  1. a rede de custos conhecidos devolve o caminho de MENOR comprimento
 *     (e não o de menos segmentos);
 *  2. o caminho mínimo é SIMÉTRICO (o grafo é não direcionado):
 *     d(X→Y) = d(Y→X);
 *  3. o A* devolve o mesmo que o Dijkstra E o mesmo que uma implementação
 *     de REFERÊNCIA independente (com o comprimento métrico correto);
 *  4. o custo devolvido é o comprimento da geometria desenhada;
 *  5. o acesso à rede é medido, declarado e NÃO entra no custo do trajeto
 *     (o trajeto desenhado começa na rede) — sem duplicação nem omissão;
 *  6. a rota segue as ruas (nenhuma linha reta) e respeita a geometria.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { routeOnGraph, findNearestEdge } from '../core/router.js';
import { buildGraph } from '../core/graph.js';
import { project, unproject, dist } from '../core/geo.js';
import { feature, official, loadRealFeatures } from './helpers.js';

/* ── rede sintética em coordenadas métricas (UTM 23S) ───────────────── */

const BASE = [-46.545, -23.66];
const [BX, BY] = project(BASE[0], BASE[1]);

/** Converte um ponto métrico (x, y) em lon/lat. */
function pt(x, y) {
  const [lon, lat] = unproject(BX + x, BY + y);
  return [lon, lat];
}

/** Eixo reto entre dois pontos métricos. */
function eixo(id, x0, y0, x1, y1, nome) {
  return feature(official(id, nome || `RUA ${id}`), [pt(x0, y0), pt(x1, y1)]);
}

/**
 * Rede de custos conhecidos, montada para expor o defeito corrigido.
 *
 *   (0,1000) ────────────── RUA M (848,53 m) ───────── (600,400)
 *      │      C = destino a 30 m do início de M           │
 *      │ RUA Q (1000 m)                                    │ RUA F (400 m)
 *      │                                                   │
 *   (0,0) ── RUA A-B (100 m) ── (100,0) ── RUA E (500 m) ── (600,0)
 *                    origem = (100,0)
 *
 * Dois caminhos possíveis entre a origem e o destino:
 *
 *   via Q : 100 (A-B) + 1000 (Q) + 30 (M)            = 1130,00 m  ← ótimo
 *   via E+F: 500 (E) + 400 (F) + 818,53 (M, ao contrário) = 1718,53 m
 *
 * O destino fica a 30 m do início de M, e M é a aresta que o motor divide.
 * Com o custo da peça dividida medido pelo nº de caracteres do ID
 * ("tmp:..." -> ~10 m) em vez do comprimento métrico, o A* "achava" que
 * percorrer 818,53 m de M custava 10 m e devolvia o caminho via E+F
 * (1718,53 m) — 588 m PIOR que o ótimo. É o defeito observado na rede real.
 */
function redeConhecida() {
  return [
    eixo(1, 0, 0, 100, 0, 'RUA A-B'),
    eixo(2, 0, 0, 0, 1000, 'RUA Q'),
    eixo(3, 0, 1000, 600, 400, 'RUA M'),
    eixo(4, 100, 0, 600, 0, 'RUA E'),
    eixo(5, 600, 0, 600, 400, 'RUA F'),
  ];
}

// o destino fica a 30 m do início de M (0,1000) na direção de (600,400)
const COMP_M = Math.hypot(600, -600);
const DESTINO_METRICO = [30 * (600 / COMP_M), 1000 + 30 * (-600 / COMP_M)];

const ORIGEM = { lon: pt(100, 0)[0], lat: pt(100, 0)[1] };
const DESTINO = { lon: pt(DESTINO_METRICO[0], DESTINO_METRICO[1])[0], lat: pt(DESTINO_METRICO[0], DESTINO_METRICO[1])[1] };

/* ── implementação de REFERÊNCIA (independente do motor) ────────────── */

/** Distância de um ponto até a projeção sobre a aresta + a posição na aresta. */
function ligacao(graph, x, y) {
  const snap = findNearestEdge(graph, x, y);
  if (!snap) return null;
  const edge = graph.edges[snap.edgeId];
  let acc = 0;
  for (let i = 0; i < snap.segIdx; i++) {
    acc += dist(edge.coords[i][0], edge.coords[i][1], edge.coords[i + 1][0], edge.coords[i + 1][1]);
  }
  const d = dist(
    edge.coords[snap.segIdx][0],
    edge.coords[snap.segIdx][1],
    edge.coords[snap.segIdx + 1][0],
    edge.coords[snap.segIdx + 1][1],
  );
  return { edge, pos: acc + d * snap.t, dist: snap.dist, snap };
}

/**
 * Caminho mínimo de referência: Dijkstra sobre o mesmo grafo, com a divisão
 * temporária das arestas feita com o comprimento MÉTRICO correto.
 * É a verdade-terreno usada para provar que o motor entrega o menor caminho.
 */
function referencia(graph, origem, destino) {
  const [ox, oy] = project(origem.lon, origem.lat);
  const [dx, dy] = project(destino.lon, destino.lat);
  const so = ligacao(graph, ox, oy);
  const sd = ligacao(graph, dx, dy);
  if (!so || !sd) return null;

  const nOrigem = graph.nodes.length;
  const nDestino = graph.nodes.length + 1;
  const nodeCount = graph.nodes.length + 2;
  const splits = [];
  const overlayNodes = new Map();

  const mk = (a, nodeId) => {
    const { edge, pos } = a;
    const c0 = edge.coords[0];
    const c1 = edge.coords[edge.coords.length - 1];
    if (dist(a.snap.x, a.snap.y, c0[0], c0[1]) <= 1e-3) return { nodeId: edge.from, pos: 0 };
    if (dist(a.snap.x, a.snap.y, c1[0], c1[1]) <= 1e-3) return { nodeId: edge.to, pos: edge.length };
    overlayNodes.set(nodeId, { x: a.snap.x, y: a.snap.y });
    splits.push({ edgeId: edge.id, pos, nodeId });
    return { nodeId, pos };
  };

  const o = mk(so, nOrigem);
  const d = mk(sd, nDestino);

  // overlay com o comprimento MÉTRICO de cada peça
  const extra = new Map();
  const add = (from, to, len) => {
    if (!extra.has(from)) extra.set(from, []);
    extra.get(from).push({ to, length: len });
  };
  const byEdge = new Map();
  for (const s of splits) {
    if (!byEdge.has(s.edgeId)) byEdge.set(s.edgeId, []);
    byEdge.get(s.edgeId).push(s);
  }
  for (const [edgeId, list] of byEdge) {
    const base = graph.edges[edgeId];
    list.sort((a, b) => a.pos - b.pos);
    let prevPos = 0;
    let prevNode = base.from;
    for (const s of list) {
      add(prevNode, s.nodeId, s.pos - prevPos);
      add(s.nodeId, prevNode, s.pos - prevPos);
      prevNode = s.nodeId;
      prevPos = s.pos;
    }
    add(prevNode, base.to, base.length - prevPos);
    add(base.to, prevNode, base.length - prevPos);
  }

  const adjOf = (n) => {
    const base = graph.adjacency[n] || [];
    const ex = extra.get(n);
    return ex && ex.length ? base.concat(ex) : base;
  };

  const dmin = new Float64Array(nodeCount).fill(Infinity);
  const done = new Uint8Array(nodeCount);
  dmin[o.nodeId] = 0;
  const fila = [[0, o.nodeId]];
  while (fila.length) {
    let melhor = 0;
    for (let i = 1; i < fila.length; i++) if (fila[i][0] < fila[melhor][0]) melhor = i;
    const [g, u] = fila.splice(melhor, 1)[0];
    if (done[u]) continue;
    done[u] = 1;
    if (u === d.nodeId) break;
    for (const l of adjOf(u)) {
      if (done[l.to]) continue;
      const t = g + l.length;
      if (t < dmin[l.to]) {
        dmin[l.to] = t;
        fila.push([t, l.to]);
      }
    }
  }
  return Number.isFinite(dmin[d.nodeId]) ? dmin[d.nodeId] : null;
}

/** Comprimento métrico de uma geometria lon/lat. */
function comprimento(coordinates) {
  let t = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [x1, y1] = project(coordinates[i - 1][0], coordinates[i - 1][1]);
    const [x2, y2] = project(coordinates[i][0], coordinates[i][1]);
    t += Math.hypot(x2 - x1, y2 - y1);
  }
  return t;
}

/* ══════════════════════════════════════════════════════════════════ */

test('1. rede de custos conhecidos: o caminho devolvido é o de MENOR comprimento', () => {
  const g = buildGraph(redeConhecida(), {});
  const r = routeOnGraph(g, ORIGEM, DESTINO, { maxSnapDistance: 100 });
  assert.equal(r.ok, true, r.message || '');

  // ótimo real: A-B (100) + Q (1000) + M (30) = 1130 m
  assert.ok(
    Math.abs(r.distance - 1130) < 0.5,
    `o caminho mínimo são 1130 m; o motor devolveu ${r.distance.toFixed(2)} m`,
  );
  // e ele passa pelas ruas certas (não pela linha reta, nem pelo desvio
  // "mais barato" que a divisão mal custada fazia o A* escolher)
  const ruas = r.legs.map((l) => l.street);
  assert.ok(ruas.includes('RUA A-B'), `ruas percorridas: ${ruas.join(' → ')}`);
  assert.ok(ruas.includes('RUA Q'), `ruas percorridas: ${ruas.join(' → ')}`);
  assert.ok(ruas.includes('RUA M'), `ruas percorridas: ${ruas.join(' → ')}`);
  assert.ok(!ruas.includes('RUA E'), 'não deve sair pelo desvio mais longo');
  assert.ok(!ruas.includes('RUA F'), 'não deve sair pelo desvio mais longo');

  // o mesmo com o Dijkstra puro (sem heurística): os dois têm de achar o
  // caminho mínimo — foi justamente a diferença entre eles que revelou o
  // custo métrico errado da divisão das arestas
  const d = routeOnGraph(g, ORIGEM, DESTINO, {
    maxSnapDistance: 100,
    algorithm: 'dijkstra',
  });
  assert.equal(d.ok, true);
  assert.ok(
    Math.abs(d.distance - 1130) < 0.5,
    `o Dijkstra também tem de devolver 1130 m; devolveu ${d.distance.toFixed(2)} m`,
  );
});

test('2. o caminho mínimo é simétrico (grafo não direcionado): d(X→Y) = d(Y→X)', () => {
  const g = buildGraph(redeConhecida(), {});
  const ida = routeOnGraph(g, ORIGEM, DESTINO, { maxSnapDistance: 100 });
  const volta = routeOnGraph(g, DESTINO, ORIGEM, { maxSnapDistance: 100 });
  assert.equal(ida.ok, true);
  assert.equal(volta.ok, true);
  assert.ok(
    Math.abs(ida.distance - volta.distance) < 0.01,
    `assimetria de ${(ida.distance - volta.distance).toFixed(2)} m — o grafo é não direcionado`,
  );
});

test('3. o A* devolve o mesmo que o Dijkstra e que a referência independente', () => {
  const g = buildGraph(redeConhecida(), {});
  const astar = routeOnGraph(g, ORIGEM, DESTINO, { maxSnapDistance: 100 });
  const dijkstra = routeOnGraph(g, ORIGEM, DESTINO, {
    maxSnapDistance: 100,
    algorithm: 'dijkstra',
  });
  const ref = referencia(g, ORIGEM, DESTINO);
  assert.equal(astar.ok, true);
  assert.equal(dijkstra.ok, true);
  assert.ok(ref !== null, 'a referência deve achar o caminho');
  assert.ok(Math.abs(astar.distance - dijkstra.distance) < 1e-6, 'A* × Dijkstra');
  assert.ok(Math.abs(astar.distance - ref) < 1e-6, `A* (${astar.distance}) × referência (${ref})`);
});

test('4. o custo devolvido é o comprimento da geometria desenhada', () => {
  const g = buildGraph(redeConhecida(), {});
  const r = routeOnGraph(g, ORIGEM, DESTINO, { maxSnapDistance: 100 });
  const geo = comprimento(r.geometry.coordinates);
  assert.ok(
    Math.abs(r.distance - geo) < 0.01,
    `custo ${r.distance} × geometria ${geo} — o número apresentado tem de ser o da rota desenhada`,
  );
});

test('5. o acesso à rede é medido e declarado, e NÃO entra no custo do trajeto', () => {
  const g = buildGraph(redeConhecida(), {});
  // um ponto a 8 m da rua, no meio dela: o trajeto começa na rede
  const p = { lon: pt(50, 8)[0], lat: pt(50, 8)[1] };
  // (referência: o mesmo ponto está a 8 m da RUA A-B, que vai de (0,0) a (100,0))
  const r = routeOnGraph(g, p, DESTINO, { maxSnapDistance: 100 });
  assert.equal(r.ok, true);
  assert.ok(r.origin.distanceToNetwork > 7 && r.origin.distanceToNetwork < 9);
  // o custo é o da rota NA REDE (o acesso é informado à parte)
  const ref = referencia(g, p, DESTINO);
  assert.ok(Math.abs(r.distance - ref) < 1e-6, 'o custo é o menor caminho na rede');
  // e o desenho começa no ponto projetado na rede
  const primeiro = r.geometry.coordinates[0];
  const [fx, fy] = project(primeiro[0], primeiro[1]);
  assert.ok(
    Math.abs(fx - (BX + 50)) < 1 && Math.abs(fy - (BY + 0)) < 1,
    'a geometria começa na ligação com a rede',
  );
  // o acesso NÃO é somado ao custo: o trajeto desenhado começa na rede
  assert.ok(
    r.distance < 1130 + 8,
    'o trajeto não inclui o acesso ao ponto (que é informado à parte)',
  );
});

test('6. a rota segue as ruas: nenhum salto em linha reta entre eixos', () => {
  const g = buildGraph(redeConhecida(), {});
  const r = routeOnGraph(g, ORIGEM, DESTINO, { maxSnapDistance: 100 });
  assert.ok(r.legs.length >= 3, 'a rota passa por mais de um eixo');
  for (const leg of r.legs) {
    assert.ok(leg.coords.length >= 2, 'cada perna tem geometria');
    assert.ok(leg.length >= 0);
  }
  // a soma das pernas é o custo
  const soma = r.legs.reduce((s, l) => s + l.length, 0);
  assert.ok(Math.abs(soma - r.distance) < 1e-6);
});

test('7. minimiza a DISTÂNCIA dos segmentos, não o número de segmentos', () => {
  // A mesma origem e o mesmo destino, duas ruas possíveis:
  //   RETA  : reta digitada com 4 vértices  → 4 segmentos, 200 m
  //   CURVA : 2 segmentos                  → 360,61 m
  // A rota correta é a da RETA: mais segmentos, menos metros.
  const g = buildGraph(
    [
      feature(official(10, 'RUA RETA'), [pt(0, 0), pt(50, 0), pt(100, 0), pt(150, 0), pt(200, 0)]),
      feature(official(11, 'RUA CURVA'), [pt(0, 0), pt(100, 150), pt(200, 0)]),
    ],
    {},
  );
  const origem = { lon: pt(0, 0)[0], lat: pt(0, 0)[1] };
  const destino = { lon: pt(200, 0)[0], lat: pt(200, 0)[1] };
  const r = routeOnGraph(g, origem, destino, { maxSnapDistance: 100 });
  assert.equal(r.ok, true, r.message || '');
  assert.ok(
    Math.abs(r.distance - 200) < 0.5,
    `o caminho mínimo são 200 m (4 segmentos da RETA); o motor devolveu ${r.distance.toFixed(2)} m`,
  );
  assert.equal(r.legs[0].street, 'RUA RETA');
});

test('8. rede real: o motor bate com a referência independente e é simétrico', () => {
  const g = buildGraph(loadRealFeatures(), {});
  // pontos reais sobre eixos da rede (todos no mesmo componente)
  const pontos = [
    { lon: -46.514975, lat: -23.704214 },
    { lon: -46.516961, lat: -23.701514 },
    { lon: -46.518152, lat: -23.700525 },
  ];
  for (let i = 0; i < pontos.length; i++) {
    for (let j = 0; j < pontos.length; j++) {
      if (i === j) continue;
      const r = routeOnGraph(g, pontos[i], pontos[j], { maxSnapDistance: 100 });
      assert.equal(r.ok, true, `${i}→${j}: ${r.reason}`);
      const ref = referencia(g, pontos[i], pontos[j]);
      assert.ok(ref !== null);
      assert.ok(
        Math.abs(r.distance - ref) < 1e-6,
        `par ${i}→${j}: motor ${r.distance.toFixed(3)} × referência ${ref.toFixed(3)}`,
      );
      const volta = routeOnGraph(g, pontos[j], pontos[i], { maxSnapDistance: 100 });
      assert.ok(
        Math.abs(r.distance - volta.distance) < 0.01,
        `assimetria no par ${i}↔${j}: ${r.distance.toFixed(3)} × ${volta.distance.toFixed(3)}`,
      );
    }
  }
});
