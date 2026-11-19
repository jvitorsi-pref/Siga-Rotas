/**
 * campo/repositorioCampo.js — Repositório offline-first compartilhado (Web & APK)
 * -------------------------------------------------------------------------------
 * Opera sobre qualquer driver compatível (IndexedDB na Web, SQLite no APK ou
 * memória em testes automatizados).
 *
 * Responsabilidades:
 *   • Persistência imediata local de rotas CALCULADA (auto/manual) e GPS;
 *   • Gravação incremental de pontos GPS (`pontos_gps`) com retomada após queda;
 *   • Consolidação `LineString` / `MultiLineString` sem sobrescrever CALCULADA;
 *   • Observações georreferenciadas sempre vinculadas a uma rota + `SIGA_ROTA_EVENTO`;
 *   • Fila idempotente de sincronização (`PENDING`, `SYNCING`, `SYNCED`, `ERROR`);
 *   • Cache vetorial da rede separado das tabelas operacionais de sincronização.
 */

import {
  ENTIDADE_SYNC,
  STATUS_ROTA,
  SYNC_STATUS,
  TIPO_ROTA,
  aplicarEdicaoObservacao,
  aplicarStatusObservacao,
  criarRegistroExecucaoGps,
  criarRegistroObservacao,
  criarRegistroRotaCalculada,
  gerarUuid,
  normalizarIso,
  rotuloIndicadorSync,
} from './modeloCampo.js';
import {
  CONFIG_FILTRO_GPS,
  consolidarPontosEmGeometria,
  filtrarPontoGps,
} from './filtroGps.js';

function clonar(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

/**
 * Driver em memória compatível com o mesmo contrato assíncrono dos drivers
 * IndexedDB (Web) e expo-sqlite (Mobile).
 */
export function criarDriverMemoria() {
  const rotas = new Map();
  const pontosGps = new Map(); // idRotaCliente -> Array<ponto>
  const observacoes = new Map();
  const eventos = new Map();
  const syncFila = new Map();
  const cacheRede = new Map();

  return {
    async init() {},

    async putRota(rota) {
      rotas.set(rota.idCliente, clonar(rota));
    },

    async putRotaComSync(rota, syncItem) {
      rotas.set(rota.idCliente, clonar(rota));
      if (syncItem) syncFila.set(syncItem.idSync, clonar(syncItem));
    },

    async getRota(idCliente) {
      return clonar(rotas.get(idCliente) || null);
    },

    async listRotas({ tipoRota = null, incluirSimuladas = false, limit = 100 } = {}) {
      return Array.from(rotas.values())
        .filter((r) => (!tipoRota || r.tipoRota === tipoRota) && (incluirSimuladas || !r.simulado))
        .sort((a, b) => String(b.dataCriacao).localeCompare(String(a.dataCriacao)))
        .slice(0, limit)
        .map(clonar);
    },

    async findRotaPorAssinatura(assinatura) {
      if (!assinatura) return null;
      for (const r of rotas.values()) {
        if (r.tipoRota === TIPO_ROTA.CALCULADA && r.assinatura === assinatura) {
          return clonar(r);
        }
      }
      return null;
    },

    async appendPontoGps(ponto) {
      const lista = pontosGps.get(ponto.idRotaCliente) || [];
      lista.push(clonar(ponto));
      pontosGps.set(ponto.idRotaCliente, lista);
    },

    async listPontosGps(idRotaCliente) {
      return (pontosGps.get(idRotaCliente) || [])
        .slice()
        .sort((a, b) => Number(a.ordem) - Number(b.ordem))
        .map(clonar);
    },

    async putObservacaoEEvento(observacao, evento, syncItens = []) {
      observacoes.set(observacao.idCliente, clonar(observacao));
      if (evento) eventos.set(evento.idCliente, clonar(evento));
      for (const item of syncItens) {
        if (item) syncFila.set(item.idSync, clonar(item));
      }
    },

    async getObservacao(idCliente) {
      return clonar(observacoes.get(idCliente) || null);
    },

    async listObservacoes({ idRotaCliente = null, incluirSimuladas = false } = {}) {
      return Array.from(observacoes.values())
        .filter(
          (o) =>
            (!idRotaCliente || o.idRotaCliente === idRotaCliente) &&
            (incluirSimuladas || !o.simulado),
        )
        .sort((a, b) => String(b.dataAtualizacao).localeCompare(String(a.dataAtualizacao)))
        .map(clonar);
    },

    async putEvento(evento) {
      eventos.set(evento.idCliente, clonar(evento));
    },

    async getEvento(idCliente) {
      return clonar(eventos.get(idCliente) || null);
    },

    async listEventosObservacao(idObservacaoCliente) {
      return Array.from(eventos.values())
        .filter((e) => !idObservacaoCliente || e.idObservacaoCliente === idObservacaoCliente)
        .sort((a, b) => String(a.dataEvento).localeCompare(String(b.dataEvento)))
        .map(clonar);
    },

    async upsertSyncItem(item) {
      syncFila.set(item.idSync, clonar(item));
    },

    async getSyncItem(idSync) {
      return clonar(syncFila.get(idSync) || null);
    },

    async listSyncItens({ statuses = null } = {}) {
      const filtro = Array.isArray(statuses) && statuses.length ? new Set(statuses) : null;
      return Array.from(syncFila.values())
        .filter((s) => !filtro || filtro.has(s.status))
        .sort((a, b) => Number(a.ordemFila ?? 0) - Number(b.ordemFila ?? 0))
        .map(clonar);
    },

    async resetSyncingParaPending() {
      let count = 0;
      for (const [k, item] of syncFila.entries()) {
        if (item.status === SYNC_STATUS.SYNCING) {
          syncFila.set(k, { ...item, status: SYNC_STATUS.PENDING });
          count += 1;
        }
      }
      return count;
    },

    async putCacheRede(chave, payload) {
      cacheRede.set(chave, clonar(payload));
    },

    async getCacheRede(chave) {
      return clonar(cacheRede.get(chave) || null);
    },
  };
}

export function criarRepositorioCampo({
  driver = criarDriverMemoria(),
  agora = Date.now,
  configFiltroGps = CONFIG_FILTRO_GPS,
} = {}) {
  let inicializado = false;
  let seqOrdemFila = 0;

  // Estado em memória por execução GPS ativa para evitar leituras repetidas ao validar cada ponto
  const sessoesGps = new Map(); // idRotaCliente -> { ultimoPonto, totalPontos, segmentoAtual, forcarNovoSegmento, distanciaMetros }

  async function inicializar() {
    if (inicializado) return;
    await driver.init();
    await driver.resetSyncingParaPending();
    const existentes = await driver.listSyncItens();
    seqOrdemFila = existentes.reduce((m, it) => Math.max(m, Number(it.ordemFila || 0)), 0);
    inicializado = true;
  }

  function criarItemSync({ entidadeTipo, entidadeId, operacao, dependeDe = null, prioridade = 1 }) {
    seqOrdemFila += 1;
    const agoraIso = normalizarIso(null, agora);
    return {
      idSync: `${entidadeTipo}:${entidadeId}:${operacao === 'CRIAR' ? 'CRIAR' : seqOrdemFila}`,
      entidadeTipo,
      entidadeId,
      operacao,
      dependeDe,
      prioridade,
      ordemFila: seqOrdemFila,
      status: SYNC_STATUS.PENDING,
      tentativas: 0,
      ultimoErro: null,
      proximaTentativaEm: null,
      criadoEm: agoraIso,
      atualizadoEm: agoraIso,
    };
  }

  /**
   * Salva uma rota calculada localmente (automático ao calcular ou manual ao clicar em Salvar)
   * e coloca na fila idempotente de sincronização.
   */
  async function salvarRotaCalculada(
    rotaCalculada,
    {
      pontos = [],
      modo = 'usuario',
      circular = true,
      origemSalvamento = 'auto',
      titulo = null,
      idUsuario = 'agente-local',
    } = {},
  ) {
    await inicializar();
    const registro = criarRegistroRotaCalculada({
      rota: rotaCalculada,
      pontos,
      modo,
      circular,
      origemSalvamento,
      titulo,
      idUsuario,
      agora,
    });

    const existente = await driver.findRotaPorAssinatura(registro.assinatura);
    if (existente) {
      if (origemSalvamento === 'manual' && existente.origemSalvamento !== 'manual') {
        const atualizado = {
          ...existente,
          origemSalvamento: 'manual',
          titulo: (titulo && String(titulo).trim()) || existente.titulo,
          dataAtualizacao: normalizarIso(null, agora),
        };
        await driver.putRota(atualizado);
        return { rota: atualizado, criada: false, atualizada: true };
      }
      return { rota: existente, criada: false, atualizada: false };
    }

    const syncItem = criarItemSync({
      entidadeTipo: ENTIDADE_SYNC.ROTA,
      entidadeId: registro.idCliente,
      operacao: 'CRIAR',
      prioridade: 1,
    });
    await driver.putRotaComSync(registro, syncItem);
    return { rota: registro, criada: true, atualizada: false };
  }

  async function listarRotasSalvas({ tipoRota = null, incluirSimuladas = false, limit = 100 } = {}) {
    await inicializar();
    return driver.listRotas({ tipoRota, incluirSimuladas, limit });
  }

  async function obterRota(idCliente) {
    await inicializar();
    if (!idCliente) return null;
    return driver.getRota(idCliente);
  }

  /**
   * Inicia o registro local de uma execução percorrida por GPS (nunca sobrescreve a rota CALCULADA).
   */
  async function iniciarExecucaoGps({
    idRotaOrigemCliente = null,
    titulo = null,
    simulado = false,
    idUsuario = 'agente-local',
  } = {}) {
    await inicializar();
    let idRotaOrigemServidor = null;
    let tituloDerivado = titulo;
    if (idRotaOrigemCliente) {
      const origem = await driver.getRota(idRotaOrigemCliente);
      if (origem) {
        idRotaOrigemServidor = origem.idServidor ?? null;
        if (!tituloDerivado && origem.titulo) {
          tituloDerivado = `Execução GPS · ${origem.titulo}`;
        }
      }
    }

    const execucao = criarRegistroExecucaoGps({
      idRotaOrigemCliente,
      idRotaOrigemServidor,
      titulo: tituloDerivado,
      simulado,
      idUsuario,
      agora,
    });
    await driver.putRota(execucao);
    sessoesGps.set(execucao.idCliente, {
      ultimoPonto: null,
      totalPontos: 0,
      segmentoAtual: 0,
      forcarNovoSegmento: false,
      distanciaMetros: 0,
    });
    return execucao;
  }

  async function carregarEstadoSessaoGps(idRotaCliente) {
    if (sessoesGps.has(idRotaCliente)) return sessoesGps.get(idRotaCliente);
    const pontos = await driver.listPontosGps(idRotaCliente);
    const ultimoPonto = pontos.length ? pontos[pontos.length - 1] : null;
    const consolidado = consolidarPontosEmGeometria(pontos);
    const estado = {
      ultimoPonto,
      totalPontos: pontos.length,
      segmentoAtual: ultimoPonto ? Number(ultimoPonto.segmentoIndice || 0) : 0,
      forcarNovoSegmento: true, // retomando após fechamento/reinício do app
      distanciaMetros: consolidado.distanciaMetros,
    };
    sessoesGps.set(idRotaCliente, estado);
    return estado;
  }

  /**
   * Valida e persiste incrementalmente cada ponto GPS recebido durante o trajeto.
   */
  async function registrarPontoGps({ idRotaCliente, ponto } = {}) {
    await inicializar();
    if (!idRotaCliente) return { aceito: false, motivo: 'ROTA_NAO_INFORMADA' };
    const rota = await driver.getRota(idRotaCliente);
    if (!rota || rota.tipoRota !== TIPO_ROTA.GPS) {
      return { aceito: false, motivo: 'EXECUCAO_NAO_ENCONTRADA' };
    }
    if (rota.status === STATUS_ROTA.CONCLUIDA || rota.status === STATUS_ROTA.CANCELADA) {
      return { aceito: false, motivo: 'EXECUCAO_ENCERRADA' };
    }
    if (Boolean(ponto?.simulado) !== Boolean(rota.simulado)) {
      return { aceito: false, motivo: 'MISTURA_SIMULACAO_GPS' };
    }

    const sessao = await carregarEstadoSessaoGps(idRotaCliente);
    const aval = filtrarPontoGps(ponto, {
      ultimoPonto: sessao.ultimoPonto,
      forcarNovoSegmento: sessao.forcarNovoSegmento,
      segmentoAtual: sessao.segmentoAtual,
      config: configFiltroGps,
      agora,
    });

    if (!aval.aceitar) {
      return { aceito: false, motivo: aval.motivo };
    }

    const ordem = sessao.totalPontos + 1;
    const registroPonto = {
      idPonto: gerarUuid(),
      idRotaCliente,
      ordem,
      ...aval.ponto,
      criadoEm: normalizarIso(aval.ponto.timestampMs, agora),
    };

    await driver.appendPontoGps(registroPonto);

    sessao.ultimoPonto = registroPonto;
    sessao.totalPontos = ordem;
    sessao.segmentoAtual = registroPonto.segmentoIndice;
    sessao.forcarNovoSegmento = false;
    sessao.distanciaMetros = Math.round((sessao.distanciaMetros + (aval.distanciaSegmentoM || 0)) * 100) / 100;

    // Atualiza métricas acumuladas da rota em execução (sem perder dados caso o app feche)
    const inicioMs = Date.parse(rota.dataInicio || rota.dataCriacao);
    const duracaoSegundos =
      Number.isFinite(inicioMs) && registroPonto.timestampMs >= inicioMs
        ? Math.round((registroPonto.timestampMs - inicioMs) / 1000)
        : rota.duracaoSegundos || 0;

    await driver.putRota({
      ...rota,
      distanciaMetros: sessao.distanciaMetros,
      duracaoSegundos,
      dataAtualizacao: normalizarIso(null, agora),
    });

    return {
      aceito: true,
      ponto: registroPonto,
      novoSegmento: !!aval.novoSegmento,
      totalPontos: ordem,
      distanciaMetros: sessao.distanciaMetros,
    };
  }

  async function pausarExecucaoGps(idRotaCliente) {
    await inicializar();
    if (!idRotaCliente) return null;
    const sessao = await carregarEstadoSessaoGps(idRotaCliente);
    sessao.forcarNovoSegmento = true;
    const rota = await driver.getRota(idRotaCliente);
    if (!rota || rota.status !== STATUS_ROTA.EM_EXECUCAO) return rota;
    const atualizada = {
      ...rota,
      dataAtualizacao: normalizarIso(null, agora),
    };
    await driver.putRota(atualizada);
    return atualizada;
  }

  async function retomarExecucaoGps(idRotaCliente) {
    await inicializar();
    if (!idRotaCliente) return null;
    const sessao = await carregarEstadoSessaoGps(idRotaCliente);
    sessao.forcarNovoSegmento = true;
    const rota = await driver.getRota(idRotaCliente);
    if (!rota) return null;
    const atualizada = {
      ...rota,
      status: STATUS_ROTA.EM_EXECUCAO,
      dataAtualizacao: normalizarIso(null, agora),
    };
    await driver.putRota(atualizada);
    return atualizada;
  }

  /**
   * Consolida os pontos GPS capturados em `LineString` ou `MultiLineString`,
   * finaliza a execução e agenda sincronização (exceto se `simulado = true`).
   */
  async function finalizarExecucaoGps(
    idRotaCliente,
    { statusFinal = STATUS_ROTA.CONCLUIDA } = {},
  ) {
    await inicializar();
    const rota = await driver.getRota(idRotaCliente);
    if (!rota || rota.tipoRota !== TIPO_ROTA.GPS) return null;

    const pontos = await driver.listPontosGps(idRotaCliente);
    const consolidado = consolidarPontosEmGeometria(pontos);
    const dataFim = normalizarIso(null, agora);
    const status =
      statusFinal === STATUS_ROTA.INTERROMPIDA ? STATUS_ROTA.INTERROMPIDA : STATUS_ROTA.CONCLUIDA;

    sessoesGps.delete(idRotaCliente);

    // Se não houve deslocamento suficiente para formar ao menos 2 pontos válidos
    if (!consolidado.geometry) {
      const encerradaSemGeometria = {
        ...rota,
        geometry: null,
        distanciaMetros: 0,
        duracaoSegundos: consolidado.duracaoSegundos,
        dataFim,
        dataAtualizacao: dataFim,
        status: STATUS_ROTA.CANCELADA,
        syncStatus: SYNC_STATUS.SYNCED,
      };
      await driver.putRota(encerradaSemGeometria);
      return { rota: encerradaSemGeometria, consolidado, enfileirada: false };
    }

    const deveSincronizar = !rota.simulado;
    const finalizada = {
      ...rota,
      geometry: consolidado.geometry,
      distanciaMetros: consolidado.distanciaMetros,
      duracaoSegundos: consolidado.duracaoSegundos,
      dataFim,
      dataAtualizacao: dataFim,
      versaoLocal: Number(rota.versaoLocal || 1) + (rota.idServidor ? 1 : 0),
      status,
      syncStatus: deveSincronizar ? SYNC_STATUS.PENDING : SYNC_STATUS.SYNCED,
      syncErro: null,
    };

    const syncItem = deveSincronizar
      ? criarItemSync({
          entidadeTipo: ENTIDADE_SYNC.ROTA,
          entidadeId: finalizada.idCliente,
          operacao: finalizada.idServidor ? 'ATUALIZAR' : 'CRIAR',
          dependeDe: finalizada.idRotaOrigemCliente || null,
          prioridade: 2,
        })
      : null;

    await driver.putRotaComSync(finalizada, syncItem);
    return { rota: finalizada, consolidado, enfileirada: Boolean(syncItem) };
  }

  /**
   * Lista execuções GPS que ficaram em `EM_EXECUCAO` após fechamento inesperado do app.
   */
  async function listarExecucoesGpsEmAndamento({ incluirSimuladas = false } = {}) {
    await inicializar();
    const gpsRotas = await driver.listRotas({
      tipoRota: TIPO_ROTA.GPS,
      incluirSimuladas,
      limit: 50,
    });
    const emAndamento = [];
    for (const r of gpsRotas) {
      if (r.status === STATUS_ROTA.EM_EXECUCAO) {
        const pontos = await driver.listPontosGps(r.idCliente);
        emAndamento.push({
          ...r,
          totalPontos: pontos.length,
        });
      }
    }
    return emAndamento;
  }

  /**
   * Cria observação georreferenciada vinculada obrigatoriamente a uma rota existente,
   * gravando o evento `CRIACAO` e enfileirando ambos para sincronização na mesma transação.
   */
  async function criarObservacaoRota({
    idRotaCliente,
    latitude,
    longitude,
    tipoObservacao = 'VISITA_REALIZADA',
    descricao,
    idUsuario = 'agente-local',
  } = {}) {
    await inicializar();
    if (!idRotaCliente) {
      throw new Error('Toda observação deve estar vinculada a uma rota.');
    }
    const rota = await driver.getRota(idRotaCliente);
    if (!rota) {
      throw new Error('Rota vinculada não encontrada no armazenamento local.');
    }

    const { observacao, evento } = criarRegistroObservacao({
      idRotaCliente: rota.idCliente,
      idRotaServidor: rota.idServidor ?? null,
      latitude,
      longitude,
      tipoObservacao,
      descricao,
      simulado: !!rota.simulado,
      idUsuario,
      agora,
    });

    const syncItens = rota.simulado
      ? []
      : [
          criarItemSync({
            entidadeTipo: ENTIDADE_SYNC.OBSERVACAO,
            entidadeId: observacao.idCliente,
            operacao: 'CRIAR',
            dependeDe: rota.idCliente,
            prioridade: 3,
          }),
          criarItemSync({
            entidadeTipo: ENTIDADE_SYNC.EVENTO,
            entidadeId: evento.idCliente,
            operacao: 'CRIAR',
            dependeDe: observacao.idCliente,
            prioridade: 4,
          }),
        ];

    await driver.putObservacaoEEvento(observacao, evento, syncItens);
    return { observacao, evento };
  }

  async function editarObservacaoRota({ idCliente, descricao, tipoObservacao, idUsuario } = {}) {
    await inicializar();
    const atual = await driver.getObservacao(idCliente);
    if (!atual) throw new Error('Observação não encontrada.');
    const { observacao, evento } = aplicarEdicaoObservacao(atual, {
      descricao,
      tipoObservacao,
      idUsuario,
      agora,
    });

    const syncItens = observacao.simulado
      ? []
      : [
          criarItemSync({
            entidadeTipo: ENTIDADE_SYNC.OBSERVACAO,
            entidadeId: observacao.idCliente,
            operacao: 'ATUALIZAR',
            dependeDe: observacao.idRotaCliente,
            prioridade: 3,
          }),
          criarItemSync({
            entidadeTipo: ENTIDADE_SYNC.EVENTO,
            entidadeId: evento.idCliente,
            operacao: 'CRIAR',
            dependeDe: observacao.idCliente,
            prioridade: 4,
          }),
        ];

    await driver.putObservacaoEEvento(observacao, evento, syncItens);
    return { observacao, evento };
  }

  async function alterarStatusObservacao({ idCliente, novoStatus, idUsuario, motivo = null } = {}) {
    await inicializar();
    const atual = await driver.getObservacao(idCliente);
    if (!atual) throw new Error('Observação não encontrada.');
    const { observacao, evento } = aplicarStatusObservacao(atual, {
      novoStatus,
      idUsuario,
      motivo,
      agora,
    });

    const syncItens = observacao.simulado
      ? []
      : [
          criarItemSync({
            entidadeTipo: ENTIDADE_SYNC.OBSERVACAO,
            entidadeId: observacao.idCliente,
            operacao: 'ATUALIZAR',
            dependeDe: observacao.idRotaCliente,
            prioridade: 3,
          }),
          criarItemSync({
            entidadeTipo: ENTIDADE_SYNC.EVENTO,
            entidadeId: evento.idCliente,
            operacao: 'CRIAR',
            dependeDe: observacao.idCliente,
            prioridade: 4,
          }),
        ];

    await driver.putObservacaoEEvento(observacao, evento, syncItens);
    return { observacao, evento };
  }

  async function listarObservacoes({ idRotaCliente = null, incluirSimuladas = false, incluirEventos = false } = {}) {
    await inicializar();
    const lista = await driver.listObservacoes({ idRotaCliente, incluirSimuladas });
    if (!incluirEventos) return lista;
    const comEventos = [];
    for (const obs of lista) {
      const eventos = await driver.listEventosObservacao(obs.idCliente);
      comEventos.push({ ...obs, eventos });
    }
    return comEventos;
  }

  async function listarPontosGps(idRotaCliente) {
    await inicializar();
    return driver.listPontosGps(idRotaCliente);
  }

  async function obterResumoSincronizacao({ online = true } = {}) {
    await inicializar();
    const itens = await driver.listSyncItens();
    let pendentes = 0;
    let sincronizando = 0;
    let sincronizados = 0;
    let erros = 0;
    let ultimoErro = null;

    for (const item of itens) {
      if (item.status === SYNC_STATUS.PENDING) pendentes += 1;
      else if (item.status === SYNC_STATUS.SYNCING) sincronizando += 1;
      else if (item.status === SYNC_STATUS.SYNCED) sincronizados += 1;
      else if (item.status === SYNC_STATUS.ERROR) {
        erros += 1;
        ultimoErro = item.ultimoErro || ultimoErro;
      }
    }

    const indicador = rotuloIndicadorSync({ pendentes, sincronizando, erros, sincronizados, online });
    return {
      total: itens.length,
      pendentes,
      sincronizando,
      sincronizados,
      erros,
      ultimoErro,
      online,
      ...indicador,
    };
  }

  async function salvarCacheRede(featureCollection) {
    await inicializar();
    if (!featureCollection || !Array.isArray(featureCollection.features)) return false;
    await driver.putCacheRede('siga_rede_oficial', {
      salvoEm: normalizarIso(null, agora),
      featureCount: featureCollection.features.length,
      featureCollection,
    });
    return true;
  }

  async function carregarCacheRede() {
    await inicializar();
    return driver.getCacheRede('siga_rede_oficial');
  }

  return {
    driver,
    inicializar,
    salvarRotaCalculada,
    listarRotasSalvas,
    obterRota,
    iniciarExecucaoGps,
    registrarPontoGps,
    pausarExecucaoGps,
    retomarExecucaoGps,
    finalizarExecucaoGps,
    listarExecucoesGpsEmAndamento,
    listarPontosGps,
    criarObservacaoRota,
    editarObservacaoRota,
    alterarStatusObservacao,
    listarObservacoes,
    obterResumoSincronizacao,
    salvarCacheRede,
    carregarCacheRede,
  };
}

/**
 * Regra unificada de vinculação de observações:
 *   • durante navegação GPS real ativa → vincula à rota GPS em execução;
 *   • fora da navegação (ou em simulação de teste) → vincula à rota calculada selecionada.
 */
export function resolverRotaAtivaParaObservacao({
  execucaoGpsAtiva = null,
  rotaCalculadaAtiva = null,
} = {}) {
  if (execucaoGpsAtiva && !execucaoGpsAtiva.simulado && execucaoGpsAtiva.idCliente) {
    return execucaoGpsAtiva;
  }
  if (rotaCalculadaAtiva && rotaCalculadaAtiva.idCliente) {
    return rotaCalculadaAtiva;
  }
  return null;
}
