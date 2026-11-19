#!/usr/bin/env node
/**
 * Ferramenta: baixa a rede viária do GeoServer WFS e grava os snapshots locais
 * de forma atômica, preservando arquivos válidos em caso de retorno vazio ou
 * geograficamente incompleto.
 *
 *   npm run fetch                 # baixa via WFS e sincroniza data/, public/ e APK/
 *   npm run fetch -- --sync-local # valida data/network.snapshot.json e sincroniza public/ e APK/
 *   npm run fetch -- --out X.json # destino alternativo
 *   npm run fetch -- --no-graph   # só valida geometria, sem construir o grafo
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
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

function temGeometriaViariaValida(features) {
  let validas = 0;
  for (const f of features) {
    const geom = f?.geometry;
    if (!geom) continue;
    const linhas =
      geom.type === 'LineString'
        ? [geom.coordinates]
        : geom.type === 'MultiLineString'
          ? geom.coordinates
          : null;
    if (!Array.isArray(linhas)) continue;
    for (const linha of linhas) {
      if (!Array.isArray(linha) || linha.length < 2) continue;
      if (
        linha.every(
          (pt) =>
            Array.isArray(pt) &&
            pt.length >= 2 &&
            Number.isFinite(Number(pt[0])) &&
            Number.isFinite(Number(pt[1])),
        )
      ) {
        validas++;
        break;
      }
    }
  }
  return validas;
}

async function escreverAtomico(targetPath, content) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, content, 'utf8');
  await rename(tmpPath, targetPath);
}

const syncLocal = process.argv.includes('--sync-local');
const out = path.resolve(ROOT, arg('--out', 'data/network.snapshot.json'));
const skipGraph = process.argv.includes('--no-graph');
const skipApk = process.argv.includes('--skip-apk');
const customOut = Boolean(arg('--out', ''));

const t0 = Date.now();
let payload;

if (syncLocal) {
  const raw = await readFile(out, 'utf8');
  payload = JSON.parse(raw);
  console.log(`\n  Sincronizando snapshot local existente`);
  console.log(`  origem : ${out}`);
} else {
  console.log(`\n  Baixando a rede viária via WFS`);
  console.log(`  camada : ${LAYER_NAME}`);
  console.log(`  destino: ${out}\n`);

  const forcePagination = process.argv.includes('--force-pagination');
  const pageSize = Number(arg('--page-size', 1000));

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

  payload = {
    savedAt: Date.now(),
    layer: LAYER_NAME,
    serverTotal: result.serverTotal,
    strategy: result.strategy,
    pages: result.pages,
    attributes: result.attributes,
    warnings: result.warnings,
    features: result.features,
  };
}

// Validação de completude e integridade geográfica ANTES de sobrescrever qualquer arquivo
if (!Array.isArray(payload?.features) || payload.features.length === 0) {
  console.error('\n  ERRO: conjunto de feições vazio; snapshots existentes preservados.\n');
  process.exit(1);
}

if (
  Number.isFinite(payload.serverTotal) &&
  payload.features.length < payload.serverTotal
) {
  console.error(
    `\n  ERRO: ${payload.serverTotal - payload.features.length} feições faltando ` +
      `(${payload.features.length}/${payload.serverTotal}); snapshots existentes preservados.\n`,
  );
  process.exit(1);
}

const geometriasValidas = temGeometriaViariaValida(payload.features);
if (geometriasValidas === 0) {
  console.error('\n  ERRO: nenhuma geometria viária LineString/MultiLineString válida; snapshots existentes preservados.\n');
  process.exit(1);
}

if (!skipGraph) {
  const g0 = Date.now();
  const graph = buildGraph(payload.features);
  const diagnostics = graph.diagnostics;
  if (!graph.edges.length) {
    console.error('\n  ERRO: grafo resultante sem arestas viárias válidas; snapshots existentes preservados.\n');
    process.exit(1);
  }
  if (!syncLocal) {
    payload.diagnostics = diagnostics;
  }
  console.log(`\n  grafo validado em ${Date.now() - g0} ms`);
  console.log(`  nós                : ${diagnostics.nodes}`);
  console.log(`  arestas            : ${diagnostics.edges}`);
  console.log(`  cruzamentos        : ${diagnostics.crossings}`);
  console.log(`  componentes conexas: ${diagnostics.components} (maior: ${diagnostics.largestComponent})`);
}

const serializado = JSON.stringify(payload);

if (!syncLocal) {
  await escreverAtomico(out, serializado);
  console.log(`\n  snapshot gravado : ${out}`);
}

if (!customOut) {
  const modPath = path.resolve(ROOT, 'public/network.snapshot.js');
  await escreverAtomico(
    modPath,
    '// Snapshot estático da rede viária em módulo ESM (fallback automático quando .json é bloqueado ou interceptado no IIS/WebForms)\n' +
      'export default JSON.parse(' +
      JSON.stringify(serializado) +
      ');\n',
  );
  console.log(`  módulo fallback  : ${modPath}`);

  if (!skipApk) {
    const apkSnapPath = path.resolve(ROOT, 'APK/src/data/network.snapshot.json');
    await escreverAtomico(apkSnapPath, serializado);
    console.log(`  snapshot APK     : ${apkSnapPath}`);
  }
}

console.log(`  total: ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
