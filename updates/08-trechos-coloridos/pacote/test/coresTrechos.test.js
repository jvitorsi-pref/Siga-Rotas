/**
 * TESTES — CORES POR TRECHO DA ROTA
 * ======================================================================
 *
 *  1. a paleta tem cores distintas e bem formadas;
 *  2. **trechos adjacentes têm cores diferentes** (regra principal);
 *  3. quando a paleta se esgota, a reutilização é **organizada** (percorre a
 *     paleta em ciclo) e **nunca** repete a cor do trecho anterior;
 *  4. a atribuição é **determinística** (mesma sequência ⇒ mesmas cores) e
 *     independente do modo de roteamento;
 *  5. a cor representa o **trecho**, não a posição da parada: a cor muda de
 *     lugar quando a sequência muda, mas acompanha o trecho na legenda;
 *  6. o desenho no mapa usa uma cor por trecho, inclusive o **retorno à
 *     origem**, e a rota continua contínua (sem geometria antiga).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PALETA_TRECHOS,
  TOTAL_CORES,
  coresDosTrechos,
  colorirTrechos,
  corPorIndice,
} from '../core/coresTrechos.js';
import { calcularRotaComParadas, MODOS_ORDEM } from '../core/rotaParadas.js';
import { buildGraph } from '../core/graph.js';
import { project, unproject } from '../core/geo.js';
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

/** Malha em anel: A → B → C → D → A (400 m cada lado). */
function anel() {
  return [
    eixoReto(1, 0, 0, 400, 0, 'AVENIDA PRINCIPAL'),
    eixoReto(2, 400, 0, 400, 400, 'RUA LESTE'),
    eixoReto(3, 400, 400, 0, 400, 'AVENIDA NORTE'),
    eixoReto(4, 0, 400, 0, 0, 'RUA OESTE'),
  ];
}

const PONTOS = {
  A: asLatLon(0, 0),
  B: asLatLon(400, 0),
  C: asLatLon(400, 400),
  D: asLatLon(0, 400),
};

/* ================================================================== */

test('1. a paleta tem cores distintas e bem formadas', () => {
  assert.ok(PALETA_TRECHOS.length >= 8, 'a paleta precisa ter cores suficientes');
  assert.equal(new Set(PALETA_TRECHOS).size, PALETA_TRECHOS.length, 'cores repetidas');
  for (const c of PALETA_TRECHOS) {
    assert.match(c, /^#[0-9a-f]{6}$/i, `cor fora do formato: ${c}`);
  }
  assert.equal(TOTAL_CORES, PALETA_TRECHOS.length);
});

test('2. trechos adjacentes têm cores diferentes', () => {
  for (const n of [2, 3, 5, 12, 13, 40, 100]) {
    const cores = coresDosTrechos(new Array(n).fill({}));
    assert.equal(cores.length, n);
    for (let i = 1; i < n; i++) {
      assert.notEqual(
        cores[i],
        cores[i - 1],
        `trechos ${i - 1} e ${i} têm a mesma cor (${cores[i]}) com ${n} trechos`,
      );
    }
  }
});

test('3. paleta esgotada: a reutilização é organizada e não repete a cor vizinha', () => {
  const n = TOTAL_CORES * 3;
  const cores = coresDosTrechos(new Array(n).fill({}));
  // a primeira volta da paleta é exatamente a paleta
  assert.deepEqual(cores.slice(0, TOTAL_CORES), PALETA_TRECHOS);
  // ...e as voltas seguintes também percorrem a paleta em ciclo
  assert.deepEqual(cores.slice(TOTAL_CORES, TOTAL_CORES * 2), PALETA_TRECHOS);
  // nenhuma cor é repetida em trechos vizinhos
  for (let i = 1; i < n; i++) assert.notEqual(cores[i], cores[i - 1]);
  // ...e a palette não é "embaralhada": a ordem é previsível
  assert.equal(corPorIndice(TOTAL_CORES), PALETA_TRECHOS[0]);
  assert.equal(corPorIndice(TOTAL_CORES + 1), PALETA_TRECHOS[1]);
});

test('4. a atribuição é determinística e independe do modo de roteamento', () => {
  const g = buildGraph(anel(), {});
  const pontos = [
    { rotulo: 'A', ...PONTOS.A },
    { rotulo: 'B', ...PONTOS.B },
    { rotulo: 'C', ...PONTOS.C },
    { rotulo: 'D', ...PONTOS.D },
  ];
  const usuario = calcularRotaComParadas(g, pontos, {
    modo: MODOS_ORDEM.USUARIO,
    circular: true,
  });
  const otimizada = calcularRotaComParadas(g, pontos, {
    modo: MODOS_ORDEM.OTIMIZADA,
    circular: true,
  });
  // as cores são sempre as da paleta, na ordem dos trechos
  for (const r of [usuario, otimizada]) {
    for (let i = 0; i < r.legs.length; i++) {
      assert.equal(r.legs[i].cor, PALETA_TRECHOS[i % PALETA_TRECHOS.length]);
    }
  }
  // a mesma sequência ⇒ as mesmas cores (rodar duas vezes não muda nada)
  const outra = coresDosTrechos(usuario.legs);
  assert.deepEqual(outra, coresDosTrechos(usuario.legs));
  assert.deepEqual(outra, coresDosTrechos([...usuario.legs]));
});

test('5. a cor representa o trecho, não a posição da parada', () => {
  const coloridos = colorirTrechos([
    { de: 'A', para: 'B' },
    { de: 'B', para: 'C' },
    { de: 'C', para: 'D' },
  ]);
  assert.equal(coloridos.length, 3);
  assert.equal(coloridos[0].de, 'A');
  assert.equal(coloridos[0].cor, PALETA_TRECHOS[0]);
  assert.equal(coloridos[1].cor, PALETA_TRECHOS[1]);
  assert.equal(coloridos[2].cor, PALETA_TRECHOS[2]);
  // o índice do trecho acompanha a cor (é o que a legenda mostra)
  assert.deepEqual(coloridos.map((c) => c.indice), [0, 1, 2]);
});

test('6. o retorno à origem tem a sua própria cor e a rota continua contínua', () => {
  const g = buildGraph(anel(), {});
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
  assert.equal(r.legs.length, 4);

  // cada trecho tem cor e as cores vizinhas são diferentes
  const cores = r.legs.map((l) => l.cor);
  assert.equal(new Set(cores).size, 4, 'cores distintas por trecho');
  for (let i = 1; i < cores.length; i++) assert.notEqual(cores[i], cores[i - 1]);

  // o retorno é o último trecho e tem cor própria
  const ultimo = r.legs[3];
  assert.equal(ultimo.retorno, true);
  assert.equal(ultimo.de, 'D');
  assert.equal(ultimo.para, 'A');
  assert.equal(ultimo.cor, PALETA_TRECHOS[3]);
  assert.equal(r.retorno.cor, ultimo.cor);

  // a rota é contínua: a geometria concatenada tem todos os vértices dos
  // trechos, na ordem, sem buracos
  const coords = r.geometry.coordinates;
  let total = 0;
  for (const leg of r.legs) total += leg.geometry.coordinates.length;
  assert.ok(
    coords.length <= total,
    'a geometria concatenada não pode ter mais vértices que os trechos',
  );
  // o último vértice da geometria é o ponto de chegada (a origem)
  const ultimoTrecho = r.legs[3].geometry.coordinates;
  const fimTrecho = ultimoTrecho[ultimoTrecho.length - 1];
  const fimRota = coords[coords.length - 1];
  assert.ok(Math.abs(fimTrecho[0] - fimRota[0]) < 1e-9);
  assert.ok(Math.abs(fimTrecho[1] - fimRota[1]) < 1e-9);
});

test('7. a quantidade de paradas é dinâmica: o circuito aceita quantas paradas forem pedidas', () => {
  const g = buildGraph(anel(), {});
  // 8 paradas em volta do anel (A + 7 pontos) ⇒ 8 trechos
  const pontos = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    pontos.push({
      rotulo: String.fromCharCode(65 + i),
      ...asLatLon(200 + 200 * Math.cos(ang), 200 + 200 * Math.sin(ang)),
    });
  }
  const r = calcularRotaComParadas(g, pontos, {
    modo: MODOS_ORDEM.USUARIO,
    circular: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.legs.length, 8, '8 pontos no circuito ⇒ 8 trechos (incluindo o retorno)');
  assert.equal(r.paradas, 7, '7 paradas intermediárias');
  assert.equal(r.legs[7].retorno, true);
  // todas as cores vizinhas são diferentes
  const cores = r.legs.map((l) => l.cor);
  for (let i = 1; i < cores.length; i++) assert.notEqual(cores[i], cores[i - 1]);
});
