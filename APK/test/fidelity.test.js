/**
 * TESTES DE FIDELIDADE GEOMÃ‰TRICA DA ROTA
 * ========================================
 *
 * O motor tem de percorrer a MALHA, nÃ£o uma aproximaÃ§Ã£o dela. Estes testes
 * verificam, com geometrias conhecidas e curvas de verdade:
 *
 *  1. rota com vÃ¡rias curvas â€” todos os vÃ©rtices originais sobrevivem;
 *  2. rota com vÃ¡rios eixos consecutivos;
 *  3. aresta percorrida no sentido INVERSO â€” a geometria Ã© invertida por
 *     completo, nÃ£o apenas os extremos;
 *  4. rota que passa por uma interseÃ§Ã£o;
 *  5. rota com trechos oficiais e nÃ£o oficiais;
 *  6. continuidade geomÃ©trica entre todas as arestas da rota;
 *  7. a geometria devolvida Ã© a CONCATENAÃ‡ÃƒO das geometrias originais
 *     percorridas, e a distÃ¢ncia Ã© a soma dos comprimentos.
 *
 * O defeito que estes testes cobrem: ao dividir uma aresta pela origem ou
 * pelo destino, o motor guardava sÃ³ os dois extremos do trecho â€” a curva
 * virava uma reta e a rota saÃ­a da rua (desvios de atÃ© 35 m foram
 * medidos na rede real).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGraph } from '../src/core/graph.js';
import { routeOnGraph } from '../src/core/router.js';
import { project, unproject, dist, haversine } from '../src/core/geo.js';
import { feature, official, unofficial, loadRealFeatures } from './helpers.js';

const BASE = [-46.545, -23.66];
const M_PER_DEG_LON = 101990;
const M_PER_DEG_LAT = 110574;
const mLon = 1 / M_PER_DEG_LON;
const mLat = 1 / M_PER_DEG_LAT;

/** Converte um ponto mÃ©trico (x, y) em [lon, lat]. */
function lonLat(x, y) {
  const [lon, lat] = unproject(x, y);
  return [lon, lat];
}

// Referencial local: (0,0) Ã© o ponto BASE projetado, para que as geometrias
// sintÃ©ticas fiquem em Santo AndrÃ© (e nÃ£o na origem do UTM).
const [BX, BY] = project(BASE[0], BASE[1]);
/** Ponto a (dx, dy) metros do BASE, em [lon, lat]. */
function ponto(dx, dy) {
  return lonLat(BX + dx, BY + dy);
}

/** Converte [lon, lat] no formato {lon, lat} exigido pela API do motor. */
function asPoint(p) {
  return { lon: p[0], lat: p[1] };
}

/**
 * Eixo em curva: uma polilinha que desvia lateralmente e volta (uma "S").
 * @param {number} comprimento_metros extensÃ£o total aproximada
 * @param {number} amplitude amplitude lateral em metros
 * @param {number} passos nÃºmero de vÃ©rtices
 */
function eixoEmCurva(deslocamentoX, deslocamentoY, comprimento, amplitude, passos) {
  const coords = [];
  for (let i = 0; i <= passos; i++) {
    const t = i / passos;
    const x = deslocamentoX + comprimento * t;
    // desvio lateral: comeÃ§a e termina em zero, com uma barriga no meio
    const y = deslocamentoY + amplitude * Math.sin(Math.PI * t);
    coords.push(ponto(x, y));
  }
  return coords;
}

/**
 * DistÃ¢ncia de um ponto (lon/lat) atÃ© a POLILINHA de um eixo (nÃ£o apenas
 * atÃ© os seus vÃ©rtices: um corte no meio de um trecho tambÃ©m estÃ¡ sobre o
 * eixo).
 */
function distanciaAoEixo(anel, lon, lat) {
  let melhor = Infinity;
  for (let i = 1; i < anel.length; i++) {
    const [x1, y1] = project(anel[i - 1][0], anel[i - 1][1]);
    const [x2, y2] = project(anel[i][0], anel[i][1]);
    const [px, py] = project(lon, lat);
    const vx = x2 - x1;
    const vy = y2 - y1;
    const vv = vx * vx + vy * vy;
    let t = vv > 0 ? ((px - x1) * vx + (py - y1) * vy) / vv : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const d = Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t));
    if (d < melhor) melhor = d;
  }
  return melhor;
}

/** Comprimento mÃ©trico de uma polilinha em lon/lat. */
function comprimentoMetrico(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = project(coords[i - 1][0], coords[i - 1][1]);
    const [x2, y2] = project(coords[i][0], coords[i][1]);
    total += dist(x1, y1, x2, y2);
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* 1. ROTA COM VÃRIAS CURVAS                                            */
/* ------------------------------------------------------------------ */

test('rota com vÃ¡rias curvas preserva TODOS os vÃ©rtices do eixo original', () => {
  const curva = eixoEmCurva(0, 0, 300, 40, 12);
  const g = buildGraph([feature(official(1, 'RUA EM CURVA'), curva)]);

  // origem e destino dentro da curva (forÃ§am a divisÃ£o da aresta)
  const origem = { lon: curva[2][0], lat: curva[2][1] };
  const destino = { lon: curva[10][0], lat: curva[10][1] };

  const r = routeOnGraph(g, origem, destino);
  assert.equal(r.ok, true, r.message);

  // 1) a geometria devolvida tem MAIS vÃ©rtices que 2 (nÃ£o Ã© uma reta)
  assert.ok(
    r.geometry.coordinates.length >= 8,
    `a geometria deveria manter a curva, veio com ${r.geometry.coordinates.length} vÃ©rtices`
  );

  // 2) cada vÃ©rtice intermediÃ¡rio do eixo original estÃ¡ na rota
  for (let i = 2; i <= 10; i++) {
    const alvo = curva[i];
    const achou = r.geometry.coordinates.some(
      (c) => haversine(c[0], c[1], alvo[0], alvo[1]) < 0.5
    );
    assert.ok(achou, `o vÃ©rtice ${i} da curva sumiu da rota`);
  }

  // 3) a distÃ¢ncia Ã© a soma dos comprimentos (nada de "cortar a curva")
  const geod = comprimentoMetrico(r.geometry.coordinates);
  assert.ok(
    Math.abs(geod - r.distance) < 1,
    `geometria (${geod.toFixed(1)} m) e rota (${r.distance.toFixed(1)} m) devem bater`
  );
  // o comprimento real da curva Ã© MAIOR que a corda (a reta)
  const corda = comprimentoMetrico([curva[2], curva[10]]);
  assert.ok(r.distance > corda, 'a rota deve seguir a curva, nÃ£o a corda');
});

/* ------------------------------------------------------------------ */
/* 2. VÃRIOS EIXOS CONSECUTIVOS                                         */
/* ------------------------------------------------------------------ */

test('rota com vÃ¡rios eixos consecutivos concatena as geometrias', () => {
  const eixos = [
    feature(official(1, 'RUA A'), [ponto(0, 0), ponto(100, 0)]),
    feature(official(2, 'RUA B'), [ponto(100, 0), ponto(200, 30), ponto(300, 30)]),
    feature(official(3, 'RUA C'), [ponto(300, 30), ponto(400, 30)]),
  ];
  const g = buildGraph(eixos);

  const r = routeOnGraph(g, asPoint(ponto(20, 0)), asPoint(ponto(380, 30)));
  assert.equal(r.ok, true, r.message);

  const nomes = r.legs.map((l) => l.street);
  assert.deepEqual(nomes, ['RUA A', 'RUA B', 'RUA C'], 'deve percorrer os trÃªs eixos');

  // a geometria tem os vÃ©rtices da RUA B (o "cotovelo" de 100,30)
  const cotovelo = ponto(200, 30);
  assert.ok(
    r.geometry.coordinates.some((c) => haversine(c[0], c[1], cotovelo[0], cotovelo[1]) < 0.5),
    'o vÃ©rtice intermediÃ¡rio da RUA B sumiu'
  );

  // soma dos trechos = distÃ¢ncia
  const soma = r.legs.reduce((s, l) => s + l.length, 0);
  assert.ok(Math.abs(soma - r.distance) < 1e-6);
});

/* ------------------------------------------------------------------ */
/* 3. SENTIDO INVERSO                                                   */
/* ------------------------------------------------------------------ */

test('aresta percorrida ao contrÃ¡rio tem a geometria inteira invertida', () => {
  // eixo que "sobe" do sul para o norte, com um desvio no meio
  const coords = [ponto(0, 0), ponto(0, 60), ponto(25, 90), ponto(0, 120)];
  const g = buildGraph([feature(official(1, 'RUA EM ZIGUE'), coords)]);

  // origem no NORTE, destino no SUL: a aresta Ã© percorrida ao contrÃ¡rio
  const origem = ponto(0, 110);
  const destino = ponto(0, 10);
  const r = routeOnGraph(g, asPoint(origem), asPoint(destino));
  assert.equal(r.ok, true, r.message);

  // a rota comeÃ§a na origem projetada e termina no destino projetada
  const primeiro = r.geometry.coordinates[0];
  assert.ok(
    haversine(primeiro[0], primeiro[1], r.origin.snapped.lon, r.origin.snapped.lat) < 0.2,
    'a rota deve comeÃ§ar na origem projetada'
  );
  const ultimo = r.geometry.coordinates[r.geometry.coordinates.length - 1];
  assert.ok(
    haversine(ultimo[0], ultimo[1], r.destination.snapped.lon, r.destination.snapped.lat) < 0.2,
    'a rota deve terminar no destino projetado'
  );

  // os vÃ©rtices do eixo existentes entre a origem e o destino aparecem na
  // ordem INVERSA (o eixo foi percorrido ao contrÃ¡rio)
  const internos = [coords[2], coords[1]]; // (25,90) e (0,60)
  let anterior = -1;
  for (const alvo of internos) {
    const i = r.geometry.coordinates.findIndex(
      (c) => haversine(c[0], c[1], alvo[0], alvo[1]) < 0.5
    );
    assert.ok(i > anterior, `vÃ©rtice ${alvo} fora de lugar na ordem inversa`);
    anterior = i;
  }

  // e a distÃ¢ncia Ã© a do eixo (nÃ£o a da corda)
  const esperado = comprimentoMetrico([
    origem,
    coords[2],
    coords[1],
    destino,
  ]);
  assert.ok(Math.abs(r.distance - esperado) < 1.5, `distÃ¢ncia ${r.distance} vs ${esperado}`);
});

/* ------------------------------------------------------------------ */
/* 4. ROTA QUE PASSA POR UMA INTERSEÃ‡ÃƒO                                 */
/* ------------------------------------------------------------------ */

test('rota que passa por uma interseÃ§Ã£o entra e sai pela mesma coordenada', () => {
  const cruzamento = ponto(100, 100);
  const g = buildGraph([
    feature(official(1, 'RUA HORIZONTAL'), [ponto(0, 100), cruzamento, ponto(200, 100)]),
    feature(official(2, 'RUA VERTICAL'), [ponto(100, 0), cruzamento, ponto(100, 200)]),
  ]);

  const r = routeOnGraph(g, asPoint(ponto(20, 100)), asPoint(ponto(100, 180)));
  assert.equal(r.ok, true, r.message);

  // o trajeto passa exatamente pelo ponto do cruzamento
  const passou = r.geometry.coordinates.some(
    (c) => haversine(c[0], c[1], cruzamento[0], cruzamento[1]) < 0.5
  );
  assert.ok(passou, 'a rota nÃ£o passou pelo cruzamento');

  // e a emenda entre as duas pernas Ã© contÃ­nua
  const a = r.legs[0].coords;
  const b = r.legs[1].coords;
  const d = haversine(a[a.length - 1][0], a[a.length - 1][1], b[0][0], b[0][1]);
  assert.ok(d < 0.05, `emenda de ${d.toFixed(3)} m entre as pernas`);
});

/* ------------------------------------------------------------------ */
/* 5. OFICIAL + NÃƒO OFICIAL                                             */
/* ------------------------------------------------------------------ */

test('rota com trechos oficiais e nÃ£o oficiais preserva a geometria dos dois', () => {
  const oficial = [ponto(0, 0), ponto(80, 0), ponto(160, 0)];
  const naoOficial = [ponto(160, 0), ponto(240, 40)];
  const g = buildGraph([
    feature(official(1, 'RUA OFICIAL'), oficial),
    feature(unofficial(2, 'RUA NÃƒO OFICIALIZADA'), naoOficial),
  ]);

  const r = routeOnGraph(g, asPoint(ponto(10, 0)), asPoint(ponto(230, 36)));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.legs.length, 2);
  assert.equal(r.legs[0].official, true);
  assert.equal(r.legs[1].official, false);
  assert.equal(r.legs[1].street, 'RUA NÃƒO OFICIALIZADA');

  // a geometria da perna nÃ£o oficializada Ã© a do eixo, nÃ£o uma reta
  const vertices = r.legs[1].coords.length;
  assert.ok(vertices >= 2);
  const soma = r.legs.reduce((s, l) => s + l.length, 0);
  assert.ok(Math.abs(soma - r.distance) < 1e-6);
});

/* ------------------------------------------------------------------ */
/* 6. CONTINUIDADE GEOMÃ‰TRICA                                           */
/* ------------------------------------------------------------------ */

test('a rota Ã© contÃ­nua: o fim de cada aresta coincide com o inÃ­cio da prÃ³xima', () => {
  const features = loadRealFeatures();
  const g = buildGraph(features);

  const r = routeOnGraph(g, { lon: -46.50056063, lat: -23.68601305 }, { lon: -46.49834053, lat: -23.68437522 });
  assert.equal(r.ok, true, r.message);

  // 1) as pernas se emendam
  for (let i = 1; i < r.legs.length; i++) {
    const a = r.legs[i - 1].coords;
    const b = r.legs[i].coords;
    const d = haversine(a[a.length - 1][0], a[a.length - 1][1], b[0][0], b[0][1]);
    assert.ok(d < 0.05, `emenda ${i} de ${d.toFixed(3)} m`);
  }

  // 2) a geometria Ã© a concatenaÃ§Ã£o das pernas: nenhum vÃ©rtice some e
  //    nenhuma coordenada se repete (a rota nÃ£o "dÃ¡ saltos")
  const c = r.geometry.coordinates;
  for (let i = 1; i < c.length; i++) {
    const d = haversine(c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]);
    assert.ok(d > 0, 'a geometria tem coordenadas duplicadas');
  }
  // a geometria contÃ©m TODOS os vÃ©rtices das pernas, na ordem
  let i = 0;
  for (const perna of r.legs) {
    for (const v of perna.coords) {
      let achou = false;
      // a busca comeÃ§a em `i` (o ponto de junÃ§Ã£o Ã© compartilhado pelas duas
      // pernas: o mesmo vÃ©rtice pode aparecer duas vezes, uma no fim de uma
      // perna e outra no comeÃ§o da seguinte)
      for (let k = i; k < c.length; k++) {
        if (haversine(c[k][0], c[k][1], v[0], v[1]) < 0.02) {
          i = k;
          achou = true;
          break;
        }
      }
      assert.ok(achou, `vÃ©rtice ${v} da perna "${perna.street}" nÃ£o estÃ¡ na geometria`);
    }
  }

  // 3) a soma das pernas bate com a distÃ¢ncia e com o comprimento da linha
  const soma = r.legs.reduce((s, l) => s + l.length, 0);
  assert.ok(Math.abs(soma - r.distance) < 1e-6, 'soma das pernas â‰  distÃ¢ncia');
  const geod = comprimentoMetrico(c);
  assert.ok(
    Math.abs(geod - r.distance) < 1.5,
    `comprimento da geometria (${geod.toFixed(1)}) â‰  distÃ¢ncia (${r.distance.toFixed(1)})`
  );
});

/* ------------------------------------------------------------------ */
/* 7. A GEOMETRIA Ã‰ A CONCATENAÃ‡ÃƒO DAS GEOMETRIAS ORIGINAIS              */
/* ------------------------------------------------------------------ */

test('a geometria da rota Ã© a concatenaÃ§Ã£o das geometrias originais percorridas', () => {
  const features = loadRealFeatures();
  const g = buildGraph(features);

  // rota entre dois pontos que ficam no meio de eixos (gera divisÃ£o)
  const r = routeOnGraph(
    g,
    { lon: -46.50056063, lat: -23.68601305 },
    { lon: -46.49834053, lat: -23.68437522 }
  );
  assert.equal(r.ok, true, r.message);

  // para cada perna, os vÃ©rtices devem pertencer ao eixo original
  // cada feature pode ter VÃRIOS anÃ©is (MultiLineString): todos contam
  const aneisPorFeature = new Map();
  for (const f of features) {
    const g2 = f.geometry;
    const aneis =
      g2.type === 'LineString' ? [g2.coordinates] : g2.type === 'MultiLineString' ? g2.coordinates : [];
    const lista = aneisPorFeature.get(f.properties.ID) || [];
    lista.push(...aneis);
    aneisPorFeature.set(f.properties.ID, lista);
  }

  for (const perna of r.legs) {
    const aneis = aneisPorFeature.get(perna.featureId);
    if (!aneis) continue; // conector de junÃ§Ã£o (nÃ£o tem eixo original)
    for (const c of perna.coords) {
      // o vÃ©rtice da rota estÃ¡ SOBRE o eixo original (a geometria nÃ£o Ã© movida)
      const perto = aneis.some((anel) => distanciaAoEixo(anel, c[0], c[1]) < 0.02);
      assert.ok(
        perto,
        `vÃ©rtice ${c} da perna "${perna.street}" nÃ£o estÃ¡ sobre o eixo original`
      );
    }
  }
});

/* ------------------------------------------------------------------ */
/* 8. REGRESSÃƒO: O DEFÐ•ITO ORIGINAL                                     */
/* ------------------------------------------------------------------ */

test('REGRESSÃƒO: dividir a aresta pela origem nÃ£o pode virar uma reta', () => {
  // curva fechada (cÃ­rculo) â€” a corda entre dois pontos Ã© muito menor
  const circulo = [];
  const raio = 80;
  for (let i = 0; i <= 24; i++) {
    const ang = (i / 24) * Math.PI * 2;
    circulo.push(ponto(raio * Math.cos(ang), raio * Math.sin(ang)));
  }
  const g = buildGraph([feature(official(1, 'RUA EM CIRCULO'), circulo)]);

  // origem e destino em lados opostos: a rota tem de contornar a curva
  const origem = ponto(raio, 0);
  const destino = ponto(-raio, 0);
  const r = routeOnGraph(g, asPoint(origem), asPoint(destino));
  assert.equal(r.ok, true, r.message);

  const geod = comprimentoMetrico(r.geometry.coordinates);
  const linhaReta = comprimentoMetrico([origem, destino]);
  const meiaVolta = Math.PI * raio; // caminho contornando o cÃ­rculo
  assert.ok(
    Math.abs(geod - meiaVolta) < 5,
    `a rota (${geod.toFixed(1)} m) deveria contornar meia volta do cÃ­rculo (${meiaVolta.toFixed(1)} m)`
  );
  assert.ok(
    geod > linhaReta * 1.4,
    `a rota (${geod.toFixed(1)} m) nÃ£o pode ser a corda (${linhaReta.toFixed(1)} m)`
  );
  assert.ok(
    Math.abs(geod - r.distance) < 1.5,
    'a distÃ¢ncia deve bater com o comprimento real da geometria'
  );
});

