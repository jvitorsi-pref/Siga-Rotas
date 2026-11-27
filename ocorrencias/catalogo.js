/**
 * Catálogo compartilhado (Node.js, Web e APK) de categorias, classificações,
 * temporalidades e estados das ocorrências colaborativas do SIGA-Rotas.
 *
 * Lista padronizada ACS (exatamente 5 categorias para novos registros):
 *  1. Escada (`escada`)
 *  2. Rua íngreme (`rua_ingreme`)
 *  3. Animais (`animais`)
 *  4. Terreno irregular (`terreno_irregular`)
 *  5. Obstrução de passagem (`obstrucao_passagem`)
 *
 * Registros históricos anteriores permanecem preservados em `CATEGORIAS_LEGADO`
 * para exibição segura, roteamento e interações sem oferecê-los para novos registros.
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
    id: 'escada',
    rotulo: 'Escada',
    grupo: 'acesso',
    icone: '🪜',
    simbolo: 'ESC',
    glifo: '≡',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.PERMANENTE,
    ttlHoras: null,
    penalidadeMetros: 220,
    plural: 'escadas',
    artigo: 'uma escada',
  }),
  Object.freeze({
    id: 'rua_ingreme',
    rotulo: 'Rua íngreme',
    grupo: 'relevo',
    icone: '⛰️',
    simbolo: 'ING',
    glifo: '↗',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.PERMANENTE,
    ttlHoras: null,
    penalidadeMetros: 180,
    plural: 'ruas íngremes',
    artigo: 'uma rua íngreme',
  }),
  Object.freeze({
    id: 'animais',
    rotulo: 'Animais',
    grupo: 'seguranca',
    icone: '🐕',
    simbolo: 'ANI',
    glifo: '!',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 7 * 24,
    penalidadeMetros: 180,
    plural: 'locais com animais na via',
    artigo: 'animais na via',
  }),
  Object.freeze({
    id: 'terreno_irregular',
    rotulo: 'Terreno irregular',
    grupo: 'superficie',
    icone: '🪨',
    simbolo: 'TER',
    glifo: '≈',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.PERMANENTE,
    ttlHoras: null,
    penalidadeMetros: 160,
    plural: 'trechos com terreno irregular',
    artigo: 'um trecho com terreno irregular',
  }),
  Object.freeze({
    id: 'obstrucao_passagem',
    rotulo: 'Obstrução de passagem',
    grupo: 'interdicao',
    icone: '🚧',
    simbolo: 'OBS',
    glifo: '✕',
    classificacaoPadrao: CLASSIFICACOES.EVITA,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 14 * 24,
    penalidadeMetros: 420,
    plural: 'obstruções de passagem',
    artigo: 'uma obstrução de passagem',
  }),
]);

export const CATEGORIAS_LEGADO = Object.freeze({
  escadaria: Object.freeze({
    id: 'escadaria',
    rotulo: 'Escadaria (registro anterior)',
    rotuloBase: 'Escadaria',
    equivalente: 'escada',
    icone: '🪜',
    simbolo: 'ESC',
    glifo: '≡',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.PERMANENTE,
    ttlHoras: null,
    penalidadeMetros: 220,
    legado: true,
  }),
  passagem_estreita: Object.freeze({
    id: 'passagem_estreita',
    rotulo: 'Passagem estreita (registro anterior)',
    rotuloBase: 'Passagem estreita',
    equivalente: 'obstrucao_passagem',
    icone: '↔️',
    simbolo: 'EST',
    glifo: '⇥',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.PERMANENTE,
    ttlHoras: null,
    penalidadeMetros: 150,
    legado: true,
  }),
  buracos: Object.freeze({
    id: 'buracos',
    rotulo: 'Buracos (registro anterior)',
    rotuloBase: 'Buracos',
    equivalente: 'terreno_irregular',
    icone: '🕳️',
    simbolo: 'BUR',
    glifo: '●',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 14 * 24,
    penalidadeMetros: 140,
    legado: true,
  }),
  alagamento: Object.freeze({
    id: 'alagamento',
    rotulo: 'Alagamento (registro anterior)',
    rotuloBase: 'Alagamento',
    equivalente: 'obstrucao_passagem',
    icone: '🌊',
    simbolo: 'ALA',
    glifo: '∿',
    classificacaoPadrao: CLASSIFICACOES.EVITA,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 48,
    penalidadeMetros: 450,
    legado: true,
  }),
  obra_bloqueio: Object.freeze({
    id: 'obra_bloqueio',
    rotulo: 'Obra ou bloqueio (registro anterior)',
    rotuloBase: 'Obra ou bloqueio',
    equivalente: 'obstrucao_passagem',
    icone: '🚧',
    simbolo: 'OBR',
    glifo: '✕',
    classificacaoPadrao: CLASSIFICACOES.EVITA,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 30 * 24,
    penalidadeMetros: 500,
    legado: true,
  }),
  calcada_inexistente: Object.freeze({
    id: 'calcada_inexistente',
    rotulo: 'Calçada inexistente (registro anterior)',
    rotuloBase: 'Calçada inexistente',
    equivalente: 'terreno_irregular',
    icone: '🚶',
    simbolo: 'CAL',
    glifo: '!',
    classificacaoPadrao: CLASSIFICACOES.INFORMATIVO,
    temporalidadePadrao: TEMPORALIDADES.PERMANENTE,
    ttlHoras: null,
    penalidadeMetros: 120,
    legado: true,
  }),
  obstaculo: Object.freeze({
    id: 'obstaculo',
    rotulo: 'Obstáculo (registro anterior)',
    rotuloBase: 'Obstáculo',
    equivalente: 'obstrucao_passagem',
    icone: '⚠️',
    simbolo: 'OBS',
    glifo: '▲',
    classificacaoPadrao: CLASSIFICACOES.PENALIZA,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 7 * 24,
    penalidadeMetros: 200,
    legado: true,
  }),
  outras: Object.freeze({
    id: 'outras',
    rotulo: 'Outras condições (registro anterior)',
    rotuloBase: 'Outras condições',
    equivalente: null,
    icone: '📌',
    simbolo: 'OUT',
    glifo: '•',
    classificacaoPadrao: CLASSIFICACOES.INFORMATIVO,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 7 * 24,
    penalidadeMetros: 120,
    legado: true,
  }),
});

export const GRUPOS_CATEGORIA = Object.freeze([
  Object.freeze({ id: 'acesso', rotulo: 'Acessibilidade e passagem' }),
  Object.freeze({ id: 'relevo', rotulo: 'Inclinação' }),
  Object.freeze({ id: 'seguranca', rotulo: 'Segurança em campo' }),
  Object.freeze({ id: 'superficie', rotulo: 'Pavimento e solo' }),
  Object.freeze({ id: 'interdicao', rotulo: 'Bloqueios e obstruções' }),
]);

const CATEGORIA_MAP = new Map(CATEGORIAS_OCORRENCIA.map((c) => [c.id, c]));

/**
 * Retorna exclusivamente uma das 5 categorias padronizadas ativas (para validação e novos registros).
 */
export function obterCategoria(id) {
  return CATEGORIA_MAP.get(String(id || '').trim()) || null;
}

/**
 * Retorna metadados seguros para exibição, roteamento e interação de qualquer categoria
 * (ativa ou registro histórico legado), sem apagar nem quebrar registros antigos.
 */
export function obterCategoriaExibicao(id) {
  const chave = String(id || '').trim();
  const ativa = CATEGORIA_MAP.get(chave);
  if (ativa) return ativa;
  if (Object.prototype.hasOwnProperty.call(CATEGORIAS_LEGADO, chave)) {
    return CATEGORIAS_LEGADO[chave];
  }
  if (!chave) return null;
  return {
    id: chave,
    rotulo: `${chave} (registro anterior)`,
    rotuloBase: chave,
    equivalente: null,
    icone: '📌',
    simbolo: 'ANT',
    glifo: '•',
    classificacaoPadrao: CLASSIFICACOES.INFORMATIVO,
    temporalidadePadrao: TEMPORALIDADES.TEMPORARIA,
    ttlHoras: 7 * 24,
    penalidadeMetros: 150,
    legado: true,
  };
}

export function validarCategoria(id) {
  return CATEGORIA_MAP.has(String(id || '').trim());
}

export function ehCategoriaLegado(id) {
  const chave = String(id || '').trim();
  return Boolean(chave) && !CATEGORIA_MAP.has(chave);
}

export function normalizarCategoriaLegado(id) {
  const chave = String(id || '').trim();
  if (CATEGORIA_MAP.has(chave)) return chave;
  return CATEGORIAS_LEGADO[chave]?.equivalente || null;
}

export function glifoCategoria(id) {
  return obterCategoriaExibicao(id)?.glifo || '•';
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
