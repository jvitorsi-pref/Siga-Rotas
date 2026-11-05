import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { MAP_HTML } from '../src/map/mapHtml.js';
import { trechosParaMapa } from '../src/map/routePresentation.js';

import { ESTILO_TRECHO_JS } from '../src/map/styleScript.js';
const estiloTrecho = vm.runInNewContext('(' + ESTILO_TRECHO_JS + ')');

const geometry = (a, b) => ({ type: 'LineString', coordinates: [a, b] });
const legs = [
  { de: 'A', para: 'B', cor: '#15803d', distance: 100, geometry: geometry([-46.5, -23.7], [-46.499, -23.7]) },
  { de: 'B', para: 'A', cor: '#ea580c', retorno: true, distance: 100, geometry: geometry([-46.499, -23.7], [-46.5, -23.7]) },
];
function ambiente(engine, cdn = 'error') {
  const strokes = [], fills = [], fits = [], sources = [], messages = [], backgrounds = [];
  const ctx = {
    path: [], dash: [], globalAlpha: 1,
    beginPath() { this.path = []; }, moveTo(x,y) { this.path.push([x,y]); }, lineTo(x,y) { this.path.push([x,y]); },
    setLineDash(d) { this.dash = [...d]; },
    stroke() { strokes.push({ color: this.strokeStyle, width: this.lineWidth, dash: [...this.dash], path: this.path.map(p=>[...p]) }); },
    fillRect() { backgrounds.push(this.fillStyle); }, arc(x,y,r) { this.lastArc = [x,y,r]; }, fill() { fills.push({ color: this.fillStyle, arc: this.lastArc }); }, fillText() {},
  };
  const events = {}, windowEvents = {}, resizes = [], scripts = [], timers = [];
  const canvas = { style: {}, getContext: () => ctx, addEventListener(name, fn) { events[name] = fn; } };
  const feature = (raw) => ({
    get: (key) => raw.properties?.[key],
    getGeometry: () => ({ getExtent: () => {
      const coords = raw.geometry?.coordinates || [];
      return [Math.min(...coords.map(p=>p[0])), Math.min(...coords.map(p=>p[1])), Math.max(...coords.map(p=>p[0])), Math.max(...coords.map(p=>p[1]))];
    } }),
  });
  const layers = [];
  class Vector {
    constructor() { this.features = []; sources.push(this); }
    clear() { this.features = []; }
    addFeature(f) { this.features.push(f); }
    addFeatures(fs) { this.features.push(...fs); }
    getExtent() {
      const ext = this.features.map(f=>f.getGeometry().getExtent());
      return [Math.min(...ext.map(e=>e[0])), Math.min(...ext.map(e=>e[1])), Math.max(...ext.map(e=>e[2])), Math.max(...ext.map(e=>e[3]))];
    }
  }
  class Options { constructor(opts) { Object.assign(this, opts); } }
  const ol = {
    Map: class { constructor(opts) { this.view = opts.view; } addLayer(layer) { layers.push(layer); } on() {} getView() { return this.view; } updateSize() { resizes.push(true); } },
    View: class { fit(ext, opts) { fits.push({ ext: [...ext], opts }); } animate() {} getZoom() { return 13; } },
    layer: { Tile: Options, Vector: Options }, source: { OSM: Options, Vector },
    style: { Style: Options, Stroke: Options, Fill: Options, Circle: Options, Text: Options },
    proj: { fromLonLat: p=>p, toLonLat: p=>p },
    format: { GeoJSON: class { readFeature(raw) { return feature(raw); } } },
    geom: { Point: Options }, Feature: Options,
  };
  const window = { innerWidth: 400, innerHeight: 300, devicePixelRatio: 1, addEventListener(name, fn) { windowEvents[name] = fn; },
    ReactNativeWebView: { postMessage: s => messages.push(JSON.parse(s)) } };
  if (engine === 'openlayers') window.ol = ol;
  const sandbox = { window, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, document: {
    getElementById: id => id === 'map' ? { style: {} } : canvas,
    createElement: tag => ({ tag }), head: { appendChild: el => { if (el.tag === 'script') { scripts.push(el); if (cdn === 'error') el.onerror(); } } },
  } };
  vm.createContext(sandbox);
  const source = [...MAP_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  vm.runInContext(source, sandbox);
  return { send: msg => window.__handleRNMessage(JSON.parse(JSON.stringify(msg))), strokes, fills, fits, sources, layers, messages, events, windowEvents, canvas, window, resizes, scripts, timers, ol, backgrounds };
}

test('adaptador de trechos não altera legs, geometria, distâncias ou sequência', () => {
  const before = structuredClone(legs);
  const result = trechosParaMapa(legs, [1]);
  assert.equal(result[0].geometry, legs[0].geometry);
  assert.equal(result[1].visivel, false);
  assert.equal(result[1].retorno, true);
  assert.equal(result[1].cor, '#ea580c');
  assert.deepEqual(legs, before);
});
test('paleta é preenchida e trechos adjacentes têm cores distintas', () => {
  const result = trechosParaMapa(legs.map(({ cor, ...l }) => l));
  assert.match(result[0].cor, /^#[0-9a-f]{6}$/i);
  assert.notEqual(result[0].cor, result[1].cor);
});
test('estilo conserva o halo do APK, traceja retorno e não troca a cor ao destacar', () => {
  assert.equal(estiloTrecho({}).halo, 9);
  assert.equal(estiloTrecho({}).nucleo, 3.6);
  assert.deepEqual([...estiloTrecho({ retorno: true }).dash], [12, 7]);
  assert.equal(estiloTrecho({ cor: '#123456', situacao: 'atual' }).cor, '#123456');
});
for (const engine of ['openlayers', 'canvas']) {
  test(`${engine}: bridge desenha cores e retorno; ocultar/restaurar não recalcula a rota`, () => {
    const a = ambiente(engine);
    assert.equal(a.messages[0].engine, engine === 'canvas' ? 'canvas-fallback' : 'openlayers');
    const segments = trechosParaMapa(legs);
    const geometry = legs[0].geometry;
    a.send({ type: 'SET_ROUTE', geometry, segments });
    const cores = () => engine === 'canvas'
      ? a.strokes.filter(s=>segments.some(t=>t.cor===s.color))
      : a.sources[2].features.map(f => a.layers[2].style(f)).filter(Boolean).map(styles=>({ color: styles[2].stroke.color, dash: [...styles[2].stroke.lineDash] }));
    let drawn = cores();
    assert.deepEqual(drawn.map(s=>s.color), ['#15803d','#ea580c']);
    assert.deepEqual([...drawn[1].dash], [12,7]);
    const fitsBefore = a.fits.length;
    a.strokes.length = 0;
    a.send({ type: 'SET_ROUTE', geometry, segments: trechosParaMapa(legs, [1]), fit: false });
    assert.deepEqual(cores().map(s=>s.color), ['#15803d']);
    assert.equal(a.fits.length, fitsBefore, 'ocultação não reenquadra mapa');
    a.strokes.length = 0;
    a.send({ type: 'SET_ROUTE', geometry, segments: trechosParaMapa(legs, [0,1]), fit: false });
    assert.equal(cores().length, 0, 'todos ocultos não ativa fallback âmbar');
    a.strokes.length = 0;
    a.send({ type: 'SET_ROUTE', geometry, segments, fit: false });
    assert.equal(cores().length, 2);
  });
  test(`${engine}: limpar remove segmentos anteriores e mantém compatibilidade com geometry simples`, () => {
    const a = ambiente(engine);
    a.send({ type: 'SET_ROUTE', geometry: legs[0].geometry });
    if (engine === 'openlayers') assert.equal(a.sources[2].features.length, 1);
    else assert.ok(a.strokes.some(s=>s.color==='#ffc233'));
    a.strokes.length = 0;
    a.send({ type: 'SET_ROUTE', geometry: null, segments: [] });
    if (engine === 'openlayers') assert.equal(a.sources[2].features.length, 0);
    else assert.equal(a.strokes.filter(s=>s.color==='#ffc233').length, 0);
  });
}
test('canvas offline: Rede e Rota reenquadram, incluindo geometria MultiLineString', () => {
  const a = ambiente('canvas');
  a.send({ type: 'SET_NETWORK', features: [{ properties: { COD_LOG: 0 }, geometry: { type: 'MultiLineString', coordinates: [[[-46.6,-23.8],[-46.4,-23.6]]] } }] });
  assert.ok(a.strokes.some(s=>s.color==='#c2620d' && s.path.length===2 && s.dash.join()==='4,3'));
  a.send({ type: 'SET_ROUTE', geometry: legs[0].geometry, segments: trechosParaMapa(legs), fit: false });
  a.strokes.length = 0;
  a.send({ type: 'FIT_ROUTE' });
  const routePath = a.strokes.find(s=>s.color==='#15803d').path;
  assert.ok(routePath.every(([x,y])=>x>=54 && x<=346 && y>=54 && y<=246));
  assert.ok(Math.abs(routePath[1][0] - routePath[0][0]) > 250);
  a.strokes.length = 0;
  a.send({ type: 'FIT_NETWORK' });
  const networkPath = a.strokes.find(s=>s.color==='#c2620d').path;
  assert.ok(networkPath.every(([x,y])=>x>=54 && x<=346 && y>=54 && y<=246));
  assert.ok(Math.abs(a.strokes.find(s=>s.color==='#15803d').path[1][0] - a.strokes.find(s=>s.color==='#15803d').path[0][0]) < 5);
});

for (const engine of ['openlayers', 'canvas']) {
  test(`${engine}: marcador da posição simulada é independente e removível`, () => {
    const a = ambiente(engine);
    a.send({ type: 'SET_POSITION', position: { longitude: -46.5, latitude: -23.7, simulado: true } });
    if (engine === 'openlayers') {
      assert.equal(a.sources[4].features.length, 1);
      assert.equal(a.sources[4].features[0].get('simulado'), true);
    } else assert.ok(a.fills.some(f=>f.color==='#7c3aed' && f.arc[2]===7));
    a.fills.length = 0;
    a.send({ type: 'SET_POSITION', position: null });
    if (engine === 'openlayers') assert.equal(a.sources[4].features.length, 0);
    else assert.equal(a.fills.filter(f=>f.color==='#7c3aed').length, 0);
  });
  test(`${engine}: destaque atual e esmaecimento usam o estado sem alterar geometria`, () => {
    const a = ambiente(engine);
    const segments = trechosParaMapa(legs.map((l,i)=>({...l,situacao:i===0?'atual':'percorrido'})));
    a.send({ type: 'SET_ROUTE', geometry: legs[0].geometry, segments, fit: false });
    if (engine === 'openlayers') {
      const atual = a.layers[2].style(a.sources[2].features[0])[2].stroke;
      const percorrido = a.layers[2].style(a.sources[2].features[1])[2].stroke;
      assert.equal(atual.width, 4.8); assert.equal(atual.color, '#15803d');
      assert.match(percorrido.color, /0\.32\)/);
    } else {
      assert.ok(a.strokes.some(s=>s.color==='#15803d' && s.width===4.8));
      assert.ok(a.strokes.some(s=>/0\.32\)/.test(s.color) && s.dash.join()==='12,7'));
    }
    assert.equal(segments[0].geometry, legs[0].geometry);
  });
}

for (const engine of ['openlayers', 'canvas']) {
  test(`${engine}: GPS real não recebe identificação visual de posição simulada`, () => {
    const a=ambiente(engine);
    a.send({type:'SET_POSITION',position:{latitude:-23.7,longitude:-46.5,simulado:false}});
    if(engine==='openlayers'){
      const f=a.sources[4].features[0];assert.equal(f.get('simulado'),false);
      assert.equal(a.layers[4].style(f).image.fill.color,'#045127');
    } else {
      assert.ok(a.fills.some(f=>f.color==='#045127'));
      assert.equal(a.fills.filter(f=>f.color==='#7c3aed').length,0);
    }
  });
}

for (const engine of ['openlayers', 'canvas']) test(`${engine}: atualizar rede e redimensionar sem fit não reenquadra`,()=>{
 const a=ambiente(engine);a.send({type:'SET_NETWORK',features:[{geometry:legs[0].geometry}],fit:false});assert.equal(a.fits.length,0);
 a.send({type:'SET_ROUTE',segments:trechosParaMapa(legs),fit:false});const before=a.strokes.at(-1)?.path;
 a.window.innerWidth=800;a.window.innerHeight=600;a.send({type:'RESIZE_MAP'});assert.equal(a.fits.length,0);
 if(engine==='openlayers')assert.equal(a.resizes.length,1);else {assert.equal(a.canvas.width,800);assert.equal(a.canvas.height,600);assert.ok(before);}
});
test('Canvas: pan seguido de resize preserva centro e escala geográfica',()=>{
 const a=ambiente('canvas');a.send({type:'SET_NETWORK',features:[{geometry:legs[0].geometry}]});
 a.events.pointerdown({clientX:200,clientY:150});a.events.pointermove({clientX:230,clientY:170});a.events.pointerup({clientX:230,clientY:170});
 const click=(x,y)=>{a.events.pointerdown({clientX:x,clientY:y});a.events.pointerup({clientX:x,clientY:y});return a.messages.at(-1);};
 const before=click(200,150),offset=click(220,150);a.window.innerWidth=800;a.window.innerHeight=600;a.send({type:'RESIZE_MAP'});
 const after=click(400,300),offsetAfter=click(420,300);assert.equal(before.lon,after.lon);assert.equal(before.lat,after.lat);assert.equal(offset.lon-before.lon,offsetAfter.lon-after.lon);
});
test('CDN lento: deadline inicia Canvas uma única vez e chegada tardia não troca o motor',()=>{
 const a=ambiente('canvas','pending');assert.equal(a.messages.length,0);assert.equal(a.timers[0].ms,3000);const late=a.scripts[0].onload;
 a.timers[0].fn();assert.equal(a.messages[0].engine,'canvas-fallback');a.window.ol=a.ol;late();assert.equal(a.messages.filter(m=>m.type==='MAP_READY').length,1);
});
test('CDN disponível antes do deadline inicia OpenLayers apenas uma vez',()=>{
 const a=ambiente('canvas','pending');a.window.ol=a.ol;a.scripts[0].onload();a.timers[0].fn();assert.equal(a.messages.filter(m=>m.type==='MAP_READY').length,1);assert.equal(a.messages[0].engine,'openlayers');
});

test('Canvas offline conserva o fundo claro do APK',()=>{
 const a=ambiente('canvas');assert.equal(a.backgrounds.at(-1),'#ffffff');
});
test('Canvas: roda do mouse aproxima com o ponto sob o cursor fixo', () => {
  const a = ambiente('canvas');
  a.send({ type: 'SET_NETWORK', features: [{ geometry: legs[0].geometry }] });
  const click=(x,y)=>{a.events.pointerdown({clientX:x,clientY:y});a.events.pointerup({clientX:x,clientY:y});return a.messages.at(-1);};
  const antes=click(200,150), deslocAntes=click(220,150).lon-antes.lon;
  a.events.wheel({ clientX: 200, clientY: 150, deltaY: -400 });
  const depois=click(200,150), deslocDepois=click(220,150).lon-depois.lon;
  assert.equal(antes.lon, depois.lon);
  assert.equal(antes.lat, depois.lat);
  assert.ok(deslocDepois < deslocAntes * 0.6 && deslocDepois > deslocAntes * 0.4);
});
test('Canvas: pinça de dois dedos aproxima e não vira clique no mapa', () => {
  const a = ambiente('canvas');
  a.send({ type: 'SET_NETWORK', features: [{ geometry: legs[0].geometry }] });
  const click=(x,y)=>{a.events.pointerdown({clientX:x,clientY:y});a.events.pointerup({clientX:x,clientY:y});return a.messages.at(-1);};
  const antes=click(200,150), deslocAntes=click(220,150).lon-antes.lon;
  const cliques=a.messages.filter(m=>m.type==='MAP_CLICK').length;
  a.events.pointerdown({ pointerId: 1, clientX: 180, clientY: 150 });
  a.events.pointerdown({ pointerId: 2, clientX: 220, clientY: 150 });
  a.events.pointermove({ pointerId: 2, clientX: 260, clientY: 150 });
  a.events.pointerup({ pointerId: 1, clientX: 180, clientY: 150 });
  a.events.pointerup({ pointerId: 2, clientX: 260, clientY: 150 });
  assert.equal(a.messages.filter(m=>m.type==='MAP_CLICK').length, cliques, 'pinça não é clique');
  const deslocDepois=click(220,150).lon-click(200,150).lon;
  assert.ok(deslocDepois < deslocAntes * 0.6, 'pinça afastando os dedos aproxima');
});
test('Canvas: centralizar usa o mesmo zoom 17 do OpenLayers, sem afastar quem já está perto', () => {
  const a = ambiente('canvas');
  a.send({ type: 'SET_NETWORK', features: [{ properties: {}, geometry: { type: 'LineString', coordinates: [[-46.6,-23.8],[-46.4,-23.6]] } }] });
  const click=(x,y)=>{a.events.pointerdown({clientX:x,clientY:y});a.events.pointerup({clientX:x,clientY:y});return a.messages.at(-1);};
  const larguraAntes=click(220,150).lon-click(200,150).lon;
  a.send({ type: 'CENTER_POINT', lon: -46.5, lat: -23.7 });
  const centro=click(200,150);
  assert.ok(Math.abs(centro.lon+46.5)<1e-9 && Math.abs(centro.lat+23.7)<1e-9);
  const larguraDepois=click(220,150).lon-centro.lon;
  assert.ok(larguraDepois < larguraAntes / 10, 'centralizar aproxima como o zoom 17');
  assert.ok(Math.abs(larguraDepois - 20/(111319.49079327358/156543.03392804097*Math.pow(2,17))) < 1e-6);
  a.send({ type: 'CENTER_POINT', lon: -46.5, lat: -23.7 });
  assert.ok(Math.abs((click(220,150).lon-centro.lon)-larguraDepois)<1e-12, 'centralizar de novo não afasta');
});
test('Canvas: zoom respeita os limites e os controles +/− têm área e rótulo acessível', () => {
  const a = ambiente('canvas');
  a.send({ type: 'SET_NETWORK', features: [{ geometry: legs[0].geometry }] });
  const click=(x,y)=>{a.events.pointerdown({clientX:x,clientY:y});a.events.pointerup({clientX:x,clientY:y});return a.messages.at(-1);};
  for (let i=0;i<60;i++) a.events.wheel({ clientX: 200, clientY: 150, deltaY: 900 });
  const lonMin=click(200,150).lon, passo=click(220,150).lon-lonMin;
  assert.ok(isFinite(passo) && passo>0 && passo<2, 'afastar para no zoom mínimo');
  for (let i=0;i<60;i++) a.events.wheel({ clientX: 200, clientY: 150, deltaY: -900 });
  const passoMax=click(220,150).lon-click(200,150).lon;
  assert.ok(passoMax>0 && passoMax<passo, 'aproximar para no zoom máximo');
  assert.match(MAP_HTML, /id="fallback-zoom-in" aria-label="Aproximar mapa"/);
  assert.match(MAP_HTML, /id="fallback-zoom-out" aria-label="Afastar mapa"/);
  assert.match(MAP_HTML, /#fallback-zoom button \{[^}]*width: 36px/);
});
