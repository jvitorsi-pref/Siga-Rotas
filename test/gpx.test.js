import test from 'node:test';
import assert from 'node:assert/strict';
import { gerarGpxRota, nomeArquivoGpx } from '../public/gpx.js';
import { exportarRotaGpxWeb } from '../public/exportarGpxWeb.js';

function rotaExemplo() {
  return {
    ok: true,
    parcial: false,
    circular: true,
    modo: 'otimizada',
    distance: 1420,
    sequencia: ['A', 'C', 'B'],
    sequenciaCompleta: ['A', 'C', 'B', 'A'],
    pontos: [
      { rotulo: 'A', latitude: -23.6635, longitude: -46.5320, enderecoDigital: '8FP9+J6', ordem: 1 },
      { rotulo: 'B', latitude: -23.6660, longitude: -46.5290, enderecoDigital: '8FMF+RC', ordem: 3 },
      { rotulo: 'C', latitude: -23.6610, longitude: -46.5305, enderecoDigital: '8FQ9+HQ', ordem: 2 },
    ],
    legs: [
      {
        de: 'A',
        para: 'C',
        retorno: false,
        distance: 500,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-46.5320, -23.6635],
            [-46.5312, -23.6620],
            [-46.5305, -23.6610],
          ],
        },
      },
      {
        de: 'C',
        para: 'B',
        retorno: false,
        distance: 420,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-46.5305, -23.6610],
            [-46.5298, -23.6640],
            [-46.5290, -23.6660],
          ],
        },
      },
      {
        de: 'B',
        para: 'A',
        retorno: true,
        distance: 500,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-46.5290, -23.6660],
            [-46.5308, -23.6650],
            [-46.5320, -23.6635],
          ],
        },
      },
    ],
  };
}

test('GPX: gera XML GPX 1.1 válido com metadados, bounds, waypoints ordenados e trkseg por trecho', () => {
  const rota = rotaExemplo();
  const xml = gerarGpxRota(rota, { agora: new Date('2026-11-16T18:30:00.000Z') });

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<gpx version="1\.1" creator="SIGA-Rotas Santo André" xmlns="http:\/\/www\.topografix\.com\/GPX\/1\/1"/);
  assert.match(xml, /<time>2026-11-16T18:30:00\.000Z<\/time>/);
  assert.match(xml, /<bounds minlat="-23\.6660000" minlon="-46\.5320000" maxlat="-23\.6610000" maxlon="-46\.5290000"\/>/);

  // Ordem respeita ordem otimizada (A, C, B) e inclui Plus Code
  const idxA = xml.indexOf('<name>A (8FP9+J6)</name>');
  const idxC = xml.indexOf('<name>C (8FQ9+HQ)</name>');
  const idxB = xml.indexOf('<name>B (8FMF+RC)</name>');
  assert.ok(idxA > 0 && idxC > idxA && idxB > idxC);

  // 3 segmentos de trilha com todas as coordenadas preservadas
  assert.equal((xml.match(/<trkseg>/g) || []).length, 3);
  assert.equal((xml.match(/<trkpt /g) || []).length, 9);
  assert.match(xml, /<trkpt lat="-23\.6620000" lon="-46\.5312000"\/>/);
});

test('GPX: escapa caracteres especiais XML em rótulos e códigos e suporta fallback de geometry simples', () => {
  const xml = gerarGpxRota({
    ok: true,
    circular: false,
    modo: 'usuario',
    distance: 250,
    pontos: [
      { rotulo: 'A&1', latitude: -23.66, longitude: -46.53, enderecoDigital: '8F<>"\'+1' },
      { rotulo: 'B', latitude: -23.661, longitude: -46.531 },
    ],
    geometry: {
      type: 'LineString',
      coordinates: [[-46.53, -23.66], [-46.531, -23.661]],
    },
  });
  assert.match(xml, /A&amp;1/);
  assert.match(xml, /8F&lt;&gt;&quot;&apos;\+1/);
  assert.equal((xml.match(/<trkseg>/g) || []).length, 1);
  assert.equal((xml.match(/<trkpt /g) || []).length, 2);
});

test('GPX: recusa rota inexistente, parcial, com falha ou sem geometria', () => {
  assert.throws(() => gerarGpxRota(null), /Calcule uma rota completa/);
  assert.throws(() => gerarGpxRota({ ok: false }), /Calcule uma rota completa/);
  assert.throws(() => gerarGpxRota({ ok: true, parcial: true }), /Calcule uma rota completa/);
  assert.throws(() => gerarGpxRota({ ok: true, legs: [] }), /não possui geometria válida/);
});

test('GPX: nomeArquivoGpx gera nome .gpx seguro e determinístico', () => {
  const nome = nomeArquivoGpx(rotaExemplo(), new Date(2026, 10, 16, 9, 5));
  assert.equal(nome, 'siga-rota-A-C-B-A-2026-11-16_09-05.gpx');
});

test('GPX Web: showDirectoryPicker escolhe pasta, cria .gpx e grava conteúdo completo', async () => {
  const escrito = [];
  let fechado = false;
  const dirHandle = {
    name: 'RotasCampo',
    async queryPermission() { return 'granted'; },
    async getFileHandle(nome, opts) {
      assert.match(nome, /^siga-rota-.*\.gpx$/);
      assert.deepEqual(opts, { create: true });
      return {
        async createWritable() {
          return {
            async write(txt) { escrito.push(txt); },
            async close() { fechado = true; },
          };
        },
      };
    },
  };
  let opcoesPicker = null;
  const res = await exportarRotaGpxWeb(rotaExemplo(), {
    env: {
      showDirectoryPicker: async (opcoes) => {
        opcoesPicker = opcoes;
        return dirHandle;
      },
    },
  });
  assert.equal(opcoesPicker.mode, 'readwrite');
  assert.equal(res.ok, true);
  assert.equal(res.modo, 'diretorio');
  assert.equal(res.pasta, 'RotasCampo');
  assert.equal(fechado, true);
  assert.match(escrito[0], /<gpx version="1\.1"/);
});

test('GPX Web: cancelamento no seletor de pasta não faz download silencioso nem finge sucesso', async () => {
  let baixou = false;
  const res = await exportarRotaGpxWeb(rotaExemplo(), {
    env: {
      showDirectoryPicker: async () => {
        const err = new Error('The user aborted a request.');
        err.name = 'AbortError';
        throw err;
      },
      document: { createElement() { baixou = true; return {}; } },
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.cancelado, true);
  assert.equal(res.motivo, 'CANCELADO');
  assert.equal(baixou, false);
});

test('GPX Web: falha de permissão ou escrita reporta erro real e aborta escrita parcial', async () => {
  const errPerm = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
  const rPerm = await exportarRotaGpxWeb(rotaExemplo(), {
    env: { showDirectoryPicker: async () => { throw errPerm; } },
  });
  assert.equal(rPerm.ok, false);
  assert.equal(rPerm.motivo, 'PERMISSAO_NEGADA');

  let abortou = false;
  const rWrite = await exportarRotaGpxWeb(rotaExemplo(), {
    env: {
      showDirectoryPicker: async () => ({
        name: 'Pasta',
        async getFileHandle() {
          return {
            async createWritable() {
              return {
                async write() { throw new Error('disco sem espaço'); },
                async abort() { abortou = true; },
                async close() {},
              };
            },
          };
        },
      }),
    },
  });
  assert.equal(rWrite.ok, false);
  assert.equal(rWrite.motivo, 'ERRO_GRAVACAO');
  assert.equal(abortou, true);
});

test('GPX Web: navegador sem seletor de pasta realiza download real via Blob e informa o usuário', async () => {
  let clicado = false;
  let arquivoDownload = '';
  let conteudoBlob = '';
  const fakeLink = { style: {}, click() { clicado = true; }, remove() {} };
  const res = await exportarRotaGpxWeb(rotaExemplo(), {
    env: {
      Blob: class { constructor(parts) { conteudoBlob = parts.join(''); } },
      URL: {
        createObjectURL() { return 'blob:gpx-test'; },
        revokeObjectURL() {},
      },
      document: {
        body: { appendChild() {} },
        createElement(tag) {
          assert.equal(tag, 'a');
          return fakeLink;
        },
      },
    },
  });
  arquivoDownload = fakeLink.download;
  assert.equal(res.ok, true);
  assert.equal(res.modo, 'download');
  assert.equal(clicado, true);
  assert.match(arquivoDownload, /^siga-rota-.*\.gpx$/);
  assert.match(conteudoBlob, /<trkpt /);
  assert.match(res.mensagem, /não permite escolher a pasta/);
});

test('GPX Web: sem rota completa recusa antes de abrir qualquer seletor', async () => {
  let abriuPicker = false;
  const res = await exportarRotaGpxWeb(null, {
    env: {
      showDirectoryPicker: async () => { abriuPicker = true; return {}; },
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.motivo, 'SEM_ROTA');
  assert.equal(abriuPicker, false);
});
