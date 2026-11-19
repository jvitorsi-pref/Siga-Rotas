/**
 * campo/contratosBackend.js — Cliente compartilhado do Backend WebForms (`SigaRotasCampo.ashx`)
 * -----------------------------------------------------------------------------------------
 * Tanto a aplicação Web quanto o APK consomem exatamente o mesmo backend WebForms
 * (`SigaRotasCampo.ashx`), que valida o usuário/autorização e aciona a DAL Oracle.
 */

import {
  ENTIDADE_SYNC,
  geojsonParaWkt,
  normalizarGeometriaRota,
  wktParaGeojson,
} from './modeloCampo.js';

export function resolverUrlBackendCampo({
  campoUrl = null,
  apiUrl = null,
  proxyPath = null,
  href = null,
} = {}) {
  const limpar = (v) => (typeof v === 'string' ? v.trim() : '');

  const explicita = limpar(campoUrl);
  if (explicita) {
    return explicita.split('?')[0].replace(/\/+$/, '');
  }

  const baseApi = limpar(apiUrl);
  if (baseApi && /^https?:\/\//i.test(baseApi)) {
    const semQuery = baseApi.split('#')[0].split('?')[0].replace(/\/+$/, '');
    if (/SigaRotasCampo\.ashx$/i.test(semQuery)) return semQuery;
    if (/\/[^/]+\.ashx$/i.test(semQuery)) {
      return semQuery.replace(/\/[^/]+\.ashx$/i, '/SigaRotasCampo.ashx');
    }
    return `${semQuery}/SigaRotasCampo.ashx`;
  }

  const proxy = limpar(proxyPath);
  if (proxy) {
    if (/SigaRotasCampo\.ashx$/i.test(proxy)) return proxy.split('?')[0];
    if (/\/?[^/]+\.ashx$/i.test(proxy)) {
      return proxy.replace(/([^/]+)\.ashx(\?.*)?$/i, 'SigaRotasCampo.ashx');
    }
    return `${proxy.replace(/\/+$/, '')}/SigaRotasCampo.ashx`;
  }

  // Fallback padrão em WebForms iframe (/SigaApp/SigaRotas/public/index.html → ../SigaRotasCampo.ashx)
  const pathAtual = (() => {
    if (href) {
      try {
        return new URL(href).pathname;
      } catch {
        return '/';
      }
    }
    return globalThis?.location?.pathname || '/';
  })();

  if (/\/public(?:\/|$)/i.test(pathAtual)) {
    return '../SigaRotasCampo.ashx';
  }
  return '/SigaRotasCampo.ashx';
}

export function montarUrlAcaoCampo(baseUrl, acao, params = {}) {
  if (!baseUrl) return null;
  const pares = [`acao=${encodeURIComponent(acao)}`];
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    pares.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}${pares.join('&')}`;
}

export function serializarRotaParaEnvio(rota, mapaIdServidorPorCliente = new Map()) {
  const geom = normalizarGeometriaRota(rota?.geometry);
  const wktGeometria = geojsonParaWkt(geom);
  const idRotaOrigemServidor =
    rota.idRotaOrigemServidor ??
    (rota.idRotaOrigemCliente ? mapaIdServidorPorCliente.get(rota.idRotaOrigemCliente) ?? null : null);

  return {
    idCliente: rota.idCliente,
    idServidor: rota.idServidor ?? null,
    tipoRota: rota.tipoRota,
    idRotaOrigemServidor,
    idRotaOrigemCliente: rota.idRotaOrigemCliente || null,
    wktGeometria,
    geometriaGeoJson: geom,
    distanciaMetros: Number(rota.distanciaMetros || 0),
    duracaoSegundos: Number(rota.duracaoSegundos || 0),
    titulo: rota.titulo || null,
    modoCalculo: rota.modoCalculo || null,
    circular: rota.circular !== false,
    pontosJson: Array.isArray(rota.pontosJson) ? JSON.stringify(rota.pontosJson) : null,
    legsJson: Array.isArray(rota.legsJson) ? JSON.stringify(rota.legsJson) : null,
    dataCriacao: rota.dataCriacao,
    dataInicio: rota.dataInicio || null,
    dataFim: rota.dataFim || null,
    dataAtualizacao: rota.dataAtualizacao || rota.dataCriacao,
    versao: Number(rota.versaoLocal || 1),
    status: rota.status,
  };
}

export function serializarObservacaoParaEnvio(obs, operacao = 'CRIAR', mapaIdServidorPorCliente = new Map()) {
  const idRotaServidor =
    obs.idRotaServidor ??
    (obs.idRotaCliente ? mapaIdServidorPorCliente.get(obs.idRotaCliente) ?? null : null);

  return {
    idCliente: obs.idCliente,
    idServidor: obs.idServidor ?? null,
    operacao: operacao === 'ATUALIZAR' || Number(obs.versaoLocal || 1) > 1 ? 'ATUALIZAR' : 'CRIAR',
    idRotaServidor,
    idRotaCliente: obs.idRotaCliente,
    longitude: Number(obs.longitude),
    latitude: Number(obs.latitude),
    descricao: String(obs.descricao || ''),
    tipoObservacao: String(obs.tipoObservacao || 'OUTRO'),
    dataCriacao: obs.dataCriacao,
    dataAtualizacao: obs.dataAtualizacao || obs.dataCriacao,
    versao: Number(obs.versaoLocal || 1),
    status: obs.status,
  };
}

export function serializarEventoParaEnvio(evt, mapaIdServidorPorCliente = new Map()) {
  const idObservacaoServidor =
    evt.idObservacaoServidor ??
    (evt.idObservacaoCliente
      ? mapaIdServidorPorCliente.get(evt.idObservacaoCliente) ?? null
      : null);

  return {
    idCliente: evt.idCliente,
    idObservacaoServidor,
    idObservacaoCliente: evt.idObservacaoCliente,
    tipoEvento: evt.tipoEvento,
    dadosEventoJson: evt.dadosEvento ? JSON.stringify(evt.dadosEvento) : null,
    dataEvento: evt.dataEvento,
  };
}

export function deserializarRotaDoServidor(dto) {
  if (!dto) return null;
  const geom =
    normalizarGeometriaRota(dto.geometriaGeoJson) || wktParaGeojson(dto.wktGeometria);
  let pontosJson = [];
  if (typeof dto.pontosJson === 'string' && dto.pontosJson.trim()) {
    try {
      pontosJson = JSON.parse(dto.pontosJson);
    } catch {
      pontosJson = [];
    }
  } else if (Array.isArray(dto.pontosJson)) {
    pontosJson = dto.pontosJson;
  }

  return {
    idCliente: dto.idCliente,
    idServidor: dto.idServidor ?? null,
    idRotaOrigemCliente: dto.idRotaOrigemCliente || null,
    idRotaOrigemServidor: dto.idRotaOrigemServidor ?? null,
    tipoRota: dto.tipoRota,
    geometry: geom,
    distanciaMetros: Number(dto.distanciaMetros || 0),
    duracaoSegundos: Number(dto.duracaoSegundos || 0),
    titulo: dto.titulo || null,
    modoCalculo: dto.modoCalculo || null,
    circular: dto.circular !== false,
    pontosJson,
    legsJson: [],
    dataCriacao: dto.dataCriacao,
    dataInicio: dto.dataInicio || null,
    dataFim: dto.dataFim || null,
    dataAtualizacao: dto.dataAtualizacao || dto.dataCriacao,
    versaoLocal: Number(dto.versao || 1),
    versaoServidor: Number(dto.versao || 1),
    status: dto.status,
    idUsuario: dto.idUsuario || null,
    simulado: false,
    syncStatus: 'SYNCED',
    syncErro: null,
  };
}

export function criarClienteBackendCampo({
  obterBaseUrl,
  obterHeaders = async () => ({}),
  fetchFn = (...args) => globalThis.fetch(...args),
  timeoutMs = 20000,
} = {}) {
  async function lerJsonSeguro(res) {
    const ct = res.headers?.get?.('content-type') || '';
    const texto = await res.text();
    if (!texto) return null;
    try {
      return JSON.parse(texto);
    } catch {
      if (/<!doctype|<html/i.test(texto) || !ct.includes('json')) {
        return {
          ok: false,
          reason: 'RESPOSTA_NAO_JSON',
          message: 'O servidor retornou conteúdo HTML ou não-JSON (possível redirecionamento de login ou handler ausente).',
        };
      }
      return null;
    }
  }

  async function requisitar(url, init = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    timer?.unref?.();
    try {
      const extraHeaders = (await obterHeaders()) || {};
      const res = await fetchFn(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...extraHeaders,
          ...(init.headers || {}),
        },
        signal: controller?.signal,
      });
      const json = await lerJsonSeguro(res);
      return { status: res.status, ok: res.ok && json?.ok !== false, json };
    } catch (erro) {
      return {
        status: 0,
        ok: false,
        networkError: true,
        json: {
          ok: false,
          reason: erro?.name === 'AbortError' ? 'TIMEOUT' : 'REDE_INDISPONIVEL',
          message: erro?.message || 'Falha de rede ao acessar o backend WebForms.',
        },
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function verificarSaude() {
    const base = await obterBaseUrl();
    if (!base) return { ok: false, reason: 'URL_NAO_CONFIGURADA' };
    const url = montarUrlAcaoCampo(base, 'health');
    const resp = await requisitar(url, { method: 'GET' });
    return { status: resp.status, ...resp.json, ok: resp.ok };
  }

  async function sincronizarLote(payload) {
    const base = await obterBaseUrl();
    if (!base) {
      return {
        ok: false,
        transitorio: true,
        reason: 'URL_NAO_CONFIGURADA',
        message: 'Backend WebForms (SigaRotasCampo.ashx) não configurado.',
      };
    }
    const url = montarUrlAcaoCampo(base, 'sincronizar');
    const resp = await requisitar(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });

    if (resp.networkError || resp.status === 0 || resp.status >= 500 || resp.status === 404) {
      return {
        ok: false,
        transitorio: true,
        status: resp.status,
        reason: resp.json?.reason || 'BACKEND_INDISPONIVEL',
        message: resp.json?.message || `Backend WebForms indisponível (HTTP ${resp.status || 'rede'}).`,
      };
    }
    if (resp.status === 401 || resp.status === 403 || resp.json?.reason === 'RESPOSTA_NAO_JSON') {
      return {
        ok: false,
        transitorio: false,
        status: resp.status,
        reason: resp.json?.reason || 'NAO_AUTENTICADO',
        message: resp.json?.message || 'Autenticação ou permissão necessária no backend WebForms.',
      };
    }
    if (!resp.ok || !resp.json) {
      return {
        ok: false,
        transitorio: resp.status === 501,
        status: resp.status,
        reason: resp.json?.reason || 'ERRO_SERVIDOR',
        message: resp.json?.message || 'Falha ao sincronizar lote com o servidor.',
      };
    }
    return {
      ok: true,
      ...resp.json,
    };
  }

  async function listarRotasServidor({ tipoRota = null, limite = 50 } = {}) {
    const base = await obterBaseUrl();
    if (!base) return { ok: false, rotas: [] };
    const url = montarUrlAcaoCampo(base, 'rotas', { tipoRota, limite });
    const resp = await requisitar(url, { method: 'GET' });
    if (!resp.ok) return { ok: false, reason: resp.json?.reason, rotas: [] };
    return {
      ok: true,
      rotas: Array.isArray(resp.json?.rotas) ? resp.json.rotas.map(deserializarRotaDoServidor).filter(Boolean) : [],
    };
  }

  async function listarObservacoesServidor({ idRota = null, idRotaCliente = null } = {}) {
    const base = await obterBaseUrl();
    if (!base) return { ok: false, observacoes: [] };
    const url = montarUrlAcaoCampo(base, 'observacoes', { idRota, idRotaCliente });
    const resp = await requisitar(url, { method: 'GET' });
    if (!resp.ok) return { ok: false, reason: resp.json?.reason, observacoes: [] };
    return {
      ok: true,
      observacoes: Array.isArray(resp.json?.observacoes) ? resp.json.observacoes : [],
    };
  }

  return {
    verificarSaude,
    sincronizarLote,
    listarRotasServidor,
    listarObservacoesServidor,
    ENTIDADE_SYNC,
  };
}
