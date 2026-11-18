/* ==========================================================================
   public/clienteRede.js — Adaptador de rede e roteamento (Servidor / WebForms)
   --------------------------------------------------------------------------
   Permite que o front-end Web funcione tanto:
     1. conectado ao servidor Node (`server/index.js`) na raiz ou atrás de
        um proxy reverso / `?apiBase=...` (`modo: 'servidor'`); quanto
     2. hospedado diretamente como arquivos estáticos no IIS / ASP.NET
        WebForms dentro de `<iframe>` (`../../SigaApp/SigaRotas/public/index.html`),
        carregando `../data/network.snapshot.json` (ou um proxy WFS opcional
        `?wfsProxy=...`) e executando os módulos puros de `../core/` no
        próprio navegador (`modo: 'cliente'`), sem alterar uma linha do motor.
   ========================================================================== */

import { buildGraph } from '../core/graph.js';
import { calcularRotaComParadas } from '../core/rotaParadas.js';
import { routeOnGraph } from '../core/router.js';
import { criarServicoEnderecoDigital, MODOS } from '../core/enderecoDigitalService.js';
import { fetchNetwork } from '../core/wfs.js';
import { LAYER_NAME } from '../core/config.js';

function limparTexto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

function removerBarraFinal(url) {
  return url.replace(/\/+$/, '');
}

function normalizarModo(valor) {
  const v = limparTexto(valor).toLowerCase();
  if (v === 'cliente' || v === 'local' || v === 'estatico') return 'cliente';
  if (v === 'servidor' || v === 'api' || v === 'node') return 'servidor';
  return '';
}

/**
 * Lê parâmetros opcionais de integração a partir de opções explícitas,
 * querystring (`?apiBase=`, `?wfsProxy=`, `?snapshotUrl=`, `?modo=`) e
 * `window.__SIGA_CONFIG__`.
 */
export function detectarConfiguracaoAmbiente(
  opcoes = {},
  loc = globalThis.location,
  globalConfig = globalThis.__SIGA_CONFIG__,
) {
  const params = loc?.search ? new URLSearchParams(loc.search) : null;
  const g = globalConfig && typeof globalConfig === 'object' ? globalConfig : {};

  const apiBase = removerBarraFinal(
    limparTexto(opcoes.apiBase) ||
      limparTexto(params?.get('apiBase')) ||
      limparTexto(g.apiBase),
  );
  const wfsProxy =
    limparTexto(opcoes.wfsProxy) ||
    limparTexto(params?.get('wfsProxy')) ||
    limparTexto(g.wfsProxy);
  const snapshotUrl =
    limparTexto(opcoes.snapshotUrl) ||
    limparTexto(params?.get('snapshotUrl')) ||
    limparTexto(g.snapshotUrl);

  let modo =
    normalizarModo(opcoes.modo) ||
    normalizarModo(params?.get('modo')) ||
    (params?.get('local') === '1' ? 'cliente' : '') ||
    normalizarModo(g.modo);

  if (!modo && apiBase) modo = 'servidor';

  const pathname = typeof loc?.pathname === 'string' ? loc.pathname : '/';
  const href = typeof loc?.href === 'string' ? loc.href : 'http://localhost/';

  return {
    apiBase,
    wfsProxy,
    snapshotUrl,
    modo,
    pathname,
    href,
  };
}

function calcularPrefixoRelativo(pathname) {
  if (!pathname || pathname === '/') return '';
  if (pathname.endsWith('/')) return removerBarraFinal(pathname);
  const ultimo = pathname.lastIndexOf('/');
  return ultimo <= 0 ? '' : pathname.slice(0, ultimo);
}

function juntarPrefixo(prefixo, caminhoApi) {
  const p = prefixo ? removerBarraFinal(prefixo) : '';
  return p + caminhoApi;
}

function resolverUrlAbsoluta(destino, baseHref) {
  try {
    return new URL(destino, baseHref || 'http://localhost/').href;
  } catch {
    return destino;
  }
}

function parsePoint(raw) {
  if (!raw) return null;
  const parts = String(raw).split(',').map(Number);
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  return { lon: parts[0], lat: parts[1] };
}

function respostaJson(status, payload) {
  let textoCache = null;
  const serializar = () => {
    if (textoCache === null) textoCache = JSON.stringify(payload);
    return textoCache;
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (nome) =>
        String(nome).toLowerCase() === 'content-type'
          ? 'application/json; charset=utf-8'
          : null,
    },
    async json() {
      return payload;
    },
    async text() {
      return serializar();
    },
  };
}

function analisarUrl(url, baseHref) {
  const texto = String(url || '');
  try {
    const parsed = new URL(texto, baseHref || 'http://localhost/');
    return { pathname: parsed.pathname, search: parsed.search, searchParams: parsed.searchParams };
  } catch {
    const [semHash] = texto.split('#');
    const idx = semHash.indexOf('?');
    const pathname = idx >= 0 ? semHash.slice(0, idx) : semHash;
    const search = idx >= 0 ? semHash.slice(idx) : '';
    return { pathname, search, searchParams: new URLSearchParams(search) };
  }
}

function ehCaminhoPublicoEstatico(pathname) {
  return /\/public(?:\/|$)/i.test(pathname || '');
}

/**
 * Cria o cliente unificado de rede/API para o front-end Web.
 */
export function criarClienteRede(opcoes = {}) {
  const cfg = detectarConfiguracaoAmbiente(
    opcoes,
    opcoes.location ?? globalThis.location,
    opcoes.globalConfig ?? globalThis.__SIGA_CONFIG__,
  );
  const fetchFn =
    opcoes.fetchImpl ||
    (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);

  let promessaModo = null;
  let promessaRede = null;
  let estadoRede = null;

  async function resolverModo() {
    if (promessaModo) return promessaModo;
    promessaModo = (async () => {
      if (cfg.modo === 'cliente') {
        return { modo: 'cliente', apiPrefix: '' };
      }
      if (cfg.apiBase) {
        return { modo: 'servidor', apiPrefix: cfg.apiBase };
      }
      const prefixo = calcularPrefixoRelativo(cfg.pathname);
      if (cfg.modo === 'servidor') {
        return { modo: 'servidor', apiPrefix: prefixo };
      }
      if (ehCaminhoPublicoEstatico(cfg.pathname) || cfg.href.startsWith('file:')) {
        return { modo: 'cliente', apiPrefix: '' };
      }
      if (!fetchFn) {
        return { modo: 'cliente', apiPrefix: '' };
      }
      try {
        const res = await fetchFn(juntarPrefixo(prefixo, '/api/health'), {
          headers: { Accept: 'application/json' },
        });
        const ct = res.headers?.get?.('content-type') || '';
        if (res.ok && /json/i.test(ct)) {
          const body = await res.json();
          if (body && typeof body === 'object' && 'ready' in body) {
            return { modo: 'servidor', apiPrefix: prefixo };
          }
        }
      } catch {
        // Servidor Node ausente neste endereço: cai para o modo cliente estático.
      }
      return { modo: 'cliente', apiPrefix: '' };
    })();
    return promessaModo;
  }

  async function carregarSnapshot(avisosIniciais = []) {
    if (!fetchFn) {
      throw new Error('fetch indisponível para carregar o snapshot da rede.');
    }
    const candidatos = cfg.snapshotUrl
      ? [cfg.snapshotUrl]
      : ehCaminhoPublicoEstatico(cfg.pathname)
        ? ['../data/network.snapshot.json']
        : ['../data/network.snapshot.json', 'data/network.snapshot.json'];

    let ultimaFalha = null;
    for (const rel of candidatos) {
      const alvo = resolverUrlAbsoluta(rel, cfg.href);
      try {
        const res = await fetchFn(alvo);
        if (!res.ok) {
          ultimaFalha = new Error(
            `HTTP ${res.status} ao carregar ${rel}. Se estiver no IIS, verifique o web.config (MIME .json).`,
          );
          continue;
        }
        const snap = await res.json();
        if (!snap || !Array.isArray(snap.features) || snap.features.length === 0) {
          ultimaFalha = new Error(`Snapshot inválido ou vazio em ${rel}.`);
          continue;
        }
        const t0 = Date.now();
        const graph = buildGraph(snap.features, opcoes.graphOptions);
        const elapsedMs = Date.now() - t0;
        const warnings = [...avisosIniciais, ...(Array.isArray(snap.warnings) ? snap.warnings : [])];
        return {
          graph,
          features: snap.features,
          diagnostics: graph.diagnostics,
          source: snap.source || 'snapshot',
          strategy: snap.strategy || 'snapshot',
          builtAt: Date.now(),
          elapsedMs,
          serverTotal: snap.serverTotal ?? snap.features.length,
          attributes: Array.isArray(snap.attributes) ? snap.attributes : [],
          warnings,
        };
      } catch (err) {
        ultimaFalha = err;
      }
    }
    throw ultimaFalha || new Error('Não foi possível carregar o snapshot local da rede.');
  }

  async function garantirRede() {
    if (estadoRede) return estadoRede;
    if (promessaRede) return promessaRede;

    promessaRede = (async () => {
      const avisos = [];
      if (cfg.wfsProxy && fetchFn) {
        try {
          const proxyAbsoluto = resolverUrlAbsoluta(cfg.wfsProxy, cfg.href);
          const wfsRes = await fetchNetwork({
            baseUrl: proxyAbsoluto,
            typeName: LAYER_NAME,
            fetchImpl: fetchFn,
          });
          if (wfsRes && Array.isArray(wfsRes.features) && wfsRes.features.length > 0) {
            const t0 = Date.now();
            const graph = buildGraph(wfsRes.features, opcoes.graphOptions);
            estadoRede = {
              graph,
              features: wfsRes.features,
              diagnostics: graph.diagnostics,
              source: 'wfs',
              strategy: wfsRes.strategy || 'wfs',
              builtAt: Date.now(),
              elapsedMs: Date.now() - t0,
              serverTotal: wfsRes.serverTotal ?? wfsRes.features.length,
              attributes: wfsRes.attributes || [],
              warnings: Array.isArray(wfsRes.warnings) ? wfsRes.warnings : [],
            };
            return estadoRede;
          }
        } catch (err) {
          avisos.push(
            `Proxy WFS indisponível (${err.message}); utilizando snapshot local da rede.`,
          );
        }
      }

      estadoRede = await carregarSnapshot(avisos);
      return estadoRede;
    })();

    try {
      return await promessaRede;
    } catch (err) {
      promessaRede = null;
      throw err;
    }
  }

  function lerCorpo(init) {
    if (!init || init.body == null) return null;
    if (typeof init.body === 'string') {
      try {
        return JSON.parse(init.body);
      } catch {
        return { __jsonInvalido: true };
      }
    }
    if (typeof init.body === 'object') return init.body;
    return null;
  }

  async function atenderLocalmente(pathname, searchParams, init) {
    const corpo = lerCorpo(init);
    if (corpo && corpo.__jsonInvalido) {
      return respostaJson(400, {
        ok: false,
        reason: 'JSON_INVALIDO',
        message: 'O corpo da requisição não é um JSON válido.',
      });
    }

    if (pathname === '/api/health') {
      return respostaJson(200, {
        ready: !!estadoRede,
        loading: !!promessaRede && !estadoRede,
        mode: 'cliente',
        update: { enabled: false },
      });
    }

    if (pathname === '/api/endereco-digital') {
      const codigo = corpo?.codigo ?? searchParams.get('codigo') ?? '';
      const modo = corpo?.modo ?? searchParams.get('modo') ?? MODOS.LOCAL;
      const servico = criarServicoEnderecoDigital({ modo });
      const resultado = await servico.resolver(codigo);
      return respostaJson(resultado.ok ? 200 : 422, {
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
      });
    }

    if (pathname === '/api/network') {
      const rede = await garantirRede();
      const iso = new Date(rede.builtAt).toISOString();
      return respostaJson(200, {
        type: 'FeatureCollection',
        features: rede.features,
        meta: {
          source: rede.source,
          strategy: rede.strategy,
          builtAt: iso,
          features: rede.features.length,
          attributes: rede.attributes,
          warnings: rede.warnings,
          update: {
            enabled: false,
            lastCheckedAt: iso,
            lastChangeAt: null,
            lastResult: null,
            errors: [],
          },
        },
      });
    }

    if (pathname === '/api/diagnostics') {
      const rede = await garantirRede();
      return respostaJson(200, {
        ...rede.diagnostics,
        source: rede.source,
        strategy: rede.strategy,
        builtAt: new Date(rede.builtAt).toISOString(),
        buildMs: rede.elapsedMs,
        serverTotal: rede.serverTotal,
        attributes: rede.attributes,
      });
    }

    if (pathname === '/api/route') {
      const origin = parsePoint(searchParams.get('origin'));
      const destination = parsePoint(searchParams.get('destination'));
      if (!origin || !destination) {
        return respostaJson(400, {
          ok: false,
          reason: 'PARAMETROS_INVALIDOS',
          message:
            'Informe origem e destino no formato "longitude,latitude" ' +
            '(ex.: -46.5450,-23.6600).',
        });
      }
      const rede = await garantirRede();
      const result = routeOnGraph(rede.graph, origin, destination, {
        maxSnapDistance: opcoes.maxSnapDistance ?? 100,
      });
      return respostaJson(result.ok ? 200 : 422, result);
    }

    if (pathname === '/api/rota-paradas') {
      let pontos = corpo?.pontos;
      if (!pontos && searchParams.get('pontos')) {
        try {
          pontos = JSON.parse(searchParams.get('pontos'));
        } catch {
          pontos = null;
        }
      }
      if (!Array.isArray(pontos) || pontos.length < 2) {
        return respostaJson(400, {
          ok: false,
          reason: 'PARAMETROS_INVALIDOS',
          message:
            'Informe ao menos dois pontos no formato ' +
            '[{"rotulo":"A","latitude":-23.66,"longitude":-46.53}, ...].',
        });
      }
      const rede = await garantirRede();
      const modo = String(corpo?.modo ?? searchParams.get('modo') ?? 'usuario');
      const circularRaw = corpo?.circular ?? searchParams.get('circular') ?? false;
      const circular = circularRaw === true || circularRaw === 'true';
      const resultado = calcularRotaComParadas(rede.graph, pontos, {
        maxSnapDistance: opcoes.maxSnapDistance ?? 100,
        modo:
          modo === 'otimizada'
            ? 'otimizada'
            : modo === 'saida_curta'
              ? 'saida_curta'
              : 'usuario',
        circular,
      });
      return respostaJson(resultado.ok ? 200 : 422, resultado);
    }

    return respostaJson(404, { ok: false, error: 'Endpoint desconhecido.' });
  }

  async function fetchApi(url, init) {
    const { pathname, search, searchParams } = analisarUrl(url, cfg.href);
    const ehApi = pathname === '/api' || pathname.startsWith('/api/');
    if (!ehApi) {
      if (!fetchFn) throw new Error('fetch indisponível no ambiente atual.');
      return fetchFn(url, init);
    }

    const resolucao = await resolverModo();
    if (resolucao.modo === 'servidor') {
      if (!fetchFn) throw new Error('fetch indisponível para acessar o servidor.');
      const destino = juntarPrefixo(resolucao.apiPrefix, pathname + search);
      return fetchFn(destino, init);
    }

    return atenderLocalmente(pathname, searchParams, init);
  }

  return {
    config: cfg,
    resolverModo,
    garantirRede,
    fetchApi,
  };
}
