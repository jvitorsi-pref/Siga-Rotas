/** Ciclo de vida e comandos do painel; nenhuma regra de roteamento. */
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
    feedback = { kind: 'busy', text: acao === 'carregar' ? 'Carregando a rede viária…' : acao === 'verificar' ? 'Verificando o conteúdo da rede no WFS…' : 'Baixando a rede do GeoServer…' };
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
  return {
    abrir() {
      if (descartado || aberto) return Promise.resolve({ ok: false, cancelado: true });
      aberto = true;
      unsubscribe = service.subscribe(emitir);
      return executar('carregar');
    },
    executar,
    descartar() {
      if (descartado) return;
      descartado = true;
      unsubscribe?.(); unsubscribe = null;
      service.stopAutoUpdate();
    },
  };
}
