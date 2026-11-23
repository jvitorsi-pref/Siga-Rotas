/**
 * APK/src/services/armazenamentoSqliteCore.js — Persistência SQLite Offline-First
 * -------------------------------------------------------------------------------
 * Driver compatível com `expo-sqlite` (SDK 52 async API) e testável em Node via
 * injeção de dependência (`sqlite: { openDatabaseAsync }`).
 *
 * Tabelas criadas no aparelho:
 *   • rotas_campo         (CALCULADA e GPS com vínculo id_rota_origem_cliente)
 *   • pontos_gps          (gravação incremental com FK CASCADE / preservação)
 *   • observacoes_rota    (vinculadas obrigatoriamente a rotas_campo)
 *   • observacoes_eventos (histórico/auditoria de interações)
 *   • sync_fila           (fila transacional idempotente)
 *   • cache_rede          (cache vetorial separado das tabelas operacionais)
 */

import { ENTIDADE_SYNC, SYNC_STATUS, TIPO_ROTA } from '../campo/modeloCampo.js';

export const NOME_BANCO_SQLITE = 'siga_rotas_campo.db';

const DDL_INICIAL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rotas_campo (
  id_cliente TEXT PRIMARY KEY NOT NULL,
  id_servidor INTEGER,
  id_rota_origem_cliente TEXT,
  id_rota_origem_servidor INTEGER,
  tipo_rota TEXT NOT NULL,
  geometria_json TEXT,
  distancia_metros REAL NOT NULL DEFAULT 0,
  duracao_segundos INTEGER NOT NULL DEFAULT 0,
  titulo TEXT,
  modo_calculo TEXT,
  circular INTEGER NOT NULL DEFAULT 1,
  pontos_json TEXT,
  legs_json TEXT,
  assinatura TEXT,
  origem_salvamento TEXT,
  simulado INTEGER NOT NULL DEFAULT 0,
  data_criacao TEXT NOT NULL,
  data_inicio TEXT,
  data_fim TEXT,
  data_atualizacao TEXT NOT NULL,
  versao_local INTEGER NOT NULL DEFAULT 1,
  versao_servidor INTEGER,
  status TEXT NOT NULL,
  id_usuario TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  sync_erro TEXT
);
CREATE INDEX IF NOT EXISTS idx_rotas_campo_tipo ON rotas_campo(tipo_rota, data_criacao DESC);
CREATE INDEX IF NOT EXISTS idx_rotas_campo_assinatura ON rotas_campo(assinatura);
CREATE INDEX IF NOT EXISTS idx_rotas_campo_sync ON rotas_campo(sync_status);

CREATE TABLE IF NOT EXISTS pontos_gps (
  id_ponto TEXT PRIMARY KEY NOT NULL,
  id_rota_cliente TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  precisao REAL,
  rumo REAL,
  velocidade REAL,
  timestamp_ms INTEGER NOT NULL,
  simulado INTEGER NOT NULL DEFAULT 0,
  segmento_indice INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL,
  FOREIGN KEY (id_rota_cliente) REFERENCES rotas_campo(id_cliente) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pontos_gps_rota_ordem ON pontos_gps(id_rota_cliente, ordem ASC);

CREATE TABLE IF NOT EXISTS observacoes_rota (
  id_cliente TEXT PRIMARY KEY NOT NULL,
  id_servidor INTEGER,
  id_rota_cliente TEXT NOT NULL,
  id_rota_servidor INTEGER,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  geometria_json TEXT NOT NULL,
  descricao TEXT NOT NULL,
  tipo_observacao TEXT NOT NULL,
  data_criacao TEXT NOT NULL,
  data_atualizacao TEXT NOT NULL,
  versao_local INTEGER NOT NULL DEFAULT 1,
  versao_servidor INTEGER,
  id_usuario TEXT NOT NULL,
  status TEXT NOT NULL,
  simulado INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL,
  sync_erro TEXT,
  conflito_json TEXT,
  FOREIGN KEY (id_rota_cliente) REFERENCES rotas_campo(id_cliente)
);
CREATE INDEX IF NOT EXISTS idx_obs_rota_cliente ON observacoes_rota(id_rota_cliente, data_atualizacao DESC);
CREATE INDEX IF NOT EXISTS idx_obs_sync_status ON observacoes_rota(sync_status);

CREATE TABLE IF NOT EXISTS observacoes_eventos (
  id_cliente TEXT PRIMARY KEY NOT NULL,
  id_servidor INTEGER,
  id_observacao_cliente TEXT NOT NULL,
  id_observacao_servidor INTEGER,
  tipo_evento TEXT NOT NULL,
  dados_evento_json TEXT,
  data_evento TEXT NOT NULL,
  id_usuario TEXT NOT NULL,
  simulado INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL,
  sync_erro TEXT,
  FOREIGN KEY (id_observacao_cliente) REFERENCES observacoes_rota(id_cliente)
);
CREATE INDEX IF NOT EXISTS idx_evt_obs_data ON observacoes_eventos(id_observacao_cliente, data_evento ASC);

CREATE TABLE IF NOT EXISTS sync_fila (
  id_sync TEXT PRIMARY KEY NOT NULL,
  entidade_tipo TEXT NOT NULL,
  entidade_id TEXT NOT NULL,
  operacao TEXT NOT NULL,
  depende_de TEXT,
  prioridade INTEGER NOT NULL DEFAULT 1,
  ordem_fila INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  tentativas INTEGER NOT NULL DEFAULT 0,
  ultimo_erro TEXT,
  proxima_tentativa_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_fila_status_ordem ON sync_fila(status, ordem_fila ASC);

CREATE TABLE IF NOT EXISTS cache_rede (
  chave TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
`;

function safeParse(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function mapRowParaRota(row) {
  if (!row) return null;
  return {
    idCliente: row.id_cliente,
    idServidor: row.id_servidor ?? null,
    idRotaOrigemCliente: row.id_rota_origem_cliente ?? null,
    idRotaOrigemServidor: row.id_rota_origem_servidor ?? null,
    tipoRota: row.tipo_rota,
    geometry: safeParse(row.geometria_json, null),
    distanciaMetros: Number(row.distancia_metros || 0),
    duracaoSegundos: Number(row.duracao_segundos || 0),
    titulo: row.titulo ?? null,
    modoCalculo: row.modo_calculo ?? null,
    circular: Number(row.circular) === 1,
    pontosJson: safeParse(row.pontos_json, []),
    legsJson: safeParse(row.legs_json, []),
    assinatura: row.assinatura ?? null,
    origemSalvamento: row.origem_salvamento ?? null,
    simulado: Number(row.simulado) === 1,
    dataCriacao: row.data_criacao,
    dataInicio: row.data_inicio ?? null,
    dataFim: row.data_fim ?? null,
    dataAtualizacao: row.data_atualizacao,
    versaoLocal: Number(row.versao_local || 1),
    versaoServidor: row.versao_servidor ?? null,
    status: row.status,
    idUsuario: row.id_usuario,
    syncStatus: row.sync_status,
    syncErro: row.sync_erro ?? null,
  };
}

function mapRowParaPonto(row) {
  if (!row) return null;
  return {
    idPonto: row.id_ponto,
    idRotaCliente: row.id_rota_cliente,
    ordem: Number(row.ordem),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    precisao: row.precisao == null ? null : Number(row.precisao),
    rumo: row.rumo == null ? null : Number(row.rumo),
    velocidade: row.velocidade == null ? null : Number(row.velocidade),
    timestampMs: Number(row.timestamp_ms),
    simulado: Number(row.simulado) === 1,
    segmentoIndice: Number(row.segmento_indice || 0),
    criadoEm: row.criado_em,
  };
}

function mapRowParaObservacao(row) {
  if (!row) return null;
  return {
    idCliente: row.id_cliente,
    idServidor: row.id_servidor ?? null,
    idRotaCliente: row.id_rota_cliente,
    idRotaServidor: row.id_rota_servidor ?? null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    geometry: safeParse(row.geometria_json, {
      type: 'Point',
      coordinates: [Number(row.longitude), Number(row.latitude)],
    }),
    descricao: row.descricao,
    tipoObservacao: row.tipo_observacao,
    dataCriacao: row.data_criacao,
    dataAtualizacao: row.data_atualizacao,
    versaoLocal: Number(row.versao_local || 1),
    versaoServidor: row.versao_servidor ?? null,
    idUsuario: row.id_usuario,
    status: row.status,
    simulado: Number(row.simulado) === 1,
    syncStatus: row.sync_status,
    syncErro: row.sync_erro ?? null,
    conflitoServidor: safeParse(row.conflito_json, null),
  };
}

function mapRowParaEvento(row) {
  if (!row) return null;
  return {
    idCliente: row.id_cliente,
    idServidor: row.id_servidor ?? null,
    idObservacaoCliente: row.id_observacao_cliente,
    idObservacaoServidor: row.id_observacao_servidor ?? null,
    tipoEvento: row.tipo_evento,
    dadosEvento: safeParse(row.dados_evento_json, null),
    dataEvento: row.data_evento,
    idUsuario: row.id_usuario,
    simulado: Number(row.simulado) === 1,
    syncStatus: row.sync_status,
    syncErro: row.sync_erro ?? null,
  };
}

function mapRowParaSync(row) {
  if (!row) return null;
  return {
    idSync: row.id_sync,
    entidadeTipo: row.entidade_tipo,
    entidadeId: row.entidade_id,
    operacao: row.operacao,
    dependeDe: row.depende_de ?? null,
    prioridade: Number(row.prioridade || 1),
    ordemFila: Number(row.ordem_fila || 1),
    status: row.status,
    tentativas: Number(row.tentativas || 0),
    ultimoErro: row.ultimo_erro ?? null,
    proximaTentativaEm: row.proxima_tentativa_em ?? null,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

const SQL_UPSERT_ROTA = `
INSERT INTO rotas_campo (
  id_cliente, id_servidor, id_rota_origem_cliente, id_rota_origem_servidor,
  tipo_rota, geometria_json, distancia_metros, duracao_segundos, titulo,
  modo_calculo, circular, pontos_json, legs_json, assinatura, origem_salvamento,
  simulado, data_criacao, data_inicio, data_fim, data_atualizacao,
  versao_local, versao_servidor, status, id_usuario, sync_status, sync_erro
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id_cliente) DO UPDATE SET
  id_servidor = excluded.id_servidor,
  id_rota_origem_cliente = excluded.id_rota_origem_cliente,
  id_rota_origem_servidor = excluded.id_rota_origem_servidor,
  tipo_rota = excluded.tipo_rota,
  geometria_json = excluded.geometria_json,
  distancia_metros = excluded.distancia_metros,
  duracao_segundos = excluded.duracao_segundos,
  titulo = excluded.titulo,
  modo_calculo = excluded.modo_calculo,
  circular = excluded.circular,
  pontos_json = excluded.pontos_json,
  legs_json = excluded.legs_json,
  assinatura = excluded.assinatura,
  origem_salvamento = excluded.origem_salvamento,
  simulado = excluded.simulado,
  data_criacao = excluded.data_criacao,
  data_inicio = excluded.data_inicio,
  data_fim = excluded.data_fim,
  data_atualizacao = excluded.data_atualizacao,
  versao_local = excluded.versao_local,
  versao_servidor = excluded.versao_servidor,
  status = excluded.status,
  id_usuario = excluded.id_usuario,
  sync_status = excluded.sync_status,
  sync_erro = excluded.sync_erro`;

function paramsRota(r) {
  return [
    r.idCliente,
    r.idServidor ?? null,
    r.idRotaOrigemCliente ?? null,
    r.idRotaOrigemServidor ?? null,
    r.tipoRota,
    r.geometry ? JSON.stringify(r.geometry) : null,
    Number(r.distanciaMetros || 0),
    Number(r.duracaoSegundos || 0),
    r.titulo ?? null,
    r.modoCalculo ?? null,
    r.circular !== false ? 1 : 0,
    Array.isArray(r.pontosJson) ? JSON.stringify(r.pontosJson) : null,
    Array.isArray(r.legsJson) ? JSON.stringify(r.legsJson) : null,
    r.assinatura ?? null,
    r.origemSalvamento ?? null,
    r.simulado ? 1 : 0,
    r.dataCriacao,
    r.dataInicio ?? null,
    r.dataFim ?? null,
    r.dataAtualizacao || r.dataCriacao,
    Number(r.versaoLocal || 1),
    r.versaoServidor ?? null,
    r.status,
    r.idUsuario || 'agente-local',
    r.syncStatus || SYNC_STATUS.PENDING,
    r.syncErro ?? null,
  ];
}

const SQL_UPSERT_SYNC = `
INSERT INTO sync_fila (
  id_sync, entidade_tipo, entidade_id, operacao, depende_de, prioridade,
  ordem_fila, status, tentativas, ultimo_erro, proxima_tentativa_em,
  criado_em, atualizado_em
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id_sync) DO UPDATE SET
  entidade_tipo = excluded.entidade_tipo,
  entidade_id = excluded.entidade_id,
  operacao = excluded.operacao,
  depende_de = excluded.depende_de,
  prioridade = excluded.prioridade,
  ordem_fila = excluded.ordem_fila,
  status = excluded.status,
  tentativas = excluded.tentativas,
  ultimo_erro = excluded.ultimo_erro,
  proxima_tentativa_em = excluded.proxima_tentativa_em,
  criado_em = excluded.criado_em,
  atualizado_em = excluded.atualizado_em`;

function paramsSync(s) {
  return [
    s.idSync,
    s.entidadeTipo,
    s.entidadeId,
    s.operacao,
    s.dependeDe ?? null,
    Number(s.prioridade || 1),
    Number(s.ordemFila || 1),
    s.status,
    Number(s.tentativas || 0),
    s.ultimoErro ?? null,
    s.proximaTentativaEm ?? null,
    s.criadoEm,
    s.atualizadoEm,
  ];
}

const SQL_UPSERT_OBS = `
INSERT INTO observacoes_rota (
  id_cliente, id_servidor, id_rota_cliente, id_rota_servidor,
  latitude, longitude, geometria_json, descricao, tipo_observacao,
  data_criacao, data_atualizacao, versao_local, versao_servidor,
  id_usuario, status, simulado, sync_status, sync_erro, conflito_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id_cliente) DO UPDATE SET
  id_servidor = excluded.id_servidor,
  id_rota_cliente = excluded.id_rota_cliente,
  id_rota_servidor = excluded.id_rota_servidor,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  geometria_json = excluded.geometria_json,
  descricao = excluded.descricao,
  tipo_observacao = excluded.tipo_observacao,
  data_criacao = excluded.data_criacao,
  data_atualizacao = excluded.data_atualizacao,
  versao_local = excluded.versao_local,
  versao_servidor = excluded.versao_servidor,
  id_usuario = excluded.id_usuario,
  status = excluded.status,
  simulado = excluded.simulado,
  sync_status = excluded.sync_status,
  sync_erro = excluded.sync_erro,
  conflito_json = excluded.conflito_json`;

function paramsObs(o) {
  return [
    o.idCliente,
    o.idServidor ?? null,
    o.idRotaCliente,
    o.idRotaServidor ?? null,
    Number(o.latitude),
    Number(o.longitude),
    JSON.stringify(o.geometry || { type: 'Point', coordinates: [Number(o.longitude), Number(o.latitude)] }),
    o.descricao,
    o.tipoObservacao,
    o.dataCriacao,
    o.dataAtualizacao,
    Number(o.versaoLocal || 1),
    o.versaoServidor ?? null,
    o.idUsuario || 'agente-local',
    o.status,
    o.simulado ? 1 : 0,
    o.syncStatus || SYNC_STATUS.PENDING,
    o.syncErro ?? null,
    o.conflitoServidor ? JSON.stringify(o.conflitoServidor) : null,
  ];
}

const SQL_UPSERT_EVT = `
INSERT INTO observacoes_eventos (
  id_cliente, id_servidor, id_observacao_cliente, id_observacao_servidor,
  tipo_evento, dados_evento_json, data_evento, id_usuario, simulado,
  sync_status, sync_erro
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id_cliente) DO UPDATE SET
  id_servidor = excluded.id_servidor,
  id_observacao_cliente = excluded.id_observacao_cliente,
  id_observacao_servidor = excluded.id_observacao_servidor,
  tipo_evento = excluded.tipo_evento,
  dados_evento_json = excluded.dados_evento_json,
  data_evento = excluded.data_evento,
  id_usuario = excluded.id_usuario,
  simulado = excluded.simulado,
  sync_status = excluded.sync_status,
  sync_erro = excluded.sync_erro`;

function paramsEvt(e) {
  return [
    e.idCliente,
    e.idServidor ?? null,
    e.idObservacaoCliente,
    e.idObservacaoServidor ?? null,
    e.tipoEvento,
    e.dadosEvento ? JSON.stringify(e.dadosEvento) : null,
    e.dataEvento,
    e.idUsuario || 'agente-local',
    e.simulado ? 1 : 0,
    e.syncStatus || SYNC_STATUS.PENDING,
    e.syncErro ?? null,
  ];
}

export function criarDriverSqliteCore({ sqlite, nomeBanco = NOME_BANCO_SQLITE } = {}) {
  let dbPromise = null;

  async function abrirBanco() {
    if (dbPromise) return dbPromise;
    if (!sqlite || typeof sqlite.openDatabaseAsync !== 'function') {
      throw new Error('Módulo expo-sqlite indisponível.');
    }
    dbPromise = (async () => {
      const db = await sqlite.openDatabaseAsync(nomeBanco);
      await db.execAsync(DDL_INICIAL);
      return db;
    })();
    return dbPromise;
  }

  async function executarTransacao(db, fn) {
    if (typeof db.withExclusiveTransactionAsync === 'function') {
      return db.withExclusiveTransactionAsync(fn);
    }
    if (typeof db.withTransactionAsync === 'function') {
      return db.withTransactionAsync(() => fn(db));
    }
    return fn(db);
  }

  return {
    async init() {
      await abrirBanco();
    },

    async close() {
      if (!dbPromise) return;
      const db = await dbPromise;
      await db.closeAsync?.();
      dbPromise = null;
    },

    async putRota(rota) {
      const db = await abrirBanco();
      await db.runAsync(SQL_UPSERT_ROTA, paramsRota(rota));
    },

    async putRotaComSync(rota, syncItem) {
      const db = await abrirBanco();
      await executarTransacao(db, async (txn) => {
        await txn.runAsync(SQL_UPSERT_ROTA, paramsRota(rota));
        if (syncItem) await txn.runAsync(SQL_UPSERT_SYNC, paramsSync(syncItem));
      });
    },

    async getRota(idCliente) {
      const db = await abrirBanco();
      const row = await db.getFirstAsync('SELECT * FROM rotas_campo WHERE id_cliente = ?', [idCliente]);
      return mapRowParaRota(row);
    },

    async listRotas({ tipoRota = null, incluirSimuladas = false, limit = 100 } = {}) {
      const db = await abrirBanco();
      const conds = [];
      const args = [];
      if (tipoRota) {
        conds.push('tipo_rota = ?');
        args.push(tipoRota);
      }
      if (!incluirSimuladas) {
        conds.push('simulado = 0');
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      args.push(Number(limit || 100));
      const rows = await db.getAllAsync(
        `SELECT * FROM rotas_campo ${where} ORDER BY data_criacao DESC LIMIT ?`,
        args,
      );
      return (rows || []).map(mapRowParaRota);
    },

    async findRotaPorAssinatura(assinatura) {
      if (!assinatura) return null;
      const db = await abrirBanco();
      const row = await db.getFirstAsync(
        'SELECT * FROM rotas_campo WHERE tipo_rota = ? AND assinatura = ? LIMIT 1',
        [TIPO_ROTA.CALCULADA, assinatura],
      );
      return mapRowParaRota(row);
    },

    async appendPontoGps(ponto) {
      const db = await abrirBanco();
      await db.runAsync(
        `INSERT OR REPLACE INTO pontos_gps (
          id_ponto, id_rota_cliente, ordem, latitude, longitude, precisao, rumo,
          velocidade, timestamp_ms, simulado, segmento_indice, criado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ponto.idPonto,
          ponto.idRotaCliente,
          Number(ponto.ordem),
          Number(ponto.latitude),
          Number(ponto.longitude),
          ponto.precisao ?? null,
          ponto.rumo ?? null,
          ponto.velocidade ?? null,
          Number(ponto.timestampMs),
          ponto.simulado ? 1 : 0,
          Number(ponto.segmentoIndice || 0),
          ponto.criadoEm,
        ],
      );
    },

    async listPontosGps(idRotaCliente) {
      const db = await abrirBanco();
      const rows = await db.getAllAsync(
        'SELECT * FROM pontos_gps WHERE id_rota_cliente = ? ORDER BY ordem ASC',
        [idRotaCliente],
      );
      return (rows || []).map(mapRowParaPonto);
    },

    async putObservacaoEEvento(observacao, evento, syncItens = []) {
      const db = await abrirBanco();
      await executarTransacao(db, async (txn) => {
        await txn.runAsync(SQL_UPSERT_OBS, paramsObs(observacao));
        if (evento) await txn.runAsync(SQL_UPSERT_EVT, paramsEvt(evento));
        for (const item of syncItens) {
          if (item) await txn.runAsync(SQL_UPSERT_SYNC, paramsSync(item));
        }
      });
    },

    async getObservacao(idCliente) {
      const db = await abrirBanco();
      const row = await db.getFirstAsync(
        'SELECT * FROM observacoes_rota WHERE id_cliente = ?',
        [idCliente],
      );
      return mapRowParaObservacao(row);
    },

    async listObservacoes({ idRotaCliente = null, incluirSimuladas = false } = {}) {
      const db = await abrirBanco();
      const conds = [];
      const args = [];
      if (idRotaCliente) {
        conds.push('id_rota_cliente = ?');
        args.push(idRotaCliente);
      }
      if (!incluirSimuladas) {
        conds.push('simulado = 0');
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const rows = await db.getAllAsync(
        `SELECT * FROM observacoes_rota ${where} ORDER BY data_atualizacao DESC`,
        args,
      );
      return (rows || []).map(mapRowParaObservacao);
    },

    async putEvento(evento) {
      const db = await abrirBanco();
      await db.runAsync(SQL_UPSERT_EVT, paramsEvt(evento));
    },

    async getEvento(idCliente) {
      const db = await abrirBanco();
      const row = await db.getFirstAsync(
        'SELECT * FROM observacoes_eventos WHERE id_cliente = ?',
        [idCliente],
      );
      return mapRowParaEvento(row);
    },

    async listEventosObservacao(idObservacaoCliente) {
      const db = await abrirBanco();
      const rows = idObservacaoCliente
        ? await db.getAllAsync(
            'SELECT * FROM observacoes_eventos WHERE id_observacao_cliente = ? ORDER BY data_evento ASC',
            [idObservacaoCliente],
          )
        : await db.getAllAsync('SELECT * FROM observacoes_eventos ORDER BY data_evento ASC');
      return (rows || []).map(mapRowParaEvento);
    },

    async upsertSyncItem(item) {
      const db = await abrirBanco();
      await db.runAsync(SQL_UPSERT_SYNC, paramsSync(item));
    },

    async getSyncItem(idSync) {
      const db = await abrirBanco();
      const row = await db.getFirstAsync('SELECT * FROM sync_fila WHERE id_sync = ?', [idSync]);
      return mapRowParaSync(row);
    },

    async listSyncItens({ statuses = null } = {}) {
      const db = await abrirBanco();
      let rows;
      if (Array.isArray(statuses) && statuses.length) {
        const marks = statuses.map(() => '?').join(', ');
        rows = await db.getAllAsync(
          `SELECT * FROM sync_fila WHERE status IN (${marks}) ORDER BY ordem_fila ASC`,
          statuses,
        );
      } else {
        rows = await db.getAllAsync('SELECT * FROM sync_fila ORDER BY ordem_fila ASC');
      }
      return (rows || []).map(mapRowParaSync);
    },

    async resetSyncingParaPending() {
      const db = await abrirBanco();
      const res = await db.runAsync('UPDATE sync_fila SET status = ? WHERE status = ?', [
        SYNC_STATUS.PENDING,
        SYNC_STATUS.SYNCING,
      ]);
      return Number(res?.changes || 0);
    },

    async putCacheRede(chave, payload) {
      const db = await abrirBanco();
      await db.runAsync(
        'INSERT OR REPLACE INTO cache_rede (chave, payload_json, atualizado_em) VALUES (?, ?, ?)',
        [chave, JSON.stringify(payload), new Date().toISOString()],
      );
    },

    async getCacheRede(chave) {
      const db = await abrirBanco();
      const row = await db.getFirstAsync('SELECT payload_json FROM cache_rede WHERE chave = ?', [
        chave,
      ]);
      return row ? safeParse(row.payload_json, null) : null;
    },

    async deleteObservacao(idCliente) {
      const db = await abrirBanco();
      return executarTransacao(db, async (txn) => {
        const obsRow = await txn.getFirstAsync(
          'SELECT id_cliente, id_rota_cliente FROM observacoes_rota WHERE id_cliente = ?',
          [idCliente],
        );
        if (!obsRow) {
          return { removida: false, idRotaCliente: null, eventosRemovidos: 0, syncRemovidos: 0 };
        }
        const evtRows = (await txn.getAllAsync(
          'SELECT id_cliente FROM observacoes_eventos WHERE id_observacao_cliente = ?',
          [idCliente],
        )) || [];

        let syncRemovidos = 0;
        const r1 = await txn.runAsync(
          'DELETE FROM sync_fila WHERE entidade_id = ? OR depende_de = ?',
          [idCliente, idCliente],
        );
        syncRemovidos += Number(r1?.changes || 0);
        for (const evt of evtRows) {
          const re = await txn.runAsync('DELETE FROM sync_fila WHERE entidade_id = ?', [
            evt.id_cliente,
          ]);
          syncRemovidos += Number(re?.changes || 0);
        }

        await txn.runAsync('DELETE FROM observacoes_eventos WHERE id_observacao_cliente = ?', [
          idCliente,
        ]);
        await txn.runAsync('DELETE FROM observacoes_rota WHERE id_cliente = ?', [idCliente]);

        return {
          removida: true,
          idRotaCliente: obsRow.id_rota_cliente,
          eventosRemovidos: evtRows.length,
          syncRemovidos,
        };
      });
    },

    async deleteRotaLocal(idCliente) {
      const db = await abrirBanco();
      return executarTransacao(db, async (txn) => {
        const rotaRow = await txn.getFirstAsync(
          'SELECT id_cliente, tipo_rota FROM rotas_campo WHERE id_cliente = ?',
          [idCliente],
        );
        if (!rotaRow) {
          return { removida: false, tipoRota: null, observacoesRemovidas: 0, pontosRemovidos: 0 };
        }

        // Preserva execuções GPS independentes que apontavam para a rota excluída
        await txn.runAsync(
          'UPDATE rotas_campo SET id_rota_origem_cliente = NULL, id_rota_origem_servidor = NULL WHERE id_rota_origem_cliente = ? AND id_cliente <> ?',
          [idCliente, idCliente],
        );
        await txn.runAsync(
          'UPDATE sync_fila SET depende_de = NULL WHERE entidade_tipo = ? AND depende_de = ?',
          [ENTIDADE_SYNC.ROTA, idCliente],
        );

        const obsRows = (await txn.getAllAsync(
          'SELECT id_cliente FROM observacoes_rota WHERE id_rota_cliente = ?',
          [idCliente],
        )) || [];

        for (const obs of obsRows) {
          const evtRows = (await txn.getAllAsync(
            'SELECT id_cliente FROM observacoes_eventos WHERE id_observacao_cliente = ?',
            [obs.id_cliente],
          )) || [];
          for (const evt of evtRows) {
            await txn.runAsync('DELETE FROM sync_fila WHERE entidade_id = ?', [evt.id_cliente]);
          }
          await txn.runAsync(
            'DELETE FROM sync_fila WHERE entidade_id = ? OR depende_de = ?',
            [obs.id_cliente, obs.id_cliente],
          );
          await txn.runAsync('DELETE FROM observacoes_eventos WHERE id_observacao_cliente = ?', [
            obs.id_cliente,
          ]);
        }

        await txn.runAsync('DELETE FROM observacoes_rota WHERE id_rota_cliente = ?', [idCliente]);
        const ptsRes = await txn.runAsync('DELETE FROM pontos_gps WHERE id_rota_cliente = ?', [
          idCliente,
        ]);
        await txn.runAsync('DELETE FROM sync_fila WHERE entidade_id = ?', [idCliente]);
        await txn.runAsync('DELETE FROM rotas_campo WHERE id_cliente = ?', [idCliente]);

        return {
          removida: true,
          tipoRota: rotaRow.tipo_rota,
          observacoesRemovidas: obsRows.length,
          pontosRemovidos: Number(ptsRes?.changes || 0),
        };
      });
    },

    async clearDadosLocaisCampo() {
      const db = await abrirBanco();
      return executarTransacao(db, async (txn) => {
        await txn.runAsync('DELETE FROM observacoes_eventos');
        await txn.runAsync('DELETE FROM observacoes_rota');
        await txn.runAsync('DELETE FROM pontos_gps');
        await txn.runAsync('DELETE FROM rotas_campo');
        await txn.runAsync('DELETE FROM sync_fila');
        return { ok: true };
      });
    },
  };
}
