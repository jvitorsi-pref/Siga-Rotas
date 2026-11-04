import test from 'node:test';
import assert from 'node:assert/strict';
import { criarArmazenamento, criarAdaptadorMemoria } from '../core/armazenamentoLocal.js';
import { prepararRetomadaSimulada } from '../core/recuperacaoColeta.js';
function repo() { return criarArmazenamento({ adaptador: criarAdaptadorMemoria() }); }
const coords = [[-46.5, -23.7], [-46.5, -23.698]];
const rota = { id: 'r1', versao: 2, legs: [{ de: 'A', para: 'B', geometry: { type: 'LineString', coordinates: coords } }], sequenciaCompleta: ['A', 'B'] };
const estado = { rotaId: 'r1', versaoRota: 2, sessaoId: 's1', distancia: 111 };
test('retomada simulada usa a versão exata do plano e a última posição salva', async () => {
  const r = repo(); await r.salvarRota(rota); await r.salvarSessao({ id: 's1', fonte: 'simulacao' });
  await r.adicionarPontos('s1', [{ ordem: 1, latitude: -23.699, longitude: -46.5 }]);
  const result = await prepararRetomadaSimulada(r, estado);
  assert.equal(result.ok, true); assert.ok(result.distancia > 100 && result.distancia < 120);
});
test('retomada sem plano original não usa outro plano nem GPS como fallback', async () => {
  const r = repo(); await r.salvarRota({ ...rota, id: 'outra' });
  assert.equal((await prepararRetomadaSimulada(r, estado)).ok, false);
});
test('retomada recusa versão diferente do mesmo plano', async () => {
  const r = repo(); await r.salvarRota({ ...rota, versao: 3 });
  assert.equal((await prepararRetomadaSimulada(r, estado)).ok, false);
});
test('retomada recusa plano sem trechos roteados', async () => {
  const r = repo(); await r.salvarRota({ ...rota, legs: [] });
  assert.equal((await prepararRetomadaSimulada(r, estado)).ok, false);
});
