/**
 * TESTES — AUDITORIA DA OTIMIZAÇÃO DA ORDEM DE VISITA
 * ======================================================================
 *
 * Objetivo: provar, de forma automatizada, que o modo "Menor rota total
 * (otimizada)" escolhe de fato a ordem de **menor custo total**, e que o
 * custo informado é o mesmo que o custo desenhado no mapa.
 *
 * O que é verificado:
 *
 *  A. Matriz de custos e Held-Karp (unidade, matrizes conhecidas)
 *     A1  `custoDaOrdem` — o custo de um caminho com origem e destino fixos
 *     A2  Held-Karp == força bruta (enumeração de TODAS as permutações)
 *     A3  o custo do circuito inclui o retorno à origem
 *     A4  o trecho inicial mais curto NÃO leva ao circuito mais curto
 *     A5  matriz assimétrica — o Held-Karp não depende da simetria
 *     A6  par sem caminho viável (Infinity) é evitado
 *     A7  reconstrução: o custo da ordem devolvida == o custo do Held-Karp
 *     A8  empate: numa matriz simétrica o reverso tem o MESMO custo
 *         (economia 0 m) — o sintoma relatado pelo usuário
 *
 *  B. Rede real (integração com o snapshot do GeoServer)
 *     B1  a matriz real é simétrica, tem diagonal zero e nenhum custo é
 *         menor que a linha reta (nenhum "teleporte")
 *     B2  Held-Karp == força bruta no caso real com empate
 *     B3  a ordem do usuário e a otimizada empatam (economia 0 m)
 *     B4  o trecho desenhado tem o mesmo custo da célula da matriz
 *     B5  soma dos trechos == distância total == custo do Held-Karp
 *     B6  a sequência começa e termina na origem e inclui o retorno
 *     B7  o modo "ordem do usuário" não altera a sequência informada
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  heldKarp,
  custoDaOrdem,
  matrizDistancias,
  otimizarOrdem,
} from '../core/ordemParadas.js';
import { calcularRotaComParadas } from '../core/rotaParadas.js';
import { buildGraph } from '../core/graph.js';
import { haversine } from '../core/geo.js';
import { loadRealFeatures } from './helpers.js';

/* ── utilidades de teste ───────────────────────────────────────────── */

/** Todas as permutações de uma lista de índices. */
function permutacoes(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const resto = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutacoes(resto)) out.push([arr[i], ...p]);
  }
  return out;
}

/**
 * Força bruta: enumera TODAS as permutações dos pontos intermediários e
 * devolve a de menor custo (com a origem e o destino/fechamento fixos).
 */
function forcaBruta(D, indices, inicio, fim) {
  let custo = Infinity;
  let ordem = null;
  for (const p of permutacoes(indices)) {
    const c = custoDaOrdem(D, p, inicio, fim);
    if (c < custo) {
      custo = c;
      ordem = p;
    }
  }
  return { custo, ordem };
}

/**
 * Matriz assimétrica de 5 pontos (0 = origem, 4 = destino, 1..3 = paradas).
 *
 *   D[3][0] = 60 (o retorno é caro) torna a matriz **assimétrica** e faz
 *   com que o circuito ótimo NÃO comece pelo trecho mais curto:
 *
 *      0 →1→2→3→0 = 10+5+5+60 = 80      0 →3→2→1→0 = 30+5+5+10 = 50  ← ótimo
 *      0 →1→3→2→0 = 10+25+5+20 = 60     0 →2→3→1→0 = 20+5+25+10 = 60
 *      0 →2→1→3→0 = 20+5+25+60 = 110    0 →3→1→2→0 = 30+25+5+20 = 80
 */
const D_ASSIM = [
  [0, 10, 20, 30, 40],
  [10, 0, 5, 25, 35],
  [20, 5, 0, 5, 25],
  [60, 25, 5, 0, 10],
  [40, 35, 25, 10, 0],
];

/** Mesma matriz, mas simétrica (D[3][0] = 30): o reverso empata. */
const D_SIM = D_ASSIM.map((linha, i) => linha.map((v, j) => Math.min(v, D_ASSIM[j][i])));
D_SIM[3][0] = 30;

/* ══════════════════════════════════════════════════════════════════ */
/* A. MATRIZ DE CUSTOS E HELD-KARP                                     */
/* ══════════════════════════════════════════════════════════════════ */

test('A1. custoDaOrdem — o custo do caminho com origem e destino fixos', () => {
  // 0 → 2 → 1 → 3 → 4 = 20 + 5 + 25 + 10 = 60
  assert.equal(custoDaOrdem(D_ASSIM, [2, 1, 3], 0, 4), 60);
  // a mesma sequência sem destino fixo não soma o fechamento
  assert.equal(custoDaOrdem(D_ASSIM, [2, 1, 3], 0, null), 50);
  // no circuito o fechamento é a última parada → origem
  assert.equal(custoDaOrdem(D_ASSIM, [3, 2, 1], 0, 0), 50);
});

test('A2. Held-Karp == força bruta (todas as permutações) — caminho aberto', () => {
  const bruto = forcaBruta(D_ASSIM, [1, 2, 3], 0, 4);
  const hk = heldKarp(D_ASSIM, [1, 2, 3], 0, 4);
  assert.equal(hk.custo, bruto.custo);
  assert.equal(hk.custo, 30); // 0 →1→2→3→4
  assert.deepEqual(hk.ordem, [1, 2, 3]);
  assert.equal(custoDaOrdem(D_ASSIM, hk.ordem, 0, 4), hk.custo);
});

test('A2b. Held-Karp == força bruta — circuito (com retorno à origem)', () => {
  const bruto = forcaBruta(D_ASSIM, [1, 2, 3], 0, 0);
  const hk = heldKarp(D_ASSIM, [1, 2, 3], 0, 0);
  assert.equal(hk.custo, bruto.custo);
  assert.equal(hk.custo, 50); // 0 →3→2→1→0
  assert.deepEqual(hk.ordem, [3, 2, 1]);
});

test('A3. o custo do circuito inclui o retorno à origem', () => {
  // sem o fechamento, a melhor ordem aberta custaria 30 (0→1→2→3→4);
  // com o fechamento à origem, o custo mínimo é 50
  const hkCircuito = heldKarp(D_ASSIM, [1, 2, 3], 0, 0);
  assert.equal(hkCircuito.custo, 50);
  assert.ok(hkCircuito.custo > 30, 'o retorno precisa entrar no custo');
  // e o custo é exatamente a soma das pernas + a perna de fechamento
  const ultimo = hkCircuito.ordem[hkCircuito.ordem.length - 1];
  let soma = D_ASSIM[0][hkCircuito.ordem[0]];
  for (let k = 0; k < hkCircuito.ordem.length - 1; k++) {
    soma += D_ASSIM[hkCircuito.ordem[k]][hkCircuito.ordem[k + 1]];
  }
  assert.equal(soma + D_ASSIM[ultimo][0], hkCircuito.custo);
});

test('A4. o trecho inicial mais curto NÃO leva ao circuito mais curto', () => {
  const menorPrimeiro = D_ASSIM[0]
    .map((v, j) => ({ j, v }))
    .filter((x) => x.j >= 1 && x.j <= 3)
    .sort((a, b) => a.v - b.v)[0];
  assert.equal(menorPrimeiro.j, 1); // 0→1 = 10 m é o trecho mais curto…
  assert.equal(menorPrimeiro.v, 10);

  const hk = heldKarp(D_ASSIM, [1, 2, 3], 0, 0);
  assert.equal(hk.ordem[0], 3, '…mas o circuito ótimo começa pelo trecho mais LONGO');
  assert.equal(hk.custo, 50);

  // o circuito que começa pelo trecho mais curto é pior
  const peloMaisCurto = custoDaOrdem(D_ASSIM, [1, 2, 3], 0, 0);
  assert.equal(peloMaisCurto, 80);
  assert.ok(peloMaisCurto > hk.custo);
});

test('A5. matriz assimétrica — o Held-Karp não depende da simetria', () => {
  const bruto = forcaBruta(D_ASSIM, [1, 2, 3], 0, 0);
  const hk = heldKarp(D_ASSIM, [1, 2, 3], 0, 0);
  assert.equal(hk.custo, bruto.custo);
  assert.notEqual(D_ASSIM[3][0], D_ASSIM[0][3]); // a matriz é de fato assimétrica
  // o Held-Karp de uma matriz assimétrica não pode ser comparado com o
  // caminho reverso: o reverso custa 80, o ótimo custa 50
  const reverso = custoDaOrdem(D_ASSIM, [...hk.ordem].reverse(), 0, 0);
  assert.equal(reverso, 80);
  assert.notEqual(reverso, hk.custo);
});

test('A6. par sem caminho viável (Infinity) é evitado pelo Held-Karp', () => {
  const D = D_ASSIM.map((l) => l.slice());
  D[1][3] = Infinity;
  D[3][1] = Infinity;
  const hk = heldKarp(D, [1, 2, 3], 0, 0);
  assert.ok(Number.isFinite(hk.custo), 'deve existir uma ordem viável');
  assert.equal(hk.custo, 50); // 0→3→2→1→0 não usa o par 1↔3
  assert.ok(!hk.ordem.includes(3) || hk.ordem.indexOf(3) < hk.ordem.indexOf(1));

  // sem nenhuma ordem viável, o custo é Infinity e nenhuma ordem é devolvida
  const D2 = D_ASSIM.map((l) => l.slice());
  D2[1][2] = D2[2][1] = Infinity;
  D2[1][3] = D2[3][1] = Infinity;
  D2[2][3] = D2[3][2] = Infinity;
  const hk2 = heldKarp(D2, [1, 2, 3], 0, 0);
  assert.equal(hk2.custo, Infinity);
  assert.deepEqual(hk2.ordem, []);
});

test('A7. reconstrução — o custo da ordem devolvida é o custo do Held-Karp', () => {
  const indices = [1, 2, 3];
  const hk = heldKarp(D_ASSIM, indices, 0, 0);
  assert.equal(hk.ordem.length, indices.length, 'toda parada é visitada uma vez');
  assert.equal(new Set(hk.ordem).size, indices.length, 'nenhuma parada é repetida');
  assert.equal(custoDaOrdem(D_ASSIM, hk.ordem, 0, 0), hk.custo);
});

test('A8. empate numa matriz simétrica — o reverso custa o mesmo (economia 0 m)', () => {
  const hk = heldKarp(D_SIM, [1, 2, 3], 0, 0);
  const reverso = custoDaOrdem(D_SIM, [...hk.ordem].reverse(), 0, 0);
  assert.equal(hk.custo, 50);
  assert.equal(reverso, hk.custo, 'o ciclo reverso tem exatamente o mesmo custo');
  // a economia sobre a ordem do usuário é ZERO — o sintoma relatado
  const usuario = custoDaOrdem(D_SIM, [1, 2, 3], 0, 0);
  assert.equal(usuario, hk.custo);
  assert.equal(Math.abs(usuario - hk.custo), 0);
});

/* ══════════════════════════════════════════════════════════════════ */
/* B. REDE REAL                                                      */
/* ══════════════════════════════════════════════════════════════════ */

/**
 * Os quatro pontos abaixo estão na maior componente da rede real e
 * reproduzem o caso relatado: a ordem do usuário e a ordem otimizada têm
 * **o mesmo custo total** (empate), e o Held-Karp devolve o ciclo reverso.
 */
const PONTOS_REAIS = [
  { rotulo: 'A', latitude: -23.627891, longitude: -46.516183 },
  { rotulo: 'B', latitude: -23.621109, longitude: -46.516798 },
  { rotulo: 'C', latitude: -23.624177, longitude: -46.512398 },
  { rotulo: 'D', latitude: -23.628655, longitude: -46.509507 },
];

let grafoReal = null;
function grafo() {
  if (!grafoReal) grafoReal = buildGraph(loadRealFeatures(), {});
  return grafoReal;
}

test('B1. a matriz real é simétrica, tem diagonal zero e nenhum custo é menor que a linha reta', () => {
  const { D, semCaminho } = matrizDistancias(grafo(), PONTOS_REAIS);
  assert.equal(semCaminho.length, 0, 'todos os pares são alcançáveis');
  for (let i = 0; i < D.length; i++) {
    assert.equal(D[i][i], 0, 'diagonal zerada');
    for (let j = 0; j < D.length; j++) {
      assert.equal(D[i][j], D[j][i], `D[${i}][${j}] deve ser simétrico`);
      const reta = haversine(
        PONTOS_REAIS[i].longitude,
        PONTOS_REAIS[i].latitude,
        PONTOS_REAIS[j].longitude,
        PONTOS_REAIS[j].latitude,
      );
      assert.ok(
        D[i][j] >= reta - 1e-6,
        `D[${i}][${j}] = ${D[i][j]} não pode ser menor que a linha reta (${reta})`,
      );
    }
  }
});

test('B2. Held-Karp == força bruta no caso real (6 permutações do circuito)', () => {
  const { D } = matrizDistancias(grafo(), PONTOS_REAIS);
  const bruto = forcaBruta(D, [1, 2, 3], 0, 0);
  const hk = heldKarp(D, [1, 2, 3], 0, 0);
  assert.equal(hk.custo, bruto.custo, 'o Held-Karp tem de achar o ótimo global');
  assert.ok(Math.abs(hk.custo - 3440.9) < 3440.9 * 0.15, 'ordem de grandeza do circuito');
});

test('B3. no caso real a ordem do usuário EMPATA com a otimizada (economia 0 m)', () => {
  const { D } = matrizDistancias(grafo(), PONTOS_REAIS);
  const usuario = custoDaOrdem(D, [1, 2, 3], 0, 0);
  const hk = heldKarp(D, [1, 2, 3], 0, 0);
  assert.ok(
    Math.abs(usuario - hk.custo) < 0.01,
    `empate esperado: usuário ${usuario} × otimizado ${hk.custo}`,
  );
});

test('B4/B5/B6. rota otimizada: o trecho desenhado custa a célula da matriz, a soma bate com o total e a sequência fecha na origem', () => {
  const r = calcularRotaComParadas(grafo(), PONTOS_REAIS, {
    modo: 'otimizada',
    circular: true,
  });
  assert.equal(r.ok, true, r.message || '');
  assert.equal(r.otimizacao.metodo, 'exato');

  const { D } = matrizDistancias(grafo(), PONTOS_REAIS);
  const ordem = r.sequencia; // rótulos na ordem percorrida
  const indices = ordem.map((rot) => PONTOS_REAIS.findIndex((p) => p.rotulo === rot));
  // o último trecho é o retorno à origem
  indices.push(indices[0]);

  // B4 — cada trecho desenhado custa exatamente a célula da matriz
  let soma = 0;
  r.legs.forEach((leg, i) => {
    const de = indices[i];
    const para = indices[i + 1];
    assert.ok(
      Math.abs(leg.distance - D[de][para]) < 1e-6,
      `trecho ${leg.de}→${leg.para}: ${leg.distance} × matriz ${D[de][para]}`,
    );
    soma += leg.distance;
  });

  // B5 — soma dos trechos == distância total == custo do Held-Karp
  assert.ok(Math.abs(soma - r.distance) < 1e-6, 'a soma dos trechos é a distância total');
  assert.ok(Math.abs(r.distance - r.otimizacao.custo) < 1e-6, 'o total é o custo do Held-Karp');

  // B6 — a sequência começa e termina na origem, e há o trecho de retorno
  assert.equal(r.sequenciaCompleta[0], 'A');
  assert.equal(r.sequenciaCompleta[r.sequenciaCompleta.length - 1], 'A');
  assert.equal(r.retorno.de, r.sequencia[r.sequencia.length - 1]);
  assert.equal(r.retorno.para, 'A');
  assert.ok(r.retorno.distance > 0, 'o retorno é um trecho real da rede');
  assert.equal(r.legs.length, 4); // 3 pernas + o retorno
});

test('B7. o modo "ordem do usuário" preserva exatamente a sequência informada', () => {
  const r = calcularRotaComParadas(grafo(), PONTOS_REAIS, {
    modo: 'usuario',
    circular: true,
  });
  assert.equal(r.ok, true, r.message || '');
  assert.deepEqual(r.sequencia, ['A', 'B', 'C', 'D']);
  assert.deepEqual(r.sequenciaCompleta, ['A', 'B', 'C', 'D', 'A']);
  assert.equal(r.retorno.para, 'A');
});

test('B8. otimizarOrdem declara o método e devolve a ordem da origem com o fechamento', () => {
  const o = otimizarOrdem(grafo(), PONTOS_REAIS, { circular: true });
  assert.equal(o.ok, true);
  assert.equal(o.metodo, 'exato');
  assert.equal(o.ordem[0], 0, 'a origem é sempre a primeira');
  assert.equal(o.ordem.length, 4, 'origem + 3 paradas (o fechamento é implícito)');
  assert.equal(new Set(o.ordem).size, 4, 'nenhuma parada repetida');
});
