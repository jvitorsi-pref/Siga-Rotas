/**
 * UTILITÁRIOS DE FORMATAÇÃO E PARSING DE COORDENADAS
 * ==================================================
 *
 * Mantém exatamente as mesmas regras e heurísticas da interface original
 * (`public/app.js`):
 *  • Aceita vírgula decimal brasileira ("-46,5450 -23,6600") ou ponto decimal;
 *  • Inverte automaticamente `latitude, longitude` para `longitude, latitude`
 *    quando o primeiro valor tem módulo ≤ 90 e o segundo > 90;
 *  • Formata distâncias em metros (< 1.000 m) ou quilômetros (≥ 1.000 m);
 *  • Mapeia os estados de validação do Endereço Digital (CEP Digital).
 */

import { STATUS } from '../core/pontoTrajeto.js';

/**
 * Converte um token numérico em número, aceitando vírgula decimal.
 * Devolve `null` quando o token não é um número válido.
 */
export function numeroDe(token) {
  const t = String(token ?? '').trim().replace(',', '.');
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Interpreta a entrada do usuário como `{lon, lat}`.
 * Aceita `"lon,lat"`, `"lon lat"`, `"lat,lon"` (detectado automaticamente) e JSON.
 */
export function parseCoords(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (text.startsWith('{')) {
    try {
      const o = JSON.parse(text);
      const lon = Number(o.lon ?? o.longitude ?? o.lng);
      const lat = Number(o.lat ?? o.latitude);
      return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
    } catch {
      return null;
    }
  }

  let a = null;
  let b = null;

  // 1) separados por espaço ou ponto-e-vírgula
  const porEspaco = text.split(/[;\s]+/).filter(Boolean);
  if (porEspaco.length === 2) {
    a = numeroDe(porEspaco[0]);
    b = numeroDe(porEspaco[1]);
  }
  // 2) separados por vírgula (ponto decimal)
  if (a === null || b === null) {
    const porVirgula = text.split(/[;,\s]+/).filter(Boolean);
    if (porVirgula.length === 2) {
      a = numeroDe(porVirgula[0]);
      b = numeroDe(porVirgula[1]);
    }
    // 3) vírgula decimal nos dois valores: "-46,5450, -23,6600"
    if ((a === null || b === null) && porVirgula.length === 4) {
      a = numeroDe(porVirgula[0] + '.' + porVirgula[1]);
      b = numeroDe(porVirgula[2] + '.' + porVirgula[3]);
    }
  }
  if (a === null || b === null) return null;

  // Heurística: se o primeiro valor parece latitude e o segundo longitude,
  // troca a ordem (a latitude de Santo André está entre -23,9 e -23,5).
  if (Math.abs(a) <= 90 && Math.abs(b) > 90) {
    const tmp = a;
    a = b;
    b = tmp;
  }
  if (a < -180 || a > 180 || b < -90 || b > 90) return null;
  return { lon: a, lat: b };
}

export function formatCoord(pt) {
  if (!pt || pt.lon == null || pt.lat == null) return '';
  return `${ Number(pt.lon).toFixed(6) }, ${ Number(pt.lat).toFixed(6) }`;
}

export function formatDistanceParts(meters) {
  if (!Number.isFinite(meters)) return { v: '—', u: '' };
  if (meters < 1000) {
    return { v: String(Math.round(meters)), u: 'metros' };
  }
  const km = (meters / 1000).toFixed(2).replace('.', ',');
  return { v: km, u: 'km' };
}

export function formatStreetLength(meters) {
  if (!Number.isFinite(meters)) return '0 m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2).replace('.', ',')} km`;
}

/** Texto amigável de cada estado de validação do Endereço Digital. */
export const TEXTO_ESTADO = {
  [STATUS.VAZIO]: 'Sem Endereço Digital.',
  [STATUS.MALFORMADO]: 'Endereço Digital malformado.',
  [STATUS.VALIDADO]: 'Código válido — ainda não convertido em coordenadas.',
  [STATUS.CONVERTIDO]: 'Convertido em coordenadas.',
  [STATUS.FORA_DA_AREA]: 'Fora da área atendida pelo protótipo.',
  [STATUS.FALHA]: 'Falha na resolução do endereço.',
  [STATUS.INDISPONIVEL]: 'Serviço de Endereço Digital indisponível.',
  PENDENTE: 'Digitado — toque em “Validar”.',
};

/** Variante visual do estado ('ok' | 'idle' | 'erro'). */
export function classeEstado(status) {
  if (status === STATUS.CONVERTIDO) return 'ok';
  if (status === STATUS.VALIDADO || status === 'PENDENTE' || status === STATUS.VAZIO) return 'idle';
  return 'erro';
}

export function reasonTitle(reason) {
  switch (reason) {
    case 'COORDENADA_INVALIDA':
      return 'Coordenadas inválidas';
    case 'FORA_DA_REDE':
      return 'Ponto distante da rede viária';
    case 'SEM_CAMINHO':
      return 'Não existe caminho viário';
    case 'TRECHO_SEM_CAMINHO':
      return 'Trecho sem caminho viário';
    case 'PONTOS_INSUFICIENTES':
      return 'Pontos insuficientes';
    case 'PONTO_SEM_COORDENADA':
      return 'Endereço sem resolver';
    case 'REDE_VAZIA':
      return 'Rede viária indisponível';
    default:
      return 'Não foi possível calcular a rota';
  }
}
