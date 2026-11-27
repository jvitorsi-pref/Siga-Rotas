/**
 * planejamento/modeloVisitas.js
 * ---------------------------------------------------------------------------
 * Modelo compartilhado (Node.js, Web e APK) para Planejamento Inteligente de
 * Visitas Domiciliares (ACS).
 *
 * Princípios:
 *  - Reutiliza exatamente o formato de coordenadas e CEP Digital do projeto
 *    (`core/enderecoDigital.js` / `core/pontoTrajeto.js`), sem estrutura paralela;
 *  - NÃO inventa dados reais de pacientes nem regras, pesos ou escores clínicos;
 *  - Mantém separação visual clara entre visitas planejadas, sugestões
 *    oportunísticas, realizadas e não realizadas;
 *  - Suporta períodos configuráveis (não fixados em 1 semana).
 */

export const STATUS_VISITA = Object.freeze({
  PLANEJADA: 'planejada',
  OPORTUNISTICA_SUGERIDA: 'oportunistica_sugerida',
  REALIZADA: 'realizada',
  NAO_REALIZADA: 'nao_realizada',
});

export const PRIORIDADE_CRONOGRAMA = Object.freeze({
  ALTA: 'alta',
  MEDIA: 'media',
  BAIXA: 'baixa',
});

export const TIPOS_PERIODO = Object.freeze({
  DIARIO: 'diario',
  SEMANAL: 'semanal',
  QUINZENAL: 'quinzenal',
  MENSAL: 'mensal',
  DIAS: 'dias',
  PERSONALIZADO: 'personalizado',
});

export const PERIODOS_PLANEJAMENTO = Object.freeze({
  DIARIO: 'diario',
  SEMANAL: 'semanal',
  QUINZENAL: 'quinzenal',
  MENSAL: 'mensal',
});

export const ROTULOS_PERIODO = Object.freeze({
  diario: 'Diário',
  semanal: 'Semanal',
  quinzenal: 'Quinzenal',
  mensal: 'Mensal',
});

export function normalizarPeriodoPlanejamento(valor) {
  const txt = String(valor || '').trim().toLowerCase();
  if (txt === 'diario' || txt === 'diário' || txt === '1d' || txt === 'dia') {
    return PERIODOS_PLANEJAMENTO.DIARIO;
  }
  if (txt === 'quinzenal' || txt === '15d') {
    return PERIODOS_PLANEJAMENTO.QUINZENAL;
  }
  if (txt === 'mensal' || txt === 'mes' || txt === 'mês' || txt === '30d') {
    return PERIODOS_PLANEJAMENTO.MENSAL;
  }
  return PERIODOS_PLANEJAMENTO.SEMANAL;
}

export const META_STATUS_VISITA = Object.freeze({
  [STATUS_VISITA.PLANEJADA]: Object.freeze({
    id: STATUS_VISITA.PLANEJADA,
    rotulo: 'Planejada',
    cor: '#045127',
    fundo: '#edf6f0',
    borda: '#045127',
    simbolo: 'P',
  }),
  [STATUS_VISITA.OPORTUNISTICA_SUGERIDA]: Object.freeze({
    id: STATUS_VISITA.OPORTUNISTICA_SUGERIDA,
    rotulo: 'Sugestão próxima',
    cor: '#7c3aed',
    fundo: '#f5f3ff',
    borda: '#7c3aed',
    simbolo: '+',
  }),
  [STATUS_VISITA.REALIZADA]: Object.freeze({
    id: STATUS_VISITA.REALIZADA,
    rotulo: 'Realizada',
    cor: '#15803d',
    fundo: '#dcfce7',
    borda: '#15803d',
    simbolo: '✓',
  }),
  [STATUS_VISITA.NAO_REALIZADA]: Object.freeze({
    id: STATUS_VISITA.NAO_REALIZADA,
    rotulo: 'Não realizada',
    cor: '#dc2626',
    fundo: '#fef2f2',
    borda: '#dc2626',
    simbolo: '✕',
  }),
});

export const STATUS_VISITA_META = META_STATUS_VISITA;

export function rotuloStatusVisita(status) {
  return META_STATUS_VISITA[status]?.rotulo || META_STATUS_VISITA[STATUS_VISITA.PLANEJADA].rotulo;
}

export function corStatusVisita(status) {
  return META_STATUS_VISITA[status] || META_STATUS_VISITA[STATUS_VISITA.PLANEJADA];
}

export function normalizarTextoChave(valor) {
  return String(valor || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function formatarDataIsoDia(entrada) {
  if (entrada == null || entrada === '') return null;
  if (entrada instanceof Date) {
    if (!Number.isFinite(entrada.getTime())) return null;
    const y = entrada.getUTCFullYear();
    const m = String(entrada.getUTCMonth() + 1).padStart(2, '0');
    const d = String(entrada.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(entrada).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    ) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }
  const br = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (br) {
    const d = Number(br[1]);
    const m = Number(br[2]);
    let y = Number(br[3]);
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    ) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }
  return null;
}

export function parseDataFlexivel(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number' && Number.isFinite(valor) && valor > 20000 && valor < 90000) {
    // Serial de data do Excel (época 1899-12-30 corrigida para bug do bissexto de 1900)
    const utcMs = Math.round((valor - 25569) * 86400 * 1000);
    return formatarDataIsoDia(new Date(utcMs));
  }
  if (typeof valor === 'string' && /^\d+(\.\d+)?$/.test(valor.trim())) {
    const num = Number(valor.trim());
    if (num > 20000 && num < 90000) {
      const utcMs = Math.round((num - 25569) * 86400 * 1000);
      return formatarDataIsoDia(new Date(utcMs));
    }
  }
  return formatarDataIsoDia(valor);
}

export function formatarDataPtBr(isoDia) {
  const norm = formatarDataIsoDia(isoDia);
  if (!norm) return 'Sem data';
  const [y, m, d] = norm.split('-');
  return `${d}/${m}/${y}`;
}

export function diasEntreDatas(isoInicio, isoFim) {
  const a = formatarDataIsoDia(isoInicio);
  const b = formatarDataIsoDia(isoFim);
  if (!a || !b) return null;
  const msA = Date.parse(`${a}T00:00:00Z`);
  const msB = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(msA) || !Number.isFinite(msB)) return null;
  return Math.round((msB - msA) / 86400000);
}

export function somarDiasIso(isoDia, dias) {
  const base = formatarDataIsoDia(isoDia);
  if (!base) return null;
  const ms = Date.parse(`${base}T00:00:00Z`) + Math.round(dias) * 86400000;
  return formatarDataIsoDia(new Date(ms));
}

export function criarPeriodoPlanejamento(config = {}, referenciaMs = Date.now()) {
  const hojeIso = formatarDataIsoDia(new Date(referenciaMs)) || '2026-01-01';
  const tipoRaw = String(config?.tipo || TIPOS_PERIODO.DIAS).trim().toLowerCase();

  let tipo = TIPOS_PERIODO.DIAS;
  if (
    tipoRaw === TIPOS_PERIODO.DIARIO ||
    tipoRaw === TIPOS_PERIODO.SEMANAL ||
    tipoRaw === TIPOS_PERIODO.QUINZENAL ||
    tipoRaw === TIPOS_PERIODO.MENSAL ||
    tipoRaw === TIPOS_PERIODO.PERSONALIZADO ||
    tipoRaw === TIPOS_PERIODO.DIAS
  ) {
    tipo = tipoRaw;
  }

  let quantidadeDias = Number(config?.quantidadeDias);
  if (tipo === TIPOS_PERIODO.DIARIO && !Number.isFinite(quantidadeDias)) quantidadeDias = 1;
  else if (tipo === TIPOS_PERIODO.SEMANAL && !Number.isFinite(quantidadeDias)) quantidadeDias = 7;
  else if (tipo === TIPOS_PERIODO.QUINZENAL && !Number.isFinite(quantidadeDias)) quantidadeDias = 15;
  else if (tipo === TIPOS_PERIODO.MENSAL && !Number.isFinite(quantidadeDias)) quantidadeDias = 30;
  if (!Number.isFinite(quantidadeDias) || quantidadeDias < 1) quantidadeDias = 14;
  quantidadeDias = Math.min(365, Math.max(1, Math.round(quantidadeDias)));

  let dataInicio = formatarDataIsoDia(config?.dataInicio) || hojeIso;
  let dataFim = formatarDataIsoDia(config?.dataFim);

  if (!dataFim) {
    dataFim = somarDiasIso(dataInicio, quantidadeDias - 1);
  } else {
    const diff = diasEntreDatas(dataInicio, dataFim);
    if (diff != null && diff < 0) {
      const tmp = dataInicio;
      dataInicio = dataFim;
      dataFim = tmp;
    }
    const span = diasEntreDatas(dataInicio, dataFim);
    if (span != null) {
      quantidadeDias = Math.min(365, Math.max(1, span + 1));
    }
  }

  const rotuloPadrao =
    tipo === TIPOS_PERIODO.PERSONALIZADO
      ? `${formatarDataPtBr(dataInicio)} a ${formatarDataPtBr(dataFim)} (${quantidadeDias} dias)`
      : `Próximos ${quantidadeDias} dia(s) (${formatarDataPtBr(dataInicio)} a ${formatarDataPtBr(dataFim)})`;

  return {
    tipo,
    quantidadeDias,
    dataInicio,
    dataFim,
    rotulo: String(config?.rotulo || '').trim() || rotuloPadrao,
  };
}

export function chaveDeduplicacaoPaciente(paciente = {}) {
  const idPac = normalizarTextoChave(paciente.idPaciente);
  if (idPac) return `id:${idPac}`;
  const nome = normalizarTextoChave(paciente.nome);
  const plus = normalizarTextoChave(paciente.codigoCompleto || paciente.enderecoDigital);
  if (nome && plus) return `nome_plus:${nome}|${plus}`;
  const lat = Number(paciente.latitude);
  const lon = Number(paciente.longitude);
  if (nome && Number.isFinite(lat) && Number.isFinite(lon)) {
    return `nome_coord:${nome}|${lat.toFixed(5)},${lon.toFixed(5)}`;
  }
  return `anon:${nome || 'sem_nome'}`;
}

export function normalizarPrioridadeCronograma(valor) {
  const txt = normalizarTextoChave(valor);
  if (!txt) return PRIORIDADE_CRONOGRAMA.MEDIA;
  if (
    txt === 'alta' ||
    txt === 'urgente' ||
    txt === 'prioritaria' ||
    txt === '1' ||
    txt === 'p1'
  ) {
    return PRIORIDADE_CRONOGRAMA.ALTA;
  }
  if (txt === 'baixa' || txt === '3' || txt === '4' || txt === '5' || txt === 'p3') {
    return PRIORIDADE_CRONOGRAMA.BAIXA;
  }
  return PRIORIDADE_CRONOGRAMA.MEDIA;
}

export function normalizarStatusVisita(valor, { planejada = true } = {}) {
  const txt = normalizarTextoChave(valor);
  if (txt === 'realizada' || txt === 'concluida' || txt === 'visitada' || txt === 'ok') {
    return STATUS_VISITA.REALIZADA;
  }
  if (
    txt === 'nao realizada' ||
    txt === 'nao_realizada' ||
    txt === 'ausente' ||
    txt === 'nao encontrada' ||
    txt === 'recusada' ||
    txt === 'nao visitada'
  ) {
    return STATUS_VISITA.NAO_REALIZADA;
  }
  if (txt === 'oportunistica' || txt === 'oportunistica_sugerida' || txt === 'sugerida') {
    return STATUS_VISITA.OPORTUNISTICA_SUGERIDA;
  }
  return planejada ? STATUS_VISITA.PLANEJADA : STATUS_VISITA.PLANEJADA;
}

export function criarPlanoVisitasVazio(periodoConfig = {}, agoraMs = Date.now()) {
  const agoraIso = new Date(agoraMs).toISOString();
  return {
    id: `plan_${agoraMs.toString(36)}`,
    titulo: 'Planejamento Inteligente de Visitas',
    atualizadoEm: agoraIso,
    periodo: criarPeriodoPlanejamento(periodoConfig, agoraMs),
    pacientes: [],
    visitas: [],
    metadataClinica: {
      criteriosClinicosAtivos: false,
      mensagem:
        'Ordenação atual usa apenas cronograma importado, distância geográfica, pendências e tempo desde a última visita. Regras clínicas futuras podem ser conectadas sem alterar a base.',
    },
  };
}
