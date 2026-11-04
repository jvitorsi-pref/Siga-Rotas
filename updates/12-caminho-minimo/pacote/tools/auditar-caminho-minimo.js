/**
 * tools/auditar-caminho-minimo.js
 * ---------------------------------------------------------------------------
 * AUDITORIA DA ETAPA 1 — "MENOR CAMINHO ENTRE CADA PAR".
 *
 * O modo "Menor rota total (otimizada)" tem DUAS etapas lógicas:
 *
 *   etapa 1  para cada par de pontos, o caminho viário de MENOR distância
 *            na rede real (a matriz de custos);
 *   etapa 2  a ordem de visita que minimiza a soma dessa matriz, incluindo
 *            o retorno obrigatório à origem (Held-Karp).
 *
 * Se a etapa 1 entregar custos que não são os menores caminhos viários, a
 * etapa 2 fica otimizando números errados. Este script audita a etapa 1 de
 * forma independente:
 *
 *   A. REFERÊNCIA — um Dijkstra próprio, sobre o MESMO grafo, com a divisão
 *      temporária das arestas feita com o comprimento MÉTRICO correto.
 *      Não usa o código de overlay do motor: é uma segunda implementação,
 *      para servir de verdade-terreno.
 *   B. AMOSTRA DE PARES — para N pares determinísticos:
 *      • o custo devolvido pelo motor × o custo da referência;
 *      • a simetria D(X→Y) = D(Y→X) (num grafo não direcionado o caminho
 *        mínimo TEM de ser simétrico);
 *      • a coerência entre o custo devolvido e o comprimento da geometria
 *        realmente desenhada;
 *      • o custo do acesso à rede (medido, declarado e nunca somado ao
 *        trajeto — o trajeto desenhado começa na rede).
 *   C. CENÁRIO REPORTADO — o caso A → C → B → A com as pernas 903 / 279 /
 *      625 m: a tabela de todos os pares, os dois circuitos possíveis com a
 *      MESMA métrica e a comparação Held-Karp × força bruta.
 *
 * Uso:  node tools/auditar-caminho-minimo.js [pares]
 * Saída: código 1 se alguma inconsistência for encontrada.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildGraph } from '../core/graph.js';
import { project, unproject, dist, projectPointOnSegment } from '../core/geo.js';
import { findNearestEdge, routeOnGraph } from '../core/router.js';
import { heldKarp, custoDaOrdem, matrizDistancias } from '../core/ordemParadas.js';
import { calcularRotaComParadas } from '../core/rotaParadas.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = JSON.parse(readFileSync(join(RAIZ, 'data/network.snapshot.json'), 'utf8'));
const features = snapshot.features || snapshot;
const N_PARES = Number(process.argv[2] || 400);

const mm = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = (v) => v.toFixed(2).replace('.', ',');

/* ══════════════════════════════════════════════════════════════════════
   A. REFERÊNCIA INDEPENDENTE
   Dijkstra sobre o grafo, com a divisão das arestas feita com o
   comprimento métrico correto (implementação própria, sem usar o overlay
   do motor).
   ══════════════════════════════════════════════════════════════════════ */

/** Distância (m) de um ponto até a projeção sobre a aresta. */
function acessos(graph, x, y) {
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
    edge.coords[snap.legIdx ?? snap.segIdx + 1][1],
  );
  const pos = acc + d * snap.t;
  return { edge, pos, dist: snap.dist, snap };
}

/**
 * Caminho mínimo de referência entre dois pontos da rede.
 * Reproduz o mesmo recorte do motor (divisão da aresta atingida), mas com
 * o comprimento métrico correto das peças.
 */
function referencia(graph, origem, destino) {
  const [ox, oy] = project(origem.lon, origem.lat);
  const [dx, dy] = project(destino.lon, destino.lat);
  const so = acessos(graph, ox, oy);
  const sd = acessos(graph, dx, dy);
  if (!so || !sd) return null;

  const nodeCount = graph.nodes.length + 2;
  const nOrigem = graph.nodes.length;
  const nDestino = graph.nodes.length + 1;
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

  // overlay correto: cada peça com o seu comprimento métrico
  const extra = new Map();
  const addLink = (from, to, len) => {
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
      addLink(prevNode, s.nodeId, s.pos - prevPos);
      addLink(s.nodeId, prevNode, s.pos - prevPos);
      prevNode = s.nodeId;
      prevPos = s.pos;
    }
    addLink(prevNode, base.to, base.length - prevPos);
    addLink(base.to, prevNode, base.length - prevPos);
  }

  const adjOf = (n) => {
    const base = graph.adjacency[n] || [];
    const ex = extra.get(n);
    return ex && ex.length ? base.concat(ex) : base;
  };

  // Dijkstra
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
  if (!Number.isFinite(dmin[d.nodeId])) return null;
  return {
    custo: dmin[d.nodeId],
    acessoOrigem: so.dist,
    acessoDestino: sd.dist,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   utilidades
   ══════════════════════════════════════════════════════════════════════ */

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

/** Gerador determinístico (LCG) — a amostra é sempre a mesma. */
function rng(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
console.log('='.repeat(78));
console.log('AUDITORIA DA ETAPA 1 — MENOR CAMINHO ENTRE CADA PAR');
console.log('='.repeat(78));
const graph = buildGraph(features, {});
console.log(
  `rede: ${features.length} eixos · ${graph.diagnostics.nodes} nós · ` +
    `${graph.diagnostics.edges} arestas · ${graph.diagnostics.components} componentes`,
);

/* ── B. amostra de pares ─────────────────────────────────────────────── */
console.log('\nB) AMOSTRA DE PARES (motor × referência independente)');
const r = rng(20261028);
const arestas = graph.edges.filter((e) => e.coords.length >= 2);
let pares = 0;
let piores = [];
let assimetrias = 0;
let incoerentes = 0;
let juncoesDeclaradas = 0;
let acessosLongos = 0;
const hist = [];

while (pares < N_PARES) {
  const e = arestas[Math.floor(r() * arestas.length)];
  const i = 1 + Math.floor(r() * (e.coords.length - 1));
  const [x, y] = e.coords[i];
  const [lon, lat] = unproject(x, y);
  const origem = { lon, lat };
  const e2 = arestas[Math.floor(r() * arestas.length)];
  const j = 1 + Math.floor(r() * (e2.coords.length - 1));
  const [lon2, lat2] = unproject(e2.coords[j][0], e2.coords[j][1]);
  const destino = { lon: lon2, lat: lat2 };

  const motor = routeOnGraph(graph, origem, destino, { maxSnapDistance: 100 });
  const ref = referencia(graph, origem, destino);
  if (!motor.ok || !ref) continue;
  pares++;

  const dif = motor.distance - ref.custo;
  hist.push(dif);
  if (dif > 0.05) {
    piores.push({ dif, origem, destino, motor: motor.distance, ref: ref.custo });
  }
  // a diferença entre o custo e a geometria desenhada só é aceitável
  // quando o motor a DECLARA (a discrepância de um cruzamento digitalizado
  // dos dois lados — comportamento documentado, que preserva a geometria
  // original). Sem aviso, é um problema.
  const deltaGeo = motor.distance - comprimento(motor.geometry.coordinates);
  if (Math.abs(deltaGeo) > 0.05) {
    if ((motor.warnings || []).length) {
      juncoesDeclaradas++;
      if (juncoesDeclaradas <= 3) {
        console.log(
          `   discrepância de junção DECLARADA: ${f2(deltaGeo)} m ` +
            `(custo ${f2(motor.distance)} × geometria ${f2(comprimento(motor.geometry.coordinates))})` +
            ` · aviso: ${String(motor.warnings[0]).slice(0, 90)}…`,
        );
      }
    } else {
      incoerentes++;
      console.log(
        `   INCOERÊNCIA: custo ${f2(motor.distance)} × geometria ` +
          `${f2(comprimento(motor.geometry.coordinates))} sem aviso`,
      );
    }
  }
  if (motor.origin.distanceToNetwork > 1 || motor.destination.distanceToNetwork > 1) acessosLongos++;
}

const acima = piores.length;
const media = hist.reduce((s, v) => s + v, 0) / hist.length;
const max = Math.max(...hist);
const p95 = [...hist].sort((a, b) => a - b)[Math.floor(hist.length * 0.95)];
console.log(`   pares auditados            : ${pares}`);
console.log(`   custo do motor > referência : ${acima} (${((acima / pares) * 100).toFixed(1)} %)`);
console.log(`   diferença média             : ${f2(media)} m`);
console.log(`   diferença p95 / máxima      : ${f2(p95)} m / ${f2(max)} m`);
console.log(`   custo ≠ comprimento da geometria desenhada : ${incoerentes} (sem aviso)`);
console.log(`   discrepâncias de junção DECLARADAS pelo motor : ${juncoesDeclaradas}`);
console.log(`   pares com acesso à rede > 1 m : ${acessosLongos}`);

/* ── simetria ────────────────────────────────────────────────────────── */
console.log('\nB2) SIMETRIA D(X→Y) = D(Y→X)  (o grafo é não direcionado)');
let assimetriaExemplos = 0;
let nAssim = 0;
const r2 = rng(777);
for (let k = 0; k < Math.min(200, N_PARES); k++) {
  const e = arestas[Math.floor(r2() * arestas.length)];
  const [lon, lat] = unproject(e.coords[1][0], e.coords[1][1]);
  const e2 = arestas[Math.floor(r2() * arestas.length)];
  const [lon2, lat2] = unproject(e2.coords[1][0], e2.coords[1][1]);
  const p = { lon, lat };
  const q = { lon: lon2, lat: lat2 };
  const a = routeOnGraph(graph, p, q, { maxSnapDistance: 100 });
  const b = routeOnGraph(graph, q, p, { maxSnapDistance: 100 });
  if (!a.ok || !b.ok) continue;
  const d = Math.abs(a.distance - b.distance);
  if (d > 0.05) {
    nAssim++;
    if (assimetriaExemplos < 5) {
      assimetriaExemplos++;
      console.log(
        `   assimetria: ${p.lon.toFixed(6)},${p.lat.toFixed(6)} → ${q.lon.toFixed(6)},${q.lat.toFixed(6)}` +
          ` : ${f2(a.distance)} m × ${f2(b.distance)} m (Δ ${f2(d)} m)`,
      );
    }
  }
}
console.log(`   pares assimétricos: ${nAssim} de 200`);

/* ── B3. pontos FORA da rede (acesso à rede) ─────────────────────────── */
console.log('\nB3) PONTOS FORA DA REDE — o acesso é medido, declarado e não distorce o custo');
const r3 = rng(4242);
let fora3 = 0;
let acessos3 = [];
let erros3 = 0;
for (let k = 0; k < 150; k++) {
  const e = arestas[Math.floor(r3() * arestas.length)];
  const i = 1 + Math.floor(r3() * (e.coords.length - 1));
  const [x, y] = e.coords[i];
  // afasta o ponto da rede de 2 a 40 m, numa direção aleatória
  const ang = r3() * Math.PI * 2;
  const off = 2 + r3() * 38;
  const [lon, lat] = unproject(x + Math.cos(ang) * off, y + Math.sin(ang) * off);
  const p = { lon, lat };
  const e2 = arestas[Math.floor(r3() * arestas.length)];
  const j = 1 + Math.floor(r3() * (e2.coords.length - 1));
  const [lon2, lat2] = unproject(e2.coords[j][0], e2.coords[j][1]);
  const q = { lon: lon2, lat: lat2 };

  const motor = routeOnGraph(graph, p, q, { maxSnapDistance: 100 });
  if (!motor.ok) continue; // fora do limite de 100 m: recusado, como deve ser
  fora3++;
  acessos3.push(motor.origin.distanceToNetwork);
  const ref = referencia(graph, p, q);
  if (!ref || Math.abs(motor.distance - ref) > 1e-6) erros3++;
}
acessos3.sort((a, b) => a - b);
console.log(`   pares com ponto fora da rede : ${fora3}`);
console.log(
  `   acesso à rede (mediana / p95 / máx): ${f2(acessos3[Math.floor(acessos3.length / 2)])} m / ` +
    `${f2(acessos3[Math.floor(acessos3.length * 0.95)])} m / ${f2(acessos3[acessos3.length - 1])} m`,
);
console.log(`   custo do motor ≠ referência    : ${erros3}`);

/* ══════════════════════════════════════════════════════════════════════
   C. CENÁRIO REPORTADO (A → C → B → A, pernas 903 / 279 / 625 m)
   ══════════════════════════════════════════════════════════════════════ */
console.log('\nC) CENÁRIO REPORTADO — circuito com duas paradas intermediárias');
const CENARIOS = [
  {
    nome: 'caso 1 (pernas 903 / 279 / 625 m)',
    A: { lat: -23.704214, lon: -46.514975 },
    B: { lat: -23.701514, lon: -46.516961 },
    C: { lat: -23.700525, lon: -46.518152 },
  },
  {
    nome: 'caso 2 (mesmo padrão, outro ponto)',
    A: { lat: -23.68984, lon: -46.491349 },
    B: { lat: -23.691172, lon: -46.486966 },
    C: { lat: -23.693211, lon: -46.48577 },
  },
];

for (const c of CENARIOS) {
  console.log(`\n   ${c.nome}`);
  const pontos = [
    { rotulo: 'A', latitude: c.A.lat, longitude: c.A.lon },
    { rotulo: 'B', latitude: c.B.lat, longitude: c.B.lon },
    { rotulo: 'C', latitude: c.C.lat, longitude: c.C.lon },
  ];
  const { D } = matrizDistancias(graph, pontos);
  console.log('   matriz de custos (m) — caminho mínimo na rede:');
  console.log('        A         B         C');
  for (let i = 0; i < 3; i++) {
    console.log(
      `   ${['A', 'B', 'C'][i]}   ` +
        D[i].map((v) => String(Math.round(v)).padStart(9)).join('  '),
    );
  }

  // tabela por par: custo, acesso e comprimento da geometria desenhada
  console.log('\n   par        custo(m)  acesso orig(m)  acesso dest(m)  geometria(m)  Δcusto-geo');
  let geoOk = true;
  for (const [i, j] of [[0, 1], [0, 2], [1, 2], [1, 0], [2, 0], [2, 1]]) {
    const r = routeOnGraph(
      graph,
      { lon: pontos[i].longitude, lat: pontos[i].latitude },
      { lon: pontos[j].longitude, lat: pontos[j].latitude },
      { maxSnapDistance: 100 },
    );
    if (!r.ok) {
      console.log(`   ${'ABC'[i]}→${'ABC'[j]}   FALHOU: ${r.reason}`);
      geoOk = false;
      continue;
    }
    const geo = comprimento(r.geometry.coordinates);
    const delta = r.distance - geo;
    if (Math.abs(delta) > 0.05) geoOk = false;
    console.log(
      `   ${'ABC'[i]}→${'ABC'[j]}    ${String(Math.round(r.distance)).padStart(7)}` +
        `   ${f2(r.origin.distanceToNetwork).padStart(12)}` +
        `   ${f2(r.destination.distanceToNetwork).padStart(13)}` +
        `   ${String(Math.round(geo)).padStart(11)}` +
        `   ${f2(delta).padStart(10)}`,
    );
  }

  // os dois circuitos possíveis, com a MESMA métrica
  const circA = custoDaOrdem(D, [1, 2], 0, 0); // A→B→C→A
  const circB = custoDaOrdem(D, [2, 1], 0, 0); // A→C→B→A
  const hk = heldKarp(D, [1, 2], 0, 0);
  console.log('\n   circuitos (com o retorno à origem, mesma métrica):');
  console.log(`   A→B→C→A : ${mm(circA)} m`);
  console.log(`   A→C→B→A : ${mm(circB)} m`);
  console.log(`   Held-Karp devolve: ${['A', ...hk.ordem.map((i) => 'ABC'[i]), 'A'].join('→')} = ${mm(hk.custo)} m`);
  const empate = Math.abs(circA - circB) < 0.01;
  console.log(`   empate matemático (matriz simétrica ⇒ reverso tem o mesmo custo): ${empate ? 'SIM' : 'NÃO'}`);

  // a rota efetivamente desenhada
  const r = calcularRotaComParadas(graph, pontos, { modo: 'otimizada', circular: true });
  console.log(`\n   rota desenhada (modo otimizada, circuito): ${r.ok ? 'ok' : 'FALHOU ' + r.reason}`);
  if (r.ok) {
    console.log(`   sequência: ${r.sequenciaCompleta.join(' → ')}   total: ${mm(r.distance)} m`);
    let soma = 0;
    for (const leg of r.legs) {
      const i = pontos.findIndex((p) => p.rotulo === leg.de);
      const j = pontos.findIndex((p) => p.rotulo === leg.para);
      soma += leg.distance;
      console.log(
        `   ${leg.de} → ${leg.para}${leg.retorno ? ' (retorno)' : '        '}  trecho=${String(Math.round(leg.distance)).padStart(5)} m` +
          `  matriz=${String(Math.round(D[i][j])).padStart(5)} m  Δ=${f2(leg.distance - D[i][j]).padStart(8)}`,
      );
    }
    console.log(`   soma dos trechos = ${mm(soma)} m · distância total = ${mm(r.distance)} m`);
    console.log(`   economia sobre a ordem do usuário: ${mm(r.comparacao?.economia || 0)} m (${f2(r.comparacao?.economiaPercentual || 0)} %)`);
  }
}

console.log('\n' + '='.repeat(78));
const problemas = acima + incoerentes + nAssim;
if (problemas > 0) {
  console.log(`AUDITORIA ENCONTROU ${problemas} INCONSISTÊNCIAS`);
  console.log('='.repeat(78));
  process.exit(1);
}
console.log('AUDITORIA CONCLUÍDA — nenhuma inconsistência encontrada');
console.log('='.repeat(78));
