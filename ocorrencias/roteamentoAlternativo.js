/**
 * Roteamento alternativo colaborativo (camada pura sobre o motor core/).
 *
 * Princípios:
 *  - NÃO modifica `core/router.js`, `core/graph.js`, `core/rotaParadas.js` ou `core/ordemParadas.js`.
 *  - Cria um grafo derivado leve aplicando penalidades apenas na lista de adjacência
 *    (preservando os comprimentos reais das arestas em `graph.edges`, de modo que a
 *    distância exibida ao usuário seja sempre a distância física real em metros).
 *  - Exclui trechos marcados como `evita` da adjacência e do `edgeIndex` derivado.
 *  - Calcula a rota base e, quando há preferências/ocorrências aplicáveis, a rota
 *    personalizada, devolvendo até 2 alternativas válidas e significativamente distintas
 *    (estilo Google Maps), nunca oferecendo rotas idênticas ou que violem restrições obrigatórias.
 */

import { buildEdgeIndex } from '../core/graph.js';
import { calcularRotaComParadas } from '../core/rotaParadas.js';
import { CLASSIFICACOES, STATUS_OCORRENCIA, obterCategoria } from './catalogo.js';
import { MODOS_PREFERENCIA, normalizarPreferencias } from './preferencias.js';
import {
  atualizarExpiracoes,
  localizarArestasDaOcorrencia,
  ocorrenciaInfluenciaCalculo,
} from './regras.js';

function parseSegmentEdgeId(segId) {
  if (typeof segId === 'number' && Number.isFinite(segId)) return segId;
  if (typeof segId === 'string') {
    if (segId.startsWith('tmp:')) {
      const parts = segId.split(':');
      const n = Number(parts[1]);
      return Number.isFinite(n) ? n : null;
    }
    const n = Number(segId);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function extrairArestasDaRota(rota) {
  const ids = new Set();
  if (!rota || !Array.isArray(rota.legs)) return ids;

  for (const leg of rota.legs) {
    if (Array.isArray(leg.legs)) {
      for (const sub of leg.legs) {
        if (!Array.isArray(sub.segments)) continue;
        for (const s of sub.segments) {
          const parsed = parseSegmentEdgeId(s);
          if (parsed != null) ids.add(parsed);
        }
      }
    } else if (Array.isArray(leg.segments)) {
      for (const s of leg.segments) {
        const parsed = parseSegmentEdgeId(s);
        if (parsed != null) ids.add(parsed);
      }
    }
  }
  return ids;
}

export function resumirOcorrencia(occ, impacto = null) {
  const cat = obterCategoria(occ.categoria);
  return {
    id: occ.id,
    categoria: occ.categoria,
    categoriaLabel: cat?.rotulo || occ.categoria,
    classificacao: occ.classificacao,
    modoEfeito: impacto?.modoEfeito || occ.classificacao,
    penalidadeMetros: impacto?.penalidadeMetros ?? occ.penalidadeMetros ?? 0,
    status: occ.status,
    temporalidade: occ.temporalidade,
    logradouro: occ.localizacao?.logradouro || '',
    latitude: occ.localizacao?.latitude ?? null,
    longitude: occ.localizacao?.longitude ?? null,
    descricao: occ.descricao || '',
    confirmacoes: occ.contadores?.confirmacoes ?? 1,
    ultimaConfirmacaoEm: occ.ultimaConfirmacaoEm || occ.criadoEm || null,
  };
}

/**
 * Constrói índice de impacto por aresta e, quando necessário, um grafo derivado
 * com penalidades/bloqueios aplicados à adjacência.
 */
export function construirGrafoDerivado(graph, ocorrenciasRaw = [], preferenciasRaw = {}, agora = Date.now()) {
  const preferencias = normalizarPreferencias(preferenciasRaw);
  const { ocorrencias } = atualizarExpiracoes(ocorrenciasRaw, agora);

  const ativas = ocorrencias.filter(
    (o) =>
      o.status !== STATUS_OCORRENCIA.RESOLVIDA &&
      o.status !== STATUS_OCORRENCIA.EXPIRADA,
  );

  const mapaArestas = new Map(); // edgeId -> Array<{ occ, impacto }>
  const penalidades = new Map(); // edgeId -> { penalidade, ocorrencias[] }
  const bloqueadas = new Map();  // edgeId -> Array<occ>

  for (const occ of ativas) {
    const impacto = ocorrenciaInfluenciaCalculo(occ, preferencias, agora);
    const arestas = localizarArestasDaOcorrencia(graph, occ);
    for (const edge of arestas) {
      if (!mapaArestas.has(edge.id)) mapaArestas.set(edge.id, []);
      mapaArestas.get(edge.id).push({ occ, impacto });

      if (!impacto.aplica) continue;
      if (impacto.modoEfeito === CLASSIFICACOES.EVITA) {
        if (!bloqueadas.has(edge.id)) bloqueadas.set(edge.id, []);
        bloqueadas.get(edge.id).push(occ);
      } else if (impacto.modoEfeito === CLASSIFICACOES.PENALIZA && impacto.penalidadeMetros > 0) {
        const atual = penalidades.get(edge.id) || { penalidade: 0, ocorrencias: [] };
        atual.penalidade += impacto.penalidadeMetros;
        atual.ocorrencias.push(occ);
        penalidades.set(edge.id, atual);
      }
    }
  }

  // Se uma mesma aresta estiver tanto bloqueada quanto penalizada, o bloqueio prevalece.
  for (const edgeId of bloqueadas.keys()) {
    penalidades.delete(edgeId);
  }

  const precisaDerivado = bloqueadas.size > 0 || penalidades.size > 0;
  if (!precisaDerivado) {
    return {
      graphDerivado: graph,
      alterado: false,
      preferencias,
      ativas,
      mapaArestas,
      bloqueadas,
      penalidades,
    };
  }

  const nosAfetados = new Set();
  for (const edgeId of bloqueadas.keys()) {
    const e = graph.edges[edgeId];
    if (e) {
      nosAfetados.add(e.from);
      nosAfetados.add(e.to);
    }
  }
  for (const edgeId of penalidades.keys()) {
    const e = graph.edges[edgeId];
    if (e) {
      nosAfetados.add(e.from);
      nosAfetados.add(e.to);
    }
  }

  const derivedAdjacency = graph.adjacency.slice();
  for (const nodeId of nosAfetados) {
    const lista = graph.adjacency[nodeId] || [];
    derivedAdjacency[nodeId] = lista
      .filter((link) => !bloqueadas.has(link.edge))
      .map((link) => {
        const pen = penalidades.get(link.edge);
        if (!pen) return link;
        return {
          ...link,
          length: link.length + pen.penalidade,
        };
      });
  }

  let derivedEdgeIndex = graph.edgeIndex;
  if (bloqueadas.size > 0 && graph.nodes?.length) {
    const permitidas = graph.edges.filter((e) => !bloqueadas.has(e.id));
    derivedEdgeIndex = buildEdgeIndex(graph.nodes, permitidas);
  }

  return {
    graphDerivado: {
      ...graph,
      adjacency: derivedAdjacency,
      edgeIndex: derivedEdgeIndex,
    },
    alterado: true,
    preferencias,
    ativas,
    mapaArestas,
    bloqueadas,
    penalidades,
  };
}

export function inspecionarOcorrenciasNaRota(rota, contexto) {
  const edges = extrairArestasDaRota(rota);
  const vistos = new Set();
  const todas = [];
  const informativas = [];
  const penalizadas = [];
  const evitadas = [];

  for (const edgeId of edges) {
    const lista = contexto.mapaArestas.get(edgeId);
    if (!lista) continue;
    for (const { occ, impacto } of lista) {
      if (vistos.has(occ.id)) continue;
      vistos.add(occ.id);
      const resumo = resumirOcorrencia(occ, impacto);
      todas.push(resumo);
      if (impacto.modoEfeito === CLASSIFICACOES.EVITA) {
        evitadas.push(resumo);
      } else if (impacto.modoEfeito === CLASSIFICACOES.PENALIZA) {
        penalizadas.push(resumo);
      } else if (occ.classificacao === CLASSIFICACOES.INFORMATIVO || impacto.modoEfeito === CLASSIFICACOES.INFORMATIVO) {
        informativas.push(resumo);
      }
    }
  }

  return { todas, informativas, penalizadas, evitadas };
}

function diferencaEntreRotas(graph, rotaA, rotaB) {
  const edgesA = extrairArestasDaRota(rotaA);
  const edgesB = extrairArestasDaRota(rotaB);

  let intersecao = 0;
  let exclusivasA = 0;
  let exclusivasB = 0;
  let extensaoExclusiva = 0;

  for (const id of edgesA) {
    if (edgesB.has(id)) {
      intersecao++;
    } else {
      exclusivasA++;
      extensaoExclusiva += graph.edges[id]?.length || 0;
    }
  }
  for (const id of edgesB) {
    if (!edgesA.has(id)) {
      exclusivasB++;
      extensaoExclusiva += graph.edges[id]?.length || 0;
    }
  }

  const mesmaSequencia =
    JSON.stringify(rotaA?.sequencia || []) === JSON.stringify(rotaB?.sequencia || []);
  const mesmoConjunto = exclusivasA === 0 && exclusivasB === 0 && mesmaSequencia;
  const maxDist = Math.max(rotaA?.distance || 0, rotaB?.distance || 0, 1);
  const fracaoDiferente = exclusivasA === 0 && exclusivasB === 0 ? 0 : extensaoExclusiva / maxDist;

  return {
    mesmoConjunto,
    intersecao,
    exclusivasA,
    exclusivasB,
    extensaoExclusivaM: Math.round(extensaoExclusiva),
    fracaoDiferente,
  };
}

function formatarResumoLista(lista) {
  if (!lista.length) return '';
  if (lista.length === 1) {
    const o = lista[0];
    return `${o.categoriaLabel}${o.logradouro ? ` (${o.logradouro})` : ''}`;
  }
  return `${lista.length} ocorrências (${lista.slice(0, 2).map((o) => o.categoriaLabel).join(', ')}${lista.length > 2 ? '…' : ''})`;
}

/**
 * Calcula a rota padrão e, quando aplicável, a rota personalizada / alternativa,
 * retornando o payload completo pronto para Web, API e APK.
 */
export function calcularRotaComAlternativas(graph, pontos, options = {}) {
  const agora = options.agora ?? Date.now();
  const preferencias = normalizarPreferencias(options.preferencias);
  const ocorrencias = Array.isArray(options.ocorrencias) ? options.ocorrencias : [];

  const contexto = construirGrafoDerivado(graph, ocorrencias, preferencias, agora);
  const baseOpts = {
    modo: options.modo,
    circular: options.circular,
    maxSnapDistance: options.maxSnapDistance,
    algorithm: options.algorithm,
  };

  // 1. Rota base (sem penalidades/restrições colaborativas)
  const rotaBase = calcularRotaComParadas(graph, pontos, baseOpts);
  if (!rotaBase.ok) {
    return {
      ...rotaBase,
      preferenciasAplicadas: preferencias,
      rotaSelecionadaId: null,
      rotas: [],
      comparacaoAlternativas: {
        existemAlternativas: false,
        motivoSemAlternativa: rotaBase.message,
        totalOcorrenciasAtivas: contexto.ativas.length,
        totalOcorrenciasConsideradas: 0,
        bloqueadaPorRestricao: false,
        ocorrenciasBloqueantes: [],
      },
    };
  }

  const inspBase = inspecionarOcorrenciasNaRota(rotaBase, contexto);

  // Modo ignorar ou nenhuma ocorrência ativa influenciando o cálculo -> apenas rota única
  if (preferencias.modo === MODOS_PREFERENCIA.IGNORAR || !contexto.alterado) {
    const infoTexto =
      inspBase.informativas.length > 0
        ? `${inspBase.informativas.length} alerta(s) informativo(s) ao longo do trajeto.`
        : preferencias.modo === MODOS_PREFERENCIA.IGNORAR
          ? 'Preferência configurada para ignorar alertas colaborativos.'
          : 'Nenhuma ocorrência penalizada ou restritiva afeta este trajeto.';

    const cardUnica = {
      id: 'unica',
      rotulo: 'Rota principal',
      recomendada: true,
      distance: rotaBase.distance,
      distanceMeters: rotaBase.distanceMeters,
      distanceKm: rotaBase.distanceKm,
      diferencaMetros: 0,
      motivo: infoTexto,
      ocorrenciasNoTrajeto: inspBase.todas,
      ocorrenciasEvitadas: [],
      violacoesObrigatorias: 0,
      rota: rotaBase,
    };

    return {
      ...rotaBase,
      preferenciasAplicadas: preferencias,
      rotaSelecionadaId: 'unica',
      rotas: [cardUnica],
      comparacaoAlternativas: {
        existemAlternativas: false,
        motivoSemAlternativa: infoTexto,
        totalOcorrenciasAtivas: contexto.ativas.length,
        totalOcorrenciasConsideradas: 0,
        bloqueadaPorRestricao: false,
        ocorrenciasBloqueantes: [],
      },
    };
  }

  // 2. Rota personalizada (com penalidades e bloqueios aplicados)
  const rotaPers = calcularRotaComParadas(contexto.graphDerivado, pontos, baseOpts);

  // 2a. Falha por restrição obrigatória (`evita`)
  if (!rotaPers.ok) {
    const bloqueantes = inspBase.evitadas.length
      ? inspBase.evitadas
      : [...contexto.bloqueadas.values()].flat().map((o) => resumirOcorrencia(o, { modoEfeito: CLASSIFICACOES.EVITA }));
    const resumoBloq = formatarResumoLista(bloqueantes);
    return {
      ok: false,
      reason: 'BLOQUEADO_POR_OCORRENCIA',
      message:
        `Não há caminho alternativo compatível sem passar por trecho marcado para evitar` +
        (resumoBloq ? `: ${resumoBloq}.` : '.'),
      legs: [],
      distance: 0,
      distanceMeters: 0,
      distanceKm: 0,
      geometry: { type: 'LineString', coordinates: [] },
      modo: rotaBase.modo,
      circular: rotaBase.circular,
      preferenciasAplicadas: preferencias,
      rotaSelecionadaId: null,
      rotas: [],
      ocorrenciasBloqueantes: bloqueantes,
      comparacaoAlternativas: {
        existemAlternativas: false,
        motivoSemAlternativa:
          'Todas as rotas possíveis cruzam uma ocorrência marcada como "Evita o trecho".',
        totalOcorrenciasAtivas: contexto.ativas.length,
        totalOcorrenciasConsideradas: contexto.bloqueadas.size + contexto.penalidades.size,
        bloqueadaPorRestricao: true,
        ocorrenciasBloqueantes: bloqueantes,
      },
    };
  }

  const inspPers = inspecionarOcorrenciasNaRota(rotaPers, contexto);

  // Segurança extra: se por qualquer razão de divisão de aresta na origem/destino a rota
  // personalizada ainda cruza uma ocorrência `evita`, recusamos como rota válida.
  if (inspPers.evitadas.length > 0) {
    const resumoBloq = formatarResumoLista(inspPers.evitadas);
    return {
      ok: false,
      reason: 'BLOQUEADO_POR_OCORRENCIA',
      message:
        `A origem ou destino exige passar por trecho marcado para evitar: ${resumoBloq}.`,
      legs: [],
      distance: 0,
      distanceMeters: 0,
      distanceKm: 0,
      geometry: { type: 'LineString', coordinates: [] },
      modo: rotaBase.modo,
      circular: rotaBase.circular,
      preferenciasAplicadas: preferencias,
      rotaSelecionadaId: null,
      rotas: [],
      ocorrenciasBloqueantes: inspPers.evitadas,
      comparacaoAlternativas: {
        existemAlternativas: false,
        motivoSemAlternativa:
          'O ponto informado está diretamente sobre um trecho marcado para evitar.',
        totalOcorrenciasAtivas: contexto.ativas.length,
        totalOcorrenciasConsideradas: contexto.bloqueadas.size + contexto.penalidades.size,
        bloqueadaPorRestricao: true,
        ocorrenciasBloqueantes: inspPers.evitadas,
      },
    };
  }

  const idsPers = new Set(inspPers.todas.map((o) => o.id));
  const evitadasPelaPers = inspBase.todas.filter(
    (o) =>
      !idsPers.has(o.id) &&
      (o.modoEfeito === CLASSIFICACOES.PENALIZA || o.modoEfeito === CLASSIFICACOES.EVITA),
  );

  const diff = diferencaEntreRotas(graph, rotaBase, rotaPers);
  const baseViolaObrigatoria = inspBase.evitadas.length > 0;
  const saoEquivalentes =
    diff.mesmoConjunto ||
    (evitadasPelaPers.length === 0 && !baseViolaObrigatoria && diff.extensaoExclusivaM < 15);

  // 3. Rota única (ou porque ambas coincidem, ou porque a padrão viola restrição obrigatória)
  if (saoEquivalentes || baseViolaObrigatoria) {
    const deltaM = Math.max(0, Math.round(rotaPers.distance - rotaBase.distance));
    let motivo;
    if (baseViolaObrigatoria && evitadasPelaPers.length > 0) {
      motivo = `Desvio obrigatório para evitar ${formatarResumoLista(evitadasPelaPers)}${deltaM > 0 ? ` (+${deltaM} m)` : ''}.`;
    } else if (inspPers.penalizadas.length > 0) {
      motivo = `Não existe desvio mais vantajoso; o trajeto passa por ${formatarResumoLista(inspPers.penalizadas)}.`;
    } else if (inspPers.informativas.length > 0) {
      motivo = `${inspPers.informativas.length} alerta(s) informativo(s) no trajeto.`;
    } else {
      motivo = 'Nenhuma ocorrência influenciou o traçado desta rota.';
    }

    const cardUnica = {
      id: 'unica',
      rotulo: baseViolaObrigatoria ? 'Rota compatível' : 'Rota principal',
      recomendada: true,
      distance: rotaPers.distance,
      distanceMeters: rotaPers.distanceMeters,
      distanceKm: rotaPers.distanceKm,
      diferencaMetros: 0,
      motivo,
      ocorrenciasNoTrajeto: inspPers.todas,
      ocorrenciasEvitadas: evitadasPelaPers,
      violacoesObrigatorias: 0,
      rota: rotaPers,
    };

    return {
      ...rotaPers,
      preferenciasAplicadas: preferencias,
      rotaSelecionadaId: 'unica',
      rotas: [cardUnica],
      comparacaoAlternativas: {
        existemAlternativas: false,
        motivoSemAlternativa: baseViolaObrigatoria
          ? 'O trajeto mais curto viola ocorrência marcada para evitar e não é exibido como alternativa válida.'
          : motivo,
        totalOcorrenciasAtivas: contexto.ativas.length,
        totalOcorrenciasConsideradas: contexto.bloqueadas.size + contexto.penalidades.size,
        bloqueadaPorRestricao: false,
        ocorrenciasBloqueantes: [],
      },
    };
  }

  // 4. Duas rotas válidas e significativamente distintas (estilo Google Maps)
  const minDist = Math.min(rotaBase.distance, rotaPers.distance);
  const deltaPers = Math.round(rotaPers.distance - minDist);
  const deltaBase = Math.round(rotaBase.distance - minDist);

  const cardRecomendada = {
    id: 'recomendada',
    rotulo: 'Rota recomendada',
    recomendada: true,
    distance: rotaPers.distance,
    distanceMeters: rotaPers.distanceMeters,
    distanceKm: rotaPers.distanceKm,
    diferencaMetros: deltaPers,
    motivo:
      evitadasPelaPers.length > 0
        ? `Desvia de ${formatarResumoLista(evitadasPelaPers)}${deltaPers > 0 ? ` (+${deltaPers} m)` : ''}`
        : 'Melhor equilíbrio conforme suas preferências de trajeto',
    ocorrenciasNoTrajeto: inspPers.todas,
    ocorrenciasEvitadas: evitadasPelaPers,
    violacoesObrigatorias: 0,
    rota: rotaPers,
  };

  const cardAlternativa = {
    id: 'padrao',
    rotulo: 'Mais curta (com alertas)',
    recomendada: false,
    distance: rotaBase.distance,
    distanceMeters: rotaBase.distanceMeters,
    distanceKm: rotaBase.distanceKm,
    diferencaMetros: deltaBase,
    motivo: `Passa por ${formatarResumoLista(inspBase.penalizadas.length ? inspBase.penalizadas : evitadasPelaPers)}`,
    ocorrenciasNoTrajeto: inspBase.todas,
    ocorrenciasEvitadas: [],
    violacoesObrigatorias: 0,
    rota: rotaBase,
  };

  return {
    ...rotaPers,
    preferenciasAplicadas: preferencias,
    rotaSelecionadaId: 'recomendada',
    rotas: [cardRecomendada, cardAlternativa],
    comparacaoAlternativas: {
      existemAlternativas: true,
      motivoSemAlternativa: null,
      totalOcorrenciasAtivas: contexto.ativas.length,
      totalOcorrenciasConsideradas: contexto.bloqueadas.size + contexto.penalidades.size,
      bloqueadaPorRestricao: false,
      ocorrenciasBloqueantes: [],
    },
  };
}
