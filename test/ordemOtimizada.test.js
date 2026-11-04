/**
 * TESTES — ORDEM OTIMIZADA: OBJETIVO, DESEMPATE E CONSISTÊNCIA
 * ======================================================================
 *
 * Contexto (rodada 14 — auditoria do modo "Menor rota total (otimizada)"):
 * o usuário viu na tela a ordem A→D→C→B→A com as pernas 673 · 214 ·
 * 291 · 542 m e achou que a rota deveria começar pelo vizinho mais
 * próximo de A (A→B). Estes testes provam, de forma automatizada:
 *
 *  A. SEMÂNTICA DO OBJETIVO E DO DESEMPATE (matrizes conhecidas)
 *     A1  o desempate pela saída curta **não altera o total** (o objetivo
 *         matemático continua sendo a soma mínima);
 *     A2  entre as ordens de mesmo total, escolhe a de primeira perna
 *         mais curta;
 *     A3  a reconstrução é válida (cada parada uma vez, origem no início
 *         e no fim);
 *     A4  matriz assimétrica: a primeira perna mais curta **não** garante
 *         o circuito mais curto (os dois objetivos são diferentes);
 *     A5  o desempate nunca piora o custo em relação ao Held-Karp usual.
 *
 *  B. CENÁRIO REAL (o caso do print, medido na rede do snapshot)
 *     B1  a matriz real é simétrica, com diagonal zero;
 *     B2  a ordem devolvida é A→D→C→B→A (a do print) com 1.720,385 m;
 *     B3  a ordem A→B→C→D→A tem **exatamente o mesmo total** (empate):
 *         a rota escolhida é ótima;
 *     B4  a melhor alternativa que começa pelo vizinho mais próximo de A
 *         custa 21,213 m a mais (1,2 %);
 *     B5  o modo "saída curta" devolve o mesmo total com a primeira perna
 *         mais curta;
 *     B6  o trecho desenhado é exatamente a célula da matriz custada e a
 *         soma das pernas == total (com o retorno à origem);
 *     B7  o modo "ordem do usuário" continua intacto;
 *     B8  o método usado é declarado na resposta;
 *     B9  a quantidade de paradas é dinâmica (5 paradas continuam ok).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  matrizDistancias,
  heldKarp,
  heldKarpSaidaCurta,
  custoDaOrdem,
  vizinhoMaisProximo,
  otimizarOrdem,
} from '../core/ordemParadas.js';
import { calcularRotaComParadas, MODOS_ORDEM } from '../core/rotaParadas.js';
import { buildGraph } from '../core/graph.js';
import { unproject } from '../core/geo.js';
import { loadRealFeatures } from './helpers.js';

/* ── utilidades ─────────────────────────────────────────────────────── */

function permutacoes(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const resto = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutacoes(resto)) out.push([arr[i], ...p]);
  }
  return out;
}

/** Matriz aleatória (simétrica ou não) com distâncias plausíveis. */
function matrizAleatoria(n, simetrica) {
  const D = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = 10 + Math.floor(Math.random() * 90);
      D[i][j] = v;
      D[j][i] = simetrica ? v : 10 + Math.floor(Math.random() * 90);
    }
  }
  return D;
}

/** Verifica se a ordem é um circuito válido (cada parada uma vez). */
function circuitoValido(ordem, totalIntermediarios) {
  if (ordem.length !== totalIntermediarios) return false;
  return new Set(ordem).size === totalIntermediarios;
}

/* ═══════════════════════════════════════════════════════════════════════
   A. SEMÂNTICA DO OBJETIVO E DO DESEMPATE
   ═══════════════════════════════════════════════════════════════════════ */

test('A1 — o desempate pela saída curta não altera o total (o objetivo é o mesmo)', () => {
  for (let t = 0; t < 300; t++) {
    const n = 5 + (t % 3); // 5..7 pontos ⇒ 4..6 intermediários
    const D = matrizAleatoria(n, t % 2 === 0);
    const indices = Array.from({ length: n - 1 }, (_, i) => i + 1);
    const normal = heldKarp(D, indices, 0, 0);
    const desempate = heldKarpSaidaCurta(D, indices, 0, 0);
    assert.ok(
      Math.abs(normal.custo - desempate.custo) < 1e-9,
      `custos diferentes: ${normal.custo} × ${desempate.custo}`,
    );
  }
});

test('A2 — no empate, o desempate escolhe a ordem de primeira perna mais curta', () => {
  // matriz simétrica: o circuito e o seu reverso têm sempre o mesmo total
  for (let t = 0; t < 200; t++) {
    const n = 5;
    const D = matrizAleatoria(n, true);
    const indices = [1, 2, 3, 4];
    const desempate = heldKarpSaidaCurta(D, indices, 0, 0);
    const normal = heldKarp(D, indices, 0, 0);

    // o total é o mínimo
    const minimo = Math.min(
      ...permutacoes(indices).map((p) => custoDaOrdem(D, p, 0, 0)),
    );
    assert.ok(Math.abs(desempate.custo - minimo) < 1e-9);

    // entre as ordens de total mínimo, a escolhida tem a 1ª perna mais curta
    const primeiraMinima = Math.min(
      ...permutacoes(indices)
        .filter((p) => Math.abs(custoDaOrdem(D, p, 0, 0) - minimo) < 1e-9)
        .map((p) => D[0][p[0]]),
    );
    assert.ok(
      Math.abs(D[0][desempate.ordem[0]] - primeiraMinima) < 1e-9,
      `esperado ${primeiraMinima}, obtido ${D[0][desempate.ordem[0]]}`,
    );
    // e o Held-Karp usual continua começando pelo vizinho mais próximo
    // quando não há empate (ambos podem diferir só no desempate)
    assert.ok(normal.custo >= desempate.custo - 1e-9);
  }
});

test('A3 — a reconstrução é válida: cada parada uma vez, origem no início e no fim', () => {
  for (let t = 0; t < 100; t++) {
    const n = 4 + (t % 3);
    const D = matrizAleatoria(n, t % 2 === 0);
    const indices = Array.from({ length: n - 1 }, (_, i) => i + 1);
    const desempate = heldKarpSaidaCurta(D, indices, 0, 0);
    assert.ok(circuitoValido(desempate.ordem, indices.length));
    assert.ok(desempate.ordem.every((i) => indices.includes(i)));
    // o custo devolvido é o custo da ordem reconstruída (com o retorno)
    assert.ok(Math.abs(custoDaOrdem(D, desempate.ordem, 0, 0) - desempate.custo) < 1e-9);
  }
});

test('A4 — a primeira perna mais curta NÃO garante o circuito mais curto', () => {
  const indices = [1, 2, 3];

  // (a) matriz assimétrica em que a perna mais curta de A **é** a ótima
  const D = [
    [0, 10, 30, 30],
    [90, 0, 60, 60],
    [50, 20, 0, 10],
    [40, 35, 5, 0],
  ];
  const normal = heldKarp(D, indices, 0, 0);
  const desempate = heldKarpSaidaCurta(D, indices, 0, 0);
  const vizinho = vizinhoMaisProximo(D, indices, 0);
  // A→B (10 m) + B→C (60) + C→D (10) + D→A (40) = 120
  assert.equal(normal.ordem[0], 1);
  assert.equal(desempate.ordem[0], 1);
  assert.ok(Math.abs(normal.custo - 120) < 1e-9, `custo = ${normal.custo}`);
  assert.equal(vizinho[0], 1);
  assert.ok(Math.abs(custoDaOrdem(D, vizinho, 0, 0) - normal.custo) < 1e-9);

  // (b) matriz assimétrica em que a perna mais curta de A (10 m, até B) dá
  //     um circuito PIOR: começar por C custa 40+10+5+80 = 135, enquanto
  //     começar por B custa 10+100+10+40 = 160 (+25 m)
  const D2 = [
    [0, 10, 40, 40],
    [80, 0, 100, 100],
    [40, 5, 0, 10],
    [40, 5, 10, 0],
  ];
  const normal2 = heldKarp(D2, indices, 0, 0);
  const vizinho2 = vizinhoMaisProximo(D2, indices, 0);
  assert.equal(vizinho2[0], 1, 'B é o vizinho mais próximo de A');
  assert.notEqual(normal2.ordem[0], 1, 'o ótimo NÃO começa pela perna mais curta');
  assert.ok(Math.abs(normal2.custo - 135) < 1e-9, `custo ótimo = ${normal2.custo}`);
  assert.ok(
    Math.abs(custoDaOrdem(D2, vizinho2, 0, 0) - 160) < 1e-9,
    'a ordem que começa pelo vizinho mais próximo custa 25 m a mais',
  );
  // o desempate também preserva o total: ele só desempata entre as ordens
  // de mesmo custo
  const desempate2 = heldKarpSaidaCurta(D2, indices, 0, 0);
  assert.ok(Math.abs(desempate2.custo - normal2.custo) < 1e-9);
});

test('A5 — o desempate nunca piora o custo em relação ao Held-Karp usual', () => {
  for (let t = 0; t < 200; t++) {
    const n = 5 + (t % 2);
    const D = matrizAleatoria(n, t % 3 === 0);
    const indices = Array.from({ length: n - 1 }, (_, i) => i + 1);
    const normal = heldKarp(D, indices, 0, 0);
    const desempate = heldKarpSaidaCurta(D, indices, 0, 0);
    assert.ok(desempate.custo <= normal.custo + 1e-9);
    assert.ok(Math.abs(desempate.custo - normal.custo) < 1e-9);
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   B. CENÁRIO REAL — O CASO DO PRINT
   ═══════════════════════════════════════════════════════════════════════ */

// Caso real medido na rede (mesmo fingerprint do print do usuário:
// A→D ≈ 673 m · D→C ≈ 214 m · C→B ≈ 291 m · B→A ≈ 542 m).
const CASO_PRINT = {
  A: { latitude: -23.654198499548553, longitude: -46.49536480000956 },
  B: { latitude: -23.650668369845917, longitude: -46.49391065097863 },
  C: { latitude: -23.649230239548583, longitude: -46.49405717000947 },
  D: { latitude: -23.650059399548574, longitude: -46.4930041000094 },
};

const grafoReal = buildGraph(loadRealFeatures(), {});
const pontosPrint = [
  { rotulo: 'A', ...CASO_PRINT.A },
  { rotulo: 'B', ...CASO_PRINT.B },
  { rotulo: 'C', ...CASO_PRINT.C },
  { rotulo: 'D', ...CASO_PRINT.D },
];
const matrizPrint = matrizDistancias(grafoReal, pontosPrint, {}).D;

test('B1 — a matriz real do caso do print é simétrica e tem diagonal zero', () => {
  assert.equal(matrizPrint.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(matrizPrint[i][i], 0);
    for (let j = 0; j < 4; j++) {
      assert.ok(
        Math.abs(matrizPrint[i][j] - matrizPrint[j][i]) < 1e-6,
        `assimetria em [${i}][${j}]`,
      );
    }
  }
  // os valores medidos (as pernas mostradas na tela)
  const m = matrizPrint;
  assert.ok(Math.abs(m[0][1] - 540.185) < 0.01, `A→B = ${m[0][1]}`);
  assert.ok(Math.abs(m[0][2] - 757.506) < 0.01, `A→C = ${m[0][2]}`);
  assert.ok(Math.abs(m[0][3] - 673.15) < 0.01, `A→D = ${m[0][3]}`);
  assert.ok(Math.abs(m[1][2] - 291.35) < 0.01, `B→C = ${m[1][2]}`);
  assert.ok(Math.abs(m[1][3] - 228.207) < 0.01, `B→D = ${m[1][3]}`);
  assert.ok(Math.abs(m[2][3] - 215.7) < 0.01, `C→D = ${m[2][3]}`);
});

test('B2 — a ordem devolvida no caso do print é A→D→C→B→A com 1.720,385 m', () => {
  const hk = heldKarp(matrizPrint, [1, 2, 3], 0, 0);
  assert.deepEqual(hk.ordem, [3, 2, 1]);
  assert.ok(Math.abs(hk.custo - 1720.3853688353229) < 0.01, `custo = ${hk.custo}`);
});

test('B3 — A→B→C→D→A tem exatamente o mesmo total: a rota escolhida é ótima', () => {
  const escolhida = custoDaOrdem(matrizPrint, [3, 2, 1], 0, 0);
  const comecandoPorB = custoDaOrdem(matrizPrint, [1, 2, 3], 0, 0);
  assert.ok(
    Math.abs(escolhida - comecandoPorB) < 1e-6,
    `${escolhida} × ${comecandoPorB}`,
  );
  // e nenhuma outra ordem é melhor
  const todas = permutacoes([1, 2, 3]).map((p) => custoDaOrdem(matrizPrint, p, 0, 0));
  const minimo = Math.min(...todas);
  assert.ok(Math.abs(minimo - escolhida) < 1e-6);
});

test('B4 — a alternativa que começa pelo vizinho mais próximo custa 21,213 m a mais', () => {
  const vizinho = vizinhoMaisProximo(matrizPrint, [1, 2, 3], 0);
  const custo = custoDaOrdem(matrizPrint, vizinho, 0, 0);
  const otimo = custoDaOrdem(matrizPrint, [3, 2, 1], 0, 0);
  const diferenca = custo - otimo;
  assert.ok(diferenca > 0, 'a alternativa não pode ser melhor que a ótima');
  assert.ok(Math.abs(diferenca - 21.213) < 0.01, `diferença = ${diferenca}`);
  const pct = (diferenca / otimo) * 100;
  assert.ok(Math.abs(pct - 1.2334) < 0.01, `percentual = ${pct}`);
});

test('B5 — o modo "saída curta" devolve o mesmo total com a primeira perna mais curta', () => {
  const rota = calcularRotaComParadas(grafoReal, pontosPrint, {
    modo: MODOS_ORDEM.SAIDA_CURTA,
    circular: true,
  });
  assert.ok(rota.ok, rota.message);
  const otimizada = calcularRotaComParadas(grafoReal, pontosPrint, {
    modo: MODOS_ORDEM.OTIMIZADA,
    circular: true,
  });
  // o total é exatamente o mesmo (o objetivo não mudou)
  assert.ok(Math.abs(rota.distance - otimizada.distance) < 1e-6);
  assert.ok(Math.abs(rota.distance - 1720.3853688353229) < 0.01);
  // a primeira perna é a mais curta possível a partir de A
  const maisCurta = Math.min(matrizPrint[0][1], matrizPrint[0][2], matrizPrint[0][3]);
  assert.ok(Math.abs(rota.legs[0].distance - maisCurta) < 1e-6);
  assert.equal(rota.legs[0].de, 'A');
  assert.equal(rota.legs[0].para, 'B');
  // e a sequência começa em A e termina em A (na sequência completa, que
  // inclui o fechamento)
  assert.equal(rota.sequencia[0], 'A');
  assert.equal(rota.sequenciaCompleta[rota.sequenciaCompleta.length - 1], 'A');
});

test('B6 — o trecho desenhado é a célula da matriz custada e a soma é o total', () => {
  const rota = calcularRotaComParadas(grafoReal, pontosPrint, {
    modo: MODOS_ORDEM.OTIMIZADA,
    circular: true,
  });
  assert.ok(rota.ok);
  assert.equal(rota.legs.length, 4, 'o circuito tem 4 pernas (incluindo o retorno)');
  let soma = 0;
  rota.legs.forEach((leg) => {
    soma += leg.distance;
    const i = pontosPrint.findIndex((p) => p.rotulo === leg.de);
    const j = pontosPrint.findIndex((p) => p.rotulo === leg.para);
    assert.ok(
      Math.abs(leg.distance - matrizPrint[i][j]) < 1e-6,
      `perna ${leg.de}→${leg.para}: ${leg.distance} × ${matrizPrint[i][j]}`,
    );
  });
  assert.ok(Math.abs(soma - rota.distance) < 1e-6);
  // a última perna é o retorno à origem
  assert.equal(rota.legs[rota.legs.length - 1].retorno, true);
  assert.equal(rota.legs[rota.legs.length - 1].para, 'A');
});

test('B7 — o modo "ordem do usuário" continua intacto (nada é reordenado)', () => {
  const rota = calcularRotaComParadas(grafoReal, pontosPrint, {
    modo: MODOS_ORDEM.USUARIO,
    circular: true,
  });
  assert.ok(rota.ok);
  assert.deepEqual(rota.sequencia, ['A', 'B', 'C', 'D']);
  assert.deepEqual(rota.sequenciaCompleta, ['A', 'B', 'C', 'D', 'A']);
  // o total do usuário é maior: 1.720 m contra 1.720 m do empate
  const hk = heldKarp(matrizPrint, [1, 2, 3], 0, 0);
  assert.ok(rota.distance >= hk.custo - 1e-6);
});

test('B8 — o método usado é declarado na resposta', () => {
  const exato = calcularRotaComParadas(grafoReal, pontosPrint, {
    modo: MODOS_ORDEM.OTIMIZADA,
    circular: true,
  });
  assert.equal(exato.otimizacao.metodo, 'exato');
  const desempate = calcularRotaComParadas(grafoReal, pontosPrint, {
    modo: MODOS_ORDEM.SAIDA_CURTA,
    circular: true,
  });
  assert.match(desempate.otimizacao.metodo, /^exato/);
  assert.match(desempate.otimizacao.metodo, /desempate/);
});

test('B9 — a quantidade de paradas é dinâmica (5 paradas continuam funcionando)', () => {
  const ponto = CASO_PRINT.A;
  const cinco = [
    { rotulo: 'A', ...ponto },
    { rotulo: 'B', ...CASO_PRINT.B },
    { rotulo: 'C', ...CASO_PRINT.C },
    { rotulo: 'D', ...CASO_PRINT.D },
    { rotulo: 'E', ...CASO_PRINT.A },
  ];
  const rota = calcularRotaComParadas(grafoReal, cinco, {
    modo: MODOS_ORDEM.SAIDA_CURTA,
    circular: true,
  });
  assert.ok(rota.ok, rota.message);
  assert.equal(rota.legs.length, 5);
  assert.equal(rota.sequencia[0], 'A');
  assert.equal(rota.sequenciaCompleta[rota.sequenciaCompleta.length - 1], 'A');
});

test('B10 — amostragem real: Held-Karp == força bruta e desenho == custado', () => {
  const grafo = grafoReal;
  const nos = grafo.nodes.length;
  const compOf = grafo.componentOf;
  // nós da maior componente (garante conectividade)
  const cont = new Map();
  for (let i = 0; i < nos; i++) cont.set(compOf[i], (cont.get(compOf[i]) || 0) + 1);
  let maior = -1;
  let tam = -1;
  for (const [c, t] of cont) if (t > tam) ((tam = t), (maior = c));
  const pool = [];
  for (let i = 0; i < nos; i++) if (compOf[i] === maior) pool.push(i);

  for (let k = 0; k < 40; k++) {
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const n = pool[Math.floor(Math.random() * pool.length)];
      const [lon, lat] = unproject(grafo.nodes[n].x, grafo.nodes[n].y);
      pts.push({ rotulo: 'ABCD'[i], latitude: lat, longitude: lon });
    }
    const { D, semCaminho } = matrizDistancias(grafo, pts, {});
    if (semCaminho.length) continue;
    const optimum = Math.min(
      ...permutacoes([1, 2, 3]).map((p) => custoDaOrdem(D, p, 0, 0)),
    );
    const hk = heldKarp(D, [1, 2, 3], 0, 0);
    const hkc = heldKarpSaidaCurta(D, [1, 2, 3], 0, 0);
    assert.ok(Math.abs(hk.custo - optimum) < 1e-6, 'Held-Karp ≠ força bruta');
    assert.ok(Math.abs(hkc.custo - optimum) < 1e-6, 'desempate alterou o total');

    const rota = calcularRotaComParadas(grafo, pts, {
      modo: MODOS_ORDEM.OTIMIZADA,
      circular: true,
    });
    assert.ok(rota.ok);
    assert.ok(Math.abs(rota.distance - optimum) < 1e-6, 'a API não devolveu o mínimo');
    const soma = rota.legs.reduce((s, l) => s + l.distance, 0);
    assert.ok(Math.abs(soma - rota.distance) < 1e-6);
    for (const leg of rota.legs) {
      const i = pts.findIndex((p) => p.rotulo === leg.de);
      const j = pts.findIndex((p) => p.rotulo === leg.para);
      assert.ok(Math.abs(leg.distance - D[i][j]) < 1e-6, 'perna ≠ célula da matriz');
    }
  }
});

test('B11 — otimizarOrdem aceita o desempate e declara o método', () => {
  const r1 = otimizarOrdem(grafoReal, pontosPrint, { circular: true });
  const r2 = otimizarOrdem(grafoReal, pontosPrint, {
    circular: true,
    desempateSaidaCurta: true,
  });
  assert.ok(r1.ok, r1.message);
  assert.ok(r2.ok, r2.message);
  assert.ok(Math.abs(r1.custo - r2.custo) < 1e-6, 'o desempate mudou o custo');
  assert.equal(r1.metodo, 'exato');
  assert.match(r2.metodo, /desempate/);
  // no caso do print, as duas ordens têm o mesmo total
  // (a ordem devolvida inclui a origem na primeira posição)
  assert.deepEqual(r1.ordem, [0, 3, 2, 1]); // A→D→C→B→A
  assert.deepEqual(r2.ordem, [0, 1, 2, 3]); // A→B→C→D→A
});
