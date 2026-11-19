/**
 * SERVIÇO DE REDE VIÁRIA MOBILE (REACT NATIVE / ANDROID)
 * ======================================================
 *
 * Integra o APK ao backend centralizado Node.js (`server/index.js`) mantendo
 * contingência offline completa no aparelho usando o mesmo núcleo `core/`:
 *
 *  1. Com `remoteApiUrl` configurado e acessível (online):
 *     - Sincroniza a rede viária a partir de `/api/network` (com diagnóstico de
 *       origem WFS vs. snapshot no servidor) e atualiza o cache `AsyncStorage`.
 *     - Delega cálculo de rotas (`/api/rota-paradas`, `/api/route`) e
 *       Endereço Digital (`/api/endereco-digital`) ao servidor Node.js.
 *  2. Quando o servidor Node.js estiver inacessível (offline / timeout / 5xx):
 *     - Opera de forma autônoma sobre o cache local (`AsyncStorage`) ou sobre
 *       o snapshot embutido no APK, executando o motor `core/` localmente no
 *       dispositivo (inclusive durante navegação ativa e recálculo de desvio).
 *  3. Ao retornar a conexão com o Node.js:
 *     - Sincroniza pendências locais de cache/operação e atualiza a rede viária
 *       para manter paridade com o servidor.
 */

import { buildGraph } from '../core/graph.js';
import { fetchNetwork, describeLayer, checkForUpdates } from '../core/wfs.js';
import { routeOnGraph } from '../core/router.js';
import { calcularRotaComParadas } from '../core/rotaParadas.js';
import { normalizarPreferencias } from '../ocorrencias/preferencias.js';
import { calcularRotaComAlternativas } from '../ocorrencias/roteamentoAlternativo.js';
import { criarServicoEnderecoDigital, MODOS } from '../core/enderecoDigitalService.js';
import { WFS_DEFAULTS, UPDATE_DEFAULTS, LAYER_NAME } from '../core/config.js';
import {
  LOCAL_MODE_SENTINEL,
  STORAGE_KEY_API_URL,
  STORAGE_KEY_PENDING_SYNC,
  montarUrlEndpointApi,
  normalizarApiUrl,
  resolverApiUrlInicial,
  resolverTipoTransporteApi,
} from '../config/apiConfig.js';

export const STORAGE_KEY_SNAPSHOT = '@santo_andre_routing:wfs_snapshot_v1';

/**
 * Calcula uma impressão digital determinística (FNV-1a 64-bit em hex) das
 * feições da camada sem depender de `node:crypto`, garantindo compatibilidade
 * total com o runtime Hermes do React Native.
 */
export function fingerprintOf(features) {
  const ordered = (features || [])
    .slice()
    .sort((a, b) => Number(a?.properties?.ID ?? 0) - Number(b?.properties?.ID ?? 0));

  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;

  for (let idx = 0; idx < ordered.length; idx++) {
    const f = ordered[idx];
    const chunk = JSON.stringify({
      id: f?.properties?.ID ?? null,
      p: f?.properties ?? null,
      g: f?.geometry ?? null,
    });
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= c ^ (i & 0xff);
      h2 = Math.imul(h2, 0x01000193);
    }
  }

  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export class MobileNetworkServiceCore {
  constructor(options = {}) {
    this.storage = options.storage;
    this.embeddedSnapshot = options.embeddedSnapshot;
    this.wfs = { fetchNetwork, checkForUpdates, describeLayer, ...options.wfs };
    this.fetchImpl =
      options.fetchImpl ??
      (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    this.requestRevision = 0;
    this.commitQueue = Promise.resolve();
    this.cache = { status: 'unknown', savedAt: null, error: null };

    const initialApiUrl = resolverApiUrlInicial(options);
    this.explicitApiUrl = options.remoteApiUrl !== undefined;
    this.runtimeConfigLoaded = this.explicitApiUrl;

    this.options = {
      snapshotTtl: options.snapshotTtl ?? WFS_DEFAULTS.snapshotTtl,
      graphOptions: options.graphOptions || {},
      layerName: options.layerName || LAYER_NAME,
      allowWfs: options.allowWfs !== false,
      allowRemoteApi: options.allowRemoteApi !== false,
      allowDirectWfsFallback: options.allowDirectWfsFallback === true,
      baseUrl: options.baseUrl || undefined,
      remoteApiUrl: initialApiUrl,
      apiToken: typeof options.apiToken === 'string' ? options.apiToken.trim() : '',
      apiTimeoutMs: options.apiTimeoutMs ?? 8000,
      routeApiTimeoutMs: options.routeApiTimeoutMs ?? 15000,
      autoUpdate: {
        enabled: options.autoUpdate?.enabled ?? true,
        checkIntervalMs: options.autoUpdate?.checkIntervalMs ?? UPDATE_DEFAULTS.checkIntervalMs,
        deepCheckIntervalMs:
          options.autoUpdate?.deepCheckIntervalMs ?? UPDATE_DEFAULTS.deepCheckIntervalMs,
        checkTimeoutMs: options.autoUpdate?.checkTimeoutMs ?? UPDATE_DEFAULTS.checkTimeoutMs,
        checkMaxRetries: options.autoUpdate?.checkMaxRetries ?? UPDATE_DEFAULTS.checkMaxRetries,
      },
    };

    this.remote = {
      online: false,
      execution: initialApiUrl ? 'remote' : 'local',
      backendSource: null,
      serverBuiltAt: null,
      lastSyncAt: null,
      lastError: null,
      pendingSync: [],
    };

    this.state = null;
    this.loading = null;
    this.syncing = null;
    this.listeners = new Set();
    this.timers = [];
    this.checking = null;
    this.update = {
      lastCheckedAt: null,
      lastChangeAt: null,
      lastResult: null,
      fingerprint: null,
      errors: [],
    };
  }

  /** Inscreve um listener chamado sempre que o grafo/rede é atualizado. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emit() {
    for (const fn of this.listeners) {
      try {
        fn(this.state);
      } catch {
        /* ignora erro de listener */
      }
    }
  }

  async _loadRuntimeConfigFromStorage() {
    if (!this.storage?.getItem) {
      this.runtimeConfigLoaded = true;
      return;
    }
    if (!this.explicitApiUrl) {
      try {
        const storedUrl = await this.storage.getItem(STORAGE_KEY_API_URL);
        if (typeof storedUrl === 'string') {
          const trimmed = storedUrl.trim();
          if (trimmed.toLowerCase() === LOCAL_MODE_SENTINEL) {
            this.options.remoteApiUrl = null;
            this.remote.execution = 'local';
          } else {
            const normalized = normalizarApiUrl(trimmed);
            if (normalized) {
              this.options.remoteApiUrl = normalized;
              this.remote.execution = 'remote';
            }
          }
        }
      } catch {
        /* segue com configuração padrão */
      }
    }
    try {
      const rawPending = await this.storage.getItem(STORAGE_KEY_PENDING_SYNC);
      if (rawPending) {
        const parsed = JSON.parse(rawPending);
        if (Array.isArray(parsed)) {
          this.remote.pendingSync = parsed;
        }
      }
    } catch {
      /* ignora histórico de pendências inválido */
    }
    this.runtimeConfigLoaded = true;
  }

  async _savePendingSync() {
    if (!this.storage?.setItem) return;
    try {
      await this.storage.setItem(
        STORAGE_KEY_PENDING_SYNC,
        JSON.stringify(this.remote.pendingSync.slice(-50)),
      );
    } catch {
      /* evita quebrar operação offline se storage estiver cheio */
    }
  }

  async _enqueuePendingSync(item) {
    this.remote.pendingSync.push({
      ...item,
      at: new Date().toISOString(),
    });
    if (this.remote.pendingSync.length > 50) {
      this.remote.pendingSync = this.remote.pendingSync.slice(-50);
    }
    await this._savePendingSync();
  }

  async setRemoteApiUrl(url) {
    const normalized = normalizarApiUrl(url);
    this.explicitApiUrl = true;
    this.runtimeConfigLoaded = true;
    this.options.remoteApiUrl = normalized;
    this.remote.online = false;
    this.remote.execution = normalized ? 'remote' : 'local';
    this.remote.backendSource = null;
    this.remote.serverBuiltAt = null;
    this.remote.lastError = null;
    if (this.storage?.setItem) {
      try {
        const valueToPersist = normalized || (resolverApiUrlInicial() ? LOCAL_MODE_SENTINEL : '');
        await this.storage.setItem(STORAGE_KEY_API_URL, valueToPersist);
      } catch {
        /* ignora erro de armazenamento */
      }
    }
    this._emit();
    return normalized;
  }

  _hasRemoteApi() {
    return Boolean(this.options.remoteApiUrl && this.options.allowRemoteApi && this.fetchImpl);
  }

  async _fetchApiJson(endpointPath, { method = 'GET', body = null, timeoutMs } = {}) {
    if (!this._hasRemoteApi()) {
      throw new Error('Servidor Node.js não configurado para este ambiente.');
    }
    const url = montarUrlEndpointApi(this.options.remoteApiUrl, endpointPath);
    const timeout = timeoutMs ?? this.options.apiTimeoutMs;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller && timeout > 0
      ? setTimeout(() => controller.abort(), timeout)
      : null;

    try {
      const headers = { Accept: 'application/json' };
      if (body != null) headers['Content-Type'] = 'application/json';
      if (this.options.apiToken) headers['X-Siga-Token'] = this.options.apiToken;

      const res = await this.fetchImpl(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller?.signal,
      });

      const ct = res.headers?.get?.('content-type') || '';
      let parsed;
      if (typeof res.text === 'function') {
        const raw = await res.text();
        const trimmed = raw.trimStart();
        if (trimmed.startsWith('<')) {
          throw new Error(`Servidor retornou HTML (${ct || 'text/html'}) em ${endpointPath}.`);
        }
        parsed = raw ? JSON.parse(raw) : {};
      } else {
        parsed = await res.json();
      }

      if (res.status >= 500) {
        throw new Error(parsed?.message || `Servidor Node.js respondeu HTTP ${res.status}.`);
      }

      return {
        status: res.status,
        ok: res.ok,
        body: parsed,
        domainError: !res.ok && res.status >= 400 && res.status < 500,
      };
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error(`Tempo limite esgotado ao conectar ao servidor Node.js (${endpointPath}).`);
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Garante que o grafo viário esteja carregado e construído em memória.
   * Com `remoteApiUrl` configurado, prioriza o servidor Node.js para manter
   * paridade e recorre ao snapshot/cache local automaticamente se estiver offline.
   */
  async ensureReady() {
    if (this.state) return this.state;
    if (this.loading) return this.loading;

    this.loading = this._loadInitial()
      .then((state) => {
        this.state = state;
        this.loading = null;
        this._emit();
        return state;
      })
      .catch((err) => {
        this.loading = null;
        throw err;
      });

    return this.loading;
  }

  async _fetchRemoteAndApply(revision, startedAt = Date.now(), { clearPending = true } = {}) {
    const resp = await this._fetchApiJson('/api/network', {
      timeoutMs: Math.max(this.options.apiTimeoutMs, 15000),
    });
    if (!resp.ok) {
      throw new Error(resp.body?.message || `HTTP ${resp.status} em /api/network.`);
    }
    const payload = resp.body;
    const features = payload?.features;
    const meta = payload?.meta || {};
    const serverTotal = meta.serverTotal ?? payload?.serverTotal ?? features?.length;

    const applied = await this._applyNetworkResult(
      {
        features,
        serverTotal,
        strategy: meta.strategy ? `node:${meta.strategy}` : 'node-api',
        attributes: meta.attributes || [],
        warnings: meta.warnings || [],
      },
      startedAt,
      revision,
      {
        source: 'api-node',
        backendSource: meta.originMode || meta.source || 'wfs',
        serverBuiltAt: meta.builtAt || null,
      },
    );

    if (applied.applied) {
      this.remote.online = true;
      this.remote.execution = 'remote';
      this.remote.backendSource = meta.originMode || meta.source || 'wfs';
      this.remote.serverBuiltAt = meta.builtAt || null;
      this.remote.lastSyncAt = new Date().toISOString();
      this.remote.lastError = null;
      if (clearPending && this.remote.pendingSync.length > 0) {
        this.remote.pendingSync = [];
        await this._savePendingSync();
      }
    }
    return applied.state;
  }

  async _loadInitial() {
    await this._loadRuntimeConfigFromStorage();
    const embeddedSnapshot = this.embeddedSnapshot;
    const t0 = Date.now();
    const avisosOffline = [];

    // 0. Com servidor Node.js configurado, tenta buscar a rede centralizada primeiro
    if (this._hasRemoteApi()) {
      const revision = ++this.requestRevision;
      try {
        return await this._fetchRemoteAndApply(revision, t0);
      } catch (err) {
        const msg = err?.message || String(err);
        this.remote.online = false;
        this.remote.execution = 'local-fallback';
        this.remote.lastError = msg;
        avisosOffline.push(`Servidor Node.js indisponível (${msg}); operando com rede offline local.`);
      }
    }

    // 1. Tenta ler snapshot atualizado salvo anteriormente no dispositivo
    try {
      const rawCached = await this.storage?.getItem?.(STORAGE_KEY_SNAPSHOT);
      if (rawCached) {
        const cached = JSON.parse(rawCached);
        if (!Array.isArray(cached?.features) || !cached.features.length) {
          throw new Error('Snapshot viário vazio ou inválido');
        }
        const graph = this._buildValidGraph(cached);
        this.cache = { status: 'persisted', savedAt: cached.savedAt || null, error: null };
        this.update.fingerprint = fingerprintOf(cached.features);
        return {
          graph,
          features: cached.features,
          diagnostics: graph.diagnostics,
          source: 'wfs-cache',
          strategy: cached.strategy || 'single',
          builtAt: cached.savedAt || Date.now(),
          elapsedMs: Date.now() - t0,
          serverTotal: cached.serverTotal ?? cached.features.length,
          attributes: cached.attributes || [],
          warnings: [...avisosOffline, ...(cached.warnings || [])],
        };
      }
    } catch (erro) {
      this.cache = {
        status: 'unavailable',
        savedAt: null,
        error: 'Cache local indisponível: ' + erro.message,
      };
    }

    // 2. Carrega o snapshot oficial embutido no APK (src/data/network.snapshot.json)
    if (embeddedSnapshot && Array.isArray(embeddedSnapshot.features)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const features = embeddedSnapshot.features;
      const graph = this._buildValidGraph(embeddedSnapshot);
      this.update.fingerprint = fingerprintOf(features);
      return {
        graph,
        features,
        diagnostics: graph.diagnostics,
        source: 'snapshot',
        strategy: embeddedSnapshot.strategy || 'snapshot-apk',
        builtAt: embeddedSnapshot.savedAt || Date.now(),
        elapsedMs: Date.now() - t0,
        serverTotal: embeddedSnapshot.serverTotal ?? features.length,
        attributes: embeddedSnapshot.attributes || [],
        warnings: [...avisosOffline, ...(embeddedSnapshot.warnings || [])],
      };
    }

    // 3. Fallback direto ao WFS quando não há snapshot local disponível
    return this._fetchAndApply();
  }

  _buildValidGraph(result) {
    if (
      !Array.isArray(result?.features) ||
      !result.features.length ||
      (Number.isFinite(result.serverTotal) && result.serverTotal !== result.features.length)
    ) {
      throw new Error('Snapshot viário vazio ou incompleto');
    }
    const graph = buildGraph(result.features, this.options.graphOptions);
    if (!graph.edges.length) throw new Error('Snapshot sem arestas viárias válidas');
    return graph;
  }

  async _persistSnapshot(state) {
    if (!this.storage?.setItem) return;
    try {
      this.cache = { status: 'saving', savedAt: this.cache.savedAt, error: null };
      await this.storage.setItem(
        STORAGE_KEY_SNAPSHOT,
        JSON.stringify({
          savedAt: state.builtAt,
          source: state.source,
          backendSource: state.backendSource || null,
          strategy: state.strategy,
          serverTotal: state.serverTotal,
          attributes: state.attributes,
          warnings: state.warnings,
          features: state.features,
        }),
      );
      this.cache = { status: 'persisted', savedAt: state.builtAt, error: null };
    } catch (erro) {
      this.cache = {
        status: 'memory-only',
        savedAt: this.cache.savedAt,
        error:
          'A rede atualizada está apenas em memória; não foi possível salvar para a próxima abertura: ' +
          erro.message,
      };
    }
  }

  _applyNetworkResult(result, startedAt, revision, meta = {}) {
    const task = this.commitQueue.then(async () => {
      if (revision !== this.requestRevision) return { applied: false, state: this.state };
      const graph = this._buildValidGraph(result);
      const newState = {
        graph,
        features: result.features,
        diagnostics: graph.diagnostics,
        source: meta.source || 'wfs',
        backendSource: meta.backendSource || null,
        strategy: result.strategy,
        builtAt: meta.serverBuiltAt ? Date.parse(meta.builtAt || meta.serverBuiltAt) || Date.now() : Date.now(),
        elapsedMs: Date.now() - startedAt,
        serverTotal: result.serverTotal ?? result.features.length,
        attributes: result.attributes || [],
        warnings: result.warnings || [],
      };
      this.state = newState;
      this.update.fingerprint = fingerprintOf(result.features);
      this.update.lastChangeAt = new Date().toISOString();
      this.update.lastCheckedAt = this.update.lastChangeAt;
      await this._persistSnapshot(newState);
      this._emit();
      return { applied: true, state: newState };
    });
    this.commitQueue = task.catch(() => {});
    return task;
  }

  _applyWfsResult(result, startedAt, revision) {
    return this._applyNetworkResult(result, startedAt, revision, { source: 'wfs' });
  }

  async _fetchAndApply() {
    if (!this.options.allowWfs) {
      throw new Error('Consulta WFS desativada; nenhuma rede local válida disponível para atualização');
    }
    const revision = ++this.requestRevision;
    const startedAt = Date.now();
    const result = await this.wfs.fetchNetwork({
      typeName: this.options.layerName,
      baseUrl: this.options.baseUrl,
    });
    return (await this._applyWfsResult(result, startedAt, revision)).state;
  }

  /**
   * Sincroniza o dispositivo com o backend Node.js ao recuperar conexão:
   *  1. Tenta persistir eventuais gravações pendentes (`memory-only`);
   *  2. Consulta `/api/health` e atualiza a rede local se necessário;
   *  3. Limpa a fila de pendências offline registradas sem conexão.
   */
  async syncWithServer({ forceNetworkReload = false } = {}) {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      await this._loadRuntimeConfigFromStorage();

      if (this.cache.status === 'memory-only' && this.state) {
        const state = this.state;
        const retry = this.commitQueue.then(async () => {
          if (this.state === state) await this._persistSnapshot(state);
        });
        this.commitQueue = retry.catch(() => {});
        await retry;
      }

      if (!this._hasRemoteApi()) {
        return {
          synced: false,
          changed: false,
          reason: 'Servidor Node.js não configurado.',
        };
      }

      const startedAt = Date.now();
      try {
        const healthResp = await this._fetchApiJson('/api/health');
        if (!healthResp.ok) {
          throw new Error(healthResp.body?.message || `HTTP ${healthResp.status} em /api/health.`);
        }
        const health = healthResp.body || {};

        const backendSource = health.originMode || health.source || null;
        const serverFeatures = Number.isFinite(health.features) ? health.features : null;
        const needsNetworkUpdate =
          forceNetworkReload ||
          !this.state ||
          this.state.source !== 'api-node' ||
          (backendSource && backendSource !== this.remote.backendSource) ||
          (health.builtAt && health.builtAt !== this.remote.serverBuiltAt) ||
          (serverFeatures !== null && serverFeatures !== this.state.features.length);

        let changed = false;
        if (needsNetworkUpdate || !health.ready) {
          const revision = ++this.requestRevision;
          const prevFp = this.update.fingerprint;
          await this._fetchRemoteAndApply(revision, startedAt, { clearPending: false });
          changed = prevFp !== this.update.fingerprint || this.state?.source === 'api-node';
        } else {
          this.remote.online = true;
          this.remote.execution = 'remote';
          this.remote.backendSource = backendSource || this.remote.backendSource;
          this.remote.lastSyncAt = new Date().toISOString();
          this.remote.lastError = null;
        }

        const pendingFlushed = this.remote.pendingSync.length;
        if (pendingFlushed > 0) {
          this.remote.pendingSync = [];
          await this._savePendingSync();
        }

        this.update.lastCheckedAt = new Date().toISOString();
        this.update.lastResult = {
          deep: true,
          changed,
          reason: changed
            ? `Sincronizado com servidor Node.js (${this.remote.backendSource || 'wfs'})`
            : 'Sincronizado com servidor Node.js (sem alterações)',
          serverTotal: this.state?.serverTotal ?? serverFeatures,
          knownTotal: this.state?.features?.length ?? null,
          elapsedMs: Date.now() - startedAt,
        };
        this._emit();

        return {
          synced: true,
          changed,
          backendSource: this.remote.backendSource,
          pendingFlushed,
          serverTotal: this.state?.serverTotal ?? null,
          knownTotal: this.state?.features?.length ?? null,
          reason: this.update.lastResult.reason,
        };
      } catch (err) {
        this.remote.online = false;
        this.remote.execution = 'local-fallback';
        this.remote.lastError = err?.message || String(err);
        this._emit();
        throw err;
      }
    })().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  async refreshFromWfs() {
    if (this._hasRemoteApi()) {
      try {
        const res = await this.syncWithServer({ forceNetworkReload: true });
        return { ...this.state, syncResult: res };
      } catch (err) {
        this.remote.online = false;
        this.remote.execution = 'local-fallback';
        this.remote.lastError = err?.message || String(err);
        this._emit();
        if (this.options.allowDirectWfsFallback && this.options.allowWfs) {
          await this.ensureReady();
          return this._fetchAndApply();
        }
        throw err;
      }
    }
    await this.ensureReady();
    return this._fetchAndApply();
  }

  /**
   * Verifica atualizações: com Node.js configurado, sincroniza via `/api/*`;
   * caso contrário, consulta o WFS diretamente.
   */
  async checkForChanges(opts = {}) {
    if (this.checking) return this.checking;
    this.checking = this._doCheck(opts)
      .catch((err) => {
        const msg = err?.message || String(err);
        this.update.errors.push({ at: new Date().toISOString(), message: msg });
        if (this.update.errors.length > 20) this.update.errors.shift();
        throw err;
      })
      .finally(() => {
        this.checking = null;
      });
    return this.checking;
  }

  async _doCheck(opts = {}) {
    if (this._hasRemoteApi()) {
      try {
        const res = await this.syncWithServer({ forceNetworkReload: !!opts.deep });
        return {
          deep: !!opts.deep,
          changed: res.changed,
          reason: res.reason,
          serverTotal: res.serverTotal,
          knownTotal: res.knownTotal,
          elapsedMs: this.update.lastResult?.elapsedMs ?? 0,
        };
      } catch (err) {
        this.remote.online = false;
        this.remote.execution = 'local-fallback';
        this.remote.lastError = err?.message || String(err);
        this._emit();
        throw err;
      }
    }

    if (!this.options.allowWfs) throw new Error('Consulta WFS desativada');
    const deep = !!opts.deep;
    const startedAt = Date.now();
    if (!this.state) await this.ensureReady();
    const known = this.state?.features?.length ?? null;

    let changed = false;
    let reason = null;
    let serverTotal = null;

    if (deep) {
      const revision = ++this.requestRevision;
      const result = await this.wfs.fetchNetwork({
        typeName: this.options.layerName,
        baseUrl: this.options.baseUrl,
      });
      serverTotal = result.serverTotal;
      const fp = fingerprintOf(result.features);
      const before = this.update.fingerprint;
      changed = before !== null && before !== fp;
      if (changed) {
        const applied = await this._applyWfsResult(result, startedAt, revision);
        changed = applied.applied;
        reason = changed
          ? 'conteúdo da camada alterado no GeoServer'
          : 'verificação substituída por atualização mais recente';
      } else {
        this.update.fingerprint = fp;
        if (this.cache.status === 'memory-only') {
          const state = this.state;
          const retry = this.commitQueue.then(async () => {
            if (revision === this.requestRevision && this.state === state) {
              await this._persistSnapshot(state);
            }
          });
          this.commitQueue = retry.catch(() => {});
          await retry;
        }
        reason = 'nenhuma alteração detectada';
      }
    } else {
      const check = await this.wfs.checkForUpdates(known, {
        typeName: this.options.layerName,
        baseUrl: this.options.baseUrl,
        timeout: this.options.autoUpdate.checkTimeoutMs,
        maxRetries: this.options.autoUpdate.checkMaxRetries,
      });
      serverTotal = check.serverTotal;
      changed = check.changed;
      if (changed) {
        reason = `total de feições alterado (${known} → ${serverTotal})`;
        await this.refreshFromWfs();
      } else {
        reason = 'total de feições inalterado';
      }
    }

    this.update.lastCheckedAt = new Date().toISOString();
    this.update.lastResult = {
      deep,
      changed,
      reason,
      serverTotal,
      knownTotal: known,
      elapsedMs: Date.now() - startedAt,
    };
    this._emit();
    return this.update.lastResult;
  }

  /** Inicia a verificação periódica em segundo plano enquanto o app está aberto. */
  startAutoUpdate() {
    if (!this.options.autoUpdate.enabled || (!this.options.allowWfs && !this._hasRemoteApi())) return;
    if (this.timers.length) return;

    const { checkIntervalMs, deepCheckIntervalMs } = this.options.autoUpdate;

    this.timers.push(
      setInterval(() => {
        this.checkForChanges({ deep: false }).catch(() => {});
      }, checkIntervalMs),
    );

    this.timers.push(
      setInterval(() => {
        this.checkForChanges({ deep: true }).catch(() => {});
      }, deepCheckIntervalMs),
    );

    for (const t of this.timers) t.unref?.();
  }

  stopAutoUpdate() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  _onRemoteHealthy(body = null) {
    const estavaOffline = !this.remote.online || this.remote.execution !== 'remote';
    this.remote.online = true;
    this.remote.execution = 'remote';
    this.remote.lastError = null;
    if (body?.originMode || body?.source) {
      this.remote.backendSource = body.originMode || body.source;
    }
    if (estavaOffline || this.remote.pendingSync.length > 0 || this.cache.status === 'memory-only') {
      void this.syncWithServer().catch(() => {});
    } else {
      this._emit();
    }
  }

  /**
   * Resolve e converte um Endereço Digital (CEP Digital de Santo André).
   * Online: delega para `/api/endereco-digital` do Node.js.
   * Offline: recorre automaticamente a `core/enderecoDigitalService.js`.
   */
  async resolverEnderecoDigital(codigo, modo = MODOS.LOCAL) {
    if (this._hasRemoteApi()) {
      try {
        const qs = `modo=${encodeURIComponent(modo)}&codigo=${encodeURIComponent(codigo || '')}`;
        const resp = await this._fetchApiJson(`/api/endereco-digital?${qs}`, {
          timeoutMs: this.options.apiTimeoutMs,
        });
        this._onRemoteHealthy();
        return resp.body;
      } catch (err) {
        this.remote.online = false;
        this.remote.execution = 'local-fallback';
        this.remote.lastError = err?.message || String(err);
        this._emit();
      }
    }

    const servico = criarServicoEnderecoDigital({ modo });
    const resultado = await servico.resolver(codigo);
    return {
      ok: resultado.ok,
      status: resultado.status,
      servico: servico.id,
      servicoDisponivel: servico.disponivel,
      codigoNormalizado: resultado.codigoNormalizado,
      codigoCompleto: resultado.codigoCompleto,
      latitude: resultado.latitude,
      longitude: resultado.longitude,
      naRegiao: resultado.naRegiao,
      mensagem: resultado.mensagem,
    };
  }

  /**
   * Calcula rota com múltiplas paradas (A → B → C → D…).
   * Online: delega para `POST /api/rota-paradas` do Node.js.
   * Offline: calcula localmente sobre o grafo em cache usando `core/rotaParadas.js`
   * ou `ocorrencias/roteamentoAlternativo.js` quando houver preferências/ocorrências.
   */
  async calcularRotaParadas(pontos, options = {}) {
    if (this._hasRemoteApi() && options.forceLocal !== true) {
      try {
        const body = {
          pontos,
          modo: options.modo || 'usuario',
          circular: options.circular === true,
        };
        if (options.preferencias != null) {
          body.preferencias = options.preferencias;
        }
        const resp = await this._fetchApiJson('/api/rota-paradas', {
          method: 'POST',
          timeoutMs: this.options.routeApiTimeoutMs,
          body,
        });
        this._onRemoteHealthy();
        return resp.body;
      } catch (err) {
        this.remote.online = false;
        this.remote.execution = 'local-fallback';
        this.remote.lastError = err?.message || String(err);
        await this._enqueuePendingSync({
          type: 'offline-route-fallback',
          modo: options.modo || 'usuario',
          circular: options.circular === true,
          stops: Array.isArray(pontos) ? pontos.length : 0,
        });
        this._emit();
      }
    }

    const state = await this.ensureReady();
    const ocorrenciasAtivas = Array.isArray(options.ocorrencias) ? options.ocorrencias : [];
    const usarAlternativas = options.preferencias != null || ocorrenciasAtivas.length > 0;
    if (usarAlternativas) {
      return calcularRotaComAlternativas(state.graph, pontos, {
        maxSnapDistance: options.maxSnapDistance ?? 100,
        modo: options.modo || 'usuario',
        circular: options.circular === true,
        preferencias: normalizarPreferencias(options.preferencias),
        ocorrencias: ocorrenciasAtivas,
      });
    }
    return calcularRotaComParadas(state.graph, pontos, {
      maxSnapDistance: options.maxSnapDistance ?? 100,
      ...options,
    });
  }

  /**
   * Calcula rota simples entre dois pontos `{lon, lat}`.
   * Online: delega para `GET /api/route` do Node.js.
   * Offline: calcula localmente via `core/router.js`.
   */
  async calcularRotaSimples(origin, destination, options = {}) {
    if (this._hasRemoteApi() && options.forceLocal !== true && origin && destination) {
      try {
        const qs = `origin=${encodeURIComponent(`${origin.lon},${origin.lat}`)}&destination=${encodeURIComponent(`${destination.lon},${destination.lat}`)}`;
        const resp = await this._fetchApiJson(`/api/route?${qs}`, {
          timeoutMs: this.options.routeApiTimeoutMs,
        });
        this._onRemoteHealthy();
        return resp.body;
      } catch (err) {
        this.remote.online = false;
        this.remote.execution = 'local-fallback';
        this.remote.lastError = err?.message || String(err);
        await this._enqueuePendingSync({ type: 'offline-route-simple-fallback' });
        this._emit();
      }
    }

    const state = await this.ensureReady();
    return routeOnGraph(state.graph, origin, destination, {
      maxSnapDistance: options.maxSnapDistance ?? 100,
      ...options,
    });
  }

  /**
   * Devolve os metadados da rede carregada e o estado da sincronização.
   */
  getNetworkMeta() {
    if (!this.state) return null;
    const configured = Boolean(this.options.remoteApiUrl && this.options.allowRemoteApi);
    return {
      source: this.state.source,
      backendSource: this.state.backendSource || this.remote.backendSource || null,
      strategy: this.state.strategy,
      builtAt: new Date(this.state.builtAt).toISOString(),
      features: this.state.features.length,
      attributes: this.state.attributes,
      warnings: this.state.warnings,
      cache: { ...this.cache },
      remoteApi: {
        configured,
        supported: true,
        url: configured ? this.options.remoteApiUrl : null,
        transport: configured ? resolverTipoTransporteApi(this.options.remoteApiUrl) : 'local',
        execution: configured ? this.remote.execution : 'local',
        online: configured ? this.remote.online : false,
        backendSource: configured ? this.remote.backendSource : null,
        lastSyncAt: configured ? this.remote.lastSyncAt : null,
        lastError: configured ? this.remote.lastError : null,
        pendingSyncCount: this.remote.pendingSync.length,
      },
      update: {
        enabled:
          this.options.autoUpdate.enabled && (this.options.allowWfs || this._hasRemoteApi()),
        checkIntervalMs: this.options.autoUpdate.checkIntervalMs,
        deepCheckIntervalMs: this.options.autoUpdate.deepCheckIntervalMs,
        lastCheckedAt: this.update.lastCheckedAt,
        lastChangeAt: this.update.lastChangeAt,
        lastResult: this.update.lastResult,
        fingerprint: this.update.fingerprint,
        recentErrors: this.update.errors.slice(-5),
      },
    };
  }

  /**
   * Devolve o diagnóstico detalhado de construção do grafo topológico.
   */
  getDiagnostics() {
    if (!this.state) return null;
    return {
      ...this.state.diagnostics,
      source: this.state.source,
      backendSource: this.state.backendSource || this.remote.backendSource || null,
      strategy: this.state.strategy,
      builtAt: new Date(this.state.builtAt).toISOString(),
      buildMs: this.state.elapsedMs,
      serverTotal: this.state.serverTotal,
      attributes: this.state.attributes,
    };
  }

  /** Inspeciona o esquema XML da camada WFS (DescribeFeatureType). */
  async getLayerSchema() {
    if (this._hasRemoteApi()) {
      try {
        const resp = await this._fetchApiJson('/api/layer-schema');
        if (resp.ok) return resp.body;
      } catch {
        /* fallback para WFS direto se permitido */
      }
    }
    return this.wfs.describeLayer({
      typeName: this.options.layerName,
      baseUrl: this.options.baseUrl,
    });
  }
}
