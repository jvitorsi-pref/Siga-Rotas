/* ==========================================================================
   public/coletaUI.js
   --------------------------------------------------------------------------
   Interface de COLETA DE CAMPO.

   Se apoia em três módulos já existentes no projeto:
     • `core/armazenamentoLocal.js` — persistência local (IndexedDB);
     • `core/coleta.js`               — a sessão de rastreamento GPS;
     • `core/fonteGPS.js`             — a fonte de GPS (a mesma da navegação).

   O que esta camada faz (e nada mais):
     • salva a **rota planejada** no dispositivo e a recupera depois;
     • inicia/pausa/retoma/encerra a **coleta do trajeto real**, desenhando
       o trajeto percorrido **separado** da rota planejada;
     • registra a **localização de uma residência** (coordenadas + precisão +
       Plus Code calculado localmente), com aviso de possível duplicidade;
     • mostra o que está no dispositivo e o que ainda **não** foi sincronizado.

   O que esta camada NÃO faz (e por quê): a sincronização com a API é a
   etapa 4 do plano; até lá o botão de sincronização fica desabilitado e o
   texto deixa isso explícito — nada é declarado como pronto sem existir.
   ========================================================================== */

import {
  ESTADO,
  criarAdaptadorIndexedDB,
  criarAdaptadorMemoria,
  criarArmazenamento,
} from '../core/armazenamentoLocal.js';
import {
  CLASSIFICACAO,
  ESTADO_COLETA,
  FONTE,
  capturarPosicao,
  criarColeta,
  detectarDuplicado,
  montarLocalizacaoResidencia,
} from '../core/coleta.js';
import { prepararRetomadaSimulada } from '../core/recuperacaoColeta.js';
import { criarSimulador, VELOCIDADES } from '../core/simulador.js';
import { criarFonteGPS } from '../core/fonteGPS.js';
import { planoDeNavegacao } from '../core/navegacao.js';
import { rotuloModo } from './resumoRota.js';
import { persistirPlanoAtivo, assinaturaPlanejador } from './planoPersistido.js';

const CHAVE_DISPOSITIVO = 'santo-andre:dispositivo';

/** Identificador local e anônimo do aparelho (não é credencial). */
function idDispositivo() {
  try {
    let id = localStorage.getItem(CHAVE_DISPOSITIVO);
    if (!id) {
      id = 'disp_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem(CHAVE_DISPOSITIVO, id);
    }
    return id;
  } catch {
    return 'disp_' + Math.random().toString(36).slice(2, 10);
  }
}

/** Identificador local e anônimo do agente (será o usuário autenticado
 *  quando existir autenticação no servidor — etapa 4). */
function idAgente() {
  try {
    let id = localStorage.getItem(CHAVE_DISPOSITIVO + ':agente');
    if (!id) {
      id = 'agente_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(CHAVE_DISPOSITIVO + ':agente', id);
    }
    return id;
  } catch {
    return 'agente_' + Math.random().toString(36).slice(2, 10);
  }
}

function formatarMetros(m) {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toFixed(2).replace('.', ',') + ' km';
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Cria a interface de coleta de campo.
 * @param {object} app  o objeto `window.__app` (mapa, estado e ganchos)
 */
export function criarInterfaceColeta(app) {
  const ol = window.ol;
  const $ = (sel) => document.querySelector(sel);

  const els = {
    bloco: $('#bloco-campo'),
    rotaDica: $('#campo-rota-dica'),
    salvarRota: $('#campo-salvar-rota'),
    rotas: $('#campo-rotas'),
    estado: $('#campo-estado'),
    iniciar: $('#campo-iniciar'),
    pausar: $('#campo-pausar'),
    retomar: $('#campo-retomar'),
    encerrar: $('#campo-encerrar'),
    pontos: $('#campo-pontos'),
    distancia: $('#campo-distancia'),
    estimados: $('#campo-estimados'),
    descartados: $('#campo-descartados'),
    aviso: $('#campo-aviso'),
    capturar: $('#campo-capturar'),
    form: $('#campo-form'),
    lat: $('#campo-lat'),
    lon: $('#campo-lon'),
    plus: $('#campo-plus'),
    precisao: $('#campo-precisao'),
    classificacao: $('#campo-classificacao'),
    duplicado: $('#campo-duplicado'),
    cancelar: $('#campo-cancelar'),
   zinresidencias: $('#campo-residencias'),
    pendentes: $('#campo-pendentes'),
    conexao: $('#campo-conexao'),
    conexaoResumo: $('#campo-conexao-resumo'),
    modos: $('#campo-modos'),
    bannerSim: $('#campo-banner-sim'),
    sim: $('#campo-sim'),
    simPausar: $('#campo-sim-pausar'),
    simReiniciar: $('#campo-sim-reiniciar'),
    simVoltar: $('#campo-sim-voltar'),
    simAvancar: $('#campo-sim-avancar'),
    simVelocidade: $('#campo-sim-velocidade'),
    simEstado: $('#campo-sim-estado'),
    marcarResidencia: $('#campo-marcar-residencia'),
  };

  /* ─────────────── Camadas do mapa ─────────────── */

  const geojson = new ol.format.GeoJSON({
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:3857',
  });

  // trajeto REALMENTE percorrido (a coleta) — visualmente distinto da rota
  const trilhaSource = new ol.source.Vector({ features: [] });
  const trilhaLayer = new ol.layer.Vector({
    source: trilhaSource,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: '#0b6e63',
        width: 4,
        lineCap: 'round',
        lineJoin: 'round',
      }),
    }),
  });

  // posição atual (real ou simulada) — o agente vê onde está e onde vai
  // marcar a residência
  const posicaoSource = new ol.source.Vector({ features: [] });
  const posicaoLayer = new ol.layer.Vector({
    source: posicaoSource,
    style: new ol.style.Style({
      image: new ol.style.Circle({
        radius: 7,
        fill: new ol.style.Fill({ color: '#0b6e63' }),
        stroke: new ol.style.Stroke({ color: '#fff', width: 2.5 }),
      }),
    }),
  });

  // rota PLANEJADA salva no dispositivo (recuperada do armazenamento local)
  const planoSource = new ol.source.Vector({ features: [] });
  const planoLayer = new ol.layer.Vector({
    source: planoSource,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: '#7c3aed',
        width: 3,
        lineCap: 'round',
        lineJoin: 'round',
        lineDash: [10, 6],
      }),
    }),
  });

  app.map.addLayer(planoLayer);
  app.map.addLayer(trilhaLayer);
  app.map.addLayer(posicaoLayer);

  /* ─────────────── Armazenamento local ─────────────── */

  let armazenamento = null;
  let revisaoAbertura = 0;
  let persistenciaReal = true;
  let coleta = null;
  let sessaoRecuperada = null;
  let simulador = null; // modo de teste (posição fictícia)
  let planoSimulacaoAtual = null; // geometria usada pelo simulador
  let velocidadeSim = 1;
  let distanciaRetomada = 0;
  let modoColetaAtual = FONTE.GPS;

  async function abrirArmazenamento() {
    try {
      const adaptador = criarAdaptadorIndexedDB();
      const repo = criarArmazenamento({ adaptador });
      await repo.abrir();
      return { repo, real: true };
    } catch (e) {
      // modo privado / IndexedDB indisponível → memória (a sessão atual
      // funciona, mas não sobrevive ao recarregamento)
      const repo = criarArmazenamento({ adaptador: criarAdaptadorMemoria() });
      await repo.abrir();
      console.warn('Armazenamento local indisponível:', e.message);
      return { repo, real: false };
    }
  }

  /* ─────────────── Modo de teste (simulação) ─────────────── */

  /** 'gps' (real) ou 'simulacao' (modo de teste). */
  function modoColeta() {
    const marcado = document.querySelector('input[name="campomodo"]:checked');
    return marcado && marcado.value === 'simulacao' ? FONTE.SIMULACAO : FONTE.GPS;
  }

  /** Mostra/esconde o aviso de modo de teste e os controles. */
  function atualizarModoColeta() {
    modoColetaAtual = modoColeta();
    const simulando = modoColetaAtual === FONTE.SIMULACAO;
    if (els.bannerSim) els.bannerSim.hidden = !simulando;
    if (els.sim) els.sim.hidden = !simulando;
  }

  function atualizarSimulador() {
    if (!els.simEstado) return;
    if (!simulador) {
      els.simEstado.textContent = '—';
      return;
    }
    els.simEstado.textContent =
      'distância percorrida: ' +
      formatarMetros(simulador.distancia) +
      ' · velocidade: ' +
      simulador.multiplicador +
      'x' +
      (simulador.sinal ? '' : ' · SEM SINAL (cenário)');
  }

  /* ─────────────── Avisos ─────────────── */

  function mostrarAviso(texto, nivel = 'info') {
    if (!els.aviso) return;
    els.aviso.textContent = texto;
    els.aviso.hidden = !texto;
    els.aviso.className = 'campo__aviso campo__aviso--' + nivel;
  }

  function status(texto, tipo = 'idle') {
    if (typeof app.setStatus === 'function') app.setStatus(texto, tipo);
  }

  /* ─────────────── Desenho ─────────────── */

  function desenharTrilha(pontos) {
    trilhaSource.clear();
    const coords = pontos
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .map((p) => [p.longitude, p.latitude]);
    if (coords.length < 2) return;
    trilhaSource.addFeature(
      geojson.readFeature(
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        { featureProjection: 'EPSG:3857' },
      ),
    );
  }

  /** Desenha (ou apaga) o marcador da posição atual. */
  function desenharPosicaoAtual(posicao) {
    posicaoSource.clear();
    if (!posicao) return;
    posicaoSource.addFeature(
      geojson.readFeature(
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [posicao.longitude, posicao.latitude] },
        },
        { featureProjection: 'EPSG:3857' },
      ),
    );
  }

  function desenharPlanoSalvo(rota) {
    planoSource.clear();
    const coords = Array.isArray(rota?.geometry) ? rota.geometry : [];
    if (coords.length < 2) return;
    planoSource.addFeature(
      geojson.readFeature(
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        { featureProjection: 'EPSG:3857' },
      ),
    );
  }

  /* ─────────────── Lista de rotas salvas ─────────────── */

  async function renderizarRotas() {
    if (!armazenamento) return;
    const rotas = await armazenamento.listarRotas();
    if (!els.rotas) return;
    if (!rotas.length) {
      els.rotas.innerHTML = '';
      return;
    }
    els.rotas.innerHTML = rotas
      .slice()
      .reverse()
      .map((r) => {
        const seq = (r.sequenciaCompleta || []).join(' → ') || '—';
        const quando = (r.criadoEm || '').replace('T', ' ').slice(0, 16);
        return (
          '<li class="campo__item" data-rota="' +
          escapeHtml(r.id) +
          '">' +
          '<span class="campo__item-titulo">' +
          escapeHtml(seq) +
          '</span>' +
          '<span class="campo__item-sub">' +
          escapeHtml(formatarMetros(r.distance)) +
          ' · ' +
          escapeHtml(rotuloModo(r.modo)) +
          (r.circular ? ' · circuito' : '') +
          ' · ' +
          escapeHtml(quando) +
          '</span>' +
          '<span class="campo__item-acoes">' +
          '<button type="button" class="mini" data-acao="abrir" data-rota="' +
          escapeHtml(r.id) +
          '">Abrir</button>' +
          '<button type="button" class="mini" data-acao="excluir" data-rota="' +
          escapeHtml(r.id) +
          '">Excluir</button>' +
          '</span>' +
          '</li>'
        );
      })
      .join('');
  }

  /* ─────────────── Lista de localizações ─────────────── */

  async function renderizarResidencias() {
    if (!armazenamento || !els.zinresidencias) return;
    const lista = await armazenamento.listarResidencias();
    if (!lista.length) {
      els.zinresidencias.innerHTML = '';
      return;
    }
    els.zinresidencias.innerHTML = lista
      .slice()
      .reverse()
      .map((r) => {
        const quando = (r.criadoEm || '').replace('T', ' ').slice(0, 16);
        const precisao = Number.isFinite(r.precisao) ? ' · ±' + Math.round(r.precisao) + ' m' : '';
        return (
          '<li class="campo__item">' +
          '<span class="campo__item-titulo">' +
          escapeHtml(r.enderecoDigital || '(sem Plus Code)') +
          '</span>' +
          '<span class="campo__item-sub">' +
          escapeHtml(
            (r.latitude ?? '').toString().slice(0, 10) +
              ', ' +
              (r.longitude ?? '').toString().slice(0, 11),
          ) +
          escapeHtml(precisao) +
          ' · ' +
          escapeHtml(r.classificacao || 'nova') +
          (r.fonte === 'simulacao' ? ' · SIMULADO' : '') +
          ' · ' +
          escapeHtml(quando) +
          '</span>' +
          '</li>'
        );
      })
      .join('');
  }

  /* ─────────────── Pendências e conexão ─────────────── */

  async function renderizarPendentes() {
    if (!armazenamento || !els.pendentes) return;
    const st = await armazenamento.estatisticas();
    if (els.conexaoResumo) {
      els.conexaoResumo.textContent = st.pendentes
        ? st.pendentes + ' pendente(s)'
        : 'nada pendente';
    }
    els.pendentes.textContent =
      st.rotas +
      ' rota(s), ' +
      st.sessoes +
      ' sessão(ões), ' +
      st.pontos +
      ' ponto(s) e ' +
      st.residencias +
      ' localização(ões) no dispositivo — ' +
      st.pendentes +
      ' registro(s) aguardando sincronização.';
  }

  function renderizarConexao() {
    if (!els.conexao) return;
    const online = navigator.onLine !== false;
    els.conexao.textContent = online
      ? 'Há conexão com o servidor (a sincronização automática entra na etapa 4).'
      : 'Sem conexão: os dados continuam sendo gravados no aparelho.';
    els.conexao.className = 'campo__dica' + (online ? '' : ' campo__dica--offline');
  }

  /* ─────────────── Estado da coleta ─────────────── */

  function renderizarEstadoColeta() {
    const e = coleta ? coleta.estado : null;
    const estado = e ? e.estado : ESTADO_COLETA.INATIVA;
    const ativa = estado === ESTADO_COLETA.ATIVA;
    const pausada = estado === ESTADO_COLETA.PAUSADA;

    // Fonte de uma sessão é imutável, inclusive enquanto está pausada.
    if (els.modos) {
      els.modos.querySelectorAll('input[name="campomodo"]').forEach((radio) => {
        radio.disabled = ativa || pausada;
        if (ativa || pausada) radio.checked = radio.value === e.fonte;
      });
    }
    if (ativa || pausada) atualizarModoColeta();
    if (els.iniciar) els.iniciar.hidden = ativa || pausada;
    if (els.pausar) els.pausar.hidden = !ativa;
    if (els.retomar) els.retomar.hidden = !pausada;
    if (els.encerrar) els.encerrar.hidden = !(ativa || pausada);

    if (els.estado) {
      els.estado.textContent =
        estado === ESTADO_COLETA.ATIVA
          ? 'Coleta em andamento.'
          : estado === ESTADO_COLETA.PAUSADA
            ? 'Coleta pausada.'
            : estado === ESTADO_COLETA.ENCERRADA
              ? 'Última coleta encerrada.'
              : 'Nenhuma coleta em andamento.';
    }
    if (els.marcarResidencia) {
      const emAndamento = ativa || pausada;
      els.marcarResidencia.hidden = !emAndamento;
      els.marcarResidencia.disabled = emAndamento && !(e && e.ultimaPosicao);
    }
    if (els.pontos) els.pontos.textContent = e ? String(e.pontos) : '0';
    if (els.distancia) els.distancia.textContent = e ? formatarMetros(e.distancia) : '0 m';
    if (els.estimados) els.estimados.textContent = e ? String(e.estimados) : '0';
    if (els.descartados) els.descartados.textContent = e ? String(e.descartados) : '0';
  }

  /* ─────────────── Ações ─────────────── */

  async function salvarRota() {
    const rota = app.rotaAtual;
    if (!rota || !rota.ok) {
      mostrarAviso('Calcule uma rota antes de salvá-la.', 'alerta');
      return;
    }
    const registro = await persistirPlanoAtivo(armazenamento, rota, rota.pontos || app.state.lista.pontos, {
      agenteId: idAgente(), dispositivoId: idDispositivo(),
    });
    mostrarAviso('Rota salva no dispositivo (' + registro.id + ').', 'ok');
    status('Rota planejada salva no dispositivo.', 'ok');
    await renderizarRotas();
    await renderizarPendentes();
  }

  async function abrirRota(id) {
    const revisao = ++revisaoAbertura;
    const assinatura = assinaturaPlanejador(app.state);
    const ativa = app.rotaAtual;
    const rota = await armazenamento.obterRota(id);
    if (!rota || revisao !== revisaoAbertura) return;
    if (assinaturaPlanejador(app.state) !== assinatura || app.rotaAtual !== ativa) {
      mostrarAviso('O planejamento mudou enquanto a rota era carregada. Abra novamente para confirmar a substituição.', 'alerta');
      return;
    }
    const planoAtivo = app.abrirPlanoSalvo(rota);
    if (planoAtivo === null) {
      planoSource.clear();
      mostrarAviso('Pontos recuperados de um plano antigo. Calcule o circuito para incluir o retorno a A.', 'info');
      return;
    }
    desenharPlanoSalvo(rota);
    // enquadra a rota recuperada (a geometria salva está em EPSG:4326)
    const feats = planoSource.getFeatures();
    if (feats.length) {
      app.map.getView().fit(feats[0].getGeometry().getExtent(), {
        padding: [70, 70, 70, 70],
        duration: 600,
        maxZoom: 17,
      });
    }
    status('Rota planejada recuperada do dispositivo.', 'ok');
    mostrarAviso('Rota aberta. A geometria tracejada é a rota salva.', 'ok');
  }

  async function excluirRota(id) {
    const r = await armazenamento.removerRota(id);
    if (!r.ok) {
      mostrarAviso(r.message || 'Não foi possível excluir a rota.', 'alerta');
      return;
    }
    await renderizarRotas();
    await renderizarPendentes();
  }

  async function iniciarColeta() {
    const fonte = modoColeta();
    const rota = app.rotaAtual;
    if (app.state.rotaAtual && !rota) {
      mostrarAviso('O planejamento foi alterado. Calcule ou abra a rota novamente antes de iniciar a coleta.', 'alerta');
      return;
    }
    if (fonte === FONTE.SIMULACAO) {
      // o simulador percorre a geometria da rota: sem rota não há plano
      planoSimulacaoAtual = rota?.ok ? planoDeNavegacao(rota) : null;
      if (!planoSimulacaoAtual) {
        mostrarAviso(
          'A simulação precisa de uma rota: calcule a rota (ou recupere uma rota salva) ' +
            'antes de iniciar a coleta em modo de teste.',
          'alerta',
        );
        return;
      }
    }
    const assinatura = assinaturaPlanejador(app.state);
    let plano = null;
    if (rota?.ok) {
      // Persiste exatamente o plano ativo, nunca o último item da listagem.
      const registro = await persistirPlanoAtivo(armazenamento, rota, rota.pontos || app.state.lista.pontos, {
        agenteId: idAgente(), dispositivoId: idDispositivo(),
      });
      if (app.rotaAtual !== rota || assinaturaPlanejador(app.state) !== assinatura) {
        mostrarAviso('O planejamento mudou durante a gravação. Inicie a coleta novamente.', 'alerta');
        return;
      }
      plano = { id: registro.id, versao: registro.versao, modo: registro.modo,
        circular: registro.circular, sequencia: registro.sequenciaCompleta };
    }
    const r = await coleta.iniciar({ rota: plano, fonte });
    if (!r.ok) {
      mostrarAviso(r.message || 'Não foi possível iniciar a coleta.', 'alerta');
      return;
    }
    if (fonte === FONTE.SIMULACAO) {
      mostrarAviso(
        'Coleta iniciada em MODO DE TESTE: as posições são SIMULADAS sobre a rota.',
        'alerta',
      );
      status('Coleta de campo em MODO DE TESTE (posição simulada).', 'busy');
    } else {
      mostrarAviso('Coleta iniciada. O trajeto está sendo gravado no aparelho.', 'ok');
      status('Coleta de campo iniciada.', 'ok');
    }
    atualizarSimulador();
  }

  async function retomarColeta() {
    if (coleta.estado.fonte === FONTE.SIMULACAO && !simulador) {
      const preparo = await prepararRetomadaSimulada(armazenamento, coleta.estado);
      if (!preparo.ok) {
        mostrarAviso(preparo.message, 'alerta');
        return;
      }
      planoSimulacaoAtual = preparo.plano;
      distanciaRetomada = preparo.distancia;
    }
    await coleta.retomar();
    renderizarEstadoColeta();
  }

  // Falhas de escrita ficam visíveis e podem ser tentadas de novo sem
  // esvaziar o lote nem encerrar uma sessão ainda não persistida.
  let acaoEmAndamento = false;
  async function executarAcao(acao) {
    if (acaoEmAndamento) {
      mostrarAviso('Aguarde a operação em andamento antes de iniciar outra.', 'info');
      return;
    }
    acaoEmAndamento = true;
    try { await acao(); }
    catch (erro) {
      mostrarAviso('Não foi possível concluir: ' + erro.message + '. Os dados pendentes permanecem em memória; tente novamente antes de fechar o aplicativo.', 'alerta');
      renderizarEstadoColeta();
    } finally { acaoEmAndamento = false; }
  }

  async function encerrarColeta() {
    const r = await coleta.encerrar();
    if (!r.ok) {
      mostrarAviso('Não há coleta em andamento.', 'alerta');
      return;
    }
    const pontos = await armazenamento.listarPontos(r.sessaoId || coleta.estado.sessaoId);
    desenharTrilha(pontos);
    mostrarAviso(
      'Coleta encerrada: ' + r.pontos + ' ponto(s), ' + formatarMetros(r.distancia) + '.',
      'ok',
    );
    status('Coleta encerrada.', 'ok');
    await renderizarPendentes();
  }

  /**
   * Marca a posição atual como a **residência** que o agente está
   * visiting. A localização é gravada no aparelho, ligada à sessão de
   * coleta, com coordenadas, precisão e Plus Code.
   */
  async function marcarResidencia() {
    const r = await coleta.marcarResidencia({ classificacao: CLASSIFICACAO.NOVA });
    if (!r.ok) {
      mostrarAviso(r.message || 'Não foi possível marcar a residência.', 'alerta');
      return;
    }
    const p = r.ponto;
    mostrarAviso(
      'Residência marcada: ' +
        (p.enderecoDigital || '(sem Plus Code)') +
        ' · ' +
        p.latitude.toFixed(6) +
        ', ' +
        p.longitude.toFixed(6) +
        (Number.isFinite(p.precisao) ? ' · ±' + Math.round(p.precisao) + ' m' : '') +
        ' (' +
        r.localizacao.id +
        ')',
      'ok',
    );
    status('Residência registrada no dispositivo.', 'ok');
    await renderizarResidencias();
    await renderizarPendentes();
  }

  async function capturarLocalizacao() {
    mostrarAviso('Obtendo a posição do aparelho…', 'info');
    const r = await capturarPosicao({});
    if (!r.ok) {
      mostrarAviso(r.message || 'Não foi possível obter a posição.', 'alerta');
      return;
    }
    const local = montarLocalizacaoResidencia({
      posicao: r.posicao,
      classificacao: CLASSIFICACAO.NOVA,
      agenteId: idAgente(),
      dispositivoId: idDispositivo(),
    });
    if (!local.ok) {
      mostrarAviso(local.message, 'alerta');
      return;
    }
    els.lat.value = String(local.localizacao.latitude);
    els.lon.value = String(local.localizacao.longitude);
    els.plus.value = local.localizacao.enderecoDigital || '';
    els.precisao.value = Number.isFinite(local.localizacao.precisao)
      ? String(Math.round(local.localizacao.precisao))
      : '';
    els.classificacao.value = CLASSIFICACAO.NOVA;

    // possível duplicidade (comparação local, nada sai do aparelho)
    const existentes = await armazenamento.listarResidencias();
    const dup = detectarDuplicado(existentes, local.localizacao, 30);
    if (dup) {
      els.duplicado.hidden = false;
      els.duplicado.textContent =
        'Atenção: já existe uma localização a ' +
        Math.round(dup.distancia) +
        ' m (' +
        (dup.enderecoDigital || dup.id) +
        '). Confirme se é a mesma residência antes de salvar.';
    } else {
      els.duplicado.hidden = true;
      els.duplicado.textContent = '';
    }
    els.form.hidden = false;
    els.form.dataset.origem = JSON.stringify(local.localizacao);
    mostrarAviso('Posição capturada. Confira e salve.', 'ok');
  }

  async function salvarLocalizacao(event) {
    event.preventDefault();
    const lat = Number(String(els.lat.value).replace(',', '.'));
    const lon = Number(String(els.lon.value).replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      mostrarAviso('Latitude e longitude precisam ser números válidos.', 'alerta');
      return;
    }
    let origem = {};
    try {
      origem = JSON.parse(els.form.dataset.origem || '{}');
    } catch {
      origem = {};
    }
    const precisao = Number(String(els.precisao.value).replace(',', '.'));
    const registro = await armazenamento.salvarResidencia({
      latitude: lat,
      longitude: lon,
      precisao: Number.isFinite(precisao) ? precisao : null,
      enderecoDigital: els.plus.value || origem.enderecoDigital || null,
      classificacao: els.classificacao.value || CLASSIFICACAO.NOVA,
      sessaoId: coleta && coleta.estado.sessaoId ? coleta.estado.sessaoId : null,
      agenteId: idAgente(),
      dispositivoId: idDispositivo(),
    });
    els.form.hidden = true;
    els.duplicado.hidden = true;
    mostrarAviso('Localização salva no dispositivo (' + registro.id + ').', 'ok');
    await renderizarResidencias();
    await renderizarPendentes();
  }

  /* ─────────────── Recuperação ─────────────── */

  async function recuperarAoAbrir() {
    await renderizarRotas();
    await renderizarResidencias();
    await renderizarPendentes();
    renderizarConexao();

    // coleta interrompida?
    const abertas = await armazenamento.listarSessoesAbertas();
    if (abertas.length) {
      sessaoRecuperada = abertas[abertas.length - 1];
      // o controlador passa a "adotar" a sessão: os pontos já gravados
      // permanecem e "Retomar" continua exatamente a mesma coleta
      await coleta.adota(sessaoRecuperada.id);
      modoColetaAtual = coleta.estado.fonte;
      if (els.modos) els.modos.querySelectorAll('input[name="campomodo"]').forEach((radio) => {
        radio.checked = radio.value === modoColetaAtual;
      });
      atualizarModoColeta();
      renderizarEstadoColeta();
      const pontos = await armazenamento.listarPontos(sessaoRecuperada.id);
      desenharTrilha(pontos);
      if (els.estado) {
        els.estado.textContent =
          'Coleta interrompida recuperada (' +
          pontos.length +
          ' ponto(s) gravados). Use "Retomar" para continuar.';
      }
      mostrarAviso(
        'Encontramos uma coleta interrompida com ' +
          pontos.length +
          ' ponto(s) gravados no aparelho.',
        'alerta',
      );
      if (els.retomar) els.retomar.hidden = false;
      if (els.iniciar) els.iniciar.hidden = true;
      if (els.encerrar) els.encerrar.hidden = false;
    }
  }

  /* ─────────────── Eventos ─────────────── */

  if (els.salvarRota) els.salvarRota.addEventListener('click', () => void executarAcao(salvarRota));

  if (els.rotas) {
    els.rotas.addEventListener('click', (ev) => {
      const botao = ev.target.closest('button[data-acao]');
      if (!botao) return;
      const id = botao.getAttribute('data-rota');
      if (botao.getAttribute('data-acao') === 'abrir') void executarAcao(() => abrirRota(id));
      else void executarAcao(() => excluirRota(id));
    });
  }

  if (els.iniciar) els.iniciar.addEventListener('click', () => void executarAcao(iniciarColeta));
  if (els.marcarResidencia)
    els.marcarResidencia.addEventListener('click', () => void marcarResidencia());

  // troca da fonte da posição (GPS real ⇄ simulação)
  if (els.modos) {
    els.modos.addEventListener('change', () => {
      atualizarModoColeta();
      if (modoColetaAtual === FONTE.SIMULACAO) {
        mostrarAviso(
          'Modo de teste: as posições serão SIMULADAS sobre a geometria da rota, ' +
            'e ficarão marcadas como simuladas — não se misturam com o GPS real.',
          'alerta',
        );
      } else {
        mostrarAviso('Fonte da posição: GPS real.', 'ok');
      }
    });
  }

  // controles do simulador
  if (els.simPausar)
    els.simPausar.addEventListener('click', () => {
      if (!simulador) return;
      if (simulador.rodando) simulador.pausar();
      else simulador.retomar();
      atualizarSimulador();
    });
  if (els.simReiniciar)
    els.simReiniciar.addEventListener('click', () => {
      if (!simulador) return;
      simulador.reiniciar();
      atualizarSimulador();
    });
  if (els.simVoltar)
    els.simVoltar.addEventListener('click', () => {
      if (!simulador) return;
      simulador.retroceder(100);
      atualizarSimulador();
    });
  if (els.simAvancar)
    els.simAvancar.addEventListener('click', () => {
      if (!simulador) return;
      simulador.avancar(100);
      atualizarSimulador();
    });
  if (els.simVelocidade)
    els.simVelocidade.addEventListener('change', () => {
      velocidadeSim = Number(els.simVelocidade.value) || 1;
      if (simulador) {
        simulador.definirVelocidade(velocidadeSim);
        atualizarSimulador();
      }
    });
  if (els.pausar)
    els.pausar.addEventListener('click', () => void executarAcao(() => coleta.pausar().then(renderizarEstadoColeta)));
  if (els.retomar)
    els.retomar.addEventListener('click', () =>
      void executarAcao(retomarColeta),
    );
  if (els.encerrar) els.encerrar.addEventListener('click', () => void executarAcao(encerrarColeta));

  if (els.capturar)
    els.capturar.addEventListener('click', () => void capturarLocalizacao());
  if (els.form) els.form.addEventListener('submit', (e) => void salvarLocalizacao(e));
  if (els.cancelar)
    els.cancelar.addEventListener('click', () => {
      els.form.hidden = true;
      els.duplicado.hidden = true;
    });

  window.addEventListener('online', renderizarConexao);
  window.addEventListener('offline', renderizarConexao);

  /* ─────────────── Abertura ─────────────── */

  const api = {
    /** Abre o armazenamento e restaura o que houver no dispositivo. */
    async abrir() {
      const { repo, real } = await abrirArmazenamento();
      armazenamento = repo;
      persistenciaReal = real;

      coleta = criarColeta({
        armazenamento,
        agenteId: idAgente(),
        dispositivoId: idDispositivo(),
        // a fonte da posição é escolhida aqui: **nunca** se mistura GPS
        // real com simulação — são fontes diferentes, com sinalização
        // própria em cada ponto gravado
        criarFonte: (handlers, contexto) => {
          if (contexto.fonte === FONTE.SIMULACAO) {
            if (!planoSimulacaoAtual) throw new Error('Plano da simulação indisponível');
            simulador = criarSimulador({
              plano: planoSimulacaoAtual,
              velocidadeMultiplicador: velocidadeSim,
              aoAtualizar: handlers.aoAtualizar,
            });
            if (distanciaRetomada) simulador.iniciarEm(distanciaRetomada);
            distanciaRetomada = 0;
            return simulador;
          }
          simulador = null;
          return criarFonteGPS(handlers);
        },
        aoMudar: (e) => {
          renderizarEstadoColeta();
          desenharPosicaoAtual(e.ultimaPosicao || null);
          if (simulador) atualizarSimulador();
          if (e.avisos && e.avisos.length) {
            const ultimo = e.avisos[e.avisos.length - 1];
            mostrarAviso(ultimo.texto, ultimo.nivel === 'alerta' ? 'alerta' : 'info');
          }
        },
        aoPonto: (ponto) => {
          // acrescenta o ponto novo ao trajeto percorrido (sem redesenhar tudo)
          if (ponto) desenharTrilhaAcrescentando(ponto);
        },
      });

      // velocidades do simulador
      if (els.simVelocidade && !els.simVelocidade.options.length) {
        for (const v of VELOCIDADES) {
          const opt = document.createElement('option');
          opt.value = String(v);
          opt.textContent = v + 'x';
          if (v === 1) opt.selected = true;
          els.simVelocidade.appendChild(opt);
        }
      }
      atualizarModoColeta();
      renderizarEstadoColeta();
      await recuperarAoAbrir();

      if (!persistenciaReal) {
        mostrarAviso(
          'O armazenamento local não está disponível neste navegador (modo privado?). ' +
            'Os dados desta sessão funcionarão, mas não sobreviverão ao recarregamento.',
          'alerta',
        );
      }
      return api;
    },

    get armazenamento() {
      return armazenamento;
    },
    get persistenciaReal() {
      return persistenciaReal;
    },
    get coleta() {
      return coleta;
    },
    /** Estado da sessão de coleta em andamento (usado pela automação). */
    get estado() {
      return coleta ? coleta.estado : null;
    },

    /**
     * Chamado pela aplicação quando uma rota é calculada: habilita (ou
     * desabilita) o botão de salvar a rota planejada no dispositivo.
     */
    aoCalcularRota(data) {
      if (!els.salvarRota) return;
      const temRota = !!(data && data.ok);
      els.salvarRota.disabled = !temRota;
      if (els.rotaDica) {
        els.rotaDica.textContent = temRota
          ? 'Rota calculada (' +
            formatarMetros(data.distance) +
            '). Salve no aparelho para recuperá-la depois, mesmo sem rede.'
          : 'Calcule uma rota para poder salvá-la no aparelho.';
      }
    },
  };

  /**
   * Acrescenta um ponto ao trajeto desenhado (sem redesenhar tudo).
   * Atenção: a geometria da camada está em EPSG:3857 (a projeção da view),
   * então a coordenada geographic Precisa ser convertida.
   */
  function desenharTrilhaAcrescentando(ponto) {
    const feats = triviaFeatures();
    if (!feats.length) {
      desenharTrilha([ponto]);
      return;
    }
    const geometria = feats[0].getGeometry();
    const coords = geometria.getCoordinates();
    coords.push(ol.proj.fromLonLat([ponto.longitude, ponto.latitude]));
    geometria.setCoordinates(coords);
  }

  function triviaFeatures() {
    return trilhaSource.getFeatures();
  }

  return api;
}
