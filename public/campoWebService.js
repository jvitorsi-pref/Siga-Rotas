/**
 * public/campoWebService.js — Serviço Web offline-first (IndexedDB + Sync WebForms)
 * ----------------------------------------------------------------------------------
 * Orquestra persistência local imediata em IndexedDB, captura incremental GPS,
 * observações vinculadas a rotas, cache separado da rede viária e sincronização
 * automática com o backend compartilhado WebForms (`SigaRotasCampo.ashx`).
 */

import {
  STATUS_OBSERVACAO,
  STATUS_ROTA,
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
import { criarDriverIndexedDB } from './armazenamentoIndexedDB.js';
import { detectarConfiguracaoAmbiente } from './clienteRede.js';

export function criarServicoCampoWeb({
  driver = null,
  obterUsuarioId = () => 'agente-local',
  obterDispositivoId = () => 'web-siga-rotas',
  fetchFn = (...args) => globalThis.fetch(...args),
  estaOnline = () => (typeof navigator !== 'undefined' ? navigator.onLine !== false : true),
  aoMudar = () => {},
  aoMudarSync = () => {},
} = {}) {
  let driverEfetivo = driver;
  if (!driverEfetivo) {
    driverEfetivo =
      typeof globalThis.indexedDB !== 'undefined'
        ? criarDriverIndexedDB()
        : criarDriverMemoria();
  }

  const repositorio = criarRepositorioCampo({ driver: driverEfetivo });

  const clienteBackend = criarClienteBackendCampo({
    obterBaseUrl: () => {
      const cfg = detectarConfiguracaoAmbiente({}, globalThis.location, globalThis.__SIGA_CONFIG__);
      const g = globalThis.__SIGA_CONFIG__ || {};
      return resolverUrlBackendCampo({
        campoUrl: g.campoApiUrl || null,
        apiUrl: cfg.apiBase || null,
        proxyPath: g.campoProxyPath || cfg.proxyPath || null,
        href: cfg.href,
      });
    },
    obterHeaders: async () => {
      const uid = obterUsuarioId();
      return uid ? { 'X-Siga-Usuario': String(uid) } : {};
    },
    fetchFn,
  });

  let rotaCalculadaAtiva = null;
  let execucaoGpsAtiva = null;
  let cadeiaGps = Promise.resolve();

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
    try {
      await repositorio.inicializar();
    } catch {
      // Se IndexedDB falhar em contexto restrito, mantém operação sem travar UI
    }
    await syncEngine.emitirResumo(estaOnline());
  }

  function dispararSyncSilenciosa() {
    if (!estaOnline()) return Promise.resolve({ ok: false, motivo: 'OFFLINE' });
    return syncEngine.sincronizarPendentes().catch(() => null);
  }

  async function salvarRotaCalculada(rota, { pontos = [], modo = 'usuario', circular = true, origemSalvamento = 'auto', titulo = null } = {}) {
    const res = await repositorio.salvarRotaCalculada(rota, {
      pontos,
      modo,
      circular,
      origemSalvamento,
      titulo,
      idUsuario: obterUsuarioId(),
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
      let origemCliente = rotaAtual?.idCliente || rotaCalculadaAtiva?.idCliente || null;

      if (!origemCliente && rotaAtual?.ok && !simulado) {
        const salva = await repositorio.salvarRotaCalculada(rotaAtual, {
          pontos: rotaAtual.pontos || [],
          modo: rotaAtual.modo || 'usuario',
          circular: rotaAtual.circular !== false,
          origemSalvamento: 'auto',
          idUsuario: obterUsuarioId(),
        });
        origemCliente = salva.rota.idCliente;
        rotaCalculadaAtiva = salva.rota;
      }

      execucaoGpsAtiva = await repositorio.iniciarExecucaoGps({
        idRotaOrigemCliente: origemCliente,
        simulado,
        idUsuario: obterUsuarioId(),
      });
      aoMudar();
      return execucaoGpsAtiva;
    });
  }

  function registrarPontoGps(ponto) {
    return enfileirarOperacaoGps(async () => {
      if (!execucaoGpsAtiva) return { aceito: false, motivo: 'SEM_EXECUCAO' };
      return repositorio.registrarPontoGps({
        idRotaCliente: execucaoGpsAtiva.idCliente,
        ponto,
      });
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

  async function criarObservacao({ latitude, longitude, tipoObservacao, descricao, idRotaCliente = null } = {}) {
    const rotaAlvoId = idRotaCliente || obterRotaParaObservacao()?.idCliente;
    if (!rotaAlvoId) {
      throw new Error('Calcule ou abra uma rota salva antes de registrar uma observação.');
    }
    const res = await repositorio.criarObservacaoRota({
      idRotaCliente: rotaAlvoId,
      latitude,
      longitude,
      tipoObservacao,
      descricao,
      idUsuario: obterUsuarioId(),
    });
    await syncEngine.emitirResumo(estaOnline());
    aoMudar();
    void dispararSyncSilenciosa();
    return res;
  }

  async function editarObservacao({ idCliente, descricao, tipoObservacao } = {}) {
    const res = await repositorio.editarObservacaoRota({
      idCliente,
      descricao,
      tipoObservacao,
      idUsuario: obterUsuarioId(),
    });
    await syncEngine.emitirResumo(estaOnline());
    aoMudar();
    void dispararSyncSilenciosa();
    return res;
  }

  async function alterarStatusObservacao({ idCliente, novoStatus, motivo = null } = {}) {
    const res = await repositorio.alterarStatusObservacao({
      idCliente,
      novoStatus,
      motivo,
      idUsuario: obterUsuarioId(),
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
    listarRotasSalvas: (opts) => repositorio.listarRotasSalvas(opts),
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
    TIPO_ROTA,
    get rotaCalculadaAtiva() {
      return rotaCalculadaAtiva;
    },
    get execucaoGpsAtiva() {
      return execucaoGpsAtiva;
    },
  };
}
