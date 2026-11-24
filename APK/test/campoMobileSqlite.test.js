import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { criarDriverSqliteCore } from '../src/services/armazenamentoSqliteCore.js';
import { criarServicoCampoMobileCore } from '../src/services/campoMobileServiceCore.js';
import { criarNavegacaoMobile } from '../src/services/mobileNavigationService.js';
import { criarSincronizacaoMapa } from '../src/map/mapSync.js';
import {
  STATUS_OBSERVACAO,
  STATUS_ROTA,
  SYNC_STATUS,
  TIPO_EVENTO,
  TIPO_ROTA,
} from '../src/campo/modeloCampo.js';
import { criarRepositorioCampo } from '../src/campo/repositorioCampo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APK_DIR = path.resolve(__dirname, '..');

function criarAdaptadorNodeSqlite() {
  return {
    async openDatabaseAsync(filename) {
      const db = new DatabaseSync(filename);
      const api = {
        async execAsync(sql) {
          db.exec(sql);
        },
        async runAsync(sql, params = []) {
          const stmt = db.prepare(sql);
          const info = stmt.run(...params);
          return { changes: Number(info?.changes ?? 0), lastInsertRowId: Number(info?.lastInsertRowid ?? 0) };
        },
        async getFirstAsync(sql, params = []) {
          const stmt = db.prepare(sql);
          return stmt.get(...params) ?? null;
        },
        async getAllAsync(sql, params = []) {
          const stmt = db.prepare(sql);
          return stmt.all(...params);
        },
        async withExclusiveTransactionAsync(fn) {
          db.exec('BEGIN IMMEDIATE');
          try {
            const res = await fn(api);
            db.exec('COMMIT');
            return res;
          } catch (err) {
            try {
              db.exec('ROLLBACK');
            } catch {
              /* ignora se já revertida */
            }
            throw err;
          }
        },
        async closeAsync() {
          db.close();
        },
      };
      return api;
    },
  };
}

function criarRotaMobileExemplo() {
  return {
    ok: true,
    distance: 420,
    modo: 'usuario',
    circular: true,
    pontos: [
      { rotulo: 'A', latitude: -23.6639, longitude: -46.5318, enderecoDigital: '8M59+C7' },
      { rotulo: 'B', latitude: -23.665, longitude: -46.5305, enderecoDigital: '8M59+2Q' },
    ],
    legs: [
      {
        de: 'A',
        para: 'B',
        distance: 210,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-46.5318, -23.6639],
            [-46.5305, -23.665],
          ],
        },
        legs: [{ street: 'Rua Monte Casseros', length: 210, official: true }],
      },
      {
        de: 'B',
        para: 'A',
        retorno: true,
        distance: 210,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-46.5305, -23.665],
            [-46.5318, -23.6639],
          ],
        },
        legs: [{ street: 'Rua Senador Fláquer', length: 210, official: true }],
      },
    ],
    geometry: {
      type: 'LineString',
      coordinates: [
        [-46.5318, -23.6639],
        [-46.5305, -23.665],
        [-46.5318, -23.6639],
      ],
    },
  };
}

test('SQLite real (node:sqlite) cria as 6 tabelas com WAL/FKs, aplica atomicidade e impede observação órfã', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'siga-sqlite-'));
  const dbPath = path.join(tmpDir, 'campo.db');
  const driver = criarDriverSqliteCore({
    sqlite: criarAdaptadorNodeSqlite(),
    nomeBanco: dbPath,
  });

  try {
    const repo = criarRepositorioCampo({ driver });
    await repo.inicializar();

    // FK ativa: tentar gravar observação apontando para rota inexistente deve falhar!
    await assert.rejects(
      () =>
        driver.putObservacaoEEvento(
          {
            idCliente: '11111111-1111-4111-8111-111111111111',
            idRotaCliente: '99999999-9999-4999-8999-999999999999',
            latitude: -23.664,
            longitude: -46.531,
            descricao: 'Órfã',
            tipoObservacao: 'OUTRO',
            dataCriacao: new Date().toISOString(),
            dataAtualizacao: new Date().toISOString(),
            status: STATUS_OBSERVACAO.ABERTA,
            idUsuario: 'agente-mobile',
            syncStatus: SYNC_STATUS.PENDING,
          },
          null,
          [],
        ),
      /FOREIGN KEY/i,
    );

    const rota = criarRotaMobileExemplo();
    const { rota: calc } = await repo.salvarRotaCalculada(rota, {
      pontos: rota.pontos,
      idUsuario: 'agente-mobile',
    });

    // GPS real + pontos + cache_rede
    const exec = await repo.iniciarExecucaoGps({
      idRotaOrigemCliente: calc.idCliente,
      simulado: false,
      idUsuario: 'agente-mobile',
    });
    await repo.registrarPontoGps({
      idRotaCliente: exec.idCliente,
      ponto: { latitude: -23.6639, longitude: -46.5318, precisao: 6, timestampMs: 1_700_000_000_000 },
    });
    await repo.registrarPontoGps({
      idRotaCliente: exec.idCliente,
      ponto: { latitude: -23.6648, longitude: -46.5309, precisao: 6, timestampMs: 1_700_000_015_000 },
    });
    const { rota: gpsFim } = await repo.finalizarExecucaoGps(exec.idCliente, {
      statusFinal: STATUS_ROTA.CONCLUIDA,
    });
    assert.equal(gpsFim.geometry.type, 'LineString');

    // Observação + evento na mesma transação
    const { observacao } = await repo.criarObservacaoRota({
      idRotaCliente: gpsFim.idCliente,
      latitude: -23.6645,
      longitude: -46.5312,
      tipoObservacao: 'VISITA_REALIZADA',
      descricao: 'Registro gravado em SQLite real',
      idUsuario: 'agente-mobile',
    });
    await repo.alterarStatusObservacao({
      idCliente: observacao.idCliente,
      novoStatus: STATUS_OBSERVACAO.CONCLUIDA,
      motivo: 'Confirmado em campo',
      idUsuario: 'agente-mobile',
    });

    await repo.salvarCacheRede({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { ID: 1 }, geometry: rota.geometry }],
    });

    // Fecha e reabre o mesmo arquivo SQLite para validar persistência real
    await driver.close();

    const driverReaberto = criarDriverSqliteCore({
      sqlite: criarAdaptadorNodeSqlite(),
      nomeBanco: dbPath,
    });
    const repo2 = criarRepositorioCampo({ driver: driverReaberto });
    const rotasPersistidas = await repo2.listarRotasSalvas();
    assert.equal(rotasPersistidas.length, 2);
    const obsPersistidas = await repo2.listarObservacoes({
      idRotaCliente: gpsFim.idCliente,
      incluirEventos: true,
    });
    assert.equal(obsPersistidas.length, 1);
    assert.equal(obsPersistidas[0].status, STATUS_OBSERVACAO.CONCLUIDA);
    assert.deepEqual(
      obsPersistidas[0].eventos.map((e) => e.tipoEvento),
      [TIPO_EVENTO.CRIACAO, TIPO_EVENTO.CONCLUSAO],
    );
    const cacheLido = await repo2.carregarCacheRede();
    assert.equal(cacheLido.featureCount, 1);
    await driverReaberto.close();
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('campoMobileServiceCore + criarNavegacaoMobile integram GPS real vs simulação e sincronizam com WebForms', async () => {
  const driver = criarDriverSqliteCore({
    sqlite: criarAdaptadorNodeSqlite(),
    nomeBanco: ':memory:',
  });
  let online = false;
  let seqId = 500;
  const lotes = [];

  const svc = criarServicoCampoMobileCore({
    driver,
    obterApiUrl: () => 'https://portal.exemplo/SigaRotas/ApiProxy.ashx',
    obterUsuarioId: () => 'agente-apk',
    estaOnline: () => online,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body);
      lotes.push(body);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            resultadosRotas: (body.rotas || []).map((r) => ({ idCliente: r.idCliente, idServidor: ++seqId, resultado: 'PERSISTIDO' })),
            resultadosObservacoes: (body.observacoes || []).map((o) => ({ idCliente: o.idCliente, idServidor: ++seqId, resultado: 'PERSISTIDO' })),
            resultadosEventos: (body.eventos || []).map((e) => ({ idCliente: e.idCliente, idServidor: ++seqId, resultado: 'PERSISTIDO' })),
          }),
      };
    },
  });
  await svc.inicializar();

  const rota = criarRotaMobileExemplo();
  const salva = await svc.salvarRotaCalculada(rota, { pontos: rota.pontos, origemSalvamento: 'auto' });
  assert.equal(salva.rota.tipoRota, TIPO_ROTA.CALCULADA);

  let ultimoRes = null;
  let listenerGps = null;
  const nav = criarNavegacaoMobile({
    calcularRotaParadas: async () => rota,
    criarFonteGPS: ({ aoAtualizar }) => {
      listenerGps = aoAtualizar;
      return {
        async iniciar() {
          return true;
        },
        pausar() {},
        retomar() {},
        parar() {},
        encerrar() {},
      };
    },
    aoIniciarExecucao: (r, opts) => {
      void svc.iniciarNavegacaoGps(r, opts);
    },
    aoAtualizarPontoExecucao: (p) => {
      void svc.registrarPontoGps(p).then((res) => {
        ultimoRes = res;
      });
    },
    aoPausarExecucao: () => {
      void svc.pausarNavegacaoGps();
    },
    aoRetomarExecucao: () => {
      void svc.retomarNavegacaoGps();
    },
    aoEncerrarExecucao: (info) => {
      void svc.finalizarNavegacaoGps(info);
    },
  });

  await nav.iniciar(rota, 'gps');
  listenerGps({ latitude: -23.6639, longitude: -46.5318, precisao: 6, simulado: false, timestampMs: 1_700_000_000_000 });
  listenerGps({ latitude: -23.6645, longitude: -46.5311, precisao: 6, simulado: false, timestampMs: 1_700_000_010_000 });
  // Aguarda fila FIFO do serviço concluir
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ultimoRes?.aceito, true);
  assert.equal(ultimoRes?.geometria?.type, 'LineString');

  // Enquanto não clicar em "Salvar rotas offline", GPS não cria registro automático no SQLite
  const rotasDuranteGps = await svc.listarRotasSalvas();
  assert.equal(rotasDuranteGps.length, 1);

  nav.encerrar();
  await new Promise((r) => setTimeout(r, 20));

  // Continua sem duplicar nem auto-salvar após encerrar; sessão finalizada fica disponível em memória
  assert.equal((await svc.listarRotasSalvas()).length, 1);
  assert.ok(svc.obterUltimaExecucaoGpsSessao()?.rota);

  // Ao clicar em "Salvar rotas offline", persiste GPS vinculado à rota calculada
  const salvoOffline = await svc.salvarRotasOffline({ rotaCalculada: rota, pontos: rota.pontos });
  assert.equal(salvoOffline.ok, true);
  assert.ok(salvoOffline.rotaGps?.idCliente);
  assert.equal((await svc.listarRotasSalvas()).length, 2);

  // Observação criada após salvar offline vincula à rota salva ativa
  const obs = await svc.criarObservacao({
    latitude: -23.6645,
    longitude: -46.5311,
    tipoObservacao: 'ACESSO_DIFICIL',
    descricao: 'Escadaria interditada',
  });
  assert.equal(obs.observacao.idRotaCliente, salva.rota.idCliente);

  // Volta online e sincroniza lote completo em ordem CALCULADA -> GPS -> OBSERVACAO -> EVENTO
  online = true;
  const syncRes = await svc.sincronizarAgora();
  assert.equal(syncRes.ok, true);
  assert.ok(lotes.length >= 1);
  const resumo = await svc.obterResumoSincronizacao();
  assert.equal(resumo.estado, SYNC_STATUS.SYNCED);
  await driver.close();
});

test('APK SQLite real (PRAGMA foreign_keys = ON): exclusão individual de observação/rota e limpeza de dados locais preservando cache_rede', async () => {
  const driver = criarDriverSqliteCore({
    sqlite: criarAdaptadorNodeSqlite(),
    nomeBanco: ':memory:',
  });
  const svc = criarServicoCampoMobileCore({
    driver,
    obterApiUrl: () => 'https://portal.exemplo/SigaRotas/ApiProxy.ashx',
    obterUsuarioId: () => 'agente-apk',
    estaOnline: () => false,
  });
  await svc.inicializar();

  const rota1 = criarRotaMobileExemplo();
  const rota2 = {
    ...criarRotaMobileExemplo(),
    distance: 780,
    pontos: [
      { rotulo: 'A', latitude: -23.67, longitude: -46.54, enderecoDigital: '8M4W+X2' },
      { rotulo: 'B', latitude: -23.672, longitude: -46.538, enderecoDigital: '8M4X+3C' },
    ],
  };

  // Salva rota1 + GPS real manualmente via salvarRotasOffline
  const s1 = await svc.salvarRotasOffline({ rotaCalculada: rota1, pontos: rota1.pontos });
  await svc.iniciarNavegacaoGps(rota1, { modo: 'gps' });
  await svc.registrarPontoGps({ latitude: -23.6639, longitude: -46.5318, precisao: 5, timestampMs: 1_700_000_000_000 });
  await svc.registrarPontoGps({ latitude: -23.6648, longitude: -46.5309, precisao: 5, timestampMs: 1_700_000_010_000 });
  await svc.finalizarNavegacaoGps({ concluida: true });
  const s1ComGps = await svc.salvarRotasOffline({ rotaCalculada: rota1, pontos: rota1.pontos });
  assert.equal(s1ComGps.jaExistia, false);
  assert.ok(s1ComGps.rotaGps?.idCliente);

  // Salva rota2 separadamente
  const s2 = await svc.salvarRotasOffline({ rotaCalculada: rota2, pontos: rota2.pontos });
  await svc.repositorio.salvarCacheRede({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { ID: 99 }, geometry: rota1.geometry }] });

  // Cria 2 observações na rota1 e 1 na rota2
  const obs1 = await svc.criarObservacao({
    idRotaCliente: s1.rotaCalculada.idCliente,
    latitude: -23.664,
    longitude: -46.531,
    tipoObservacao: 'VISITA_REALIZADA',
    descricao: 'Obs 1',
  });
  const obs2 = await svc.criarObservacao({
    idRotaCliente: s1.rotaCalculada.idCliente,
    latitude: -23.6641,
    longitude: -46.5312,
    tipoObservacao: 'PENDENCIA_CAMPO',
    descricao: 'Obs 2',
  });
  await svc.criarObservacao({
    idRotaCliente: s2.rotaCalculada.idCliente,
    latitude: -23.671,
    longitude: -46.539,
    tipoObservacao: 'OUTRO',
    descricao: 'Obs rota 2',
  });

  // 1) Excluir observação individual remove apenas obs1 e seus eventos, preservando obs2 e a rota
  const delObs = await svc.excluirObservacao(obs1.observacao.idCliente);
  assert.equal(delObs.ok, true);
  const obsRestR1 = await svc.listarObservacoes({ idRotaCliente: s1.rotaCalculada.idCliente });
  assert.equal(obsRestR1.length, 1);
  assert.equal(obsRestR1[0].idCliente, obs2.observacao.idCliente);

  // 2) Excluir rota1 calculada remove rota1, obs2 e desvincula s1ComGps sem erro de FK, preservando rota2
  const delRota = await svc.excluirRotaSalva(s1.rotaCalculada.idCliente);
  assert.equal(delRota.ok, true);
  assert.equal(await svc.obterRota(s1.rotaCalculada.idCliente), null);
  const gpsDesvinculado = await svc.obterRota(s1ComGps.rotaGps.idCliente);
  assert.ok(gpsDesvinculado);
  assert.equal(gpsDesvinculado.idRotaOrigemCliente, null);
  assert.ok(await svc.obterRota(s2.rotaCalculada.idCliente));

  // 3) Limpar dados locais bloqueia se navegação ativa, e funciona ao forçar interrupção preservando cache_rede
  await svc.iniciarNavegacaoGps(rota2, { modo: 'gps' });
  const bloqueado = await svc.limparDadosLocais();
  assert.equal(bloqueado.ok, false);
  assert.equal(bloqueado.motivo, 'NAVEGACAO_EM_ANDAMENTO');
  const limpo = await svc.limparDadosLocais({ forcarInterrupcaoNavegacao: true });
  assert.equal(limpo.ok, true);
  assert.equal((await svc.listarRotasSalvas()).length, 0);
  assert.equal((await svc.listarObservacoes()).length, 0);
  assert.equal((await driver.listSyncItens()).length, 0);
  assert.equal(svc.obterUltimaExecucaoGpsSessao(), null);
  const cachePreservado = await svc.repositorio.carregarCacheRede();
  assert.equal(cachePreservado.featureCount, 1);

  // Verifica contrato de UI mobile e Web (botões explícitos e modal de confirmação)
  const appMobileSrc = await fs.readFile(path.join(APK_DIR, 'App.js'), 'utf8');
  const savedSecSrc = await fs.readFile(path.join(APK_DIR, 'src/components/SavedRoutesSection.js'), 'utf8');
  const obsSecSrc = await fs.readFile(path.join(APK_DIR, 'src/components/RouteObservationsSection.js'), 'utf8');
  assert.match(savedSecSrc, /Salvar rotas offline/);
  assert.match(savedSecSrc, /Limpar dados locais/);
  assert.match(savedSecSrc, /Excluir/);
  assert.match(obsSecSrc, /Salvar rotas offline/);
  assert.match(appMobileSrc, /ConfirmActionModal/);
  assert.match(appMobileSrc, /ocorrenciasServiceRef\.current\?\.limparDadosLocais\?\.\(\)/);
  assert.match(appMobileSrc, /setOcorrencias\(\[\]\)/);
  assert.doesNotMatch(appMobileSrc, /origemSalvamento:\s*'auto'/);

  await driver.close();
});

test('mapSync emite SET_GPS_TRAIL e SET_ROUTE_OBS apenas quando informados e mantém contratos existentes', () => {
  const mensagens = [];
  const sync = criarSincronizacaoMapa((p) => mensagens.push(p));

  const propsBase = {
    ready: true,
    session: 1,
    visible: true,
    basemapMode: 'osm',
    features: [],
    markers: [],
    routeGeometry: null,
    routeSegments: [],
    navigationPosition: null,
    centerRequest: null,
    suppressRouteFit: false,
  };
  sync.atualizar(propsBase);
  assert.equal(mensagens.some((m) => m.type === 'SET_GPS_TRAIL'), false);
  assert.equal(mensagens.some((m) => m.type === 'SET_ROUTE_OBS'), false);

  const trilha = {
    type: 'LineString',
    coordinates: [
      [-46.5318, -23.6639],
      [-46.5305, -23.665],
    ],
  };
  const obsLista = [{ idCliente: 'o1', latitude: -23.664, longitude: -46.531, status: 'ABERTA' }];
  sync.atualizar({ ...propsBase, gpsTrailGeometry: trilha, routeObservations: obsLista });

  assert.deepEqual(
    mensagens.find((m) => m.type === 'SET_GPS_TRAIL'),
    { type: 'SET_GPS_TRAIL', geometry: trilha },
  );
  assert.deepEqual(
    mensagens.find((m) => m.type === 'SET_ROUTE_OBS'),
    { type: 'SET_ROUTE_OBS', observations: obsLista },
  );
});

test('Configuração APK (app.json, package.json e src/campo) inclui expo-sqlite e reexportações', async () => {
  const appJson = JSON.parse(await fs.readFile(path.join(APK_DIR, 'app.json'), 'utf8'));
  const pkgJson = JSON.parse(await fs.readFile(path.join(APK_DIR, 'package.json'), 'utf8'));
  assert.ok(appJson.expo.plugins.includes('expo-sqlite'));
  assert.ok(pkgJson.dependencies['expo-sqlite']);

  for (const mod of [
    'modeloCampo.js',
    'filtroGps.js',
    'repositorioCampo.js',
    'contratosBackend.js',
    'syncEngine.js',
  ]) {
    const content = await fs.readFile(path.join(APK_DIR, 'src/campo', mod), 'utf8');
    assert.match(content, new RegExp(`campo/${mod}`));
  }
});
