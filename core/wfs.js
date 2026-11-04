/**
 * CLIENTE WFS — GeoServer da Prefeitura de Santo André
 * ====================================================
 *
 * Este módulo encapsula TODA a comunicação com o WFS, com três
 * responsabilidades:
 *
 *  1. DESCARTAR SUPOSTAS. Nada aqui presume nomes de atributos ou o
 *     comportamento do servidor: a camada é inspecionada em tempo de
 *     execução (DescribeFeatureType + amostra de GeoJSON) e o que for
 *     encontrado é devolvido como diagnóstico.
 *
 *  2. PAGINAÇÃO ROBUSTA. A estratégia padrão do GeoServer (`startIndex`)
 *     NÃO funciona nesta camada — ver `STRATEGIAS DE PAGINAÇÃO` abaixo.
 *
 *  3. TRATAMENTO DE FALHAS. Timeout, erro HTTP, resposta não-JSON,
 *     `ServiceException` do OGC e instabilidade transitória são tratados
 *     com retentativas e mensagens explícitas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTRATÉGIAS DE PAGINAÇÃO (medidas nesta camada em 20/10/2026)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  A) `startIndex` — COMO FUNCIONA, MAS QUEBRA NESTA CAMADA.
 *     O GeoServer responde:
 *       java.io.IOException: Cannot do natural order without a primary key,
 *       please add it or specify a manual sort over existing attributes
 *     A camada `SIGA_EIXO_LOG_OFICIAL_E_NAO` é uma view SQL sem chave
 *     primária exposta, então a paginação por deslocamento é impossível.
 *     → Detectada e tratada: o cliente cai automaticamente para a
 *       estratégia C.
 *
 *  B) `BBOX` (filtro espacial) — QUEBRADO NESTA CAMADA.
 *     tanto na forma KVP (`&bbox=minLon,minLat,maxLon,maxLat`) quanto na
 *     forma XML (`<Filter><BBOX>...`) retornam `numberMatched = 0`,
 *     embora a janela contenha feições. Não é usado.
 *
 *  C) `CQL_FILTER` por faixa de `ID` — FUNCIONA. ✔
 *     `CQL_FILTER=ID>=1 AND ID<1001` devolve exatamente as feições cujo ID
 *     está na faixa. A camada publica `ID` (decimal) como atributo real,
 *     então a filtragem é feita no banco.
 *     Validação: 5 janelas cobrem [1, 4165) e devolvem exatamente as
 *     4.119 feições — idêntico ao conjunto obtido numa requisição única.
 *     Observação: o operador `IN` NÃO é suportado por este servidor
 *     (`ID IN (1,2,3)` devolve 0 feições) — por isso a paginação é feita
 *     por FAIXAS e não por lista.
 *
 *  D) Requisição única com `maxFeatures` alto — FUNCIONA. ✔
 *     4.119 feições em ~3 s / 2,6 MB. É a estratégia preferida enquanto o
 *     total couber no limite do servidor.
 *
 * Ordem de tentativa: D → A → C.
 */

import { WFS_BASE_URL, LAYER_NAME, WFS_DEFAULTS, KNOWN_ATTRIBUTES } from './config.js';

/** Erro de comunicação com o WFS, com contexto suficiente para diagnóstico. */
export class WfsError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'WfsError';
    this.status = details.status ?? null;
    this.url = details.url ?? null;
    this.body = details.body ?? null;
    this.cause = details.cause ?? null;
  }
}

/**
 * Executa uma requisição HTTP com timeout e retentativas.
 *
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<{text: string, status: number, contentType: string}>}
 */
async function httpGet(url, options = {}) {
  const {
    timeout = WFS_DEFAULTS.requestTimeout,
    maxRetries = WFS_DEFAULTS.maxRetries,
    retryBackoff = WFS_DEFAULTS.retryBackoff,
    fetchImpl = globalThis.fetch,
  } = options;

  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json, text/xml;q=0.9, */*;q=0.8' },
      });
      const text = await res.text();
      if (!res.ok) {
        // 4xx não é transitório (exceto 429): não insistir.
        const retryable = res.status === 429 || res.status >= 500;
        lastError = new WfsError(`WFS respondeu HTTP ${res.status}`, {
          status: res.status,
          url,
          body: text.slice(0, 800),
        });
        if (!retryable) throw lastError; // erro permanente: falha na hora
        if (attempt === maxRetries) throw lastError;
      } else {
        return {
          text,
          status: res.status,
          contentType: res.headers.get('content-type') || '',
        };
      }
    } catch (err) {
      if (err instanceof WfsError) {
        lastError = err;
        // erros permanentes (4xx) ja foram lancados acima e nao sao repetidos
        if (err.status && err.status < 500 && err.status !== 429) throw err;
        if (attempt === maxRetries) throw err;
      } else {
        const aborted = err?.name === 'AbortError';
        lastError = new WfsError(
          aborted
            ? `Tempo esgotado (${timeout} ms) ao consultar o WFS`
            : `Falha de comunicação com o WFS: ${err?.message || err}`,
          { url, cause: err }
        );
        if (attempt === maxRetries) throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }
    // backoff exponencial
    await new Promise((r) => setTimeout(r, retryBackoff * attempt));
  }
  throw lastError || new WfsError('Falha desconhecida ao consultar o WFS', { url });
}

/** Constrói a URL da requisição WFS. */
function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Detecta `ServiceException` do OGC em respostas XML/texto.
 * @returns {null|{code:string, message:string}}
 */
export function parseServiceException(text) {
  if (!text) return null;
  if (!/<ServiceException|ows:Exception|ExceptionReport/i.test(text)) return null;
  const code = text.match(/exceptionCode="([^"]+)"/i)?.[1] || 'ServiceException';
  const message =
    text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600) || 'Erro devolvido pelo serviço WFS.';
  return { code, message };
}

/**
 * Valida e converte a resposta do WFS em uma FeatureCollection.
 * @returns {{collection: object, warnings: string[]}}
 */
function parseGeoJson(text, url) {
  const warnings = [];
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    const svc = parseServiceException(text);
    if (svc) {
      throw new WfsError(`O WFS devolviu uma exceção: ${svc.message}`, {
        url,
        body: text.slice(0, 800),
      });
    }
    throw new WfsError('O WFS não devolveu JSON válido.', { url, body: text.slice(0, 400) });
  }

  if (!json || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
    const svc = parseServiceException(text);
    throw new WfsError(
      svc
        ? `O WFS devolvou uma exceção: ${svc.message}`
        : 'A resposta do WFS não é uma FeatureCollection GeoJSON.',
      { url, body: text.slice(0, 400) }
    );
  }

  // Validação de integridade das feições
  let invalid = 0;
  let withoutGeometry = 0;
  for (const f of json.features) {
    if (!f || typeof f !== 'object') {
      invalid++;
      continue;
    }
    if (!f.geometry || !f.geometry.type || !Array.isArray(f.geometry.coordinates)) {
      withoutGeometry++;
    }
  }
  if (invalid > 0) warnings.push(`${invalid} feições com estrutura inválida foram descartadas.`);
  if (withoutGeometry > 0) {
    warnings.push(`${withoutGeometry} feições sem geometria utilizável foram ignoradas.`);
  }

  return { collection: json, warnings };
}

/**
 * Busca uma página de feições.
 * @returns {Promise<{features:Array, total:number|null, warnings:string[]}>}
 */
async function fetchPage(params, options) {
  const url = buildUrl(options.baseUrl || WFS_BASE_URL, params);
  const { text } = await httpGet(url, options);
  const { collection, warnings } = parseGeoJson(text, url);
  const total =
    typeof collection.totalFeatures === 'number'
      ? collection.totalFeatures
      : typeof collection.numberMatched === 'number'
        ? collection.numberMatched
        : null;
  return { features: collection.features, total, warnings, url };
}

/**
 * Carrega a rede viária completa da camada.
 *
 * @param {object} [options]
 * @returns {Promise<{
 *   features: Array, total: number, strategy: string, pages: number,
 *   elapsedMs: number, warnings: string[], serverTotal: number|null,
 *   attributes: string[]
 * }>}
 */
export async function fetchNetwork(options = {}) {
  const opts = { ...WFS_DEFAULTS, ...options };
  const started = Date.now();
  const warnings = [];

  const baseParams = {
    service: 'WFS',
    version: '1.0.0',
    request: 'GetFeature',
    typeName: opts.typeName || LAYER_NAME,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
  };

  // ── ETAPA 1: uma requisição com maxFeatures alto ────────────────────────
  const first = await fetchPage(
    { ...baseParams, maxFeatures: opts.maxFeaturesPerRequest },
    opts
  );
  warnings.push(...first.warnings);

  const serverTotal = first.total;
  const collected = new Map();
  const put = (f) => {
    const id = f?.properties?.ID ?? `fid:${collected.size}`;
    if (!collected.has(id)) collected.set(id, f);
  };
  first.features.forEach(put);

  let strategy = 'single';
  let pages = 1;

  const complete = (total) => total !== null && collected.size >= total;

  if (!complete(serverTotal) && serverTotal !== null && serverTotal > first.features.length) {
    // ── ETAPA 2: paginação por startIndex ────────────────────────────────
    let startIndexBroken = false;
    try {
      let start = first.features.length;
      while (collected.size < serverTotal) {
        const page = await fetchPage(
          { ...baseParams, maxFeatures: opts.pageSize, startIndex: start },
          opts
        );
        if (page.features.length === 0) break;
        page.features.forEach(put);
        pages++;
        start += page.features.length;
        if (page.features.length < opts.pageSize) break;
      }
      strategy = 'startIndex';
    } catch (err) {
      const svc = parseServiceException(err.body || '');
      const broken =
        svc &&
        /natural order|primary key|manual sort/i.test(svc.message);
      if (!broken) throw err;
      startIndexBroken = true;
      warnings.push(
        'A paginação por startIndex não é suportada nesta camada (' +
          'a view SQL não expõe chave primária). Foi adotada a paginação por ' +
          'faixa de ID via CQL_FILTER.'
      );
    }

    // ── ETAPA 3: paginação por faixa de ID (CQL_FILTER) ───────────────────
    if (startIndexBroken) {
      const byId = await fetchByIdRanges(baseParams, opts, warnings, serverTotal);
      for (const f of byId.features) put(f);
      pages += byId.pages;
      strategy = 'cql-range';
    }
  }

  const features = Array.from(collected.values());

  // ── Diagnóstico: atributos efetivamente presentes ───────────────────────
  const attributes = new Set();
  for (const f of features) {
    for (const k of Object.keys(f.properties || {})) attributes.add(k);
  }

  if (serverTotal !== null && features.length < serverTotal) {
    warnings.push(
      `Foram obtidas ${features.length} de ${serverTotal} feições declaradas pelo servidor.`
    );
  }

  return {
    features,
    total: features.length,
    serverTotal,
    strategy,
    pages,
    elapsedMs: Date.now() - started,
    warnings,
    attributes: Array.from(attributes).sort(),
  };
}

/**
 * Paginação por faixa de ID usando CQL_FILTER (estratégia C).
 *
 * 1. Lista os IDs da camada com `propertyName=ID` (payload minúsculo).
 *    O limite de `maxFeatures` pode truncar a listagem; nesse caso, é feita
 *    uma varredura por faixas até cobrir o total declarado pelo servidor.
 * 2. Descobre o menor e o maior ID.
 * 3. Divide o intervalo em janelas de `pageSize` IDs e busca cada uma.
 *
 * @returns {Promise<{features:Array, pages:number}>}
 */
async function fetchByIdRanges(baseParams, opts, warnings, serverTotal) {
  // 1) lista de IDs (sem geometria)
  const wanted = Math.max(opts.maxFeaturesPerRequest, serverTotal ?? 0);
  let idPage = await fetchPage(
    { ...baseParams, maxFeatures: wanted, propertyName: 'ID' },
    opts
  );

  let ids = [];
  for (const f of idPage.features) {
    const id = Number(f?.properties?.ID);
    if (Number.isFinite(id)) ids.push(id);
  }

  // A listagem veio truncada (o servidor limitou maxFeatures): faz-se uma
  // varredura por faixas até alcançar o total declarado pelo servidor.
  if (serverTotal && ids.length < serverTotal) {
    warnings.push(
      `A listagem de IDs veio truncada (${ids.length} de ${serverTotal}); ` +
        'iniciando varredura por faixas de ID.'
    );
    ids = await sweepIds(baseParams, opts, serverTotal);
  }

  if (ids.length === 0) {
    warnings.push('Não foi possível obter a lista de IDs para paginação por faixa.');
    return { features: [], pages: 0 };
  }

  const minId = Math.min(...ids);
  const maxId = Math.max(...ids);

  const features = [];
  let pages = 0;

  // 2) janelas de faixa
  const windowSize = Math.max(opts.pageSize, 1);
  for (let lo = minId; lo <= maxId; lo += windowSize) {
    const hi = lo + windowSize;
    const page = await fetchPage(
      {
        ...baseParams,
        maxFeatures: opts.maxFeaturesPerRequest,
        CQL_FILTER: `ID>=${lo} AND ID<${hi}`,
      },
      opts
    );
    pages++;
    features.push(...page.features);
    if (page.features.length === 0) {
      // faixa sem feições: pode ser a última
      if (lo + windowSize > maxId) break;
    }
  }

  return { features, pages };
}

/**
 * Varredura do espaço de IDs por faixas, usada quando a listagem de IDs
 * veio truncada. As lacunas no espaço de IDs são puladas ampliando a janela.
 *
 * @returns {Promise<number[]>} IDs encontrados
 */
async function sweepIds(baseParams, opts, expectedTotal) {
  const found = new Set();
  let lo = 1;
  let window = Math.max(opts.pageSize, 1);
  let emptyWindows = 0;
  let maxSeen = 0;

  while (found.size < expectedTotal && emptyWindows < 4) {
    const hi = lo + window;
    const page = await fetchPage(
      {
        ...baseParams,
        maxFeatures: opts.maxFeaturesPerRequest,
        CQL_FILTER: `ID>=${lo} AND ID<${hi}`,
      },
      opts
    );
    if (page.features.length === 0) {
      emptyWindows++;
      lo = hi;
      window = Math.min(window * 4, 5_000_000);
      continue;
    }
    emptyWindows = 0;
    for (const f of page.features) {
      const id = Number(f?.properties?.ID);
      if (Number.isFinite(id)) {
        found.add(id);
        if (id > maxSeen) maxSeen = id;
      }
    }
    lo = hi;
    // se a janela passou do maior ID visto e não trouxe nada novo, para
    if (lo > maxSeen + window) break;
  }
  return Array.from(found).sort((a, b) => a - b);
}

/**
 * Inspeciona a camada via DescribeFeatureType e devolve os atributos
 * publicados (sem presumir nomes).
 *
 * @param {object} [options]
 * @returns {Promise<{attributes:Array<{name:string,type:string,nillable:boolean}>, raw:string}>}
 */
export async function describeLayer(options = {}) {
  const opts = { ...WFS_DEFAULTS, ...options };
  const url = buildUrl(opts.baseUrl || WFS_BASE_URL, {
    service: 'WFS',
    version: '1.0.0',
    request: 'DescribeFeatureType',
    typeName: opts.typeName || LAYER_NAME,
  });
  const { text } = await httpGet(url, opts);

  // O DescribeFeatureType tambem declara o ELEMENTO TOP-LEVEL da camada
  // (<xsd:element name="SIGA_EIXO_LOG_OFICIAL_E_NAO" ... type="siga:...Type"/>),
  // que NAO e um atributo. So os elementos dentro de <xsd:sequence> sao
  // atributos publicados pela camada.
  const attributes = [];
  const seqRe = /<xsd:sequence\b[^>]*>([\s\S]*?)<\/xsd:sequence>/g;
  const elemRe = /<xsd:element\b([^>]*?)\/>/g;
  let seq;
  while ((seq = seqRe.exec(text)) !== null) {
    let m;
    elemRe.lastIndex = 0;
    while ((m = elemRe.exec(seq[1])) !== null) {
      const attrs = m[1];
      const name = attrs.match(/name="([^"]+)"/)?.[1];
      const type = attrs.match(/type="([^"]+)"/)?.[1] || null;
      const nillable = attrs.includes('nillable="true"');
      if (name) attributes.push({ name, type, nillable });
    }
  }

  return { attributes, raw: text, known: KNOWN_ATTRIBUTES };
}

/**
 * Verifica se a rede mudou no servidor.
 *
 * A camada não expõe um atributo de data por feição, e o `resultType=hits`
 * do WFS 1.0.0 com `outputFormat=application/json` devolve sempre
 * `numberOfFeatures="0"` (só o WFS 1.1.0 em XML é confiável). A verificação
 * prática, portanto, compara a **quantidade de feições** declarada pelo
 * servidor com a quantidade conhecida localmente.
 *
 * @param {number} knownTotal total de feições do snapshot local
 * @param {object} [options]
 * @returns {Promise<{changed:boolean, serverTotal:number|null, knownTotal:number, checkedAt:string}>}
 */
export async function checkForUpdates(knownTotal, options = {}) {
  const opts = { ...WFS_DEFAULTS, ...options };
  const page = await fetchPage(
    {
      service: 'WFS',
      version: '1.0.0',
      request: 'GetFeature',
      typeName: opts.typeName || LAYER_NAME,
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
      maxFeatures: 1,
    },
    opts
  );
  const serverTotal = page.total;
  return {
    changed: serverTotal !== null && knownTotal !== null && serverTotal !== knownTotal,
    serverTotal,
    knownTotal,
    checkedAt: new Date().toISOString(),
  };
}
