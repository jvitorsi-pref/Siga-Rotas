/** Ciclo de vida e comandos do painel; nenhuma regra de roteamento. */
import { normalizarApiUrl, resolverTipoTransporteApi } from '../config/apiConfig.js';

export function criarPainelRede({ service, aoMudar = () => {} }) {
  let aberto = false, descartado = false, unsubscribe = null, operacao = null, feedback = null;
  function emitir() {
    if (descartado) return;
    aoMudar({ features: service.state?.features || [], meta: service.getNetworkMeta(),
      diagnostics: service.getDiagnostics(), operacao, feedback });
  }
  async function executar(acao) {
    if (descartado || !aberto) return { ok: false, cancelado: true };
    if (!['carregar', 'verificar', 'baixar'].includes(acao)) return { ok: false, codigo: 'ACAO_INVALIDA' };
    if (operacao) return { ok: false, ocupado: true };
    operacao = acao;
    feedback = { kind: 'busy', text: acao === 'carregar' ? 'Carregando a rede viária…' : acao === 'verificar' ? 'Verificando o conteúdo da rede no WFS…' : 'Atualizando as ruas…' };
    emitir();
    try {
      let resultado;
      if (acao === 'carregar') resultado = await service.ensureReady();
      else if (acao === 'verificar') resultado = await service.checkForChanges({ deep: true });
      else resultado = await service.refreshFromWfs();
      if (descartado) return { ok: false, cancelado: true };
      if (acao === 'carregar') service.startAutoUpdate();
      feedback = { kind: 'ok', text: acao === 'carregar'
        ? `Rede pronta (${service.state.features.length.toLocaleString('pt-BR')} eixos).`
        : acao === 'verificar' ? (resultado.reason || (resultado.changed ? 'Rede atualizada.' : 'Nenhuma alteração detectada.'))
          : 'Atualização da rede concluída.' };
      return { ok: true, resultado };
    } catch (erro) {
      if (descartado) return { ok: false, cancelado: true };
      feedback = { kind: 'err', text: 'Não foi possível ' + (acao === 'carregar' ? 'carregar' : 'atualizar') + ' a rede: ' + (erro?.message || String(erro)) };
      return { ok: false, message: feedback.text };
    } finally {
      operacao = null;
      emitir();
    }
  }
  async function configurarServidor(rawUrl) {
    if (descartado || !aberto) return { ok: false, cancelado: true };
    if (operacao) return { ok: false, ocupado: true };
    const texto = String(rawUrl || '').trim();
    if (!texto || texto.toLowerCase() === 'local') {
      await service.setRemoteApiUrl('');
      service.stopAutoUpdate?.();
      if (service.options?.allowWfs) service.startAutoUpdate?.();
      feedback = { kind: 'ok', text: 'Modo local ativado neste aparelho (sem servidor remoto).' };
      emitir();
      return { ok: true, mode: 'local', url: null };
    }
    const normalized = normalizarApiUrl(texto);
    if (!normalized) {
      feedback = {
        kind: 'err',
        text: 'Endereço inválido. Use http:// ou https:// (ex.: https://portal.../ApiProxy.ashx).',
      };
      emitir();
      return { ok: false, codigo: 'URL_INVALIDA' };
    }

    operacao = 'conectar';
    feedback = { kind: 'busy', text: 'Conectando ao servidor backend…' };
    emitir();
    try {
      await service.setRemoteApiUrl(normalized);
      const resultado = await service.syncWithServer({ forceNetworkReload: true });
      if (descartado) return { ok: false, cancelado: true };
      service.startAutoUpdate?.();
      const transporte =
        resolverTipoTransporteApi(normalized) === 'ashx' ? 'ApiProxy.ashx' : 'API direta';
      const eixos = Number(resultado?.knownTotal ?? service.state?.features?.length ?? 0).toLocaleString('pt-BR');
      feedback = {
        kind: 'ok',
        text: `Conectado via ${transporte} (${resultado?.backendSource || 'node'}; ${eixos} eixos).`,
      };
      return { ok: true, mode: 'remote', url: normalized, resultado };
    } catch (erro) {
      if (descartado) return { ok: false, cancelado: true };
      feedback = {
        kind: 'err',
        text: 'Não foi possível conectar ao servidor: ' + (erro?.message || String(erro)),
      };
      return { ok: false, message: feedback.text };
    } finally {
      operacao = null;
      emitir();
    }
  }
  return {
    abrir() {
      if (descartado || aberto) return Promise.resolve({ ok: false, cancelado: true });
      aberto = true;
      unsubscribe = service.subscribe(emitir);
      return executar('carregar');
    },
    executar,
    configurarServidor,
    descartar() {
      if (descartado) return;
      descartado = true;
      unsubscribe?.(); unsubscribe = null;
      service.stopAutoUpdate();
    },
  };
}
