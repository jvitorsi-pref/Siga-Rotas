import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gerarGpxRota, nomeArquivoGpx } from '../src/utils/gpx.js';
import {
  exportarRotaGpxMobileCore as exportarRotaGpxMobile,
  descreverPastaSaf,
} from '../src/services/mobileGpxExportCore.js';
import { resolverPontoNoMapa } from '../src/utils/planejamentoCircuito.js';
import { STATUS } from '../src/core/pontoTrajeto.js';
import { ResolverEnderecoDigital } from '../src/core/enderecoDigital.js';

const rotaExemplo = () => ({
  ok: true,
  parcial: false,
  circular: true,
  modo: 'usuario',
  distance: 620,
  sequenciaCompleta: ['A', 'B', 'A'],
  pontos: [
    { rotulo: 'A', latitude: -23.6635, longitude: -46.5320, enderecoDigital: '8FP9+J6', ordem: 1 },
    { rotulo: 'B', latitude: -23.6660, longitude: -46.5290, enderecoDigital: '8FMF+RC', ordem: 2 },
  ],
  legs: [
    {
      de: 'A',
      para: 'B',
      retorno: false,
      distance: 310,
      geometry: { type: 'LineString', coordinates: [[-46.5320, -23.6635], [-46.5290, -23.6660]] },
    },
    {
      de: 'B',
      para: 'A',
      retorno: true,
      distance: 310,
      geometry: { type: 'LineString', coordinates: [[-46.5290, -23.6660], [-46.5320, -23.6635]] },
    },
  ],
});

test('APK GPX: utilitário compartilhado gera GPX 1.1 válido e nome determinístico', () => {
  const xml = gerarGpxRota(rotaExemplo());
  assert.match(xml, /<gpx version="1\.1"/);
  assert.equal((xml.match(/<trkseg>/g) || []).length, 2);
  const nome = nomeArquivoGpx(rotaExemplo(), new Date(2026, 10, 16, 14, 22));
  assert.equal(nome, 'siga-rota-A-B-A-2026-11-16_14-22.gpx');
});

test('APK GPX: SAF solicita pasta, cria .gpx e grava conteúdo UTF-8 real', async () => {
  const chamadas = [];
  const fileSystem = {
    EncodingType: { UTF8: 'utf8' },
    StorageAccessFramework: {
      async requestDirectoryPermissionsAsync() {
        return {
          granted: true,
          directoryUri: 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2FRotas',
        };
      },
      async createFileAsync(dirUri, nome, mime) {
        chamadas.push({ fn: 'create', dirUri, nome, mime });
        return `${dirUri}/document/${nome}`;
      },
    },
    async writeAsStringAsync(uri, conteudo, opts) {
      chamadas.push({ fn: 'write', uri, conteudo, opts });
    },
  };

  const res = await exportarRotaGpxMobile(rotaExemplo(), { fileSystem });
  assert.equal(res.ok, true);
  assert.equal(res.modo, 'saf');
  assert.equal(res.pasta, 'Download/Rotas');
  assert.match(res.arquivo, /^siga-rota-A-B-A-.*\.gpx$/);
  assert.equal(chamadas[0].mime, 'application/gpx+xml');
  assert.deepEqual(chamadas[1].opts, { encoding: 'utf8' });
  assert.match(chamadas[1].conteudo, /<gpx version="1\.1"/);
});

test('APK GPX: cancelamento no seletor Android SAF não cria nem grava arquivo', async () => {
  let criou = false;
  const fileSystem = {
    StorageAccessFramework: {
      async requestDirectoryPermissionsAsync() {
        return { granted: false };
      },
      async createFileAsync() {
        criou = true;
        return '';
      },
    },
    async writeAsStringAsync() {
      criou = true;
    },
  };

  const res = await exportarRotaGpxMobile(rotaExemplo(), { fileSystem });
  assert.equal(res.ok, false);
  assert.equal(res.cancelado, true);
  assert.equal(res.motivo, 'CANCELADO');
  assert.equal(criou, false);
});

test('APK GPX: falha ao gravar remove arquivo vazio criado no SAF e reporta erro', async () => {
  let removido = null;
  const fileSystem = {
    StorageAccessFramework: {
      async requestDirectoryPermissionsAsync() {
        return { granted: true, directoryUri: 'content://tree/primary%3ADocuments' };
      },
      async createFileAsync(_dir, nome) {
        return `content://doc/${nome}`;
      },
    },
    async writeAsStringAsync() {
      throw new Error('E/S indisponível');
    },
    async deleteAsync(uri, opts) {
      removido = { uri, opts };
    },
  };

  const res = await exportarRotaGpxMobile(rotaExemplo(), { fileSystem });
  assert.equal(res.ok, false);
  assert.equal(res.motivo, 'ERRO_GRAVACAO');
  assert.match(removido.uri, /^content:\/\/doc\/siga-rota-/);
  assert.deepEqual(removido.opts, { idempotent: true });
});

test('APK GPX: descreverPastaSaf interpreta URIs SAF e sem rota recusa antes do seletor', async () => {
  assert.equal(descreverPastaSaf('content://com.android.externalstorage.documents/tree/primary%3ADownload%2FGpx'), 'Download/Gpx');
  let abriu = false;
  const res = await exportarRotaGpxMobile({ ok: true, parcial: true }, {
    fileSystem: {
      StorageAccessFramework: {
        async requestDirectoryPermissionsAsync() { abriu = true; return { granted: false }; },
        async createFileAsync() { return ''; },
      },
      async writeAsStringAsync() {},
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.motivo, 'SEM_ROTA');
  assert.equal(abriu, false);
});

test('APK Req 4: seleção no mapa preenche Plus Code automaticamente dentro da área e trata fora da área', () => {
  const dentro = resolverPontoNoMapa(-23.6635, -46.5320);
  assert.equal(dentro.status, STATUS.CONVERTIDO);
  assert.equal(ResolverEnderecoDigital(dentro.enderecoDigital).ok, true);

  const fora = resolverPontoNoMapa(-22.9068, -43.1729);
  assert.equal(fora.status, STATUS.FORA_DA_AREA);
  assert.equal(fora.enderecoDigital, '');

  const app = readFileSync(new URL('../App.js', import.meta.url), 'utf8');
  const binding = readFileSync(new URL('../src/services/mobileGpxExport.js', import.meta.url), 'utf8');
  assert.match(app, /handleMapPickCoordinate[\s\S]*?resolverPontoNoMapa\(lat,\s*lon/);
  assert.match(app, /handleExportGpx[\s\S]*?exportarRotaGpxMobile\(routeResult/);
  assert.match(binding, /from 'expo-file-system'/);
  assert.match(binding, /exportarRotaGpxMobileCore/);
});
