/**
 * TESTES — OTIMIZAÇÃO DA ORDEM DE VISITA (TSP sobre o fecho métrico)
 * ======================================================================
 *
 *  1. a ordem otimizada é **no máximo tão longa** quanto a ordem do usuário;
 *  2. a solução **exata** (Held-Karp) bate a força bruta;
 *  3. o 2-opt nunca piora a ordem;
 *  4. a matriz de distâncias é simétrica e satisfaz a desigualdade triangular
 *     (é o fecho métrico — condição para o TSP ser válido);
 *  5. a distância da rota otimizada = soma dos trechos na ordem otimizada;
 *  6. o modo "ordem do usuário" respeita exatamente a sequência informada;
 *  7. a geometria original (curvas) é preservada também na rota otimizada;
 *  8. pontos sem conexão entre si são recusados com motivo explícito;
 *  9. arrastar um ponto (mover suas coordenadas) muda a rota.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  matrizDistancias,
  vizinhoMaisProximo,
  doisOpt,
  heldKarp,
  otimizarOrdem,
  custoDaOrdem,
  LIMITE_EXATO,
  LIMITE_TOTAL,
} from '../core/ordemParadas.js';
import { calcularRotaComParadas, MODOS_ORDEM } from '../core/rotaParadas.js';
import {
  criarListaPontos,
  adicionarPonto,
  moverPontoPara,
  moverPonto,
  rotularPontos,
  sequenciaRotulos,
} from '../core/pontoTrajeto.js';
import { buildGraph } from '../core/graph.js';
import { project, unproject, haversine } from '../core/geo.js';
import { feature, official } from './helpers.js';

const BASE = [-46.545, -23.66];
const [BX, BY] = project(BASE[0], BASE[1]);

/** Ponto a (dx, dy) metros do BASE, em [lon, lat]. */
function ponto(dx, dy) {
  const [lon, lat] = unproject(BX + dx, BY + dy);
  return [lon, lat];
}
/** {latitude, longitude} a (dx, dy) metros do BASE. */
function asLatLon(dx, dy) {
  const [lon, lat] = ponto(dx, dy);
  return { latitude: lat, longitude: lon };
}

/** Eixo reto em metros. */
function eixoReto(id, x0, y0, x1, y1, nome) {
  return feature(official(id, nome || `RUA ${id}`), [ponto(x0, y0), ponto(x1, y1)]);
}

/** Eixo em curva (a "S"), para testar a preservação da geometria. */
function eixoEmCurva(id, x0, y0, x1, y1, amplitude) {
  const coords = [];
  const passos = 12;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  for (let i = 0; i <= passos; i++) {
    const t = i / passos;
    const off = amplitude * Math.sin(Math.PI * t * 2);
    coords.push(ponto(x0 + dx * t + px * off, y0 + dy * t + py * off));
  }
  return feature(official(id, `RUA EM CURVA ${id}`), coords);
}

/**
 * Malha em anel quadrado de 300 m: o trajeto mais curto entre dois pontos
 * opostos é o perímetro, nunca a diagonal (a diagonal não existe na malha).
 */
function malhaEmAnel() {
  return [
    eixoReto(1, 0, 0, 300, 0, 'RUA SUL'),
    eixoReto(2, 300, 0, 300, 300, 'RUA LESTE'),
    eixoReto(3, 300, 300, 0, 300, 'RUA NORTE'),
    eixoReto(4, 0, 300, 0, 0, 'RUA OESTE'),
  ];
}

/** Pontos nos quatro cantos do anel. */
const CANTOS = {
  A: asLatLon(0, 0),
  B: asLatLon(300, 0),
  C: asLatLon(300, 300),
  D: asLatLon(0, 300),
};

/* ================================================================== */

test('1. a ordem otimizada é no máximo tão longa quanto a ordem do usuário', () => {
  const g = buildGraph(malhaEmAnel(), {});
  // ordem do usuário propositalmente ruim: A → C → B → D (atravessa a malha)
  const pontos = [
    { rotulo: 'A', ...CANTOS.A },
    { rotulo: 'C', ...CANTOS.C },
    { rotulo: 'B', ...CANTOS.B },
    { rotulo: 'D', ...CANTOS.D },
  ];
  const otim = otimizarOrdem(g, pontos, {});
  assert.equal(otim.ok, true);
  assert.equal(otim.metodo, 'exato');

  const custoUsuario = custoDaOrdem(otim.matriz, [0, 1, 2, 3], 0, 3);
  assert.ok(otim.custo <= custoUsuario + 1e-6, 'a ordem otimizada não pode ser pior');
  // no anel, a ordem ótima é o perímetro: 300 + 300 + 300 = 900 m
  assert.ok(Math.abs(otim.custo - 900) < 1, `custo ótimo: ${otim.custo}`);
  assert.ok(custoUsuario > 900, `custo do usuário: ${custoUsuario}`);
});

test('2. a solução exata (Held-Karp) bate a força bruta', () => {
  const g = buildGraph(malhaEmAnel(), {});
  const pontos = [
    { rotulo: 'A', ...CANTOS.A },
    { rotulo: 'B', ...CANTOS.B },
    { rotulo: 'C', ...CANTOS.C },
    { rotulo: 'D', ...CANTOS.D },
  ];
  const { D } = matrizDistancias(g, pontos, {});
  const otim = heldKarp(D, [1, 2], 0, 3);

  // força bruta: as duas permutações das paradas intermediárias
  const permutacoes = [[1, 2], [2, 1]];
  let melhor = Infinity;
  for (const p of permutacoes) {
    const c = D[0][p[0]] + D[p[0]][p[1]] + D[p[1]][3];
    if (c < melhor) melhor = c;
  }
  assert.ok(Math.abs(otim.custo - melhor) < 1e-6, `Held-Karp: ${otim.custo}, brute force: ${melhor}`);
});

test('3. o 2-opt nunca piora a ordem', () => {
  const g = buildGraph(malhaEmAnel(), {});
  const pontos = [
    { rotulo: 'A', ...CANTOS.A },
    { rotulo: 'B', ...CANTOS.B },
    { rotulo: 'C', ...CANTOS.C },
    { rotulo: 'D', ...CANTOS.D },
  ];
  const { D } = matrizDistancias(g, pontos, {});
  const inicial = vizinhoMaisProximo(D, [1, 2], 0);
  const antes = custoDaOrdem(D, inicial, 0, 3);
  const depois = doisOpt(D, inicial, 0, 3);
  assert.ok(depois.custo <= antes + 1e-6, `2-opt piorou: ${antes} → ${depois.custo}`);
  assert.ok(Number.isFinite(depois.custo));
});

test('4. a matriz de distâncias é simétrica e satisfaz a desigualdade triangular', () => {
  const g = buildGraph(malhaEmAnel(), {});
  const pontos = [
    { rotulo: 'A', ...CANTOS.A },
    { rotulo: 'B', ...CANTOS.B },
    { rotulo: 'C', ...CANTOS.C },
    { rotulo: 'D', ...CANTOS.D },
  ];
  const { D } = matrizDistancias(g, pontos, {});
  for (let i = 0; i < 4; i++) {
    assert.equal(D[i][i], 0);
    for (let j = 0; j < 4; j++) {
      assert.ok(Math.abs(D[i][j] - D[j][i]) < 1e-6, 'a matriz deve ser simétrica');
    }
  }
  // desigualdade triangular: D(a,c) ≤ D(a,b) + D(b,c)
  for (let a = 0; a < 4; a++)
    for (let b = 0; b < 4; b++)
      for (let c = 0; c < 4; c++) {
        if (a === b || b === c) continue;
        assert.ok(D[a][c] <= D[a][b] + D[b][c] + 1e-6, 'fecho métrico violado');
      }
});

test('5. a distância da rota otimizada = soma dos trechos na ordem otimizada', () => {
  const g = buildGraph(malhaEmAnel(), {});
  const pontos = [
    { rotulo: 'A', ...CANTOS.A },
    { rotulo: 'C', ...CANTOS.C },
    { rotulo: 'B', ...CANTOS.B },
    { rotulo: 'D', ...CANTOS.D },
  ];
  const r = calcularRotaComParadas(g, pontos, { modo: MODOS_ORDEM.OTIMIZADA });
  assert.equal(r.ok, true);
  assert.equal(r.modo, 'otimizada');
  assert.equal(r.legs.length, 3);
  const soma = r.legs.reduce((s, l) => s + l.distance, 0);
  assert.ok(Math.abs(soma - r.distance) < 1e-6);
  // a sequência aplicada é a otimizada (A → B → C → D), não a informada
  assert.deepEqual(r.sequenciaUsuario, ['A', 'C', 'B', 'D']);
  assert.deepEqual(r.sequencia, ['A', 'B', 'C', 'D']);
  // e a economia é informada
  assert.ok(r.comparacao);
  assert.ok(r.comparacao.economia > 0, 'deve haver economia sobre a ordem do usuário');
  assert.ok(r.comparacao.economiaPercentual > 0);
});

test('6. o modo "ordem do usuário" respeita exatamente a sequência informada', () => {
  const g = buildGraph(malhaEmAnel(), {});
  const pontos = [
    { rotulo: 'A', ...CANTOS.A },
    { rotulo: 'C', ...CANTOS.C },
    { rotulo: 'B', ...CANTOS.B },
    { rotulo: 'D', ...CANTOS.D },
  ];
  const r = calcularRotaComParadas(g, pontos, { modo: MODOS_ORDEM.USUARIO });
  assert.equal(r.ok, true);
  assert.deepEqual(r.sequencia, ['A', 'C', 'B', 'D']);
  assert.equal(r.otimizacao, null);
  // sem modo (padrão) também é a ordem do usuário
  const r2 = calcularRotaComParadas(g, pontos, {});
  assert.deepEqual(r2.sequencia, ['A', 'C', 'B', 'D']);
});

test('7. a geometria original (curvas) é preservada na rota otimizada', () => {
  const feats = [
    eixoEmCurva(1, 0, 0, 300, 0, 40),
    eixoReto(2, 300, 0, 300, 300, 'RUA LESTE'),
    eixoEmCurva(3, 300, 300, 0, 300, 40),
  ];
  const g = buildGraph(feats, {});
  const pontos = [
    { rotulo: 'A', ...asLatLon(0, 0) },
    { rotulo: 'C', ...asLatLon(300, 300) },
    { rotulo: 'D', ...asLatLon(0, 300) },
  ];
  const r = calcularRotaComParadas(g, pontos, { modo: MODOS_ORDEM.OTIMIZADA });
  assert.equal(r.ok, true);
  // todos os trechos mantêm os vértices das curvas
  for (const perna of r.legs) {
    assert.ok(perna.geometry.coordinates.length >= 3, `trecho com ${perna.geometry.coordinates.length} vértices`);
  }
  // a geometria final contém os vértices dos trechos, na ordem
  const todos = r.geometry.coordinates;
  for (const perna of r.legs) {
    let cursor = 0;
    for (const v of perna.geometry.coordinates) {
      let achou = false;
      for (let k = cursor; k < todos.length; k++) {
        if (haversine(todos[k][0], todos[k][1], v[0], v[1]) < 0.02) {
          cursor = k;
          achou = true;
          break;
        }
      }
      assert.ok(achou, 'vértice do trecho ausente na geometria final');
    }
  }
});

test('8. pontos sem conexão entre si são recusados com motivo explícito', () => {
  const feats = [
    eixoReto(1, 0, 0, 200, 0, 'RUA ISOLADA'),
    eixoReto(2, 1000, 1000, 1200, 1000, 'OUTRA RUA ISOLADA'),
  ];
  const g = buildGraph(feats, {});
  const pontos = [
    { rotulo: 'A', ...asLatLon(0, 0) },
    { rotulo: 'B', ...asLatLon(200, 0) },
    { rotulo: 'C', ...asLatLon(1100, 1000) },
  ];
  const r = calcularRotaComParadas(g, pontos, { modo: MODOS_ORDEM.OTIMIZADA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PONTOS_SEM_CONEXAO');
  assert.ok(r.message.length > 0);
  assert.ok(Array.isArray(r.semCaminho));
});

test('9. mover um ponto (arrastar no mapa) muda a rota', () => {
  // malha com RAMIFICAÇÕES: aqui a ordem de visita realmente muda a
  // distância (num anel, ela seria constante)
  const malha = [
    eixoReto(1, 0, 0, 400, 0, 'AVENIDA PRINCIPAL'),
    eixoReto(2, 100, 0, 100, 200, 'RUA RAMAL 1'),
    eixoReto(3, 300, 0, 300, 200, 'RUA RAMAL 2'),
  ];
  const g = buildGraph(malha, {});
  const pontos = [
    { rotulo: 'A', ...asLatLon(0, 0) },
    { rotulo: 'B', ...asLatLon(100, 200) },
    { rotulo: 'D', ...asLatLon(400, 0) },
  ];
  const antes = calcularRotaComParadas(g, pontos, { modo: MODOS_ORDEM.USUARIO });
  assert.equal(antes.ok, true);

  // o usuário arrasta a parada B do fim da ramal para a avenida
  const movido = pontos.map((p) =>
    p.rotulo === 'B' ? { ...p, ...asLatLon(150, 0) } : p,
  );
  const depois = calcularRotaComParadas(g, movido, { modo: MODOS_ORDEM.USUARIO });
  assert.equal(depois.ok, true);
  assert.ok(
    Math.abs(depois.distance - antes.distance) > 1,
    `a distância deveria mudar: ${antes.distance} → ${depois.distance}`,
  );
  // e a sequência continua sendo a do usuário
  assert.deepEqual(depois.sequencia, ['A', 'B', 'D']);

  // a rota otimizada também reage ao arrasto
  const otA = calcularRotaComParadas(g, pontos, { modo: MODOS_ORDEM.OTIMIZADA });
  const otB = calcularRotaComParadas(g, movido, { modo: MODOS_ORDEM.OTIMIZADA });
  assert.equal(otA.ok, true);
  assert.equal(otB.ok, true);
  assert.ok(Math.abs(otA.distance - otB.distance) > 1);
});

/* ─────────── Arraste da ordem no painel (reordenação) ─────────── */

test('11. arrastar uma parada troca a ordem de visita', () => {
  const lista = criarListaPontos();
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  rotularPontos(lista);
  assert.deepEqual(sequenciaRotulos(lista), ['A', 'B', 'C', 'D']);
  const [origem, b, c, destino] = lista.pontos;

  // "arrasta" a linha da parada C para a posição da linha de B
  const res = moverPontoPara(lista, c.id, 1);
  assert.ok(res, 'o movimento deve ter sido aplicado');
  // os extremos não se movem
  assert.equal(lista.pontos[0].id, origem.id);
  assert.equal(lista.pontos[lista.pontos.length - 1].id, destino.id);
  // e o ponto arrastado é o que trocou de lugar
  assert.equal(lista.pontos[1].id, c.id);
  assert.equal(lista.pontos[2].id, b.id);
  // os rótulos são **posicionais** (A = origem, o último = destino):
  // a lista continua se lendo A → B → C → D, mas o conteúdo mudou de lugar
  assert.deepEqual(sequenciaRotulos(lista), ['A', 'B', 'C', 'D']);
});

test('12. a origem e o destino não podem ser arrastados', () => {
  const lista = criarListaPontos();
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  const [origem, , destino] = lista.pontos;

  assert.equal(moverPontoPara(lista, origem.id, 1), null, 'a origem é fixa');
  assert.equal(moverPontoPara(lista, destino.id, 0), null, 'o destino é fixo');
  assert.deepEqual(sequenciaRotulos(lista), ['A', 'B', 'C']);
});

test('13. arrastar para fora da faixa de paradas é limitado', () => {
  const lista = criarListaPontos();
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  const [origem, b, destino] = lista.pontos;

  // tenta colocar B na posição 0 (seria a origem) → vira a primeira parada
  moverPontoPara(lista, b.id, 0);
  assert.equal(lista.pontos[0].id, origem.id, 'a origem continua no lugar');
  assert.equal(lista.pontos[1].id, b.id, 'B passou a ser a primeira parada');

  // tenta colocar B muito além do destino → vira a última parada
  moverPontoPara(lista, b.id, 99);
  assert.equal(lista.pontos[lista.pontos.length - 1].id, destino.id, 'o destino continua no lugar');
  assert.equal(lista.pontos[lista.pontos.length - 2].id, b.id, 'B é a última parada');
});

test('14. a ordem arrastada define a rota no modo "ordem do usuário"', () => {
  // malha com RAMIFICAÇÕES: aqui a ordem de visita muda a distância
  const malha = [
    eixoReto(1, 0, 0, 400, 0, 'AVENIDA PRINCIPAL'),
    eixoReto(2, 100, 0, 100, 200, 'RUA RAMAL 1'),
    eixoReto(3, 300, 0, 300, 200, 'RUA RAMAL 2'),
  ];
  const g = buildGraph(malha, {});
  const lista = criarListaPontos();
  const pontos = [
    { rotulo: 'A', ...asLatLon(0, 0) },
    { rotulo: 'B', ...asLatLon(100, 200) },
    { rotulo: 'C', ...asLatLon(300, 200) },
    { rotulo: 'D', ...asLatLon(400, 0) },
  ];
  // a primeira parada cadastrada é a ORIGEM e a segunda é o DESTINO;
  // cada parada nova entra antes do destino (virando a última parada).
  // Por isso a ordem de cadastro é A, D, B, C para a lista ficar A, B, C, D.
  for (const p of [pontos[0], pontos[3], pontos[1], pontos[2]]) {
    adicionarPonto(lista, { latitude: p.latitude, longitude: p.longitude });
  }
  rotularPontos(lista);
  assert.deepEqual(
    lista.pontos.map((p) => p.rotulo),
    ['A', 'B', 'C', 'D'],
  );

  const antes = calcularRotaComParadas(
    g,
    lista.pontos.map((p) => ({ rotulo: p.rotulo, latitude: p.latitude, longitude: p.longitude })),
    { modo: MODOS_ORDEM.USUARIO },
  );
  assert.equal(antes.ok, true);
  assert.ok(Math.abs(antes.distance - 1200) < 0.01, `A → B → C → D pela ramificação: ${antes.distance}`);

  // arrasta a linha da parada B para depois da linha de C
  const b = lista.pontos[1];
  moverPontoPara(lista, b.id, 2);
  const depois = calcularRotaComParadas(
    g,
    lista.pontos.map((p) => ({ rotulo: p.rotulo, latitude: p.latitude, longitude: p.longitude })),
    { modo: MODOS_ORDEM.USUARIO },
  );
  assert.equal(depois.ok, true);
  assert.ok(
    Math.abs(depois.distance - antes.distance) > 1,
    `a distância deveria mudar: ${antes.distance} → ${depois.distance}`,
  );
  // os rótulos são posicionais: a sequência percorrida continua A → B → C → D
  assert.deepEqual(depois.sequencia, ['A', 'B', 'C', 'D']);
  // … mas o primeiro trecho agora vai até a parada que era C
  // (A → ramal 2 = 300 m de avenida + 200 m de ramal = 500 m)
  const primeiroTrecho = depois.legs[0];
  assert.ok(
    Math.abs(primeiroTrecho.distance - 500) < 1,
    `o primeiro trecho deveria ir até a outra ramal (500 m), veio ${primeiroTrecho.distance}`,
  );
  assert.ok(Math.abs(depois.distance - 1600) < 0.01, `total esperado 1600 m, veio ${depois.distance}`);
});

test('15. a reordenação por botão (↑/↓) segue a mesma regra', () => {
  const lista = criarListaPontos();
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  const [origem, b, c, destino] = lista.pontos;
  moverPonto(lista, b.id, +1);
  assert.deepEqual(lista.pontos.map((p) => p.id), [origem.id, c.id, b.id, destino.id]);
  moverPonto(lista, b.id, -1);
  assert.deepEqual(lista.pontos.map((p) => p.id), [origem.id, b.id, c.id, destino.id]);
});

test('16. acima do limite de paradas, a otimização passa a ser heurística', () => {
  // o limite exato é uma constante exportada: acima dele o método é
  // 'heuristico' (e nunca se afirma exatidão)
  assert.ok(LIMITE_EXATO >= 8);
  assert.ok(LIMITE_TOTAL > LIMITE_EXATO);
});
