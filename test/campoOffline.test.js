import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ENTIDADE_SYNC,
  STATUS_OBSERVACAO,
  STATUS_ROTA,
  SYNC_STATUS,
  SYNC_UI_LABEL,
  TIPO_EVENTO,
  TIPO_ROTA,
  geojsonParaWkt,
  reconstruirRespostaRotaDeRegistro,
  rotuloIndicadorSync,
  wktParaGeojson,
} from '../campo/modeloCampo.js';
import {
  CONFIG_FILTRO_GPS,
  consolidarPontosEmGeometria,
  filtrarPontoGps,
} from '../campo/filtroGps.js';
import {
  criarDriverMemoria,
  criarRepositorioCampo,
  resolverRotaAtivaParaObservacao,
} from '../campo/repositorioCampo.js';
import {
  criarClienteBackendCampo,
  montarUrlAcaoCampo,
  resolverUrlBackendCampo,
} from '../campo/contratosBackend.js';
import {
  BACKOFF_SEGUNDOS,
  criarMotorSincronizacao,
} from '../campo/syncEngine.js';
import { criarDriverIndexedDB } from '../public/armazenamentoIndexedDB.js';
import { criarServicoCampoWeb } from '../public/campoWebService.js';
import { createServer } from '../server/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function criarRotaExemplo(distancia = 480) {
  return {
    ok: true,
    distance: distancia,
    modo: 'usuario',
    circular: true,
    pontos: [
      { rotulo: 'A', latitude: -23.6639, longitude: -46.5318, enderecoDigital: '8M59+C7' },
      { rotulo: 'B', latitude: -23.6652, longitude: -46.5295, enderecoDigital: '8M4C+W5' },
    ],
    legs: [
      {
        de: 'A',
        para: 'B',
        distance: distancia / 2,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-46.5318, -23.6639],
            [-46.5306, -23.6645],
            [-46.5295, -23.6652],
          ],
        },
        legs: [{ street: 'Rua Coronel Alfredo Flaquer', length: distancia / 2, official: true }],
      },
      {
        de: 'B',
        para: 'A',
        retorno: true,
        distance: distancia / 2,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-46.5295, -23.6652],
            [-46.5308, -23.6642],
            [-46.5318, -23.6639],
          ],
        },
        legs: [{ street: 'Av. José Caballero', length: distancia / 2, official: true }],
      },
    ],
    geometry: {
      type: 'LineString',
      coordinates: [
        [-46.5318, -23.6639],
        [-46.5306, -23.6645],
        [-46.5295, -23.6652],
        [-46.5308, -23.6642],
        [-46.5318, -23.6639],
      ],
    },
  };
}

function criarFakeIndexedDB() {
  const bancos = new Map();

  function makeReq(executor) {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    queueMicrotask(() => {
      try {
        executor(req);
      } catch (err) {
        req.error = err;
        if (req.onerror) req.onerror({ target: req });
      }
    });
    return req;
  }

  return {
    open(name, version = 1) {
      const req = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        let state = bancos.get(name);
        const precisaUpgrade = !state || state.version < version;
        if (!state) {
          state = { version, stores: new Map() };
          bancos.set(name, state);
        }
        state.version = version;

        const db = {
          objectStoreNames: {
            contains: (s) => state.stores.has(s),
          },
          createObjectStore(storeName, { keyPath }) {
            if (!state.stores.has(storeName)) {
              state.stores.set(storeName, { keyPath, records: new Map(), indexes: new Map() });
            }
            const storeMeta = state.stores.get(storeName);
            return {
              createIndex(idxName, kp) {
                storeMeta.indexes.set(idxName, kp);
              },
            };
          },
          transaction(storeNames) {
            const list = Array.isArray(storeNames) ? storeNames : [storeNames];
            const tx = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              error: null,
              objectStore(storeName) {
                const storeMeta = state.stores.get(storeName);
                if (!storeMeta) throw new Error(`ObjectStore ${storeName} não existe`);
                const keyPath = storeMeta.keyPath;
                return {
                  put(val) {
                    const cloned = JSON.parse(JSON.stringify(val));
                    const k = cloned[keyPath];
                    storeMeta.records.set(k, cloned);
                    return makeReq((r) => {
                      r.result = k;
                      if (r.onsuccess) r.onsuccess({ target: r });
                    });
                  },
                  get(key) {
                    return makeReq((r) => {
                      const val = storeMeta.records.get(key);
                      r.result = val ? JSON.parse(JSON.stringify(val)) : undefined;
                      if (r.onsuccess) r.onsuccess({ target: r });
                    });
                  },
                  getAll(key) {
                    return makeReq((r) => {
                      const all = Array.from(storeMeta.records.values());
                      const filt = key === undefined ? all : all.filter((v) => v[keyPath] === key);
                      r.result = filt.map((v) => JSON.parse(JSON.stringify(v)));
                      if (r.onsuccess) r.onsuccess({ target: r });
                    });
                  },
                  index(idxName) {
                    const kp = storeMeta.indexes.get(idxName);
                    return {
                      getAll(val) {
                        return makeReq((r) => {
                          const all = Array.from(storeMeta.records.values());
                          const filt = val === undefined ? all : all.filter((item) => item[kp] === val);
                          r.result = filt.map((v) => JSON.parse(JSON.stringify(v)));
                          if (r.onsuccess) r.onsuccess({ target: r });
                        });
                      },
                    };
                  },
                };
              },
            };
            // Mantém compatibilidade com tx.oncomplete depois das microtasks dos requests
            setTimeout(() => {
              if (list.length && tx.oncomplete) tx.oncomplete({});
            }, 0);
            return tx;
          },
          close() {},
        };

        req.result = db;
        if (precisaUpgrade && req.onupgradeneeded) {
          req.onupgradeneeded({ target: req });
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };
}

test('WKT <-> GeoJSON preserva POINT, LINESTRING e MULTILINESTRING', () => {
  const pt = { type: 'Point', coordinates: [-46.5318, -23.6639] };
  assert.equal(geojsonParaWkt(pt), 'POINT (-46.5318 -23.6639)');
  assert.deepEqual(wktParaGeojson('POINT (-46.5318 -23.6639)'), pt);

  const line = {
    type: 'LineString',
    coordinates: [
      [-46.5318, -23.6639],
      [-46.5308, -23.6642],
    ],
  };
  assert.deepEqual(wktParaGeojson(geojsonParaWkt(line)), line);

  const multi = {
    type: 'MultiLineString',
    coordinates: [
      [
        [-46.5318, -23.6639],
        [-46.531, -23.6641],
      ],
      [
        [-46.529, -23.665],
        [-46.528, -23.6655],
      ],
    ],
  };
  const wkt = geojsonParaWkt(multi);
  assert.match(wkt, /^MULTILINESTRING/);
  assert.deepEqual(wktParaGeojson(wkt), multi);
});

test('Rota calculada é salva offline (auto + manual), sem duplicar por assinatura, e reabre sem servidor', async () => {
  const repo = criarRepositorioCampo();
  const rota = criarRotaExemplo(520);

  const auto = await repo.salvarRotaCalculada(rota, {
    pontos: rota.pontos,
    origemSalvamento: 'auto',
    idUsuario: 'agente-1',
  });
  assert.equal(auto.criada, true);
  assert.equal(auto.rota.tipoRota, TIPO_ROTA.CALCULADA);
  assert.equal(auto.rota.origemSalvamento, 'auto');

  const manual = await repo.salvarRotaCalculada(rota, {
    pontos: rota.pontos,
    origemSalvamento: 'manual',
    titulo: 'Rota Centro Manhã',
    idUsuario: 'agente-1',
  });
  assert.equal(manual.criada, false);
  assert.equal(manual.atualizada, true);
  assert.equal(manual.rota.idCliente, auto.rota.idCliente);
  assert.equal(manual.rota.origemSalvamento, 'manual');
  assert.equal(manual.rota.titulo, 'Rota Centro Manhã');

  const lista = await repo.listarRotasSalvas();
  assert.equal(lista.length, 1);

  const reconstruida = reconstruirRespostaRotaDeRegistro(lista[0]);
  assert.equal(reconstruida.ok, true);
  assert.equal(reconstruida.distance, 520);
  assert.equal(reconstruida.legs.length, 2);
  assert.equal(reconstruida.geometry.type, 'LineString');
});

test('Filtro GPS descarta baixa precisão, micro-ruído e saltos impossíveis, e divide MultiLineString sem ligar saltos', async () => {
  const t0 = 1_700_000_000_000;
  const repo = criarRepositorioCampo({ agora: () => t0 });
  const rota = criarRotaExemplo(400);
  const { rota: calc } = await repo.salvarRotaCalculada(rota, { pontos: rota.pontos });
  const exec = await repo.iniciarExecucaoGps({ idRotaOrigemCliente: calc.idCliente, simulado: false });

  // Ponto 1 válido
  const p1 = await repo.registrarPontoGps({
    idRotaCliente: exec.idCliente,
    ponto: { latitude: -23.6639, longitude: -46.5318, precisao: 8, timestampMs: t0 },
  });
  assert.equal(p1.aceito, true);

  // Precisão ruim (> 120 m) descartada
  const pRuim = await repo.registrarPontoGps({
    idRotaCliente: exec.idCliente,
    ponto: { latitude: -23.664, longitude: -46.5315, precisao: 250, timestampMs: t0 + 2000 },
  });
  assert.equal(pRuim.aceito, false);
  assert.equal(pRuim.motivo, 'BAIXA_PRECISAO');

  // Jitter (< 2.5 m em < 5 s) descartado
  const pJitter = await repo.registrarPontoGps({
    idRotaCliente: exec.idCliente,
    ponto: { latitude: -23.663902, longitude: -46.531802, precisao: 6, timestampMs: t0 + 2000 },
  });
  assert.equal(pJitter.aceito, false);
  assert.equal(pJitter.motivo, 'MICRO_JITTER');

  // Salto impossível (> 28 m/s em <= 15s) descartado (ex.: 1 km em 3 s)
  const pSalto = await repo.registrarPontoGps({
    idRotaCliente: exec.idCliente,
    ponto: { latitude: -23.654, longitude: -46.5318, precisao: 10, timestampMs: t0 + 3000 },
  });
  assert.equal(pSalto.aceito, false);
  assert.equal(pSalto.motivo, 'SALTO_ABSURDO');

  // Ponto 2 válido (~65 m em 12 s)
  const p2 = await repo.registrarPontoGps({
    idRotaCliente: exec.idCliente,
    ponto: { latitude: -23.66445, longitude: -46.5318, precisao: 7, timestampMs: t0 + 12_000 },
  });
  assert.equal(p2.aceito, true);
  assert.equal(p2.novoSegmento, false);

  // Pausa + retomada após gap longo (> 120s e > 35m) ou quebra explícita -> MultiLineString
  await repo.pausarExecucaoGps(exec.idCliente);
  await repo.retomarExecucaoGps(exec.idCliente);

  const p3 = await repo.registrarPontoGps({
    idRotaCliente: exec.idCliente,
    ponto: { latitude: -23.6665, longitude: -46.529, precisao: 9, timestampMs: t0 + 200_000 },
  });
  assert.equal(p3.aceito, true);
  assert.equal(p3.novoSegmento, true);

  const p4 = await repo.registrarPontoGps({
    idRotaCliente: exec.idCliente,
    ponto: { latitude: -23.667, longitude: -46.5285, precisao: 8, timestampMs: t0 + 220_000 },
  });
  assert.equal(p4.aceito, true);

  const fim = await repo.finalizarExecucaoGps(exec.idCliente, { statusFinal: STATUS_ROTA.CONCLUIDA });
  assert.equal(fim.rota.geometry.type, 'MultiLineString');
  assert.equal(fim.rota.geometry.coordinates.length, 2);
  assert.equal(fim.rota.idRotaOrigemCliente, calc.idCliente);

  // Rota CALCULADA original permanece intocada!
  const calcReloaded = await repo.obterRota(calc.idCliente);
  assert.equal(calcReloaded.tipoRota, TIPO_ROTA.CALCULADA);
  assert.equal(calcReloaded.distanciaMetros, 400);
});

test('Simulação nunca gera registro pendente na fila de sync e observações respeitam vínculo da rota real', async () => {
  const repo = criarRepositorioCampo();
  const rota = criarRotaExemplo(300);
  const { rota: calc } = await repo.salvarRotaCalculada(rota, { pontos: rota.pontos });

  // Simulação em modo de teste
  const simExec = await repo.iniciarExecucaoGps({
    idRotaOrigemCliente: calc.idCliente,
    simulado: true,
  });
  await repo.registrarPontoGps({
    idRotaCliente: simExec.idCliente,
    ponto: { latitude: -23.6639, longitude: -46.5318, precisao: 1, simulado: true, timestampMs: 1000 },
  });
  await repo.registrarPontoGps({
    idRotaCliente: simExec.idCliente,
    ponto: { latitude: -23.6645, longitude: -46.531, precisao: 1, simulado: true, timestampMs: 6000 },
  });
  const simFim = await repo.finalizarExecucaoGps(simExec.idCliente);
  assert.equal(simFim.enfileirada, false);
  assert.equal(simFim.rota.syncStatus, SYNC_STATUS.SYNCED);

  // Regra de vínculo: com simulação ativa, observação vincula à rota CALCULADA, nunca à simulada
  const alvoSim = resolverRotaAtivaParaObservacao({
    execucaoGpsAtiva: simExec,
    rotaCalculadaAtiva: calc,
  });
  assert.equal(alvoSim.idCliente, calc.idCliente);

  // Com GPS real em execução, vincula ao GPS real
  const gpsReal = await repo.iniciarExecucaoGps({ idRotaOrigemCliente: calc.idCliente, simulado: false });
  const alvoReal = resolverRotaAtivaParaObservacao({
    execucaoGpsAtiva: gpsReal,
    rotaCalculadaAtiva: calc,
  });
  assert.equal(alvoReal.idCliente, gpsReal.idCliente);

  // Sem rota -> erro explícito
  await assert.rejects(
    () =>
      repo.criarObservacaoRota({
        idRotaCliente: null,
        latitude: -23.664,
        longitude: -46.531,
        descricao: 'Sem rota',
      }),
    /vinculada a uma rota/i,
  );
});

test('Crash recovery detecta execução GPS EM_ANDAMENTO após reinício e força novo segmento ao retomar', async () => {
  const driver = criarDriverMemoria();
  const t0 = 1_700_000_000_000;
  const repo1 = criarRepositorioCampo({ driver, agora: () => t0 });

  const exec = await repo1.iniciarExecucaoGps({ simulado: false });
  await repo1.registrarPontoGps({
    idRotaCliente: exec.idCliente,
    ponto: { latitude: -23.6639, longitude: -46.5318, precisao: 5, timestampMs: t0 },
  });
  await repo1.registrarPontoGps({
    idRotaCliente: exec.idCliente,
    ponto: { latitude: -23.6642, longitude: -46.5316, precisao: 5, timestampMs: t0 + 10_000 },
  });

  // Simula reabertura do app em nova instância usando o mesmo banco persistido
  const repo2 = criarRepositorioCampo({ driver, agora: () => t0 + 30_000 });
  const emAndamento = await repo2.listarExecucoesGpsEmAndamento();
  assert.equal(emAndamento.length, 1);
  assert.equal(emAndamento[0].totalPontos, 2);

  // Novos pontos após reabertura não ligam por linha reta se houver pausa/crash (novoSegmento = true)
  const ret = await repo2.registrarPontoGps({
    idRotaCliente: exec.idCliente,
    ponto: { latitude: -23.6648, longitude: -46.531, precisao: 5, timestampMs: t0 + 30_000 },
  });
  assert.equal(ret.aceito, true);
  assert.equal(ret.novoSegmento, true);
});

test('Observação de rota gera eventos CRIACAO, EDICAO, CONCLUSAO e REABERTURA em ordem e mantém vínculo após sincronização', async () => {
  const repo = criarRepositorioCampo();
  const { rota } = await repo.salvarRotaCalculada(criarRotaExemplo(), {
    pontos: criarRotaExemplo().pontos,
  });

  const { observacao: obs1 } = await repo.criarObservacaoRota({
    idRotaCliente: rota.idCliente,
    latitude: -23.6641,
    longitude: -46.5315,
    tipoObservacao: 'IMOVEL_FECHADO',
    descricao: 'Portão trancado na primeira tentativa',
    idUsuario: 'agente-ana',
  });
  assert.equal(obs1.status, STATUS_OBSERVACAO.ABERTA);

  await repo.editarObservacaoRota({
    idCliente: obs1.idCliente,
    tipoObservacao: 'RECUSA_ATENDIMENTO',
    descricao: 'Morador solicitou retorno amanhã',
    idUsuario: 'agente-ana',
  });

  await repo.alterarStatusObservacao({
    idCliente: obs1.idCliente,
    novoStatus: STATUS_OBSERVACAO.CONCLUIDA,
    motivo: 'Atendimento finalizado no retorno',
    idUsuario: 'agente-ana',
  });

  await repo.alterarStatusObservacao({
    idCliente: obs1.idCliente,
    novoStatus: STATUS_OBSERVACAO.REABERTA,
    motivo: 'Nova solicitação de conferência',
    idUsuario: 'agente-ana',
  });

  const listadas = await repo.listarObservacoes({ idRotaCliente: rota.idCliente, incluirEventos: true });
  assert.equal(listadas.length, 1);
  assert.equal(listadas[0].status, STATUS_OBSERVACAO.REABERTA);
  assert.equal(listadas[0].versaoLocal, 4);
  assert.deepEqual(
    listadas[0].eventos.map((e) => e.tipoEvento),
    [TIPO_EVENTO.CRIACAO, TIPO_EVENTO.EDICAO, TIPO_EVENTO.CONCLUSAO, TIPO_EVENTO.REABERTURA],
  );
});

test('SyncEngine sincroniza lote ordenado (CALCULADA -> GPS -> OBSERVACAO -> EVENTO), recupera SYNCING, aplica backoff e sinaliza CONFLITO sem apagar dados locais', async () => {
  const driver = criarDriverMemoria();
  let agoraMs = 1_700_000_000_000;
  const repo = criarRepositorioCampo({ driver, agora: () => agoraMs });

  const rotaExemplo = criarRotaExemplo(350);
  const { rota: calc } = await repo.salvarRotaCalculada(rotaExemplo, { pontos: rotaExemplo.pontos });
  const gpsExec = await repo.iniciarExecucaoGps({ idRotaOrigemCliente: calc.idCliente, simulado: false });
  await repo.registrarPontoGps({
    idRotaCliente: gpsExec.idCliente,
    ponto: { latitude: -23.6639, longitude: -46.5318, precisao: 5, timestampMs: agoraMs },
  });
  await repo.registrarPontoGps({
    idRotaCliente: gpsExec.idCliente,
    ponto: { latitude: -23.6644, longitude: -46.5312, precisao: 5, timestampMs: agoraMs + 8000 },
  });
  const { rota: gpsFinal } = await repo.finalizarExecucaoGps(gpsExec.idCliente);
  const { observacao: obs } = await repo.criarObservacaoRota({
    idRotaCliente: gpsFinal.idCliente,
    latitude: -23.6644,
    longitude: -46.5312,
    tipoObservacao: 'VISITA_REALIZADA',
    descricao: 'Vistoria concluída no imóvel',
  });

  // Simula item travado em SYNCING antes da queda do app
  const pendentesAntes = await driver.listSyncItens();
  await driver.upsertSyncItem({ ...pendentesAntes[0], status: SYNC_STATUS.SYNCING });

  let online = false;
  let seqServidor = 100;
  let modoServidor = 'erro_500';
  const lotesRecebidos = [];

  const clienteBackend = criarClienteBackendCampo({
    obterBaseUrl: () => 'https://portal.exemplo/SigaRotasCampo.ashx',
    fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body);
      lotesRecebidos.push(body);
      if (modoServidor === 'erro_500') {
        return { ok: false, status: 503, text: async () => 'Indisponível' };
      }
      if (modoServidor === 'erro_400') {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ ok: false, reason: 'ERRO_VALIDACAO', message: 'Lote recusado para teste' }),
        };
      }
      if (modoServidor === 'conflito') {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ok: true,
              resultadosRotas: (body.rotas || []).map((r) => ({
                idCliente: r.idCliente,
                idServidor: ++seqServidor,
                resultado: 'PERSISTIDO',
              })),
              resultadosObservacoes: (body.observacoes || []).map((o) => ({
                idCliente: o.idCliente,
                resultado: 'CONFLITO',
                versaoServidor: 9,
                dataAtualizacaoServidor: '2026-11-16T12:00:00Z',
                mensagem: 'Versão no servidor é mais recente.',
              })),
              resultadosEventos: (body.eventos || []).map((e) => ({
                idCliente: e.idCliente,
                resultado: 'OBSERVACAO_NAO_ENCONTRADA',
                mensagem: 'Aguardando resolução da observação',
              })),
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            resultadosRotas: (body.rotas || []).map((r) => ({
              idCliente: r.idCliente,
              idServidor: ++seqServidor,
              resultado: 'PERSISTIDO',
            })),
            resultadosObservacoes: (body.observacoes || []).map((o) => ({
              idCliente: o.idCliente,
              idServidor: ++seqServidor,
              resultado: 'PERSISTIDO',
            })),
            resultadosEventos: (body.eventos || []).map((e) => ({
              idCliente: e.idCliente,
              idServidor: ++seqServidor,
              resultado: 'PERSISTIDO',
            })),
          }),
      };
    },
  });

  // Nova instância do motor/repositório após reinício -> reseta SYNCING para PENDING
  const repoReinicio = criarRepositorioCampo({ driver, agora: () => agoraMs });
  await repoReinicio.inicializar();
  const resumoOffline = await repoReinicio.obterResumoSincronizacao({ online });
  assert.equal(resumoOffline.texto, SYNC_UI_LABEL.SALVO_DISPOSITIVO);
  assert.equal(resumoOffline.pendentes, 4); // calc + gps + obs + evt

  const engine = criarMotorSincronizacao({
    repositorio: repoReinicio,
    clienteBackend,
    estaOnline: () => online,
    agora: () => agoraMs,
  });

  // 1) Volta online mas servidor retorna 503 transitório -> preserva PENDING e não apaga fila
  online = true;
  const r503 = await engine.sincronizarPendentes();
  assert.equal(r503.ok, false);
  const resumo503 = await repoReinicio.obterResumoSincronizacao({ online: false });
  assert.equal(resumo503.pendentes, 4);

  // 2) Erro não-transitório (HTTP 400) -> marca ERROR, exibe "Falha na sincronização" e bloqueia auto-retry por backoff
  modoServidor = 'erro_400';
  const rFalha = await engine.sincronizarPendentes();
  assert.equal(rFalha.ok, false);
  const resumoFalha = await repoReinicio.obterResumoSincronizacao({ online });
  assert.equal(resumoFalha.texto, SYNC_UI_LABEL.FALHA);
  assert.equal(resumoFalha.podeTentarManual, true);

  // Backoff impede nova tentativa automática imediata antes do prazo
  const chamadasAntesBackoff = lotesRecebidos.length;
  const rBackoff = await engine.sincronizarPendentes();
  assert.equal(rBackoff.sincronizados, 0);
  assert.equal(lotesRecebidos.length, chamadasAntesBackoff);

  // 3) Tentativa manual força reenvio e testa CONFLITO de observação
  modoServidor = 'conflito';
  const rConflito = await engine.tentarSincronizarAgora();
  assert.equal(rConflito.conflitos, 1);
  const obsConflito = await driver.getObservacao(obs.idCliente);
  assert.equal(obsConflito.syncStatus, SYNC_STATUS.ERROR);
  assert.equal(obsConflito.conflitoServidor.versaoServidor, 9);
  // Registro local é preservado integralmente mesmo com conflito!
  assert.equal(obsConflito.descricao, 'Vistoria concluída no imóvel');

  // 4) Após resolver conflito (servidor aceita), tenta novamente e propaga IDs do servidor
  modoServidor = 'sucesso';
  agoraMs += BACKOFF_SEGUNDOS[0] * 1000 + 2000;
  const rOk = await engine.tentarSincronizarAgora();
  assert.equal(rOk.ok, true);

  // Ordem garantida no lote: rotas (CALCULADA antes de GPS) -> observacoes -> eventos
  const calcFinal = await driver.getRota(calc.idCliente);
  const gpsSync = await driver.getRota(gpsFinal.idCliente);
  const obsSync = await driver.getObservacao(obs.idCliente);
  assert.equal(calcFinal.syncStatus, SYNC_STATUS.SYNCED);
  assert.ok(calcFinal.idServidor > 100);
  assert.equal(gpsSync.syncStatus, SYNC_STATUS.SYNCED);
  assert.equal(obsSync.syncStatus, SYNC_STATUS.SYNCED);
  assert.ok(obsSync.idServidor > calcFinal.idServidor);

  const resumoFinal = await repoReinicio.obterResumoSincronizacao({ online });
  assert.equal(resumoFinal.texto, SYNC_UI_LABEL.SINCRONIZADO);
  assert.ok(lotesRecebidos.length >= 2);
});

test('Driver IndexedDB (6 object stores) persiste offline rotas, GPS, observações, eventos, fila e cache_rede', async () => {
  const fakeIdb = criarFakeIndexedDB();
  const driver = criarDriverIndexedDB({ indexedDB: fakeIdb, nomeBanco: 'siga-rotas-teste-idb' });
  const repo = criarRepositorioCampo({ driver });

  const rota = criarRotaExemplo(410);
  const { rota: calc } = await repo.salvarRotaCalculada(rota, { pontos: rota.pontos });
  await repo.salvarCacheRede({ type: 'FeatureCollection', features: [{ id: 1, geometry: rota.geometry }] });
  const cache = await repo.carregarCacheRede();
  assert.equal(cache.featureCount, 1);

  const { observacao, evento } = await repo.criarObservacaoRota({
    idRotaCliente: calc.idCliente,
    latitude: -23.664,
    longitude: -46.5315,
    tipoObservacao: 'PENDENCIA_CAMPO',
    descricao: 'Calçada obstruída no trecho',
  });
  assert.equal(evento.idObservacaoCliente, observacao.idCliente);

  const rotasLidas = await repo.listarRotasSalvas();
  assert.equal(rotasLidas.length, 1);
  const obsLidas = await repo.listarObservacoes({ idRotaCliente: calc.idCliente, incluirEventos: true });
  assert.equal(obsLidas.length, 1);
  assert.equal(obsLidas[0].eventos.length, 1);

  // Simula item travado em SYNCING e valida reset no restart
  const itens = await driver.listSyncItens();
  await driver.upsertSyncItem({ ...itens[0], status: SYNC_STATUS.SYNCING });
  const resetCount = await driver.resetSyncingParaPending();
  assert.equal(resetCount, 1);
});

test('Serviço Web serializa ciclo GPS (FIFO) mesmo se pontos chegarem durante inicialização assíncrona', async () => {
  const svc = criarServicoCampoWeb({
    driver: criarDriverMemoria(),
    obterUsuarioId: () => 'agente-web',
    estaOnline: () => false,
  });
  await svc.inicializar();
  const rota = criarRotaExemplo(300);

  // Dispara início, 2 pontos e fim sem aguardar um pelo outro — cadeia FIFO garante ordenação
  const pInit = svc.iniciarNavegacaoGps(rota, { modo: 'gps' });
  const p1 = svc.registrarPontoGps({ latitude: -23.6639, longitude: -46.5318, precisao: 5, timestampMs: 1000 });
  const p2 = svc.registrarPontoGps({ latitude: -23.6646, longitude: -46.531, precisao: 5, timestampMs: 10000 });
  const pEnd = svc.finalizarNavegacaoGps({ concluida: true });

  const [exec, r1, r2, rFim] = await Promise.all([pInit, p1, p2, pEnd]);
  assert.ok(exec.idCliente);
  assert.equal(r1.aceito, true);
  assert.equal(r2.aceito, true);
  assert.equal(rFim.rota.status, STATUS_ROTA.CONCLUIDA);
  assert.equal(rFim.rota.geometry.type, 'LineString');
  assert.equal(rFim.rota.geometry.coordinates.length, 2);
});

test('Servidor estático serve /campo/*.js, armazenamentoIndexedDB.js, campoWebService.js e sw.js atualizado', async () => {
  const serviceMock = {
    options: { autoUpdate: { enabled: false }, layerName: 'teste' },
    update: { lastWfsError: null, lastWfsSuccessAt: null },
    status: () => ({ ready: true, source: 'snapshot' }),
    ensureReady: async () => ({
      graph: { diagnostics: {} },
      features: [],
      diagnostics: {},
      source: 'snapshot',
      strategy: 'mock',
      builtAt: Date.now(),
      elapsedMs: 1,
      serverTotal: 0,
      attributes: [],
      warnings: [],
    }),
  };
  const srv = createServer({ service: serviceMock });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const addr = srv.address();
    const base = `http://127.0.0.1:${addr.port}`;
    for (const rotaPath of [
      '/campo/modeloCampo.js',
      '/campo/filtroGps.js',
      '/campo/repositorioCampo.js',
      '/campo/contratosBackend.js',
      '/campo/syncEngine.js',
      '/armazenamentoIndexedDB.js',
      '/campoWebService.js',
      '/config.js',
      '/sw.js',
    ]) {
      const resp = await fetch(`${base}${rotaPath}`);
      assert.equal(resp.status, 200, `${rotaPath} deve responder 200`);
    }

    const swText = await fetch(`${base}/sw.js`).then((r) => r.text());
    assert.match(swText, /armazenamentoIndexedDB\.js/);
    assert.match(swText, /campoWebService\.js/);
    assert.match(swText, /\/campo\/syncEngine\.js/);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

test('Contrato WebForms (SigaRotasCampo.ashx) e scripts Oracle 11g (SRID NULL) seguem padrões exigidos', async () => {
  const ashx = await fs.readFile(path.join(ROOT_DIR, 'webforms/SigaRotasCampo.ashx'), 'utf8');
  assert.match(ashx, /interface ISigaRotasCampoDal/);
  assert.match(ashx, /CriarDal\(\)/);
  assert.match(ashx, /ResolverUsuarioAutenticado/);
  assert.match(ashx, /sincronizar/);
  assert.match(ashx, /resultadosRotas/);
  assert.match(ashx, /resultadosObservacoes/);
  assert.match(ashx, /resultadosEventos/);

  const urlAshx = resolverUrlBackendCampo({ apiUrl: 'https://portal.gov.br/SigaRotas/ApiProxy.ashx' });
  assert.equal(urlAshx, 'https://portal.gov.br/SigaRotas/SigaRotasCampo.ashx');
  assert.equal(
    montarUrlAcaoCampo('https://portal.gov.br/SigaRotas/SigaRotasCampo.ashx', 'sincronizar'),
    'https://portal.gov.br/SigaRotas/SigaRotasCampo.ashx?acao=sincronizar',
  );

  const sql01 = await fs.readFile(path.join(ROOT_DIR, 'sql/oracle/01_tabelas_sequences_siga_rota.sql'), 'utf8');
  const sql02 = await fs.readFile(path.join(ROOT_DIR, 'sql/oracle/02_indices_e_sdo_metadata_oracle11g.sql'), 'utf8');
  const sql03 = await fs.readFile(path.join(ROOT_DIR, 'sql/oracle/03_pkg_siga_rotas_oracle11g.sql'), 'utf8');
  const cs04 = await fs.readFile(path.join(ROOT_DIR, 'sql/oracle/04_exemplo_dal_csharp.cs'), 'utf8');

  // Oracle 11g: sem GENERATED ALWAYS AS IDENTITY nem IS JSON no DDL; com SEQUENCE, CLOB e SDO_SRID = NULL
  const sql01SemComentarios = sql01.replace(/--.*$/gm, '');
  assert.doesNotMatch(sql01SemComentarios, /GENERATED\s+ALWAYS\s+AS\s+IDENTITY/i);
  assert.doesNotMatch(sql01SemComentarios, /\bIS\s+JSON\b/i);
  assert.match(sql01, /CREATE SEQUENCE SEQ_SIGA_ROTA\b/);
  assert.match(sql01, /CREATE TABLE SIGA_ROTA\b/);
  assert.match(sql01, /CREATE TABLE SIGA_ROTA_OBSERVACAO\b/);
  assert.match(sql01, /CREATE TABLE SIGA_ROTA_EVENTO\b/);
  assert.match(sql01, /MDSYS\.SDO_GEOMETRY/);
  assert.match(sql02, /USER_SDO_GEOM_METADATA/);
  assert.match(sql02, /SPATIAL_INDEX/);
  assert.match(sql02, /\bNULL\b/);
  assert.match(sql03, /CREATE OR REPLACE PACKAGE PKG_SIGA_ROTAS/);
  assert.match(sql03, /SDO_UTIL\.FROM_WKTGEOMETRY/);
  assert.match(cs04, /ISigaRotasCampoDal/);
});
