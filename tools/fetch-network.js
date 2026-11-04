#!/usr/bin/env node
/**
 * Ferramenta: baixa a rede viária do GeoServer e grava o snapshot local.
 *
 *   npm run fetch                 # baixa e grava data/network.snapshot.json
 *   npm run fetch -- --out X.json # destino alternativo
 *   npm run fetch -- --no-graph   # só baixa, sem construir o grafo
 *
 * O snapshot é usado no arranque do servidor (evita depender da rede do
 * município) e como base reproduzível dos testes de integração.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchNetwork } from '../core/wfs.js';
import { buildGraph } from '../core/graph.js';
import { LAYER_NAME } from '../core/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const out = path.resolve(ROOT, arg('--out', 'data/network.snapshot.json'));
const skipGraph = process.argv.includes('--no-graph');

console.log(`\n  Baixando a rede viária`);
console.log(`  camada : ${LAYER_NAME}`);
console.log(`  destino: ${out}\n`);

// --force-pagination: nao permite a requisicao unica (maxFeatures pequeno),
// forcando a queda para paginacao por startIndex e, em seguida, por CQL.
const forcePagination = process.argv.includes('--force-pagination');
const pageSize = Number(arg('--page-size', 1000));

const t0 = Date.now();
const result = await fetchNetwork({
  typeName: LAYER_NAME,
  pageSize,
  maxFeaturesPerRequest: forcePagination ? pageSize : 5000,
});

console.log(`  feições obtidas  : ${result.features.length}`);
console.log(`  total no servidor: ${result.serverTotal}`);
console.log(`  estratégia       : ${result.strategy}`);
console.log(`  requisições      : ${result.pages}`);
console.log(`  tempo            : ${result.elapsedMs} ms`);
console.log(`  atributos        : ${result.attributes.join(', ')}`);

for (const w of result.warnings) console.log(`  aviso            : ${w}`);

if (result.serverTotal !== null && result.features.length < result.serverTotal) {
  console.error(
    `\n  ATENÇÃO: ${result.serverTotal - result.features.length} feições faltando. ` +
      'A rede esta incompleta.\n'
  );
  process.exitCode = 1;
}

let diagnostics = null;
if (!skipGraph) {
  const g0 = Date.now();
  const graph = buildGraph(result.features);
  diagnostics = graph.diagnostics;
  console.log(`\n  grafo construído em ${Date.now() - g0} ms`);
  console.log(`  nós                : ${diagnostics.nodes}`);
  console.log(`  arestas            : ${diagnostics.edges}`);
  console.log(`  cruzamentos        : ${diagnostics.crossings}`);
  console.log(`  componentes conexas: ${diagnostics.components} (maior: ${diagnostics.largestComponent})`);
}

const payload = {
  savedAt: Date.now(),
  layer: LAYER_NAME,
  serverTotal: result.serverTotal,
  strategy: result.strategy,
  pages: result.pages,
  attributes: result.attributes,
  warnings: result.warnings,
  diagnostics,
  features: result.features,
};

await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(payload), 'utf8');

console.log(`\n  snapshot gravado: ${out}`);
console.log(`  total: ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
