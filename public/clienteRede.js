/* ==========================================================================
   public/clienteRede.js — Adaptador de rede e roteamento (Servidor / WebForms)
   --------------------------------------------------------------------------
   Centraliza o consumo da API Node.js (`server/index.js`) como caminho
   principal em todos os cenários Web:
     1. aplicação servida diretamente pelo Node.js (na raiz `/` ou atrás de
        proxy reverso em subcaminho);
     2. aplicação incorporada no ASP.NET WebForms em `<iframe>`
        (`../../SigaApp/SigaRotas/public/index.html`), utilizando
        `?apiBase=...` ou o handler proxy de mesma origem `../ApiProxy.ashx`
        (sem exigir ARR/URL Rewrite no IIS e sem rodar o grafo no navegador).

   Contingência local no navegador (`modo: 'cliente'` com `core/` e snapshot)
   permanece DESATIVADA por padrão e só é acionada mediante habilitação
   explícita (`?modo=cliente`, `?fallback=local` ou `allowLocalFallback: true`).
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

function ehCaminhoPublicoEstatico(pathname) {
  return /\/public(?:\/|$)/i.test(pathname || '');
}

function lerBooleano(valor) {
  if (valor === true || valor === 1) return true;
  if (typeof valor === 'string') {
    const v = valor.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'sim' || v === 'local';
  }
  return false;
}

/**
 * Lê parâmetros de integração a partir de opções explícitas, querystring
 * (`?apiBase=`, `?apiProxy=`, `?wfsProxy=`, `?snapshotUrl=`, `?modo=`,
 * `?fallback=local`) e `window.__SIGA_CONFIG__`.
 */
export function detectarConfiguracaoAmbiente(
  opcoes = {},
  loc = globalThis.location,
  globalConfig = globalThis.__SIGA_CONFIG__,
) {
  let locResolvido = loc;
  if (!locResolvido && typeof opcoes.href === 'string' && opcoes.href) {
    try {
      locResolvido = new URL(opcoes.href);
    } catch {
      locResolvido = null;
    }
  }
  const params = locResolvido?.search ? new URLSearchParams(locResolvido.search) : null;
  const g = globalConfig && typeof globalConfig === 'object' ? globalConfig : {};
  const pathname = typeof locResolvido?.pathname === 'string' ? locResolvido.pathname : '/';
  const href =
    typeof opcoes.href === 'string' && opcoes.href
      ? opcoes.href
      : typeof locResolvido?.href === 'string'
        ? locResolvido.href
        : 'http://localhost/';

  const apiBase = removerBarraFinal(
    limparTexto(opcoes.apiBase) ||
      limparTexto(params?.get('apiBase')) ||
      limparTexto(g.apiBase),
  );

  const proxyPath =
    opcoes.proxyPath !== undefined
      ? limparTexto(opcoes.proxyPath)
      : limparTexto(params?.get('apiProxy') ?? params?.get('proxyPath')) ||
        (typeof g.proxyPath === 'string'
          ? limparTexto(g.proxyPath)
          : ehCaminhoPublicoEstatico(pathname)
            ? '../ApiProxy.ashx'
            : '');

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
    (params?.get('local') === '1' || params?.get('fallback') === 'local' ? 'cliente' : '') ||
    normalizarModo(g.modo);

  if (!modo && apiBase) modo = 'servidor';

  const allowLocalFallback = Boolean(
    opcoes.allowLocalFallback === true ||
      modo === 'cliente' ||
      lerBooleano(params?.get('fallback')) ||
      lerBooleano(params?.get('local')) ||
      lerBooleano(g.allowLocalFallback),
  );

  return {
    apiBase,
    proxyPath,
    wfsProxy,
    snapshotUrl,
    allowLocalFallback,
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

function montarUrlProxyAshx(proxyUrl, pathname, search = '') {
  const baseLimpa = String(proxyUrl || '').split('?')[0];
  const qs = new URLSearchParams(search || '');
  qs.set('endpoint', pathname);
  return `${baseLimpa}?${qs.toString()}`;
}

function montarDestinoServidor(resolucao, pathname, search = '') {
  if (resolucao.transport === 'ashx') {
    return montarUrlProxyAshx(resolucao.apiPrefix, pathname, search);
  }
  return juntarPrefixo(resolucao.apiPrefix, pathname + search);
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

  const snapshotModuleLoader =
    opcoes.snapshotModuleLoader ||
    (() => import('./network.snapshot.js'));

  let promessaModo = null;
  let promessaRede = null;
  let estadoRede = null;

  function construirEstadoSnapshot(snap, avisosIniciais = []) {
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
  }

  async function lerSnapshotJson(res, rel, alvo) {
    const ct = res.headers?.get?.('content-type') || '';
    if (typeof res.text === 'function') {
      const bruto = await res.text();
      const limpo = bruto.trimStart();
      if (limpo.startsWith('<')) {
        const titulo = limpo.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
        throw new Error(
          `${rel} (${res.url || alvo}) devolveu HTML (${ct || 'text/html'}` +
            `${titulo ? `: "${titulo}"` : ''}) em vez de JSON.`,
        );
      }
      return JSON.parse(bruto);
    }
    return res.json();
  }

  async function sondarHealth(destino) {
    if (!fetchFn) return false;
    try {
      const res = await fetchFn(destino, {
        headers: { Accept: 'application/json' },
      });
      const ct = res.headers?.get?.('content-type') || '';
      if (res.ok && /json/i.test(ct)) {
        const body = await res.json();
        if (body && typeof body === 'object' && 'ready' in body) {
          return true;
        }
      }
    } catch {
      /* servidor ou proxy indisponível neste destino */
    }
    return false;
  }

  async function resolverModo() {
    if (promessaModo) return promessaModo;
    promessaModo = (async () => {
      if (cfg.modo === 'cliente') {
        return {
          modo: 'cliente',
          apiPrefix: '',
          transport: 'local',
          fallbackReason: 'Modo de contingência local no navegador habilitado explicitamente.',
        };
      }
      if (cfg.apiBase) {
        return { modo: 'servidor', apiPrefix: cfg.apiBase, transport: 'http' };
      }

      const prefixo = calcularPrefixoRelativo(cfg.pathname);
      if (cfg.modo === 'servidor') {
        return { modo: 'servidor', apiPrefix: prefixo, transport: 'http' };
      }

      if (fetchFn && !cfg.href.startsWith('file:')) {
        // 1. Dentro de `/public/` (ex.: iframe WebForms `../../SigaApp/SigaRotas/public/index.html`):
        //    sonda primeiro o proxy ASP.NET de mesma origem (`../ApiProxy.ashx`) e, em seguida,
        //    eventual proxy reverso na pasta pai (`../api/health`).
        if (ehCaminhoPublicoEstatico(cfg.pathname)) {
          if (cfg.proxyPath) {
            const proxyAbs = resolverUrlAbsoluta(cfg.proxyPath, cfg.href);
            const okProxy = await sondarHealth(montarUrlProxyAshx(proxyAbs, '/api/health'));
            if (okProxy) {
              return { modo: 'servidor', apiPrefix: proxyAbs, transport: 'ashx' };
            }
          }
          const prefixoPai = prefixo.replace(/\/public$/i, '');
          const okPai = await sondarHealth(juntarPrefixo(prefixoPai, '/api/health'));
          if (okPai) {
            return { modo: 'servidor', apiPrefix: prefixoPai, transport: 'http' };
          }
        } else {
          // 2. Aplicação servida na raiz (`/`) ou subcaminho com proxy reverso Node
          const okDireto = await sondarHealth(juntarPrefixo(prefixo, '/api/health'));
          if (okDireto) {
            return { modo: 'servidor', apiPrefix: prefixo, transport: 'http' };
          }
        }
      }

      // 3. Backend Node.js indisponível: fallback local só ocorre quando explicitamente autorizado
      if (cfg.allowLocalFallback) {
        return {
          modo: 'cliente',
          apiPrefix: '',
          transport: 'local',
          fallbackReason: 'API Node.js indisponível; contingência local no navegador ativada.',
        };
      }

      return {
        modo: 'indisponivel',
        apiPrefix: '',
        transport: 'none',
        reason:
          'API Node.js centralizada indisponível neste endereço. ' +
          'Verifique se o servidor Node.js e o proxy ApiProxy.ashx estão ativos.',
      };
    })();
    return promessaModo;
  }

  async function carregarSnapshot(avisosIniciais = []) {
    const candidatos = cfg.snapshotUrl
      ? [cfg.snapshotUrl]
      : ehCaminhoPublicoEstatico(cfg.pathname)
        ? ['../data/network.snapshot.json']
        : ['../data/network.snapshot.json', 'data/network.snapshot.json'];

    let ultimaFalha = null;
    if (fetchFn) {
      for (const rel of candidatos) {
        const alvo = resolverUrlAbsoluta(rel, cfg.href);
        try {
          const res = await fetchFn(alvo);
          if (!res.ok) {
            ultimaFalha = new Error(
              `HTTP ${res.status} ao carregar ${rel} (${res.url || alvo}).`,
            );
            continue;
          }
          const snap = await lerSnapshotJson(res, rel, alvo);
          if (!snap || !Array.isArray(snap.features) || snap.features.length === 0) {
            ultimaFalha = new Error(`Snapshot inválido ou vazio em ${rel}.`);
            continue;
          }
          return construirEstadoSnapshot(snap, avisosIniciais);
        } catch (err) {
          ultimaFalha = err;
        }
      }
    }

    if (!cfg.snapshotUrl && typeof snapshotModuleLoader === 'function') {
      try {
        const mod = await snapshotModuleLoader();
        const snap = mod?.default || mod;
        if (snap && Array.isArray(snap.features) && snap.features.length > 0) {
          return construirEstadoSnapshot(snap, avisosIniciais);
        }
      } catch (err) {
        ultimaFalha = ultimaFalha || err;
      }
    }

    throw ultimaFalha || new Error('Não foi possível carregar o snapshot local da rede.');
  }

  async function garantirRede(avisoModo = null) {
    if (estadoRede) return estadoRede;
    if (promessaRede) return promessaRede;

    promessaRede = (async () => {
      const avisos = [];
      if (avisoModo) avisos.push(avisoModo);
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
              warnings: [...avisos, ...(Array.isArray(wfsRes.warnings) ? wfsRes.warnings : [])],
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

  async function atenderLocalmente(pathname, searchParams, init, resolucao) {
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
        originMode: estadoRede?.source || 'snapshot',
        fallbackActive: true,
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
      const rede = await garantirRede(resolucao?.fallbackReason || null);
      const iso = new Date(rede.builtAt).toISOString();
      return respostaJson(200, {
        type: 'FeatureCollection',
        features: rede.features,
        meta: {
          source: rede.source,
          originMode: rede.source,
          fallbackActive: true,
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
      const rede = await garantirRede(resolucao?.fallbackReason || null);
      return respostaJson(200, {
        ...rede.diagnostics,
        source: rede.source,
        originMode: rede.source,
        fallbackActive: true,
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
      const rede = await garantirRede(resolucao?.fallbackReason || null);
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
      const rede = await garantirRede(resolucao?.fallbackReason || null);
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
      const destino = montarDestinoServidor(resolucao, pathname, search);
      return fetchFn(destino, init);
    }

    if (resolucao.modo === 'indisponivel') {
      return respostaJson(503, {
        ok: false,
        reason: 'API_INDISPONIVEL',
        message: resolucao.reason,
      });
    }

    return atenderLocalmente(pathname, searchParams, init, resolucao);
  }

  return {
    config: cfg,
    resolverModo,
    garantirRede,
    fetchApi,
  };
}
