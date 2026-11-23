import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import * as catalogoRoot from '../../ocorrencias/catalogo.js';
import * as preferenciasRoot from '../../ocorrencias/preferencias.js';
import * as regrasRoot from '../../ocorrencias/regras.js';
import * as rotAltRoot from '../../ocorrencias/roteamentoAlternativo.js';

import * as catalogoApk from '../src/ocorrencias/catalogo.js';
import * as preferenciasApk from '../src/ocorrencias/preferencias.js';
import * as regrasApk from '../src/ocorrencias/regras.js';
import * as rotAltApk from '../src/ocorrencias/roteamentoAlternativo.js';

import { MobileNetworkServiceCore } from '../src/services/mobileNetworkServiceCore.js';
import { OcorrenciasMobileService } from '../src/services/ocorrenciasMobileService.js';
import { criarSincronizacaoMapa } from '../src/map/mapSync.js';
import { MAP_HTML } from '../src/map/mapHtml.js';
import { COLORS } from '../src/theme/colors.js';
import { resumoRota } from '../src/utils/resumoRota.js';
import { formatDistanceParts, formatStreetLength } from '../src/utils/formatters.js';
import { project, unproject } from '../src/core/geo.js';

const require = createRequire(new URL('../package.json', import.meta.url));
const babel = require('@babel/core');

function criarStorageMemoria() {
  const map = new Map();
  return {
    map,
    async getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    async setItem(k, v) {
      map.set(k, String(v));
    },
  };
}

function criarRedeTeste() {
  const [x, y] = project(-46.54, -23.662);
  const coord = (dx, dy) => unproject(x + dx, y + dy);
  const feat = (id, nome, pts) => ({
    type: 'Feature',
    properties: { ID: id, NOM_TIP_LOG: 'RUA', NOM_LOGRADOURO: nome, COD_LOG: id },
    geometry: { type: 'LineString', coordinates: pts },
  });
  return {
    coord,
    snapshot: {
      savedAt: 1000,
      serverTotal: 4,
      strategy: 'single',
      attributes: ['ID', 'NOM_TIP_LOG', 'NOM_LOGRADOURO', 'COD_LOG'],
      warnings: [],
      features: [
        feat(201, 'BASE SUL', [coord(0, 0), coord(200, 0)]),
        feat(202, 'LATERAL OESTE', [coord(0, 0), coord(0, 150)]),
        feat(203, 'ALTERNATIVA NORTE', [coord(0, 150), coord(200, 150)]),
        feat(204, 'LATERAL LESTE', [coord(200, 0), coord(200, 150)]),
      ],
    },
  };
}

test('APK compartilha exatamente os módulos ocorrencias/*.js da raiz', () => {
  assert.deepEqual(Object.keys(catalogoApk), Object.keys(catalogoRoot));
  assert.deepEqual(Object.keys(preferenciasApk), Object.keys(preferenciasRoot));
  assert.deepEqual(Object.keys(regrasApk), Object.keys(regrasRoot));
  assert.deepEqual(Object.keys(rotAltApk), Object.keys(rotAltRoot));
  assert.equal(catalogoApk.CLASSIFICACOES, catalogoRoot.CLASSIFICACOES);
  assert.equal(preferenciasApk.MODOS_PREFERENCIA, preferenciasRoot.MODOS_PREFERENCIA);
  assert.equal(regrasApk.criarOcorrencia, regrasRoot.criarOcorrencia);
  assert.equal(rotAltApk.calcularRotaComAlternativas, rotAltRoot.calcularRotaComAlternativas);
});

test('OcorrenciasMobileService cria offline, calcula rota alternativa local e sincroniza ao reconectar', async () => {
  const { coord, snapshot } = criarRedeTeste();
  const storage = criarStorageMemoria();
  let servidorOnline = false;
  const enviadasAoServidor = [];

  const fetchMock = async (url, init) => {
    if (!servidorOnline) throw new Error('Network offline');
    const u = new URL(url);
    const body = init?.body ? JSON.parse(init.body) : null;
    if (u.pathname === '/api/ocorrencias' && init?.method === 'POST') {
      enviadasAoServidor.push({ path: u.pathname, body });
      return new Response(
        JSON.stringify({ ok: true, ocorrencia: { ...body, status: 'ativa' } }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (u.pathname === '/api/ocorrencias/interagir' && init?.method === 'POST') {
      enviadasAoServidor.push({ path: u.pathname, body });
      return new Response(
        JSON.stringify({ ok: true, ocorrencia: { id: body.id, status: 'ativa' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (u.pathname === '/api/ocorrencias') {
      return new Response(
        JSON.stringify({ ok: true, ocorrencias: enviadasAoServidor.map((e) => e.body).filter((b) => b.categoria) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404 });
  };

  const netService = new MobileNetworkServiceCore({
    storage,
    embeddedSnapshot: snapshot,
    remoteApiUrl: 'https://api.siga.local',
    fetchImpl: fetchMock,
    allowWfs: false,
    autoUpdate: { enabled: false },
  });
  const occService = new OcorrenciasMobileService({ storage, networkService: netService });

  const uid = await occService.obterOuCriarUsuarioId();
  assert.ok(uid.startsWith('apk_'));

  const prefs = await occService.salvarPreferencias({
    modo: preferenciasRoot.MODOS_PREFERENCIA.CONSIDERAR,
    evitarCategorias: ['escadaria'],
  });
  assert.deepEqual(await occService.carregarPreferencias(), prefs);

  // Offline: associa segmento e registra ocorrência + interação na fila pendente
  const pontoSul = coord(100, 0);
  const seg = await occService.associarSegmento({ latitude: pontoSul[1], longitude: pontoSul[0] });
  assert.equal(seg.ok, true);
  assert.equal(seg.principal.logradouro, 'RUA BASE SUL');

  const reg = await occService.registrar(
    {
      categoria: 'escadaria',
      classificacao: catalogoRoot.CLASSIFICACOES.PENALIZA,
      temporalidade: 'permanente',
      latitude: pontoSul[1],
      longitude: pontoSul[0],
      featureIdPreferido: seg.principal.featureId,
    },
    { usuarioId: uid },
  );
  assert.equal(reg.ok, true);
  assert.equal(reg.pendenteSincronizacao, true);
  assert.equal(occService.pendentes.length, 1);

  const inter = await occService.interagir({
    id: reg.ocorrencia.id,
    tipo: 'confirmar',
    usuarioId: 'outro-usuario',
  });
  assert.equal(inter.ok, true);
  assert.equal(occService.pendentes.length, 2);

  // Roteamento offline com ocorrências e preferências evita a Rua Base Sul
  const orig = coord(0, 0);
  const dest = coord(200, 0);
  const rotaOffline = await netService.calcularRotaParadas(
    [
      { rotulo: 'A', latitude: orig[1], longitude: orig[0] },
      { rotulo: 'B', latitude: dest[1], longitude: dest[0] },
    ],
    {
      modo: 'usuario',
      circular: true,
      preferencias: prefs,
      ocorrencias: await occService.listarAtivas(),
    },
  );
  assert.equal(rotaOffline.ok, true);
  assert.ok(rotaOffline.rotas.some((r) => r.rota.legs[0].streets.some((s) => /ALTERNATIVA NORTE/i.test(s))));

  // Reconexão: esvazia fila pendente no servidor Node.js
  servidorOnline = true;
  const sync = await occService.sincronizarPendentes();
  assert.equal(sync.flushed, 2);
  assert.equal(sync.remaining, 0);
  assert.equal(enviadasAoServidor.length, 2);
});

test('mapSync + mapHtml renderizam ocorrências e rotas alternativas no Canvas e OpenLayers sem quebrar base', () => {
  const sent = [];
  const sync = criarSincronizacaoMapa((m) => sent.push(m));
  sync.atualizar({
    ready: true,
    session: 1,
    visible: true,
    features: [],
    markers: [],
    routeGeometry: null,
    routeSegments: [],
    occurrences: [{ id: 'occ-1', categoria: 'alagamento', classificacao: 'evita', localizacao: { latitude: -23.66, longitude: -46.53 } }],
    showOccurrences: true,
    altRoutes: [{ id: 'alt-1', geometry: { type: 'LineString', coordinates: [[-46.53, -23.66], [-46.529, -23.66]] } }],
  });
  assert.ok(sent.some((m) => m.type === 'SET_OCCURRENCES' && m.occurrences.length === 1));
  assert.ok(sent.some((m) => m.type === 'SET_ALT_ROUTES' && m.altRoutes.length === 1));

  // Testa execução real no Canvas fallback
  const messages = [];
  const fills = [];
  const strokes = [];
  const ctx = {
    beginPath() {},
    moveTo() {},
    lineTo() {},
    setLineDash() {},
    stroke() { strokes.push({ color: this.strokeStyle, width: this.lineWidth }); },
    fillRect() {},
    arc() {},
    fill() { fills.push({ color: this.fillStyle }); },
    fillText() {},
  };
  const events = {};
  const canvas = { style: {}, getContext: () => ctx, addEventListener: (k, fn) => { events[k] = fn; } };
  const window = {
    innerWidth: 400,
    innerHeight: 300,
    devicePixelRatio: 1,
    addEventListener() {},
    ReactNativeWebView: { postMessage: (s) => messages.push(JSON.parse(s)) },
  };
  const sandbox = {
    window,
    navigator: { onLine: false },
    setTimeout: () => 1,
    clearTimeout() {},
    document: {
      getElementById: (id) => (id === 'map' ? { style: {} } : canvas),
      createElement: () => ({ tag: 'script', onerror() {} }),
      head: { appendChild: (el) => el.onerror?.() },
    },
  };
  vm.createContext(sandbox);
  const scriptSrc = [...MAP_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  vm.runInContext(scriptSrc, sandbox);
  window.__handleRNMessage({
    type: 'SET_OCCURRENCES',
    occurrences: [
      { id: 'occ-1', categoria: 'alagamento', classificacao: 'evita', localizacao: { latitude: -23.665, longitude: -46.525 } },
    ],
  });
  assert.ok(fills.some((f) => f.color === '#dc2626'));
  // Clique no centro (onde está occ-1) emite OCC_CLICK
  events.pointerdown({ clientX: 200, clientY: 150 });
  events.pointerup({ clientX: 200, clientY: 150 });
  assert.ok(messages.some((m) => m.type === 'OCC_CLICK' && m.id === 'occ-1'));
});

function compilarComponenteJsx(relPath, depsMap) {
  const src = readFileSync(new URL(relPath, import.meta.url), 'utf8');
  const code = babel.transformSync(src, {
    babelrc: false,
    configFile: false,
    plugins: [
      require.resolve('@babel/plugin-transform-react-jsx'),
      require.resolve('@babel/plugin-transform-modules-commonjs'),
    ],
  }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (name) => {
      assert.ok(name in depsMap, `Dependência inesperada: ${name}`);
      return depsMap[name];
    },
    module,
    module.exports,
  );
  return module.exports;
}

function extrairTexto(node) {
  if (Array.isArray(node)) return node.map(extrairTexto).join(' ');
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return extrairTexto(typeof node.type === 'function' ? node.type(node.props) : node.props?.children);
}

test('Componentes JSX RoutePreferencesSection, OccurrenceModal e RouteResultPanel renderizam alternativas e alertas', () => {
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
  };
  const rn = Object.fromEntries(
    ['View', 'Text', 'TouchableOpacity', 'Modal', 'TextInput', 'ScrollView'].map((n) => [n, n]),
  );
  rn.StyleSheet = { create: (s) => s };

  // 1) RoutePreferencesSection
  const prefMod = compilarComponenteJsx('../src/components/RoutePreferencesSection.js', {
    react: React,
    'react-native': rn,
    '../ocorrencias/catalogo.js': catalogoApk,
    '../ocorrencias/preferencias.js': preferenciasApk,
    '../theme/colors': { COLORS },
  });
  const prefText = extrairTexto(
    prefMod.RoutePreferencesSection({
      preferencias: preferenciasApk.preferenciasPadrao(),
      onChangePreferencias: () => {},
    }),
  );
  assert.match(prefText, /Preferências do trajeto/);
  assert.match(prefText, /Equilibrada/);

  // 2) OccurrenceModal (detail)
  const modalMod = compilarComponenteJsx('../src/components/OccurrenceModal.js', {
    react: React,
    'react-native': rn,
    '../ocorrencias/catalogo.js': catalogoApk,
    '../theme/colors': { COLORS },
  });
  const modalText = extrairTexto(
    modalMod.OccurrenceModal({
      visible: true,
      mode: 'detail',
      usuarioId: 'u1',
      ocorrencia: {
        id: 'occ-1',
        categoria: 'escadaria',
        classificacao: 'penaliza',
        temporalidade: 'permanente',
        status: 'ativa',
        localizacao: { logradouro: 'Rua Teste', latitude: -23.66, longitude: -46.53 },
        contadores: { confirmacoes: 2, resolvida: 0, contestacoes: 0 },
        interacoes: [{ usuarioId: 'u1', tipo: 'confirmar' }],
      },
    }),
  );
  assert.match(modalText, /Escadaria/);
  assert.match(modalText, /Rua Teste/);
  assert.match(modalText, /Já confirmado por você/);

  // 3) RouteResultPanel com alternativas + erro bloqueadaPorRestricao
  const resultMod = compilarComponenteJsx('../src/components/RouteResultPanel.js', {
    react: React,
    'react-native': rn,
    '../theme/colors': { COLORS },
    '../utils/resumoRota.js': { resumoRota },
    '../utils/formatters.js': { formatDistanceParts, formatStreetLength },
  });
  let selecionada = null;
  let bypass = false;
  const altTree = resultMod.RouteResultPanel({
    routeResult: {
      ok: true,
      distance: 250,
      sequenciaCompleta: ['A', 'B', 'A'],
      legs: [{ de: 'A', para: 'B', distance: 125 }, { de: 'B', para: 'A', retorno: true, distance: 125 }],
    },
    routeAlternatives: [
      { id: 'alt-a', rotulo: 'Rota evitando escadaria', distance: 250, diferencaMetros: 50, ocorrenciasNoTrajeto: [] },
      { id: 'alt-b', rotulo: 'Rota mais curta', distance: 200, diferencaMetros: 0, ocorrenciasNoTrajeto: [{ id: 'occ-9', categoriaLabel: 'Escadaria', classificacao: 'penaliza', logradouro: 'Rua X' }] },
    ],
    selectedRouteId: 'alt-b',
    onSelectAlternative: (id) => { selecionada = id; },
  });
  const altText = extrairTexto(altTree);
  assert.match(altText, /Rotas alternativas\s*\(\s*2\s*\)/);
  assert.match(altText, /Ocorrências no trajeto\s*\(\s*1\s*\)/);

  const errTree = resultMod.RouteResultPanel({
    routeError: { title: 'Trajeto bloqueado', message: 'Bloqueio na via.', bloqueadaPorRestricao: true },
    onBypassAlerts: () => { bypass = true; },
  });
  const findNodes = (n, out = []) => {
    if (Array.isArray(n)) for (const c of n) findNodes(c, out);
    else if (n && typeof n === 'object') {
      out.push(n);
      findNodes(typeof n.type === 'function' ? n.type(n.props) : n.props?.children, out);
    }
    return out;
  };
  const btnBypass = findNodes(errTree).find(
    (n) => n.type === 'TouchableOpacity' && extrairTexto(n).includes('Ignorar alertas'),
  );
  assert.ok(btnBypass);
  btnBypass.props.onPress();
  assert.equal(bypass, true);
  assert.equal(selecionada, null);
});

test('OcorrenciasMobileService opera via proxy WebForms ApiProxy.ashx e respeita URL carregada do AsyncStorage', async () => {
  const { STORAGE_KEY_API_URL } = await import('../src/config/apiConfig.js');
  const mapStore = new Map();
  mapStore.set(STORAGE_KEY_API_URL, 'https://portal.sa.gov.br/SigaApp/SigaRotas/ApiProxy.ashx');
  const storage = {
    async getItem(k) { return mapStore.has(k) ? mapStore.get(k) : null; },
    async setItem(k, v) { mapStore.set(k, v); },
  };
  const urlsChamadas = [];
  const ocorrenciaFake = {
    id: 'occ-ashx-1',
    categoria: 'alagamento',
    classificacao: 'evita',
    temporalidade: 'temporaria',
    status: 'ativa',
    localizacao: { latitude: -23.66, longitude: -46.53, logradouro: 'Av. Teste' },
    contadores: { confirmacoes: 1, resolvida: 0, contestacoes: 0 },
    interacoes: [{ usuarioId: 'apk-u', tipo: 'confirmar' }],
  };

  const fetchImpl = async (url, init) => {
    urlsChamadas.push(`${init?.method || 'GET'} ${url}`);
    const u = new URL(url);
    assert.equal(u.pathname, '/SigaApp/SigaRotas/ApiProxy.ashx');
    const ep = u.searchParams.get('endpoint');
    if (ep === '/api/ocorrencias' && (init?.method || 'GET') === 'GET') {
      return new Response(JSON.stringify({ ok: true, ocorrencias: [ocorrenciaFake] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (ep === '/api/ocorrencias' && init?.method === 'POST') {
      return new Response(JSON.stringify({ ok: true, ocorrencia: ocorrenciaFake }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (ep === '/api/ocorrencias/interagir') {
      return new Response(JSON.stringify({
        ok: true,
        ocorrencia: { ...ocorrenciaFake, contadores: { confirmacoes: 2, resolvida: 0, contestacoes: 0 } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };

  // Sem remoteApiUrl no construtor: URL vem do AsyncStorage (sem race condition no startup)
  const { snapshot } = criarRedeTeste();
  const net = new MobileNetworkServiceCore({
    storage,
    embeddedSnapshot: snapshot,
    fetchImpl,
    allowWfs: false,
    autoUpdate: { enabled: false },
  });
  const occSvc = new OcorrenciasMobileService({ storage, networkService: net });
  const ativas = await occSvc.listarAtivas();
  assert.equal(ativas.length, 1);
  assert.equal(ativas[0].id, 'occ-ashx-1');

  const voto = await occSvc.interagir({ id: 'occ-ashx-1', tipo: 'confirmar', usuarioId: 'apk-u2' });
  assert.equal(voto.ok, true);
  assert.equal(voto.ocorrencia.contadores.confirmacoes, 2);
  assert.ok(urlsChamadas.some((u) => u.includes('endpoint=%2Fapi%2Focorrencias')));
  assert.ok(urlsChamadas.some((u) => u.includes('endpoint=%2Fapi%2Focorrencias%2Finteragir')));
});
