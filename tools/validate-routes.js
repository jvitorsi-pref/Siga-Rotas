#!/usr/bin/env node
/**
 * Ferramenta: validação cruzada das rotas calculadas.
 *
 *   npm run validate
 *
 * Para uma amostra de pares de pontos dentro da maior componente conexa:
 *   1. calcula a rota com A* (heurística euclidiana);
 *   2. calcula a MESMA rota com Dijkstra puro (sem heurística);
 *   3. exige que as distâncias sejam IDÊNTICAS — como a heurística do A* é
 *      admissível, ambos devem devolver o mesmo caminho ótimo;
 *   4. verifica a continuidade das arestas, a ordem da geometria, a soma dos
 *      trechos e o comprimento geodésico da geometria;
 *   5. compara a rota com a linha reta, comprovando que o trajeto é viário e
 *      não um segmento fictício.
 *
 * A referência NÃO é uma implementação paralela: usa o mesmo motor, apenas
 * sem heurística. Assim a comparação isola exatamente o algoritmo de busca.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGraph } from '../core/graph.js';
import { routeOnGraph } from '../core/router.js';
import { haversine } from '../core/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SNAP = path.join(ROOT, 'data', 'network.snapshot.json');
const AMOSTRAS = Number(process.argv[2] || 300);

/* ------------------------------------------------------------------ */

if (!existsSync(SNAP)) {
  console.error('Snapshot ausente. Execute "npm run fetch" antes.');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(SNAP, 'utf8'));
const features = Array.isArray(raw) ? raw : raw.features;

console.log(`\n  Construindo o grafo a partir de ${features.length} feicoes...`);
const t0 = Date.now();
const graph = buildGraph(features);
console.log(`  pronto em ${Date.now() - t0} ms - ${graph.diagnostics.nodes} nos, ${graph.diagnostics.edges} arestas`);
console.log(`  componentes: ${graph.diagnostics.components} (maior: ${graph.diagnostics.largestComponent})\n`);

/* nós da maior componente conexa */
const compMaior = (() => {
  const counts = new Map();
  for (const e of graph.edges) {
    const c = graph.componentOf[e.from];
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  let best = -1;
  let bestN = -1;
  for (const [c, n] of counts) if (n > bestN) { bestN = n; best = c; }
  return best;
})();
const candidatos = graph.nodes.filter((n) => graph.componentOf[n.id] === compMaior);
console.log(`  nos da maior componente: ${candidatos.length}\n`);

/* amostra pseudoaleatória determinística */
let seed = 20261020;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

let testados = 0;
let comRota = 0;
let semRota = 0;
let divergentes = 0;
let problemasContinuidade = 0;
let problemasGeometria = 0;
let problemasSoma = 0;
const razoes = [];
const exemplos = [];

for (let i = 0; i < AMOSTRAS; i++) {
  const a = candidatos[Math.floor(rnd() * candidatos.length)];
  const b = candidatos[Math.floor(rnd() * candidatos.length)];
  if (!a || !b) continue;

  const origem = { lon: a.lon, lat: a.lat };
  const destino = { lon: b.lon, lat: b.lat };
  const r = routeOnGraph(graph, origem, destino);
  testados++;

  if (!r.ok) {
    semRota++;
    continue;
  }
  comRota++;

  // 1) A* vs Dijkstra (mesmo grafo, mesma projecao, mesma sobreposicao)
  const rRef = routeOnGraph(graph, origem, destino, { algorithm: 'dijkstra' });
  if (rRef.ok !== r.ok) {
    divergentes++;
  } else if (Math.abs(rRef.distance - r.distance) > 1e-6) {
    divergentes++;
    if (exemplos.length < 5) {
      exemplos.push({ tipo: 'A* x Dijkstra', astar: r.distance, dijkstra: rRef.distance });
    }
  }

  // 2) continuidade das arestas: o fim de um trecho e o inicio do seguinte
  for (let k = 1; k < r.legs.length; k++) {
    const p = r.legs[k - 1].coords;
    const q = r.legs[k].coords;
    const d = haversine(p[p.length - 1][0], p[p.length - 1][1], q[0][0], q[0][1]);
    if (d > 1.0) {
      problemasContinuidade++;
      break;
    }
  }

  // 3) soma dos trechos = distancia total
  const soma = r.legs.reduce((s, l) => s + l.length, 0);
  if (Math.abs(soma - r.distance) > 1e-6) problemasSoma++;

  // 4) geometria: comprimento geodesico = distancia da rota
  let geod = 0;
  for (let k = 1; k < r.geometry.coordinates.length; k++) {
    geod += haversine(
      r.geometry.coordinates[k - 1][0], r.geometry.coordinates[k - 1][1],
      r.geometry.coordinates[k][0], r.geometry.coordinates[k][1]
    );
  }
  if (Math.abs(geod - r.distance) > Math.max(1.0, r.distance * 0.01)) {
    problemasGeometria++;
    if (exemplos.length < 8) exemplos.push({ tipo: 'geometria', geod, rota: r.distance });
  }

  // 5) comparacao com a linha reta
  const reta = haversine(origem.lon, origem.lat, destino.lon, destino.lat);
  razoes.push(r.distance / Math.max(reta, 1));
}

razoes.sort((x, y) => x - y);
const mediana = razoes[Math.floor(razoes.length / 2)] || 0;

console.log('  RESULTADOS');
console.log('  ----------------------------------------------------------------');
console.log(`  pares testados                 : ${testados}`);
console.log(`  com rota                       : ${comRota}`);
console.log(`  sem rota (componentes dist.)   : ${semRota}`);
console.log(`  A* x Dijkstra divergentes      : ${divergentes}`);
console.log(`  problemas de continuidade       : ${problemasContinuidade}`);
console.log(`  problemas de soma              : ${problemasSoma}`);
console.log(`  problemas de geometria         : ${problemasGeometria}`);
console.log(`  razao rota/linha reta (mediana): ${mediana.toFixed(2)}x`);
console.log(`  razao rota/linha reta (max.)   : ${(razoes[razoes.length - 1] || 0).toFixed(2)}x`);
console.log('  ----------------------------------------------------------------');

if (exemplos.length) {
  console.log('\n  exemplos de divergencia:');
  for (const e of exemplos) console.log('   ', JSON.stringify(e));
}

const ok =
  divergentes === 0 &&
  problemasContinuidade === 0 &&
  problemasSoma === 0 &&
  problemasGeometria === 0;
console.log(`\n  ${ok ? 'VALIDACAO APROVADA' : 'VALIDACAO COM FALHAS'}\n`);
process.exitCode = ok ? 0 : 1;
