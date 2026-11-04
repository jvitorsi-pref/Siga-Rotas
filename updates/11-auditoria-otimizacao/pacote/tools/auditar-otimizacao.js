/**
 * tools/auditar-otimizacao.js
 * ---------------------------------------------------------------------------
 * AUDITORIA DO MODO "MENOR ROTA TOTAL (OTIMIZADA)" — sobre a rede REAL.
 *
 * O script audita, de ponta a ponta, o caminho do cálculo:
 *
 *   1. a MATRIZ DE CUSTOS (`matrizDistancias`) — cada célula é o caminho
 *      mínimo na rede viária (não a linha reta); a simetria é verificada;
 *   2. o HELD-KARP — comparado com a **enumeração de todas as permutações**
 *      (força bruta), que é a verdade-terreno do TSP;
 *   3. a ROTA DESENHADA — a soma dos trechos, a sequência percorrida e a
 *      igualdade entre o custo da matriz, o custo do Held-Karp e a
 *      distância total devolvida pela API;
 *   4. o EMPATE — o caso real em que a ordem do usuário e a ordem otimizada
 *      custam **exatamente o mesmo** (o cicloReverso tem o mesmo custo
 *      sempre que a matriz é simétrica) e, mesmo assim, a ordem devolvida
 *      é diferente da informada.
 *
 * Uso:  node tools/auditar-otimizacao.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildGraph } from '../core/graph.js';
import { unproject } from '../core/geo.js';
import {
  matrizDistancias,
  heldKarp,
  custoDaOrdem,
  otimizarOrdem,
  LIMITE_EXATO,
} from '../core/ordemParadas.js';
import { calcularRotaComParadas, MODOS_ORDEM } from '../core/rotaParadas.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = JSON.parse(readFileSync(join(RAIZ, 'data/network.snapshot.json'), 'utf8'));
const features = snapshot.features || snapshot;

/* ── utilidades ───────────────────────────────────────────────────────── */

/** Todas as permutações de uma lista de índices. */
function permutacoes(lista) {
  if (lista.length <= 1) return [lista];
  const out = [];
  lista.forEach((v, i) => {
    for (const p of permutacoes([...lista.slice(0, i), ...lista.slice(i + 1)])) {
      out.push([v, ...p]);
    }
  });
  return out;
}

const mm = (v) => Math.round(v).toLocaleString('pt-BR');
const f1 = (v) => v.toFixed(1).replace('.', ',');

/* ── o grafo real ─────────────────────────────────────────────────────── */

const graph = buildGraph(features, {});
console.log('='.repeat(74));
console.log('AUDITORIA DA OTIMIZAÇÃO — "MENOR ROTA TOTAL (OTIMIZADA)"');
console.log('='.repeat(74));
console.log(
  `rede: ${features.length} eixos · ${graph.diagnostics.nodes} nós · ` +
    `${graph.diagnostics.edges} arestas · ${graph.diagnostics.components} componentes`,
);

/* ── os casos auditados ───────────────────────────────────────────────── */

// Caso 1 — reprodução do sintoma relatado: a ordem do usuário e a ordem
// otimizada custam o MESMO (empate), e a ordem devolvida é o reverso.
const CASO_EMPATE = {
  titulo: 'caso real com empate (a ordem devolvida é o reverso da informada)',
  pontos: [
    { rotulo: 'A', latitude: -23.627891, longitude: -46.516183 },
    { rotulo: 'B', latitude: -23.621109, longitude: -46.516798 },
    { rotulo: 'C', latitude: -23.624177, longitude: -46.512398 },
    { rotulo: 'D', latitude: -23.628655, longitude: -46.509507 },
  ],
};

// Caso 2 — o mesmo roteiro, com uma parada a mais (5 pontos): a força bruta
// passa a ter 24 permutações.
const CASO_MAIOR = {
  titulo: 'caso real com 4 paradas (24 permutações na força bruta)',
  pontos: [
    { rotulo: 'A', latitude: -23.627891, longitude: -46.516183 },
    { rotulo: 'B', latitude: -23.621109, longitude: -46.516798 },
    { rotulo: 'C', latitude: -23.624177, longitude: -46.512398 },
    { rotulo: 'D', latitude: -23.628655, longitude: -46.509507 },
    { rotulo: 'E', latitude: -23.623118, longitude: -46.510166 },
  ],
};

const casos = [CASO_EMPATE, CASO_MAIOR];
let tudoOk = true;

for (const caso of casos) {
  const pontos = caso.pontos;
  const n = pontos.length;
  console.log('\n' + '-'.repeat(74));
  console.log(caso.titulo);
  console.log('-'.repeat(74));
  pontos.forEach((p) => console.log(`  ${p.rotulo}: ${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`));

  // ── 1. matriz de custos ──
  const { D, semCaminho, ms } = matrizDistancias(graph, pontos, {});
  console.log(`\n1) MATRIZ DE CUSTOS (metros, caminho mínimo na rede) — ${ms} ms`);
  console.log('       ' + pontos.map((p) => p.rotulo.padStart(10)).join(''));
  for (let i = 0; i < n; i++) {
    console.log(
      '   ' + pontos[i].rotulo.padEnd(5) +
        D[i].map((v) => (Number.isFinite(v) ? mm(v).padStart(10) : '      ∞  ')).join(''),
    );
  }
  // simetria (a rede é de pedestres: as arestas são bidirecionais)
  let simetrica = true;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (Math.abs(D[i][j] - D[j][i]) > 1e-6) simetrica = false;
    }
  }
  // diagonal e diagonal infinita
  const diagonalOk = D.every((linha, i) => linha[i] === 0);
  const semInf = semCaminho.length === 0;
  console.log(`   simetria D[i][j] = D[j][i] : ${simetrica ? 'SIM' : 'NÃO'}`);
  console.log(`   diagonal zerada            : ${diagonalOk ? 'SIM' : 'NÃO'}`);
  console.log(`   pares sem caminho viário   : ${semInf ? 'nenhum' : semCaminho.length}`);
  if (!simetrica || !diagonalOk || !semInf) tudoOk = false;

  // a matriz é de caminhos viários, não de linha reta: confere-se que cada
  // célula é >= à distância euclidiana entre os pontos
  const geo = await import('../core/geo.js');
  let semLinhaReta = true;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const reto = geo.dist(
        ...geo.project(pontos[i].longitude, pontos[i].latitude),
        ...geo.project(pontos[j].longitude, pontos[j].latitude),
      );
      if (D[i][j] < reto - 1e-6) semLinhaReta = false;
    }
  }
  console.log(`   nenhum custo é menor que a linha reta: ${semLinhaReta ? 'SIM' : 'NÃO'}`);
  if (!semLinhaReta) tudoOk = false;

  // ── 2. força bruta × Held-Karp ──
  const paradas = pontos.slice(1).map((_, i) => i + 1);
  const todas = permutacoes(paradas);
  const tabela = todas.map((p) => ({
    p,
    custo: custoDaOrdem(D, p, 0, 0), // circuito: o fecho (última → A) entra
  }));
  tabela.sort((a, b) => a.custo - b.custo);
  const optimoBruto = tabela[0].custo;

  const hk = heldKarp(D, paradas, 0, 0);
  console.log(`\n2) FORÇA BRUTA (${tabela.length} permutações do circuito, retorno a A incluído)`);
  console.log('   sequência          pernas (m)                                   total (m)');
  for (const t of tabela) {
    const pernas = t.p.map((v, k) => [v, k + 1 < t.p.length ? t.p[k + 1] : 0]);
    const detalhe = pernas
      .map(([v, w]) => `${pontos[v].rotulo}→${pontos[w].rotulo}=${mm(D[v][w])}`)
      .join(' ');
    const ehOtimo = Math.abs(t.custo - optimoBruto) < 1e-6;
    console.log(
      `   A→${t.p.map((i) => pontos[i].rotulo).join('→')}→A  ${detalhe.padEnd(38)} ${mm(t.custo).padStart(9)}` +
        (ehOtimo ? '   ← ótima' : ''),
    );
  }
  const confere = Math.abs(hk.custo - optimoBruto) < 1e-6;
  console.log(`   Held-Karp devolve: A→${hk.ordem.map((i) => pontos[i].rotulo).join('→')}→A = ${mm(hk.custo)} m`);
  console.log(`   Held-Karp == força bruta: ${confere ? 'SIM' : 'NÃO'}`);
  if (!confere) tudoOk = false;

  // a sequência do Held-Karp tem de usar cada parada exatamente uma vez
  const distintas = new Set(hk.ordem);
  const completo = hk.ordem.length === paradas.length && distintas.size === paradas.length;
  console.log(`   cada parada visitada exatamente uma vez: ${completo ? 'SIM' : 'NÃO'}`);
  if (!completo) tudoOk = false;

  // ── 3. a rota efetivamente desenhada ──
  console.log(
    '\n3) ROTA DESENHADA (mesmo caminho da API: POST /api/rota-paradas → calcularRotaComParadas)',
  );
  const r = calcularRotaComParadas(graph, pontos, {
    modo: MODOS_ORDEM.OTIMIZADA,
    circular: true,
  });
  if (!r.ok) {
    console.log(`   FALHOU: ${r.reason} — ${r.message}`);
    tudoOk = false;
    continue;
  }
  const soma = r.legs.reduce((s, l) => s + l.distance, 0);
  let legsOk = true;
  for (const leg of r.legs) {
    const i = pontos.findIndex((p) => p.rotulo === leg.de);
    const j = pontos.findIndex((p) => p.rotulo === leg.para);
    const daMatriz = D[i][j];
    const dif = Math.abs(daMatriz - leg.distance);
    if (dif > 1e-6) legsOk = false;
    console.log(
      `   ${leg.de} → ${leg.para}${leg.retorno ? ' (retorno à origem)' : ''}` +
        `   trecho=${mm(leg.distance)} m   matriz=${mm(daMatriz)} m   Δ=${dif.toExponential(1)} m`,
    );
  }
  const somaIgual = Math.abs(soma - r.distance) < 1e-6;
  const custoIgual = Math.abs(r.otimizacao.custo - soma) < 1e-6;
  const brutoIgual = Math.abs(r.otimizacao.custo - optimoBruto) < 1e-6;
  console.log(`   soma dos trechos = distância total      : ${somaIgual ? 'SIM' : 'NÃO'} (${f1(soma)} m)`);
  console.log(`   custo do Held-Karp = soma dos trechos   : ${custoIgual ? 'SIM' : 'NÃO'}`);
  console.log(`   custo do Held-Karp = força bruta        : ${brutoIgual ? 'SIM' : 'NÃO'}`);
  console.log(`   sequência percorrida (painel)           : ${r.sequenciaCompleta.join(' → ')}`);
  // a sequência do mapa é a lista de rótulos dos trechos (A, D, …, A)
  const seqMapa = r.legs.map((l) => l.de).concat(r.legs[r.legs.length - 1].para);
  const seqOk = r.sequenciaCompleta.join('→') === seqMapa.join('→');
  console.log(`   sequência desenhada (mapa, por trecho)  : ${seqMapa.join(' → ')}`);
  console.log(`   sequência do painel = sequência do mapa  : ${seqOk ? 'SIM' : 'NÃO'}`);
  console.log(
    `   economia sobre a ordem do usuário         : ${mm(r.comparacao.economia)} m ` +
      `(${f1(r.comparacao.economiaPercentual)} %) — ` +
      `usuário=${mm(r.comparacao.distanciaUsuario)} m, otimizada=${mm(r.comparacao.distanciaOtimizada)} m`,
  );
  if (!legsOk || !somaIgual || !custoIgual || !brutoIgual || !seqOk) tudoOk = false;

  // ── 4. o modo "ordem do usuário" não pode ser tocado ──
  const ru = calcularRotaComParadas(graph, pontos, {
    modo: MODOS_ORDEM.USUARIO,
    circular: true,
  });
  const ordemUsuarioOk =
    ru.sequenciaCompleta.join('→') === pontos.map((p) => p.rotulo).concat(pontos[0].rotulo).join('→');
  console.log(`\n4) MODO "ORDEM DO USUÁRIO" (não deve ser alterado)`);
  console.log(`   sequência devolvida: ${ru.sequenciaCompleta.join(' → ')}`);
  console.log(`   igual à informada  : ${ordemUsuarioOk ? 'SIM' : 'NÃO'}`);
  if (!ordemUsuarioOk) tudoOk = false;

  // ── 5. método declarado ──
  const ot = otimizarOrdem(graph, pontos, { circular: true });
  console.log(`\n5) MÉTODO DECLARADO: ${ot.metodo} (exato até ${LIMITE_EXATO} paradas intermediárias)`);
}

console.log('\n' + '='.repeat(74));
console.log(tudoOk ? 'AUDITORIA CONCLUÍDA — nenhuma inconsistência encontrada' : 'AUDITORIA ENCONTROU INCONSISTÊNCIAS');
console.log('='.repeat(74));
process.exit(tudoOk ? 0 : 1);
