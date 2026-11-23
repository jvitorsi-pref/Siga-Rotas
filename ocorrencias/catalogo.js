/**
 * Catálogo compartilhado (Node.js, Web e APK) de categorias, classificações,
 * temporalidades e estados das ocorrências colaborativas do SIGA-Rotas.
 */

export const CLASSIFICACOES = Object.freeze({
  INFORMATIVO: 'informativo',
  PENALIZA: 'penaliza',
  EVITA: 'evita',
});

export const STATUS_OCORRENCIA = Object.freeze({
  ATIVA: 'ativa',
  EM_ANALISE: 'em_analise',
  RESOLVIDA: 'resolvida',
  EXPIRADA: 'expirada',
});

export const TEMPORALIDADES = Object.freeze({
  TEMPORARIA: 'temporaria',
  PERMANENTE: 'permanente',
});

export const ACOES_COLABORATIVAS = Object.freeze({
  CONFIRMAR: 'confirmar',
  RESOLVER: 'resolver',
  CONTESTAR: 'contestar',
});

export const CLASSIFICACAO_META = Object.freeze({
  [CLASSIFICACOES.INFORMATIVO]: Object.freeze({
    id: CLASSIFICACOES.INFORMATIVO,
    rotulo: 'Informativo',
    resumo: 'Exibe o aviso no mapa e no trajeto sem alterar a rota.',
    cor: '#2563eb',
    fundo: 'rgba(37, 99, 235, 0.12)',
    borda: 'rgba(37, 99, 235, 0.38)',
    badge: 'i',
  }),
  [CLASSIFICACOES.PENALIZA]: Object.freeze({
    id: CLASSIFICACOES.PENALIZA,
    rotulo: 'Aumenta o custo',
    resumo: 'Adiciona penalidade ao trecho para preferir desvios razoáveis.',
    cor: '#b45309',
    fundo: 'rgba(180, 83, 9, 0.12)',
    borda: 'rgba(180, 83, 9, 0.4)',
    badge: '!',
  }),
  [CLASSIFICACOES.EVITA]: Object.freeze({
    id: CLASSIFICACOES.EVITA,
    rotulo: 'Evita o trecho',
    resumo: 'Impede o uso deste segmento quando a restrição for aplicável.',
    cor: '#cf222e',
    fundo: 'rgba(207, 34, 46, 0.12)',
    borda: 'rgba(207, 34, 46, 0.42)',
    badge: '×',
  }),
});

export const CATEGORIAS_OCORRENCIA = Object.freeze([
  Object.freeze({
    id: 'escadaria',
    rotulo: 'Escadaria',
    grupo: 'acesso',
    icone: '🪜',
    simbolo: 'ESC',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.PERMANENTE,
    ttlHoras: null,
    penalidadeMetros: 220,
    plural: 'escadarias',
    artigo: 'uma escadaria',
  }),
  Object.freeze({
    id: 'terreno_irregular',
    rotulo: 'Terreno irregular',
    grupo: 'superficie',
    icone: '🪨',
    simbolo: 'TER',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.PERMANENTE,
    ttlHoras: null,
    penalidadeMetros: 160,
    plural: 'trechos com terreno irregular',
    artigo: 'um trecho com terreno irregular',
  }),
  Object.freeze({
    id: 'rua_ingreme',
    rotulo: 'Rua íngreme',
    grupo: 'relevo',
    icone: '⛰️',
    simbolo: 'ING',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.PERMANENTE,
    ttlHoras: null,
    penalidadeMetros: 180,
    plural: 'ruas íngremes',
    artigo: 'uma rua íngreme',
  }),
  Object.freeze({
    id: 'passagem_estreita',
    rotulo: 'Passagem estreita',
    grupo: 'acesso',
    icone: '↔️',
    simbolo: 'EST',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.PERMANENTE,
    ttlHoras: null,
    penalidadeMetros: 150,
    plural: 'passagens estreitas',
    artigo: 'uma passagem estreita',
  }),
  Object.freeze({
    id: 'buracos',
    rotulo: 'Buracos',
    grupo: 'superficie',
    icone: '🕳️',
    simbolo: 'BUR',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 14 * 24,
    penalidadeMetros: 140,
    plural: 'trechos com buracos',
    artigo: 'um trecho com buracos',
  }),
  Object.freeze({
    id: 'alagamento',
    rotulo: 'Alagamento',
    grupo: 'clima',
    icone: '🌊',
    simbolo: 'ALA',
    classificacaoPadrao: CLASSIFICACOES.EVITA,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 48,
    penalidadeMetros: 450,
    plural: 'pontos de alagamento',
    artigo: 'um alagamento',
  }),
  Object.freeze({
    id: 'obra_bloqueio',
    rotulo: 'Obra ou bloqueio',
    grupo: 'interdicao',
    icone: '🚧',
    simbolo: 'OBR',
    classificacaoPadrao: CLASSIFICACOES.EVITA,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 30 * 24,
    penalidadeMetros: 500,
    plural: 'obras ou bloqueios',
    artigo: 'uma obra ou bloqueio',
  }),
  Object.freeze({
    id: 'calcada_inexistente',
    rotulo: 'Calçada inexistente',
    grupo: 'infraestrutura',
    icone: '🚶',
    simbolo: 'CAL',
    classificacaoPadrao: CLASSIFICACOES.INFORMATIVO,
    temporalidadePadrao: TEMPORALIDADES.PERMANENTE,
    ttlHoras: null,
    penalidadeMetros: 120,
    plural: 'trechos sem calçada',
    artigo: 'um trecho sem calçada',
  }),
  Object.freeze({
    id: 'obstaculo',
    rotulo: 'Obstáculo',
    grupo: 'interdicao',
    icone: '⚠️',
    simbolo: 'OBS',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 7 * 24,
    penalidadeMetros: 200,
    plural: 'obstáculos',
    artigo: 'um obstáculo',
  }),
  Object.freeze({
    id: 'outras',
    rotulo: 'Outras condições',
    grupo: 'geral',
    icone: '📌',
    simbolo: 'OUT',
    classificacaoPadrao: CLASSIFICACOES.INFORMATIVO,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 7 * 24,
    penalidadeMetros: 120,
    plural: 'ocorrências diversas',
    artigo: 'uma condição informada',
  }),
]);

export const GRUPOS_CATEGORIA = Object.freeze([
  Object.freeze({ id: 'acesso', rotulo: 'Acessibilidade e passagem' }),
  Object.freeze({ id: 'superficie', rotulo: 'Pavimento e solo' }),
  Object.freeze({ id: 'relevo', rotulo: 'Inclinação' }),
  Object.freeze({ id: 'interdicao', rotulo: 'Bloqueios e obstáculos' }),
  Object.freeze({ id: 'clima', rotulo: 'Clima e água' }),
  Object.freeze({ id: 'infraestrutura', rotulo: 'Infraestrutura' }),
  Object.freeze({ id: 'geral', rotulo: 'Outros' }),
]);

const CATEGORIA_MAP = new Map(CATEGORIAS_OCORRENCIA.map((c) => [c.id, c]));

export function obterCategoria(id) {
  return CATEGORIA_MAP.get(String(id || '').trim()) || null;
}

export function validarCategoria(id) {
  return CATEGORIA_MAP.has(String(id || '').trim());
}

export function validarClassificacao(valor) {
  return (
    valor === CLASSIFICACOES.INFORMATIVO ||
    valor === CLASSIFICACOES.PENALIZA ||
    valor === CLASSIFICACOES.EVITA
  );
}

export function obterClassificacaoMeta(valor) {
  return CLASSIFICACAO_META[valor] || CLASSIFICACAO_META[CLASSIFICACOES.INFORMATIVO];
}
