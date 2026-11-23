/**
 * APK/src/services/campoMobileServiceCore.js — Serviço offline-first Mobile (SQLite + Sync WebForms)
 * ------------------------------------------------------------------------------------------------
 * Compartilha exatamente as mesmas regras de negócio (`src/campo/`) com a Web,
 * persistindo imediatamente em SQLite (`expo-sqlite`) e sincronizando com o mesmo
 * backend WebForms (`SigaRotasCampo.ashx`).
 */

import {
  STATUS_OBSERVACAO,
  STATUS_ROTA,
  TIPO_OBSERVACAO_CATALOGO,
  TIPO_ROTA,
  construirTituloRota,
  criarRegistroExecucaoGps,
  normalizarIso,
  reconstruirRespostaRotaDeRegistro,
  rotuloIndicadorSync,
  rotuloStatusObservacaoCampo,
  rotuloSyncStatus,
  rotuloTipoObservacao,
} from '../campo/modeloCampo.js';
import {
  consolidarPontosEmGeometria,
  filtrarPontoGps,
} from '../campo/filtroGps.js';
import {
  criarDriverMemoria,
  criarRepositorioCampo,
  resolverRotaAtivaParaObservacao,
} from '../campo/repositorioCampo.js';
import {
  criarClienteBackendCampo,
  resolverUrlBackendCampo,
} from '../campo/contratosBackend.js';
import { criarMotorSincronizacao } from '../campo/syncEngine.js';

export function criarServicoCampoMobileCore({
  driver = criarDriverMemoria(),
  obterApiUrl = () => null,
  obterUsuarioId = () => 'agente-mobile',
  obterDispositivoId = () => 'apk-siga-rotas',
  obterHeadersAuth = async () => ({}),
  fetchFn = (...args) => globalThis.fetch(...args),
  estaOnline = () => true,
  aoMudar = () => {},
  aoMudarSync = () => {},
} = {}) {
  const repositorio = criarRepositorioCampo({ driver });

  const clienteBackend = criarClienteBackendCampo({
    obterBaseUrl: async () => {
      const apiUrl = await obterApiUrl();
      return apiUrl ? resolverUrlBackendCampo({ apiUrl }) : null;
    },
    obterHeaders: async () => {
      const uid = await obterUsuarioId();
      const extra = await obterHeadersAuth();
      return {
        ...(uid ? { 'X-Siga-Usuario': String(uid) } : {}),
        ...(extra || {}),
      };
    },
    fetchFn,
  });

  let rotaCalculadaAtiva = null;
  let execucaoGpsAtiva = null;
  let sessaoGpsMemoria = null;
  let ultimaExecucaoGpsSessao = null;
  let segmentosTrilhaAtiva = [];
  let cadeiaGps = Promise.resolve();

  function construirGeometriaTrilhaAtiva() {
    const validos = segmentosTrilhaAtiva.filter((seg) => seg.length >= 2);
    if (!validos.length) return null;
    if (validos.length === 1) return { type: 'LineString', coordinates: validos[0].slice() };
    return { type: 'MultiLineString', coordinates: validos.map((s) => s.slice()) };
  }

  function enfileirarOperacaoGps(fn) {
    const prox = cadeiaGps.then(fn, fn);
    cadeiaGps = prox.catch(() => null);
    return prox;
  }

  const syncEngine = criarMotorSincronizacao({
    repositorio,
    clienteBackend,
    dispositivoId: obterDispositivoId(),
    estaOnline,
    aoMudar: (resumo) => {
      aoMudarSync(resumo);
      aoMudar();
    },
  });

  async function inicializar() {
    await repositorio.inicializar();
    await syncEngine.emitirResumo(estaOnline());
  }

  async function dispararSyncSilenciosa() {
    if (!estaOnline()) return { ok: false, motivo: 'OFFLINE' };
    const apiUrl = await obterApiUrl();
    if (!apiUrl) return { ok: false, motivo: 'SEM_SERVIDOR' };
    return syncEngine.sincronizarPendentes().catch(() => null);
  }

  async function salvarRotaCalculada(
    rota,
    {
      pontos = [],
      modo = 'usuario',
      circular = true,
      origemSalvamento = 'manual',
      titulo = null,
    } = {},
  ) {
    const uid = (await obterUsuarioId()) || 'agente-mobile';
    const res = await repositorio.salvarRotaCalculada(rota, {
      pontos,
      modo,
      circular,
      origemSalvamento,
      titulo,
      idUsuario: uid,
    });
    rotaCalculadaAtiva = res.rota;
    await syncEngine.emitirResumo(estaOnline());
    aoMudar();
    void dispararSyncSilenciosa();
    return res;
  }

  async function salvarRotasOffline({
    rotaCalculada = null,
    rotaCalculadaOriginal = null,
    pontos = [],
    modo = 'usuario',
    circular = true,
    titulo = null,
  } = {}) {
    const calcAlvo =
      rotaCalculadaOriginal && rotaCalculadaOriginal.ok !== false && !rotaCalculadaOriginal.parcial
        ? rotaCalculadaOriginal
        : (rotaCalculada && rotaCalculada.ok !== false && !rotaCalculada.parcial ? rotaCalculada : null);

    const gpsSessaoBruta =
      ultimaExecucaoGpsSessao?.rota &&
      !ultimaExecucaoGpsSessao.rota.simulado &&
      ultimaExecucaoGpsSessao.rota.geometry &&
      Array.isArray(ultimaExecucaoGpsSessao.pontosGps) &&
      ultimaExecucaoGpsSessao.pontosGps.length >= 2
        ? ultimaExecucaoGpsSessao
        : null;

    if (!calcAlvo && !gpsSessaoBruta) {
      throw new Error('Calcule uma rota completa ou finalize um percurso GPS real antes de salvar offline.');
    }

    const uid = (await obterUsuarioId()) || 'agente-mobile';
    let resCalc = null;
    if (calcAlvo) {
      const pts = pontos?.length ? pontos : (calcAlvo.pontos || calcAlvo.pontosJson || []);
      resCalc = await repositorio.salvarRotaCalculada(calcAlvo, {
        pontos: pts,
        modo: calcAlvo.modo || modo || 'usuario',
        circular: calcAlvo.circular !== undefined ? calcAlvo.circular : circular,
        origemSalvamento: 'manual',
        titulo,
        idUsuario: uid,
      });
      rotaCalculadaAtiva = resCalc.rota;
    }

    const gpsPertenceAOutraRota =
      !!gpsSessaoBruta?.salvaOffline &&
      !!resCalc?.rota?.idCliente &&
      !!gpsSessaoBruta.rota.idRotaOrigemCliente &&
      gpsSessaoBruta.rota.idRotaOrigemCliente !== resCalc.rota.idCliente;
    const gpsSessao = gpsPertenceAOutraRota ? null : gpsSessaoBruta;

    let resGps = null;
    if (gpsSessao) {
      const origemId = gpsSessao.rota.idRotaOrigemCliente ?? resCalc?.rota?.idCliente ?? null;
      const origemSrv = gpsSessao.rota.idRotaOrigemServidor ?? resCalc?.rota?.idServidor ?? null;
      resGps = await repositorio.salvarExecucaoGpsCompleta({
        execucao: {
          ...gpsSessao.rota,
          idRotaOrigemCliente: origemId,
          idRotaOrigemServidor: origemSrv,
        },
        pontosGps: gpsSessao.pontosGps,
      });
      if (resGps?.rota) {
        ultimaExecucaoGpsSessao = {
          rota: resGps.rota,
          pontosGps: gpsSessao.pontosGps,
          salvaOffline: true,
        };
        if (!rotaCalculadaAtiva) {
          rotaCalculadaAtiva = resGps.rota;
        }
      }
    }

    await syncEngine.emitirResumo(estaOnline());
    aoMudar();
    void dispararSyncSilenciosa();

    const criadas = (resCalc?.criada ? 1 : 0) + (resGps?.criada ? 1 : 0);
    const atualizadas = (resCalc?.atualizada ? 1 : 0) + (resGps?.atualizada ? 1 : 0);
    return {
      ok: true,
      rotaCalculada: resCalc?.rota || null,
      rotaGps: resGps?.rota || null,
      criadas,
      atualizadas,
      jaExistia: criadas === 0 && atualizadas === 0,
    };
  }

  function definirRotaCalculadaAtiva(registroRota) {
    rotaCalculadaAtiva = registroRota || null;
    aoMudar();
  }

  function limparSessaoGpsEmMemoria() {
    ultimaExecucaoGpsSessao = null;
  }

  /**
   * Inicia o rastreio GPS da navegação **exclusivamente em memória**, sem gravar
   * automaticamente na lista de rotas salvas offline.
   */
  function iniciarNavegacaoGps(rotaAtual, { modo = 'gps' } = {}) {
    return enfileirarOperacaoGps(async () => {
      const simulado = modo === 'simulacao';
      const uid = (await obterUsuarioId()) || 'agente-mobile';
      const tituloOrig = rotaAtual?.titulo || (rotaAtual?.pontos ? construirTituloRota(rotaAtual.pontos, rotaAtual) : null);
      const execucao = criarRegistroExecucaoGps({
        idRotaOrigemCliente: rotaCalculadaAtiva?.idCliente || rotaAtual?.idCliente || null,
        idRotaOrigemServidor: rotaCalculadaAtiva?.idServidor ?? null,
        titulo: tituloOrig ? `Execução GPS · ${tituloOrig}` : null,
        simulado,
        idUsuario: uid,
      });
      execucao.origemSalvamento = 'sessao';
      execucaoGpsAtiva = execucao;
      sessaoGpsMemoria = {
        rota: execucao,
        pontos: [],
        filtroEstado: {
          ultimoPonto: null,
          totalPontos: 0,
          segmentoAtual: 0,
          forcarNovoSegmento: false,
          distanciaMetros: 0,
        },
      };
      segmentosTrilhaAtiva = [];
      if (!simulado) {
        ultimaExecucaoGpsSessao = null;
      }
      aoMudar();
      return execucao;
    });
  }

  function registrarPontoGps(ponto) {
    return enfileirarOperacaoGps(async () => {
      if (!execucaoGpsAtiva || !sessaoGpsMemoria) return { aceito: false, motivo: 'SEM_EXECUCAO' };
      const st = sessaoGpsMemoria.filtroEstado;
      const filtro = filtrarPontoGps(ponto, {
        ultimoPonto: st.ultimoPonto,
        segmentoAtual: st.segmentoAtual,
        forcarNovoSegmento: st.forcarNovoSegmento,
      });
      if (!filtro.aceitar) return { aceito: false, motivo: filtro.motivo };

      const p = filtro.ponto;
      const ordem = st.totalPontos + 1;
      const registroPonto = {
        idPonto: `${sessaoGpsMemoria.rota.idCliente}:${ordem}`,
        idRotaCliente: sessaoGpsMemoria.rota.idCliente,
        ordem,
        latitude: p.latitude,
        longitude: p.longitude,
        precisao: p.precisao,
        rumo: p.rumo,
        velocidade: p.velocidade,
        timestampMs: p.timestampMs,
        simulado: Boolean(sessaoGpsMemoria.rota.simulado || p.simulado),
        segmentoIndice: p.segmentoIndice,
        criadoEm: normalizarIso(p.timestampMs),
      };

      sessaoGpsMemoria.pontos.push(registroPonto);
      st.ultimoPonto = registroPonto;
      st.totalPontos = ordem;
      st.segmentoAtual = p.segmentoIndice;
      st.forcarNovoSegmento = false;
      st.distanciaMetros += filtro.distanciaSegmentoM || 0;

      if (!execucaoGpsAtiva.simulado) {
        if (!segmentosTrilhaAtiva.length || filtro.novoSegmento) {
          segmentosTrilhaAtiva.push([]);
        }
        segmentosTrilhaAtiva[segmentosTrilhaAtiva.length - 1].push([
          registroPonto.longitude,
          registroPonto.latitude,
        ]);
      }

      const { geometry, distanciaMetros } = consolidarPontosEmGeometria(sessaoGpsMemoria.pontos);
      sessaoGpsMemoria.rota.geometry = geometry;
      sessaoGpsMemoria.rota.distanciaMetros = distanciaMetros;
      sessaoGpsMemoria.rota.dataAtualizacao = normalizarIso();

      return {
        aceito: true,
        ponto: registroPonto,
        novoSegmento: filtro.novoSegmento,
        totalPontos: st.totalPontos,
        geometria: construirGeometriaTrilhaAtiva(),
      };
    });
  }

  function pausarNavegacaoGps() {
    return enfileirarOperacaoGps(async () => {
      if (!execucaoGpsAtiva || !sessaoGpsMemoria) return null;
      sessaoGpsMemoria.filtroEstado.forcarNovoSegmento = true;
      sessaoGpsMemoria.rota.status = STATUS_ROTA.PAUSADA;
      sessaoGpsMemoria.rota.dataAtualizacao = normalizarIso();
      execucaoGpsAtiva = sessaoGpsMemoria.rota;
      return execucaoGpsAtiva;
    });
  }

  function retomarNavegacaoGps() {
    return enfileirarOperacaoGps(async () => {
      if (!execucaoGpsAtiva || !sessaoGpsMemoria) return null;
      sessaoGpsMemoria.filtroEstado.forcarNovoSegmento = true;
      sessaoGpsMemoria.rota.status = STATUS_ROTA.EM_ANDAMENTO;
      sessaoGpsMemoria.rota.dataAtualizacao = normalizarIso();
      execucaoGpsAtiva = sessaoGpsMemoria.rota;
      return execucaoGpsAtiva;
    });
  }

  function finalizarNavegacaoGps({ concluida = false } = {}) {
    return enfileirarOperacaoGps(async () => {
      if (!execucaoGpsAtiva || !sessaoGpsMemoria) return null;
      const { rota, pontos } = sessaoGpsMemoria;
      execucaoGpsAtiva = null;
      sessaoGpsMemoria = null;
      segmentosTrilhaAtiva = [];

      const { geometry, distanciaMetros } = consolidarPontosEmGeometria(pontos);
      const t0 = Date.parse(rota.dataInicio || rota.dataCriacao);
      const t1 = Date.now();
      const duracaoSegundos = Number.isFinite(t0) ? Math.max(0, Math.round((t1 - t0) / 1000)) : 0;

      const finalizada = {
        ...rota,
        geometry,
        distanciaMetros,
        duracaoSegundos,
        dataFim: normalizarIso(t1),
        dataAtualizacao: normalizarIso(t1),
        status: concluida ? STATUS_ROTA.CONCLUIDA : STATUS_ROTA.INTERROMPIDA,
        syncStatus: 'MEMORIA',
      };

      if (!finalizada.simulado && finalizada.geometry && pontos.length >= 2) {
        ultimaExecucaoGpsSessao = {
          rota: finalizada,
          pontosGps: pontos.slice(),
        };
      }

      aoMudar();
      return { rota: finalizada, pontosGps: pontos.slice(), enfileirada: false };
    });
  }

  async function recuperarExecucaoPendente(idRotaCliente, acao = 'finalizar') {
    const res = await repositorio.finalizarExecucaoGps(idRotaCliente, {
      statusFinal: acao === 'descartar' ? STATUS_ROTA.CANCELADA : STATUS_ROTA.INTERROMPIDA,
    });
    await syncEngine.emitirResumo(estaOnline());
    aoMudar();
    if (acao !== 'descartar') void dispararSyncSilenciosa();
    return res;
  }

  function obterRotaParaObservacao() {
    // Observações persistentes exigem vínculo em `rotas_campo` já salvo no dispositivo
    return resolverRotaAtivaParaObservacao({
      execucaoGpsAtiva: null,
      rotaCalculadaAtiva,
    });
  }

  async function obterRota(idCliente) {
    if (!idCliente) return null;
    const persistida = await repositorio.obterRota(idCliente);
    if (persistida) return persistida;
    if (execucaoGpsAtiva?.idCliente === idCliente) return execucaoGpsAtiva;
    if (ultimaExecucaoGpsSessao?.rota?.idCliente === idCliente) return ultimaExecucaoGpsSessao.rota;
    return null;
  }

  async function listarPontosGps(idCliente) {
    if (!idCliente) return [];
    const persistidos = await repositorio.listarPontosGps(idCliente);
    if (persistidos?.length) return persistidos;
    if (sessaoGpsMemoria?.rota?.idCliente === idCliente) return sessaoGpsMemoria.pontos.slice();
    if (ultimaExecucaoGpsSessao?.rota?.idCliente === idCliente) {
      return ultimaExecucaoGpsSessao.pontosGps.slice();
    }
    return [];
  }

  async function excluirObservacao(idCliente) {
    const res = await repositorio.excluirObservacaoRota(idCliente);
    await syncEngine.emitirResumo(estaOnline());
    aoMudar();
    return res;
  }

  async function excluirRotaSalva(idCliente) {
    if (execucaoGpsAtiva?.idCliente === idCliente) {
      throw new Error('Encerre a navegação em andamento antes de excluir esta rota.');
    }
    const res = await repositorio.excluirRotaSalva(idCliente);
    if (rotaCalculadaAtiva?.idCliente === idCliente) {
      rotaCalculadaAtiva = null;
    }
    if (ultimaExecucaoGpsSessao?.rota?.idCliente === idCliente) {
      ultimaExecucaoGpsSessao = null;
    } else if (ultimaExecucaoGpsSessao?.rota?.idRotaOrigemCliente === idCliente) {
      ultimaExecucaoGpsSessao = {
        ...ultimaExecucaoGpsSessao,
        rota: {
          ...ultimaExecucaoGpsSessao.rota,
          idRotaOrigemCliente: null,
          idRotaOrigemServidor: null,
        },
      };
    }
    await syncEngine.emitirResumo(estaOnline());
    aoMudar();
    return res;
  }

  async function limparDadosLocais({ forcarInterrupcaoNavegacao = false } = {}) {
    if (execucaoGpsAtiva && !forcarInterrupcaoNavegacao) {
      return {
        ok: false,
        motivo: 'NAVEGACAO_EM_ANDAMENTO',
        mensagem: 'Há uma navegação em andamento. Confirme a interrupção antes de limpar os dados locais.',
      };
    }
    rotaCalculadaAtiva = null;
    execucaoGpsAtiva = null;
    sessaoGpsMemoria = null;
    ultimaExecucaoGpsSessao = null;
    segmentosTrilhaAtiva = [];
    const res = await repositorio.limparDadosLocais();
    await syncEngine.emitirResumo(estaOnline());
    aoMudar();
    return { ok: true, ...res };
  }

  async function criarObservacao({
    latitude,
    longitude,
    tipoObservacao,
    descricao,
    idRotaCliente = null,
  } = {}) {
    const rotaAlvoId = idRotaCliente || obterRotaParaObservacao()?.idCliente;
    if (!rotaAlvoId) {
      throw new Error('Salve a rota offline ("Salvar rotas offline") ou abra uma rota salva antes de registrar uma observação.');
    }
    const uid = (await obterUsuarioId()) || 'agente-mobile';
    const res = await repositorio.criarObservacaoRota({
      idRotaCliente: rotaAlvoId,
      latitude,
      longitude,
      tipoObservacao,
      descricao,
      idUsuario: uid,
    });
    await syncEngine.emitirResumo(estaOnline());
    aoMudar();
    void dispararSyncSilenciosa();
    return res;
  }

  async function editarObservacao({ idCliente, descricao, tipoObservacao } = {}) {
    const uid = (await obterUsuarioId()) || 'agente-mobile';
    const res = await repositorio.editarObservacaoRota({
      idCliente,
      descricao,
      tipoObservacao,
      idUsuario: uid,
    });
    await syncEngine.emitirResumo(estaOnline());
    aoMudar();
    void dispararSyncSilenciosa();
    return res;
  }

  async function alterarStatusObservacao({ idCliente, novoStatus, motivo = null } = {}) {
    const uid = (await obterUsuarioId()) || 'agente-mobile';
    const res = await repositorio.alterarStatusObservacao({
      idCliente,
      novoStatus,
      motivo,
      idUsuario: uid,
    });
    await syncEngine.emitirResumo(estaOnline());
    aoMudar();
    void dispararSyncSilenciosa();
    return res;
  }

  return {
    repositorio,
    syncEngine,
    inicializar,
    salvarRotaCalculada,
    salvarRotasOffline,
    buscarRotaSalvaPorAssinatura: (rota, pontos) => repositorio.buscarRotaSalvaPorAssinatura(rota, pontos),
    definirRotaCalculadaAtiva,
    limparSessaoGpsEmMemoria,
    obterUltimaExecucaoGpsSessao: () => ultimaExecucaoGpsSessao,
    iniciarNavegacaoGps,
    registrarPontoGps,
    pausarNavegacaoGps,
    retomarNavegacaoGps,
    finalizarNavegacaoGps,
    recuperarExecucaoPendente,
    obterRotaParaObservacao,
    criarObservacao,
    editarObservacao,
    alterarStatusObservacao,
    excluirObservacao,
    excluirRotaSalva,
    limparDadosLocais,
    listarRotasSalvas: (opts) =>
      repositorio.listarRotasSalvas({
        ...opts,
        limit: opts?.limit ?? opts?.limite ?? 100,
      }),
    obterRota,
    listarPontosGps,
    listarExecucoesGpsEmAndamento: (opts) => repositorio.listarExecucoesGpsEmAndamento(opts),
    listarObservacoes: (opts) => repositorio.listarObservacoes(opts),
    salvarCacheRede: (fc) => repositorio.salvarCacheRede(fc),
    carregarCacheRede: () => repositorio.carregarCacheRede(),
    sincronizarAgora: () => syncEngine.tentarSincronizarAgora(),
    sincronizarPendentes: (opts) => syncEngine.sincronizarPendentes(opts),
    obterResumoSincronizacao: () => repositorio.obterResumoSincronizacao({ online: estaOnline() }),
    reconstruirRespostaRotaDeRegistro,
    rotuloIndicadorSync,
    rotuloSyncStatus,
    rotuloTipoObservacao,
    rotuloStatusObservacaoCampo,
    STATUS_OBSERVACAO,
    TIPO_OBSERVACAO_CATALOGO,
    TIPO_ROTA,
    get rotaCalculadaAtiva() {
      return rotaCalculadaAtiva;
    },
    get execucaoGpsAtiva() {
      return execucaoGpsAtiva;
    },
  };
}
