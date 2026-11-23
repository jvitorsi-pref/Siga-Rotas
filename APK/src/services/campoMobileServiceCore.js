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
  reconstruirRespostaRotaDeRegistro,
  rotuloIndicadorSync,
  rotuloStatusObservacaoCampo,
  rotuloSyncStatus,
  rotuloTipoObservacao,
} from '../campo/modeloCampo.js';
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
      origemSalvamento = 'auto',
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

  function definirRotaCalculadaAtiva(registroRota) {
    rotaCalculadaAtiva = registroRota || null;
    aoMudar();
  }

  function iniciarNavegacaoGps(rotaAtual, { modo = 'gps' } = {}) {
    return enfileirarOperacaoGps(async () => {
      const simulado = modo === 'simulacao';
      const uid = (await obterUsuarioId()) || 'agente-mobile';
      let origemCliente = rotaAtual?.idCliente || rotaCalculadaAtiva?.idCliente || null;

      if (!origemCliente && rotaAtual?.ok && !simulado) {
        const salva = await repositorio.salvarRotaCalculada(rotaAtual, {
          pontos: rotaAtual.pontos || [],
          modo: rotaAtual.modo || 'usuario',
          circular: rotaAtual.circular !== false,
          origemSalvamento: 'auto',
          idUsuario: uid,
        });
        origemCliente = salva.rota.idCliente;
        rotaCalculadaAtiva = salva.rota;
      }

      execucaoGpsAtiva = await repositorio.iniciarExecucaoGps({
        idRotaOrigemCliente: origemCliente,
        simulado,
        idUsuario: uid,
      });
      segmentosTrilhaAtiva = [];
      aoMudar();
      return execucaoGpsAtiva;
    });
  }

  function registrarPontoGps(ponto) {
    return enfileirarOperacaoGps(async () => {
      if (!execucaoGpsAtiva) return { aceito: false, motivo: 'SEM_EXECUCAO' };
      const res = await repositorio.registrarPontoGps({
        idRotaCliente: execucaoGpsAtiva.idCliente,
        ponto,
      });
      if (res?.aceito && res?.ponto && !execucaoGpsAtiva.simulado) {
        if (!segmentosTrilhaAtiva.length || res.novoSegmento) {
          segmentosTrilhaAtiva.push([]);
        }
        segmentosTrilhaAtiva[segmentosTrilhaAtiva.length - 1].push([
          res.ponto.longitude,
          res.ponto.latitude,
        ]);
      }
      return {
        ...res,
        geometria: construirGeometriaTrilhaAtiva(),
      };
    });
  }

  function pausarNavegacaoGps() {
    return enfileirarOperacaoGps(async () => {
      if (!execucaoGpsAtiva) return null;
      execucaoGpsAtiva = await repositorio.pausarExecucaoGps(execucaoGpsAtiva.idCliente);
      return execucaoGpsAtiva;
    });
  }

  function retomarNavegacaoGps() {
    return enfileirarOperacaoGps(async () => {
      if (!execucaoGpsAtiva) return null;
      execucaoGpsAtiva = await repositorio.retomarExecucaoGps(execucaoGpsAtiva.idCliente);
      return execucaoGpsAtiva;
    });
  }

  function finalizarNavegacaoGps({ concluida = false } = {}) {
    return enfileirarOperacaoGps(async () => {
      if (!execucaoGpsAtiva) return null;
      const id = execucaoGpsAtiva.idCliente;
      execucaoGpsAtiva = null;
      segmentosTrilhaAtiva = [];
      const res = await repositorio.finalizarExecucaoGps(id, {
        statusFinal: concluida ? STATUS_ROTA.CONCLUIDA : STATUS_ROTA.INTERROMPIDA,
      });
      await syncEngine.emitirResumo(estaOnline());
      aoMudar();
      void dispararSyncSilenciosa();
      return res;
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
    return resolverRotaAtivaParaObservacao({
      execucaoGpsAtiva,
      rotaCalculadaAtiva,
    });
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
      throw new Error('Calcule ou abra uma rota salva antes de registrar uma observação.');
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
    definirRotaCalculadaAtiva,
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
    listarRotasSalvas: (opts) =>
      repositorio.listarRotasSalvas({
        ...opts,
        limit: opts?.limit ?? opts?.limite ?? 100,
      }),
    obterRota: (id) => repositorio.obterRota(id),
    listarPontosGps: (id) => repositorio.listarPontosGps(id),
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
