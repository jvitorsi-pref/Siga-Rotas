/**
 * test/coleta.test.js
 * ---------------------------------------------------------------------------
 * Testes da sessão de coleta de campo: o que entra no trajeto, o que é
 * repetição, o que é salto de GPS, o que é perda de sinal e como a coleta
 * é recuperada depois de uma interrupção.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLASSIFICACAO,
  ESTADO_COLETA,
  FONTE,
  MOTIVO,
  TIPO_PONTO,
  capturarPosicao,
  criarColeta,
  detectarDuplicado,
  montarLocalizacaoResidencia,
} from '../core/coleta.js';
import { criarAdaptadorMemoria, criarArmazenamento } from '../core/armazenamentoLocal.js';
import { criarSimulador } from '../core/simulador.js';
import { planoDeNavegacao } from '../core/navegacao.js';

/** Fonte GPS falsa: o teste decide o que o "aparelho" informa. */
function criarFonteFake() {
  const handlers = { atualizacao: null, erro: null, estado: null };
  const chamadas = { iniciadas: 0, paradas: 0 };
  return {
    handlers,
    chamadas,
    iniciar() {
      chamadas.iniciadas += 1;
      handlers.estado?.({ ativo: true });
    },
    parar() {
      chamadas.paradas += 1;
      handlers.estado?.({ ativo: false });
    },
    /** O aparelho informa uma posição. */
    emitir(posicao) {
      handlers.atualizacao?.(posicao);
    },
    /** O aparelho informa um erro de GPS. */
    falhar(erro) {
      handlers.erro?.(erro);
    },
  };
}

/** Resposta de rota sintética, no mesmo formato da API. */
function respostaDeRota() {
  return {
    legs: [
      {
        de: 'A',
        para: 'B',
        distance: 222,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-46.5, -23.7],
            [-46.5, -23.698],
          ],
        },
      },
    ],
    pontos: [
      { rotulo: 'A', latitude: -23.7, longitude: -46.5 },
      { rotulo: 'B', latitude: -23.698, longitude: -46.5 },
    ],
    sequenciaCompleta: ['A', 'B'],
  };
}

function posicao(lat, lon, extras = {}) {
  return {
    latitude: lat,
    longitude: lon,
    precisao: 8,
    rumo: null,
    velocidade: null,
    timestamp: 1700000000000,
    ...extras,
  };
}

function setup(config = {}, armazenamentoExistente = null) {
  const armazenamento =
    armazenamentoExistente || criarArmazenamento({ adaptador: criarAdaptadorMemoria() });
  const fonte = criarFonteFake();
  const eventos = [];
  const coleta = criarColeta({
    armazenamento,
    agenteId: 'agente_teste',
    dispositivoId: 'disp_teste',
    config,
    criarFonte: (handlers) => {
      fonte.handlers.atualizacao = handlers.aoAtualizar;
      fonte.handlers.erro = handlers.aoErro;
      fonte.handlers.estado = handlers.aoEstado;
      return fonte;
    },
    aoPonto: (p) => eventos.push(p),
    aoAviso: (a) => eventos.push(a),
  });
  return { armazenamento, coleta, fonte, eventos };
}

test('coleta: iniciar cria a sessão e grava no armazenamento local', async () => {
  const { coleta, armazenamento } = setup();
  const r = await coleta.iniciar({ rota: { id: 'rta_1', versao: 4, modo: 'otimizada', sequencia: ['A', 'B'] } });

  assert.equal(r.ok, true);
  assert.equal(coleta.estado.estado, ESTADO_COLETA.ATIVA);
  assert.equal(coleta.estado.rotaId, 'rta_1');
  assert.equal(coleta.estado.versaoRota, 4);

  const sessoes = await armazenamento.listarSessoes();
  assert.equal(sessoes.length, 1);
  assert.equal(sessoes[0].estado, 'ativa');
  assert.equal(sessoes[0].agenteId, 'agente_teste');
  assert.equal(sessoes[0].rotaId, 'rta_1');
  assert.equal(sessoes[0].versaoRota, 4);
});

test('coleta: os pontos lidos são gravados no dispositivo', async () => {
  const { coleta, fonte, armazenamento } = setup();
  await coleta.iniciar();

  fonte.emitir(posicao(-23.7000, -46.5000));
  fonte.emitir(posicao(-23.7005, -46.5005, { timestamp: 1700000010000 }));
  await coleta.pausar();

  const sessaoId = coleta.estado.sessaoId;
  const pontos = await armazenamento.listarPontos(sessaoId);
  assert.equal(pontos.length, 2);
  assert.equal(pontos[0].tipo, TIPO_PONTO.MEDIDO);
  assert.equal(pontos[0].ordem, 1);
  assert.equal(pontos[1].ordem, 2);
  assert.ok(pontos[0].horario, 'o ponto tem horário');
  assert.equal(pontos[0].precisao, 8, 'o ponto guarda a precisão informada');
  assert.ok(pontos[0].id.startsWith('pto_'));
});

test('coleta: leituras repetidas são descartadas', async () => {
  const { coleta, fonte, armazenamento } = setup();
  await coleta.iniciar();

  fonte.emitir(posicao(-23.7000, -46.5000));
  fonte.emitir(posicao(-23.70001, -46.50001, { timestamp: 1700000002000 })); // ~1,5 m, 2 s
  await coleta.pausar();

  const pontos = await armazenamento.listarPontos(coleta.estado.sessaoId);
  assert.equal(pontos.length, 1, 'a repetição não entra no trajeto');
  assert.ok(coleta.estado.repetidos >= 1);
});

test('coleta: leitura com baixa precisão é descartada e contabilizada', async () => {
  const { coleta, fonte, armazenamento } = setup({ precisaoMaxima: 50 });
  await coleta.iniciar();

  fonte.emitir(posicao(-23.7000, -46.5000));
  fonte.emitir(posicao(-23.7005, -46.5005, { precisao: 120, timestamp: 1700000010000 }));
  await coleta.pausar();

  const pontos = await armazenamento.listarPontos(coleta.estado.sessaoId);
  assert.equal(pontos.length, 1);
  assert.equal(coleta.estado.baixaPrecisao, 1);
});

test('coleta: salto de GPS é descartado (velocidade impossível a pé)', async () => {
  const { coleta, fonte, armazenamento } = setup();
  await coleta.iniciar();

  fonte.emitir(posicao(-23.7000, -46.5000));
  // 0,01° de latitude ≈ 1,1 km em 5 s → impossível para uma caminhada
  fonte.emitir(posicao(-23.7100, -46.5000, { timestamp: 1700000005000 }));
  await coleta.pausar();

  const pontos = await armazenamento.listarPontos(coleta.estado.sessaoId);
  assert.equal(pontos.length, 1, 'o salto não entra no trajeto');
  assert.equal(coleta.estado.saltos, 1);
});

test('coleta: lacuna de sinal gera ponto ESTIMADO, identificado como tal', async () => {
  const { coleta, fonte, armazenamento } = setup({ tempoSemSinal: 30000 });
  await coleta.iniciar();

  fonte.emitir(posicao(-23.7000, -46.5000));
  // 60 s depois o sinal volta, mais longe
  fonte.emitir(posicao(-23.7010, -46.5000, { timestamp: 1700000060000 }));
  await coleta.pausar();

  const pontos = await armazenamento.listarPontos(coleta.estado.sessaoId);
  assert.equal(pontos.length, 3, 'medido + estimado + medido');
  assert.equal(pontos[0].tipo, TIPO_PONTO.MEDIDO);
  assert.equal(pontos[1].tipo, TIPO_PONTO.ESTIMADO, 'o ponto do meio é uma estimativa');
  assert.equal(pontos[1].motivo, MOTIVO.LACUNA);
  assert.equal(pontos[2].tipo, TIPO_PONTO.MEDIDO);
  assert.equal(coleta.estado.estimados, 1);
});

test('coleta: distância percorrida é a soma dos trechos aceitos', async () => {
  const { coleta, fonte } = setup();
  await coleta.iniciar();

  fonte.emitir(posicao(-23.7000, -46.5000));
  // 0,001° de latitude ≈ 111 m
  fonte.emitir(posicao(-23.7010, -46.5000, { timestamp: 1700000020000 }));
  await coleta.pausar();

  const d = coleta.estado.distancia;
  assert.ok(d > 100 && d < 120, `distância inesperada: ${d}`);
});

test('coleta: pausar e retomar mantém o estado e o GPS é liberado', async () => {
  const { coleta, fonte } = setup();
  await coleta.iniciar();
  fonte.emitir(posicao(-23.7000, -46.5000));

  await coleta.pausar();
  assert.equal(coleta.estado.estado, ESTADO_COLETA.PAUSADA);
  assert.equal(fonte.chamadas.paradas, 1);

  fonte.emitir(posicao(-23.7005, -46.5005, { timestamp: 1700000010000 }));
  await coleta.pausar(); // já está pausada: não muda nada
  assert.equal(coleta.estado.estado, ESTADO_COLETA.PAUSADA);

  await coleta.retomar();
  assert.equal(coleta.estado.estado, ESTADO_COLETA.ATIVA);
  assert.equal(fonte.chamadas.iniciadas, 2);
});

test('coleta: encerrar fecha a sessão com o horário de término', async () => {
  const { coleta, armazenamento, fonte } = setup();
  await coleta.iniciar();
  fonte.emitir(posicao(-23.7000, -46.5000));
  await coleta.encerrar();

  assert.equal(coleta.estado.estado, ESTADO_COLETA.ENCERRADA);
  assert.equal(fonte.chamadas.paradas, 1);

  const sessao = await armazenamento.obterSessao(coleta.estado.sessaoId);
  assert.equal(sessao.estado, 'encerrada');
  assert.ok(sessao.encerradaEm, 'a sessão tem horário de término');
  assert.equal((await armazenamento.listarPontos(sessao.id)).length, 1);
});

test('coleta: sessão interrompida é recuperada após recarregar o aplicativo', async () => {
  const { coleta, armazenamento, fonte } = setup();
  await coleta.iniciar();
  fonte.emitir(posicao(-23.7000, -46.5000));
  await new Promise((r) => setTimeout(r, 10));
  // "o aplicativo caiu": a sessão continua marcada como ativa no dispositivo
  const sessaoId = coleta.estado.sessaoId;

  // recarregar = nova instância da aplicação, mesmo armazenamento
  const reaberto = criarArmazenamento({ adaptador: armazenamento.adaptador });
  const abertas = await reaberto.listarSessoesAbertas();
  assert.equal(abertas.length, 1);
  assert.equal(abertas[0].id, sessaoId);
  assert.equal(abertas[0].estado, 'ativa');

  const pontos = await reaberto.listarPontos(sessaoId);
  assert.equal(pontos.length, 1, 'os pontos já coletados sobrevivem à queda');
});

test('coleta: retomar uma coleta interrompida continua a MESMA sessão', async () => {
  const { coleta, armazenamento, fonte } = setup();
  await coleta.iniciar();
  fonte.emitir(posicao(-23.7000, -46.5000));
  await new Promise((r) => setTimeout(r, 10));
  const sessaoId = coleta.estado.sessaoId;

  // nova instância da aplicação (o aplicativo foi recarregado): mesmo
  // armazenamento (o aparelho), controlador novo
  const novo = setup({}, armazenamento);
  const sessaoRecuperada = await novo.armazenamento.listarSessoesAbertas();
  assert.equal(sessaoRecuperada.length, 1);

  // o controlador "adota" a sessão gravada
  const r = await novo.coleta.adota(sessaoRecuperada[0].id);
  assert.equal(r.ok, true);
  assert.equal(novo.coleta.estado.sessaoId, sessaoId, 'é a mesma sessão');
  assert.equal(novo.coleta.estado.estado, ESTADO_COLETA.PAUSADA);
  assert.equal(novo.coleta.estado.pontos, 1, 'os pontos já gravados são contabilizados');

  // e a coleta pode seguir de onde parou
  await novo.coleta.retomar();
  assert.equal(novo.coleta.estado.estado, ESTADO_COLETA.ATIVA);
  novo.fonte.emitir(posicao(-23.7005, -46.5005, { timestamp: 1700000010000 }));
  await novo.coleta.pausar();

  const pontos = await novo.armazenamento.listarPontos(sessaoId);
  assert.equal(pontos.length, 2, 'o trajeto continua na mesma sessão');
  assert.equal(pontos[1].ordem, 2, 'a numeração dos pontos continua');
});

test('coleta: a distância é recalculada a partir dos pontos ao recuperar', async () => {
  const { coleta, armazenamento, fonte } = setup();
  await coleta.iniciar();
  fonte.emitir(posicao(-23.7000, -46.5000));
  fonte.emitir(posicao(-23.7010, -46.5000, { timestamp: 1700000010000 }));
  await new Promise((r) => setTimeout(r, 10));
  const sessaoId = coleta.estado.sessaoId;

  const novo = setup({}, armazenamento);
  const abertas = await novo.armazenamento.listarSessoesAbertas();
  await novo.coleta.adota(abertas[0].id);

  const d = novo.coleta.estado.distancia;
  assert.ok(d > 100 && d < 120, `distância recalculada inesperada: ${d}`);
});

test('coleta: a simulação grava pontos identificados como simulados', async () => {
  const armazenamento = criarArmazenamento({ adaptador: criarAdaptadorMemoria() });
  const plano = planoDeNavegacao(respostaDeRota());
  let simulador = null;
  const coleta = criarColeta({
    armazenamento,
    criarFonte: (handlers) => {
      simulador = criarSimulador({
        plano,
        velocidadeMultiplicador: 25,
        aoAtualizar: handlers.aoAtualizar,
      });
      return simulador;
    },
  });

  const r = await coleta.iniciar({ fonte: FONTE.SIMULACAO });
  assert.equal(r.ok, true);
  assert.equal(coleta.estado.fonte, FONTE.SIMULACAO);

  // o simulador percorre a geometria da rota
  simulador.avancar(40);
  simulador.avancar(40);
  simulador.avancar(40);
  await coleta.pausar();

  const pontos = await armazenamento.listarPontos(coleta.estado.sessaoId);
  assert.ok(pontos.length >= 2, 'a simulação gravou pontos');
  assert.ok(
    pontos.every((p) => p.simulado === true),
    'todo ponto simulado fica marcado como simulado',
  );
  assert.ok(
    pontos.every((p) => p.fonte === FONTE.SIMULACAO),
    'todo ponto simulado carrega a origem da posição',
  );

  const sessao = await armazenamento.obterSessao(coleta.estado.sessaoId);
  assert.equal(sessao.fonte, FONTE.SIMULACAO, 'a sessão registra a origem da posição');
});

test('coleta: a residência marcada em modo de teste fica marcada como simulada', async () => {
  const armazenamento = criarArmazenamento({ adaptador: criarAdaptadorMemoria() });
  const plano = planoDeNavegacao(respostaDeRota());
  let simulador = null;
  const coleta = criarColeta({
    armazenamento,
    criarFonte: (handlers) => {
      simulador = criarSimulador({ plano, aoAtualizar: handlers.aoAtualizar });
      return simulador;
    },
  });
  await coleta.iniciar({ fonte: FONTE.SIMULACAO });
  simulador.avancar(30);
  await new Promise((r) => setTimeout(r, 10));

  const r = await coleta.marcarResidencia();
  assert.equal(r.ok, true);
  assert.equal(r.localizacao.fonte, FONTE.SIMULACAO, 'não se confunde com uma medição de campo');
  const lista = await armazenamento.listarResidencias();
  assert.equal(lista[0].fonte, FONTE.SIMULACAO);
});

test('coleta: a posição real (GPS) não é marcada como simulada', async () => {
  const { coleta, fonte, armazenamento } = setup();
  await coleta.iniciar();
  fonte.emitir(posicao(-23.7000, -46.5000));
  await coleta.pausar();

  const pontos = await armazenamento.listarPontos(coleta.estado.sessaoId);
  assert.equal(pontos[0].simulado, false);
  assert.equal(pontos[0].fonte, FONTE.GPS);
  const sessao = await armazenamento.obterSessao(coleta.estado.sessaoId);
  assert.equal(sessao.fonte, FONTE.GPS);
});

test('coleta: marcar a residência grava a localização atual ligada à sessão', async () => {
  const { coleta, fonte, armazenamento } = setup();
  await coleta.iniciar();
  fonte.emitir(posicao(-23.7000, -46.5000));
  await new Promise((r) => setTimeout(r, 10));

  const r = await coleta.marcarResidencia({ classificacao: CLASSIFICACAO.NOVA });
  assert.equal(r.ok, true);
  assert.equal(r.localizacao.latitude, -23.7);
  assert.equal(r.localizacao.sessaoId, coleta.estado.sessaoId, 'a residência fica ligada à sessão');
  assert.ok(r.localizacao.enderecoDigital, 'a localização tem Plus Code');
  assert.equal(r.localizacao.classificacao, CLASSIFICACAO.NOVA);

  const lista = await armazenamento.listarResidencias();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].id, r.localizacao.id);
  assert.equal(lista[0].fonte, FONTE.GPS, 'a localização real é marcada como tal');
});

test('coleta: marcar a residência sem posição é recusado', async () => {
  const { coleta } = setup();
  // sem sessão nem posição: o motivo é informado, nunca um registro vazio
  const semSessao = await coleta.marcarResidencia();
  assert.equal(semSessao.ok, false);
  assert.equal(semSessao.motivo, 'SEM_SESSAO');

  await coleta.iniciar();
  const semPosicao = await coleta.marcarResidencia();
  assert.equal(semPosicao.ok, false);
  assert.equal(semPosicao.motivo, 'SEM_POSICAO');
});

test('coleta: erro de GPS vira aviso e marca sinal perdido', async () => {
  const { coleta, fonte } = setup();
  await coleta.iniciar();
  fonte.falhar({ codigo: 'POSITION_UNAVAILABLE', mensagem: 'Sinal indisponível.' });

  assert.equal(coleta.estado.sinalPerdido, true);
  assert.ok(coleta.estado.avisos.some((a) => /Sinal indisponível/.test(a.texto)));
});

test('coleta: lat/lon inválidos são descartados', async () => {
  const { coleta, fonte, armazenamento } = setup();
  await coleta.iniciar();
  fonte.emitir({ latitude: 999, longitude: -46.5, timestamp: 1700000000000 });
  await coleta.pausar();
  assert.equal((await armazenamento.listarPontos(coleta.estado.sessaoId)).length, 0);
  assert.equal(coleta.estado.descartados, 1);
});

test('residência: a localização carrega coordenadas, precisão e Plus Code local', async () => {
  const r = montarLocalizacaoResidencia({
    posicao: { latitude: -23.6635, longitude: -46.532, precisao: 6.5 },
    classificacao: CLASSIFICACAO.NOVA,
    agenteId: 'agente_1',
  });

  assert.equal(r.ok, true);
  assert.equal(r.localizacao.latitude, -23.6635);
  assert.equal(r.localizacao.precisao, 6.5);
  assert.equal(r.localizacao.classificacao, 'nova');
  assert.ok(r.localizacao.enderecoDigital, 'o Plus Code é calculado localmente');
  assert.match(r.localizacao.enderecoDigital, /^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,}$/);
  assert.ok(r.localizacao.id.startsWith('res_'));
});

test('residência: coordenada inválida é recusada', async () => {
  const r = montarLocalizacaoResidencia({ posicao: { latitude: null, longitude: null } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'COORDENADA_INVALIDA');
});

test('residência: cadastro duplicado próximo é detectado', async () => {
  const lista = [
    { id: 'res_1', latitude: -23.6635, longitude: -46.532, enderecoDigital: '8FP9+J6' },
  ];
  const dup = detectarDuplicado(lista, { latitude: -23.663501, longitude: -46.532001 }, 30);
  assert.ok(dup, 'a localização próxima deve ser apontada');
  assert.equal(dup.id, 'res_1');
  assert.ok(dup.distancia < 3);

  const longe = detectarDuplicado(lista, { latitude: -23.7, longitude: -46.6 }, 30);
  assert.equal(longe, null);
});

test('residência: captura única devolve a posição do aparelho', async () => {
  const geolocation = {
    getCurrentPosition(ok) {
      ok({
        coords: { latitude: -23.6635, longitude: -46.532, accuracy: 7 },
        timestamp: 1700000000000,
      });
    },
  };
  const r = await capturarPosicao({ geolocation });
  assert.equal(r.ok, true);
  assert.equal(r.posicao.latitude, -23.6635);
  assert.equal(r.posicao.precisao, 7);
});

test('residência: permissão negada vira mensagem clara', async () => {
  const geolocation = {
    getCurrentPosition(ok, fail) {
      fail({ code: 1, message: 'denied' });
    },
  };
  const r = await capturarPosicao({ geolocation });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'PERMISSION_DENIED');
  assert.match(r.message, /Permissão/i);
});

test('regressão F02: adotar sessão restaura fonte, contadores e contexto da fábrica', async () => {
  const armazenamento = criarArmazenamento({ adaptador: criarAdaptadorMemoria() });
  await armazenamento.salvarSessao({ id: 'ses_sim', fonte: FONTE.SIMULACAO, estado: 'ativa', rotaId: 'r1', versaoRota: 3 });
  await armazenamento.adicionarPontos('ses_sim', [
    { id: 'p1', ordem: 4, latitude: -23.7, longitude: -46.5, timestamp: 1700000000000, simulado: true, fonte: FONTE.SIMULACAO, tipo: TIPO_PONTO.ESTIMADO },
  ]);
  let contexto;
  const coleta = criarColeta({ armazenamento, criarFonte: (_handlers, ctx) => {
    contexto = ctx;
    return { iniciar() {}, parar() {} };
  } });
  await coleta.adota('ses_sim');
  assert.equal(coleta.estado.fonte, FONTE.SIMULACAO);
  assert.equal(coleta.estado.estimados, 1);
  await coleta.retomar();
  assert.equal(contexto.fonte, FONTE.SIMULACAO);
  assert.equal(contexto.rotaId, 'r1');
  assert.equal(contexto.versaoRota, 3);
  const p = await coleta.registrarManual(posicao(-23.701, -46.5, { simulado: true }));
  assert.equal(p.ponto.ordem, 5, 'a ordem não deve retroceder para o total de pontos');
  await coleta.encerrar();
});

test('regressão F03: estimativa de lacuna simulada preserva a proveniência', async () => {
  const { coleta, armazenamento, fonte } = setup();
  await coleta.iniciar({ fonte: FONTE.SIMULACAO });
  fonte.emitir(posicao(-23.7, -46.5, { simulado: true }));
  fonte.emitir(posicao(-23.701, -46.5, { simulado: true, timestamp: 1700000060000 }));
  await coleta.pausar();
  const pontos = await armazenamento.listarPontos(coleta.estado.sessaoId);
  assert.equal(pontos.length, 3);
  assert.equal(pontos[1].tipo, TIPO_PONTO.ESTIMADO);
  assert.ok(pontos.every(p => p.simulado && p.fonte === FONTE.SIMULACAO));
});

test('regressão F04: falha transitória de escrita retém lote e ordem sem duplicar', async () => {
  const { coleta, fonte, armazenamento } = setup();
  const salvar = armazenamento.adicionarPontos.bind(armazenamento);
  let rejeitar;
  let iniciar;
  const iniciou = new Promise(resolve => { iniciar = resolve; });
  let chamadas = 0;
  armazenamento.adicionarPontos = async (...args) => {
    if (++chamadas === 1) {
      iniciar();
      await new Promise((_resolve, reject) => { rejeitar = reject; });
    }
    return salvar(...args);
  };
  await coleta.iniciar();
  fonte.emitir(posicao(-23.7, -46.5));
  await iniciou;
  fonte.emitir(posicao(-23.7005, -46.5, { timestamp: 1700000010000 }));
  rejeitar(new Error('quota temporária'));
  await coleta.pausar();
  const pontos = await armazenamento.listarPontos(coleta.estado.sessaoId);
  assert.deepEqual(pontos.map(p => p.ordem), [1, 2]);
  assert.equal(new Set(pontos.map(p => p.id)).size, 2);
  assert.ok(coleta.estado.avisos.some(a => /quota temporária/.test(a.texto)));
});

test('regressão F04: falha persistente não encerra nem descarta a coleta', async () => {
  const { coleta, fonte, armazenamento } = setup({ lote: 10 });
  const salvar = armazenamento.adicionarPontos.bind(armazenamento);
  await coleta.iniciar();
  fonte.emitir(posicao(-23.7, -46.5));
  armazenamento.adicionarPontos = async () => { throw new Error('disco cheio'); };
  await assert.rejects(() => coleta.encerrar(), /disco cheio/);
  assert.notEqual(coleta.estado.estado, ESTADO_COLETA.ENCERRADA);
  assert.equal(fonte.chamadas.paradas, 1, 'fonte é desligada antes de aguardar escrita');
  armazenamento.adicionarPontos = salvar;
  await coleta.encerrar();
  assert.equal((await armazenamento.listarPontos(coleta.estado.sessaoId)).length, 1);
});

test('coleta: uma sessão pausada não pode ser substituída por nova sessão', async () => {
  const { coleta, armazenamento } = setup();
  await coleta.iniciar();
  const id = coleta.estado.sessaoId;
  await coleta.pausar();
  assert.equal((await coleta.iniciar()).ok, false);
  assert.equal(coleta.estado.sessaoId, id);
  assert.equal((await armazenamento.listarSessoes()).length, 1);
});

for (const fonteSessao of [FONTE.GPS, FONTE.SIMULACAO]) {
  test(`coleta recusa leitura e registro manual de fonte incompatível (${fonteSessao})`, async () => {
    const { coleta, fonte, armazenamento } = setup();
    await coleta.iniciar({ fonte: fonteSessao });
    const p = posicao(-23.7, -46.5, { simulado: fonteSessao !== FONTE.SIMULACAO });
    fonte.emitir(p);
    assert.equal((await coleta.registrarManual(p)).motivo, 'FONTE_INCOMPATIVEL');
    await coleta.encerrar();
    assert.equal((await armazenamento.listarPontos(coleta.estado.sessaoId)).length, 0);
  });
}

test('coleta: falha ao persistir encerramento mantém sessão recuperável e permite retry', async () => {
  const { coleta, armazenamento, fonte } = setup();
  await coleta.iniciar();
  fonte.emitir(posicao(-23.7, -46.5));
  const salvar = armazenamento.salvarSessao.bind(armazenamento);
  armazenamento.salvarSessao = async () => { throw new Error('metadados indisponíveis'); };
  await assert.rejects(() => coleta.encerrar(), /metadados indisponíveis/);
  assert.equal(coleta.estado.estado, ESTADO_COLETA.PAUSADA);
  armazenamento.salvarSessao = salvar;
  assert.equal((await coleta.encerrar()).ok, true);
  assert.equal((await armazenamento.listarPontos(coleta.estado.sessaoId)).length, 1);
});
