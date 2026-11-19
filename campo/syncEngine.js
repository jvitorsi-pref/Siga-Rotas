/**
 * campo/syncEngine.js — Motor autônomo de sincronização idempotente (Web & APK)
 * -----------------------------------------------------------------------------
 * Regras garantidas:
 *   • Nunca considera sincronizado antes da confirmação explícita do servidor;
 *   • Nunca apaga registros locais após `SYNCED`;
 *   • Nunca mistura dados simulados (`simulado = true`) com dados reais;
 *   • Bloqueia execuções paralelas com trava de concorrência;
 *   • Respeita dependências (`CALCULADA` → `GPS` → `OBSERVACAO` → `EVENTO`);
 *   • Recupera registros presos em `SYNCING` após fechamento inesperado;
 *   • Aplica backoff progressivo em falhas transitórias e permite retry manual.
 */

import {
  ENTIDADE_SYNC,
  SYNC_STATUS,
  TIPO_ROTA,
  normalizarIso,
} from './modeloCampo.js';
import {
  serializarEventoParaEnvio,
  serializarObservacaoParaEnvio,
  serializarRotaParaEnvio,
} from './contratosBackend.js';

export const BACKOFF_SEGUNDOS = Object.freeze([5, 15, 45, 120, 300, 900]);

export function calcularProximaTentativaIso(tentativas, agora = Date.now) {
  const idx = Math.min(Math.max(0, Number(tentativas || 1) - 1), BACKOFF_SEGUNDOS.length - 1);
  const atrasoMs = BACKOFF_SEGUNDOS[idx] * 1000;
  return new Date(agora() + atrasoMs).toISOString();
}

export function criarMotorSincronizacao({
  repositorio,
  clienteBackend,
  dispositivoId = 'dispositivo-siga',
  aoMudar = () => {},
  estaOnline = () => true,
  agora = Date.now,
} = {}) {
  let promessaEmExecucao = null;
  let ultimoResumo = null;

  async function emitirResumo(onlineOverride = null) {
    const online = onlineOverride == null ? Boolean(estaOnline()) : Boolean(onlineOverride);
    const resumo = await repositorio.obterResumoSincronizacao({ online });
    ultimoResumo = resumo;
    aoMudar(resumo);
    return resumo;
  }

  async function construirMapaIdsServidor() {
    const mapa = new Map();
    const rotas = await repositorio.driver.listRotas({ incluirSimuladas: true, limit: 500 });
    for (const r of rotas) {
      if (r.idServidor != null) mapa.set(r.idCliente, r.idServidor);
    }
    const obs = await repositorio.driver.listObservacoes({ incluirSimuladas: true });
    for (const o of obs) {
      if (o.idServidor != null) mapa.set(o.idCliente, o.idServidor);
    }
    return mapa;
  }

  async function atualizarStatusEntidade(item, patch) {
    if (item.entidadeTipo === ENTIDADE_SYNC.ROTA) {
      const reg = await repositorio.driver.getRota(item.entidadeId);
      if (reg) await repositorio.driver.putRota({ ...reg, ...patch });
    } else if (item.entidadeTipo === ENTIDADE_SYNC.OBSERVACAO) {
      const reg = await repositorio.driver.getObservacao(item.entidadeId);
      if (reg) await repositorio.driver.putObservacaoEEvento({ ...reg, ...patch }, null, []);
    } else if (item.entidadeTipo === ENTIDADE_SYNC.EVENTO) {
      const reg = await repositorio.driver.getEvento(item.entidadeId);
      if (reg) await repositorio.driver.putEvento({ ...reg, ...patch });
    }
  }

  function itemElegivelAgora(item, forcar, agoraMs) {
    if (item.status === SYNC_STATUS.SYNCED) return false;
    if (item.status === SYNC_STATUS.SYNCING) return false;
    if (item.status === SYNC_STATUS.ERROR) {
      if (!forcar && item.proximaTentativaEm) {
        const prox = Date.parse(item.proximaTentativaEm);
        if (Number.isFinite(prox) && prox > agoraMs) return false;
      }
    }
    return true;
  }

  async function selecionarProximoLote(forcar) {
    const itens = await repositorio.driver.listSyncItens({
      statuses: [SYNC_STATUS.PENDING, SYNC_STATUS.ERROR],
    });
    const agoraMs = agora();
    const mapaIds = await construirMapaIdsServidor();

    const rotasCalc = [];
    const rotasGps = [];
    const observacoes = [];
    const eventos = [];

    for (const item of itens) {
      if (!itemElegivelAgora(item, forcar, agoraMs)) continue;

      if (item.entidadeTipo === ENTIDADE_SYNC.ROTA) {
        const rota = await repositorio.driver.getRota(item.entidadeId);
        if (!rota || rota.simulado) {
          await repositorio.driver.upsertSyncItem({ ...item, status: SYNC_STATUS.SYNCED });
          continue;
        }
        if (rota.tipoRota === TIPO_ROTA.CALCULADA) {
          rotasCalc.push({ item, reg: rota });
        } else {
          // Rota GPS vinculada aguarda o servidor confirmar a rota CALCULADA de origem (quando há vínculo)
          if (rota.idRotaOrigemCliente && !mapaIds.has(rota.idRotaOrigemCliente) && !rota.idRotaOrigemServidor) {
            continue;
          }
          rotasGps.push({ item, reg: rota });
        }
      } else if (item.entidadeTipo === ENTIDADE_SYNC.OBSERVACAO) {
        const obs = await repositorio.driver.getObservacao(item.entidadeId);
        if (!obs || obs.simulado) {
          await repositorio.driver.upsertSyncItem({ ...item, status: SYNC_STATUS.SYNCED });
          continue;
        }
        if (obs.idRotaCliente && !mapaIds.has(obs.idRotaCliente) && !obs.idRotaServidor) {
          continue;
        }
        observacoes.push({ item, reg: obs });
      } else if (item.entidadeTipo === ENTIDADE_SYNC.EVENTO) {
        const evt = await repositorio.driver.getEvento(item.entidadeId);
        if (!evt || evt.simulado) {
          await repositorio.driver.upsertSyncItem({ ...item, status: SYNC_STATUS.SYNCED });
          continue;
        }
        if (
          evt.idObservacaoCliente &&
          !mapaIds.has(evt.idObservacaoCliente) &&
          !evt.idObservacaoServidor
        ) {
          continue;
        }
        eventos.push({ item, reg: evt });
      }
    }

    // Prioriza por camada de dependência em cada passada para manter FKs consistentes
    if (rotasCalc.length) return { lote: rotasCalc.slice(0, 10), mapaIds };
    if (rotasGps.length) return { lote: rotasGps.slice(0, 10), mapaIds };
    if (observacoes.length) return { lote: observacoes.slice(0, 15), mapaIds };
    if (eventos.length) return { lote: eventos.slice(0, 25), mapaIds };
    return { lote: [], mapaIds };
  }

  async function aplicarResultadoItem(entry, resServidor, isTransitorio) {
    const { item } = entry;
    const agoraIso = normalizarIso(null, agora);

    if (!resServidor) {
      const tentativas = Number(item.tentativas || 0) + 1;
      const novoStatus = isTransitorio ? SYNC_STATUS.ERROR : SYNC_STATUS.PENDING;
      const erroMsg = 'Servidor não retornou confirmação individual para este registro.';
      await repositorio.driver.upsertSyncItem({
        ...item,
        status: novoStatus,
        tentativas,
        ultimoErro: erroMsg,
        proximaTentativaEm: calcularProximaTentativaIso(tentativas, agora),
        atualizadoEm: agoraIso,
      });
      await atualizarStatusEntidade(item, { syncStatus: novoStatus, syncErro: erroMsg });
      return { sincronizado: false, erro: true };
    }

    const r = String(resServidor.resultado || '').toUpperCase();
    if (r === 'PERSISTIDO' || r === 'JA_EXISTENTE') {
      await repositorio.driver.upsertSyncItem({
        ...item,
        status: SYNC_STATUS.SYNCED,
        ultimoErro: null,
        proximaTentativaEm: null,
        atualizadoEm: agoraIso,
      });
      const patch = {
        idServidor: resServidor.idServidor ?? entry.reg.idServidor ?? null,
        versaoServidor: resServidor.versaoServidor ?? entry.reg.versaoLocal ?? 1,
        syncStatus: SYNC_STATUS.SYNCED,
        syncErro: null,
        conflitoServidor: null,
      };
      if (item.entidadeTipo === ENTIDADE_SYNC.OBSERVACAO && resServidor.idPaiServidor != null) {
        patch.idRotaServidor = resServidor.idPaiServidor;
      }
      if (item.entidadeTipo === ENTIDADE_SYNC.ROTA && resServidor.idPaiServidor != null) {
        patch.idRotaOrigemServidor = resServidor.idPaiServidor;
      }
      await atualizarStatusEntidade(item, patch);
      return { sincronizado: true, erro: false };
    }

    if (r === 'ROTA_ORIGEM_NAO_ENCONTRADA' || r === 'OBSERVACAO_NAO_ENCONTRADA') {
      // Pai ainda não disponível no servidor: volta para PENDING sem descartar
      const tentativas = Number(item.tentativas || 0) + 1;
      const erroMsg = resServidor.mensagem || 'Registro pai ainda não sincronizado.';
      await repositorio.driver.upsertSyncItem({
        ...item,
        status: SYNC_STATUS.PENDING,
        tentativas,
        ultimoErro: erroMsg,
        proximaTentativaEm: calcularProximaTentativaIso(tentativas, agora),
        atualizadoEm: agoraIso,
      });
      await atualizarStatusEntidade(item, { syncStatus: SYNC_STATUS.PENDING, syncErro: erroMsg });
      return { sincronizado: false, erro: false };
    }

    const tentativas = Number(item.tentativas || 0) + 1;
    const erroMsg = resServidor.mensagem || `Falha no servidor (${r || 'ERRO'}).`;
    await repositorio.driver.upsertSyncItem({
      ...item,
      status: SYNC_STATUS.ERROR,
      tentativas,
      ultimoErro: erroMsg,
      proximaTentativaEm: r === 'CONFLITO' ? null : calcularProximaTentativaIso(tentativas, agora),
      atualizadoEm: agoraIso,
    });
    const patchErro = {
      syncStatus: SYNC_STATUS.ERROR,
      syncErro: erroMsg,
    };
    if (r === 'CONFLITO') {
      patchErro.conflitoServidor = {
        versaoServidor: resServidor.versaoServidor ?? null,
        dataAtualizacaoServidor: resServidor.dataAtualizacaoServidor ?? null,
        mensagem: erroMsg,
      };
    }
    await atualizarStatusEntidade(item, patchErro);
    return { sincronizado: false, erro: true, conflito: r === 'CONFLITO' };
  }

  async function executarCicloSincronizacao({ forcar = false } = {}) {
    await repositorio.inicializar();
    if (!estaOnline() && !forcar) {
      const resumo = await emitirResumo(false);
      return { ok: false, motivo: 'OFFLINE', sincronizados: 0, erros: 0, resumo };
    }

    let sincronizadosTotal = 0;
    let errosTotal = 0;
    let conflitosTotal = 0;

    // Executa passadas em cadeia para que CALCULADA → GPS → OBSERVACAO → EVENTO
    // possam completar todos na mesma janela de conexão sem esperar outro disparo
    for (let passada = 0; passada < 8; passada += 1) {
      const { lote, mapaIds } = await selecionarProximoLote(forcar);
      if (!lote.length) break;

      const agoraIso = normalizarIso(null, agora);
      for (const entry of lote) {
        await repositorio.driver.upsertSyncItem({
          ...entry.item,
          status: SYNC_STATUS.SYNCING,
          atualizadoEm: agoraIso,
        });
        await atualizarStatusEntidade(entry.item, { syncStatus: SYNC_STATUS.SYNCING });
      }
      await emitirResumo(true);

      const rotasPayload = [];
      const observacoesPayload = [];
      const eventosPayload = [];

      for (const entry of lote) {
        if (entry.item.entidadeTipo === ENTIDADE_SYNC.ROTA) {
          rotasPayload.push(serializarRotaParaEnvio(entry.reg, mapaIds));
        } else if (entry.item.entidadeTipo === ENTIDADE_SYNC.OBSERVACAO) {
          observacoesPayload.push(
            serializarObservacaoParaEnvio(entry.reg, entry.item.operacao, mapaIds),
          );
        } else if (entry.item.entidadeTipo === ENTIDADE_SYNC.EVENTO) {
          eventosPayload.push(serializarEventoParaEnvio(entry.reg, mapaIds));
        }
      }

      const resposta = await clienteBackend.sincronizarLote({
        dispositivoId,
        rotas: rotasPayload,
        observacoes: observacoesPayload,
        eventos: eventosPayload,
      });

      if (!resposta?.ok) {
        const transitorio = Boolean(resposta?.transitorio);
        const statusFalha = transitorio ? SYNC_STATUS.PENDING : SYNC_STATUS.ERROR;
        const erroMsg = resposta?.message || 'Falha na comunicação com o backend WebForms.';
        for (const entry of lote) {
          const tentativas = Number(entry.item.tentativas || 0) + 1;
          await repositorio.driver.upsertSyncItem({
            ...entry.item,
            status: statusFalha,
            tentativas,
            ultimoErro: erroMsg,
            proximaTentativaEm: calcularProximaTentativaIso(tentativas, agora),
            atualizadoEm: normalizarIso(null, agora),
          });
          await atualizarStatusEntidade(entry.item, {
            syncStatus: statusFalha,
            syncErro: erroMsg,
          });
        }
        errosTotal += lote.length;
        const resumo = await emitirResumo(!transitorio);
        return {
          ok: false,
          motivo: resposta?.reason || 'FALHA_REDE',
          message: erroMsg,
          sincronizados: sincronizadosTotal,
          erros: errosTotal,
          conflitos: conflitosTotal,
          resumo,
        };
      }

      const mapRotas = new Map(
        (resposta.resultadosRotas || []).map((r) => [r.idCliente, r]),
      );
      const mapObs = new Map(
        (resposta.resultadosObservacoes || []).map((r) => [r.idCliente, r]),
      );
      const mapEvts = new Map(
        (resposta.resultadosEventos || []).map((r) => [r.idCliente, r]),
      );

      let progrediuNaPassada = false;
      for (const entry of lote) {
        const resItem =
          entry.item.entidadeTipo === ENTIDADE_SYNC.ROTA
            ? mapRotas.get(entry.reg.idCliente)
            : entry.item.entidadeTipo === ENTIDADE_SYNC.OBSERVACAO
              ? mapObs.get(entry.reg.idCliente)
              : mapEvts.get(entry.reg.idCliente);

        const desfecho = await aplicarResultadoItem(entry, resItem, false);
        if (desfecho.sincronizado) {
          sincronizadosTotal += 1;
          progrediuNaPassada = true;
        }
        if (desfecho.erro) errosTotal += 1;
        if (desfecho.conflito) conflitosTotal += 1;
      }

      if (!progrediuNaPassada) break;
    }

    const resumo = await emitirResumo(true);
    return {
      ok: errosTotal === 0,
      sincronizados: sincronizadosTotal,
      erros: errosTotal,
      conflitos: conflitosTotal,
      resumo,
    };
  }

  function sincronizarPendentes(opcoes = {}) {
    if (promessaEmExecucao) return promessaEmExecucao;
    promessaEmExecucao = executarCicloSincronizacao(opcoes).finally(() => {
      promessaEmExecucao = null;
    });
    return promessaEmExecucao;
  }

  async function tentarSincronizarAgora() {
    await repositorio.inicializar();
    const itens = await repositorio.driver.listSyncItens({ statuses: [SYNC_STATUS.ERROR] });
    for (const item of itens) {
      await repositorio.driver.upsertSyncItem({
        ...item,
        status: SYNC_STATUS.PENDING,
        proximaTentativaEm: null,
        atualizadoEm: normalizarIso(null, agora),
      });
    }
    return sincronizarPendentes({ forcar: true });
  }

  return {
    sincronizarPendentes,
    tentarSincronizarAgora,
    emitirResumo,
    get ultimoResumo() {
      return ultimoResumo;
    },
    get emExecucao() {
      return Boolean(promessaEmExecucao);
    },
  };
}
