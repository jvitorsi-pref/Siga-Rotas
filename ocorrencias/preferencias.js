/**
 * Modelo e normalização das preferências individuais de trajeto do usuário.
 *
 * Separação conceitual:
 *  - A classificação pertence à OCORRÊNCIA (descreve a condição do local);
 *  - A preferência pertence ao USUÁRIO (define como considerar as ocorrências).
 */

import { validarCategoria } from './catalogo.js';

export const MODOS_PREFERENCIA = Object.freeze({
  CONSIDERAR: 'considerar',
  PRIORIZAR_SEM_DIFICULDADES: 'priorizar_sem_dificuldades',
  IGNORAR: 'ignorar',
});

export const ESCALAS_PENALIDADE = Object.freeze({
  baixa: 0.6,
  media: 1.0,
  alta: 1.6,
});

export function preferenciasPadrao() {
  return {
    modo: MODOS_PREFERENCIA.CONSIDERAR,
    evitarCategorias: [],
    penalidadePadrao: 'media',
  };
}

export function normalizarPreferencias(raw) {
  const base = preferenciasPadrao();
  if (!raw || typeof raw !== 'object') return base;

  const modoBruto = String(raw.modo || '').trim();
  const modo =
    modoBruto === MODOS_PREFERENCIA.IGNORAR ||
    modoBruto === MODOS_PREFERENCIA.PRIORIZAR_SEM_DIFICULDADES ||
    modoBruto === MODOS_PREFERENCIA.CONSIDERAR
      ? modoBruto
      : base.modo;

  const escalaBruta = String(raw.penalidadePadrao || '').trim();
  const penalidadePadrao = Object.prototype.hasOwnProperty.call(ESCALAS_PENALIDADE, escalaBruta)
    ? escalaBruta
    : base.penalidadePadrao;

  const listaBruta = Array.isArray(raw.evitarCategorias) ? raw.evitarCategorias : [];
  const evitarUnicas = [];
  for (const item of listaBruta) {
    const id = String(item || '').trim();
    if (validarCategoria(id) && !evitarUnicas.includes(id)) {
      evitarUnicas.push(id);
    }
  }

  return {
    modo,
    evitarCategorias: evitarUnicas,
    penalidadePadrao,
  };
}

export function chaveStoragePreferencias() {
  return '@santo_andre_routing:preferencias_trajeto_v1';
}

export function chaveStorageUsuarioId() {
  return '@santo_andre_routing:usuario_id_v1';
}
