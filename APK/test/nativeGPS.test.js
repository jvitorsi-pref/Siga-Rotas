import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { criarFonteGPSNativa, TAREFA_GPS_SEGUNDO_PLANO } from '../src/services/nativeGPS.js';

function setup(extra = {}) {
  const readings = [], errors = [], interruptions = [], watchers = [], timers = [], calls = [];
  const bgStarts = [], bgStops = [];
  let time = 1700000000000, listener = null, bgListener = null, notifRequests = 0;

  const {
    withBackground = false,
    taskManager: customTaskManager,
    solicitarPermissaoNotificacao: customNotif,
    ...locationExtra
  } = extra;

  const location = {
    Accuracy: { High: 4 },
    async getForegroundPermissionsAsync() { calls.push('get'); return { status: 'granted' }; },
    async requestForegroundPermissionsAsync() { calls.push('request'); return { status: 'granted' }; },
    async hasServicesEnabledAsync() { return true; },
    async watchPositionAsync(options, ok, fail) {
      const w = { options, ok, fail, removed: 0, remove() { this.removed++; } };
      watchers.push(w);
      return w;
    },
    ...(withBackground ? {
      async startLocationUpdatesAsync(taskName, options) { bgStarts.push({ taskName, options }); },
      async stopLocationUpdatesAsync(taskName) { bgStops.push(taskName); },
    } : {}),
    ...locationExtra,
  };

  const taskManager = customTaskManager !== undefined
    ? customTaskManager
    : (withBackground ? { async isAvailableAsync() { return true; } } : null);

  const registrarListenerBackground = withBackground
    ? fn => {
        bgListener = fn;
        return () => { if (bgListener === fn) bgListener = null; };
      }
    : null;

  const solicitarPermissaoNotificacao = customNotif !== undefined
    ? customNotif
    : (withBackground ? async () => { notifRequests++; return true; } : null);

  const appState = {
    currentState: 'active',
    addEventListener(_event, fn) { listener = fn; return { remove() { listener = null; } }; },
  };

  const source = criarFonteGPSNativa({
    location,
    taskManager,
    registrarListenerBackground,
    solicitarPermissaoNotificacao,
    appState,
    agora: () => time,
    agendar: f => { timers.push(f); return f; },
    cancelar: f => { const i = timers.indexOf(f); if (i >= 0) timers.splice(i, 1); },
    aoAtualizar: p => readings.push(p),
    aoErro: e => errors.push(e),
    aoInterromper: e => interruptions.push(e),
  });

  return {
    source,
    location,
    readings,
    errors,
    watchers,
    timers,
    calls,
    interruptions,
    bgStarts,
    bgStops,
    get notifRequests() { return notifRequests; },
    setTime: t => { time = t; },
    emitBg: payload => { bgListener?.(payload); },
    background() { appState.currentState = 'background'; listener?.('background'); },
    active() { appState.currentState = 'active'; listener?.('active'); },
  };
}

const amostra = (extra = {}) => ({
  coords: { latitude: -23.7, longitude: -46.5, accuracy: 8, heading: -1, speed: -1 },
  timestamp: 1700000000000,
  ...extra,
});
const turn = () => new Promise(resolve => setImmediate(resolve));

test('GPS não pede permissão nem abre watcher antes de iniciar por ação do usuário', async () => {
  const a = setup(); assert.deepEqual(a.calls, []); assert.equal(a.watchers.length, 0);
  await a.source.iniciar(); assert.equal(a.watchers.length, 1); assert.equal(a.calls.includes('request'), false); a.source.parar();
});

test('tradução preserva coordenadas/precisão e identifica GPS sem inventar rumo/velocidade', async () => {
  const a = setup(); await a.source.iniciar(); a.watchers[0].ok(amostra());
  assert.deepEqual(a.readings[0], {
    latitude: -23.7, longitude: -46.5, precisao: 8, rumo: null, velocidade: null,
    timestamp: 1700000000000, simulado: false, fonte: 'gps', mockado: false,
  });
  assert.equal(a.watchers[0].options.accuracy, 4); a.source.parar();
});

test('permissão negada não abre GPS e pode ser tentada novamente', async () => {
  const a = setup({
    async getForegroundPermissionsAsync() { return { status: 'undetermined', canAskAgain: true }; },
    async requestForegroundPermissionsAsync() { return { status: 'denied' }; },
  });
  assert.equal((await a.source.iniciar()).codigo, 'PERMISSION_DENIED'); assert.equal(a.watchers.length, 0);
  a.location.getForegroundPermissionsAsync = async () => ({ status: 'granted' });
  assert.equal((await a.source.iniciar()).ok, true); a.source.parar();
});

test('negação permanente não repete prompt; serviço desativado não abre watcher', async () => {
  const a = setup({ async getForegroundPermissionsAsync() { return { status: 'denied', canAskAgain: false }; } });
  await a.source.iniciar(); assert.equal(a.calls.includes('request'), false); assert.equal(a.watchers.length, 0);
  const b = setup({ async hasServicesEnabledAsync() { return false; } });
  assert.equal((await b.source.iniciar()).codigo, 'LOCATION_DISABLED'); assert.equal(b.watchers.length, 0);
});

test('parar durante pedido de permissão cancela abertura tardia', async () => {
  let resolve; const a = setup({ getForegroundPermissionsAsync: () => new Promise(r => { resolve = r; }) });
  const start = a.source.iniciar(); a.source.parar(); resolve({ status: 'granted' });
  assert.equal((await start).cancelado, true); assert.equal(a.watchers.length, 0);
});

test('watcher resolvido depois de parar é removido imediatamente', async () => {
  let resolve; const sub = { removed: 0, remove() { this.removed++; } };
  const a = setup({ watchPositionAsync: () => new Promise(r => { resolve = r; }) });
  const start = a.source.iniciar(); await turn(); a.source.parar(); resolve(sub);
  assert.equal((await start).cancelado, true); assert.equal(sub.removed, 1); assert.equal(a.timers.length, 0);
});

test('pausa/retomada abre só um watcher e rejeita callbacks da assinatura antiga', async () => {
  const a = setup(); await Promise.all([a.source.iniciar(), a.source.iniciar()]); assert.equal(a.watchers.length, 1);
  a.source.pausar(); assert.equal(a.watchers[0].removed, 1); a.watchers[0].ok(amostra()); assert.equal(a.readings.length, 0);
  await a.source.retomar(); a.watchers[1].ok(amostra()); assert.equal(a.readings.length, 1); a.source.parar(); assert.equal(a.timers.length, 0);
});

test('segundo plano continua registrando rota e só para quando o usuário pausar ou encerrar', async () => {
  const a = setup({ withBackground: true });
  const init = await a.source.iniciar();
  assert.equal(init.ok, true);
  assert.equal(init.segundoPlano, true);
  assert.equal(a.source.segundoPlanoAtivo, true);
  assert.equal(a.notifRequests, 1);
  assert.equal(a.bgStarts.length, 1);
  assert.equal(a.bgStarts[0].taskName, TAREFA_GPS_SEGUNDO_PLANO);
  assert.equal(a.bgStarts[0].options.deferredUpdatesDistance, 0);
  assert.equal(a.bgStarts[0].options.deferredUpdatesInterval, 0);
  assert.equal(a.bgStarts[0].options.distanceInterval, 0);
  assert.equal(a.bgStarts[0].options.foregroundService.killServiceOnDestroy, true);

  // Leitura inicial ainda com o app aberto
  a.watchers[0].ok(amostra({ timestamp: 1700000001000 }));
  assert.equal(a.readings.length, 1);

  // Usuário minimiza ou abre outro app: GPS NÃO pausa nem encerra
  a.background();
  assert.equal(a.source.ativo, true);
  assert.equal(a.interruptions.length, 0);
  assert.equal(a.watchers[0].removed, 0);
  assert.equal(a.bgStops.length, 0);

  // Leituras coletadas em segundo plano e entregues em lote após 35s não são descartadas,
  // vêm ordenadas cronologicamente e deduplicam o timestamp já recebido em primeiro plano.
  a.setTime(1700000036000);
  a.emitBg({
    data: {
      locations: [
        amostra({ timestamp: 1700000020000, coords: { latitude: -23.702, longitude: -46.502, accuracy: 6 } }),
        amostra({ timestamp: 1700000001000, coords: { latitude: -23.7, longitude: -46.5, accuracy: 8 } }),
        amostra({ timestamp: 1700000010000, coords: { latitude: -23.701, longitude: -46.501, accuracy: 7 } }),
      ],
    },
  });
  assert.equal(a.readings.length, 3);
  assert.deepEqual(a.readings.map(r => r.timestamp), [1700000001000, 1700000010000, 1700000020000]);

  // Apenas ação explícita do usuário para o serviço em segundo plano
  a.source.pausar();
  await turn();
  assert.equal(a.source.ativo, false);
  assert.equal(a.source.segundoPlanoAtivo, false);
  assert.equal(a.watchers[0].removed, 1);
  assert.deepEqual(a.bgStops, [TAREFA_GPS_SEGUNDO_PLANO]);

  // Leituras tardias após pausar são ignoradas
  a.emitBg({ data: { locations: [amostra({ timestamp: 1700000040000 })] } });
  assert.equal(a.readings.length, 3);
});

test('iniciar com o app fechado em segundo plano é bloqueado; retomar aguarda parada pendente', async () => {
  let resolveStop;
  const order = [];
  const a = setup({
    withBackground: true,
    async startLocationUpdatesAsync() { order.push('start'); },
    stopLocationUpdatesAsync() {
      order.push('stop');
      return new Promise(r => { resolveStop = r; });
    },
  });

  a.background();
  assert.equal((await a.source.iniciar()).codigo, 'APP_BACKGROUND');

  a.active();
  await a.source.iniciar();
  a.source.pausar();
  const retomarProm = a.source.retomar();
  await turn();
  assert.deepEqual(order, ['start', 'stop']);
  resolveStop();
  await retomarProm;
  assert.deepEqual(order, ['start', 'stop', 'start']);
  a.source.parar();
});

test('parar durante startLocationUpdatesAsync cancela e desregistra a tarefa imediatamente', async () => {
  let resolveStart;
  const a = setup({
    withBackground: true,
    startLocationUpdatesAsync: () => new Promise(r => { resolveStart = r; }),
  });
  const prom = a.source.iniciar();
  await turn();
  a.source.parar();
  resolveStart();
  const res = await prom;
  await turn();
  assert.equal(res.cancelado, true);
  assert.deepEqual(a.bgStops, [TAREFA_GPS_SEGUNDO_PLANO]);
});

test('quando TaskManager está indisponível (ex.: Expo Go), mantém fallback apenas com app aberto', async () => {
  const a = setup({
    withBackground: true,
    taskManager: { async isAvailableAsync() { return false; } },
  });
  const res = await a.source.iniciar();
  assert.equal(res.ok, true);
  assert.equal(res.segundoPlano, false);
  assert.equal(a.source.segundoPlanoAtivo, false);
  assert.equal(a.bgStarts.length, 0);
  assert.equal(a.watchers.length, 1);
  a.source.parar();
});

test('amostras antigas/inválidas/mockadas não confirmam posição real', async () => {
  const a = setup(); await a.source.iniciar(); a.watchers[0].ok(amostra({ timestamp: 1 })); a.watchers[0].ok(amostra({ mocked: true }));
  a.watchers[0].ok(amostra({ coords: { latitude: 999, longitude: -46.5 } })); assert.equal(a.readings.length, 0);
  assert.ok(a.errors.some(e => e.codigo === 'MOCK_LOCATION')); assert.ok(a.errors.some(e => e.codigo === 'POSITION_UNAVAILABLE')); a.source.parar();
});

test('silêncio e erro GPS são explícitos; nova leitura permite detectar nova lacuna', async () => {
  const a = setup(); await a.source.iniciar(); a.setTime(1700000031000); a.timers[0](); a.timers[0]();
  assert.equal(a.errors.filter(e => e.codigo === 'TIMEOUT').length, 1);
  a.watchers[0].ok(amostra({ timestamp: 1700000031000 })); a.setTime(1700000062000); a.timers[0]();
  assert.equal(a.errors.filter(e => e.codigo === 'TIMEOUT').length, 2);
  a.watchers[0].fail('sensor'); assert.equal(a.errors.at(-1).codigo, 'POSITION_UNAVAILABLE'); a.source.parar();
});

test('erro nativo na abertura não deixa fonte ativa e pode ser informado', async () => {
  const a = setup({ async watchPositionAsync() { throw new Error('módulo indisponível'); } });
  assert.equal((await a.source.iniciar()).codigo, 'GPS_ERROR'); assert.equal(a.source.ativo, false); assert.equal(a.timers.length, 0);
});

test('leituras duplicadas ou fora de ordem não contam como novas posições estáveis', async () => {
  const a = setup(); await a.source.iniciar(); a.watchers[0].ok(amostra()); a.watchers[0].ok(amostra());
  a.watchers[0].ok(amostra({ timestamp: 1699999999999 })); assert.equal(a.readings.length, 1);
  a.setTime(1700000001000); a.watchers[0].ok(amostra({ timestamp: 1700000001000 })); assert.equal(a.readings.length, 2);
  assert.equal(a.watchers[0].options.distanceInterval, 0, 'permite leituras novas com aparelho parado para confirmar chegada'); a.source.parar();
});

test('configuração Android e app.json habilitam Foreground Service de localização e TaskManager', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');

  assert.ok(pkg.dependencies['expo-task-manager']);
  assert.ok(appJson.expo.plugins.includes('expo-task-manager'));
  const locPlugin = appJson.expo.plugins.find(p => Array.isArray(p) && p[0] === 'expo-location');
  assert.ok(locPlugin);
  assert.equal(locPlugin[1].isAndroidBackgroundLocationEnabled, true);
  assert.equal(locPlugin[1].isAndroidForegroundServiceEnabled, true);

  for (const perm of [
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_LOCATION',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.WAKE_LOCK',
  ]) {
    assert.ok(appJson.expo.android.permissions.includes(perm), `app.json deve incluir ${perm}`);
    assert.ok(manifest.includes(perm), `AndroidManifest.xml deve incluir ${perm}`);
  }
});
