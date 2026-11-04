/**
 * FERRAMENTA: auditoria de fidelidade geométrica das rotas
 * ========================================================
 *
 *   node tools/audit-fidelity.js [N]
 *
 * Responde a uma pergunta objetiva: **a rota calculada acompanha de fato o
 * desenho dos eixos viários?**
 *
 * Para cada rota calculada, mede-se a distância de CADA vértice da geometria
 * devolvida até o eixo original mais próximo. Se a rota segue fielmente a
 * malha, essa distância é ~0 (só o conector de junção, de no máximo 1 m,
 * aparece). Se a rota "corta curvas", a distância cresce e o desvio máximo
 * mostra onde.
 *
 * Também confere:
 *   • a geometria devolvida é exatamente a concatenação das geometrias das
 *     arestas percorridas (invertendo as percorridas ao contrário);
 *   • a distância devolvida é a soma dos comprimentos das arestas;
 *   • a continuidade entre o fim de um trecho e o início do seguinte.
 *
 * Saída: estatísticas de desvio (média, máximo, p95) e os piores casos.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGraph } from '../core/graph.js';
import { routeOnGraph } from '../core/router.js';
import { project, unproject, dist, haversine } from '../core/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SNAP = path.join(ROOT, 'data', 'network.snapshot.json');
const AMOSTRAS = Number(process.argv[2] || 200);

if (!existsSync(SNAP)) {
  console.error('Snapshot ausente. Execute "npm run fetch" antes.');
  process.exit(1);
}

const dados = JSON.parse(readFileSync(SNAP, 'utf8'));
const features = dados.features;
console.log(`\n  Auditoria de fidelidade — ${features.length} eixos, ${AMOSTRAS} rotas\n`);

const graph = buildGraph(features, {});
const arestasConector = graph.edges.filter((e) => e.connector).length;
console.log(
  `  grafo: ${graph.nodes.length} nós, ${graph.edges.length} arestas ` +
    `(${arestasConector} arestas de conector; ${graph.diagnostics.connectors} lacunas candidatas)\n`
);

/* ------------------------------------------------------------------ */
/* Índice de busca sobre as arestas do grafo (para medir o desvio)     */
/* ------------------------------------------------------------------ */

// indexa os segmentos de cada aresta em uma grade uniforme simples
const CELL = 25; // metros
const buckets = new Map();
const key = (ix, iy) => `${ix},${iy}`;

for (const e of graph.edges) {
  if (e.connector) continue; // conectores são medidos à parte
  const c = e.coords;
  for (let i = 0; i < c.length - 1; i++) {
    const [ax, ay] = c[i];
    const [bx, by] = c[i + 1];
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iy = Math.floor(minY / CELL); iy <= Math.floor(maxY / CELL); iy++) {
        const k = key(ix, iy);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push([ax, ay, bx, by]);
      }
    }
  }
}

/** Distância de um ponto (métrico) até o segmento mais próximo da malha. */
function desvioDaMalha(x, y) {
  let best = Infinity;
  const ix = Math.floor(x / CELL);
  const iy = Math.floor(y / CELL);
  const raio = 3; // ~75 m: suficiente para desvios grandes
  for (let dx = -raio; dx <= raio; dx++) {
    for (let dy = -raio; dy <= raio; dy++) {
      const arr = buckets.get(key(ix + dx, iy + dy));
      if (!arr) continue;
      for (const [ax, ay, bx, by] of arr) {
        const vx = bx - ax;
        const vy = by - ay;
        const wx = x - ax;
        const wy = y - ay;
        const vv = vx * vx + vy * vy;
        let t = vv > 0 ? (wx * vx + wy * vy) / vv : 0;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const px = ax + vx * t;
        const py = ay + vy * t;
        const d = Math.hypot(x - px, y - py);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

// índice da rede COMPLETA (inclui os conectores de junção): serve para
// provar que a rota acompanha exatamente o que está desenhado.
const bucketsCheios = new Map();
for (const e of graph.edges) {
  const c = e.coords;
  for (let i = 0; i < c.length - 1; i++) {
    const [ax, ay] = c[i];
    const [bx, by] = c[i + 1];
    for (let ix = Math.floor(Math.min(ax, bx) / CELL); ix <= Math.floor(Math.max(ax, bx) / CELL); ix++) {
      for (let iy = Math.floor(Math.min(ay, by) / CELL); iy <= Math.floor(Math.max(ay, by) / CELL); iy++) {
        const k = key(ix, iy);
        if (!bucketsCheios.has(k)) bucketsCheios.set(k, []);
        bucketsCheios.get(k).push([ax, ay, bx, by]);
      }
    }
  }
}

/** Distância de um ponto até a rede completa (com conectores). */
function desvioDaRedeCompleta(x, y) {
  let best = Infinity;
  const ix = Math.floor(x / CELL);
  const iy = Math.floor(y / CELL);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const arr = bucketsCheios.get(key(ix + dx, iy + dy));
      if (!arr) continue;
      for (const [ax, ay, bx, by] of arr) {
        const vx = bx - ax;
        const vy = by - ay;
        const wx = x - ax;
        const wy = y - ay;
        const vv = vx * vx + vy * vy;
        let t = vv > 0 ? (wx * vx + wy * vy) / vv : 0;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const d = Math.hypot(x - (ax + vx * t), y - (ay + vy * t));
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Amostragem e verificação                                             */
/* ------------------------------------------------------------------ */

// ARESTAS da maior componente: os pontos de origem/destino são sorteados
// NO MEIO das arestas (e não em nós), porque é isso que exercita a divisão
// temporária da aresta pela origem e pelo destino — o ponto em que a
// geometria pode se perder.
const comp = graph.componentOf || [];
// `largestComponent` é o TAMANHO da maior componente; o identificador
// precisa serRecoverido contando os nós de cada componente.
const tamPorComp = new Map();
for (const c of comp) tamPorComp.set(c, (tamPorComp.get(c) || 0) + 1);
let maiorId = -1;
let maiorTam = -1;
for (const [id, tam] of tamPorComp) {
  if (tam > maiorTam) {
    maiorTam = tam;
    maiorId = id;
  }
}
const arestasCandidatas = [];
for (const e of graph.edges) {
  if (e.connector) continue;
  if (comp.length && comp[e.from] !== maiorId) continue;
  if (e.coords.length < 2) continue;
  arestasCandidatas.push(e);
}
console.log(`  maior componente: ${maiorTam} nós (id ${maiorId}) — ${arestasCandidatas.length} arestas\n`);

/** Ponto em uma posição (0..1) ao longo de uma aresta, em lon/lat. */
function pontoNaAresta(edge, frac) {
  const c = edge.coords;
  const alvo = edge.length * frac;
  let acc = 0;
  for (let i = 1; i < c.length; i++) {
    const d = dist(c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]);
    if (acc + d >= alvo) {
      const t = d > 0 ? (alvo - acc) / d : 0;
      const x = c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t;
      const y = c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
      const [lon, lat] = unproject(x, y);
      return { lon, lat };
    }
    acc += d;
  }
  const last = c[c.length - 1];
  const [lon, lat] = unproject(last[0], last[1]);
  return { lon, lat };
}

// gerador determinístico
let semente = 12345;
const rnd = () => {
  semente = (semente * 1103515245 + 12345) & 0x7fffffff;
  return semente / 0x7fffffff;
};

const desvios = [];
const desviosMedios = [];
const desviosRede = [];
let rotasComConector = 0;
let conectoresUsados = 0;
let rotaMaisConector = 0;
let somaOk = 0;
let somaRuim = 0;
let geometriaRuim = 0;
const piores = [];

for (let n = 0; n < AMOSTRAS; n++) {
  const ea = arestasCandidatas[Math.floor(rnd() * arestasCandidatas.length)];
  const eb = arestasCandidatas[Math.floor(rnd() * arestasCandidatas.length)];
  if (!ea || !eb || ea.id === eb.id) continue;

  // pontos no interior das arestas (forçam a divisão temporária)
  const origem = pontoNaAresta(ea, 0.3 + rnd() * 0.4);
  const destino = pontoNaAresta(eb, 0.3 + rnd() * 0.4);

  const r = routeOnGraph(graph, origem, destino, {});
  if (!r.ok) continue;

  // 1) desvio da LINHA da rota até a malha original.
  //    Amostra-se a cada ~2 m ao longo da geometria (e não só nos vértices):
  //    uma "corta-curva" é uma reta entre dois pontos que ESTÃO sobre o eixo —
  //    o desvio está no meio do segmento, invisível na análise por vértice.
  let max = 0;
  let soma = 0;
  let conta = 0;
  const gc = r.geometry.coordinates;
  for (let i = 1; i < gc.length; i++) {
    const [x1, y1] = project(gc[i - 1][0], gc[i - 1][1]);
    const [x2, y2] = project(gc[i][0], gc[i][1]);
    const trecho = dist(x1, y1, x2, y2);
    const passos = Math.max(2, Math.ceil(trecho / 2));
    for (let k = 0; k <= passos; k++) {
      const t = k / passos;
      const d = desvioDaMalha(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      soma += d;
      conta++;
      if (d > max) max = d;
    }
  }
  desvios.push(max);
  desviosMedios.push(soma / Math.max(conta, 1));

  // desvio em relação à rede COMPLETA (com os conectores de junção):
  // deve ser ~0 — a rota acompanha exatamente o desenho.
  let maxCheio = 0;
  for (let i = 1; i < gc.length; i++) {
    const [x1, y1] = project(gc[i - 1][0], gc[i - 1][1]);
    const [x2, y2] = project(gc[i][0], gc[i][1]);
    const passos = Math.max(2, Math.ceil(dist(x1, y1, x2, y2) / 2));
    for (let k = 0; k <= passos; k++) {
      const t = k / passos;
      const d = desvioDaRedeCompleta(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      if (d > maxCheio) maxCheio = d;
    }
  }
  desviosRede.push(maxCheio);

  // quanto da rota é feita por conectores de junção (lacunas de até 1 m)
  const emConector = r.legs.filter((l) => l.segments.some((sid) => graph.edges[sid]?.connector));
  const comprimentoConector = emConector.reduce((s, l) => s + l.length, 0);
  if (comprimentoConector > 0) {
    rotasComConector++;
    conectoresUsados += comprimentoConector;
    rotaMaisConector = Math.max(rotaMaisConector, comprimentoConector / r.distance);
  }

  // 2) soma dos trechos == distância devolvida
  const somaTrechos = r.legs.reduce((s, l) => s + l.length, 0);
  if (Math.abs(somaTrechos - r.distance) < 1e-6) somaOk++;
  else somaRuim++;

  // 3) a geometria devolvida contém TODOS os vértices das pernas, na ordem
  //    (é a concatenação das geometrias originais percorridas)
  const gc2 = r.geometry.coordinates;
  let cursor = 0;
  let perdeu = false;
  for (const perna of r.legs) {
    for (const p of perna.coords) {
      let achou = false;
      for (let k = cursor; k < gc2.length; k++) {
        const d = haversine(gc2[k][0], gc2[k][1], p[0], p[1]);
        if (d < 0.02) {
          cursor = k;
          achou = true;
          break;
        }
      }
      if (!achou) {
        perdeu = true;
        break;
      }
    }
    if (perdeu) break;
  }
  const verticesEsperados = r.legs.reduce((s2, l) => s2 + l.coords.length, 0);
  const verticesObtidos = gc2.length;
  if (perdeu) geometriaRuim++;

  piores.push({ max, medio: soma / Math.max(conta, 1), verticesObtidos, verticesEsperados, r });
}

desvios.sort((x, y) => x - y);
desviosMedios.sort((x, y) => x - y);
const p95 = desvios[Math.floor(desvios.length * 0.95)] ?? 0;
const maximo = desvios[desvios.length - 1] ?? 0;
const media = desvios.reduce((s, v) => s + v, 0) / Math.max(desvios.length, 1);

console.log('  DESVIO DA ROTA ATÉ A MALHA ORIGINAL (m)');
console.log('  ------------------------------------------------');
console.log(`  rotas analisadas            : ${desvios.length}`);
console.log(`  desvio máximo (pior rota)   : ${maximo.toFixed(2)} m`);
console.log(`  desvio p95                  : ${p95.toFixed(2)} m`);
console.log(`  desvio médio por rota       : ${media.toFixed(3)} m`);
console.log(`  desvio médio dos vértices   : ${(desviosMedios.reduce((s, v) => s + v, 0) / Math.max(desviosMedios.length, 1)).toFixed(3)} m`);
console.log(`  rotas com soma de trechos ok: ${somaOk}`);
console.log(`  rotas com soma ERRADA       : ${somaRuim}`);
console.log(`  rotas com geometria perdida : ${geometriaRuim}`);

desviosRede.sort((a, b) => a - b);
console.log('\n  DESVIO ATÉ A REDE COMPLETA (inclui os conectores de junção)');
console.log('  ------------------------------------------------');
console.log(`  desvio máximo               : ${(desviosRede[desviosRede.length - 1] ?? 0).toFixed(3)} m`);
console.log(`  desvio p95                  : ${(desviosRede[Math.floor(desviosRede.length * 0.95)] ?? 0).toFixed(3)} m`);
console.log(`  rotas que usam conector      : ${rotasComConector} de ${desvios.length}`);
console.log(`  parcela de rota em conector  : máx ${(rotaMaisConector * 100).toFixed(2)} % (lacunas reais de até 1 m)`);

console.log('\n  PIORES 5 CASOS');
console.log('  ------------------------------------------------');
piores
  .sort((x, y) => y.max - x.max)
  .slice(0, 5)
  .forEach((p, i) => {
    console.log(
      `  ${i + 1}. desvio máx ${p.max.toFixed(2)} m | médio ${p.medio.toFixed(2)} m | ` +
        `${p.verticesObtidos} vértices (concat. das pernas: ${p.verticesEsperados}) | ` +
        `${p.r.distance.toFixed(0)} m | pernas: ${p.r.legs.length}`
    );
  });
console.log('');
