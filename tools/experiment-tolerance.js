#!/usr/bin/env node
/**
 * Experimento: quanto a tolerância de junção afeta o COMPRIMENTO das rotas?
 *
 * IMPORTANTE: os resultados são mantidos indexados pelo PAR (não pela ordem
 * de sucesso), para que a comparação entre tolerâncias seja correta mesmo
 * quando uma delas não encontra rota.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGraph } from '../core/graph.js';
import { routeOnGraph } from '../core/router.js';
import { unproject } from '../core/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const raw = JSON.parse(readFileSync(path.join(ROOT, 'data', 'network.snapshot.json'), 'utf8'));
const features = Array.isArray(raw) ? raw : raw.features;

const TOLERANCIAS = [0.05, 0.10, 0.25, 0.50, 1.0, 1.5, 2.0, 3.0, 5.0];
const N = Number(process.argv[2] || 400);

console.log('\n  Montando grafos com tolerâncias diferentes...');
const grafos = TOLERANCIAS.map((t) => {
  const t0 = Date.now();
  const g = buildGraph(features, { snapTolerance: t });
  console.log(
    `    snap=${String(t).padStart(5)} m -> nos ${String(g.diagnostics.nodes).padStart(6)}` +
      ` arestas ${String(g.diagnostics.edges).padStart(6)}` +
      ` componentes ${String(g.diagnostics.components).padStart(4)}` +
      ` snaps ${String(g.diagnostics.snaps).padStart(4)}` +
      ` (${Date.now() - t0} ms)`
  );
  return g;
});

/* pares determinísticos */
let seed = 4242;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const eixos = grafos[0].edges.filter((e) => e.coords.length >= 2);
const pares = [];
for (let i = 0; i < N; i++) {
  const a = eixos[Math.floor(rnd() * eixos.length)];
  const b = eixos[Math.floor(rnd() * eixos.length)];
  if (!a || !b) continue;
  const pa = a.coords[Math.floor(rnd() * a.coords.length)];
  const pb = b.coords[Math.floor(rnd() * b.coords.length)];
  pares.push([
    { lon: unproject(pa[0], pa[1])[0], lat: unproject(pa[0], pa[1])[1] },
    { lon: unproject(pb[0], pb[1])[0], lat: unproject(pb[0], pb[1])[1] },
  ]);
}

console.log(`\n  Calculando ${pares.length} rotas em cada tolerancia...`);
/* resultados indexados pelo par: res[i][k] = distancia ou null */
const res = TOLERANCIAS.map(() => new Array(pares.length).fill(null));
for (let k = 0; k < pares.length; k++) {
  const [o, d] = pares[k];
  TOLERANCIAS.forEach((t, i) => {
    const r = routeOnGraph(grafos[i], o, d);
    res[i][k] = r.ok ? r.distance : null;
  });
}

console.log('\n  TOLERANCIA   ROTAS OK   SEM ROTA   MEDIA (pares comuns)   MELHOROU   PIOROU');
console.log('  ----------------------------------------------------------------------------------');
const base = res[0];
for (let i = 0; i < TOLERANCIAS.length; i++) {
  const vals = res[i].filter((v) => v !== null);
  const media = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0;
  let melhorou = 0, piorou = 0, igual = 0, ganho = 0;
  for (let k = 0; k < pares.length; k++) {
    const a = base[k], b = res[i][k];
    if (a === null || b === null) continue;
    if (b < a - 0.5) { melhorou++; ganho += a - b; }
    else if (b > a + 0.5) piorou++;
    else igual++;
  }
  const dif = i === 0 ? '' : `${(((media - mediaBase) / mediaBase) * 100).toFixed(1)}%`;
  console.log(
    `  ${String(TOLERANCIAS[i]).padStart(7)} m   ${String(vals.length).padStart(8)}   ${String(pares.length - vals.length).padStart(8)}   ` +
      `${media.toFixed(0).padStart(12)} m ${dif.padStart(8)}   ${String(melhorou).padStart(7)}   ${String(piorou).padStart(6)}` +
      (ganho > 0 ? `   (ganho total ${(ganho / 1000).toFixed(1)} km)` : '')
  );
  if (i === 0) { var mediaBase = media; }
}
console.log();
