/**
 * SERVIÇO DE REDE VIÁRIA
 * =======================
 *
 * Centraliza o ciclo de vida da rede:
 *
 *   carregar (WFS ou snapshot em disco) → construir o grafo → cache
 *
 * Decisões de arquitetura (ver README, seção "Arquitetura"):
 *
 *  • O navegador NÃO consegue consultar o WFS diretamente: o GeoServer da
 *    Prefeitura não devolve cabeçalhos `Access-Control-Allow-Origin`. Isso
 *    torna o backend obrigatório, e não apenas opcional.
 *
 *  • O grafo é caro de construir (~0,8 s para 4.119 eixos) e é IMPERATIVO
 *    que não seja refeito a cada rota. Ele fica em memória no processo e é
 *    invalidado apenas quando a camada muda.
 *
 *  • Um snapshot da rede é persistido em disco. Ao subir, o servidor usa o
 *    snapshot enquanto ele estiver dentro do TTL, evitando depender da rede
 *    do município no arranque.
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGraph } from '../core/graph.js';
import { fetchNetwork, describeLayer, checkForUpdates } from '../core/wfs.js';
import { GRAPH_DEFAULTS, WFS_DEFAULTS, UPDATE_DEFAULTS, LAYER_NAME } from '../core/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const SNAPSHOT_PATH = path.join(ROOT, 'data', 'network.snapshot.json');

/**
 * @typedef {object} NetworkState
 * @property {object|null} graph
 * @property {Array} features
 * @property {object} diagnostics
 * @property {string} source  'wfs' | 'snapshot'
 * @property {string} strategy
 * @property {number} builtAt
 * @property {number} elapsedMs
 */

/**
 * Formata um intervalo em milissegundos de forma legível (minutos ou horas).
 */
function formatarIntervalo(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'desativada';
  if (ms % 3600000 === 0) return `${ms / 3600000} h`;
  if (ms % 60000 === 0) return `${ms / 60000} min`;
  return `${Math.round(ms / 1000)} s`;
}

export class NetworkService {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    this.options = {
      snapshotPath: options.snapshotPath || SNAPSHOT_PATH,
      snapshotTtl: options.snapshotTtl ?? WFS_DEFAULTS.snapshotTtl,
      graphOptions: options.graphOptions || {},
      layerName: options.layerName || LAYER_NAME,
      allowWfs: options.allowWfs !== false,
      // endpoint do WFS (undefined = o da Prefeitura, em core/config.js)
      baseUrl: options.baseUrl || undefined,
      // verificação automática: desligada por padrão (é preciso poder
      // desligar em testes e em ambientes sem acesso ao WFS)
      autoUpdate: {
        enabled: options.autoUpdate?.enabled ?? false,
        checkIntervalMs: options.autoUpdate?.checkIntervalMs ?? UPDATE_DEFAULTS.checkIntervalMs,
        deepCheckIntervalMs:
          options.autoUpdate?.deepCheckIntervalMs ?? UPDATE_DEFAULTS.deepCheckIntervalMs,
        deepCheckOnStart: options.autoUpdate?.deepCheckOnStart ?? UPDATE_DEFAULTS.deepCheckOnStart,
        // a verificação leve é uma tarefa de fundo: falha rápido e tenta
        // de novo no ciclo seguinte (um WFS lento não pode travar o processo)
        checkTimeoutMs: options.autoUpdate?.checkTimeoutMs ?? UPDATE_DEFAULTS.checkTimeoutMs,
        checkMaxRetries: options.autoUpdate?.checkMaxRetries ?? UPDATE_DEFAULTS.checkMaxRetries,
      },
    };
    /** @type {NetworkState|null} */
    this.state = null;
    this.loading = null;
    this.listeners = new Set();
    /** @type {NodeJS.Timeout[]} */
    this.timers = [];
    /** @type {Promise<any>|null} */
    this.checking = null;
    /** informação sobre a última verificação de atualização */
    this.update = {
      lastCheckedAt: null,
      lastChangeAt: null,
      lastResult: null,
      fingerprint: null,
      errors: [],
    };
  }

  /**
   * Devolve a rede pronta (carregando se necessário).
   * Chamadas concorrentes compartilham a mesma promessa.
   */
  async ensureReady() {
    if (this.state) return this.state;
    if (this.loading) return this.loading;
    this.loading = this._load()
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

  /** Recarrega a rede do WFS, ignorando o cache. */
  async refresh() {
    this.state = null;
    this.loading = null;
    return this.ensureReady();
  }

  /* ══════════════════════════════════════════════════════════════════
     ATUALIZAÇÃO AUTOMÁTICA
     ══════════════════════════════════════════════════════════════════ */

  /**
   * Inicia a verificação periódica de mudanças na camada.
   *
   * A verificação LEVE (a cada `checkIntervalMs`) compara o total de feições
   * declarado pelo servidor com o total conhecido: detecta eixos adicionados
   * ou removidos.
   *
   * A verificação COMPLETA (a cada `deepCheckIntervalMs`) baixa a rede
   * inteira e compara a impressão digital do conteúdo: detecta também a
   * correção de um eixo já existente (rua renomeada ou traçado corrigido).
   */
  startAutoUpdate() {
    if (!this.options.autoUpdate.enabled) return;
    if (!this.options.allowWfs) {
      console.warn('[rede] atualização automática desligada: acesso ao WFS desabilitado.');
      return;
    }
    if (this.timers.length) return; // já está rodando

    const { checkIntervalMs, deepCheckIntervalMs, deepCheckOnStart } = this.options.autoUpdate;

    // verificação leve, periódica
    this.timers.push(
      setInterval(() => {
        this._checkForChanges().catch((err) => {
          this._recordError(err);
        });
      }, checkIntervalMs)
    );

    // verificação completa, periódica
    this.timers.push(
      setInterval(() => {
        this._checkForChanges({ deep: true }).catch((err) => {
          this._recordError(err);
        });
      }, deepCheckIntervalMs)
    );

    // os timers não devem manter o processo vivo
    for (const t of this.timers) t.unref?.();

    // primeira verificação logo após o arranque: estabelece a linha de base
    // da camada (e carrega a rede, se ela ainda não estiver em uso)
    this._checkForChanges().catch(() => {
      /* o erro já foi registrado em update.errors */
    });

    if (deepCheckOnStart) {
      this._checkForChanges({ deep: true }).catch((err) => this._recordError(err));
    }

    console.log(
      `[rede] atualização automática ligada: verificação leve a cada ` +
        `${formatarIntervalo(checkIntervalMs)}, completa a cada ` +
        `${formatarIntervalo(deepCheckIntervalMs)}.`
    );
  }

  /** Interrompe a verificação periódica. */
  stopAutoUpdate() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  _recordError(err) {
    const msg = err?.message || String(err);
    console.warn('[rede] falha na verificação de atualização:', msg);
    this.update.errors.push({ at: new Date().toISOString(), message: msg });
    if (this.update.errors.length > 20) this.update.errors.shift();
  }

  /**
   * Verifica se a camada mudou e, se sim, recarrega.
   *
   * @param {{deep?: boolean}} [opts] `deep` baixa a rede inteira e compara
   *        a impressão digital do conteúdo.
   */
  async _checkForChanges(opts = {}) {
    // verificações concorrentes compartilham a mesma promessa
    if (this.checking) return this.checking;
    this.checking = this._doCheck(opts)
      .catch((err) => {
        // qualquer falha é registrada, mas o estado em uso não é afetado
        this._recordError(err);
        throw err;
      })
      .finally(() => {
        this.checking = null;
      });
    return this.checking;
  }

  async _doCheck(opts) {
    const deep = !!opts.deep;
    const startedAt = Date.now();
    let known = this.state?.features?.length ?? null;

    let changed = false;
    let reason = null;
    let serverTotal = null;

    if (deep) {
      // verificação completa: baixa tudo e compara a impressão digital
      const result = await fetchNetwork({ typeName: this.options.layerName, baseUrl: this.options.baseUrl });
      serverTotal = result.serverTotal;
      const fingerprint = fingerprintOf(result.features);
      const before = this.update.fingerprint;
      changed = before !== null && before !== fingerprint;
      if (before === null) {
        // primeira impressão digital: registra sem recarregar
        this.update.fingerprint = fingerprint;
        reason = 'impressão digital registrada';
        if (!this.state) {
          // ainda não há rede em uso: o download que acabamos de fazer
          // serve de linha de base (evita baixar a camada duas vezes)
          await this._applyFeatures(result.features, result);
          reason = 'rede carregada a partir da verificação completa';
        }
      } else if (changed) {
        reason = 'conteúdo da camada alterado';
        // já temos a rede nova em mãos: reaproveita
        await this._applyFeatures(result.features, result);
      }
    } else {
      // ainda não há rede em uso: carrega-a para ter uma linha de base
      // (é o que torna a verificação leve útil logo no arranque)
      if (!this.state) await this.ensureReady();
      known = this.state?.features?.length ?? null;

      // verificação leve: compara o total declarado pelo servidor
      const check = await checkForUpdates(known, {
        typeName: this.options.layerName,
        baseUrl: this.options.baseUrl,
        // falha rápido: o ciclo seguinte tenta de novo
        timeout: this.options.autoUpdate.checkTimeoutMs,
        maxRetries: this.options.autoUpdate.checkMaxRetries,
      });
      serverTotal = check.serverTotal;
      changed = check.changed;
      if (changed) {
        reason = `total de feições alterado (${known} -> ${serverTotal})`;
        await this._reloadFromWfs();
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
    return this.update.lastResult;
  }

  /** Baixa a rede do WFS e constrói um novo grafo, sem trocar o estado atual. */
  async _reloadFromWfs() {
    const result = await fetchNetwork({ typeName: this.options.layerName, baseUrl: this.options.baseUrl });
    return this._applyFeatures(result.features, result);
  }

  /**
   * Constrói o grafo a partir das features e TROCA o estado de uma vez só.
   *
   * O grafo novo é construído inteiramente antes de substituir o antigo: as
   * requisições em andamento continuam usando a rede antiga, sem nunca ver
   * um grafo pela metade.
   */
  async _applyFeatures(features, result) {
    const t0 = Date.now();
    const graph = buildGraph(features, this.options.graphOptions);

    const state = {
      graph,
      features,
      diagnostics: graph.diagnostics,
      source: 'wfs',
      strategy: result?.strategy ?? 'wfs',
      builtAt: Date.now(),
      elapsedMs: Date.now() - t0,
      serverTotal: result?.serverTotal ?? features.length,
      warnings: result?.warnings ?? [],
      attributes: result?.attributes ?? this.state?.attributes ?? [],
      wfsPages: result?.pages,
      wfsElapsedMs: result?.elapsedMs,
    };

    // troca atômica
    this.state = state;
    this.update.lastChangeAt = new Date().toISOString();
    this.update.fingerprint = fingerprintOf(features);
    this._emit();

    // persiste o snapshot para o próximo arranque
    await this._writeSnapshot({
      features,
      serverTotal: state.serverTotal,
      strategy: state.strategy,
      attributes: state.attributes,
      warnings: state.warnings,
    }).catch((err) => {
      console.warn('[rede] não foi possível gravar o snapshot:', err.message);
    });

    console.log(
      `[rede] rede atualizada: ${features.length} eixos, ` +
        `${state.diagnostics.nodes} nós, ${state.diagnostics.edges} arestas ` +
        `(${state.elapsedMs} ms).`
    );
    return state;
  }

  async _load() {
    const t0 = Date.now();

    // 1) tenta usar o snapshot local (arranque rápido e resiliente)
    const snapshot = await this._readSnapshot();
    if (snapshot && Date.now() - snapshot.savedAt < this.options.snapshotTtl) {
      try {
        const graph = buildGraph(snapshot.features, this.options.graphOptions);
        // registra a impressão digital do snapshot: é a linha de base
        // contra a qual a verificação completa vai comparar
        this.update.fingerprint = fingerprintOf(snapshot.features);
        return {
          graph,
          features: snapshot.features,
          diagnostics: graph.diagnostics,
          source: 'snapshot',
          strategy: 'snapshot',
          builtAt: snapshot.savedAt,
          elapsedMs: Date.now() - t0,
          serverTotal: snapshot.serverTotal ?? null,
          warnings: snapshot.warnings || [],
          attributes: snapshot.attributes || [],
        };
      } catch (err) {
        console.warn('[rede] snapshot inválido, recarregando do WFS:', err.message);
      }
    }

    if (!this.options.allowWfs) {
      throw new Error('Nenhum snapshot válido disponível e o acesso ao WFS está desabilitado.');
    }

    // 2) busca no WFS
    let result;
    try {
      result = await fetchNetwork({ typeName: this.options.layerName, baseUrl: this.options.baseUrl });
    } catch (err) {
      // 2b) RESILIÊNCIA: o WFS da Prefeitura pode estar fora do ar (ou
      // indisponível exatamente enquanto a view é atualizada). Se existe um
      // snapshot anterior, ele é melhor do que o servidor ficar sem rede:
      // a aplicação continua calculando rotas com os dados da última
      // atualização bem-sucedida e avisa o usuário.
      if (snapshot) {
        console.warn(
          `[rede] WFS indisponível (${err.message}); servindo o snapshot local de ` +
            `${new Date(snapshot.savedAt).toLocaleString('pt-BR')}.`
        );
        const graph = buildGraph(snapshot.features, this.options.graphOptions);
        this.update.fingerprint = fingerprintOf(snapshot.features);
        return {
          graph,
          features: snapshot.features,
          diagnostics: graph.diagnostics,
          source: 'snapshot',
          strategy: 'snapshot (WFS indisponível)',
          builtAt: snapshot.savedAt,
          elapsedMs: Date.now() - t0,
          serverTotal: snapshot.serverTotal ?? null,
          warnings: [
            ...(snapshot.warnings || []),
            'GeoServer WFS indisponível — servindo o último snapshot local até a próxima verificação.',
          ],
          attributes: snapshot.attributes || [],
        };
      }
      throw err;
    }
    const graph = buildGraph(result.features, this.options.graphOptions);
    this.update.fingerprint = fingerprintOf(result.features);

    // 3) persiste o snapshot para o próximo arranque
    await this._writeSnapshot(result).catch((err) => {
      console.warn('[rede] não foi possível gravar o snapshot:', err.message);
    });

    return {
      graph,
      features: result.features,
      diagnostics: graph.diagnostics,
      source: 'wfs',
      strategy: result.strategy,
      builtAt: Date.now(),
      elapsedMs: Date.now() - t0,
      serverTotal: result.serverTotal,
      warnings: result.warnings,
      attributes: result.attributes,
      wfsPages: result.pages,
      wfsElapsedMs: result.elapsedMs,
    };
  }

  async _readSnapshot() {
    if (!existsSync(this.options.snapshotPath)) return null;
    try {
      const raw = await readFile(this.options.snapshotPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.features) || parsed.features.length === 0) return null;
      const info = await stat(this.options.snapshotPath);
      return {
        features: parsed.features,
        savedAt: parsed.savedAt ?? info.mtimeMs,
        serverTotal: parsed.serverTotal ?? null,
        warnings: parsed.warnings ?? [],
        attributes: parsed.attributes ?? [],
      };
    } catch (err) {
      console.warn('[rede] snapshot ilegível:', err.message);
      return null;
    }
  }

  async _writeSnapshot(result) {
    await mkdir(path.dirname(this.options.snapshotPath), { recursive: true });
    const payload = {
      savedAt: Date.now(),
      layer: this.options.layerName,
      serverTotal: result.serverTotal,
      strategy: result.strategy,
      attributes: result.attributes,
      warnings: result.warnings,
      features: result.features,
    };
    await writeFile(this.options.snapshotPath, JSON.stringify(payload), 'utf8');
  }

  /** Descreve a camada no servidor (DescribeFeatureType). */
  async schema() {
    return describeLayer({ typeName: this.options.layerName, baseUrl: this.options.baseUrl });
  }

  onUpdate(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) {
      try {
        fn(this.state);
      } catch {
        /* ignora falhas de ouvintes */
      }
    }
  }

  /** Resumo do estado atual, para o endpoint /api/health. */
  status() {
    if (!this.state) {
      return { ready: false, loading: !!this.loading, update: this.updateStatus() };
    }
    const d = this.state.diagnostics;
    return {
      ready: true,
      source: this.state.source,
      strategy: this.state.strategy,
      builtAt: new Date(this.state.builtAt).toISOString(),
      elapsedMs: this.state.elapsedMs,
      features: this.state.features.length,
      nodes: d.nodes,
      edges: d.edges,
      components: d.components,
      largestComponent: d.largestComponent,
      warnings: this.state.warnings,
      update: this.updateStatus(),
    };
  }

  /** Situação da atualização automática. */
  updateStatus() {
    return {
      enabled: this.options.autoUpdate.enabled,
      checkIntervalMs: this.options.autoUpdate.checkIntervalMs,
      deepCheckIntervalMs: this.options.autoUpdate.deepCheckIntervalMs,
      checkTimeoutMs: this.options.autoUpdate.checkTimeoutMs,
      lastCheckedAt: this.update.lastCheckedAt,
      lastChangeAt: this.update.lastChangeAt,
      lastResult: this.update.lastResult,
      errors: this.update.errors.slice(-3),
    };
  }
}

/**
 * Impressão digital do conteúdo da rede (SHA-256).
 *
 * Calculada sobre as feições ORDENADAS por ID e sobre as coordenadas
 * arredondadas, para que a mesma rede produza sempre a mesma impressão
 * digital (e uma diferença real de geometria produza outra).
 */
function fingerprintOf(features) {
  const items = features
    .map((f) => {
      const id = f?.properties?.ID ?? '';
      const g = f?.geometry;
      if (!g) return `${id}|`;
      const rings = g.type === 'LineString' ? [g.coordinates] : g.coordinates || [];
      const coords = rings
        .flat()
        .map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`)
        .join(';');
      return `${id}|${g.type}|${coords}`;
    })
    .sort();
  const h = createHash('sha256');
  for (const it of items) h.update(it).update('\n');
  return h.digest('hex');
}

export { GRAPH_DEFAULTS };
