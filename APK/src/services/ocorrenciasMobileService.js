/**
 * Serviço mobile de ocorrências colaborativas, preferências e sincronização offline.
 *
 * Responsabilidades:
 *  - Identificação pseudônima persistente do usuário (`usuarioId` em AsyncStorage);
 *  - Persistência das preferências de trajeto (`preferencias` em AsyncStorage);
 *  - Cache local de ocorrências ativas (`ocorrencias_cache_v1`) para roteamento offline;
 *  - Fila offline de registros e interações pendentes para envio automático quando
 *    o servidor Node.js voltar a ficar acessível.
 */

import { STATUS_OCORRENCIA } from '../ocorrencias/catalogo.js';
import {
  chaveStoragePreferencias,
  chaveStorageUsuarioId,
  normalizarPreferencias,
  preferenciasPadrao,
} from '../ocorrencias/preferencias.js';
import {
  aplicarInteracao,
  associarSegmentoDaRede,
  atualizarExpiracoes,
  criarOcorrencia,
} from '../ocorrencias/regras.js';

export const STORAGE_KEY_OCORRENCIAS_CACHE = '@santo_andre_routing:ocorrencias_cache_v1';
export const STORAGE_KEY_OCORRENCIAS_PENDENTES = '@santo_andre_routing:ocorrencias_pendentes_v1';

export class OcorrenciasMobileService {
  constructor({ storage = null, networkService = null } = {}) {
    this.storage = storage;
    this.networkService = networkService;
    this.ocorrencias = [];
    this.pendentes = [];
    this.carregado = false;
  }

  async obterOuCriarUsuarioId() {
    const chave = chaveStorageUsuarioId();
    try {
      const existente = await this.storage?.getItem?.(chave);
      if (existente && existente.trim()) return existente.trim();
    } catch {
      /* segue para criação */
    }
    const novo = `apk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      await this.storage?.setItem?.(chave, novo);
    } catch {
      /* ignora erro de armazenamento */
    }
    return novo;
  }

  async carregarPreferencias() {
    try {
      const bruto = await this.storage?.getItem?.(chaveStoragePreferencias());
      if (!bruto) return preferenciasPadrao();
      return normalizarPreferencias(JSON.parse(bruto));
    } catch {
      return preferenciasPadrao();
    }
  }

  async salvarPreferencias(pref) {
    const norm = normalizarPreferencias(pref);
    try {
      await this.storage?.setItem?.(chaveStoragePreferencias(), JSON.stringify(norm));
    } catch {
      /* ignora erro de armazenamento */
    }
    return norm;
  }

  async _carregarCacheLocal(agora = Date.now()) {
    if (this.carregado) {
      const { ocorrencias } = atualizarExpiracoes(this.ocorrencias, agora);
      this.ocorrencias = ocorrencias;
      return;
    }
    try {
      const raw = await this.storage?.getItem?.(STORAGE_KEY_OCORRENCIAS_CACHE);
      if (raw) {
        const parsed = JSON.parse(raw);
        const lista = Array.isArray(parsed) ? parsed : [];
        this.ocorrencias = atualizarExpiracoes(lista, agora).ocorrencias;
      }
    } catch {
      this.ocorrencias = [];
    }
    try {
      const rawPend = await this.storage?.getItem?.(STORAGE_KEY_OCORRENCIAS_PENDENTES);
      if (rawPend) {
        const parsedPend = JSON.parse(rawPend);
        this.pendentes = Array.isArray(parsedPend) ? parsedPend : [];
      }
    } catch {
      this.pendentes = [];
    }
    this.carregado = true;
  }

  async _salvarCacheLocal() {
    try {
      await this.storage?.setItem?.(
        STORAGE_KEY_OCORRENCIAS_CACHE,
        JSON.stringify(this.ocorrencias),
      );
    } catch {
      /* storage cheio não deve impedir funcionamento */
    }
  }

  async _salvarPendentes() {
    try {
      await this.storage?.setItem?.(
        STORAGE_KEY_OCORRENCIAS_PENDENTES,
        JSON.stringify(this.pendentes.slice(-50)),
      );
    } catch {
      /* ignora erro de armazenamento */
    }
  }

  _filtrarAtivas(lista) {
    return (lista || []).filter(
      (o) =>
        o.status !== STATUS_OCORRENCIA.RESOLVIDA &&
        o.status !== STATUS_OCORRENCIA.EXPIRADA,
    );
  }

  _podeConsultarServidor() {
    return Boolean(
      this.networkService &&
        typeof this.networkService._hasRemoteApi === 'function' &&
        this.networkService._hasRemoteApi(),
    );
  }

  async sincronizarPendentes() {
    await this._carregarCacheLocal();
    if (!this.pendentes.length || !this._podeConsultarServidor()) {
      return { flushed: 0, remaining: this.pendentes.length };
    }

    let flushed = 0;
    const restantes = [];
    for (let i = 0; i < this.pendentes.length; i++) {
      const item = this.pendentes[i];
      try {
        let resp;
        if (item.kind === 'create') {
          resp = await this.networkService._fetchApiJson('/api/ocorrencias', {
            method: 'POST',
            body: item.payload,
          });
        } else if (item.kind === 'interact') {
          resp = await this.networkService._fetchApiJson('/api/ocorrencias/interagir', {
            method: 'POST',
            body: item.payload,
          });
        }
        // 2xx ou 4xx definitivo (validação/duplicidade) encerram a pendência; apenas 5xx/rede retenta.
        if (!resp || resp.ok || resp.domainError) {
          flushed++;
        }
      } catch {
        restantes.push(...this.pendentes.slice(i));
        break;
      }
    }

    this.pendentes = restantes;
    await this._salvarPendentes();
    return { flushed, remaining: this.pendentes.length };
  }

  async listarAtivas({ agora = Date.now() } = {}) {
    await this._carregarCacheLocal(agora);
    if (this._podeConsultarServidor()) {
      try {
        await this.sincronizarPendentes();
        const resp = await this.networkService._fetchApiJson('/api/ocorrencias');
        if (resp?.ok && Array.isArray(resp.body?.ocorrencias)) {
          this.ocorrencias = atualizarExpiracoes(resp.body.ocorrencias, agora).ocorrencias;
          await this._salvarCacheLocal();
          return this._filtrarAtivas(this.ocorrencias);
        }
      } catch {
        /* fallback transparente para cache local offline */
      }
    }
    return this._filtrarAtivas(this.ocorrencias);
  }

  async associarSegmento({ latitude, longitude, featureIdPreferido = null }) {
    if (this._podeConsultarServidor()) {
      try {
        const resp = await this.networkService._fetchApiJson('/api/ocorrencias/segmento', {
          method: 'POST',
          body: { latitude, longitude, featureIdPreferido },
        });
        if (resp?.body) return resp.body;
      } catch {
        /* fallback para grafo local */
      }
    }
    const state = await this.networkService.ensureReady();
    return associarSegmentoDaRede(state.graph, {
      latitude,
      longitude,
      featureIdPreferido,
    });
  }

  async registrar(payload, { usuarioId, agora = Date.now() } = {}) {
    await this._carregarCacheLocal(agora);
    const uid = usuarioId || (await this.obterOuCriarUsuarioId());
    const corpo = { ...payload, usuarioId: uid };

    if (this._podeConsultarServidor()) {
      try {
        const resp = await this.networkService._fetchApiJson('/api/ocorrencias', {
          method: 'POST',
          body: corpo,
        });
        if (resp?.domainError) {
          return resp.body || { ok: false, message: 'Não foi possível registrar a ocorrência.' };
        }
        if (resp?.body?.ok && resp.body.ocorrencia) {
          this.ocorrencias = [
            resp.body.ocorrencia,
            ...this.ocorrencias.filter((o) => o.id !== resp.body.ocorrencia.id),
          ];
          await this._salvarCacheLocal();
          return resp.body;
        }
        return resp?.body || { ok: false, message: 'Não foi possível registrar a ocorrência.' };
      } catch {
        /* falha de rede/5xx: cria localmente com o mesmo grafo e enfileira sincronização */
      }
    }

    const state = await this.networkService.ensureReady();
    const criado = criarOcorrencia(corpo, {
      graph: state.graph,
      usuarioId: uid,
      agora,
    });
    if (!criado.ok) return criado;

    this.ocorrencias = [criado.ocorrencia, ...this.ocorrencias];
    await this._salvarCacheLocal();
    this.pendentes.push({ kind: 'create', payload: { ...corpo, id: criado.ocorrencia.id } });
    await this._salvarPendentes();
    return { ...criado, pendenteSincronizacao: true };
  }

  async interagir({ id, tipo, usuarioId, agora = Date.now() } = {}) {
    await this._carregarCacheLocal(agora);
    const uid = usuarioId || (await this.obterOuCriarUsuarioId());
    const corpo = { id, tipo, usuarioId: uid };

    if (this._podeConsultarServidor()) {
      try {
        const resp = await this.networkService._fetchApiJson('/api/ocorrencias/interagir', {
          method: 'POST',
          body: corpo,
        });
        if (resp?.domainError) {
          return {
            ok: false,
            duplicada: resp.status === 409 || resp.body?.duplicada === true,
            ...(resp.body || {}),
          };
        }
        if (resp?.body?.ok && resp.body.ocorrencia) {
          const idx = this.ocorrencias.findIndex((o) => o.id === id);
          const copia = this.ocorrencias.slice();
          if (idx >= 0) copia[idx] = resp.body.ocorrencia;
          else copia.unshift(resp.body.ocorrencia);
          this.ocorrencias = copia;
          await this._salvarCacheLocal();
          return resp.body;
        }
        return resp?.body || { ok: false, message: 'Não foi possível registrar a interação.' };
      } catch {
        /* falha de rede/5xx: aplica localmente e enfileira sincronização */
      }
    }

    const idx = this.ocorrencias.findIndex((o) => o.id === id);
    if (idx < 0) {
      return { ok: false, reason: 'OCORRENCIA_NAO_ENCONTRADA', message: 'Ocorrência não encontrada no cache local.' };
    }
    const res = aplicarInteracao(this.ocorrencias[idx], { tipo, usuarioId: uid, agora });
    if (!res.ok) return res;

    const copia = this.ocorrencias.slice();
    copia[idx] = res.ocorrencia;
    this.ocorrencias = copia;
    await this._salvarCacheLocal();
    this.pendentes.push({ kind: 'interact', payload: corpo });
    await this._salvarPendentes();
    return { ...res, pendenteSincronizacao: true };
  }
}
