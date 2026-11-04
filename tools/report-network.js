#!/usr/bin/env node
/**
 * Ferramenta: relatório de qualidade da rede viária.
 *
 *   npm run report                # imprime no terminal
 *   npm run report -- --markdown  # imprime em Markdown
 *
 * Produz um retrato quantitativo do que a camada publica e do que o motor
 * extrai dela — é o insumo para avaliar se a rede está apta para uso.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGraph } from '../core/graph.js';
import { unproject } from '../core/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SNAP = path.join(ROOT, 'data', 'network.snapshot.json');
const MARKDOWN = process.argv.includes('--markdown');

if (!existsSync(SNAP)) {
  console.error('Snapshot ausente. Execute "npm run fetch" antes.');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(SNAP, 'utf8'));
const features = Array.isArray(raw) ? raw : raw.features;
const graph = buildGraph(features);
const d = graph.diagnostics;

/* ---- estatisticas dos atributos ---- */
const porTipo = new Map();
const porNome = new Map();
let naoOficiais = 0;
let semDescricao = 0;
let comTitulo = 0;
let comprimentoTotal = 0;

for (const f of features) {
  const p = f.properties;
  porTipo.set(p.TPO_LOGRADOURO, (porTipo.get(p.TPO_LOGRADOURO) || 0) + 1);
  porNome.set(p.DSC_LOGRADOURO, (porNome.get(p.DSC_LOGRADOURO) || 0) + 1);
  if (Number(p.COD_LOG) === 0) naoOficiais++;
  if (!p.DSC_LOGRADOURO) semDescricao++;
  if (p.COD_TITULO_LOGRADOURO) comTitulo++;
}

/* ---- comprimento total da rede ---- */
for (const e of graph.edges) comprimentoTotal += e.length;

/* ---- componentes ---- */
const tamanhos = [...(d.componentSizes || [])].sort((a, b) => b - a);
const isoladas = tamanhos.filter((t) => t <= 3).length;

/* ---- eixos mais longos ---- */
const porEixo = new Map();
for (const e of graph.edges) {
  const k = e.featureId;
  porEixo.set(k, (porEixo.get(k) || 0) + e.length);
}
const maisLongos = [...porEixo.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([id, len]) => {
    const f = features.find((x) => Number(x.properties.ID) === Number(id));
    return { id, len, nome: f?.properties?.DSC_LOGRADOURO || '(sem nome)' };
  });

const [w, s] = unproject(graph.metricBbox[0], graph.metricBbox[3]);
const [l, n] = unproject(graph.metricBbox[2], graph.metricBbox[1]);

const linhas = [];
const p = (s) => linhas.push(s);

if (MARKDOWN) {
  p('# Relatório de qualidade da rede viária de Santo André');
  p('');
  p(`Camada: \`${raw.layer || 'siga:SIGA_EIXO_LOG_OFICIAL_E_NAO'}\` · `);
  p(`Gerado a partir de **${features.length} feições** da camada do GeoServer da Prefeitura.`);
  p('');
  p('## 1. Volume');
  p('');
  p('| Métrica | Valor |');
  p('|---|---|');
  p(`| Feições | ${features.length} |`);
  p(`| Nós no grafo | ${d.nodes} |`);
  p(`| Arestas no grafo | ${d.edges} |`);
  p(`| Comprimento total da rede | ${(comprimentoTotal / 1000).toFixed(1)} km |`);
  p(`| Extensão | ${Math.abs(l - w).toFixed(3)}° lon × ${Math.abs(n - s).toFixed(3)}° lat |`);
  p('');
  p('## 2. Atributos');
  p('');
  p('| Métrica | Valor |');
  p('|---|---|');
  p(`| Logradouros oficiais | ${features.length - naoOficiais} |`);
  p(`| Eixos não oficializados | ${naoOficiais} |`);
  p(`| Nomes distintos | ${porNome.size} |`);
  p(`| Sem DSC_LOGRADOURO | ${semDescricao} |`);
  p(`| Com COD_TITULO_LOGRADOURO | ${comTitulo} |`);
  p('');
  p('### Tipos de logradouro');
  p('');
  p('| Tipo | Eixos |');
  p('|---|---|');
  for (const [k, v] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) {
    p(`| ${k} | ${v} |`);
  }
  p('');
  p('## 3. Conectividade');
  p('');
  p('| Métrica | Valor |');
  p('|---|---|');
  p(`| Componentes conexas | ${d.components} |`);
  p(`| Nós na maior componente | ${d.largestComponent} (${((d.largestComponent / d.nodes) * 100).toFixed(1)} %) |`);
  p(`| Componentes com até 3 nós | ${isoladas} |`);
  p(`| Cruzamentos geométricos | ${d.crossings} |`);
  p(`| Snaps (≤ 5 cm) | ${d.snaps} |`);
  p(`| Fusões de extremidade | ${d.merges} |`);
  p(`| Sobreposições colineares | ${d.overlaps} |`);
  p(`| Duplicidades removidas | ${d.duplicatesRemoved} |`);
  p(`| Junções perdidas | **${d.junctionsLost}** |`);
  p('');
  p('## 4. Eixos mais longos');
  p('');
  p('| ID | Logradouro | Extensão (m) |');
  p('|---|---|---|');
  for (const e of maisLongos) p(`| ${e.id} | ${e.nome} | ${e.len.toFixed(0)} |`);
  p('');
  p('## 5. Diagnóstico do motor');
  p('');
  p('```json');
  p(JSON.stringify(d, null, 2));
  p('```');
} else {
  p('════════════════════════════════════════════════════════════════════');
  p('  RELATÓRIO DE QUALIDADE DA REDE VIÁRIA — SANTO ANDRÉ');
  p('════════════════════════════════════════════════════════════════════');
  p(`  feições            : ${features.length}`);
  p(`  nós / arestas      : ${d.nodes} / ${d.edges}`);
  p(`  comprimento total  : ${(comprimentoTotal / 1000).toFixed(1)} km`);
  p(`  extensão           : lon ${w.toFixed(4)}..${l.toFixed(4)} · lat ${s.toFixed(4)}..${n.toFixed(4)}`);
  p('────────────────────────────────────────────────────────────────────');
  p(`  oficiais           : ${features.length - naoOficiais}`);
  p(`  não oficializados  : ${naoOficiais}`);
  p(`  nomes distintos    : ${porNome.size}`);
  p(`  sem descrição      : ${semDescricao}`);
  p('────────────────────────────────────────────────────────────────────');
  p(`  componentes        : ${d.components} (maior ${d.largestComponent}, ${((d.largestComponent / d.nodes) * 100).toFixed(1)} % dos nós)`);
  p(`  isoladas (≤3 nós)  : ${isoladas}`);
  p(`  cruzamentos        : ${d.crossings}`);
  p(`  snaps / fusões     : ${d.snaps} / ${d.merges}`);
  p(`  duplicidades       : ${d.duplicatesRemoved} (removidas)`);
  p(`  junções perdidas   : ${d.junctionsLost}`);
  p('────────────────────────────────────────────────────────────────────');
  p('  tipos de logradouro:');
  for (const [k, v] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) {
    p(`    ${String(k).padEnd(8)} ${String(v).padStart(5)}`);
  }
  p('  eixos mais longos:');
  for (const e of maisLongos) {
    p(`    ${String(e.id).padEnd(7)} ${e.len.toFixed(0).padStart(6)} m  ${e.nome}`);
  }
  p('════════════════════════════════════════════════════════════════════');
}

console.log(linhas.join('\n'));
