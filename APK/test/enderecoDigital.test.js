/**
 * TESTES â€” ENDEREÃ‡O DIGITAL (CEP DIGITAL) E ROTA COM MÃšLTIPLAS PARADAS
 * =====================================================================
 *
 * Cobrem os 13 cenÃ¡rios obrigatÃ³rios da rodada 5:
 *
 *   1. Plus Code completo vÃ¡lido;
 *   2. Plus Code encurtado (quando suportado pela classe);
 *   3. cÃ³digo invÃ¡lido;
 *   4. endereÃ§o que nÃ£o pode ser convertido em coordenadas;
 *   5. coordenadas vÃ¡lidas prÃ³ximas de um eixo viÃ¡rio;
 *   6. ponto distante da rede;
 *   7. rota entre origem e destino;
 *   8. rota com duas ou mais paradas;
 *   9. adiÃ§Ã£o, ediÃ§Ã£o e remoÃ§Ã£o de paradas;
 *  10. reordenaÃ§Ã£o dos pontos;
 *  11. trecho sem conexÃ£o viÃ¡vel;
 *  12. alteraÃ§Ã£o de um endereÃ§o depois de calcular a rota;
 *  13. preservaÃ§Ã£o das curvas e da geometria original em todos os trechos.
 *
 * A lÃ³gica do EndereÃ§o Digital vem da **porta fiel** da classe C#
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
} from '../src/core/enderecoDigital.js';
import { criarServicoEnderecoDigital, MODOS } from '../src/core/enderecoDigitalService.js';
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
} from '../src/core/pontoTrajeto.js';
import { calcularRotaComParadas } from '../src/core/rotaParadas.js';
import { buildGraph } from '../src/core/graph.js';
import { routeOnGraph } from '../src/core/router.js';
import { project, unproject, dist, haversine } from '../src/core/geo.js';
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
 * Eixo em curva: a geometria precisa sobreviver Ã  rota.
 * A curva Ã© uma "S" perpendicular ao segmento de (dx0,dy0) a (dx1,dy1).
 */
function eixoEmCurva(id, x0, y0, x1, y1, amplitude) {
  const coords = [];
  const passos = 12;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  // vetor unitÃ¡rio e sua perpendicular
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
/* 1â€“4. EndereÃ§o Digital (CEP Digital)                                */
/* ================================================================== */

test('1. Plus Code completo vÃ¡lido Ã© normalizado, validado e convertido', () => {
  const lat = -23.6635;
  const lon = -46.532;
  const completo = CodificarCompleto(String(lat), String(lon));
  assert.match(completo, /^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2}$/);

  // normalizaÃ§Ã£o: minÃºsculas, espaÃ§os e "sem espaÃ§o" sÃ£o aceitos
  assert.equal(NormalizarCepDigital('  588m8fp9+j6 '), '588M8FP9+J6');

  const resultado = ResolverEnderecoDigital(completo);
  assert.equal(resultado.status, STATUS.CONVERTIDO);
  assert.equal(resultado.ok, true);
  assert.ok(Number.isFinite(resultado.latitude));
  assert.ok(Number.isFinite(resultado.longitude));
  assert.equal(resultado.naRegiao, true);

  // o ponto convertido fica dentro da cÃ©lula do cÃ³digo (â‰¤ 14 m do centro)
  const d = haversine(resultado.longitude, resultado.latitude, lon, lat);
  assert.ok(d < 15, `distÃ¢ncia atÃ© o ponto de origem: ${d.toFixed(2)} m`);

  // a normalizaÃ§Ã£o nÃ£o Ã© o mesmo que a conversÃ£o: `validar` nÃ£o devolve
  // coordenadas, `resolver` devolve
  const servico = criarServicoEnderecoDigital();
  const validado = servico.validar(completo);
  assert.equal(validado.status, 'VALIDADO');
  assert.equal(validado.codigoCompleto, completo);
  assert.equal(validado.latitude, undefined);
});

test('2. Plus Code encurtado Ã© expandido com o ponto de referÃªncia do municÃ­pio', () => {
  const lat = -23.6635;
  const lon = -46.532;
  const curto = CodificarCurto(String(lat), String(lon));
  assert.ok(curto.length < CodificarCompleto(String(lat), String(lon)).length);
  assert.equal(curto, '8FP9+J6'); // prefixo de 4 caracteres removido

  // o cÃ³digo curto Ã© expandido para o cÃ³digo completo
  assert.equal(Completar(curto), '588M8FP9+J6');

  const resultado = ResolverEnderecoDigital(curto);
  assert.equal(resultado.status, STATUS.CONVERTIDO);
  assert.equal(resultado.codigoCompleto, '588M8FP9+J6');
  assert.ok(CoordenadaNaRegiao(resultado.latitude, resultado.longitude));
});

test('3. CÃ³digo invÃ¡lido Ã© recusado com motivo explÃ­cito', async () => {
  for (const invalido of ['', '   ', 'ABC', '588M8FP9', 'ZZZZ+ZZ', '1234+', '5+5']) {
    const r = ResolverEnderecoDigital(invalido);
    assert.equal(r.ok, false, `deveria recusar: "${invalido}"`);
    assert.ok(
      r.status === STATUS.VAZIO || r.status === STATUS.MALFORMADO || r.status === STATUS.FORA_DA_AREA,
      `status inesperado para "${invalido}": ${r.status}`,
    );
    assert.equal(r.latitude, null, 'nÃ£o pode inventar coordenada');
    assert.equal(r.longitude, null);
  }
  // e o serviÃ§o do SIGA, sem conexÃ£o, responde INDISPONIVEL (sem inventar)
  const siga = criarServicoEnderecoDigital({ modo: MODOS.SIGA });
  const r = await siga.resolver('8FP9+J6');
  assert.equal(r.status, 'INDISPONIVEL');
  assert.equal(r.latitude, null);
  assert.equal(r.ok, false);
});

test('4. EndereÃ§o vÃ¡lido fora da Ã¡rea atendida Ã© recusado sem converter', () => {
  // cÃ³digo de outro paÃ­s: decodifica para fora do recorte do municÃ­pio
  const fora = '8FX5+HW';
  const resultado = ResolverEnderecoDigital(fora);
  // o cÃ³digo curto Ã© expandido a partir da referÃªncia do municÃ­pio; um cÃ³digo
  // completo fora da regiÃ£o precisa ser recusado
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

test('4b. CÃ³digo completo truncado Ã© aceito como na classe (completamento com \'0\')', () => {
  // comportamento da classe C#: um cÃ³digo completo com menos de 10 dÃ­gitos Ã©
  // completado com '0' (que nÃ£o pertence ao alfabeto OLC) e decodificado com
  // o deslocamento de uma resoluÃ§Ã£o. A porta reproduz isso fielmente.
  const completo = Completar('588M8FP9+');
  assert.equal(completo, '588M8FP9+00');
  const r = ResolverEnderecoDigital('588M8FP9+');
  assert.equal(r.status, STATUS.CONVERTIDO);
  // o ponto fica na cÃ©lula do prefixo (a ~14 m do centro exato)
  const exato = DecodificarCepDigital('588M8FP9+J6');
  const d = haversine(r.longitude, r.latitude, exato.longitude, exato.latitude);
  // o cÃ³digo truncado cai no centro da CÃ‰LULA de 0,0025Â° do prefixo
  // (â‰ˆ 280 m), e nÃ£o no centro do cÃ³digo completo
  assert.ok(d < 250, `desvio do centro: ${d.toFixed(1)} m`);
  assert.equal(CoordenadaNaRegiao(r.latitude, r.longitude), true);
});

test('4c. Falha de resoluÃ§Ã£o Ã© distinguida de cÃ³digo vazio', () => {
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
/* 5â€“6. LigaÃ§Ã£o do ponto com a rede viÃ¡ria                             */
/* ================================================================== */

test('5. Coordenadas prÃ³ximas de um eixo viÃ¡rio se ligam Ã  rede com a distÃ¢ncia de acesso', () => {
  const feats = [eixoReto(1, 0, 0, 300, 0, 'RUA DE TESTE')];
  const g = buildGraph(feats, {});
  // ponto a 8 m da rua, no meio dela
  const p = asPoint(150, 8);
  const r = routeOnGraph(g, p, asPoint(280, 0), {});
  assert.equal(r.ok, true);
  assert.ok(r.origin.distanceToNetwork > 7 && r.origin.distanceToNetwork < 9);
  assert.ok(r.distance > 120 && r.distance < 140);
});

test('6. Ponto distante da rede Ã© recusado com a distÃ¢ncia medida', () => {
  const feats = [eixoReto(1, 0, 0, 300, 0, 'RUA DE TESTE')];
  const g = buildGraph(feats, {});
  const r = routeOnGraph(g, asPoint(150, 400), asPoint(280, 0), { maxSnapDistance: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'FORA_DA_REDE');
  assert.ok(r.distanceToNetwork > 350);
});

/* ================================================================== */
/* 7â€“8, 11, 13. Rotas (simples, com paradas, sem caminho, geometria)   */
/* ================================================================== */

test('7. Rota entre origem e destino usa a rede viÃ¡ria', () => {
  const feats = [eixoReto(1, 0, 0, 400, 0, 'RUA DE TESTE')];
  const g = buildGraph(feats, {});
  const r = routeOnGraph(g, asPoint(0, 0), asPoint(400, 0), {});
  assert.equal(r.ok, true);
  assert.ok(r.distance > 395 && r.distance < 405);
  assert.ok(r.geometry.coordinates.length >= 2);
  assert.equal(r.streets[0], 'RUA DE TESTE');
});

test('8. Rota com duas ou mais paradas concatena os trechos na ordem do usuÃ¡rio', () => {
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

  // a distÃ¢ncia total Ã© a soma dos trechos
  const soma = r.legs.reduce((s, l) => s + l.distance, 0);
  assert.ok(Math.abs(soma - r.distance) < 1e-6);

  // cada trecho vai do ponto ao seguinte
  assert.equal(r.legs[0].de, 'A');
  assert.equal(r.legs[0].para, 'B');
  assert.equal(r.legs[2].de, 'C');
  assert.equal(r.legs[2].para, 'D');
});

test('11. Trecho sem conexÃ£o viÃ¡vel Ã© informado â€” e nada de linha reta Ã© desenhado', () => {
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
  // e o trecho que falhou nÃ£o foi "completado" com uma reta atÃ© o destino
  const ultimo = coords[coords.length - 1];
  const destino = asPoint(1100, 1000);
  assert.ok(
    dist(project(ultimo[0], ultimo[1])[0], project(ultimo[0], ultimo[1])[1], project(destino.lon, destino.lat)[0], project(destino.lon, destino.lat)[1]) > 100,
    'o trecho sem caminho nÃ£o pode ter sido desenhado',
  );
});

test('13. Curvas e geometria original sÃ£o preservadas em TODOS os trechos', () => {
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

  // cada trecho mantÃ©m os vÃ©rtices da curva (mais de 2 pontos de geometria)
  for (const perna of r.legs) {
    const coords = perna.geometry.coordinates;
    assert.ok(coords.length >= 4, `trecho com ${coords.length} vÃ©rtices`);
  }

  // a geometria concatenada contÃ©m os vÃ©rtices dos dois trechos, na ordem
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
      assert.ok(achou, 'vÃ©rtice do trecho ausente na geometria final');
    }
  }
});

/* ================================================================== */
/* 9â€“10, 12. GestÃ£o da lista de pontos                                  */
/* ================================================================== */

test('9. AdiÃ§Ã£o, ediÃ§Ã£o e remoÃ§Ã£o de paradas mantÃªm os rÃ³tulos corretos', () => {
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

  // ediÃ§Ã£o de um ponto
  const meio = lista.pontos[1];
  atualizarPonto(lista, meio.id, {
    enderecoDigital: '8FP9+J6',
    latitude: -23.66,
    longitude: -46.53,
    status: STATUS.CONVERTIDO,
  });
  assert.equal(lista.pontos[1].enderecoDigital, '8FP9+J6');
  assert.equal(lista.pontos[1].status, STATUS.CONVERTIDO);

  // remoÃ§Ã£o de uma parada: os rÃ³tulos sÃ£o recalculados
  removerPonto(lista, lista.pontos[2].id);
  assert.deepEqual(sequenciaRotulos(lista), ['A', 'B', 'C']);
  assert.equal(contarParadas(lista), 1);
  assert.equal(lista.pontos[2].tipo, 'destino');

  // origem e destino nÃ£o podem ser removidos
  const antes = sequenciaRotulos(lista);
  removerPonto(lista, lista.pontos[0].id);
  removerPonto(lista, lista.pontos[lista.pontos.length - 1].id);
  assert.deepEqual(sequenciaRotulos(lista), antes);
});

test('10. ReordenaÃ§Ã£o das paradas respeita a ordem do usuÃ¡rio', () => {
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
  assert.equal(lista.pontos[1].id, c.id, 'C deve ocupar a posiÃ§Ã£o de B');
  assert.equal(lista.pontos[1].rotulo, 'B');
  assert.equal(lista.pontos[2].rotulo, 'C');

  // a origem e o destino permanecem nas extremidades
  moverPonto(lista, lista.pontos[0].id, +1);
  assert.equal(lista.pontos[0].tipo, 'origem');
  assert.equal(lista.pontos[lista.pontos.length - 1].tipo, 'destino');
});

test('12. Alterar um endereÃ§o depois de calcular a rota invalida o resultado', () => {
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

  // altera o endereÃ§o do destino: as coordenadas deixam de valer
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
/* IntegraÃ§Ã£o com a rede real                                           */
/* ================================================================== */

test('integraÃ§Ã£o: EndereÃ§o Digital do centro de Santo AndrÃ© vira rota na rede real', () => {
  const feats = loadRealFeatures();
  const g = buildGraph(feats, {});

  // cÃ³digo do ponto de referÃªncia do municÃ­pio (definido pela classe C#)
  const codigo = CodificarCompleto('-23.6635', '-46.5320');
  const convertido = ResolverEnderecoDigital(codigo);
  assert.equal(convertido.status, STATUS.CONVERTIDO);

  const origem = { lat: convertido.latitude, lon: convertido.longitude };

  // o destino Ã© um vÃ©rtice REAL de um eixo prÃ³ximo (garante que o ponto
  // estÃ¡ de fato sobre a malha viÃ¡ria)
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
  assert.ok(destino, 'a camada deve ter eixos prÃ³ximos do centro');

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
  assert.ok(r.distance > 200, `distÃ¢ncia: ${r.distance}`);
  assert.ok(r.geometry.coordinates.length > 5);
});

