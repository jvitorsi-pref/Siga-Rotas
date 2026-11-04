/**
 * test/armazenamentoLocal.test.js
 * ---------------------------------------------------------------------------
 * Testes da persistência local (IndexedDB), exercitados com o adaptador em
 * memória — a **mesma interface** do adaptador real, inclusive com
 * transações atômicas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ESTADO,
  STORE,
  TIPO_OPERACAO,
  criarAdaptadorMemoria,
  criarArmazenamento,
  novoId,
} from '../core/armazenamentoLocal.js';

function novoArmazenamento(extra = {}) {
  return criarArmazenamento({ adaptador: criarAdaptadorMemoria(), ...extra });
}

function rotaDeExemplo(over = {}) {
  return {
    id: 'rta_teste',
    modo: 'otimizada',
    circular: false,
    versao: 3,
    pontos: [
      { rotulo: 'A', latitude: -23.7, longitude: -46.5 },
      { rotulo: 'B', latitude: -23.71, longitude: -46.51 },
    ],
    sequencia: ['A', 'B'],
    sequenciaCompleta: ['A', 'B'],
    legs: [{ de: 'A', para: 'B', distance: 1234.5 }],
    geometry: [
      [-46.5, -23.7],
      [-46.51, -23.71],
    ],
    distance: 1234.5,
    ...over,
  };
}

test('armazenamento: abre, salva e recupera uma rota planejada', async () => {
  const repo = novoArmazenamento();
  await repo.abrir();

  const salva = await repo.salvarRota(rotaDeExemplo());
  assert.equal(salva.id, 'rta_teste');
  assert.equal(salva.estado, ESTADO.PENDENTE);
  assert.equal(salva.versao, 3);
  assert.equal(salva.legs.length, 1);
  assert.equal(salva.geometry.length, 2);

  const lida = await repo.obterRota('rta_teste');
  assert.ok(lida, 'a rota deve ser recuperável');
  assert.equal(lida.distance, 1234.5);
  assert.equal(lida.sequenciaCompleta.join('→'), 'A→B');

  const todas = await repo.listarRotas();
  assert.equal(todas.length, 1);
});

test('armazenamento: salvar a rota cria uma operação pendente na fila', async () => {
  const repo = novoArmazenamento();
  await repo.abrir();
  await repo.salvarRota(rotaDeExemplo());

  const ops = await repo.listarOperacoes();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].tipo, TIPO_OPERACAO.ROTA);
  assert.equal(ops[0].registroId, 'rta_teste');
  assert.equal(ops[0].estado, ESTADO.PENDENTE);

  const pendentes = await repo.listarOperacoesPendentes();
  assert.equal(pendentes.length, 1);
});

test('armazenamento: salvar a mesma rota de novo não duplica a fila', async () => {
  const repo = novoArmazenamento();
  await repo.abrir();
  await repo.salvarRota(rotaDeExemplo());
  await repo.salvarRota(rotaDeExemplo({ distance: 1300 }));
  await repo.salvarRota(rotaDeExemplo({ distance: 1350 }));

  const ops = await repo.listarOperacoes();
  assert.equal(ops.length, 1, 'a fila deve ter uma única operação por registro');
  assert.equal(ops[0].tentativas, 3);
  assert.equal((await repo.obterRota('rta_teste')).distance, 1350);
});

test('armazenamento: pontos ficam vinculados à sessão e são contados', async () => {
  const repo = novoArmazenamento();
  await repo.abrir();
  const sessao = await repo.salvarSessao({ agenteId: 'agente_1', dispositivoId: 'disp_1' });

  await repo.adicionarPontos(sessao.id, [
    { ordem: 1, latitude: -23.7, longitude: -46.5, tipo: 'medido' },
    { ordem: 2, latitude: -23.71, longitude: -46.51, tipo: 'medido' },
  ]);

  const pontos = await repo.listarPontos(sessao.id);
  assert.equal(pontos.length, 2);
  assert.equal(pontos[0].ordem, 1);
  assert.equal(pontos[0].estadoSync, ESTADO.PENDENTE);
  assert.equal(await repo.contarPontos(sessao.id), 2);
  assert.equal((await repo.obterSessao(sessao.id)).pontos, 2);

  // a fila ganha uma operação do tipo "pontos"
  const ops = await repo.listarOperacoes();
  assert.ok(ops.some((o) => o.tipo === TIPO_OPERACAO.PONTOS));
});

test('armazenamento: sessão interrompida é recuperável (lista de abertas)', async () => {
  const repo = novoArmazenamento();
  await repo.abrir();
  await repo.salvarSessao({ estado: 'ativa' });
  await repo.salvarSessao({ estado: 'pausada' });
  await repo.salvarSessao({ estado: 'encerrada' });

  const abertas = await repo.listarSessoesAbertas();
  assert.equal(abertas.length, 2, 'só as sessões ativas/pausadas são recuperáveis');
  assert.ok(abertas.every((s) => s.estado !== 'encerrada'));
});

test('armazenamento: transação atômica — falha não deixa registro pela metade', async () => {
  const adaptador = criarAdaptadorMemoria();
  const repo = criarArmazenamento({ adaptador });
  await repo.abrir();
  await repo.salvarRota(rotaDeExemplo({ id: 'rta_ok' }));

  const antes = (await repo.listarRotas()).length;
  await assert.rejects(
    () =>
      adaptador.transacao([STORE.ROTAS], 'readwrite', async (ctx) => {
        await ctx.salvar(STORE.ROTAS, { id: 'rta_meio', distance: 10 });
        throw new Error('falha simulada');
      }),
    /falha simulada/,
  );

  const depois = await repo.listarRotas();
  assert.equal(depois.length, antes, 'nada pode ser gravado pela metade');
  assert.equal(await repo.obterRota('rta_meio'), null);
});

test('armazenamento: registro não sincronizado não pode ser apagado', async () => {
  const repo = novoArmazenamento();
  await repo.abrir();
  await repo.salvarRota(rotaDeExemplo());

  const recusa = await repo.removerRota('rta_teste');
  assert.equal(recusa.ok, false);
  assert.equal(recusa.motivo, 'NAO_SINCRONIZADO');
  assert.ok((await repo.obterRota('rta_teste')) !== null, 'a rota continua no dispositivo');

  // depois de confirmada pelo servidor, pode sair
  await repo.marcarEstadoRegistro(STORE.ROTAS, 'rta_teste', ESTADO.SINCRONIZADO);
  const remocao = await repo.removerRota('rta_teste');
  assert.equal(remocao.ok, true);
  assert.equal(await repo.obterRota('rta_teste'), null);
});

test('armazenamento: marcar estado atualiza o registro e a operação', async () => {
  const repo = novoArmazenamento();
  await repo.abrir();
  await repo.salvarRota(rotaDeExemplo());

  await repo.marcarEstadoRegistro(STORE.ROTAS, 'rta_teste', ESTADO.SINCRONIZADO);
  assert.equal((await repo.obterRota('rta_teste')).estado, ESTADO.SINCRONIZADO);
  const ops = await repo.listarOperacoes();
  assert.equal(ops[0].estado, ESTADO.SINCRONIZADO);
});

test('armazenamento: erro fica registrado na operação', async () => {
  const repo = novoArmazenamento();
  await repo.abrir();
  await repo.salvarRota(rotaDeExemplo());
  const [op] = await repo.listarOperacoes();

  await repo.atualizarOperacao(op.id, { estado: ESTADO.ERRO, ultimoErro: 'timeout' });
  const [atualizada] = await repo.listarOperacoes();
  assert.equal(atualizada.estado, ESTADO.ERRO);
  assert.equal(atualizada.ultimoErro, 'timeout');

  const pendentes = await repo.listarOperacoesPendentes();
  assert.equal(pendentes.length, 1, 'operação com erro continua pendente');
});

test('armazenamento: limpeza só apaga o que já foi sincronizado', async () => {
  const repo = novoArmazenamento();
  await repo.abrir();
  const sincronizada = await repo.salvarRota(rotaDeExemplo({ id: 'rta_sync' }));
  const pendente = await repo.salvarRota(rotaDeExemplo({ id: 'rta_pend' }));
  await repo.marcarEstadoRegistro(STORE.ROTAS, sincronizada.id, ESTADO.SINCRONIZADO);

  const removidos = await repo.limpar({ somenteSincronizados: true });
  assert.equal(removidos.rotas, 1);
  assert.equal(await repo.obterRota('rta_sync'), null);
  assert.ok((await repo.obterRota(pendente.id)) !== null, 'o pendente não pode ser apagado');
});

test('armazenamento: estatísticas resumem o que está no dispositivo', async () => {
  const repo = novoArmazenamento();
  await repo.abrir();
  await repo.salvarRota(rotaDeExemplo());
  const sessao = await repo.salvarSessao({});
  await repo.adicionarPontos(sessao.id, [{ ordem: 1, latitude: 0, longitude: 0 }]);
  await repo.salvarResidencia({ latitude: -23.7, longitude: -46.5, enderecoDigital: '8FP9+J6' });

  const st = await repo.estatisticas();
  assert.equal(st.rotas, 1);
  assert.equal(st.sessoes, 1);
  assert.equal(st.pontos, 1);
  assert.equal(st.residencias, 1);
  assert.equal(st.pendentes, 4, 'rota + sessão + pontos + residência na fila');
});

test('armazenamento: histórico de alterações da residência é acrescentado', async () => {
  const repo = novoArmazenamento();
  await repo.abrir();
  const res = await repo.salvarResidencia({
    latitude: -23.7,
    longitude: -46.5,
    classificacao: 'nova',
  });
  await repo.registrarHistoricoResidencia(res.id, {
    evento: 'corrigida',
    de: { latitude: -23.7, longitude: -46.5 },
    para: { latitude: -23.7001, longitude: -46.5001 },
  });

  const lida = await repo.obterResidencia(res.id);
  assert.equal(lida.historico.length, 1);
  assert.equal(lida.historico[0].evento, 'corrigida');
  assert.ok(lida.historico[0].em, 'o histórico tem data');
});

test('armazenamento: identificadores são únicos e prefixados', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) {
    const id = novoId('rta');
    assert.ok(id.startsWith('rta_'));
    ids.add(id);
  }
  assert.equal(ids.size, 500);
});

test('regressão F01: GeoJSON da API sobrevive à persistência e reabertura', async () => {
  const repo = novoArmazenamento();
  const coordinates = [[-46.5, -23.7], [-46.51, -23.71]];
  await repo.salvarRota(rotaDeExemplo({ geometry: { type: 'LineString', coordinates } }));
  const reaberto = criarArmazenamento({ adaptador: repo.adaptador });
  assert.deepEqual((await reaberto.obterRota('rta_teste')).geometry, coordinates);
});
