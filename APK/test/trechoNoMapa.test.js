import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  metrosPorPixel, toleranciaDoClique, distanciaPontoSegmentoMetros,
  trechoSobClique,
} from '../src/utils/trechoNoMapa.js';

const A = [-46.5, -23.7];
const B = [-46.499, -23.7]; // ~101,8 m a leste
const linha = (a, b) => ({ type: 'LineString', coordinates: [a, b] });
const trecho = (de, a, b, extra = {}) => ({ indice: de, de: String(de), para: String(de + 1), geometry: linha(a, b), visivel: true, ...extra });

test('distância até o segmento: sobre a linha, nas pontas e fora dela', () => {
  assert.ok(distanciaPontoSegmentoMetros(-46.4995, -23.7, A, B) < 1e-6);
  assert.ok(Math.abs(distanciaPontoSegmentoMetros(-46.499, -23.7, A, B)) < 1e-6);
  const fora = distanciaPontoSegmentoMetros(-46.4985, -23.7, A, B);
  assert.ok(Math.abs(fora - 50.9) < 0.5, 'ponta leste medida pela extremidade: ' + fora);
  assert.equal(distanciaPontoSegmentoMetros(-46.5, -23.7, [NaN, 0], B), Infinity);
});

test('tolerância acompanha o zoom, com piso, teto e valor padrão sem zoom', () => {
  assert.ok(metrosPorPixel(-23.7, 12) > metrosPorPixel(-23.7, 18));
  assert.equal(metrosPorPixel(-23.7, undefined), null);
  assert.equal(toleranciaDoClique(-23.7, undefined), 12);
  assert.equal(toleranciaDoClique(-23.7, 21), 3);
  assert.equal(toleranciaDoClique(-23.7, 2), 60);
  assert.ok(toleranciaDoClique(-23.7, 17) > 3 && toleranciaDoClique(-23.7, 17) < 60);
});

test('toque próximo encontra o trecho; longe não encontra', () => {
  const trechos = [trecho(0, A, B)];
  assert.equal(trechoSobClique(trechos, -46.4995, -23.7, { zoom: 17 }).indice, 0);
  assert.equal(trechoSobClique(trechos, -46.4995, -23.6, { zoom: 17 }), null);
});

test('em zoom alto um desvio pequeno não alcança; em zoom baixo alcança', () => {
  const trechos = [trecho(0, A, B)];
  const desvio = -23.7 + 10 / 111194.9; // ~10 m ao norte
  assert.equal(trechoSobClique(trechos, -46.4995, desvio, { zoom: 18 }), null);
  const achado = trechoSobClique(trechos, -46.4995, desvio, { zoom: 12 });
  assert.equal(achado.indice, 0);
  assert.ok(Math.abs(achado.distancia - 10) < 0.2);
  assert.ok(trechoSobClique(trechos, -46.4995, -23.7 + 20 / 111194.9, {}) === null, 'sem zoom: 20 m fica fora dos 12 m');
});

test('trecho oculto não é candidato; sobreposição escolhe o visível', () => {
  assert.equal(trechoSobClique([trecho(0, A, B, { visivel: false })], -46.4995, -23.7, { zoom: 17 }), null);
  const sobrepostos = [trecho(0, A, B, { visivel: false }), trecho(1, A, B), trecho(2, A, B)];
  assert.equal(trechoSobClique(sobrepostos, -46.4995, -23.7, { zoom: 17 }).indice, 1, 'empate pelo menor índice visível');
});

test('MultiLineString, geometria inválida e tolerância do resultado', () => {
  const multi = { indice: 0, de: 'A', para: 'B', visivel: true, geometry: { type: 'MultiLineString', coordinates: [[A, [-46.49, -23.7]], [B, [-46.498, -23.7]]] } };
  const achado = trechoSobClique([multi], -46.4985, -23.7, { zoom: 16 });
  assert.equal(achado.indice, 0);
  assert.ok(achado.tolerancia > 3);
  assert.equal(trechoSobClique([{ geometry: linha(A, [Infinity, 1]), visivel: true }], -46.5, -23.7, { zoom: 17 }), null);
  assert.equal(trechoSobClique([{ geometry: { type: 'LineString', coordinates: [A] }, visivel: true }], -46.5, -23.7, { zoom: 17 }), null);
  assert.equal(trechoSobClique(null, -46.5, -23.7, {}), null);
});

test('App usa o mesmo helper no toque sem seleção; WebView distingue seleção de trecho', () => {
  const app = readFileSync(new URL('../App.js', import.meta.url), 'utf8');
  assert.match(app, /import \{ trechoSobClique \} from '\.\/src\/utils\/trechoNoMapa\.js';/);
  assert.match(app, /onMapClick=\{handleMapClick\}/);
  const inicio = app.indexOf('  const handleMapClick = ');
  const fim = app.indexOf('\n  };', inicio) + 5;
  const fonte = app.slice(inicio, fim);
  const chamados = [], status = [];
  const seg = { de: 'A', para: 'B', visivel: true, geometry: linha(A, B) };
  const ctx = { routeSegments: [seg], toggleSegment: i => chamados.push(i), setStatus: (t, k) => status.push([t, k]), trechoSobClique };
  const run = new Function(...Object.keys(ctx), fonte + '; return handleMapClick;')(...Object.values(ctx));
  run({ lon: -46.4995, lat: -23.7, zoom: 17 });
  assert.deepEqual(chamados, [0]);
  assert.match(status[0][0], /Trecho A → B oculto/);
  run({ lon: -46.4995, lat: -23.6, zoom: 17 });
  assert.deepEqual(chamados, [0], 'toque longe não altera nada');
  assert.equal(status.length, 1);
  const mapa = readFileSync(new URL('../src/components/RoadNetworkMap.js', import.meta.url), 'utf8');
  assert.match(mapa, /if \(pickingPoint && onMapPickCoordinate\)/);
  assert.match(mapa, /onMapClick\(\{ lon: data\.lon, lat: data\.lat, zoom: data\.zoom \}\)/);
});
