/**
 * Configuração declarativa da URL da API centralizada Node.js para o APK.
 *
 * Sem credenciais ou segredos embutidos: a URL pode ser definida em tempo de
 * build via `EXPO_PUBLIC_SIGA_API_URL` ou ajustada em armazenamento local do
 * aparelho (`STORAGE_KEY_API_URL`) quando necessário.
 *
 * Suporta dois modos de transporte automaticamente a partir da URL informada:
 *  - `direct`: URL direta do servidor Node.js ou proxy reverso (ex.: `https://api.../SigaRotas`);
 *  - `ashx`: handler proxy ASP.NET WebForms (`.../ApiProxy.ashx`), reutilizando a
 *    mesma origem HTTPS do portal sem exigir ARR/URL Rewrite nem porta adicional.
 */

export const STORAGE_KEY_API_URL = '@santo_andre_routing:api_base_url_v1';
export const STORAGE_KEY_PENDING_SYNC = '@santo_andre_routing:pending_sync_v1';
export const LOCAL_MODE_SENTINEL = 'local';

export function normalizarApiUrl(raw) {
  if (typeof raw !== 'string') return null;
  let trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === LOCAL_MODE_SENTINEL) return null;
  trimmed = trimmed.split('#')[0].split('?')[0].replace(/\/+$/, '');
  if (!trimmed) return null;
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) return null;
  return trimmed;
}

export function resolverTipoTransporteApi(apiUrl) {
  const normalized = normalizarApiUrl(apiUrl);
  if (!normalized) return 'local';
  return /\.ashx$/i.test(normalized) ? 'ashx' : 'direct';
}

export function montarUrlEndpointApi(baseUrl, endpointPath) {
  const base = normalizarApiUrl(baseUrl);
  if (!base) return null;
  const raw = String(endpointPath || '').trim();
  const qIndex = raw.indexOf('?');
  const rawPath = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const rawQuery = qIndex >= 0 ? raw.slice(qIndex + 1) : '';
  const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

  if (resolverTipoTransporteApi(base) === 'ashx') {
    const extraPairs = rawQuery
      ? rawQuery
          .split('&')
          .filter((pair) => pair && !/^endpoint=/i.test(pair))
      : [];
    const qs = [`endpoint=${encodeURIComponent(normalizedPath)}`, ...extraPairs].join('&');
    return `${base}?${qs}`;
  }

  return rawQuery ? `${base}${normalizedPath}?${rawQuery}` : `${base}${normalizedPath}`;
}

export function resolverApiUrlInicial(options = {}, env = globalThis?.process?.env) {
  const fromOption = normalizarApiUrl(options.remoteApiUrl);
  if (fromOption) return fromOption;

  const fromGlobal = normalizarApiUrl(globalThis?.__SIGA_API_URL__);
  if (fromGlobal) return fromGlobal;

  const fromEnv = normalizarApiUrl(env?.EXPO_PUBLIC_SIGA_API_URL);
  if (fromEnv) return fromEnv;

  return null;
}
