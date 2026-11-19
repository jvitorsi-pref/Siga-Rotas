/**
 * Configuração declarativa da URL da API centralizada Node.js para o APK.
 *
 * Sem credenciais ou segredos embutidos: a URL pode ser definida em tempo de
 * build via `EXPO_PUBLIC_SIGA_API_URL` ou ajustada em armazenamento local do
 * aparelho (`STORAGE_KEY_API_URL`) quando necessário.
 */

export const STORAGE_KEY_API_URL = '@santo_andre_routing:api_base_url_v1';
export const STORAGE_KEY_PENDING_SYNC = '@santo_andre_routing:pending_sync_v1';

export function normalizarApiUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) return null;
  return trimmed;
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
