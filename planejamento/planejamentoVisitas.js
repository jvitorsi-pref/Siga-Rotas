/**
 * planejamento/planejamentoVisitas.js
 * ---------------------------------------------------------------------------
 * Inteligência de organização de visitas domiciliares (pre-batching e
 * sugestões oportunísticas de visitas próximas) para Agentes Comunitários de
 * Saúde (ACS).
 *
 * Regras essenciais:
 *  - NÃO altera o motor `core/` (usa apenas leitura de `core/geo.js` e
 *    `core/router.js` quando o grafo está disponível);
 *  - Visitas oportunísticas são SEMPRE sugestões contextuais: nunca são
 *    inseridas automaticamente na rota sem confirmação explícita do ACS;
 *  - NÃO inventa critérios, pesos ou pontuações clínicas/médicas: fornece uma
 *    interface de extensão limpa (`avaliadorClinico`) para acoplamento futuro
 *    de regras oficiais (ex.: hipertensão, diabetes, prioridade clínica);
 *  - Quando a data da última visita está ausente, informa essa limitação de
 *    forma transparente em vez de assumir ou simular datas.
 */

import { dist, project } from '../core/geo.js';
import { routeOnGraph } from '../core/router.js';
import {
  PRIORIDADE_CRONOGRAMA,
  STATUS_VISITA,
  criarPeriodoPlanejamento,
  criarPlanoVisitasVazio,
  diasEntreDatas,
  formatarDataIsoDia,
  normalizarPeriodoPlanejamento,
  normalizarStatusVisita,
  normalizarTextoChave,
} from './modeloVisitas.js';

const PESO_PRIORIDADE_CRONOGRAMA = Object.freeze({
  [PRIORIDADE_CRONOGRAMA.ALTA]: 30,
  [PRIORIDADE_CRONOGRAMA.MEDIA]: 15,
  [PRIORIDADE_CRONOGRAMA.BAIXA]: 5,
});

function hojeIsoDe(agora = Date.now()) {
  return formatarDataIsoDia(new Date(agora)) || '2026-01-01';
}

export function calcularDiasSemVisita(ultimaVisitaEm, agora = Date.now()) {
  const iso = formatarDataIsoDia(ultimaVisitaEm);
  if (!iso) return null;
  const diff = diasEntreDatas(iso, hojeIsoDe(agora));
  if (diff == null) return null;
  return Math.max(0, diff);
}

/**
 * Cria o avaliador extensível de prioridade de visitas.
 * Hoje considera somente critérios objetivos e não clínicos:
 *   1. Pendência / visita não realizada no período;
 *   2. Tempo desde a última visita (quando informado);
 *   3. Prioridade definida pelo próprio cronograma importado;
 *   4. Proximidade / custo de desvio geográfico ou viário.
 *
 * Para integração futura de regras clínicas oficiais, injete `avaliadorClinico`:
 *   `{ id, rotulo, avaliar(visita, contexto) => { ajustePontuacao, etiquetas, motivo } }`
 */
export function criarMotorPrioridadeVisitas({ avaliadorClinico = null } = {}) {
  const clinicoAtivo =
    Boolean(avaliadorClinico) && typeof avaliadorClinico.avaliar === 'function';

  function avaliar(visita, contexto = {}) {
    const agora = contexto.agora ?? Date.now();
    const diasSemVisita = calcularDiasSemVisita(visita?.ultimaVisitaEm, agora);
    const lacunasDados = [];

    let pontuacao = 0;
    const fatores = [];

    if (visita?.status === STATUS_VISITA.NAO_REALIZADA) {
      pontuacao += 25;
      fatores.push('Visita anterior não realizada (pendente)');
    } else if (visita?.planejada && visita?.status === STATUS_VISITA.PLANEJADA) {
      pontuacao += 20;
      fatores.push('No cronograma do período');
    } else if (visita?.status !== STATUS_VISITA.REALIZADA) {
      pontuacao += 10;
      fatores.push('Cadastro territorial pendente de visita');
    }

    const prio = visita?.prioridadeCronograma || PRIORIDADE_CRONOGRAMA.MEDIA;
    pontuacao += PESO_PRIORIDADE_CRONOGRAMA[prio] || 15;
    if (prio === PRIORIDADE_CRONOGRAMA.ALTA) {
      fatores.push('Prioridade alta no cronograma');
    }

    if (diasSemVisita != null) {
      const pontosTempo = Math.min(40, Math.round(diasSemVisita * 0.6));
      pontuacao += pontosTempo;
      fatores.push(`${diasSemVisita} dia(s) sem visita`);
    } else {
      lacunasDados.push('Data da última visita não informada');
    }

    const distanciaMetros = Number.isFinite(contexto.distanciaMetros)
      ? Math.max(0, Math.round(contexto.distanciaMetros))
      : null;
    if (distanciaMetros != null) {
      const raioRef = Math.max(100, Number(contexto.raioMetros) || 400);
      const bonusProx = Math.max(0, Math.round(35 * (1 - Math.min(1, distanciaMetros / (raioRef * 1.4)))));
      pontuacao += bonusProx;
    }

    let etiquetasClinicas = [];
    if (clinicoAtivo) {
      const ext = avaliadorClinico.avaliar(visita, contexto) || {};
      if (Number.isFinite(ext.ajustePontuacao)) {
        pontuacao += ext.ajustePontuacao;
      }
      if (Array.isArray(ext.etiquetas)) {
        etiquetasClinicas = ext.etiquetas;
      }
      if (ext.motivo) {
        fatores.push(String(ext.motivo));
      }
    } else {
      lacunasDados.push('Critérios clínicos oficiais ainda não configurados');
    }

    return {
      pontuacao,
      diasSemVisita,
      distanciaMetros,
      criteriosClinicosAtivos: clinicoAtivo,
      etiquetasClinicas,
      fatores,
      lacunasDados,
    };
  }

  return {
    criteriosClinicosAtivos: clinicoAtivo,
    avaliadorClinicoId: clinicoAtivo ? avaliadorClinico.id || 'externo' : null,
    avaliar,
  };
}

export function visitaDentroDoPeriodo(visita, periodo) {
  if (!visita?.dataPrevista) return true; // visitas sem data explícita permanecem disponíveis no plano
  if (!periodo?.dataInicio || !periodo?.dataFim) return true;
  const d = formatarDataIsoDia(visita.dataPrevista);
  if (!d) return true;
  return d >= periodo.dataInicio && d <= periodo.dataFim;
}

/**
 * Organiza a fila principal de visitas do ACS para o período configurado,
 * diferenciando planejadas/prioritárias, realizadas, não realizadas e base
 * territorial elegível para aproveitamento oportunístico.
 */
export function organizarCronogramaVisitas(
  plano,
  {
    periodo = null,
    pontoReferencia = null,
    avaliadorClinico = null,
    agora = Date.now(),
  } = {},
) {
  const lista = Array.isArray(plano?.visitas) ? plano.visitas : [];
  const periodoEfetivo = criarPeriodoPlanejamento(
    periodo || plano?.periodo || {},
    agora,
  );
  const motor = criarMotorPrioridadeVisitas({ avaliadorClinico });

  const planejadasNoPeriodo = [];
  const planejadasForaPeriodo = [];
  const baseTerritorial = [];
  const realizadas = [];
  const naoRealizadas = [];

  const refXY =
    pontoReferencia &&
    Number.isFinite(Number(pontoReferencia.latitude)) &&
    Number.isFinite(Number(pontoReferencia.longitude))
      ? project(Number(pontoReferencia.longitude), Number(pontoReferencia.latitude))
      : null;

  for (const v of lista) {
    let distRef = null;
    if (refXY && Number.isFinite(v.latitude) && Number.isFinite(v.longitude)) {
      const [vx, vy] = project(v.longitude, v.latitude);
      distRef = Math.round(dist(refXY[0], refXY[1], vx, vy));
    }
    const aval = motor.avaliar(v, { agora, distanciaMetros: distRef });
    const enriquecida = {
      ...v,
      diasSemVisita: aval.diasSemVisita,
      distanciaReferenciaMetros: distRef,
      pontuacaoPlanejamento: aval.pontuacao,
      fatoresPrioridade: aval.fatores,
      lacunasDados: aval.lacunasDados,
      criteriosClinicosAtivos: aval.criteriosClinicosAtivos,
    };

    if (v.status === STATUS_VISITA.REALIZADA) {
      realizadas.push(enriquecida);
    } else if (v.status === STATUS_VISITA.NAO_REALIZADA) {
      naoRealizadas.push(enriquecida);
    } else if (!v.planejada) {
      baseTerritorial.push(enriquecida);
    } else if (visitaDentroDoPeriodo(v, periodoEfetivo)) {
      planejadasNoPeriodo.push(enriquecida);
    } else {
      planejadasForaPeriodo.push(enriquecida);
    }
  }

  const ordenarPorPrioridadeEDistancia = (a, b) => {
    if (b.pontuacaoPlanejamento !== a.pontuacaoPlanejamento) {
      return b.pontuacaoPlanejamento - a.pontuacaoPlanejamento;
    }
    const da = a.distanciaReferenciaMetros ?? Number.MAX_SAFE_INTEGER;
    const db = b.distanciaReferenciaMetros ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
  };

  planejadasNoPeriodo.sort(ordenarPorPrioridadeEDistancia);
  naoRealizadas.sort(ordenarPorPrioridadeEDistancia);
  baseTerritorial.sort(ordenarPorPrioridadeEDistancia);

  return {
    periodo: periodoEfetivo,
    criteriosClinicosAtivos: motor.criteriosClinicosAtivos,
    planejadasNoPeriodo,
    planejadasForaPeriodo,
    naoRealizadas,
    realizadas,
    baseTerritorial,
    resumo: {
      total: lista.length,
      pendentesPeriodo: planejadasNoPeriodo.length,
      naoRealizadas: naoRealizadas.length,
      realizadas: realizadas.length,
      baseTerritorial: baseTerritorial.length,
      foraDoPeriodo: planejadasForaPeriodo.length,
    },
  };
}

function extrairPontosAtivosRota(rotaAtiva) {
  if (!Array.isArray(rotaAtiva)) return [];
  return rotaAtiva.filter(
    (p) => p && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)),
  );
}

function jaEstaNaRota(visita, pontosRota) {
  if (!pontosRota.length) return false;
  const nomeV = normalizarTextoChave(visita.nome);
  for (const p of pontosRota) {
    if (p.visitaId && p.visitaId === visita.id) return true;
    if (p.pacienteId && visita.pacienteId && p.pacienteId === visita.pacienteId) return true;
    const dLat = Math.abs(Number(p.latitude) - Number(visita.latitude));
    const dLon = Math.abs(Number(p.longitude) - Number(visita.longitude));
    if (dLat < 0.00008 && dLon < 0.00008 && (!p.rotulo || normalizarTextoChave(p.rotulo).includes(nomeV))) {
      return true;
    }
  }
  return false;
}

/**
 * Identifica sugestões oportunísticas próximas a um ponto âncora (ex.: visita
 * marcada como não realizada, posição atual do ACS ou parada selecionada),
 * sem nunca alterar automaticamente a rota do usuário.
 */
export function sugerirVisitasOportunisticas(
  plano,
  {
    pontoAncora = null,
    rotaAtiva = [],
    visitaNaoRealizada = null,
    raioMetros = 450,
    limite = 5,
    graph = null,
    avaliadorClinico = null,
    incluirForaDoPeriodo = true,
    agora = Date.now(),
  } = {},
) {
  const visitas = Array.isArray(plano?.visitas) ? plano.visitas : [];
  if (!visitas.length) return [];

  const ancora =
    pontoAncora &&
    Number.isFinite(Number(pontoAncora.latitude)) &&
    Number.isFinite(Number(pontoAncora.longitude))
      ? {
          latitude: Number(pontoAncora.latitude),
          longitude: Number(pontoAncora.longitude),
        }
      : visitaNaoRealizada &&
          Number.isFinite(Number(visitaNaoRealizada.latitude)) &&
          Number.isFinite(Number(visitaNaoRealizada.longitude))
        ? {
            latitude: Number(visitaNaoRealizada.latitude),
            longitude: Number(visitaNaoRealizada.longitude),
          }
        : null;

  if (!ancora) return [];

  const pontosRota = extrairPontosAtivosRota(rotaAtiva);
  const [ax, ay] = project(ancora.longitude, ancora.latitude);
  const motor = criarMotorPrioridadeVisitas({ avaliadorClinico });
  const periodo = plano?.periodo;

  const preCandidatos = [];
  for (const v of visitas) {
    if (v.status === STATUS_VISITA.REALIZADA) continue;
    if (visitaNaoRealizada && v.id === visitaNaoRealizada.id) continue;
    if (jaEstaNaRota(v, pontosRota)) continue;
    if (!incluirForaDoPeriodo && v.planejada && !visitaDentroDoPeriodo(v, periodo)) continue;
    if (!Number.isFinite(v.latitude) || !Number.isFinite(v.longitude)) continue;

    const [vx, vy] = project(v.longitude, v.latitude);
    const distLinha = dist(ax, ay, vx, vy);
    // Pré-filtro generoso em linha reta antes de consultar o grafo viário real
    if (distLinha > raioMetros * 1.6) continue;
    preCandidatos.push({ visita: v, distLinha });
  }

  preCandidatos.sort((a, b) => a.distLinha - b.distLinha);
  const candidatosAvaliacao = preCandidatos.slice(0, 15);
  const sugestoes = [];

  for (const cand of candidatosAvaliacao) {
    const v = cand.visita;
    let distanciaMetros = Math.round(cand.distLinha);
    let tipoDistancia = 'linha_reta';

    if (graph && Array.isArray(graph.edges) && graph.edges.length) {
      const r = routeOnGraph(
        graph,
        { lat: ancora.latitude, lon: ancora.longitude },
        { lat: v.latitude, lon: v.longitude },
      );
      if (r?.ok && Number.isFinite(r.distance)) {
        distanciaMetros = Math.round(r.distance);
        tipoDistancia = 'malha_viaria';
      }
    }

    if (distanciaMetros > raioMetros) continue;

    const aval = motor.avaliar(v, { agora, distanciaMetros, raioMetros });
    const partesMotivo = [
      `${distanciaMetros} m ${tipoDistancia === 'malha_viaria' ? 'pela via' : 'aprox.'}`,
    ];
    if (aval.diasSemVisita != null) {
      partesMotivo.push(`${aval.diasSemVisita}d sem visita`);
    } else {
      partesMotivo.push('última visita não informada');
    }
    if (v.status === STATUS_VISITA.NAO_REALIZADA) {
      partesMotivo.push('não realizada anteriormente');
    } else if (v.planejada) {
      partesMotivo.push('no cronograma');
    } else {
      partesMotivo.push('cadastro próximo');
    }

    sugestoes.push({
      visitaId: v.id,
      pacienteId: v.pacienteId,
      visita: v,
      statusVisual: STATUS_VISITA.OPORTUNISTICA_SUGERIDA,
      origemSugestao: 'oportunistica',
      distanciaMetros,
      tipoDistancia,
      diasSemVisita: aval.diasSemVisita,
      pontuacao: aval.pontuacao,
      motivoResumo: partesMotivo.join(' · '),
      lacunasDados: aval.lacunasDados,
      criteriosClinicosAtivos: aval.criteriosClinicosAtivos,
    });
  }

  sugestoes.sort((a, b) => {
    if (b.pontuacao !== a.pontuacao) return b.pontuacao - a.pontuacao;
    return a.distanciaMetros - b.distanciaMetros;
  });

  return sugestoes.slice(0, Math.max(1, limite));
}

/**
 * Pré-computa vizinhos próximos (pre-batching) para cada visita planejada,
 * acelerando sugestões imediatas em campo mesmo sem recálculo pesado.
 */
export function precomputarProximidades(
  plano,
  { raioMetros = 400, limitePorVisita = 3, graph = null, agora = Date.now() } = {},
) {
  const visitas = Array.isArray(plano?.visitas) ? plano.visitas : [];
  const mapa = {};
  for (const v of visitas) {
    if (!v.planejada || v.status === STATUS_VISITA.REALIZADA) continue;
    mapa[v.id] = sugerirVisitasOportunisticas(plano, {
      pontoAncora: { latitude: v.latitude, longitude: v.longitude },
      visitaNaoRealizada: v,
      raioMetros,
      limite: limitePorVisita,
      graph,
      agora,
    });
  }
  return mapa;
}

export function atualizarStatusVisita(
  plano,
  visitaId,
  novoStatus,
  { observacao = null, agora = Date.now() } = {},
) {
  if (!plano || !Array.isArray(plano.visitas)) return plano;
  const agoraIso = new Date(agora).toISOString();
  const diaHoje = hojeIsoDe(agora);
  let pacienteAtualizadoId = null;

  const visitas = plano.visitas.map((v) => {
    if (v.id !== visitaId) return v;
    pacienteAtualizadoId = v.pacienteId;
    return {
      ...v,
      status: novoStatus,
      ultimaVisitaEm:
        novoStatus === STATUS_VISITA.REALIZADA ? diaHoje : v.ultimaVisitaEm,
      concluidaEm: novoStatus === STATUS_VISITA.REALIZADA ? agoraIso : v.concluidaEm,
      observacoes: observacao != null ? String(observacao).trim() : v.observacoes,
      atualizadoEm: agoraIso,
    };
  });

  const pacientes = (plano.pacientes || []).map((p) => {
    if (!pacienteAtualizadoId || p.id !== pacienteAtualizadoId) return p;
    if (novoStatus !== STATUS_VISITA.REALIZADA) return p;
    return {
      ...p,
      ultimaVisitaEm: diaHoje,
      atualizadoEm: agoraIso,
    };
  });

  return {
    ...plano,
    atualizadoEm: agoraIso,
    pacientes,
    visitas,
  };
}

/**
 * Converte uma visita/paciente do planejamento para o formato padrão de parada
 * consumido por `core/pontoTrajeto.js` e `core/rotaParadas.js`.
 */
export function converterVisitaParaPontoTrajeto(visita, rotulo = 'Parada') {
  if (!visita || !Number.isFinite(visita.latitude) || !Number.isFinite(visita.longitude)) {
    return null;
  }
  const codigo = visita.enderecoDigital || visita.codigoCompleto || '';
  return {
    rotulo: `${rotulo} · ${visita.nome}`,
    nomePaciente: visita.nome,
    visitaId: visita.id,
    pacienteId: visita.pacienteId || null,
    enderecoDigital: codigo,
    codigoNormalizado: codigo,
    codigoCompleto: visita.codigoCompleto || codigo,
    latitude: Number(visita.latitude),
    longitude: Number(visita.longitude),
    origem: 'planejamento',
    status: 'CONVERTIDO',
    mensagem: visita.enderecoTexto
      ? `Visita: ${visita.nome} (${visita.enderecoTexto})`
      : `Visita: ${visita.nome}`,
  };
}

export function planejarVisitasPeriodo(
  pacientesOuRegistros = [],
  { periodo = 'semanal', origemCoord = null, visitasAnteriores = [], agora = Date.now() } = {},
) {
  const periodoNorm = normalizarPeriodoPlanejamento(periodo);
  const planoBase = criarPlanoVisitasVazio({ tipo: periodoNorm }, agora);
  const antPorPaciente = new Map();
  for (const v of visitasAnteriores || []) {
    if (v?.pacienteId) antPorPaciente.set(v.pacienteId, v);
    if (v?.id) antPorPaciente.set(v.id, v);
  }

  planoBase.pacientes = Array.isArray(pacientesOuRegistros) ? [...pacientesOuRegistros] : [];
  planoBase.visitas = planoBase.pacientes
    .filter((p) => p && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)))
    .map((p, idx) => {
      const pacId = p.id || p.idPaciente || `pac-${idx + 1}`;
      const prev = antPorPaciente.get(pacId);
      const statusBase = prev?.status
        ? normalizarStatusVisita(prev.status)
        : normalizarStatusVisita(p.status, { planejada: p.planejada !== false });
      return {
        id: prev?.id || `vis-${pacId}`,
        pacienteId: pacId,
        chaveDeduplicacao: p.chaveDeduplicacao || pacId,
        idPaciente: p.idPaciente || pacId,
        nome: p.nome || `Paciente ${idx + 1}`,
        enderecoDigital: p.enderecoDigital || '',
        codigoCompleto: p.codigoCompleto || p.enderecoDigital || '',
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        enderecoTexto: p.enderecoTexto || '',
        microarea: p.microarea || '',
        dataPrevista: p.dataPrevista ?? prev?.dataPrevista ?? null,
        ultimaVisitaEm: p.ultimaVisitaEm ?? prev?.ultimaVisitaEm ?? null,
        prioridadeCronograma: p.prioridadeCronograma || PRIORIDADE_CRONOGRAMA.MEDIA,
        planejada: p.planejada !== false,
        status: statusBase,
        observacoes: p.observacoes || prev?.observacoes || '',
        atualizadoEm: prev?.atualizadoEm || new Date(agora).toISOString(),
      };
    });

  const org = organizarCronogramaVisitas(planoBase, {
    periodo: planoBase.periodo,
    pontoReferencia: origemCoord,
    agora,
  });

  const formatar = (v) => ({
    ...v,
    pontuacaoPrioridade: v.pontuacaoPlanejamento ?? 0,
    motivosPrioridade: Array.isArray(v.fatoresPrioridade) ? v.fatoresPrioridade : [],
  });

  const visitasOrdenadas = [
    ...org.naoRealizadas.map(formatar),
    ...org.planejadasNoPeriodo.map(formatar),
    ...org.baseTerritorial.map(formatar),
    ...org.planejadasForaPeriodo.map(formatar),
    ...org.realizadas.map(formatar),
  ];

  return {
    ...planoBase,
    periodo: periodoNorm,
    periodoInfo: org.periodo,
    resumo: org.resumo,
    visitas: visitasOrdenadas,
  };
}

function extrairAmostraCoordenadas(geometry) {
  const coords = [];
  if (!geometry) return coords;
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    coords.push(...geometry.coordinates);
  } else if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    for (const part of geometry.coordinates) {
      if (Array.isArray(part)) coords.push(...part);
    }
  }
  if (coords.length <= 12) return coords;
  const passo = Math.max(1, Math.floor(coords.length / 12));
  const amostra = [];
  for (let i = 0; i < coords.length; i += passo) amostra.push(coords[i]);
  amostra.push(coords[coords.length - 1]);
  return amostra;
}

export function sugerirVisitasProximasAoTrajeto({
  pacientes = [],
  visitasPlanejadas = [],
  routeGeometry = null,
  pontoAncora = null,
  rotaAtiva = [],
  raioMetros = 220,
  limite = 5,
  graph = null,
  agora = Date.now(),
} = {}) {
  const porPaciente = new Map();
  for (const v of visitasPlanejadas || []) {
    if (v) porPaciente.set(v.pacienteId || v.id, v);
  }
  const visitasCandidatas = [];
  for (const v of visitasPlanejadas || []) {
    if (v && v.status !== STATUS_VISITA.REALIZADA) visitasCandidatas.push(v);
  }
  for (const p of pacientes || []) {
    const pacId = p?.id || p?.idPaciente;
    if (!p || !pacId || porPaciente.has(pacId)) continue;
    if (!Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude))) continue;
    visitasCandidatas.push({
      id: `sug-${pacId}`,
      pacienteId: pacId,
      nome: p.nome,
      enderecoDigital: p.enderecoDigital || '',
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      ultimaVisitaEm: p.ultimaVisitaEm ?? null,
      prioridadeCronograma: p.prioridadeCronograma || PRIORIDADE_CRONOGRAMA.MEDIA,
      planejada: false,
      status: STATUS_VISITA.PLANEJADA,
    });
  }

  if (!visitasCandidatas.length) return [];
  const planoTemp = { visitas: visitasCandidatas };

  const ancoras = [];
  if (pontoAncora && Number.isFinite(Number(pontoAncora.latitude)) && Number.isFinite(Number(pontoAncora.longitude))) {
    ancoras.push(pontoAncora);
  }
  for (const [lon, lat] of extrairAmostraCoordenadas(routeGeometry)) {
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      ancoras.push({ latitude: lat, longitude: lon });
    }
  }
  if (!ancoras.length) return [];

  const melhores = new Map();
  for (const anc of ancoras) {
    const lista = sugerirVisitasOportunisticas(planoTemp, {
      pontoAncora: anc,
      rotaAtiva,
      raioMetros,
      limite,
      graph,
      agora,
    });
    for (const s of lista) {
      const k = s.pacienteId || s.visitaId;
      const atual = melhores.get(k);
      if (!atual || s.distanciaMetros < atual.distanciaMetros) {
        melhores.set(k, s);
      }
    }
  }

  return [...melhores.values()]
    .filter(
      (s) =>
        s.visita?.planejada === false ||
        s.visita?.status === STATUS_VISITA.NAO_REALIZADA ||
        s.visita?.status === STATUS_VISITA.OPORTUNISTICA_SUGERIDA,
    )
    .sort((a, b) => (b.pontuacao - a.pontuacao) || (a.distanciaMetros - b.distanciaMetros))
    .slice(0, Math.max(1, limite))
    .map((s) => ({
      id: s.visitaId,
      visitaId: s.visitaId,
      pacienteId: s.pacienteId,
      nome: s.visita?.nome || '',
      latitude: s.visita?.latitude,
      longitude: s.visita?.longitude,
      enderecoDigital: s.visita?.enderecoDigital || '',
      status: STATUS_VISITA.OPORTUNISTICA_SUGERIDA,
      distanciaTrajetoMetros: s.distanciaMetros,
      pontuacaoPrioridade: s.pontuacao,
      motivosPrioridade: [s.motivoResumo].filter(Boolean),
      motivoResumo: s.motivoResumo,
    }));
}

