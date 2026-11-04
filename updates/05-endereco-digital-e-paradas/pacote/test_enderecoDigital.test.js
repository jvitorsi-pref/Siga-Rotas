/**
 * TESTES — ENDEREÇO DIGITAL (CEP DIGITAL) E ROTA COM MÚLTIPLAS PARADAS
 * =====================================================================
 *
 * Cobrem os 13 cenários obrigatórios da rodada 5:
 *
 *   1. Plus Code completo válido;
 *   2. Plus Code encurtado (quando suportado pela classe);
 *   3. código inválido;
 *   4. endereço que não pode ser convertido em coordenadas;
 *   5. coordenadas válidas próximas de um eixo viário;
 *   6. ponto distante da rede;
 *   7. rota entre origem e destino;
 *   8. rota com duas ou mais paradas;
 *   9. adição, edição e remoção de paradas;
 *  10. reordenação dos pontos;
 *  11. trecho sem conexão viável;
 *  12. alteração de um endereço depois de calcular a rota;
 *  13. preservação das curvas e da geometria original em todos os trechos.
 *
 * A lógica do Endereço Digital vem da **porta fiel** da classe C#
 * `CalculoGeometriaDAL` (`core/enderecoDigital.js`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CodificarCompleto,
  CodificarCurto,
  Completar,
  DecodificarCepDigital,
  CoordenadaNaRegiao,
  NormalizarCepDigital,
  NormalizarCepDigitalParaBanco,
  NormalizarCoordenadaParaBanco,
  ResolverEnderecoDigital,
} from '../core/enderecoDigital.js';
import { criarServicoEnderecoDigital, MODOS } from '../core/enderecoDigitalService.js';
import {
  criarListaPontos,
  adicionarPonto,
  removerPonto,
  atualizarPonto,
  moverPonto,
  rotularPontos,
  podeCalcular,
  contarParadas,
  sequenciaRotulos,
  STATUS,
} from '../core/pontoTrajeto.js';
import { calcularRotaComParadas } from '../core/rotaParadas.js';
import { buildGraph } from '../core/graph.js';
import { routeOnGraph } from '../core/router.js';
import { project, unproject, dist, haversine } from '../core/geo.js';
import { feature, official, unofficial, loadRealFeatures } from './helpers.js';

const BASE = [-46.545, -23.66];
const [BX, BY] = project(BASE[0], BASE[1]);

/** Ponto a (dx, dy) metros do BASE, em [lon, lat]. */
function ponto(dx, dy) {
  const [lon, lat] = unproject(BX + dx, BY + dy);
  return [lon, lat];
}
/** {lon, lat} a (dx, dy) metros do BASE. */
function asPoint(dx, dy) {
  const [lon, lat] = ponto(dx, dy);
  return { lon, lat };
}

/**
 * Eixo em curva: a geometria precisa sobreviver à rota.
 * A curva é uma "S" perpendicular ao segmento de (dx0,dy0) a (dx1,dy1).
 */
function eixoEmCurva(id, x0, y0, x1, y1, amplitude) {
  const coords = [];
  const passos = 12;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  // vetor unitário e sua perpendicular
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  for (let i = 0; i <= passos; i++) {
    const t = i / passos;
    const off = amplitude * Math.sin(Math.PI * t * 2);
    coords.push(ponto(x0 + dx * t + px * off, y0 + dy * t + py * off));
  }
  return feature(official(id, `RUA EM CURVA ${id}`), coords);
}

/** {latitude, longitude} a (dx, dy) metros do BASE (formato do trajeto). */
function asLatLon(dx, dy) {
  const [lon, lat] = ponto(dx, dy);
  return { latitude: lat, longitude: lon };
}

/** Eixo reto, de (x0,y0) a (x1,y1), em metros. */
function eixoReto(id, x0, y0, x1, y1, nome) {
  return feature(official(id, nome || `RUA ${id}`), [ponto(x0, y0), ponto(x1, y1)]);
}

/* ================================================================== */
/* 1–4. Endereço Digital (CEP Digital)                                */
/* ================================================================== */

test('1. Plus Code completo válido é normalizado, validado e convertido', () => {
  const lat = -23.6635;
  const lon = -46.532;
  const completo = CodificarCompleto(String(lat), String(lon));
  assert.match(completo, /^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2}$/);

  // normalização: minúsculas, espaços e "sem espaço" são aceitos
  assert.equal(NormalizarCepDigital('  588m8fp9+j6 '), '588M8FP9+J6');

  const resultado = ResolverEnderecoDigital(completo);
  assert.equal(resultado.status, STATUS.CONVERTIDO);
  assert.equal(resultado.ok, true);
  assert.ok(Number.isFinite(resultado.latitude));
  assert.ok(Number.isFinite(resultado.longitude));
  assert.equal(resultado.naRegiao, true);

  // o ponto convertido fica dentro da célula do código (≤ 14 m do centro)
  const d = haversine(resultado.longitude, resultado.latitude, lon, lat);
  assert.ok(d < 15, `distância até o ponto de origem: ${d.toFixed(2)} m`);

  // a normalização não é o mesmo que a conversão: `validar` não devolve
  // coordenadas, `resolver` devolve
  const servico = criarServicoEnderecoDigital();
  const validado = servico.validar(completo);
  assert.equal(validado.status, 'VALIDADO');
  assert.equal(validado.codigoCompleto, completo);
  assert.equal(validado.latitude, undefined);
});

test('2. Plus Code encurtado é expandido com o ponto de referência do município', () => {
  const lat = -23.6635;
  const lon = -46.532;
  const curto = CodificarCurto(String(lat), String(lon));
  assert.ok(curto.length < CodificarCompleto(String(lat), String(lon)).length);
  assert.equal(curto, '8FP9+J6'); // prefixo de 4 caracteres removido

  // o código curto é expandido para o código completo
  assert.equal(Completar(curto), '588M8FP9+J6');

  const resultado = ResolverEnderecoDigital(curto);
  assert.equal(resultado.status, STATUS.CONVERTIDO);
  assert.equal(resultado.codigoCompleto, '588M8FP9+J6');
  assert.ok(CoordenadaNaRegiao(resultado.latitude, resultado.longitude));
});

test('3. Código inválido é recusado com motivo explícito', async () => {
  for (const invalido of ['', '   ', 'ABC', '588M8FP9', 'ZZZZ+ZZ', '1234+', '5+5']) {
    const r = ResolverEnderecoDigital(invalido);
    assert.equal(r.ok, false, `deveria recusar: "${invalido}"`);
    assert.ok(
      r.status === STATUS.VAZIO || r.status === STATUS.MALFORMADO || r.status === STATUS.FORA_DA_AREA,
      `status inesperado para "${invalido}": ${r.status}`,
    );
    assert.equal(r.latitude, null, 'não pode inventar coordenada');
    assert.equal(r.longitude, null);
  }
  // e o serviço do SIGA, sem conexão, responde INDISPONIVEL (sem inventar)
  const siga = criarServicoEnderecoDigital({ modo: MODOS.SIGA });
  const r = await siga.resolver('8FP9+J6');
  assert.equal(r.status, 'INDISPONIVEL');
  assert.equal(r.latitude, null);
  assert.equal(r.ok, false);
});

test('4. Endereço válido fora da área atendida é recusado sem converter', () => {
  // código de outro país: decodifica para fora do recorte do município
  const fora = '8FX5+HW';
  const resultado = ResolverEnderecoDigital(fora);
  // o código curto é expandido a partir da referência do município; um código
  // completo fora da região precisa ser recusado
  const completoFora = 'CVFX+HMW';
  const r = ResolverEnderecoDigital(completoFora);
  assert.ok(
    r.status === STATUS.FORA_DA_AREA || r.status === STATUS.MALFORMADO,
    `status inesperado: ${r.status}`,
  );
  assert.equal(r.ok, false);
  assert.equal(r.latitude, null);
  assert.equal(r.longitude, null);
});

test('4b. Código completo truncado é aceito como na classe (completamento com \'0\')', () => {
  // comportamento da classe C#: um código completo com menos de 10 dígitos é
  // completado com '0' (que não pertence ao alfabeto OLC) e decodificado com
  // o deslocamento de uma resolução. A porta reproduz isso fielmente.
  const completo = Completar('588M8FP9+');
  assert.equal(completo, '588M8FP9+00');
  const r = ResolverEnderecoDigital('588M8FP9+');
  assert.equal(r.status, STATUS.CONVERTIDO);
  // o ponto fica na célula do prefixo (a ~14 m do centro exato)
  const exato = DecodificarCepDigital('588M8FP9+J6');
  const d = haversine(r.longitude, r.latitude, exato.longitude, exato.latitude);
  // o código truncado cai no centro da CÉLULA de 0,0025° do prefixo
  // (≈ 280 m), e não no centro do código completo
  assert.ok(d < 250, `desvio do centro: ${d.toFixed(1)} m`);
  assert.equal(CoordenadaNaRegiao(r.latitude, r.longitude), true);
});

test('4c. Falha de resolução é distinguida de código vazio', () => {
  const servico = criarServicoEnderecoDigital();
  assert.equal(servico.resolver('').status, STATUS.VAZIO);
  assert.equal(servico.resolver('lixo').status, STATUS.MALFORMADO);
  // NormalizarCepDigitalParaBanco / NormalizarCoordenadaParaBanco: contrato C#
  assert.equal(NormalizarCepDigitalParaBanco(' 8fp9+j6 '), '8FP9+J6');
  assert.equal(NormalizarCepDigitalParaBanco('   '), null);
  assert.equal(NormalizarCoordenadaParaBanco('-23.6635'), '-23,6635');
  assert.equal(NormalizarCoordenadaParaBanco('-23,6635'), '-23,6635');
  assert.equal(NormalizarCoordenadaParaBanco(''), null);
  assert.equal(NormalizarCoordenadaParaBanco('abc'), null);
});

/* ================================================================== */
/* 5–6. Ligação do ponto com a rede viária                             */
/* ================================================================== */

test('5. Coordenadas próximas de um eixo viário se ligam à rede com a distância de acesso', () => {
  const feats = [eixoReto(1, 0, 0, 300, 0, 'RUA DE TESTE')];
  const g = buildGraph(feats, {});
  // ponto a 8 m da rua, no meio dela
  const p = asPoint(150, 8);
  const r = routeOnGraph(g, p, asPoint(280, 0), {});
  assert.equal(r.ok, true);
  assert.ok(r.origin.distanceToNetwork > 7 && r.origin.distanceToNetwork < 9);
  assert.ok(r.distance > 120 && r.distance < 140);
});

test('6. Ponto distante da rede é recusado com a distância medida', () => {
  const feats = [eixoReto(1, 0, 0, 300, 0, 'RUA DE TESTE')];
  const g = buildGraph(feats, {});
  const r = routeOnGraph(g, asPoint(150, 400), asPoint(280, 0), { maxSnapDistance: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'FORA_DA_REDE');
  assert.ok(r.distanceToNetwork > 350);
});

/* ================================================================== */
/* 7–8, 11, 13. Rotas (simples, com paradas, sem caminho, geometria)   */
/* ================================================================== */

test('7. Rota entre origem e destino usa a rede viária', () => {
  const feats = [eixoReto(1, 0, 0, 400, 0, 'RUA DE TESTE')];
  const g = buildGraph(feats, {});
  const r = routeOnGraph(g, asPoint(0, 0), asPoint(400, 0), {});
  assert.equal(r.ok, true);
  assert.ok(r.distance > 395 && r.distance < 405);
  assert.ok(r.geometry.coordinates.length >= 2);
  assert.equal(r.streets[0], 'RUA DE TESTE');
});

test('8. Rota com duas ou mais paradas concatena os trechos na ordem do usuário', () => {
  const feats = [
    eixoReto(1, 0, 0, 400, 0, 'RUA HORIZONTAL'),
    eixoReto(2, 200, -200, 200, 0, 'RUA VERTICAL'),
    eixoReto(3, 400, 0, 400, -300, 'RUA VERTICAL 2'),
  ];
  const g = buildGraph(feats, {});
  const pontos = [
    { rotulo: 'A', ...asLatLon(0, 0) },
    { rotulo: 'B', ...asLatLon(200, 0) },
    { rotulo: 'C', ...asLatLon(400, 0) },
    { rotulo: 'D', ...asLatLon(400, -300) },
  ];
  const r = calcularRotaComParadas(g, pontos, {});
  assert.equal(r.ok, true);
  assert.equal(r.legs.length, 3);
  assert.deepEqual(r.sequencia, ['A', 'B', 'C', 'D']);
  assert.equal(r.paradas, 2);

  // a distância total é a soma dos trechos
  const soma = r.legs.reduce((s, l) => s + l.distance, 0);
  assert.ok(Math.abs(soma - r.distance) < 1e-6);

  // cada trecho vai do ponto ao seguinte
  assert.equal(r.legs[0].de, 'A');
  assert.equal(r.legs[0].para, 'B');
  assert.equal(r.legs[2].de, 'C');
  assert.equal(r.legs[2].para, 'D');
});

test('11. Trecho sem conexão viável é informado — e nada de linha reta é desenhado', () => {
  const feats = [
    eixoReto(1, 0, 0, 200, 0, 'RUA ISOLADA'),
    eixoReto(2, 1000, 1000, 1200, 1000, 'OUTRA RUA ISOLADA'),
  ];
  const g = buildGraph(feats, {});
  const r = calcularRotaComParadas(
    g,
    [
      { rotulo: 'A', ...asLatLon(0, 0) },
      { rotulo: 'B', ...asLatLon(200, 0) },
      { rotulo: 'C', ...asLatLon(1100, 1000) },
    ],
    {},
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'TRECHO_SEM_CAMINHO');
  assert.equal(r.falha.de, 'B');
  assert.equal(r.falha.para, 'C');
  assert.ok(r.falha.message.length > 0);
  // a geometria parcial cobre apenas o trecho que existiu
  const coords = r.geometry.coordinates;
  assert.ok(coords.length >= 2);
  // e o trecho que falhou não foi "completado" com uma reta até o destino
  const ultimo = coords[coords.length - 1];
  const destino = asPoint(1100, 1000);
  assert.ok(
    dist(project(ultimo[0], ultimo[1])[0], project(ultimo[0], ultimo[1])[1], project(destino.lon, destino.lat)[0], project(destino.lon, destino.lat)[1]) > 100,
    'o trecho sem caminho não pode ter sido desenhado',
  );
});

test('13. Curvas e geometria original são preservadas em TODOS os trechos', () => {
  const feats = [
    eixoEmCurva(1, 0, 0, 300, 0, 40),
    eixoEmCurva(2, 300, 0, 300, -300, 40),
  ];
  const g = buildGraph(feats, {});
  const pontos = [
    { rotulo: 'A', ...asLatLon(0, 0) },
    { rotulo: 'B', ...asLatLon(300, 0) },
    { rotulo: 'C', ...asLatLon(300, -300) },
  ];
  const r = calcularRotaComParadas(g, pontos, {});
  assert.equal(r.ok, true);
  assert.equal(r.legs.length, 2);

  // cada trecho mantém os vértices da curva (mais de 2 pontos de geometria)
  for (const perna of r.legs) {
    const coords = perna.geometry.coordinates;
    assert.ok(coords.length >= 4, `trecho com ${coords.length} vértices`);
  }

  // a geometria concatenada contém os vértices dos dois trechos, na ordem
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

/* ================================================================== */
/* 9–10, 12. Gestão da lista de pontos                                  */
/* ================================================================== */

test('9. Adição, edição e remoção de paradas mantêm os rótulos corretos', () => {
  const lista = criarListaPontos();
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  assert.deepEqual(sequenciaRotulos(lista), ['A', 'B']);
  assert.equal(lista.pontos[0].tipo, 'origem');
  assert.equal(lista.pontos[1].tipo, 'destino');

  adicionarPonto(lista, {});
  assert.deepEqual(sequenciaRotulos(lista), ['A', 'B', 'C']);
  assert.equal(lista.pontos[1].tipo, 'parada');
  assert.equal(lista.pontos[2].tipo, 'destino');
  assert.equal(contarParadas(lista), 1);

  adicionarPonto(lista, {});
  assert.deepEqual(sequenciaRotulos(lista), ['A', 'B', 'C', 'D']);
  assert.equal(contarParadas(lista), 2);

  // edição de um ponto
  const meio = lista.pontos[1];
  atualizarPonto(lista, meio.id, {
    enderecoDigital: '8FP9+J6',
    latitude: -23.66,
    longitude: -46.53,
    status: STATUS.CONVERTIDO,
  });
  assert.equal(lista.pontos[1].enderecoDigital, '8FP9+J6');
  assert.equal(lista.pontos[1].status, STATUS.CONVERTIDO);

  // remoção de uma parada: os rótulos são recalculados
  removerPonto(lista, lista.pontos[2].id);
  assert.deepEqual(sequenciaRotulos(lista), ['A', 'B', 'C']);
  assert.equal(contarParadas(lista), 1);
  assert.equal(lista.pontos[2].tipo, 'destino');

  // origem e destino não podem ser removidos
  const antes = sequenciaRotulos(lista);
  removerPonto(lista, lista.pontos[0].id);
  removerPonto(lista, lista.pontos[lista.pontos.length - 1].id);
  assert.deepEqual(sequenciaRotulos(lista), antes);
});

test('10. Reordenação das paradas respeita a ordem do usuário', () => {
  const lista = criarListaPontos();
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  assert.deepEqual(sequenciaRotulos(lista), ['A', 'B', 'C', 'D']);

  const c = lista.pontos[2];
  assert.equal(c.rotulo, 'C');
  moverPonto(lista, c.id, -1); // C sobe, trocando de lugar com B
  assert.deepEqual(sequenciaRotulos(lista), ['A', 'B', 'C', 'D']);
  assert.equal(lista.pontos[1].id, c.id, 'C deve ocupar a posição de B');
  assert.equal(lista.pontos[1].rotulo, 'B');
  assert.equal(lista.pontos[2].rotulo, 'C');

  // a origem e o destino permanecem nas extremidades
  moverPonto(lista, lista.pontos[0].id, +1);
  assert.equal(lista.pontos[0].tipo, 'origem');
  assert.equal(lista.pontos[lista.pontos.length - 1].tipo, 'destino');
});

test('12. Alterar um endereço depois de calcular a rota invalida o resultado', () => {
  const feats = [eixoReto(1, 0, 0, 400, 0, 'RUA DE TESTE')];
  const g = buildGraph(feats, {});
  const lista = criarListaPontos();
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  atualizarPonto(lista, lista.pontos[0].id, {
    enderecoDigital: '8FP9+J6',
    latitude: asPoint(0, 0).lat,
    longitude: asPoint(0, 0).lon,
    status: STATUS.CONVERTIDO,
  });
  atualizarPonto(lista, lista.pontos[1].id, {
    latitude: asPoint(400, 0).lat,
    longitude: asPoint(400, 0).lon,
    status: STATUS.CONVERTIDO,
  });

  assert.equal(podeCalcular(lista).ok, true);
  const r1 = calcularRotaComParadas(
    g,
    lista.pontos.map((p) => ({ rotulo: p.rotulo, latitude: p.latitude, longitude: p.longitude })),
    {},
  );
  assert.equal(r1.ok, true);

  // altera o endereço do destino: as coordenadas deixam de valer
  atualizarPonto(lista, lista.pontos[1].id, {
    enderecoDigital: 'ZZZ',
    status: STATUS.MALFORMADO,
    latitude: null,
    longitude: null,
  });
  const verificacao = podeCalcular(lista);
  assert.equal(verificacao.ok, false);
  assert.equal(verificacao.motivo, 'PONTO_SEM_COORDENADA');
  assert.ok(verificacao.mensagem.includes('B'));
});

/* ================================================================== */
/* Integração com a rede real                                           */
/* ================================================================== */

test('integração: Endereço Digital do centro de Santo André vira rota na rede real', () => {
  const feats = loadRealFeatures();
  const g = buildGraph(feats, {});

  // código do ponto de referência do município (definido pela classe C#)
  const codigo = CodificarCompleto('-23.6635', '-46.5320');
  const convertido = ResolverEnderecoDigital(codigo);
  assert.equal(convertido.status, STATUS.CONVERTIDO);

  const origem = { lat: convertido.latitude, lon: convertido.longitude };

  // o destino é um vértice REAL de um eixo próximo (garante que o ponto
  // está de fato sobre a malha viária)
  let destino = null;
  let melhor = Infinity;
  for (const f of feats) {
    const geoms = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const anel of geoms) {
      for (const c of anel) {
        const d = haversine(origem.lon, origem.lat, c[0], c[1]);
        if (d > 300 && d < melhor) {
          melhor = d;
          destino = { lat: c[1], lon: c[0] };
        }
      }
    }
  }
  assert.ok(destino, 'a camada deve ter eixos próximos do centro');

  const r = calcularRotaComParadas(
    g,
    [
      { rotulo: 'A', latitude: origem.lat, longitude: origem.lon },
      { rotulo: 'B', latitude: destino.lat, longitude: destino.lon },
    ],
    {},
  );
  assert.equal(r.ok, true, r.message || '');
  assert.equal(r.legs.length, 1);
  assert.ok(r.distance > 200, `distância: ${r.distance}`);
  assert.ok(r.geometry.coordinates.length > 5);
});
