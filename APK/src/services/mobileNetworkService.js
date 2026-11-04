/**
 * SERVIÇO DE REDE VIÁRIA MOBILE (REACT NATIVE / ANDROID)
 * ======================================================
 *
 * Adaptação para React Native (Android APK) do `server/networkService.js` e
 * `server/index.js`.
 *
 * Diferenças arquiteturais em relação à versão Web:
 *  1. No navegador, o GeoServer da Prefeitura de Santo André bloqueia requisições
 *     diretas por ausência de cabeçalhos CORS (`Access-Control-Allow-Origin`),
 *     exigindo o backend Node.js intermediário.
 *  2. No Android nativo (React Native), o `fetch` nativo NÃO sofre restrição de
 *     CORS de navegador e pode consultar o WFS da Prefeitura diretamente, além
 *     de trazer o snapshot completo (`network.snapshot.json`, 4.545 feições)
 *     embutido no pacote do APK para funcionamento 100% offline imediato.
 *  3. Todo o motor geométrico (UTM 23S, índice espacial, corte topológico,
 *     union-find, A*, múltiplas paradas e CEP Digital) roda localmente no
 *     dispositivo Android em JavaScript puro (Hermes).
 *  4. Opcionalmente, o aplicativo também permite configurar uma URL de servidor
 *     remoto/emulador (ex.: `http://10.0.2.2:8080` no Android Emulator) caso o
 *     usuário deseje delegar ao servidor Node.js.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildGraph } from '../core/graph.js';
import { fetchNetwork, describeLayer, checkForUpdates } from '../core/wfs.js';
import { routeOnGraph } from '../core/router.js';
import { calcularRotaComParadas } from '../core/rotaParadas.js';
import { criarServicoEnderecoDigital, MODOS } from '../core/enderecoDigitalService.js';
import { WFS_DEFAULTS, UPDATE_DEFAULTS, LAYER_NAME } from '../core/config.js';
import embeddedSnapshot from '../data/network.snapshot.json';

const STORAGE_KEY_SNAPSHOT = '@santo_andre_routing:wfs_snapshot_v1';

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

export class MobileNetworkService {
  constructor(options = {}) {
    this.options = {
      snapshotTtl: options.snapshotTtl ?? WFS_DEFAULTS.snapshotTtl,
      graphOptions: options.graphOptions || {},
      layerName: options.layerName || LAYER_NAME,
      allowWfs: options.allowWfs !== false,
      baseUrl: options.baseUrl || undefined,
      // Se preenchido (ex.: 'http://10.0.2.2:8080'), permite usar o backend Node
      remoteApiUrl: options.remoteApiUrl || null,
      autoUpdate: {
        enabled: options.autoUpdate?.enabled ?? true,
        checkIntervalMs: options.autoUpdate?.checkIntervalMs ?? UPDATE_DEFAULTS.checkIntervalMs,
        deepCheckIntervalMs:
          options.autoUpdate?.deepCheckIntervalMs ?? UPDATE_DEFAULTS.deepCheckIntervalMs,
        checkTimeoutMs: options.autoUpdate?.checkTimeoutMs ?? UPDATE_DEFAULTS.checkTimeoutMs,
        checkMaxRetries: options.autoUpdate?.checkMaxRetries ?? UPDATE_DEFAULTS.checkMaxRetries,
      },
    };

    this.state = null;
    this.loading = null;
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

  /**
   * Garante que o grafo viário esteja carregado e construído em memória.
   * No primeiro arranque, usa o snapshot local (embutido no APK ou salvo no
   * AsyncStorage) para resposta imediata (~0,5s) e sem depender de internet.
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

  async _loadInitial() {
    const t0 = Date.now();

    // 1. Tenta ler snapshot atualizado salvo anteriormente no dispositivo
    try {
      const rawCached = await AsyncStorage.getItem(STORAGE_KEY_SNAPSHOT);
      if (rawCached) {
        const cached = JSON.parse(rawCached);
        if (Array.isArray(cached?.features) && cached.features.length > 0) {
          const graph = buildGraph(cached.features, this.options.graphOptions);
          this.update.fingerprint = fingerprintOf(cached.features);
          return {
            graph,
            features: cached.features,
            diagnostics: graph.diagnostics,
            source: cached.source || 'wfs-cache',
            strategy: cached.strategy || 'single',
            builtAt: cached.savedAt || Date.now(),
            elapsedMs: Date.now() - t0,
            serverTotal: cached.serverTotal ?? cached.features.length,
            attributes: cached.attributes || [],
            warnings: cached.warnings || [],
          };
        }
      }
    } catch {
      /* Se falhar leitura do cache local, segue para o snapshot embutido */
    }

    // 2. Carrega o snapshot oficial embutido no APK (data/network.snapshot.json)
    if (embeddedSnapshot && Array.isArray(embeddedSnapshot.features)) {
      // Cede um tick à UI thread antes de construir o grafo
      await new Promise((resolve) => setTimeout(resolve, 10));
      const features = embeddedSnapshot.features;
      const graph = buildGraph(features, this.options.graphOptions);
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
        warnings: embeddedSnapshot.warnings || [],
      };
    }

    // 3. Fallback: busca direto do WFS da Prefeitura
    return this.refreshFromWfs();
  }

  /**
   * Baixa a camada atualizada diretamente do GeoServer WFS da Prefeitura
   * (ou via servidor remoto se configurado), reconstrói o grafo e salva em cache.
   */
  async refreshFromWfs() {
    const t0 = Date.now();
    const result = await fetchNetwork({
      typeName: this.options.layerName,
      baseUrl: this.options.baseUrl,
    });

    const graph = buildGraph(result.features, this.options.graphOptions);
    const fp = fingerprintOf(result.features);
    this.update.fingerprint = fp;
    this.update.lastChangeAt = new Date().toISOString();
    this.update.lastCheckedAt = this.update.lastChangeAt;

    const newState = {
      graph,
      features: result.features,
      diagnostics: graph.diagnostics,
      source: 'wfs',
      strategy: result.strategy,
      builtAt: Date.now(),
      elapsedMs: Date.now() - t0,
      serverTotal: result.serverTotal ?? result.features.length,
      attributes: result.attributes || [],
      warnings: result.warnings || [],
    };

    this.state = newState;

    // Persiste o novo snapshot em AsyncStorage (sem bloquear em caso de limite de quota)
    try {
      await AsyncStorage.setItem(
        STORAGE_KEY_SNAPSHOT,
        JSON.stringify({
          savedAt: newState.builtAt,
          source: 'wfs',
          strategy: newState.strategy,
          serverTotal: newState.serverTotal,
          attributes: newState.attributes,
          warnings: newState.warnings,
          features: newState.features,
        })
      );
    } catch {
      /* Em aparelhos com limite restrito no SQLite do AsyncStorage, mantém em memória */
    }

    this._emit();
    return newState;
  }

  /**
   * Verifica se a camada WFS da Prefeitura sofreu alterações (leve ou completa).
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
    const deep = !!opts.deep;
    const startedAt = Date.now();
    if (!this.state) await this.ensureReady();
    const known = this.state?.features?.length ?? null;

    let changed = false;
    let reason = null;
    let serverTotal = null;

    if (deep) {
      const result = await fetchNetwork({
        typeName: this.options.layerName,
        baseUrl: this.options.baseUrl,
      });
      serverTotal = result.serverTotal;
      const fp = fingerprintOf(result.features);
      const before = this.update.fingerprint;
      changed = before !== null && before !== fp;
      if (changed) {
        reason = 'conteúdo da camada alterado no GeoServer';
        const t0 = Date.now();
        const graph = buildGraph(result.features, this.options.graphOptions);
        this.update.fingerprint = fp;
        this.update.lastChangeAt = new Date().toISOString();
        this.state = {
          graph,
          features: result.features,
          diagnostics: graph.diagnostics,
          source: 'wfs',
          strategy: result.strategy,
          builtAt: Date.now(),
          elapsedMs: Date.now() - t0,
          serverTotal: result.serverTotal ?? result.features.length,
          attributes: result.attributes || [],
          warnings: result.warnings || [],
        };
        this._emit();
      } else {
        this.update.fingerprint = fp;
        reason = 'nenhuma alteração detectada';
      }
    } else {
      const check = await checkForUpdates(known, {
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
    if (!this.options.autoUpdate.enabled || !this.options.allowWfs) return;
    if (this.timers.length) return;

    const { checkIntervalMs, deepCheckIntervalMs } = this.options.autoUpdate;

    this.timers.push(
      setInterval(() => {
        this.checkForChanges({ deep: false }).catch(() => {});
      }, checkIntervalMs)
    );

    this.timers.push(
      setInterval(() => {
        this.checkForChanges({ deep: true }).catch(() => {});
      }, deepCheckIntervalMs)
    );
  }

  stopAutoUpdate() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /**
   * Resolve e converte um Endereço Digital (CEP Digital de Santo André) em
   * coordenadas geográficas usando a porta fiel de `CalculoGeometriaDAL`.
   */
  async resolverEnderecoDigital(codigo, modo = MODOS.LOCAL) {
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
   * Calcula a rota completa com múltiplas paradas (A → B → C → D…) na ordem
   * definida pelo usuário sobre o grafo viário real.
   */
  async calcularRotaParadas(pontos, options = {}) {
    const state = await this.ensureReady();
    return calcularRotaComParadas(state.graph, pontos, {
      maxSnapDistance: options.maxSnapDistance ?? 100,
      ...options,
    });
  }

  /**
   * Calcula uma rota simples entre dois pontos `{lon, lat}`.
   */
  async calcularRotaSimples(origin, destination, options = {}) {
    const state = await this.ensureReady();
    return routeOnGraph(state.graph, origin, destination, {
      maxSnapDistance: options.maxSnapDistance ?? 100,
      ...options,
    });
  }

  /**
   * Devolve os metadados da rede carregada e o estado da atualização.
   */
  getNetworkMeta() {
    if (!this.state) return null;
    return {
      source: this.state.source,
      strategy: this.state.strategy,
      builtAt: new Date(this.state.builtAt).toISOString(),
      features: this.state.features.length,
      attributes: this.state.attributes,
      warnings: this.state.warnings,
      update: {
        enabled: this.options.autoUpdate.enabled,
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
      strategy: this.state.strategy,
      builtAt: new Date(this.state.builtAt).toISOString(),
      buildMs: this.state.elapsedMs,
      serverTotal: this.state.serverTotal,
      attributes: this.state.attributes,
    };
  }

  /** Inspeciona o esquema XML da camada WFS (DescribeFeatureType). */
  async getLayerSchema() {
    return describeLayer({
      typeName: this.options.layerName,
      baseUrl: this.options.baseUrl,
    });
  }
}

export const mobileNetworkService = new MobileNetworkService();
