import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMADA_PADRAO,
  CAMADA_SATELITE,
  CHAVE_CAMADA_BASE,
  CAMADAS_BASE,
  normalizarCamadaBase,
  opcoesCamadasBase,
  lerPreferenciaCamadaSync,
  salvarPreferenciaCamadaSync,
  lerPreferenciaCamadaAsync,
  salvarPreferenciaCamadaAsync,
  criarMonitorSatelite,
} from '../public/camadaBase.js';

test('CAMADAS_BASE define OpenStreetMap padrão e Esri World Imagery gratuito com atribuição', () => {
  const opcoes = opcoesCamadasBase();
  assert.deepEqual(opcoes.map((o) => o.id), ['osm', 'satelite']);

  const osm = CAMADAS_BASE[CAMADA_PADRAO];
  assert.equal(osm.rotulo, 'Mapa padrão');
  assert.equal(osm.provedor, 'OpenStreetMap');
  assert.equal(osm.maxZoom, 19);
  assert.equal(osm.interpolate, true);

  const sat = CAMADAS_BASE[CAMADA_SATELITE];
  assert.equal(sat.rotulo, 'Satélite');
  assert.equal(sat.provedor, 'Esri World Imagery');
  assert.equal(
    sat.url,
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  );
  assert.equal(sat.maxZoom, 19);
  assert.equal(sat.interpolate, true);
  assert.equal(sat.offlineTiles, false);
  assert.match(sat.atribuicaoHtml, /Esri/);
  assert.match(sat.atribuicaoHtml, /Maxar/);
  assert.match(sat.atribuicaoTexto, /Esri/);
});

test('normalizarCamadaBase sempre garante opção válida e fallback seguro para osm', () => {
  assert.equal(normalizarCamadaBase('satelite'), 'satelite');
  assert.equal(normalizarCamadaBase('osm'), 'osm');
  assert.equal(normalizarCamadaBase(null), 'osm');
  assert.equal(normalizarCamadaBase(undefined), 'osm');
  assert.equal(normalizarCamadaBase('google'), 'osm');
  assert.equal(normalizarCamadaBase(''), 'osm');
});

test('persistência síncrona (Web localStorage) salva, recupera e tolera erros/valores inválidos', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };

  assert.equal(lerPreferenciaCamadaSync(storage), 'osm');
  const salvo = salvarPreferenciaCamadaSync('satelite', storage);
  assert.deepEqual(salvo, { ok: true, modo: 'satelite' });
  assert.equal(store.get(CHAVE_CAMADA_BASE), 'satelite');
  assert.equal(lerPreferenciaCamadaSync(storage), 'satelite');

  store.set(CHAVE_CAMADA_BASE, 'corrompido');
  assert.equal(lerPreferenciaCamadaSync(storage), 'osm');

  const bloqueado = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
  };
  assert.equal(lerPreferenciaCamadaSync(bloqueado), 'osm');
  assert.deepEqual(salvarPreferenciaCamadaSync('satelite', bloqueado), {
    ok: false,
    modo: 'satelite',
  });
});

test('persistência assíncrona (APK AsyncStorage) salva, recupera e tolera falhas', async () => {
  const store = new Map();
  const storage = {
    async getItem(k) { return store.has(k) ? store.get(k) : null; },
    async setItem(k, v) { store.set(k, v); },
  };

  assert.equal(await lerPreferenciaCamadaAsync(storage), 'osm');
  assert.deepEqual(await salvarPreferenciaCamadaAsync('satelite', storage), {
    ok: true,
    modo: 'satelite',
  });
  assert.equal(await lerPreferenciaCamadaAsync(storage), 'satelite');

  const comFalha = {
    async getItem() { throw new Error('IOError'); },
    async setItem() { throw new Error('DiskFull'); },
  };
  assert.equal(await lerPreferenciaCamadaAsync(comFalha), 'osm');
  assert.deepEqual(await salvarPreferenciaCamadaAsync('satelite', comFalha), {
    ok: false,
    modo: 'satelite',
  });
});

test('criarMonitorSatelite trata offline, erros consecutivos de tiles e recuperação ao voltar para Mapa padrão', () => {
  const eventos = [];
  const monitor = criarMonitorSatelite({
    aoMudarEstado: (e) => eventos.push(e),
    limiteErrosInicial: 3,
    limiteErrosAtiva: 5,
  });

  // Ativado offline -> avisa imediatamente
  const off = monitor.definirAtiva(true, { online: false });
  assert.equal(off.status, 'offline');
  assert.match(off.mensagem, /Sem conexão/i);

  // Ativado online -> tolera 1 ou 2 erros pontuais, acusa indisponibilidade no 3º erro consecutivo
  monitor.definirAtiva(true, { online: true });
  assert.equal(monitor.estado().status, 'carregando');
  monitor.aoErroTile({ online: true });
  monitor.aoErroTile({ online: true });
  assert.equal(monitor.estado().status, 'carregando');
  monitor.aoErroTile({ online: true });
  assert.equal(monitor.estado().status, 'indisponivel');
  assert.match(monitor.estado().mensagem, /satélite/i);

  // Sucesso ao carregar tile limpa o aviso e zera erros
  monitor.aoCarregarTile();
  assert.equal(monitor.estado().status, 'pronta');
  assert.equal(monitor.estado().mensagem, '');
  assert.equal(monitor.estado().errosConsecutivos, 0);

  // Perder conexão durante o uso notifica sem travar; voltar para OSM oculta aviso
  monitor.aoMudarConexao(false);
  assert.equal(monitor.estado().status, 'offline');
  monitor.definirAtiva(false);
  assert.equal(monitor.estado().status, 'oculta');
  assert.equal(monitor.estado().mensagem, '');
  assert.ok(eventos.length >= 4);
});
