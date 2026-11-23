import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  gerarGpxRota,
  gerarGpxRotaPercorrida,
  prepararPacoteExportacaoGpx,
  nomeArquivoGpx,
  NOME_ARQUIVO_ROTA_CALCULADA,
  NOME_ARQUIVO_ROTA_PERCORRIDA,
  NOME_ARQUIVO_EXPORTACAO_ZIP,
} from '../public/gpx.js';
import { criarZip, lerZipStore, decodificarUtf8 } from '../public/zip.js';
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
  assert.equal(res.cenario, 'CALCULADA');
  assert.equal(res.arquivo, 'rota_calculada.gpx');
  assert.equal(fakeLink.href, 'blob:gpx-direto');
  assert.equal(fakeLink.download, 'rota_calculada.gpx');
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

test('GPX Cenário B (calculada + GPS real), desvio com recálculo, pausas/retomadas, simulação e Cenário C (GPS sem rota calculada)', async () => {
  const rotaOriginal = rotaExemplo();
  const rotaRecalculadaPosDesvio = {
    ok: true,
    circular: true,
    modo: 'usuario',
    distance: 490,
    sequencia: ['B', 'A'],
    pontos: [
      { rotulo: 'B', latitude: -23.6660, longitude: -46.5290, ordem: 1 },
    ],
    legs: [
      {
        de: 'GPS',
        para: 'B',
        geometry: {
          type: 'LineString',
          coordinates: [[-46.5355, -23.6628], [-46.5290, -23.6660]],
        },
      },
    ],
  };

  // Pontos GPS reais com desvio (-46.5355, -23.6628) e pausa/retomada (segmentoIndice 0 e 1)
  const pontosGps = [
    { latitude: -23.6635, longitude: -46.5320, timestampMs: 1700000000000, ordem: 1, segmentoIndice: 0, simulado: false },
    { latitude: -23.6628, longitude: -46.5355, timestampMs: 1700000010000, ordem: 2, segmentoIndice: 0, simulado: false },
    { latitude: -23.6641, longitude: -46.5310, timestampMs: 1700000060000, ordem: 3, segmentoIndice: 1, simulado: false },
    { latitude: -23.6660, longitude: -46.5290, timestampMs: 1700000090000, ordem: 4, segmentoIndice: 1, simulado: false },
  ];

  // Cenário B (com rota original preservada após recálculo de desvio) → ZIP
  const pacoteB = prepararPacoteExportacaoGpx({
    rotaCalculada: rotaRecalculadaPosDesvio,
    rotaCalculadaOriginal: rotaOriginal,
    pontosGps,
    agora: new Date('2026-11-16T18:30:00.000Z'),
  });
  assert.equal(pacoteB.ok, true);
  assert.equal(pacoteB.cenario, 'AMBAS');
  assert.equal(pacoteB.tipoArquivo, 'zip');
  assert.equal(pacoteB.nomeArquivo, NOME_ARQUIVO_EXPORTACAO_ZIP);

  const entradas = lerZipStore(pacoteB.zipBytes);
  assert.deepEqual(Object.keys(entradas).sort(), [
    NOME_ARQUIVO_ROTA_CALCULADA,
    NOME_ARQUIVO_ROTA_PERCORRIDA,
  ].sort());

  const xmlCalc = decodificarUtf8(entradas[NOME_ARQUIVO_ROTA_CALCULADA]);
  const xmlGps = decodificarUtf8(entradas[NOME_ARQUIVO_ROTA_PERCORRIDA]);

  // Calcula preservou as 3 paradas originais e geometria original (9 trkpts), NÃO a rota recalculada
  assert.equal((xmlCalc.match(/<wpt /g) || []).length, 3);
  assert.equal((xmlCalc.match(/<trkpt /g) || []).length, 9);
  assert.doesNotMatch(xmlCalc, /-46\.5355/);

  // Percorrida contém estritamente os 4 pontos GPS reais em 2 <trkseg> com <time>
  assert.equal((xmlGps.match(/<trkseg>/g) || []).length, 2);
  assert.equal((xmlGps.match(/<trkpt /g) || []).length, 4);
  assert.match(xmlGps, /-23\.6628000" lon="-46\.5355000"/);
  assert.match(xmlGps, /<time>2023-11-14T22:13:20\.000Z<\/time>/);
  assert.equal((xmlGps.match(/<wpt /g) || []).length, 3);

  // Download Web no Cenário B envia Uint8Array como application/zip
  let parteRecebida = null;
  let mimeRecebido = '';
  const fakeLink = { style: {}, click() {}, remove() {} };
  const webB = await exportarRotaGpxWeb(rotaRecalculadaPosDesvio, {
    rotaCalculadaOriginal: rotaOriginal,
    pontosGps,
    env: {
      Blob: class {
        constructor(parts, opts) {
          parteRecebida = parts[0];
          mimeRecebido = opts?.type || '';
        }
      },
      URL: { createObjectURL: () => 'blob:zip', revokeObjectURL() {} },
      setTimeout: (fn) => { fn(); return { unref() {} }; },
      document: { body: { appendChild() {} }, createElement: () => fakeLink },
    },
  });
  assert.equal(webB.ok, true);
  assert.equal(webB.cenario, 'AMBAS');
  assert.equal(webB.arquivo, 'exportacao_rotas.zip');
  assert.equal(mimeRecebido, 'application/zip');
  assert.ok(parteRecebida instanceof Uint8Array);
  assert.ok(lerZipStore(parteRecebida)['rota_percorrida.gpx']);

  // Modo simulação NUNCA vira rota_percorrida.gpx (cai para Cenário A)
  const pacoteSim = prepararPacoteExportacaoGpx({
    rotaCalculada: rotaOriginal,
    rotaPercorrida: { tipoRota: 'GPS', simulado: true, geometry: { type: 'LineString', coordinates: [[-46.53, -23.66], [-46.529, -23.661]] } },
    pontosGps: pontosGps.map((p) => ({ ...p, simulado: true })),
  });
  assert.equal(pacoteSim.ok, true);
  assert.equal(pacoteSim.cenario, 'CALCULADA');
  assert.equal(pacoteSim.nomeArquivo, NOME_ARQUIVO_ROTA_CALCULADA);

  // Cenário C: rota GPS salva sem rota calculada vinculada → exporta somente rota_percorrida.gpx
  const pacoteC = prepararPacoteExportacaoGpx({
    rotaCalculada: null,
    rotaPercorrida: { tipoRota: 'GPS', idCliente: 'gps-only-1', simulado: false, titulo: 'Campo Centro' },
    pontosGps,
  });
  assert.equal(pacoteC.ok, true);
  assert.equal(pacoteC.cenario, 'PERCORRIDA');
  assert.equal(pacoteC.nomeArquivo, NOME_ARQUIVO_ROTA_PERCORRIDA);
  assert.equal((pacoteC.gpxXml.match(/<wpt /g) || []).length, 0);
  assert.equal((pacoteC.gpxXml.match(/<trkseg>/g) || []).length, 2);
  assert.equal((pacoteC.gpxXml.match(/<trkpt /g) || []).length, 4);

  // `gerarGpxRotaPercorrida` funciona independente mesmo com fallback de geometry GPS (sem pontos detalhados)
  const xmlFallbackGps = gerarGpxRotaPercorrida({
    rotaPercorrida: {
      tipoRota: 'GPS',
      simulado: false,
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [[-46.5320, -23.6635], [-46.5355, -23.6628]],
          [[-46.5310, -23.6641], [-46.5290, -23.6660]],
        ],
      },
    },
  });
  assert.equal((xmlFallbackGps.match(/<trkseg>/g) || []).length, 2);
  assert.equal((xmlFallbackGps.match(/<trkpt /g) || []).length, 4);
});

test('GPX Cenário 8 (erros e proteções): navegação em andamento, coords inválidas, GPS insuficiente, falha ZIP e SW', () => {
  const rota = rotaExemplo();

  // Navegação em andamento bloqueia sem perder dados
  const emNav = prepararPacoteExportacaoGpx({
    rotaCalculada: rota,
    navegacaoEmAndamento: true,
  });
  assert.equal(emNav.ok, false);
  assert.equal(emNav.motivo, 'NAVEGACAO_EM_ANDAMENTO');

  // Coordenadas GPS inválidas
  const coordInvGps = prepararPacoteExportacaoGpx({
    rotaCalculada: null,
    pontosGps: [
      { latitude: 120, longitude: -46.53 },
      { latitude: -23.66, longitude: 250 },
    ],
  });
  assert.equal(coordInvGps.ok, false);
  assert.equal(coordInvGps.motivo, 'COORDENADAS_INVALIDAS');

  // Coordenadas calculadas inválidas
  const coordInvCalc = prepararPacoteExportacaoGpx({
    rotaCalculada: {
      ok: true,
      geometry: { type: 'LineString', coordinates: [[999, 999], [NaN, NaN]] },
    },
  });
  assert.equal(coordInvCalc.ok, false);
  assert.equal(coordInvCalc.motivo, 'GEOMETRIA_INVALIDA');

  // Apenas 1 ponto GPS sem rota calculada
  const gpsUmPonto = prepararPacoteExportacaoGpx({
    rotaCalculada: null,
    pontosGps: [{ latitude: -23.6635, longitude: -46.5320, timestampMs: 1700000000000 }],
  });
  assert.equal(gpsUmPonto.ok, false);
  assert.equal(gpsUmPonto.motivo, 'SEM_GPS');

  // Simulação pura sem calculada
  const simSemCalc = prepararPacoteExportacaoGpx({
    rotaCalculada: null,
    rotaPercorrida: { tipoRota: 'GPS', simulado: true },
  });
  assert.equal(simSemCalc.ok, false);
  assert.equal(simSemCalc.motivo, 'SIMULACAO_NAO_EXPORTAVEL');

  // Falha explícita na geração ZIP
  const falhaZip = prepararPacoteExportacaoGpx({
    rotaCalculada: rota,
    pontosGps: [
      { latitude: -23.6635, longitude: -46.5320 },
      { latitude: -23.6660, longitude: -46.5290 },
    ],
    criarZipFn: () => { throw new Error('Falha simulada no compactador'); },
  });
  assert.equal(falhaZip.ok, false);
  assert.equal(falhaZip.motivo, 'ERRO_ZIP');
  assert.match(falhaZip.mensagem, /Falha simulada no compactador/);

  // Service Worker, app.js e navegacaoUI.js preservam contrato completo
  const swSrc = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const navSrc = readFileSync(new URL('../public/navegacaoUI.js', import.meta.url), 'utf8');
  assert.match(swSrc, /'\/zip\.js'/);
  assert.match(swSrc, /'\/gpx\.js'/);
  assert.match(swSrc, /'\/exportarGpxWeb\.js'/);
  assert.match(appSrc, /rotaPlanejadaOriginal/);
  assert.match(appSrc, /exportarRotaSalvaCampo/);
  assert.match(navSrc, /controlador\.estado\.execucao !== EXECUCAO\.ATIVO\) return;/);

  // Valida que ZIP vazio é rejeitado por criarZip
  assert.throws(() => criarZip([]), /nenhuma entrada/i);
  assert.throws(() => criarZip([{ nome: 'vazio.gpx', conteudo: '' }]), /vazio/i);
});
