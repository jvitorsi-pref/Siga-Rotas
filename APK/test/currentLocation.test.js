import test from 'node:test';
import assert from 'node:assert/strict';
import { obterLocalizacaoAtualCore } from '../src/services/currentLocationCore.js';

function mockLocationApi(overrides = {}) {
  return {
    Accuracy: { High: 4, Balanced: 3 },
    hasServicesEnabledAsync: async () => true,
    requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
    getLastKnownPositionAsync: async () => null,
    getCurrentPositionAsync: async () => ({
      coords: {
        latitude: -23.6639,
        longitude: -46.5382,
        accuracy: 11.4,
        heading: 90,
        speed: 0.4,
      },
      timestamp: 1700000000000,
    }),
    ...overrides,
  };
}

test('obterLocalizacaoAtualCore retorna posição real com precisão e simulado=false quando permissão concedida', async () => {
  const res = await obterLocalizacaoAtualCore({ locationApi: mockLocationApi() });
  assert.equal(res.ok, true);
  assert.equal(res.posicao.simulado, false);
  assert.equal(res.posicao.latitude, -23.6639);
  assert.equal(res.posicao.longitude, -46.5382);
  assert.equal(res.posicao.precisao, 11.4);
});

test('obterLocalizacaoAtualCore rejeita com erro claro quando permissão é negada', async () => {
  const res = await obterLocalizacaoAtualCore({
    locationApi: mockLocationApi({
      requestForegroundPermissionsAsync: async () => ({ status: 'denied' }),
    }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.codigo, 'PERMISSION_DENIED');
  assert.match(res.message, /permissão/i);
});

test('obterLocalizacaoAtualCore reporta GPS desativado no aparelho sem fallback para ponto fixo', async () => {
  const res = await obterLocalizacaoAtualCore({
    locationApi: mockLocationApi({
      hasServicesEnabledAsync: async () => false,
    }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.codigo, 'LOCATION_DISABLED');
  assert.match(res.message, /desativado/i);
});

test('obterLocalizacaoAtualCore usa última posição recente em timeout e retorna TIMEOUT quando ausente', async () => {
  const agora = 1700000010000;
  const comRecente = await obterLocalizacaoAtualCore({
    agoraMs: agora,
    timeoutMs: 50,
    locationApi: mockLocationApi({
      getCurrentPositionAsync: () => new Promise(() => {}),
      getLastKnownPositionAsync: async () => ({
        coords: { latitude: -23.66, longitude: -46.53, accuracy: 20 },
        timestamp: agora - 10000,
      }),
    }),
  });
  assert.equal(comRecente.ok, true);
  assert.equal(comRecente.cache, true);
  assert.equal(comRecente.posicao.simulado, false);

  const semRecente = await obterLocalizacaoAtualCore({
    agoraMs: agora,
    timeoutMs: 30,
    locationApi: mockLocationApi({
      getCurrentPositionAsync: () => new Promise(() => {}),
      getLastKnownPositionAsync: async () => null,
    }),
  });
  assert.equal(semRecente.ok, false);
  assert.equal(semRecente.codigo, 'TIMEOUT');
});
