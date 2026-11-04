#!/usr/bin/env node
/**
 * Diagnóstico: "conexões faltantes" e o custo que elas impõem à rota.
 *
 * Para cada par de nós do grafo que estão PRÓXIMOS no espaço (< 60 m) mas
 * NÃO ligados por uma aresta, mede-se a distância viária entre eles no
 * grafo. Quando essa distância é muito maior que a distância geométrica, a
 * ligação que falta é a responsável por um desvio.
 *
 * É esta medida que explica uma rota "que dá a volta" quando existia um
 * caminho direto.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGraph } from '../core/graph.js';
import { unproject } from '../core/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const raw = JSON.parse(readFileSync(path.join(ROOT, 'data', 'network.snapshot.json'), 'utf8'));
const features = Array.isArray(raw) ? raw : raw.features;

const graph = buildGraph(features);
console.log(`grafo: ${graph.diagnostics.nodes} nós, ${graph.diagnostics.edges} arestas\n`);

/* ---- vizinhos por aresta ---- */
const ligados = new Set();
for (const e of graph.edges) {
  ligados.add(`${Math.min(e.from, e.to)}|${Math.max(e.from, e.to)}`);
}

/* ---- grade espacial sobre os nós ---- */
const RAIO = 60; // metros
const CELL = RAIO;
const grid = new Map();
for (const n of graph.nodes) {
  const k = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(n);
}
const perto = (x, y) => {
  const out = [];
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const arr = grid.get(`${cx + dx},${cy + dy}`);
      if (arr) out.push(...arr);
    }
  }
  return out;
};

/* ---- Dijkstra a partir de cada nó de amostra (para medir o desvio) ---- */
function dijkstra(graph, start) {
  const d = new Map([[start, 0]]);
  const heap = [{ n: start, d: 0 }];
  while (heap.length) {
    heap.sort((a, b) => a.d - b.d);
    const { n, dist } = heap.shift();
    if (dist > (d.get(n) ?? Infinity) + 1e-9) continue;
    for (const link of graph.adjacency[n] || []) {
      const nd = dist + link.length;
      if (nd < (d.get(link.to) ?? Infinity)) {
        d.set(link.to, nd);
        heap.push({ n: link.to, d: nd });
      }
    }
  }
  return d;
}

const RAIO_ESTUDO = 60;
const candidatos = graph.nodes.filter((n) => n.x !== undefined);
let amostrados = 0;
const achados = [];

for (const n of candidatos) {
  if (amostrados >= 400) break;
  amostrados++;
  const d = dijkstra(graph, n.id);
  for (const m of perto(n.x, n.y)) {
    if (m.id === n.id) continue;
    const geo = Math.hypot(m.x - n.x, m.y - n.y);
    if (geo > RAIO_ESTUDO) continue;
    if (ligados.has(`${Math.min(n.id, m.id)}|${Math.max(n.id, m.id)}`)) continue;
    const vi = d.get(m.id);
    if (vi === undefined) continue;
    if (vi < geo * 1.8 + 25) continue;   // desvio tolerável
    achados.push({ a: n, b: m, geo, vi, excesso: vi - geo });
  }
}

achados.sort((x, y) => y.excesso - x.excesso);

console.log(`nós amostrados: ${amostrados}`);
console.log(`pares próximos (< ${RAIO_ESTUDO} m) sem ligação, com desvio > 1,8x: ${achados.length}\n`);
console.log('  DESVIO   GEO    VIÁRIA   NÓ A                            NÓ B');
console.log('  -----------------------------------------------------------');
for (const x of achados.slice(0, 25)) {
  const na = unproject(x.a.x, x.a.y);
  const nb = unproject(x.b.x, x.b.y);
  console.log(
    `  ${x.excesso.toFixed(0).padStart(6)} m ${x.geo.toFixed(0).padStart(5)} ${x.vi.toFixed(0).padStart(7)}   ` +
      `(${na[0].toFixed(5)},${na[1].toFixed(5)})      (${nb[0].toFixed(5)},${nb[1].toFixed(5)})`
  );
}

/* ---- nomes das ruas envolvidas no pior caso ---- */
console.log('\n  ruas próximas de cada par do topo (para diagnóstico):');
for (const x of achados.slice(0, 6)) {
  const ruaPerto = (node) => {
    const nomes = new Set();
    for (const e of graph.edges) {
      if (e.from === node.id || e.to === node.id) {
        nomes.add(e.props?.DSC_LOGRADOURO || e.props?.NOM_LOGRADOURO || '(sem nome)');
      }
    }
    return [...nomes].slice(0, 3).join(' | ');
  };
  console.log(`  ${x.excesso.toFixed(0)} m: [${ruaPerto(x.a)}]  <->  [${ruaPerto(x.b)}]`);
}
console.log();
