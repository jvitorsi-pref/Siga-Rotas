import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  carregarCamadaBaseMobile,
  salvarCamadaBaseMobile,
} from '../src/services/basemapPreference.js';

// Verifica que AsyncStorage no runtime nativo é usado no módulo fino e testável via storage injetado.
test('basemapPreference persiste escolha de camada base e tolera falhas de AsyncStorage', async () => {
  const store = new Map();
  const mockStorage = {
    async getItem(k) { return store.has(k) ? store.get(k) : null; },
    async setItem(k, v) { store.set(k, v); },
  };

  assert.equal(await carregarCamadaBaseMobile(mockStorage), 'osm');
  await salvarCamadaBaseMobile('satelite', mockStorage);
  assert.equal(await carregarCamadaBaseMobile(mockStorage), 'satelite');

  const failingStorage = {
    async getItem() { throw new Error('storage locked'); },
    async setItem() { throw new Error('disk full'); },
  };
  assert.equal(await carregarCamadaBaseMobile(failingStorage), 'osm');
  const res = await salvarCamadaBaseMobile('satelite', failingStorage);
  assert.equal(res.ok, false);
});

test('APK App.js e basemapPreference.js integram AsyncStorage e RoadNetworkMap com paridade Web', () => {
  const binding = readFileSync(new URL('../src/services/basemapPreference.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.js', import.meta.url), 'utf8');

  assert.match(binding, /@react-native-async-storage\/async-storage/);
  assert.match(app, /carregarCamadaBaseMobile\(\)/);
  assert.match(app, /salvarCamadaBaseMobile\(proximo\)/);
  assert.match(app, /basemapTouchedRef\.current/);
  assert.match(app, /basemapMode=\{basemapMode\}/);
  assert.match(app, /onChangeBasemap=\{handleChangeBasemap\}/);
});
