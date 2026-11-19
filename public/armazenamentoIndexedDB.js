/**
 * public/armazenamentoIndexedDB.js — Persistência local IndexedDB (Web / PWA)
 * ---------------------------------------------------------------------------
 * Implementa o contrato de driver esperado por `campo/repositorioCampo.js`
 * com transações atômicas em IndexedDB e separação estrita entre dados
 * operacionais (rotas, pontos GPS, observações, eventos, fila de sincronização)
 * e o cache vetorial da rede viária (`cache_rede`).
 */

import { SYNC_STATUS, TIPO_ROTA } from '../campo/modeloCampo.js';

export const NOME_BANCO_INDEXEDDB = 'siga_rotas_campo_db';
export const VERSAO_BANCO_INDEXEDDB = 1;

const STORES = Object.freeze({
  ROTAS: 'rotas_campo',
  PONTOS_GPS: 'pontos_gps',
  OBSERVACOES: 'observacoes_rota',
  EVENTOS: 'observacoes_eventos',
  SYNC_FILA: 'sync_fila',
  CACHE_REDE: 'cache_rede',
});

function reqParaPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro em operação IndexedDB.'));
  });
}

function txParaPromise(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('Transação IndexedDB abortada.'));
    tx.onerror = () => reject(tx.error || new Error('Erro em transação IndexedDB.'));
  });
}

function garantirStores(db) {
  if (!db.objectStoreNames.contains(STORES.ROTAS)) {
    const s = db.createObjectStore(STORES.ROTAS, { keyPath: 'idCliente' });
    s.createIndex('tipoRota', 'tipoRota', { unique: false });
    s.createIndex('syncStatus', 'syncStatus', { unique: false });
    s.createIndex('dataCriacao', 'dataCriacao', { unique: false });
    s.createIndex('assinatura', 'assinatura', { unique: false });
    s.createIndex('idRotaOrigemCliente', 'idRotaOrigemCliente', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.PONTOS_GPS)) {
    const s = db.createObjectStore(STORES.PONTOS_GPS, { keyPath: 'idPonto' });
    s.createIndex('idRotaCliente', 'idRotaCliente', { unique: false });
    s.createIndex('rotaOrdem', ['idRotaCliente', 'ordem'], { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.OBSERVACOES)) {
    const s = db.createObjectStore(STORES.OBSERVACOES, { keyPath: 'idCliente' });
    s.createIndex('idRotaCliente', 'idRotaCliente', { unique: false });
    s.createIndex('syncStatus', 'syncStatus', { unique: false });
    s.createIndex('dataAtualizacao', 'dataAtualizacao', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.EVENTOS)) {
    const s = db.createObjectStore(STORES.EVENTOS, { keyPath: 'idCliente' });
    s.createIndex('idObservacaoCliente', 'idObservacaoCliente', { unique: false });
    s.createIndex('dataEvento', 'dataEvento', { unique: false });
    s.createIndex('syncStatus', 'syncStatus', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.SYNC_FILA)) {
    const s = db.createObjectStore(STORES.SYNC_FILA, { keyPath: 'idSync' });
    s.createIndex('status', 'status', { unique: false });
    s.createIndex('ordemFila', 'ordemFila', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.CACHE_REDE)) {
    db.createObjectStore(STORES.CACHE_REDE, { keyPath: 'chave' });
  }
}

export function criarDriverIndexedDB({
  indexedDBFactory = null,
  indexedDB = null,
  nomeBanco = NOME_BANCO_INDEXEDDB,
  versao = VERSAO_BANCO_INDEXEDDB,
} = {}) {
  const idbFactory = indexedDBFactory || indexedDB || globalThis.indexedDB;
  let dbPromise = null;

  function abrirBanco() {
    if (dbPromise) return dbPromise;
    if (!idbFactory || typeof idbFactory.open !== 'function') {
      return Promise.reject(new Error('IndexedDB indisponível neste navegador.'));
    }
    dbPromise = new Promise((resolve, reject) => {
      const req = idbFactory.open(nomeBanco, versao);
      req.onupgradeneeded = () => {
        garantirStores(req.result);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error || new Error('Falha ao abrir IndexedDB.'));
      };
    });
    return dbPromise;
  }

  return {
    async init() {
      await abrirBanco();
    },

    async close() {
      if (!dbPromise) return;
      const db = await dbPromise;
      db.close();
      dbPromise = null;
    },

    async putRota(rota) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.ROTAS], 'readwrite');
      tx.objectStore(STORES.ROTAS).put(rota);
      await txParaPromise(tx);
    },

    async putRotaComSync(rota, syncItem) {
      const db = await abrirBanco();
      const stores = syncItem ? [STORES.ROTAS, STORES.SYNC_FILA] : [STORES.ROTAS];
      const tx = db.transaction(stores, 'readwrite');
      tx.objectStore(STORES.ROTAS).put(rota);
      if (syncItem) tx.objectStore(STORES.SYNC_FILA).put(syncItem);
      await txParaPromise(tx);
    },

    async getRota(idCliente) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.ROTAS], 'readonly');
      return (await reqParaPromise(tx.objectStore(STORES.ROTAS).get(idCliente))) || null;
    },

    async listRotas({ tipoRota = null, incluirSimuladas = false, limit = 100 } = {}) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.ROTAS], 'readonly');
      const store = tx.objectStore(STORES.ROTAS);
      const all = tipoRota
        ? await reqParaPromise(store.index('tipoRota').getAll(tipoRota))
        : await reqParaPromise(store.getAll());
      return (all || [])
        .filter((r) => incluirSimuladas || !r.simulado)
        .sort((a, b) => String(b.dataCriacao).localeCompare(String(a.dataCriacao)))
        .slice(0, limit);
    },

    async findRotaPorAssinatura(assinatura) {
      if (!assinatura) return null;
      const db = await abrirBanco();
      const tx = db.transaction([STORES.ROTAS], 'readonly');
      const matches = await reqParaPromise(
        tx.objectStore(STORES.ROTAS).index('assinatura').getAll(assinatura),
      );
      return (matches || []).find((r) => r.tipoRota === TIPO_ROTA.CALCULADA) || null;
    },

    async appendPontoGps(ponto) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.PONTOS_GPS], 'readwrite');
      tx.objectStore(STORES.PONTOS_GPS).put(ponto);
      await txParaPromise(tx);
    },

    async listPontosGps(idRotaCliente) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.PONTOS_GPS], 'readonly');
      const pontos = await reqParaPromise(
        tx.objectStore(STORES.PONTOS_GPS).index('idRotaCliente').getAll(idRotaCliente),
      );
      return (pontos || []).sort((a, b) => Number(a.ordem) - Number(b.ordem));
    },

    async putObservacaoEEvento(observacao, evento, syncItens = []) {
      const db = await abrirBanco();
      const stores = [STORES.OBSERVACOES];
      if (evento) stores.push(STORES.EVENTOS);
      if (syncItens.length) stores.push(STORES.SYNC_FILA);
      const tx = db.transaction(stores, 'readwrite');
      tx.objectStore(STORES.OBSERVACOES).put(observacao);
      if (evento) tx.objectStore(STORES.EVENTOS).put(evento);
      for (const item of syncItens) {
        if (item) tx.objectStore(STORES.SYNC_FILA).put(item);
      }
      await txParaPromise(tx);
    },

    async getObservacao(idCliente) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.OBSERVACOES], 'readonly');
      return (await reqParaPromise(tx.objectStore(STORES.OBSERVACOES).get(idCliente))) || null;
    },

    async listObservacoes({ idRotaCliente = null, incluirSimuladas = false } = {}) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.OBSERVACOES], 'readonly');
      const store = tx.objectStore(STORES.OBSERVACOES);
      const rows = idRotaCliente
        ? await reqParaPromise(store.index('idRotaCliente').getAll(idRotaCliente))
        : await reqParaPromise(store.getAll());
      return (rows || [])
        .filter((o) => incluirSimuladas || !o.simulado)
        .sort((a, b) => String(b.dataAtualizacao).localeCompare(String(a.dataAtualizacao)));
    },

    async putEvento(evento) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.EVENTOS], 'readwrite');
      tx.objectStore(STORES.EVENTOS).put(evento);
      await txParaPromise(tx);
    },

    async getEvento(idCliente) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.EVENTOS], 'readonly');
      return (await reqParaPromise(tx.objectStore(STORES.EVENTOS).get(idCliente))) || null;
    },

    async listEventosObservacao(idObservacaoCliente) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.EVENTOS], 'readonly');
      const store = tx.objectStore(STORES.EVENTOS);
      const rows = idObservacaoCliente
        ? await reqParaPromise(store.index('idObservacaoCliente').getAll(idObservacaoCliente))
        : await reqParaPromise(store.getAll());
      return (rows || []).sort((a, b) => String(a.dataEvento).localeCompare(String(b.dataEvento)));
    },

    async upsertSyncItem(item) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.SYNC_FILA], 'readwrite');
      tx.objectStore(STORES.SYNC_FILA).put(item);
      await txParaPromise(tx);
    },

    async getSyncItem(idSync) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.SYNC_FILA], 'readonly');
      return (await reqParaPromise(tx.objectStore(STORES.SYNC_FILA).get(idSync))) || null;
    },

    async listSyncItens({ statuses = null } = {}) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.SYNC_FILA], 'readonly');
      const rows = await reqParaPromise(tx.objectStore(STORES.SYNC_FILA).getAll());
      const filtro = Array.isArray(statuses) && statuses.length ? new Set(statuses) : null;
      return (rows || [])
        .filter((s) => !filtro || filtro.has(s.status))
        .sort((a, b) => Number(a.ordemFila ?? 0) - Number(b.ordemFila ?? 0));
    },

    async resetSyncingParaPending() {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.SYNC_FILA], 'readwrite');
      const store = tx.objectStore(STORES.SYNC_FILA);
      const syncing = await reqParaPromise(store.index('status').getAll(SYNC_STATUS.SYNCING));
      for (const item of syncing || []) {
        store.put({ ...item, status: SYNC_STATUS.PENDING });
      }
      await txParaPromise(tx);
      return (syncing || []).length;
    },

    async putCacheRede(chave, payload) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.CACHE_REDE], 'readwrite');
      tx.objectStore(STORES.CACHE_REDE).put({ chave, payload });
      await txParaPromise(tx);
    },

    async getCacheRede(chave) {
      const db = await abrirBanco();
      const tx = db.transaction([STORES.CACHE_REDE], 'readonly');
      const row = await reqParaPromise(tx.objectStore(STORES.CACHE_REDE).get(chave));
      return row ? row.payload : null;
    },
  };
}
