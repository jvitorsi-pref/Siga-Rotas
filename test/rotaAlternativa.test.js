import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../core/graph.js';
import { CLASSIFICACOES, TEMPORALIDADES } from '../ocorrencias/catalogo.js';
import { MODOS_PREFERENCIA } from '../ocorrencias/preferencias.js';
import { criarOcorrencia } from '../ocorrencias/regras.js';
import { calcularRotaComAlternativas } from '../ocorrencias/roteamentoAlternativo.js';
import { feature, loadRealFeatures, official } from './helpers.js';

/**
 * Malha em anel simples:
 *  - Sul (direta, ~220 m): (0, 0) -> (0.0022, 0)
 *  - Desvio Norte (~330 m): (0, 0) -> (0, +0.0005) -> (0.0022, +0.0005) -> (0.0022, 0)
 *  - Mais um ramal sem saída a Leste: (0.0022, 0) -> (0.0040, 0)
 */
function criarMalhaComDesvioEBeco() {
  const bLon = -46.42;
  const bLat = -23.68;
  return buildGraph([
    feature(official(1, 'RUA DIRETA SUL'), [
      [bLon, bLat],
      [bLon + 0.0022, bLat],
    ]),
    feature(official(2, 'RUA LATERAL OESTE'), [
      [bLon, bLat],
      [bLon, bLat + 0.0005],
    ]),
    feature(official(3, 'RUA DESVIO NORTE'), [
      [bLon, bLat + 0.0005],
      [bLon + 0.0022, bLat + 0.0005],
    ]),
    feature(official(4, 'RUA LATERAL LESTE'), [
      [bLon + 0.0022, bLat + 0.0005],
      [bLon + 0.0022, bLat],
    ]),
    feature(official(5, 'BECO SEM SAÍDA'), [
      [bLon + 0.0022, bLat],
      [bLon + 0.0040, bLat],
    ]),
  ]);
}

describe('roteamento alternativo colaborativo', () => {
  const pontos = [
    { rotulo: 'Origem', latitude: -23.68, longitude: -46.42 },
    { rotulo: 'Destino', latitude: -23.68, longitude: -46.4178 },
  ];

  it('ocorrência informativa exibe alerta no trajeto sem alterar rota nem criar falsa alternativa', () => {
    const graph = criarMalhaComDesvioEBeco();
    const { ocorrencia } = criarOcorrencia(
      {
        categoria: 'passagem_estreita',
        classificacao: CLASSIFICACOES.INFORMATIVO,
        latitude: -23.68,
        longitude: -46.4189,
      },
      { graph, usuarioId: 'u1' },
    );

    const res = calcularRotaComAlternativas(graph, pontos, {
      ocorrencias: [ocorrencia],
      preferencias: { modo: MODOS_PREFERENCIA.CONSIDERAR },
    });

    assert.equal(res.ok, true);
    assert.equal(res.rotas.length, 1);
    assert.equal(res.comparacaoAlternativas.existemAlternativas, false);
    assert.equal(res.rotas[0].ocorrenciasNoTrajeto.length, 1);
    assert.ok(res.distanceMeters < 260); // manteve a RUA DIRETA SUL
  });

  it('ocorrência penaliza gera duas rotas distintas (recomendada e mais curta) com distâncias reais', () => {
    const graph = criarMalhaComDesvioEBeco();
    const { ocorrencia } = criarOcorrencia(
      {
        categoria: 'buracos',
        classificacao: CLASSIFICACOES.PENALIZA,
        penalidadeMetros: 300, // ~220 + 300 = 520 > ~330 do desvio
        latitude: -23.68,
        longitude: -46.4189,
      },
      { graph, usuarioId: 'u1' },
    );

    const res = calcularRotaComAlternativas(graph, pontos, {
      ocorrencias: [ocorrencia],
      preferencias: { modo: MODOS_PREFERENCIA.CONSIDERAR },
    });

    assert.equal(res.ok, true);
    assert.equal(res.rotas.length, 2);
    assert.equal(res.comparacaoAlternativas.existemAlternativas, true);
    assert.equal(res.rotaSelecionadaId, 'recomendada');

    const rec = res.rotas[0];
    const curta = res.rotas[1];
    assert.equal(rec.recomendada, true);
    assert.equal(curta.recomendada, false);
    // Distância exibida da rota recomendada é a física real (~335 m), sem incluir os +300 m artificiais
    assert.ok(rec.distance > curta.distance);
    assert.ok(rec.distance < curta.distance + 200);
    assert.equal(rec.diferencaMetros, Math.round(rec.distance - curta.distance));
    assert.equal(curta.diferencaMetros, 0);
    assert.equal(rec.ocorrenciasEvitadas.length, 1);
    assert.equal(curta.ocorrenciasNoTrajeto.length, 1);
  });

  it('ocorrência evita não apresenta alternativa mais curta que viole a restrição obrigatória', () => {
    const graph = criarMalhaComDesvioEBeco();
    const { ocorrencia } = criarOcorrencia(
      {
        categoria: 'obra_bloqueio',
        classificacao: CLASSIFICACOES.EVITA,
        temporalidade: TEMPORALIDADES.TEMPORARIA,
        latitude: -23.68,
        longitude: -46.4189,
      },
      { graph, usuarioId: 'u1' },
    );

    const res = calcularRotaComAlternativas(graph, pontos, {
      ocorrencias: [ocorrencia],
      preferencias: { modo: MODOS_PREFERENCIA.CONSIDERAR },
    });

    assert.equal(res.ok, true);
    assert.equal(res.rotas.length, 1, 'não deve oferecer a rota direta violadora');
    assert.equal(res.rotas[0].violacoesObrigatorias, 0);
    assert.equal(res.rotas[0].ocorrenciasEvitadas.length, 1);
    assert.ok(res.distance > 280); // seguiu pelo desvio norte
  });

  it('informa claramente quando ocorrência evita fecha a única passagem disponível', () => {
    const graph = criarMalhaComDesvioEBeco();
    const { ocorrencia } = criarOcorrencia(
      {
        categoria: 'obra_bloqueio',
        classificacao: CLASSIFICACOES.EVITA,
        latitude: -23.68,
        longitude: -46.4169, // sobre o BECO SEM SAÍDA (feId 5)
      },
      { graph, usuarioId: 'u1' },
    );

    const paraOBeco = [
      { rotulo: 'Origem', latitude: -23.68, longitude: -46.42 },
      { rotulo: 'Fim do beco', latitude: -23.68, longitude: -46.416 },
    ];

    const res = calcularRotaComAlternativas(graph, paraOBeco, {
      ocorrencias: [ocorrencia],
      preferencias: { modo: MODOS_PREFERENCIA.CONSIDERAR },
    });

    assert.equal(res.ok, false);
    assert.equal(res.reason, 'BLOQUEADO_POR_OCORRENCIA');
    assert.ok(res.ocorrenciasBloqueantes.length >= 1);
    assert.equal(res.comparacaoAlternativas.bloqueadaPorRestricao, true);
  });

  it('modo ignorar alertas devolve apenas rota padrão mesmo com bloqueios e penalidades', () => {
    const graph = criarMalhaComDesvioEBeco();
    const { ocorrencia } = criarOcorrencia(
      {
        categoria: 'obra_bloqueio',
        classificacao: CLASSIFICACOES.EVITA,
        latitude: -23.68,
        longitude: -46.4189,
      },
      { graph, usuarioId: 'u1' },
    );

    const res = calcularRotaComAlternativas(graph, pontos, {
      ocorrencias: [ocorrencia],
      preferencias: { modo: MODOS_PREFERENCIA.IGNORAR },
    });

    assert.equal(res.ok, true);
    assert.equal(res.rotas.length, 1);
    assert.ok(res.distanceMeters < 260);
  });

  it('respeita preferência do usuário para evitar categoria específica (ex.: escadaria)', () => {
    const graph = criarMalhaComDesvioEBeco();
    const { ocorrencia } = criarOcorrencia(
      {
        categoria: 'escadaria',
        classificacao: CLASSIFICACOES.INFORMATIVO,
        latitude: -23.68,
        longitude: -46.4189,
      },
      { graph, usuarioId: 'u1' },
    );

    const res = calcularRotaComAlternativas(graph, pontos, {
      ocorrencias: [ocorrencia],
      preferencias: {
        modo: MODOS_PREFERENCIA.CONSIDERAR,
        evitarCategorias: ['escadaria'],
      },
    });

    assert.equal(res.ok, true);
    assert.equal(res.rotas.length, 1);
    assert.ok(res.distance > 280);
  });

  it('preserva múltiplas paradas, rota circular e otimização', () => {
    const graph = criarMalhaComDesvioEBeco();
    const { ocorrencia } = criarOcorrencia(
      {
        categoria: 'buracos',
        classificacao: CLASSIFICACOES.PENALIZA,
        penalidadeMetros: 300,
        latitude: -23.68,
        longitude: -46.4189,
      },
      { graph, usuarioId: 'u1' },
    );

    const multiPontos = [
      { rotulo: 'A', latitude: -23.68, longitude: -46.42 },
      { rotulo: 'B', latitude: -23.68, longitude: -46.4178 },
      { rotulo: 'C', latitude: -23.6795, longitude: -46.4178 },
    ];

    const res = calcularRotaComAlternativas(graph, multiPontos, {
      modo: 'otimizada',
      circular: true,
      ocorrencias: [ocorrencia],
      preferencias: { modo: MODOS_PREFERENCIA.CONSIDERAR },
    });

    assert.equal(res.ok, true);
    assert.equal(res.circular, true);
    assert.equal(res.legs.length, 3);
    assert.ok(res.rotas.length >= 1);
  });

  it('integra corretamente sobre a rede real do snapshot', () => {
    const features = loadRealFeatures();
    const realGraph = buildGraph(features);
    // Seleciona duas extremidades reais conectadas na malha e testa rota base vs ocorrência
    const arestaBase = realGraph.edges.find((e) => !e.connector && e.length > 60);
    assert.ok(arestaBase);
    const nA = realGraph.nodes[arestaBase.from];
    const nB = realGraph.nodes[arestaBase.to];

    const semOcorrencias = calcularRotaComAlternativas(realGraph, [
      { rotulo: 'P1', latitude: nA.lat, longitude: nA.lon },
      { rotulo: 'P2', latitude: nB.lat, longitude: nB.lon },
    ]);
    assert.equal(semOcorrencias.ok, true);

    const mid = arestaBase.coords[Math.floor(arestaBase.coords.length / 2)];
    // Usa o nó médio geográfico da própria rota calculada para posicionar o alerta
    const coordsRota = semOcorrencias.geometry.coordinates;
    const meioLonLat = coordsRota[Math.floor(coordsRota.length / 2)];
    const criacao = criarOcorrencia(
      {
        categoria: 'buracos',
        classificacao: CLASSIFICACOES.PENALIZA,
        penalidadeMetros: 200,
        latitude: meioLonLat[1],
        longitude: meioLonLat[0],
      },
      { graph: realGraph, usuarioId: 'tester-real' },
    );
    assert.equal(criacao.ok, true);

    const comOcorrencia = calcularRotaComAlternativas(
      realGraph,
      [
        { rotulo: 'P1', latitude: nA.lat, longitude: nA.lon },
        { rotulo: 'P2', latitude: nB.lat, longitude: nB.lon },
      ],
      {
        ocorrencias: [criacao.ocorrencia],
        preferencias: { modo: MODOS_PREFERENCIA.CONSIDERAR },
      },
    );
    assert.equal(comOcorrencia.ok, true);
    assert.ok(comOcorrencia.rotas.length >= 1);
    assert.ok(mid);
  });
});
