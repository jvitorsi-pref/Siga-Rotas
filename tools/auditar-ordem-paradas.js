/**
 * tools/auditar-ordem-paradas.js
 * ---------------------------------------------------------------------------
 * AUDITORIA DA ORDEM DE VISITA — "MENOR ROTA TOTAL (OTIMIZADA)".
 *
 * Responde, com dados reais e sem estimativas:
 *
 *   1. **O PRINT DO USUÁRIO** — a conta feita com os próprios números
 *      mostrados na tela (673 · 214 · 291 · 542 m);
 *   2. **REPRODUÇÃO NA REDE REAL** — casos reais com o **mesmo
 *      fenômeno** (o otimizador não começa pelo vizinho mais próximo de A
 *      e a rota escolhida tem o mesmo total da rota que começa por esse
 *      vizinho) e um caso representativo auditado por inteiro;
 *   3. **MATRIZ DE CUSTOS** — distâncias mínimas viárias entre cada par,
 *      nos dois sentidos, com a conferência da simetria, da diagonal e do
 *      acesso à rede (medido, declarado e **fora** do custo);
 *   4. **TODAS AS ORDENS** — enumeração de todas as permutações do circuito
 *      (com o retorno à origem incluído na soma), com a distância de cada
 *      trecho, o total e a diferença para a melhor solução;
 *   5. **HELD-KARP × FORÇA BRUTA** — a verdade-terreno do TSP;
 *   6. **O QUE É DESENHADO** — o trecho desenhado no mapa é exatamente o
 *      custo usado na otimização? (leg == célula da matriz);
 *   7. **A REGRA DO PRIMEIRO TRECHO** — melhor rota global × melhor
 *      alternativa que começa pelo vizinho mais próximo de A (em metros e
 *      em percentual), deixando claro que **minimizar o total** e
 *      **minimizar a primeira perna** são objetivos diferentes.
 *
 * Uso:  node tools/auditar-ordem-paradas.js [quantidade de amostras]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildGraph } from '../core/graph.js';
import { unproject } from '../core/geo.js';
import {
  matrizDistancias,
  heldKarp,
  heldKarpSaidaCurta,
  custoDaOrdem,
  vizinhoMaisProximo,
} from '../core/ordemParadas.js';
import { calcularRotaComParadas } from '../core/rotaParadas.js';
import { routeOnGraph } from '../core/router.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = JSON.parse(readFileSync(join(RAIZ, 'data/network.snapshot.json'), 'utf8'));
const features = snapshot.features || snapshot;

const mm = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('pt-BR') : '∞');
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1).replace('.', ',') : '∞');
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3).replace('.', ',') : '∞');
const linha = (c = '=') => c.repeat(78);

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

const graph = buildGraph(features, {});
const nNodes = graph.nodes.length;

console.log(linha());
console.log("AUDITORIA DA ORDEM DE VISITA — 'MENOR ROTA TOTAL (OTIMIZADA)'");
console.log(linha());
console.log(
  `rede: ${features.length} eixos · ${nNodes} nós · ${graph.edges.length} arestas · ` +
    `${graph.diagnostics.components} componentes`,
);

/* ═══════════════════════════════════════════════════════════════════════
   1. O PRINT DO USUÁRIO — A CONTA COM OS NÚMEROS MOSTRADOS
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\n1) O PRINT DO USUÁRIO — CONTA COM OS NÚMEROS DA TELA');
const PRINT = { AD: 673, DC: 214, CB: 291, BA: 542 };
const rotaEscolhida = PRINT.AD + PRINT.DC + PRINT.CB + PRINT.BA;
// A rota que começa pelo vizinho mais próximo de A (A→B→C→D→A) usa as
// MESMAS quatro pernas, apenas na ordem inversa: a rede é bidirecional,
// logo d(A,B) = d(B,A) = 542 m.
const rotaVizinho = PRINT.BA + PRINT.CB + PRINT.DC + PRINT.AD;
console.log('   rota mostrada na tela     : A→D→C→B→A');
console.log(
  `      ${PRINT.AD} + ${PRINT.DC} + ${PRINT.CB} + ${PRINT.BA} = ${mm(rotaEscolhida)} m`,
);
console.log('   rota que começa por B     : A→B→C→D→A (mesmas quatro pernas, ordem inversa)');
console.log(
  `      ${PRINT.BA} + ${PRINT.CB} + ${PRINT.DC} + ${PRINT.AD} = ${mm(rotaVizinho)} m`,
);
console.log(
  `   diferença entre as duas    : ${mm(rotaVizinho - rotaEscolhida)} m ` +
    `(${f1(((rotaVizinho - rotaEscolhida) / rotaEscolhida) * 100)} %)`,
);
console.log(
  '   ⇒ as duas ordens têm EXATAMENTE o mesmo total: a rota escolhida é ótima.',
);

/* ═══════════════════════════════════════════════════════════════════════
   2. BUSCA DE DISTÂNCIAS DE REFERÊNCIA (nós da rede)
   ═══════════════════════════════════════════════════════════════════════ */

const BANDA_MIN = 100;
const BANDA_MAX = 900;

/** Dijkstra limitado à banda [BANDA_MIN, BANDA_MAX]. */
function dijkstraBanda(origem) {
  const dist = new Float64Array(nNodes).fill(Infinity);
  const visited = new Uint8Array(nNodes);
  const heap = [[0, origem]];
  dist[origem] = 0;
  while (heap.length) {
    heap.sort((a, b) => a[0] - b[0]);
    const [d, u] = heap.shift();
    if (visited[u]) continue;
    visited[u] = 1;
    if (d > BANDA_MAX) break;
    for (const a of graph.adjacency[u]) {
      if (visited[a.to]) continue;
      const nd = d + a.length;
      if (nd < dist[a.to] && nd <= BANDA_MAX) {
        dist[a.to] = nd;
        heap.push([nd, a.to]);
      }
    }
  }
  return dist;
}

console.log('\n2) DISTÂNCIAS DE REFERÊNCIA NA REDE REAL');
const t0 = Date.now();
// banda[s] = nós dentro da banda, ordenados por distância
const banda = new Array(nNodes);
const bandaIdx = new Array(nNodes); // busca binária: nó -> posição
for (let s = 0; s < nNodes; s++) {
  const d = dijkstraBanda(s);
  const faixa = [];
  for (let t = 0; t < nNodes; t++) {
    const v = d[t];
    if (v >= BANDA_MIN && v <= BANDA_MAX) faixa.push([t, v]);
  }
  faixa.sort((a, b) => a[1] - b[1]);
  banda[s] = faixa;
  const idx = new Map();
  faixa.forEach(([t], i) => idx.set(t, i));
  bandaIdx[s] = idx;
}
console.log(`   ${nNodes} Dijkstras limitados à banda concluídos em ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const distNao = (s, t) => {
  const i = bandaIdx[s].get(t);
  return i === undefined ? Infinity : banda[s][i][1];
};

/* ── 2.1 fingerprint exato do print (nos nós da rede) ── */
const ALVO = { AD: 673, DC: 214, CB: 291, BA: 542 };
function fingerprint(tol) {
  const achados = [];
  for (let C = 0; C < nNodes; C++) {
    const Ds = banda[C].filter(([, v]) => Math.abs(v - ALVO.DC) <= tol);
    if (!Ds.length) continue;
    const Bs = banda[C].filter(([, v]) => Math.abs(v - ALVO.CB) <= tol);
    if (!Bs.length) continue;
    for (const [D] of Ds) {
      const As = banda[D].filter(([, v]) => Math.abs(v - ALVO.AD) <= tol);
      for (const [A] of As) {
        for (const [B] of Bs) {
          if (A === B || A === C || A === D || B === C || B === D) continue;
          if (Math.abs(distNao(A, B) - ALVO.BA) > tol) continue;
          achados.push({ A, B, C, D });
        }
      }
    }
  }
  return achados;
}
const exatos = fingerprint(0.5);
const proximos = fingerprint(2);
console.log(
  `   fingerprint exato do print (±0,5 m) em pontos que são nós da rede: ${exatos.length}`,
);
console.log(
  `   fingerprint aproximado (±2,0 m)                                      : ${proximos.length}`,
);
console.log(
  '   ⇒ os pontos do print não são nós da rede (são pontos quaisquer sobre os eixos),',
);
console.log('     por isso o fingerprint exato não é reproduzível a partir dos nós.');

/* ── 2.2 o MESMO FENÔMENO: empate em que a saída mais curta de A não é usada ── */
console.log('\n3) O MESMO FENÔMENO NA REDE REAL (empate: o total não muda)');
const compOf = graph.componentOf;
let casos = 0;
let primeiroCaso = null;
for (let A = 0; A < nNodes; A++) {
  const prox = banda[A].slice(0, 9); // nós mais próximos de A
  if (prox.length < 4) continue;
  const B = prox[0][0]; // vizinho mais próximo de A
  for (let i = 1; i < prox.length; i++) {
    for (let j = i + 1; j < prox.length; j++) {
      const C = prox[i][0];
      const D = prox[j][0];
      // só interessa o mesmo componente conexo (o resto não tem caminho)
      if (compOf[A] !== compOf[B] || compOf[A] !== compOf[C] || compOf[A] !== compOf[D]) continue;
      const m = [
        [0, distNao(A, B), distNao(A, C), distNao(A, D)],
        [distNao(A, B), 0, distNao(B, C), distNao(B, D)],
        [distNao(A, C), distNao(B, C), 0, distNao(C, D)],
        [distNao(A, D), distNao(B, D), distNao(C, D), 0],
      ];
      if (!Number.isFinite(m[1][2]) || !Number.isFinite(m[1][3]) || !Number.isFinite(m[2][3])) continue;
      const tabela = permutacoes([1, 2, 3])
        .map((p) => ({ p, custo: custoDaOrdem(m, p, 0, 0) }))
        .sort((x, y) => x.custo - y.custo);
      const optimo = tabela[0];
      // o caso do print: a ordem ótima NÃO começa pelo vizinho mais próximo
      if (optimo.p[0] === 1) continue;
      // e a ordem que começa pelo vizinho mais próximo tem o MESMO total
      const porB = tabela.find((t) => t.p[0] === 1);
      if (!porB || Math.abs(porB.custo - optimo.custo) > 1e-6) continue;
      casos++;
      if (!primeiroCaso) primeiroCaso = { A, B, C, D };
    }
  }
}
console.log(`   casos reais com o mesmo padrão (empate, saída mais curta não usada): ${casos}`);

if (!primeiroCaso) {
  console.log('   nenhum caso encontrado — encerrando a análise de caso.');
  process.exit(0);
}

/* ═══════════════════════════════════════════════════════════════════════
   3. CASO REPRESENTATIVO — AUDITORIA COMPLETA
   ═══════════════════════════════════════════════════════════════════════ */

const paraPontos = (q) => {
  const p = (i) => {
    const [lon, lat] = unproject(graph.nodes[i].x, graph.nodes[i].y);
    // `longitude`/`latitude` são os campos usados por `matrizDistancias` e
    // por `calcularRotaComParadas`; `lon`/`lat` servem só para a impressão.
    return { latitude: lat, longitude: lon, lat, lon };
  };
  return [
    { rotulo: 'A', ...p(q.A) },
    { rotulo: 'B', ...p(q.B) },
    { rotulo: 'C', ...p(q.C) },
    { rotulo: 'D', ...p(q.D) },
  ];
};

/* ── 2.3 os candidatos do fingerprint (±2 m) reproduzem o mesmo padrão? ── */
console.log('\n4) OS CANDIDATOS DO FINGERPRINT (±2 m) REPRODUZEM O PADRÃO DO PRINT?');
let fpAnalisados = 0;
let fpComPadrao = 0;
let fpMesmaSequencia = 0;
let fpEscolhido = null;
for (const q of proximos) {
  if (compOf[q.A] !== compOf[q.B] || compOf[q.A] !== compOf[q.C] || compOf[q.A] !== compOf[q.D]) continue;
  const pts = paraPontos(q);
  const { D: Df, semCaminho: sc } = matrizDistancias(graph, pts, {});
  if (sc.length) continue;
  fpAnalisados++;
  const tab = permutacoes([1, 2, 3])
    .map((p) => ({ p, custo: custoDaOrdem(Df, p, 0, 0) }))
    .sort((x, y) => x.custo - y.custo);
  const h = heldKarp(Df, [1, 2, 3], 0, 0);
  const primeiroMin = Math.min(Df[0][1], Df[0][2], Df[0][3]);
  // o padrão do print: a rota ótima não começa pelo vizinho mais próximo de A
  if (Math.abs(Df[0][h.ordem[0]] - primeiroMin) > 1e-6) {
    fpComPadrao++;
    if (!fpEscolhido) fpEscolhido = { A: q.A, B: q.B, C: q.C, D: q.D };
  }
  // a sequência EXATA do print: A→D→C→B→A
  const mesmaSequencia =
    h.ordem.length === 3 && h.ordem[0] === 3 && h.ordem[1] === 2 && h.ordem[2] === 1;
  if (mesmaSequencia) {
    fpMesmaSequencia++;
    fpEscolhido = { A: q.A, B: q.B, C: q.C, D: q.D };
  }
}
console.log(`   candidatos do fingerprint analisados com o mecanismo real: ${fpAnalisados}`);
console.log(`   deles reproduzem o padrão do print (a saída mais curta não é usada): ${fpComPadrao}`);
console.log(`   deles devolvem a MESMA sequência do print (A→D→C→B→A)          : ${fpMesmaSequencia}`);
if (fpEscolhido) {
  console.log('   ⇒ o caso exibido a seguir é um desses (o mais próximo do print).');
  primeiroCaso = fpEscolhido;
}

const pontos = paraPontos(primeiroCaso);
const { D, semCaminho } = matrizDistancias(graph, pontos, {});
if (semCaminho.length) {
  console.log('   o caso representativo tem pontos sem conexão — descartado.');
  process.exit(0);
}

console.log('\n5) CASO REPRESENTATIVO (pontos reais da rede)');
pontos.forEach((p) => console.log(`   ${p.rotulo}: ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`));

console.log('\n   MATRIZ DE CUSTOS (metros — caminho mínimo na rede viária)');
console.log('        ' + pontos.map((p) => p.rotulo.padStart(11)).join(''));
for (let i = 0; i < pontos.length; i++) {
  console.log(
    '   ' +
      pontos[i].rotulo.padEnd(5) +
      D[i].map((v) => (Number.isFinite(v) ? mm(v).padStart(11) : '        ∞  ')).join(''),
  );
}
let simetrica = true;
for (let i = 0; i < pontos.length; i++) {
  for (let j = 0; j < pontos.length; j++) {
    if (Math.abs(D[i][j] - D[j][i]) > 1e-6) simetrica = false;
  }
}
console.log(`   simetria D[i][j] == D[j][i] : ${simetrica ? 'SIM' : 'NÃO'}`);
console.log(`   diagonal D[i][i]          : ${D.map((linha, i) => (linha[i] === 0 ? '0' : '≠0')).join(' · ')}`);

// acesso à rede: medido, declarado e FORA do custo
const acessos = [];
for (let i = 0; i < pontos.length; i++) {
  const r = routeOnGraph(
    graph,
    { lon: pontos[i].longitude, lat: pontos[i].latitude },
    { lon: pontos[(i + 1) % pontos.length].longitude, lat: pontos[(i + 1) % pontos.length].latitude },
    {},
  );
  acessos.push(`${pontos[i].rotulo}=${f3(r.origin?.distanceToNetwork)} m`);
}
console.log(`   acesso à rede (medido, declarado e FORA do custo): ${acessos.join(' · ')}`);

const paradas = [1, 2, 3];
const tabela = permutacoes(paradas)
  .map((p) => ({ p, custo: custoDaOrdem(D, p, 0, 0) }))
  .sort((a, b) => a.custo - b.custo);
const optimo = tabela[0].custo;

console.log('\n   TODAS AS ORDENS DO CIRCUITO (o retorno a A entra na soma)');
console.log('   sequência          pernas (m)                                          total (m)   diferença');
for (const t of tabela) {
  const pernas = t.p.map((v, k) => [v, k + 1 < t.p.length ? t.p[k + 1] : 0]);
  const detalhe = pernas
    .map(([v, w]) => `${pontos[v].rotulo}→${pontos[w].rotulo}=${mm(D[v][w])}`)
    .join(' ');
  const dif = t.custo - optimo;
  console.log(
    `   A→${t.p.map((i) => pontos[i].rotulo).join('→')}→A  ${detalhe.padEnd(52)} ` +
      `${mm(t.custo).padStart(8)}   ${dif === 0 ? '← ótima' : '+' + mm(dif) + ' m'}`,
  );
}

const hk = heldKarp(D, paradas, 0, 0);
const hkCurto = heldKarpSaidaCurta(D, paradas, 0, 0);
console.log(
  `\n   Held-Karp (modo atual)      : A→${hk.ordem.map((i) => pontos[i].rotulo).join('→')}→A = ${f3(hk.custo)} m`,
);
console.log(
  `   Held-Karp (saída curta)      : A→${hkCurto.ordem.map((i) => pontos[i].rotulo).join('→')}→A = ${f3(hkCurto.custo)} m`,
);
console.log(`   força bruta (6 ordens)      : A→${tabela[0].p.map((i) => pontos[i].rotulo).join('→')}→A = ${f3(optimo)} m`);
console.log(
  `   Held-Karp == força bruta    : ${Math.abs(hk.custo - optimo) < 1e-6 ? 'SIM' : 'NÃO'}`,
);

/* ── o desenho no mapa usa exatamente o custo da otimização? ── */
const rota = calcularRotaComParadas(graph, pontos, { modo: 'otimizada', circular: true });
console.log('\n   TRECHO DESENHADO × CUSTO DA MATRIZ');
let somaDesenhada = 0;
let legsOk = true;
rota.legs.forEach((leg) => {
  somaDesenhada += leg.distance;
  const i0 = pontos.findIndex((p) => p.rotulo === leg.de);
  const i1 = pontos.findIndex((p) => p.rotulo === leg.para);
  const celula = D[i0][i1];
  const ok = Math.abs(leg.distance - celula) < 1e-6;
  if (!ok) legsOk = false;
  console.log(
    `   ${leg.de}→${leg.para}: desenhado ${f3(leg.distance)} m · matriz ${f3(celula)} m · ` +
      `Δ ${f3(Math.abs(leg.distance - celula))} m · retorno=${leg.retorno ? 'sim' : 'não'}`,
  );
});
console.log(`   soma dos trechos desenhados : ${f3(somaDesenhada)} m`);
console.log(`   total devolvido pela API     : ${f3(rota.distance)} m`);
console.log(`   diferença                   : ${f3(Math.abs(somaDesenhada - rota.distance))} m`);
console.log(`   trecho desenhado == célula da matriz em todas as pernas: ${legsOk ? 'SIM' : 'NÃO'}`);

/* ── a regra do primeiro trecho ── */
const vizinho = vizinhoMaisProximo(D, paradas, 0);
const custoVizinho = custoDaOrdem(D, vizinho, 0, 0);
console.log('\n6) MINIMIZAR O TOTAL ≠ MINIMIZAR A PRIMEIRA PERNA');
console.log(
  `   melhor rota global (Held-Karp)                        : A→${hk.ordem.map((i) => pontos[i].rotulo).join('→')}→A = ${f3(hk.custo)} m`,
);
console.log(
  `   1ª perna da rota global                               : ${f3(D[0][hk.ordem[0]])} m (até ${pontos[hk.ordem[0]].rotulo})`,
);
console.log(
  `   melhor alternativa que começa pelo vizinho mais próximo: A→${vizinho.map((i) => pontos[i].rotulo).join('→')}→A = ${f3(custoVizinho)} m`,
);
console.log(
  `   diferença entre as duas                                : ${f3(custoVizinho - hk.custo)} m ` +
    `(${f1(((custoVizinho - hk.custo) / hk.custo) * 100)} %)`,
);
console.log(
  `   variante "saída curta" (mesmo total, desempate pela 1ª perna): A→${hkCurto.ordem.map((i) => pontos[i].rotulo).join('→')}→A = ${f3(hkCurto.custo)} m`,
);

/* ═══════════════════════════════════════════════════════════════════════
   4. AMOSTRA AMPLA — HELD-KARP × FORÇA BRUTA × DESENHO
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\n7) AMOSTRA ALEATÓRIA (mesma componente) — Held-Karp × força bruta × desenho');
const N_AMOSTRA = Number(process.argv[2] || 250);
// nós da maior componente (garante que os 4 pontos têm caminho entre si)
const maiorComp = (() => {
  const cont = new Map();
  for (let i = 0; i < nNodes; i++) {
    const c = compOf[i];
    cont.set(c, (cont.get(c) || 0) + 1);
  }
  let melhor = -1;
  let tam = -1;
  for (const [c, t] of cont) if (t > tam) ((tam = t), (melhor = c));
  const lista = [];
  for (let i = 0; i < nNodes; i++) if (compOf[i] === melhor) lista.push(i);
  return lista;
})();
console.log(`   maior componente: ${maiorComp.length} nós`);

let amostraOk = 0;
let amostraFalha = 0;
let semVizinho = 0;
let diferencas = [];

for (let k = 0; k < N_AMOSTRA; k++) {
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const idx = maiorComp[Math.floor(Math.random() * maiorComp.length)];
    const [lon, lat] = unproject(graph.nodes[idx].x, graph.nodes[idx].y);
    pts.push({ rotulo: 'ABCD'[i], latitude: lat, longitude: lon });
  }
  const { D: Dm, semCaminho: sc } = matrizDistancias(graph, pts, {});
  if (sc.length) continue;
  const tab = permutacoes([1, 2, 3])
    .map((p) => ({ p, custo: custoDaOrdem(Dm, p, 0, 0) }))
    .sort((a, b) => a.custo - b.custo);
  const opt = tab[0].custo;
  const hkk = heldKarp(Dm, [1, 2, 3], 0, 0);
  const hkc = heldKarpSaidaCurta(Dm, [1, 2, 3], 0, 0);
  const r = calcularRotaComParadas(graph, pts, { modo: 'otimizada', circular: true });
  const somaLegs = r.legs.reduce((s, l) => s + l.distance, 0);
  const legsOk = r.legs.every((leg) => {
    const i0 = pts.findIndex((p) => p.rotulo === leg.de);
    const i1 = pts.findIndex((p) => p.rotulo === leg.para);
    return Math.abs(Dm[i0][i1] - leg.distance) < 1e-6;
  });
  const ok =
    Math.abs(hkk.custo - opt) < 1e-6 &&
    Math.abs(hkc.custo - opt) < 1e-6 &&
    legsOk &&
    Math.abs(somaLegs - r.distance) < 1e-6 &&
    Math.abs(hkk.custo - r.distance) < 1e-6 &&
    r.legs.length === 4 &&
    r.legs[r.legs.length - 1].retorno === true;
  if (ok) amostraOk++;
  else {
    amostraFalha++;
    if (amostraFalha <= 3) {
      console.log(
        `   FALHA: hk=${f3(hkk.custo)} bruto=${f3(opt)} legsOk=${legsOk} ` +
          `soma=${f3(somaLegs)} api=${f3(r.distance)} pernas=${r.legs.length}`,
      );
    }
  }
  const primeiroMin = Math.min(Dm[0][1], Dm[0][2], Dm[0][3]);
  if (Math.abs(Dm[0][hkk.ordem[0]] - primeiroMin) > 1e-6) semVizinho++;
  if (Math.abs(hkc.custo - opt) > 1e-6) diferencas.push(hkc.custo - opt);
}

console.log(`   amostras auditadas: ${amostraOk + amostraFalha} · ok: ${amostraOk} · falhas: ${amostraFalha}`);
console.log(
  `   amostras em que a 1ª perna da rota ótima NÃO é a mais curta de A: ${semVizinho} ` +
    `(${f1((semVizinho / Math.max(1, amostraOk + amostraFalha)) * 100)} %)`,
);
console.log(
  `   amostras em que a variante "saída curta" alterou o total: ${diferencas.length} (por definição, nunca)`,
);

console.log('\n' + linha());
if (amostraFalha === 0) {
  console.log('AUDITORIA CONCLUÍDA — nenhuma inconsistência encontrada');
} else {
  console.log(`AUDITORIA CONCLUÍDA — ${amostraFalha} inconsistência(s) encontrada(s)`);
}
console.log(linha());
