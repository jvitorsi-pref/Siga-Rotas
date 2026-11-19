/**
 * public/ocorrenciasUI.js
 * --------------------------------------------------------------------------
 * Utilitários de estado, persistência local (preferências e usuarioId
 * pseudônimo) e formatação das ocorrências colaborativas e rotas alternativas
 * para a interface Web/WebForms/PWA.
 */

import {
  CATEGORIAS_OCORRENCIA,
  CLASSIFICACAO_META,
  CLASSIFICACOES,
  STATUS_OCORRENCIA,
  TEMPORALIDADES,
  obterCategoria,
} from '../ocorrencias/catalogo.js';
import {
  MODOS_PREFERENCIA,
  chaveStoragePreferencias,
  chaveStorageUsuarioId,
  normalizarPreferencias,
  preferenciasPadrao,
} from '../ocorrencias/preferencias.js';

export function obterOuCriarUsuarioIdWeb(storage = globalThis.localStorage) {
  const chave = chaveStorageUsuarioId();
  try {
    const existente = storage?.getItem?.(chave);
    if (existente && existente.trim()) return existente.trim();
  } catch {
    /* localStorage indisponível */
  }
  const novo =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? `web_${globalThis.crypto.randomUUID()}`
      : `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    storage?.setItem?.(chave, novo);
  } catch {
    /* localStorage indisponível */
  }
  return novo;
}

export function lerPreferenciasWeb(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(chaveStoragePreferencias());
    if (!raw) return preferenciasPadrao();
    return normalizarPreferencias(JSON.parse(raw));
  } catch {
    return preferenciasPadrao();
  }
}

export function salvarPreferenciasWeb(preferencias, storage = globalThis.localStorage) {
  const norm = normalizarPreferencias(preferencias);
  try {
    storage?.setItem?.(chaveStoragePreferencias(), JSON.stringify(norm));
  } catch {
    /* localStorage indisponível */
  }
  return norm;
}

export function formatarDataHoraPtBr(iso) {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  try {
    return new Date(ms).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function resumoPreferenciasTexto(preferencias) {
  const p = normalizarPreferencias(preferencias);
  const modoTxt =
    p.modo === MODOS_PREFERENCIA.IGNORAR
      ? 'Ignorar alertas'
      : p.modo === MODOS_PREFERENCIA.PRIORIZAR_SEM_DIFICULDADES
        ? 'Evitar dificuldades'
        : 'Considerar alertas';
  if (p.evitarCategorias.length > 0 && p.modo !== MODOS_PREFERENCIA.IGNORAR) {
    return `${modoTxt} · evita ${p.evitarCategorias.length} tipo(s)`;
  }
  return modoTxt;
}

export function estiloClassificacao(classificacao) {
  if (classificacao === CLASSIFICACOES.EVITA) {
    return {
      cor: '#dc2626',
      fundo: '#fef2f2',
      borda: '#991b1b',
      rotulo: CLASSIFICACAO_META[CLASSIFICACOES.EVITA].rotulo,
    };
  }
  if (classificacao === CLASSIFICACOES.PENALIZA) {
    return {
      cor: '#d97706',
      fundo: '#fffbeb',
      borda: '#92400e',
      rotulo: CLASSIFICACAO_META[CLASSIFICACOES.PENALIZA].rotulo,
    };
  }
  return {
    cor: '#0284c7',
    fundo: '#f0f9ff',
    borda: '#075985',
    rotulo: CLASSIFICACAO_META[CLASSIFICACOES.INFORMATIVO].rotulo,
  };
}

export function simboloCategoria(categoriaId) {
  switch (categoriaId) {
    case 'escadaria': return '≡';
    case 'terreno_irregular': return '≈';
    case 'rua_ingreme': return '↗';
    case 'passagem_estreita': return '⇥';
    case 'buracos': return '●';
    case 'alagamento': return '∿';
    case 'obra_bloqueio': return '✕';
    case 'calcada_inexistente': return '!';
    case 'obstaculo': return '▲';
    default: return '•';
  }
}

export function rotuloStatusOcorrencia(status) {
  if (status === STATUS_OCORRENCIA.EM_ANALISE) return 'Em análise';
  if (status === STATUS_OCORRENCIA.RESOLVIDA) return 'Resolvida';
  if (status === STATUS_OCORRENCIA.EXPIRADA) return 'Expirada';
  return 'Ativa';
}

export function rotuloTemporalidade(temporalidade) {
  return temporalidade === TEMPORALIDADES.PERMANENTE ? 'Permanente' : 'Temporária';
}

export function formatarDistanciaCurta(metros) {
  if (!Number.isFinite(metros)) return '—';
  if (metros < 1000) return `${Math.round(metros).toLocaleString('pt-BR')} m`;
  return `${(metros / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} km`;
}

export function gerarHtmlOpcoesCategoriasEvitar(preferencias) {
  const norm = normalizarPreferencias(preferencias);
  return CATEGORIAS_OCORRENCIA.map((cat) => {
    const marcado = norm.evitarCategorias.includes(cat.id) ? 'checked' : '';
    return `<label class="prefs-cat"><input type="checkbox" value="${cat.id}" ${marcado} /><span>${cat.rotulo}</span></label>`;
  }).join('');
}

export function obterDetalhesCategoria(id) {
  return obterCategoria(id);
}
