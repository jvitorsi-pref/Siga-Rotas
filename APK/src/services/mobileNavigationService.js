/** Integração mobile: reutiliza controlador, instruções e simulador da Web. */
import { criarNavegacao, planoDeNavegacao, EXECUCAO } from '../../../core/navegacao.js';
import { criarSimulador } from '../../../core/simulador.js';
import { instrucaoAtual } from '../../../core/instrucoes.js';

export function criarNavegacaoMobile({ calcularRotaParadas, aoMudar = () => {}, aoRecalcular = () => {}, criarFonte = criarSimulador, criarFonteGPS } = {}) {
  let controlador = null, fonte = null, resposta = null;
  let geracao = 0, descartada = false, velocidade = 5, aviso = '', concluida = false;
  let recalculo = null, revisaoRecalculo = 0, revisaoAtivacao = 0, modo = 'simulacao', iniciando = false;

  function snapshot() {
    const e = controlador?.estado;
    return e ? {
      ...e, posicao: e.posicao ? { ...e.posicao } : null,
      paradasConcluidas: [...e.paradasConcluidas],
      instrucao: instrucaoAtual(controlador.plano, e),
      modo, iniciando, aviso, concluida, velocidadeSim: velocidade,
      sinal: fonte?.sinal !== false,
      inicios: controlador.plano.pernas.map((p, i) => ({
        titulo: `${p.de} → ${p.para}`, metros: controlador.plano.cum[controlador.plano.limites[i]] || 0,
      })),
    } : null;
  }
  function emitir() { if (!descartada) aoMudar(snapshot()); }
  function pararFonte() { fonte?.parar(); }
  function cancelarRecalculo() {
    geracao++; revisaoRecalculo++; revisaoAtivacao++;
    recalculo = null;
    if (controlador) {
      controlador.estado.recalculando = false;
      controlador.reiniciarContadores();
    }
  }
  async function recalcular(info) {
    if (recalculo || !controlador || controlador.estado.execucao !== EXECUCAO.ATIVO) return;
    const ctrl = controlador, token = geracao, revisao = revisaoRecalculo;
    const restantes = ctrl.plano.paradas.slice(ctrl.indiceParada).filter(p => p.latitude != null && p.longitude != null);
    if (!restantes.length) return;
    const pontos = [{ rotulo: 'A', ...info.posicao }, ...restantes.map(p => ({ rotulo: p.rotulo, latitude: p.latitude, longitude: p.longitude }))];
    const operacao = {};
    recalculo = operacao;
    ctrl.estado.recalculando = true;
    aviso = 'Desvio confirmado. Recalculando pela rede viária local…'; emitir();
    const valido = () => !descartada && token === geracao && revisao === revisaoRecalculo && controlador === ctrl && ctrl.estado.execucao === EXECUCAO.ATIVO;
    try {
      const data = await calcularRotaParadas(pontos, { modo: 'usuario', circular: false });
      if (!valido()) return;
      if (!data?.ok) throw new Error(data?.message || 'Não foi possível recalcular o trecho.');
      const plano = planoDeNavegacao(data, { rotulos: pontos.map(p => p.rotulo) });
      fonte?.definirPlano?.(plano);
      resposta = data;
      ctrl.replanejar(plano, { deslocamento: ctrl.estado.percorrido });
      ctrl.reiniciarContadores();
      fonte?.limparDesvio?.();
      aviso = 'Rota recalculada a partir da posição atual. Ordem das paradas restantes preservada.';
      aoRecalcular(data);
    } catch (erro) {
      if (valido()) aviso = 'Falha no recálculo: ' + erro.message;
    } finally {
      if (recalculo === operacao) recalculo = null;
      if (valido()) { ctrl.estado.recalculando = false; emitir(); }
    }
  }
  function ativarFonte(retomar = false) {
    const token = geracao, ativacao = ++revisaoAtivacao;
    const ctrl = controlador;
    iniciando = modo === 'gps'; emitir();
    const terminar = resultado => {
      if (descartada || token !== geracao || ativacao !== revisaoAtivacao || ctrl !== controlador || ctrl.estado.execucao !== EXECUCAO.ATIVO) return { ok: false, cancelado: true };
      if (resultado?.cancelado) return resultado;
      iniciando = false;
      if (resultado?.ok === false) {
        ctrl.pausar(); aviso = resultado.message || 'Não foi possível iniciar a fonte de posição.';
      }
      emitir(); return resultado?.ok === false ? resultado : { ok: true };
    };
    try {
      const resultado = retomar ? fonte.retomar() : fonte.iniciar();
      if (resultado?.then) return resultado.then(terminar).catch(erro => terminar({ ok: false, message: erro.message }));
      return terminar(resultado);
    } catch (erro) { return terminar({ ok: false, message: erro.message }); }
  }
  const api = {
    get estado() { return snapshot(); },
    iniciar(rota, modoSolicitado = 'simulacao') {
      if (descartada) return { ok: false, message: 'Controlador descartado.' };
      if (!rota?.ok || !rota.legs?.length) return { ok: false, message: 'Calcule uma rota completa antes de navegar.' };
      const plano = planoDeNavegacao(rota);
      if (!plano.total || plano.xy.length < 4 || plano.xy.some(n => !Number.isFinite(n))) return { ok: false, message: 'Rota sem geometria válida.' };
      if (!['gps', 'simulacao'].includes(modoSolicitado)) return { ok: false, message: 'Fonte de posição inválida.' };
      if (modoSolicitado === 'gps' && !criarFonteGPS) return { ok: false, message: 'Fonte GPS nativa indisponível.' };
      cancelarRecalculo(); pararFonte(); modo = modoSolicitado; iniciando = false;
      fonte = null; resposta = rota; concluida = false;
      aviso = modo === 'simulacao' ? 'MODO DE TESTE — posição simulada, não é GPS real.' : 'GPS real — aguardando permissão e localização do aparelho.';
      controlador = criarNavegacao(plano, {
        aoMudar: emitir,
        aoChegarParada: p => { aviso = `Chegada confirmada à parada ${p.rotulo}.`; emitir(); },
        aoDesvioConfirmado: info => { void recalcular(info); },
        aoConcluir: () => { cancelarRecalculo(); concluida = true; pararFonte(); aviso = modo === 'simulacao' ? 'Trajeto concluído em modo de teste.' : 'Trajeto concluído com GPS real.'; emitir(); },
      });
      const token = geracao;
      const factory = modo === 'gps' ? criarFonteGPS : criarFonte;
      fonte = factory({ plano, velocidadeMultiplicador: velocidade, aoAtualizar: p => {
        if (descartada || token !== geracao || controlador.estado.execucao !== EXECUCAO.ATIVO) return;
        if ((p.simulado === true) !== (modo === 'simulacao')) { aviso = 'Fonte incompatível com a navegação selecionada.'; emitir(); return; }
        controlador.atualizarPosicao(p);
      }, aoErro: erro => {
        if (descartada || token !== geracao) return;
        aviso = erro.mensagem; controlador.marcarSinalPerdido(true); emitir();
      }, aoInterromper: mensagem => {
        if (descartada || token !== geracao) return;
        api.pausar(); aviso = mensagem; emitir();
      } });
      controlador.iniciar(); return ativarFonte();
    },
    pausar() {
      if (controlador?.estado.execucao !== EXECUCAO.ATIVO) return;
      // Não muda a geração da fonte; só invalida o recálculo em andamento.
      fonte?.pausar(); iniciando = false; revisaoRecalculo++; revisaoAtivacao++; controlador.pausar(); recalculo = null;
      controlador.estado.recalculando = false; controlador.reiniciarContadores(); emitir();
    },
    retomar() {
      if (controlador?.estado.execucao !== EXECUCAO.PAUSADO) return;
      controlador.retomar(); return ativarFonte(true);
    },
    encerrar() {
      cancelarRecalculo(); pararFonte(); iniciando = false;
      if (controlador) controlador.encerrar();
      controlador = null; fonte = null; resposta = null; emitir();
    },
    reiniciar() { if (resposta) return api.iniciar(resposta, modo); },
    definirVelocidade(v) { if (modo !== 'simulacao' || ![1, 2, 5, 10, 25, 50].includes(v)) return; velocidade = v; fonte?.definirVelocidade(v); emitir(); },
    avancar(metros) { if (modo !== 'simulacao') return; fonte?.avancar(metros); },
    iniciarEm(metros) { if (modo !== 'simulacao') return; fonte?.iniciarEm(metros); },
    aplicarDesvio() { if (modo !== 'simulacao') return; fonte?.aplicarDesvio(120); emitir(); },
    limparDesvio() { if (modo !== 'simulacao') return; fonte?.limparDesvio?.(); emitir(); },
    perderSinal() { if (modo !== 'simulacao') return; fonte?.perderSinal(); controlador?.marcarSinalPerdido(true); aviso = 'MODO DE TESTE — sinal perdido.'; emitir(); },
    recuperarSinal() { if (modo !== 'simulacao') return; fonte?.recuperarSinal(); controlador?.marcarSinalPerdido(false); aviso = 'MODO DE TESTE — sinal recuperado.'; emitir(); },
    posicaoManual(latitude, longitude) {
      if (modo !== 'simulacao') return { ok: false };
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { ok: false };
      fonte?.definirPosicaoManual(latitude, longitude); return { ok: true };
    },
    descartar() { descartada = true; api.encerrar(); },
  };
  return api;
}
