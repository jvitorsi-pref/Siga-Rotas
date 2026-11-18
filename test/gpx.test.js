import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gerarGpxRota, nomeArquivoGpx } from '../public/gpx.js';
import { exportarRotaGpxWeb } from '../public/exportarGpxWeb.js';
import { NetworkService } from '../server/networkService.js';
import { calcularRotaComParadas } from '../core/rotaParadas.js';

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

function extrairTrackPoints(xml) {
  return [...xml.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"\/>/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
}

function extrairWaypoints(xml) {
  return [...xml.matchAll(/<wpt lat="([^"]+)" lon="([^"]+)">[\s\S]*?<name>([^<]+)<\/name>/g)].map((m) => ({
    lat: Number(m[1]),
    lon: Number(m[2]),
    name: m[3],
  }));
}

function validarEstruturaGpx11(xml) {
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(
    xml,
    /<gpx version="1\.1" creator="SIGA-Rotas Santo André" xmlns="http:\/\/www\.topografix\.com\/GPX\/1\/1"/,
  );
  assert.match(xml, /<metadata>[\s\S]*<name>[^<]+<\/name>[\s\S]*<desc>[^<]+<\/desc>[\s\S]*<time>[^<]+<\/time>[\s\S]*<bounds minlat="-?\d+\.\d+" minlon="-?\d+\.\d+" maxlat="-?\d+\.\d+" maxlon="-?\d+\.\d+"\/>[\s\S]*<\/metadata>/);
  assert.match(xml, /<trk>[\s\S]*<trkseg>[\s\S]*<trkpt lat="-?\d+\.\d+" lon="-?\d+\.\d+"\/>[\s\S]*<\/trkseg>[\s\S]*<\/trk>/);
  assert.match(xml, /<\/gpx>\s*$/);
  const wpts = extrairWaypoints(xml);
  const trkpts = extrairTrackPoints(xml);
  assert.ok(wpts.length >= 2);
  assert.ok(trkpts.length >= 2);
  for (const [lat, lon] of trkpts) {
    assert.ok(Number.isFinite(lat) && Math.abs(lat) <= 90, `lat inválida: ${lat}`);
    assert.ok(Number.isFinite(lon) && Math.abs(lon) <= 180, `lon inválida: ${lon}`);
  }
  return { wpts, trkpts };
}

test('GPX: gera XML GPX 1.1 válido com metadados, bounds, waypoints ordenados e trkseg por trecho', () => {
  const rota = rotaExemplo();
  const xml = gerarGpxRota(rota, { agora: new Date('2026-11-16T18:30:00.000Z') });

  validarEstruturaGpx11(xml);
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

test('GPX: escapa caracteres especiais XML, suporta MultiLineString e fallback de geometry simples', () => {
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
  validarEstruturaGpx11(xml);
  assert.match(xml, /A&amp;1/);
  assert.match(xml, /8F&lt;&gt;&quot;&apos;\+1/);
  assert.equal((xml.match(/<trkseg>/g) || []).length, 1);
  assert.equal((xml.match(/<trkpt /g) || []).length, 2);

  const xmlMulti = gerarGpxRota({
    ok: true,
    circular: true,
    modo: 'usuario',
    distance: 400,
    pontos: [
      { rotulo: 'A', latitude: -23.66, longitude: -46.53 },
      { rotulo: 'B', latitude: -23.661, longitude: -46.531 },
    ],
    legs: [
      {
        de: 'A',
        para: 'B',
        retorno: false,
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [[-46.53, -23.66], [-46.5305, -23.6605]],
            [[-46.5305, -23.6605], [-46.531, -23.661]],
          ],
        },
      },
    ],
    retorno: {
      de: 'B',
      para: 'A',
      geometry: {
        type: 'LineString',
        coordinates: [[-46.531, -23.661], [-46.5302, -23.6604], [-46.53, -23.66]],
      },
    },
  });
  assert.equal((xmlMulti.match(/<trkseg>/g) || []).length, 3);
  assert.equal((xmlMulti.match(/<trkpt /g) || []).length, 7);
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

test('GPX Web: download direto via Blob+<a download> sem abrir seletor de pastas mesmo se showDirectoryPicker/showSaveFilePicker existirem', async () => {
  let abriuSeletorPasta = false;
  let abriuSeletorArquivo = false;
  let clicado = false;
  let removido = false;
  let urlRevogada = null;
  let conteudoBlob = '';
  let mimeBlob = '';
  const fakeLink = {
    style: {},
    click() { clicado = true; },
    remove() { removido = true; },
  };

  const res = await exportarRotaGpxWeb(rotaExemplo(), {
    agora: new Date(2026, 10, 17, 10, 15),
    env: {
      showDirectoryPicker: async () => { abriuSeletorPasta = true; return {}; },
      showSaveFilePicker: async () => { abriuSeletorArquivo = true; return {}; },
      Blob: class {
        constructor(parts, opts) {
          conteudoBlob = parts.join('');
          mimeBlob = opts?.type || '';
        }
      },
      URL: {
        createObjectURL() { return 'blob:gpx-direto'; },
        revokeObjectURL(u) { urlRevogada = u; },
      },
      setTimeout(fn) {
        fn();
        return { unref() {} };
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

  assert.equal(abriuSeletorPasta, false, 'não deve chamar showDirectoryPicker');
  assert.equal(abriuSeletorArquivo, false, 'não deve chamar showSaveFilePicker');
  assert.equal(res.ok, true);
  assert.equal(res.modo, 'download');
  assert.equal(res.arquivo, 'siga-rota-A-C-B-A-2026-11-17_10-15.gpx');
  assert.equal(fakeLink.href, 'blob:gpx-direto');
  assert.equal(fakeLink.download, res.arquivo);
  assert.equal(clicado, true);
  assert.equal(removido, true);
  assert.equal(urlRevogada, 'blob:gpx-direto');
  assert.match(mimeBlob, /application\/gpx\+xml/);
  validarEstruturaGpx11(conteudoBlob);
  assert.doesNotMatch(res.mensagem, /não permite escolher a pasta/);
  assert.match(res.mensagem, /download/i);
});

test('GPX Web: informa erro claro se Blob/download falhar ou se ainda não houver rota calculada', async () => {
  const semRota = await exportarRotaGpxWeb(null, { env: {} });
  assert.equal(semRota.ok, false);
  assert.equal(semRota.motivo, 'SEM_ROTA');

  const falhaDom = await exportarRotaGpxWeb(rotaExemplo(), {
    env: {
      Blob: class {},
      URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
      document: { createElement() { throw new Error('DOM indisponível'); } },
    },
  });
  assert.equal(falhaDom.ok, false);
  assert.equal(falhaDom.motivo, 'ERRO_DOWNLOAD');
  assert.match(falhaDom.mensagem, /DOM indisponível/);
});

test('GPX Web integração: public/exportarGpxWeb.js não usa showDirectoryPicker nem showSaveFilePicker e app.js exibe feedback ok', () => {
  const exporterSrc = readFileSync(new URL('../public/exportarGpxWeb.js', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.doesNotMatch(exporterSrc, /showDirectoryPicker|showSaveFilePicker/);
  assert.match(exporterSrc, /createObjectURL/);
  assert.match(exporterSrc, /link\.download\s*=\s*nomeArquivo/);
  assert.match(appSrc, /mostrarFeedbackGpx\(res\.mensagem,\s*'ok'\)/);
});

test('GPX E2E na rede real de Santo André: simples, múltiplas paradas, usuário, otimizada, retorno à origem e vértices reais', async () => {
  const ns = new NetworkService({ noAutoUpdate: true });
  const { graph } = await ns.ensureReady();

  const pontosBase = [
    { rotulo: 'A', latitude: -23.6639, longitude: -46.5333, enderecoDigital: '8FP8+CM' },
    { rotulo: 'B', latitude: -23.6665, longitude: -46.5290, enderecoDigital: '8FMF+RC' },
    { rotulo: 'C', latitude: -23.6612, longitude: -46.5301, enderecoDigital: '8FQ9+GW' },
    { rotulo: 'D', latitude: -23.6648, longitude: -46.5362, enderecoDigital: '8FP7+3G' },
  ];

  // 1) Rota simples: origem + 1 parada (A → B → A)
  const simples = calcularRotaComParadas(graph, pontosBase.slice(0, 2), { modo: 'usuario', circular: true });
  assert.equal(simples.ok, true);
  const xmlSimples = gerarGpxRota(simples, { pontos: pontosBase.slice(0, 2) });
  const parsedSimples = validarEstruturaGpx11(xmlSimples);
  assert.equal(parsedSimples.wpts.length, 2);
  assert.equal((xmlSimples.match(/<trkseg>/g) || []).length, 2);
  assert.ok(parsedSimples.trkpts.length > 6, 'trilha simples deve conter vértices reais das ruas, não só 2 pontos');
  assert.deepEqual(parsedSimples.trkpts[0], parsedSimples.trkpts.at(-1), 'retorno à origem fecha o circuito no último vértice');

  // 2 e 4) Múltiplas paradas na ordem definida pelo usuário (A → B → C → D → A)
  const usuario = calcularRotaComParadas(graph, pontosBase, { modo: 'usuario', circular: true });
  assert.equal(usuario.ok, true);
  const xmlUsuario = gerarGpxRota(usuario, { pontos: pontosBase });
  const parsedUsuario = validarEstruturaGpx11(xmlUsuario);
  assert.deepEqual(parsedUsuario.wpts.map((w) => w.name[0]), ['A', 'B', 'C', 'D']);
  assert.equal((xmlUsuario.match(/<trkseg>/g) || []).length, 4);
  const verticesEsperadosUsuario = usuario.legs.reduce((s, l) => s + l.geometry.coordinates.length, 0);
  assert.equal(parsedUsuario.trkpts.length, verticesEsperadosUsuario);
  assert.ok(parsedUsuario.trkpts.length > pontosBase.length * 4);
  assert.deepEqual(parsedUsuario.trkpts[0], parsedUsuario.trkpts.at(-1));

  // 3) Rota otimizada (preserva sequência otimizada em wpt e traçado real em trk)
  const otimizada = calcularRotaComParadas(graph, pontosBase, { modo: 'otimizada', circular: true });
  assert.equal(otimizada.ok, true);
  const xmlOtimizada = gerarGpxRota(otimizada, { pontos: pontosBase });
  const parsedOtimizada = validarEstruturaGpx11(xmlOtimizada);
  assert.deepEqual(parsedOtimizada.wpts.map((w) => w.name[0]), otimizada.sequencia);
  assert.equal((xmlOtimizada.match(/<trkseg>/g) || []).length, otimizada.legs.length);
  const verticesEsperadosOpt = otimizada.legs.reduce((s, l) => s + l.geometry.coordinates.length, 0);
  assert.equal(parsedOtimizada.trkpts.length, verticesEsperadosOpt);
  // Verifica correspondência exata (lon/lat toFixed(7)) com os vértices reais retornados pelo motor
  const coordsMotor = otimizada.legs.flatMap((l) =>
    l.geometry.coordinates.map(([lon, lat]) => [Number(lat.toFixed(7)), Number(lon.toFixed(7))]),
  );
  assert.deepEqual(parsedOtimizada.trkpts, coordsMotor);
  assert.deepEqual(parsedOtimizada.trkpts[0], parsedOtimizada.trkpts.at(-1));
});
