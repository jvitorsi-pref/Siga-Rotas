/**
 * TESTES — ROTA CIRCULAR (A → B → C → D → A)
 * ======================================================================
 *
 *  1. o circuito **termina obrigatoriamente na origem** (trecho de
 *     fechamento roteado pela rede, com distância real);
 *  2. o trecho de fechamento **não é uma linha reta** (a geometria do
 *     percurso tem o mesmo comprimento do trecho roteado);
 *  3. no modo otimizado, a ordem escolhida é a de **menor ciclo** (conferida
 *     contra a força bruta);
 *  4. no modo do usuário, a sequência dos cards é exatamente a percorrida,
 *     incluindo o retorno;
 *  5. arrastar um card muda a ordem usada no cálculo;
 *  6. casos de borda: só a origem, uma única parada, pontos coincidentes,
 *     endereço inválido, ausência de caminho (inclusive no retorno);
 *  7. resultado parcial nunca é apresentado como circuito completo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { calcularRotaComParadas, MODOS_ORDEM } from '../core/rotaParadas.js';
import { heldKarp, matrizDistancias, custoDaOrdem } from '../core/ordemParadas.js';
import { buildGraph } from '../core/graph.js';
import { project, unproject, haversine } from '../core/geo.js';
import {
  criarListaPontos,
  adicionarPonto,
  rotularPontos,
  moverPontoPara,
  podeCalcular,
  contarParadas,
  sequenciaRotulos,
} from '../core/pontoTrajeto.js';
import { feature, official } from './helpers.js';

const BASE = [-46.545, -23.66];
const [BX, BY] = project(BASE[0], BASE[1]);

function ponto(dx, dy) {
  const [lon, lat] = unproject(BX + dx, BY + dy);
  return [lon, lat];
}
function asLatLon(dx, dy) {
  const [lon, lat] = ponto(dx, dy);
  return { latitude: lat, longitude: lon };
}
function eixoReto(id, x0, y0, x1, y1, nome) {
  return feature(official(id, nome || `RUA ${id}`), [ponto(x0, y0), ponto(x1, y1)]);
}

/**
 * Malha com ramificações (a ordem de visita altera a distância):
 *
 *        (100,200) B        (300,200) C
 *              |                |
 *   A (0,0) ---+------ RUA -----+--- D (400,0)
 *
 * Distâncias: A→B 300 · B→C 600 · C→D 300
 *             A→C 500 · C→B 600 · B→D 500
 */
function malhaComRamificacoes() {
  return [
    eixoReto(1, 0, 0, 400, 0, 'AVENIDA PRINCIPAL'),
    eixoReto(2, 100, 0, 100, 200, 'RUA RAMAL 1'),
    eixoReto(3, 300, 0, 300, 200, 'RUA RAMAL 2'),
  ];
}

/** Quatro pontos nos quatro "nós" da malha. */
const PONTOS = {
  A: asLatLon(0, 0),
  B: asLatLon(100, 200),
  C: asLatLon(300, 200),
  D: asLatLon(400, 0),
};

/** Lista de pontos em modo circuito, na ordem A, B, C, D. */
function listaCircuito(ordem = ['A', 'B', 'C', 'D']) {
  const lista = criarListaPontos();
  lista.circuito = true;
  for (const r of ordem) {
    adicionarPonto(lista, { latitude: PONTOS[r].latitude, longitude: PONTOS[r].longitude });
  }
  return rotularPontos(lista);
}

/** Comprimento métrico de uma geometria (soma dos trechos). */
function comprimento(coords) {
  let t = 0;
  for (let i = 1; i < coords.length; i++) {
    t += haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return t;
}

/* ================================================================== */

test('1. o circuito termina obrigatoriamente na origem', () => {
  const g = buildGraph(malhaComRamificacoes(), {});
  const r = calcularRotaComParadas(
    g,
    [
      { rotulo: 'A', ...PONTOS.A },
      { rotulo: 'B', ...PONTOS.B },
      { rotulo: 'C', ...PONTOS.C },
      { rotulo: 'D', ...PONTOS.D },
    ],
    { modo: MODOS_ORDEM.USUARIO, circular: true },
  );
  assert.equal(r.ok, true);
  assert.equal(r.circular, true);

  // 4 pontos → 4 trechos (A→B, B→C, C→D e o retorno D→A)
  assert.equal(r.legs.length, 4);
  const ultimo = r.legs[3];
  assert.equal(ultimo.de, 'D');
  assert.equal(ultimo.para, 'A');
  assert.equal(ultimo.retorno, true);
  assert.ok(ultimo.distance > 0, 'o retorno tem de ser um percurso real');

  // a sequência completa mostra o fechamento
  assert.deepEqual(r.sequencia, ['A', 'B', 'C', 'D']);
  assert.deepEqual(r.sequenciaCompleta, ['A', 'B', 'C', 'D', 'A']);
  assert.equal(r.retorno.de, 'D');
  assert.equal(r.retorno.para, 'A');

  // e o total é a soma dos trechos, incluindo o retorno
  const soma = r.legs.reduce((s, l) => s + l.distance, 0);
  assert.ok(Math.abs(soma - r.distance) < 1e-6);
  // A→B→C→D→A = 300 + 600 + 300 + 400 = 1600
  assert.ok(Math.abs(r.distance - 1600) < 1, `distância do circuito: ${r.distance}`);
});

test('2. o trecho de fechamento NÃO é uma linha reta', () => {
  const g = buildGraph(malhaComRamificacoes(), {});
  const r = calcularRotaComParadas(
    g,
    [
      { rotulo: 'A', ...PONTOS.A },
      { rotulo: 'B', ...PONTOS.B },
      { rotulo: 'C', ...PONTOS.C },
      { rotulo: 'D', ...PONTOS.D },
    ],
    { modo: MODOS_ORDEM.USUARIO, circular: true },
  );
  assert.equal(r.ok, true);

  for (const leg of r.legs) {
    const coords = leg.geometry.coordinates;
    assert.ok(coords.length >= 2, 'o trecho tem geometria');
    const doPercurso = comprimento(coords);
    const emLinhaReta = haversine(
      coords[0][0], coords[0][1],
      coords[coords.length - 1][0], coords[coords.length - 1][1],
    );
    // o comprimento desenhado é o do percurso roteado…
    assert.ok(
      Math.abs(doPercurso - leg.distance) < Math.max(1, leg.distance * 0.02),
      `trecho ${leg.de}→${leg.para}: desenho ${doPercurso.toFixed(1)} m ≠ percurso ${leg.distance.toFixed(1)} m`,
    );
    // …e não o da linha reta (quando há diferença real entre os dois)
    if (leg.distance - emLinhaReta > 5) {
      assert.ok(
        doPercurso - emLinhaReta > 5,
        `trecho ${leg.de}→${leg.para} parece uma linha reta`,
      );
    }
  }
});

test('3. o modo otimizado encontra o menor ciclo (conferido com a força bruta)', () => {
  const g = buildGraph(malhaComRamificacoes(), {});
  const pontos = [
    { rotulo: 'A', ...PONTOS.A },
    { rotulo: 'B', ...PONTOS.B },
    { rotulo: 'C', ...PONTOS.C },
    { rotulo: 'D', ...PONTOS.D },
  ];
  const r = calcularRotaComParadas(g, pontos, { modo: MODOS_ORDEM.OTIMIZADA, circular: true });
  assert.equal(r.ok, true);
  assert.equal(r.otimizacao.metodo, 'exato');

  // força bruta: todas as permutações de B, C, D com o fechamento em A
  const { D } = matrizDistancias(g, pontos, {});
  const inter = [1, 2, 3];
  const permutar = (a) =>
    a.length <= 1
      ? [a]
      : a.flatMap((x, i) => permutar(a.slice(0, i).concat(a.slice(i + 1))).map((p) => [x, ...p]));
  let melhor = Infinity;
  for (const p of permutar(inter)) {
    const c = custoDaOrdem(D, p, 0, 0); // fecha em A (índice 0)
    if (c < melhor) melhor = c;
  }
  assert.ok(
    Math.abs(r.otimizacao.custo - melhor) < 1e-6,
    `Held-Karp: ${r.otimizacao.custo}, força bruta: ${melhor}`,
  );
  assert.ok(Math.abs(r.distance - melhor) < 1e-6);
  // o circuito começa e termina na origem
  assert.equal(r.sequencia[0], 'A');
  assert.equal(r.sequenciaCompleta[r.sequenciaCompleta.length - 1], 'A');
});

test('4. no modo do usuário a sequência dos cards é a percorrida', () => {
  const g = buildGraph(malhaComRamificacoes(), {});
  const r = calcularRotaComParadas(
    g,
    [
      { rotulo: 'A', ...PONTOS.A },
      { rotulo: 'B', ...PONTOS.B },
      { rotulo: 'C', ...PONTOS.C },
      { rotulo: 'D', ...PONTOS.D },
    ],
    { modo: MODOS_ORDEM.USUARIO, circular: true },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.sequencia, ['A', 'B', 'C', 'D']);
  assert.deepEqual(r.sequenciaCompleta, ['A', 'B', 'C', 'D', 'A']);
  // os trechos saem na ordem dos cards
  assert.deepEqual(
    r.legs.map((l) => `${l.de}→${l.para}`),
    ['A→B', 'B→C', 'C→D', 'D→A'],
  );
  assert.equal(r.otimizacao, null);
});

test('5. arrastar um card muda a ordem usada no cálculo', () => {
  const g = buildGraph(malhaComRamificacoes(), {});
  const lista = listaCircuito(['A', 'B', 'C', 'D']);
  assert.deepEqual(sequenciaRotulos(lista), ['A', 'B', 'C', 'D']);

  // arrasta a linha de B para depois da linha de C (índice final 2)
  const b = lista.pontos[1];
  const c = lista.pontos[2];
  assert.equal(moverPontoPara(lista, b.id, 2) !== null, true, 'o arrasto deve ter sido aplicado');
  // os rótulos são posicionais (A, B, C, D pela posição); o que muda é o
  // CONTEÚDO das linhas: a parada que era B agora é a 3ª parada
  const ordem = lista.pontos.map(
    (p) => `${p.longitude.toFixed(4)},${p.latitude.toFixed(4)}`,
  );
  assert.equal(ordem[0], `${PONTOS.A.longitude.toFixed(4)},${PONTOS.A.latitude.toFixed(4)}`);
  assert.equal(ordem[1], `${PONTOS.C.longitude.toFixed(4)},${PONTOS.C.latitude.toFixed(4)}`);
  assert.equal(ordem[2], `${PONTOS.B.longitude.toFixed(4)},${PONTOS.B.latitude.toFixed(4)}`);
  assert.equal(ordem[3], `${PONTOS.D.longitude.toFixed(4)},${PONTOS.D.latitude.toFixed(4)}`);
  assert.equal(lista.pontos.indexOf(c), 1, 'C passou a ser a 2ª parada');

  const r = calcularRotaComParadas(
    g,
    lista.pontos.map((p) => ({ rotulo: p.rotulo, latitude: p.latitude, longitude: p.longitude })),
    { modo: MODOS_ORDEM.USUARIO, circular: true },
  );
  assert.equal(r.ok, true);
  // os trechos seguem o novo conteúdo: A → C → B → D → A
  // (500 + 600 + 500 + 400 = 2000)
  assert.ok(Math.abs(r.distance - 2000) < 1, `distância: ${r.distance}`);
  assert.ok(Math.abs(r.legs[0].distance - 500) < 1, `1º trecho: ${r.legs[0].distance}`);
  assert.equal(r.legs[3].de, 'D');
  assert.equal(r.legs[3].para, 'A');
});

test('6. circuito com uma única parada intermediária', () => {
  const g = buildGraph(malhaComRamificacoes(), {});
  const lista = listaCircuito(['A', 'B']);
  assert.equal(podeCalcular(lista).ok, true);
  const r = calcularRotaComParadas(
    g,
    lista.pontos.map((p) => ({ rotulo: p.rotulo, latitude: p.latitude, longitude: p.longitude })),
    { modo: MODOS_ORDEM.USUARIO, circular: true },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.legs.map((l) => `${l.de}→${l.para}`), ['A→B', 'B→A']);
  // ida e volta pela mesma avenida: 300 + 300
  assert.ok(Math.abs(r.distance - 600) < 1, `distância: ${r.distance}`);
});

test('7. somente a origem: informa que faltam paradas', () => {
  const lista = criarListaPontos();
  lista.circuito = true;
  adicionarPonto(lista, { latitude: PONTOS.A.latitude, longitude: PONTOS.A.longitude });
  const v = podeCalcular(lista);
  assert.equal(v.ok, false);
  assert.equal(v.motivo, 'PONTOS_INSUFICIENTES');
  assert.ok(/parada/i.test(v.mensagem), v.mensagem);
});

test('8. endereço/coordenada inválida impede o cálculo', () => {
  const g = buildGraph(malhaComRamificacoes(), {});
  const r = calcularRotaComParadas(
    g,
    [
      { rotulo: 'A', ...PONTOS.A },
      { rotulo: 'B', latitude: null, longitude: null },
    ],
    { modo: MODOS_ORDEM.USUARIO, circular: true },
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'COORDENADA_INVALIDA');
  // a lista com um ponto sem coordenada também é recusada antes do cálculo
  const lista = listaCircuito(['A', 'B', 'C']);
  lista.pontos[1].latitude = null;
  assert.equal(podeCalcular(lista).ok, false);
});

test('9. pontos coincidentes não quebram o cálculo', () => {
  const g = buildGraph(malhaComRamificacoes(), {});
  const r = calcularRotaComParadas(
    g,
    [
      { rotulo: 'A', ...PONTOS.A },
      { rotulo: 'B', ...PONTOS.A }, // mesma coordenada de A
      { rotulo: 'C', ...PONTOS.C },
    ],
    { modo: MODOS_ORDEM.USUARIO, circular: true },
  );
  // pode falhar (o ponto coincide com a origem) — mas nunca com crash,
  // e a resposta explica o que houve
  if (!r.ok) {
    assert.ok(r.message.length > 0);
    assert.equal(r.parcial, true);
  } else {
    assert.equal(r.legs.length, 3);
    assert.ok(r.distance >= 0);
  }
});

test('10. ausência de caminho entre dois pontos é informada (inclusive no retorno)', () => {
  const g = buildGraph(
    [
      eixoReto(1, 0, 0, 200, 0, 'RUA ISOLADA'),
      eixoReto(2, 1000, 1000, 1200, 1000, 'OUTRA RUA ISOLADA'),
    ],
    {},
  );
  const r = calcularRotaComParadas(
    g,
    [
      { rotulo: 'A', ...asLatLon(0, 0) },
      { rotulo: 'B', ...asLatLon(200, 0) },
      { rotulo: 'C', ...asLatLon(1100, 1000) },
    ],
    { modo: MODOS_ORDEM.USUARIO, circular: true },
  );
  assert.equal(r.ok, false, 'não pode apresentar um circuito parcial como completo');
  assert.equal(r.reason, 'TRECHO_SEM_CAMINHO');
  assert.ok(r.message.includes('→'), r.message);
  assert.equal(r.parcial, true);
  assert.ok(r.falha);
});

test('11. no modo otimizado, pontos sem conexão são recusados', () => {
  const g = buildGraph(
    [
      eixoReto(1, 0, 0, 200, 0, 'RUA ISOLADA'),
      eixoReto(2, 1000, 1000, 1200, 1000, 'OUTRA RUA ISOLADA'),
    ],
    {},
  );
  const r = calcularRotaComParadas(
    g,
    [
      { rotulo: 'A', ...asLatLon(0, 0) },
      { rotulo: 'B', ...asLatLon(200, 0) },
      { rotulo: 'C', ...asLatLon(1100, 1000) },
    ],
    { modo: MODOS_ORDEM.OTIMIZADA, circular: true },
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PONTOS_SEM_CONEXAO');
  assert.ok(Array.isArray(r.semCaminho));
});

test('12. a lista em modo circuito não tem card de destino', () => {
  const lista = listaCircuito(['A', 'B', 'C', 'D']);
  assert.equal(lista.pontos[0].tipo, 'origem');
  assert.equal(lista.pontos[3].tipo, 'parada', 'o último card é parada, não destino');
  assert.equal(contarParadas(lista), 3);
  // e o número de paradas no modo comum continua sendo n-2
  const comum = criarListaPontos();
  adicionarPonto(comum, {});
  adicionarPonto(comum, {});
  adicionarPonto(comum, {});
  assert.equal(contarParadas(comum), 1);
});

test('13. Held-Karp em ciclo: o custo inclui o fechamento', () => {
  const g = buildGraph(malhaComRamificacoes(), {});
  const pontos = [
    { rotulo: 'A', ...PONTOS.A },
    { rotulo: 'B', ...PONTOS.B },
    { rotulo: 'C', ...PONTOS.C },
  ];
  const { D } = matrizDistancias(g, pontos, {});
  const r = heldKarp(D, [1, 2], 0, 0);
  // A→B→C→A = 300 + 600 + 500 = 1400 ; A→C→B→A = 500 + 600 + 300 = 1400
  assert.ok(Math.abs(r.custo - 1400) < 1e-6, `custo: ${r.custo}`);
  assert.equal(r.ordem.length, 2);
});
