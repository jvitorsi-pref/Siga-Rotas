/**
 * Regras de negócio compartilhadas para ocorrências colaborativas:
 *  - Associação precisa a segmentos da rede viária (evitando ruas paralelas);
 *  - Cadastro, validação e geração de ID determinístico/único;
 *  - Interações colaborativas (confirmar, sinalizar resolvida, contestar) sem duplicidade;
 *  - Expiração exclusiva de ocorrências temporárias (permanentes nunca expiram pelo tempo);
 *  - Avaliação de impacto conforme classificação da ocorrência x preferência do usuário.
 */

import { project, unproject, dist, projectPointOnSegment } from '../core/geo.js';
import {
  ACOES_COLABORATIVAS,
  CLASSIFICACOES,
  STATUS_OCORRENCIA,
  TEMPORALIDADES,
  normalizarCategoriaLegado,
  obterCategoria,
  obterCategoriaExibicao,
  validarClassificacao,
} from './catalogo.js';
import {
  ESCALAS_PENALIDADE,
  MODOS_PREFERENCIA,
  normalizarPreferencias,
} from './preferencias.js';

function gerarIdOcorrencia(agoraMs) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `occ_${agoraMs.toString(36)}_${rand}`;
}

function limparDescricao(raw) {
  if (raw == null) return '';
  return String(raw).trim().replace(/\s+/g, ' ').slice(0, 280);
}

function distanciaAteAresta(edge, x, y) {
  const c = edge.coords;
  if (!Array.isArray(c) || c.length < 2) return null;
  let melhor = null;
  let comprimentoAcumulado = 0;
  for (let i = 0; i < c.length - 1; i++) {
    const segLen = dist(c[i][0], c[i][1], c[i + 1][0], c[i + 1][1]);
    const pr = projectPointOnSegment(x, y, c[i][0], c[i][1], c[i + 1][0], c[i + 1][1]);
    if (!melhor || pr.dist < melhor.dist) {
      const pos = comprimentoAcumulado + segLen * pr.t;
      melhor = {
        dist: pr.dist,
        x: pr.x,
        y: pr.y,
        segIdx: i,
        t: pr.t,
        pos,
      };
    }
    comprimentoAcumulado += segLen;
  }
  return melhor
    ? {
        ...melhor,
        fraction: edge.length > 0 ? Math.min(1, Math.max(0, melhor.pos / edge.length)) : 0,
      }
    : null;
}

function nomeLogradouroDaAresta(edge) {
  const p = edge?.props || {};
  return p.DSC_LOGRADOURO || (p.NOM_LOGRADOURO ? `RUA ${p.NOM_LOGRADOURO}` : 'Eixo sem nome');
}

/**
 * Identifica o segmento da rede viária correspondente a `(latitude, longitude)`,
 * devolvendo o trecho principal e outros candidatos próximos (útil para desambiguar
 * ruas paralelas ou esquinas antes de gravar).
 */
export function associarSegmentoDaRede(graph, entrada = {}) {
  const lat = Number(entrada.latitude);
  const lon = Number(entrada.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return {
      ok: false,
      reason: 'COORDENADA_INVALIDA',
      message: 'Coordenadas inválidas para registrar ocorrência.',
      candidatos: [],
      principal: null,
    };
  }
  if (!graph || !Array.isArray(graph.edges) || !graph.edges.length) {
    return {
      ok: false,
      reason: 'REDE_VAZIA',
      message: 'A rede viária ainda não foi carregada.',
      candidatos: [],
      principal: null,
    };
  }

  const maxRaioM = Number.isFinite(entrada.maxRaioM) ? entrada.maxRaioM : 45;
  const [x, y] = project(lon, lat);

  const edgeIds = new Set();
  if (graph.edgeIndex) {
    const minRing = Math.max(1, Math.ceil(maxRaioM / graph.edgeIndex.cellSize));
    graph.edgeIndex.queryExpanding(x, y, maxRaioM + graph.edgeIndex.cellSize, (cands, ring) => {
      for (const c of cands) edgeIds.add(c.edgeId);
      return ring >= minRing && edgeIds.size > 0 && (ring - 1) * graph.edgeIndex.cellSize > maxRaioM;
    });
  } else {
    for (const e of graph.edges) edgeIds.add(e.id);
  }

  const candidatosPorChave = new Map();
  for (const edgeId of edgeIds) {
    const edge = graph.edges[edgeId];
    if (!edge || edge.connector) continue;
    const proj = distanciaAteAresta(edge, x, y);
    if (!proj || proj.dist > maxRaioM) continue;

    const [snappedLon, snappedLat] = unproject(proj.x, proj.y);
    const chave = `${edge.featureId}:${edge.partId}:${edge.id}`;
    const item = {
      edgeId: edge.id,
      featureId: edge.featureId,
      partId: edge.partId ?? 0,
      codLog: edge.props?.COD_LOG ?? null,
      logradouro: nomeLogradouroDaAresta(edge),
      oficial: Number(edge.props?.COD_LOG) !== 0,
      distanciaAoEixoM: Math.round(proj.dist * 10) / 10,
      dist: proj.dist,
      latitude: snappedLat,
      longitude: snappedLon,
      fraction: Math.round(proj.fraction * 1000) / 1000,
      segmentoAssinatura: `${edge.featureId}:${edge.partId ?? 0}:${Math.round(proj.x)}:${Math.round(proj.y)}`,
      comprimentoTrechoM: Math.round(edge.length * 10) / 10,
    };

    const prev = candidatosPorChave.get(chave);
    if (!prev || item.dist < prev.dist) {
      candidatosPorChave.set(chave, item);
    }
  }

  // Deduplica por featureId quando a mesma feição aparece com várias sub-arestas,
  // mantendo a sub-aresta mais próxima de cada via distinta.
  const melhorPorFeature = new Map();
  for (const c of candidatosPorChave.values()) {
    const prev = melhorPorFeature.get(c.featureId);
    if (!prev || c.dist < prev.dist) {
      melhorPorFeature.set(c.featureId, c);
    }
  }

  const candidatos = [...melhorPorFeature.values()]
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);

  if (!candidatos.length) {
    return {
      ok: false,
      reason: 'SEGMENTO_NAO_ENCONTRADO',
      message: `Nenhum trecho viário encontrado a até ${maxRaioM} m do ponto selecionado.`,
      candidatos: [],
      principal: null,
    };
  }

  const preferido = entrada.featureIdPreferido != null
    ? candidatos.find((c) => Number(c.featureId) === Number(entrada.featureIdPreferido))
    : null;
  const principal = preferido || candidatos[0];
  const temRuasProximas =
    candidatos.length >= 2 && candidatos[1].dist - candidatos[0].dist <= 12;

  return {
    ok: true,
    principal,
    candidatos,
    temRuasProximas,
  };
}

/**
 * Localiza sobre `graph` a(s) aresta(s) exata(s) afetada(s) por uma ocorrência,
 * evitando atingir ruas paralelas ou outros quarteirões do mesmo logradouro.
 */
export function localizarArestasDaOcorrencia(graph, occ) {
  if (!graph || !Array.isArray(graph.edges) || !occ?.localizacao) return [];
  const loc = occ.localizacao;
  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const [x, y] = project(lon, lat);

  // 1. Busca direta por featureId + partId (preservando separação entre quarteirões)
  const daFeicao = graph.edges.filter(
    (e) =>
      !e.connector &&
      Number(e.featureId) === Number(loc.featureId) &&
      (loc.partId == null || Number(e.partId) === Number(loc.partId)),
  );

  if (daFeicao.length === 1) {
    const pr = distanciaAteAresta(daFeicao[0], x, y);
    if (pr && pr.dist <= 30) return [daFeicao[0]];
  } else if (daFeicao.length > 1) {
    let melhor = null;
    for (const edge of daFeicao) {
      const pr = distanciaAteAresta(edge, x, y);
      if (pr && (!melhor || pr.dist < melhor.dist)) {
        melhor = { edge, dist: pr.dist };
      }
    }
    if (melhor && melhor.dist <= 20) {
      return [melhor.edge];
    }
  }

  // 2. Fallback espacial restrito (caso o GeoServer tenha renumerado featureId)
  let melhorFallback = null;
  let melhorMesmoLog = null;
  for (const edge of graph.edges) {
    if (edge.connector) continue;
    const pr = distanciaAteAresta(edge, x, y);
    if (!pr || pr.dist > 15) continue;
    const mesmoCod = loc.codLog != null && Number(edge.props?.COD_LOG) === Number(loc.codLog);
    const mesmoNome = loc.logradouro && nomeLogradouroDaAresta(edge) === loc.logradouro;
    if (mesmoCod || mesmoNome) {
      if (!melhorMesmoLog || pr.dist < melhorMesmoLog.dist) {
        melhorMesmoLog = { edge, dist: pr.dist };
      }
    }
    if (!melhorFallback || pr.dist < melhorFallback.dist) {
      melhorFallback = { edge, dist: pr.dist };
    }
  }
  const escolhido = melhorMesmoLog || melhorFallback;
  return escolhido ? [escolhido.edge] : [];
}

function calcularContadores(interacoes) {
  let confirmacoes = 0;
  let resolvida = 0;
  let contestacoes = 0;
  for (const item of interacoes || []) {
    if (item.tipo === ACOES_COLABORATIVAS.CONFIRMAR) confirmacoes++;
    else if (item.tipo === ACOES_COLABORATIVAS.RESOLVER) resolvida++;
    else if (item.tipo === ACOES_COLABORATIVAS.CONTESTAR) contestacoes++;
  }
  return { confirmacoes, resolvida, contestacoes };
}

export function reavaliarStatus(occ, agora = Date.now()) {
  const agoraMs = typeof agora === 'number' ? agora : Date.parse(agora) || Date.now();
  const c = calcularContadores(occ.interacoes);

  if (c.resolvida >= 3 || (c.resolvida >= 2 && c.resolvida > c.confirmacoes)) {
    return STATUS_OCORRENCIA.RESOLVIDA;
  }
  if (
    occ.temporalidade === TEMPORALIDADES.TEMPORARIA &&
    occ.expiraEm &&
    Date.parse(occ.expiraEm) <= agoraMs
  ) {
    return STATUS_OCORRENCIA.EXPIRADA;
  }
  if (c.contestacoes >= 2 && c.contestacoes >= c.confirmacoes) {
    return STATUS_OCORRENCIA.EM_ANALISE;
  }
  return STATUS_OCORRENCIA.ATIVA;
}

export function atualizarExpiracoes(ocorrencias, agora = Date.now()) {
  const lista = Array.isArray(ocorrencias) ? ocorrencias : [];
  let mudou = false;
  const atualizadas = lista.map((occ) => {
    const novoStatus = reavaliarStatus(occ, agora);
    const contadores = calcularContadores(occ.interacoes);
    if (
      novoStatus !== occ.status ||
      contadores.confirmacoes !== occ.contadores?.confirmacoes ||
      contadores.resolvida !== occ.contadores?.resolvida ||
      contadores.contestacoes !== occ.contadores?.contestacoes
    ) {
      mudou = true;
      return { ...occ, status: novoStatus, contadores };
    }
    return occ;
  });
  return { ocorrencias: atualizadas, mudou };
}

export function criarOcorrencia(payload = {}, { graph, usuarioId, agora = Date.now() } = {}) {
  const uid = String(usuarioId || payload.usuarioId || '').trim();
  if (!uid) {
    return {
      ok: false,
      reason: 'USUARIO_NAO_IDENTIFICADO',
      message: 'Identificador do usuário é obrigatório para registrar ocorrências.',
    };
  }

  const categoria = obterCategoria(payload.categoria);
  if (!categoria) {
    return {
      ok: false,
      reason: 'CATEGORIA_INVALIDA',
      message: 'Selecione uma categoria válida para a ocorrência.',
    };
  }

  const classificacao = payload.classificacao || categoria.classificacaoPadrao;
  if (!validarClassificacao(classificacao)) {
    return {
      ok: false,
      reason: 'CLASSIFICACAO_INVALIDA',
      message: 'Classificação inválida. Use informativo, penaliza ou evita.',
    };
  }

  const segRes = associarSegmentoDaRede(graph, {
    latitude: payload.latitude,
    longitude: payload.longitude,
    featureIdPreferido: payload.featureId ?? payload.featureIdPreferido ?? null,
    maxRaioM: payload.maxRaioM ?? 45,
  });
  if (!segRes.ok) {
    return segRes;
  }

  const temporalidade =
    payload.temporalidade === TEMPORALIDADES.PERMANENTE ||
    payload.temporalidade === TEMPORALIDADES.TEMPORARIA
      ? payload.temporalidade
      : categoria.temporalidadePadrao;

  const agoraMs = typeof agora === 'number' ? agora : Date.parse(agora) || Date.now();
  const agoraIso = new Date(agoraMs).toISOString();
  const ttlHoras =
    temporalidade === TEMPORALIDADES.TEMPORARIA
      ? Number.isFinite(Number(payload.ttlHoras)) && Number(payload.ttlHoras) > 0
        ? Number(payload.ttlHoras)
        : categoria.ttlHoras || 7 * 24
      : null;
  const expiraEm = ttlHoras ? new Date(agoraMs + ttlHoras * 3600000).toISOString() : null;

  const penalidadeBruta = Number(payload.penalidadeMetros);
  const penalidadeMetros =
    classificacao === CLASSIFICACOES.PENALIZA
      ? Number.isFinite(penalidadeBruta) && penalidadeBruta >= 20 && penalidadeBruta <= 5000
        ? Math.round(penalidadeBruta)
        : categoria.penalidadeMetros
      : classificacao === CLASSIFICACOES.EVITA
        ? categoria.penalidadeMetros
        : 0;

  const principal = segRes.principal;
  const interacoes = [{ usuarioId: uid, tipo: ACOES_COLABORATIVAS.CONFIRMAR, em: agoraIso }];

  const ocorrencia = {
    id: String(payload.id || gerarIdOcorrencia(agoraMs)),
    categoria: categoria.id,
    classificacao,
    temporalidade,
    descricao: limparDescricao(payload.descricao),
    status: STATUS_OCORRENCIA.ATIVA,
    localizacao: {
      latitude: principal.latitude,
      longitude: principal.longitude,
      featureId: principal.featureId,
      partId: principal.partId,
      codLog: principal.codLog,
      logradouro: principal.logradouro,
      oficial: principal.oficial,
      segmentoAssinatura: principal.segmentoAssinatura,
      fracaoNoEixo: principal.fraction,
      distanciaAoEixoM: principal.distanciaAoEixoM,
    },
    penalidadeMetros,
    criadoPor: uid,
    criadoEm: agoraIso,
    ultimaConfirmacaoEm: agoraIso,
    expiraEm,
    contadores: calcularContadores(interacoes),
    interacoes,
  };

  return {
    ok: true,
    ocorrencia,
    candidatosSegmento: segRes.candidatos,
    temRuasProximas: segRes.temRuasProximas,
  };
}

export function aplicarInteracao(
  ocorrencia,
  { tipo, usuarioId, agora = Date.now() } = {},
) {
  if (!ocorrencia || typeof ocorrencia !== 'object') {
    return {
      ok: false,
      reason: 'OCORRENCIA_NAO_ENCONTRADA',
      message: 'Ocorrência não encontrada.',
    };
  }
  const uid = String(usuarioId || '').trim();
  if (!uid) {
    return {
      ok: false,
      reason: 'USUARIO_NAO_IDENTIFICADO',
      message: 'Identificador do usuário é obrigatório para interagir.',
    };
  }
  const acao = String(tipo || '').trim();
  if (
    acao !== ACOES_COLABORATIVAS.CONFIRMAR &&
    acao !== ACOES_COLABORATIVAS.RESOLVER &&
    acao !== ACOES_COLABORATIVAS.CONTESTAR
  ) {
    return {
      ok: false,
      reason: 'INTERACAO_INVALIDA',
      message: 'Ação inválida. Use confirmar, resolver ou contestar.',
    };
  }

  const interacoesAtuais = Array.isArray(ocorrencia.interacoes)
    ? ocorrencia.interacoes.map((i) => ({ ...i }))
    : [];
  const existenteIdx = interacoesAtuais.findIndex((i) => i.usuarioId === uid);
  if (existenteIdx >= 0 && interacoesAtuais[existenteIdx].tipo === acao) {
    return {
      ok: false,
      duplicada: true,
      reason: 'INTERACAO_DUPLICADA',
      message: 'Você já registrou essa interação para esta ocorrência.',
      ocorrencia,
    };
  }

  const agoraMs = typeof agora === 'number' ? agora : Date.parse(agora) || Date.now();
  const agoraIso = new Date(agoraMs).toISOString();

  if (existenteIdx >= 0) {
    interacoesAtuais[existenteIdx] = { usuarioId: uid, tipo: acao, em: agoraIso };
  } else {
    interacoesAtuais.push({ usuarioId: uid, tipo: acao, em: agoraIso });
  }

  let ultimaConfirmacaoEm = ocorrencia.ultimaConfirmacaoEm;
  let expiraEm = ocorrencia.expiraEm;
  if (acao === ACOES_COLABORATIVAS.CONFIRMAR) {
    ultimaConfirmacaoEm = agoraIso;
    if (ocorrencia.temporalidade === TEMPORALIDADES.TEMPORARIA) {
      const cat = obterCategoriaExibicao(ocorrencia.categoria);
      const ttlHoras = cat?.ttlHoras || 7 * 24;
      expiraEm = new Date(agoraMs + ttlHoras * 3600000).toISOString();
    }
  }

  const atualizada = {
    ...ocorrencia,
    ultimaConfirmacaoEm,
    expiraEm,
    interacoes: interacoesAtuais,
    contadores: calcularContadores(interacoesAtuais),
  };
  atualizada.status = reavaliarStatus(atualizada, agoraMs);

  return {
    ok: true,
    duplicada: false,
    ocorrencia: atualizada,
  };
}

/**
 * Determina como uma ocorrência deve afetar o cálculo segundo as preferências do usuário.
 */
export function ocorrenciaInfluenciaCalculo(occ, preferenciasRaw, agora = Date.now()) {
  const preferencias = normalizarPreferencias(preferenciasRaw);
  const statusAtual = reavaliarStatus(occ, agora);
  if (statusAtual === STATUS_OCORRENCIA.RESOLVIDA || statusAtual === STATUS_OCORRENCIA.EXPIRADA) {
    return { aplica: false, modoEfeito: 'inativa', penalidadeMetros: 0 };
  }

  if (preferencias.modo === MODOS_PREFERENCIA.IGNORAR) {
    return { aplica: false, modoEfeito: 'ignorar', penalidadeMetros: 0 };
  }

  const categoriaEquivalente = normalizarCategoriaLegado(occ.categoria);
  if (
    preferencias.evitarCategorias.includes(occ.categoria) ||
    (categoriaEquivalente && preferencias.evitarCategorias.includes(categoriaEquivalente))
  ) {
    return { aplica: true, modoEfeito: CLASSIFICACOES.EVITA, penalidadeMetros: Infinity };
  }

  if (occ.classificacao === CLASSIFICACOES.EVITA) {
    return { aplica: true, modoEfeito: CLASSIFICACOES.EVITA, penalidadeMetros: Infinity };
  }

  if (occ.classificacao === CLASSIFICACOES.PENALIZA) {
    const base = Number(occ.penalidadeMetros) > 0
      ? Number(occ.penalidadeMetros)
      : (obterCategoriaExibicao(occ.categoria)?.penalidadeMetros || 150);
    const escalaUsuario = ESCALAS_PENALIDADE[preferencias.penalidadePadrao] || 1;
    const fatorPerfil =
      preferencias.modo === MODOS_PREFERENCIA.PRIORIZAR_SEM_DIFICULDADES ? 1.5 : 1;
    const fatorConfianca = statusAtual === STATUS_OCORRENCIA.EM_ANALISE ? 0.5 : 1;
    return {
      aplica: true,
      modoEfeito: CLASSIFICACOES.PENALIZA,
      penalidadeMetros: Math.round(base * escalaUsuario * fatorPerfil * fatorConfianca),
    };
  }

  return { aplica: false, modoEfeito: CLASSIFICACOES.INFORMATIVO, penalidadeMetros: 0 };
}
