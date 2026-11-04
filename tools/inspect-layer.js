#!/usr/bin/env node
/**
 * Ferramenta: inspeciona a camada WFS e relata a sua estrutura real.
 *
 *   npm run inspect
 *
 * Responde, com dados reais e não com suposições:
 *  - quais atributos a camada publica (DescribeFeatureType);
 *  - quais tipos de geometria existem;
 *  - a distribuição dos atributos relevantes (oficial x não oficial);
 *  - a extensão geográfica e a contagem de feições;
 *  - a "saúde" da conectividade: quantas extremidades encostam, quantas
 *    estão a poucos centímetros, quantos cruzamentos geométricos existem;
 *  - o resultado da construção do grafo (nós, arestas, componentes).
 */

import { fetchNetwork, describeLayer } from '../core/wfs.js';
import { buildGraph } from '../core/graph.js';
import { unproject } from '../core/geo.js';
import { LAYER_NAME } from '../core/config.js';

const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(72));

line();
hr();
line('  INSPEÇÃO DA CAMADA WFS');
hr();
line(`  camada: ${LAYER_NAME}`);
line();

/* ------------------------------------------------------------------ */
line('▸ DescribeFeatureType — atributos publicados');
hr();
const schema = await describeLayer({});
for (const a of schema.attributes) {
  line(`  ${a.name.padEnd(24)} ${String(a.type || '').padEnd(22)} ${a.nillable ? 'anulável' : 'obrigatório'}`);
}
line();

/* ------------------------------------------------------------------ */
line('▸ Amostragem e estatísticas');
hr();
const { features, serverTotal, strategy, pages, elapsedMs, warnings } = await fetchNetwork({
  typeName: LAYER_NAME,
});

const geomTypes = {};
const typeCounts = {};
const codLogZero = [];
const nameCounts = {};
for (const f of features) {
  const g = f.geometry;
  geomTypes[g?.type || 'nenhuma'] = (geomTypes[g?.type || 'nenhuma'] || 0) + 1;
  const t = f.properties.TPO_LOGRADOURO;
  typeCounts[t] = (typeCounts[t] || 0) + 1;
  nameCounts[f.properties.NOM_LOGRADOURO] = (nameCounts[f.properties.NOM_LOGRADOURO] || 0) + 1;
  if (Number(f.properties.COD_LOG) === 0) codLogZero.push(f);
}

line(`  feições obtidas     : ${features.length}`);
line(`  total no servidor  : ${serverTotal}`);
line(`  estratégia de carga: ${strategy} (${pages} requisições, ${elapsedMs} ms)`);
line();
line('  tipos de geometria:');
for (const [k, v] of Object.entries(geomTypes).sort((a, b) => b[1] - a[1])) {
  line(`    ${k.padEnd(18)} ${v}`);
}
line();
line('  TPO_LOGRADOURO (tipo do logradouro):');
for (const [k, v] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  line(`    ${String(k).padEnd(18)} ${v}`);
}
line();
line(`  eixos NÃO oficializados (COD_LOG = 0): ${codLogZero.length}`);
for (const f of codLogZero.slice(0, 12)) {
  line(`    ID ${String(f.properties.ID).padEnd(6)} ${f.properties.DSC_LOGRADOURO}`);
}
if (codLogZero.length > 12) line(`    … e mais ${codLogZero.length - 12}`);
line();

/* extensão */
let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
let vertices = 0;
for (const f of features) {
  const g = f.geometry;
  const rings = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  for (const r of rings) {
    for (const [lon, lat] of r) {
      vertices++;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
}
line('  extensão (EPSG:4326):');
line(`    lon ${minLon.toFixed(6)} .. ${maxLon.toFixed(6)}`);
line(`    lat ${minLat.toFixed(6)} .. ${maxLat.toFixed(6)}`);
line(`    vértices totais: ${vertices}`);
line();

for (const w of warnings) line(`  aviso: ${w}`);
line();

/* ------------------------------------------------------------------ */
line('▸ Construção do grafo');
hr();
const t0 = Date.now();
const graph = buildGraph(features);
const d = graph.diagnostics;
line(`  tempo de construção: ${Date.now() - t0} ms`);
line(`  nós                : ${d.nodes}`);
line(`  arestas            : ${d.edges}`);
line(`  cruzamentos reais  : ${d.crossings}`);
line(`  toques de extremidade: ${d.touches}`);
line(`  sobreposições      : ${d.overlaps}`);
line(`  snaps (< 5 cm)     : ${d.snaps}`);
line(`  fusões de extremidade: ${d.merges}`);
line(`  junções unificadas : ${d.junctionsUnified} (perdidas: ${d.junctionsLost})`);
line(`  duplicidades removidas: ${d.duplicatesRemoved}`);
line(`  componentes conexas : ${d.components} (maior: ${d.largestComponent})`);
line();

const [sw, nw] = unproject(graph.metricBbox[0], graph.metricBbox[3]);
const [se, ne] = unproject(graph.metricBbox[2], graph.metricBbox[1]);
line('  extensão em metros (UTM 23S):');
line(`    X ${graph.metricBbox[0].toFixed(0)} .. ${graph.metricBbox[2].toFixed(0)}`);
line(`    Y ${graph.metricBbox[1].toFixed(0)} .. ${graph.metricBbox[3].toFixed(0)}`);
line(`    (lon ${sw.toFixed(5)}..${se.toFixed(5)}, lat ${nw.toFixed(5)}..${ne.toFixed(5)})`);
line();
hr();
line();
