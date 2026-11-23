/* ==========================================================================
   Aplicação de roteamento viário de Santo André (a pé)
   --------------------------------------------------------------------------
   Interface em OpenLayers. Todo o cálculo de rota acontece no backend
   (o GeoServer não envia cabeçalhos CORS, portanto o navegador não pode
   consultar o WFS diretamente) — ver README, seção "Arquitetura".

   O script é um módulo ESM porque a gestão da lista de pontos (rótulos A, B,
   C, …, inserção, remoção e reordenação) vive em `core/pontoTrajeto.js`,
   isomórfico e coberto por testes. O navegador importa esse módulo do
   servidor (rota `/core/*.js`); nenhuma regra de negócio fica aqui.
   ========================================================================== */

import {
  adicionarPonto,
  removerPonto,
  atualizarPonto,
  moverPonto,
  moverPontoPara,
  rotularPontos,
  podeCalcular,
  contarParadas,
  sequenciaRotulos,
  TIPOS,
  STATUS,
} from '../core/pontoTrajeto.js';
import { resumoRota } from './resumoRota.js';
import { criarRevisoesEndereco } from './revisoesEndereco.js';
import {
  criarListaCircuito,
  opcoesCalculoCircuito,
  papelPontoCircuito,
  assinaturaPlanejador,
  resolverPontoNoMapa,
} from './planejamentoCircuito.js';
import { coresDosTrechos } from '../core/coresTrechos.js';
import { criarInterfaceNavegacao } from './navegacaoUI.js';
import { exportarRotaGpxWeb } from './exportarGpxWeb.js';
import {
  CAMADA_PADRAO,
  CAMADA_SATELITE,
  CAMADAS_BASE,
  normalizarCamadaBase,
  lerPreferenciaCamadaSync,
  salvarPreferenciaCamadaSync,
  criarMonitorSatelite,
} from './camadaBase.js';
import { criarClienteRede } from './clienteRede.js';
import { criarServicoCampoWeb } from './campoWebService.js';
import { TIPO_OBSERVACAO_CATALOGO } from '../campo/modeloCampo.js';
import {
  CATEGORIAS_OCORRENCIA,
  CLASSIFICACAO_META,
  CLASSIFICACOES,
} from '../ocorrencias/catalogo.js';
import { normalizarPreferencias } from '../ocorrencias/preferencias.js';
import {
  estiloClassificacao,
  formatarDataHoraPtBr,
  formatarDistanciaCurta,
  gerarHtmlOpcoesCategoriasEvitar,
  lerPreferenciasWeb,
  obterDetalhesCategoria,
  obterOuCriarUsuarioIdWeb,
  resumoPreferenciasTexto,
  rotuloStatusOcorrencia,
  rotuloTemporalidade,
  salvarPreferenciasWeb,
  simboloCategoria,
} from './ocorrenciasUI.js';

(function () {
  'use strict';

  // Adaptador Servidor / WebForms-IIS: preserva todas as chamadas fetch('/api/...')
  // transparentemente — usa o backend Node quando disponível ou executa o motor
  // puro (core/) com o snapshot local quando aberto em iframe estático no IIS.
  const clienteRede = criarClienteRede();
  const fetch = (url, init) => clienteRede.fetchApi(url, init);

  const ol = window.ol;
  document.querySelectorAll('[data-layout-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelector('.app').dataset.layout = button.dataset.layoutMode;
      document.querySelectorAll('[data-layout-mode]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item === button));
      });
    });
  });

  /** Aplica alfa a uma cor hexadecimal (usada no destaque da navegação). */
  function corComAlfa(hex, alfa) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + alfa + ')';
  }

  /* ─────────────── Estado ─────────────── */

  const state = {
    picking: null, // id do ponto que está sendo selecionado no mapa
    networkLoaded: false,
    lastRoute: null,
    // última rota calculada (resposta da API) — é o que a navegação
    // ativa usa como plano; null quando não há rota
    rotaAtual: null,
    // planejamento original preservado mesmo após recálculo de desvio na navegação
    rotaPlanejadaOriginal: null,
    // idCliente da execução GPS real ativa ou recém-encerrada para exportação
    idRotaGpsAtual: null,
    // lista de pontos do trajeto (origem, paradas, destino)
    lista: criarListaCircuito(),
    // modo da rota: 'otimizada' (menor rota) | 'usuario' (ordem definida)
    modo: 'usuario',
    // Todos os novos planejamentos são circuitos A → paradas → A.
    circuito: true,
    // id do ponto que está sendo arrastado no painel (reordenação)
    arrastandoId: null,
    // a dica de arraste já foi usada nesta sessão (não volta a aparecer)
    dicaArrasteVista: false,
    // trechos desenhados no mapa (um por trecho da rota): cada um pode ser
    // ocultado pelo usuário — é o que resolve os trechos que passam pelo
    // mesmo caminho e ficam sobrepostos
    trechos: [],
    // camada base ativa: 'osm' (padrão OpenStreetMap) | 'satelite' (Esri World Imagery)
    camadaBase: lerPreferenciaCamadaSync(window.localStorage),
    // ocorrências colaborativas & preferências de trajeto
    usuarioId: obterOuCriarUsuarioIdWeb(window.localStorage),
    preferencias: lerPreferenciasWeb(window.localStorage),
    ocorrencias: [],
    mostrarOcorrenciasMapa: true,
    rotasDisponiveis: [],
    rotaSelecionadaId: null,
    comparacaoAlternativas: null,
    pickingOccurrence: false,
    pickingRouteObs: false,
    ocorrenciaSelecionada: null,
    rascunhoOcorrencia: null,
    rascunhoCampoObs: null,
  };

  const revisoesEndereco = criarRevisoesEndereco();
  window.addEventListener('pagehide', () => revisoesEndereco.limpar());

  const $ = (sel) => document.querySelector(sel);

  const els = {
    points: $('#points'),
    legendReturn: $('#legend-return'),
    legendDest: $('#legend-dest'),
    legendTrechos: $('#legend-trechos'),
    legendTrechosLista: $('#legend-trechos-lista'),
    legendCont: $('#legend-cont'),
    legendRestaurar: $('#legend-restaurar'),
    addStop: $('#add-stop'),
    dragHint: $('#drag-hint'),
    calc: $('#calc'),
    calcOptimized: $('#calc-optimized'),
    clear: $('#clear'),
    resultBlock: $('#result-block'),
    distanceValue: $('#distance-value'),
    distanceUnit: $('#distance-unit'),
    routeNote: $('#route-note'),
    legs: $('#legs'),
    streets: $('#streets'),
    streetsCount: $('#streets-count'),
    status: $('#status'),
    pickBanner: $('#pick-banner'),
    pickLabel: $('#pick-label'),
    pickCancel: $('#pick-cancel'),
    map: $('#map'),
    basemapSwitch: $('#basemap-switch'),
    basemapNotice: $('#basemap-notice'),
    basemapNoticeText: $('#basemap-notice-text'),
    basemapFallbackBtn: $('#basemap-fallback-btn'),
    startNav: $('#start-nav'),
    exportGpx: $('#export-gpx'),
    exportGpxFeedback: $('#export-gpx-feedback'),
    prefsSummaryText: $('#prefs-summary-text'),
    prefsEvitarList: $('#prefs-evitar-list'),
    btnNovaOcorrencia: $('#btn-nova-ocorrencia'),
    occMapToggle: $('#occ-map-toggle'),
    occMapAdd: $('#occ-map-add'),
    occCount: $('#occ-count'),
    legendAlt: $('#legend-alt'),
    routeAlternatives: $('#route-alternatives'),
    routeOccurrences: $('#route-occurrences'),
    occModal: $('#occ-modal'),
    occModalFechar: $('#occ-modal-fechar'),
    occModalCancelar: $('#occ-modal-cancelar'),
    occForm: $('#occ-form'),
    occSegVia: $('#occ-seg-via'),
    occSegMeta: $('#occ-seg-meta'),
    occSegSelectWrap: $('#occ-seg-select-wrap'),
    occSegSelect: $('#occ-seg-select'),
    occCats: $('#occ-cats'),
    occClassifs: $('#occ-classifs'),
    occDesc: $('#occ-desc'),
    occFormErro: $('#occ-form-erro'),
    occModalSalvar: $('#occ-modal-salvar'),
    occDetailModal: $('#occ-detail-modal'),
    occDetailFechar: $('#occ-detail-fechar'),
    occDetailClassif: $('#occ-detail-classif'),
    occDetailTitulo: $('#occ-detail-titulo'),
    occDetailVia: $('#occ-detail-via'),
    occDetailDesc: $('#occ-detail-desc'),
    occDetailStats: $('#occ-detail-stats'),
    occDetailMsg: $('#occ-detail-msg'),
    occActConfirmar: $('#occ-act-confirmar'),
    occActResolver: $('#occ-act-resolver'),
    occActContestar: $('#occ-act-contestar'),
    campoSyncPill: $('#campo-sync-pill'),
    campoSyncTexto: $('#campo-sync-texto'),
    campoSyncRetry: $('#campo-sync-retry'),
    campoGpsRecovery: $('#campo-gps-recovery'),
    campoGpsRecoveryTxt: $('#campo-gps-recovery-txt'),
    campoGpsFinalizar: $('#campo-gps-finalizar'),
    campoGpsDescartar: $('#campo-gps-descartar'),
    campoRotasBox: $('#campo-rotas-box'),
    campoRotasCount: $('#campo-rotas-count'),
    campoRotasLista: $('#campo-rotas-lista'),
    campoLimparDadosLocais: $('#campo-limpar-dados-locais'),
    saveRouteOffline: $('#save-route-offline'),
    saveRouteOfflineFeedback: $('#save-route-offline-feedback'),
    addRouteObs: $('#add-route-obs'),
    routeCampoObs: $('#route-campo-obs'),
    navAddObs: $('#nav-add-obs'),
    campoObsModal: $('#campo-obs-modal'),
    campoObsModalTitulo: $('#campo-obs-modal-titulo'),
    campoObsFechar: $('#campo-obs-fechar'),
    campoObsForm: $('#campo-obs-form'),
    campoObsRotaLabel: $('#campo-obs-rota-label'),
    campoObsCoordLabel: $('#campo-obs-coord-label'),
    campoObsTipo: $('#campo-obs-tipo'),
    campoObsDesc: $('#campo-obs-desc'),
    campoObsErro: $('#campo-obs-erro'),
    campoObsCancelar: $('#campo-obs-cancelar'),
    campoObsSalvar: $('#campo-obs-salvar'),
    campoConfirmModal: $('#campo-confirm-modal'),
    campoConfirmTitulo: $('#campo-confirm-titulo'),
    campoConfirmFechar: $('#campo-confirm-fechar'),
    campoConfirmMensagem: $('#campo-confirm-mensagem'),
    campoConfirmLista: $('#campo-confirm-lista'),
    campoConfirmAlerta: $('#campo-confirm-alerta'),
    campoConfirmCancelar: $('#campo-confirm-cancelar'),
    campoConfirmOk: $('#campo-confirm-ok'),
  };

  /* ─────────────── Mapa ─────────────── */

  const MAP_VIEW = { center: [-46.4255, -23.7031], zoom: 13 };
  const satDef = CAMADAS_BASE[CAMADA_SATELITE];

  const osmLayer = new ol.layer.Tile({
    // classe aplicada ao container da camada: o CSS aplica um filtro
    // equilibrado ao mapa-base para que a rede viária e a rota ganhem contraste.
    className: 'basemap',
    visible: state.camadaBase === CAMADA_PADRAO,
    zIndex: 0,
    source: new ol.source.OSM({
      maxZoom: 19,
      interpolate: true,
    }),
    opacity: 1,
  });

  const satSource = new ol.source.XYZ({
    url: satDef.url,
    maxZoom: satDef.maxZoom,
    interpolate: satDef.interpolate,
    attributions: satDef.atribuicaoHtml,
    attributionsCollapsible: false,
  });

  const satLayer = new ol.layer.Tile({
    className: 'basemap-satellite',
    visible: state.camadaBase === CAMADA_SATELITE,
    zIndex: 0,
    source: satSource,
    opacity: 1,
  });

  const map = new ol.Map({
    target: els.map,
    layers: [osmLayer, satLayer],
    view: new ol.View({
      center: ol.proj.fromLonLat(MAP_VIEW.center),
      zoom: MAP_VIEW.zoom,
      minZoom: 5,
      maxZoom: 22,
    }),
  });
  new ResizeObserver(() => map.updateSize()).observe(document.querySelector('.map-wrap'));

  function atualizarAvisoSatelite(estadoSat) {
    if (!els.basemapNotice || !els.basemapNoticeText) return;
    const exibir =
      state.camadaBase === CAMADA_SATELITE &&
      (estadoSat.status === 'offline' || estadoSat.status === 'indisponivel') &&
      !!estadoSat.mensagem;
    els.basemapNotice.hidden = !exibir;
    els.basemapNoticeText.textContent = exibir ? estadoSat.mensagem : '';
  }

  const monitorSatelite = criarMonitorSatelite({
    aoMudarEstado: atualizarAvisoSatelite,
  });

  function atualizarBotoesCamadaBase() {
    if (!els.basemapSwitch) return;
    for (const btn of els.basemapSwitch.querySelectorAll('[data-basemap]')) {
      const ativo = btn.dataset.basemap === state.camadaBase;
      btn.setAttribute('aria-pressed', String(ativo));
    }
  }

  function definirCamadaBase(modo, { persistir = true } = {}) {
    const proximo = normalizarCamadaBase(modo);
    state.camadaBase = proximo;
    osmLayer.setVisible(proximo === CAMADA_PADRAO);
    satLayer.setVisible(proximo === CAMADA_SATELITE);
    atualizarBotoesCamadaBase();
    monitorSatelite.definirAtiva(proximo === CAMADA_SATELITE, {
      online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    });
    if (persistir) {
      salvarPreferenciaCamadaSync(proximo, window.localStorage);
    }
    return proximo;
  }

  if (satSource && typeof satSource.on === 'function') {
    satSource.on('tileloadstart', () => {
      monitorSatelite.aoIniciarTile({
        online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
      });
    });
    satSource.on('tileloadend', () => {
      monitorSatelite.aoCarregarTile();
    });
    satSource.on('tileloaderror', () => {
      monitorSatelite.aoErroTile({
        online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
      });
    });
  }

  window.addEventListener('offline', () => {
    monitorSatelite.aoMudarConexao(false);
  });
  window.addEventListener('online', () => {
    monitorSatelite.aoMudarConexao(true);
    if (state.camadaBase === CAMADA_SATELITE && typeof satSource.refresh === 'function') {
      satSource.refresh();
    }
  });

  if (els.basemapSwitch) {
    els.basemapSwitch.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-basemap]');
      if (!btn) return;
      const selecionado = definirCamadaBase(btn.dataset.basemap, { persistir: true });
      const info = CAMADAS_BASE[selecionado];
      setStatus(`Mapa de fundo alterado para ${info.rotulo} (${info.provedor}).`, 'idle');
    });
  }

  if (els.basemapFallbackBtn) {
    els.basemapFallbackBtn.addEventListener('click', () => {
      definirCamadaBase(CAMADA_PADRAO, { persistir: true });
      setStatus('Mapa padrão (OpenStreetMap) restaurado.', 'idle');
    });
  }

  definirCamadaBase(state.camadaBase, { persistir: false });

  // ── Camada da rede viária ──────────────────────────────────────────────
  //
  // Duas camadas superpostas formam o "traço de rua" (técnica de cartografia
  // urbana): uma CASCA clara e larga por baixo, que separa a rua do mapa-base
  // e cria o halo de legibilidade, e o NÚCLEO escuro e fino por cima, que dá
  // a cor da via.
  const axisSource = new ol.source.Vector({ features: [] });

  const axisCasingSource = new ol.source.Vector({ features: [] });
  const axisCasingLayer = new ol.layer.Vector({
    source: axisCasingSource,
    zIndex: 10,
    declutter: true,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: 'rgba(255,255,255,0.9)',
        width: 3.6,
        lineCap: 'round',
        lineJoin: 'round',
      }),
    }),
  });

  const axisLayer = new ol.layer.Vector({
    source: axisSource,
    zIndex: 11,
    declutter: true,
    style: (feature) => {
      // eixos não oficializados (COD_LOG = 0) ganham traço tracejado e cor
      // própria, para que se distingam dos logradouros oficiais
      const naoOficial = Number(feature.get('COD_LOG')) === 0;
      return new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: naoOficial ? '#c2620d' : '#4d5f73',
          width: naoOficial ? 1.7 : 1.8,
          lineCap: 'round',
          lineJoin: 'round',
          lineDash: naoOficial ? [4, 3] : undefined,
        }),
      });
    },
  });

  // ── Camada da rota calculada (separada da rede) ───────────────────────
  const routeSource = new ol.source.Vector({ features: [] });
  const routeLayer = new ol.layer.Vector({
    source: routeSource,
    zIndex: 20,
    // Cada trecho da rota é uma feature própria e tem a **sua cor**
    // (`core/coresTrechos.js`): o halo branco e o contorno escuro são
    // iguais para todos — é o núcleo que assume a cor do trecho, o que
    // mantém a legibilidade sobre o mapa-base claro e deixa claro onde
    // cada trecho começa e termina. O trecho de RETORNO à origem (rota
    // circular) é desenhado tracejado, na cor que lhe cabe.
    style: (feature) => {
      // trecho ocultado pelo usuário: não é desenhado (é o que permite
      // ver um trecho que passava por baixo de outro, sem sobreposição)
      if (feature.get('visivel') === 0) return null;
      const cor = feature.get('cor') || '#ffc233';
      const tracejado = feature.get('retorno') ? [12, 7] : undefined;
      // situação do trecho DURANTE a navegação: 'atual' (o trecho que está
      // sendo percorrido) ou 'percorrido' (já passado). A cor do trecho é
      // sempre a mesma — muda apenas o destaque.
      const situacao = feature.get('situacao') || null;
      const largura = situacao === 'atual' ? 4.8 : 3.6;
      const haloLarg = situacao === 'atual' ? 12 : 9;
      const haloCor =
        situacao === 'percorrido' ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.95)';
      const contornoCor =
        situacao === 'atual' ? 'rgba(23,32,48,0.95)' : 'rgba(23,32,48,0.85)';
      const nucleo = situacao === 'percorrido' ? corComAlfa(cor, 0.32) : cor;
      return [
        // halo externo: destaca a rota sobre a rede e sobre o mapa-base
        new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: haloCor,
            width: haloLarg,
            lineCap: 'round',
            lineJoin: 'round',
            lineDash: tracejado,
          }),
        }),
        // contorno escuro
        new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: contornoCor,
            width: largura + 2.8,
            lineCap: 'round',
            lineJoin: 'round',
            lineDash: tracejado,
          }),
        }),
        // núcleo: a cor do trecho
        new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: nucleo,
            width: largura,
            lineCap: 'round',
            lineJoin: 'round',
            lineDash: tracejado,
          }),
        }),
      ];
    },
  });

  // ── Camada de rota alternativa simultânea (esmaecida) ─────────────────
  const altRouteSource = new ol.source.Vector({ features: [] });
  const altRouteLayer = new ol.layer.Vector({
    source: altRouteSource,
    zIndex: 18,
    style: () => [
      new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: 'rgba(255,255,255,0.75)',
          width: 7.5,
          lineCap: 'round',
          lineJoin: 'round',
        }),
      }),
      new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: 'rgba(71,85,105,0.52)',
          width: 4.5,
          lineCap: 'round',
          lineJoin: 'round',
          lineDash: [10, 6],
        }),
      }),
    ],
  });

  // ── Camada de destaque do trecho com ocorrência ────────────────────────
  const occSegmentHighlightSource = new ol.source.Vector({ features: [] });
  const occSegmentHighlightLayer = new ol.layer.Vector({
    source: occSegmentHighlightSource,
    zIndex: 19,
    style: (feature) => {
      const est = estiloClassificacao(feature.get('classificacao'));
      return new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: corComAlfa(est.cor, 0.55),
          width: 8,
          lineCap: 'round',
          lineJoin: 'round',
        }),
      });
    },
  });

  // ── Camada dos marcadores (A, B, C, D…) ────────────────────────────────
  const markerSource = new ol.source.Vector({ features: [] });
  const markerLayer = new ol.layer.Vector({
    source: markerSource,
    zIndex: 25,
    style: (feature) => {
      const kind = feature.get('kind'); // 'origem' | 'parada' | 'destino'
      const rotulo = feature.get('rotulo') || '';
      const color =
        kind === TIPOS.ORIGEM || kind === 'origin'
          ? '#2ea043'
          : kind === TIPOS.DESTINO || kind === 'destino'
            ? '#f85149'
            : '#045127';
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 10,
          fill: new ol.style.Fill({ color }),
          stroke: new ol.style.Stroke({ color: '#fff', width: 2.5 }),
        }),
        text: new ol.style.Text({
          text: rotulo,
          font: 'bold 12px sans-serif',
          fill: new ol.style.Fill({ color: '#fff' }),
          offsetY: 0,
          offsetX: 0,
        }),
      });
    },
  });

  // ── Camada de ocorrências com clusterização nativa (ol.source.Cluster) ─
  const occSource = new ol.source.Vector({ features: [] });
  const occClusterSource = new ol.source.Cluster({
    distance: 38,
    minDistance: 22,
    source: occSource,
  });
  const occClusterLayer = new ol.layer.Vector({
    source: occClusterSource,
    zIndex: 23,
    visible: state.mostrarOcorrenciasMapa,
    style: (clusterFeature) => {
      const members = clusterFeature.get('features') || [];
      if (!members.length) return null;
      if (members.length === 1) {
        const occ = members[0].get('ocorrencia');
        const est = estiloClassificacao(occ?.classificacao);
        const glyph = simboloCategoria(occ?.categoria);
        const styles = [];
        if (occ?.classificacao === CLASSIFICACOES.EVITA) {
          styles.push(
            new ol.style.Style({
              image: new ol.style.Circle({
                radius: 14,
                stroke: new ol.style.Stroke({ color: 'rgba(220,38,38,0.45)', width: 3 }),
              }),
            }),
          );
        }
        styles.push(
          new ol.style.Style({
            image: new ol.style.Circle({
              radius: 10.5,
              fill: new ol.style.Fill({ color: est.cor }),
              stroke: new ol.style.Stroke({ color: '#ffffff', width: 2.2 }),
            }),
            text: new ol.style.Text({
              text: glyph,
              font: 'bold 12px sans-serif',
              fill: new ol.style.Fill({ color: '#ffffff' }),
            }),
          }),
        );
        return styles;
      }

      // Cluster com múltiplas ocorrências: cor reflete a maior severidade no grupo
      let piorClassif = CLASSIFICACOES.INFORMATIVO;
      for (const m of members) {
        const cl = m.get('ocorrencia')?.classificacao;
        if (cl === CLASSIFICACOES.EVITA) {
          piorClassif = CLASSIFICACOES.EVITA;
          break;
        }
        if (cl === CLASSIFICACOES.PENALIZA) piorClassif = CLASSIFICACOES.PENALIZA;
      }
      const est = estiloClassificacao(piorClassif);
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 13.5,
          fill: new ol.style.Fill({ color: est.cor }),
          stroke: new ol.style.Stroke({ color: '#ffffff', width: 2.5 }),
        }),
        text: new ol.style.Text({
          text: String(members.length),
          font: 'bold 12px sans-serif',
          fill: new ol.style.Fill({ color: '#ffffff' }),
        }),
      });
    },
  });

  // ── Camada de trilha GPS real percorrida (nunca substitui a rota calculada) ──
  const gpsTrailSource = new ol.source.Vector({ features: [] });
  const gpsTrailLayer = new ol.layer.Vector({
    source: gpsTrailSource,
    zIndex: 22,
    style: () => [
      new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: 'rgba(255,255,255,0.9)',
          width: 6.5,
          lineCap: 'round',
          lineJoin: 'round',
        }),
      }),
      new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: '#047857',
          width: 3.5,
          lineCap: 'round',
          lineJoin: 'round',
          lineDash: [8, 6],
        }),
      }),
    ],
  });

  // ── Camada de observações vinculadas à rota (SIGA_ROTA_OBSERVACAO) ──
  const routeObsSource = new ol.source.Vector({ features: [] });
  const routeObsLayer = new ol.layer.Vector({
    source: routeObsSource,
    zIndex: 27,
    style: (feature) => {
      const st = feature.get('status');
      const fill = st === 'CONCLUIDA' ? '#15803d' : st === 'REABERTA' ? '#b45309' : '#1d4ed8';
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 8.5,
          fill: new ol.style.Fill({ color: fill }),
          stroke: new ol.style.Stroke({ color: '#ffffff', width: 2.2 }),
        }),
        text: new ol.style.Text({
          text: 'O',
          font: 'bold 10px sans-serif',
          fill: new ol.style.Fill({ color: '#ffffff' }),
        }),
      });
    },
  });

  // a casca fica ABAIXO do núcleo da rede, e ambos abaixo da rota
  map.addLayer(axisCasingLayer);
  map.addLayer(axisLayer);
  map.addLayer(altRouteLayer);
  map.addLayer(occSegmentHighlightLayer);
  map.addLayer(routeLayer);
  map.addLayer(gpsTrailLayer);
  map.addLayer(occClusterLayer);
  map.addLayer(routeObsLayer);
  map.addLayer(markerLayer);

  // ── Arrastar os pontos no mapa ──────────────────────────────────────────
  //
  // A interação Translate pega o marcador sob o cursor e devolve a nova
  // posição. Ao soltar, o ponto recebe as coordenadas do lugar (marcado
  // como "movido no mapa") e a rota é recalculada.
  //
  // Detalhes da API do OpenLayers 10.6 (verificados no navegador):
  //   · sem a opção `features`, o Translate move **apenas o marcador
  //     agarrado** — e, com `layers`, só os marcadores podem ser agarrados
  //     (as ruas da rede nunca são movidas pelo usuário);
  //   · a opção `features` (se fosse usada) exigiria uma `ol.Collection` e
  //     moveria o conjunto inteiro de uma vez;
  //   · o evento `translateend` traz `features` como Collection.
  const translate = new ol.interaction.Translate({
    layers: [markerLayer],
    filter: (feature) => feature.get('rotulo') != null,
    hitTolerance: 8,
  });
  map.addInteraction(translate);

  translate.on('translateend', (evt) => {
    const lista = evt.features && evt.features.getArray ? evt.features.getArray() : evt.features;
    const feature = lista[0];
    if (!feature) return;
    const id = feature.getId() || feature.get('id');
    const coord = feature.getGeometry().getCoordinates();
    const lonLat = ol.proj.toLonLat(coord);
    const ponto = state.lista.pontos.find((p) => p.id === id);
    if (!ponto) return;
    revisoesEndereco.invalidar(id);
    const resolvido = resolverPontoNoMapa(lonLat[1], lonLat[0], { acao: 'movido' });
    atualizarPonto(state.lista, id, {
      latitude: resolvido.latitude,
      longitude: resolvido.longitude,
      enderecoDigital: resolvido.enderecoDigital,
      codigoNormalizado: resolvido.codigoNormalizado,
      codigoCompleto: resolvido.codigoCompleto,
      status: resolvido.status,
      origem: resolvido.origem,
      mensagem: resolvido.mensagem,
    });
    renderizarPontos();
    setStatus(
      resolvido.naRegiao
        ? `Ponto ${ponto.rotulo} movido (${resolvido.enderecoDigital}).`
        : `Ponto ${ponto.rotulo} movido fora do Endereço Digital.`,
      resolvido.naRegiao ? 'busy' : 'err',
    );
    // recalcula automaticamente quando o trajeto está completo
    if (podeCalcular(state.lista).ok) calculate();
  });

  /* ─────────────── Utilidades ─────────────── */

  /**
   * Leitor GeoJSON com reprojecao automatica.
   *
   * A API entrega geometrias em EPSG:4326 (lon/lat), mas a view do OpenLayers
   * trabalha em EPSG:3857 (Web Mercator). Sem a reprojecao, as camadas
   * seriam desenhadas na posicao errada (colapsadas perto de 0,0).
   *
   * `ol.geom.Geometry` e uma classe ABSTRATA em OpenLayers 10: instancia-la
   * lanca "Unimplemented abstract method". O leitor GeoJSON escolhe a classe
   * concreta conforme o tipo, resolve os dois problemas de uma vez.
   */
  const geojson = new ol.format.GeoJSON({
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:3857',
  });

  /** Converte uma feature GeoJSON (lon/lat) em feature OpenLayers projetada. */
  function toOlFeature(featureJson) {
    return geojson.readFeature(featureJson, { featureProjection: 'EPSG:3857' });
  }

  /** true se a extensão é válida (no OpenLayers: contém algum ponto). */
  function isEmpty(extent) {
    return !extent || extent.length !== 4 || !isFinite(extent[0]) || !isFinite(extent[2]);
  }

  function setStatus(text, kind) {
    els.status.textContent = text;
    els.status.className = 'status status--' + (kind || 'idle');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Converte um token numérico em número, aceitando vírgula decimal.
   * Devolve null quando o token não é um número.
   */
  function numeroDe(token) {
    const t = String(token).trim().replace(',', '.');
    if (!/^-?\d*\.?\d+$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Interpreta a entrada do usuário como {lon, lat}.
   * Aceita "lon,lat", "lon lat", "lat,lon" (detectado quando o segundo
   * valor é uma latitude e o primeiro uma longitude) e JSON.
   */
  function parseCoords(raw) {
    if (!raw) return null;
    const text = String(raw).trim();
    if (text.startsWith('{')) {
      try {
        const o = JSON.parse(text);
        const lon = Number(o.lon ?? o.longitude ?? o.lng);
        const lat = Number(o.lat ?? o.latitude);
        return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
      } catch { return null; }
    }

    // Aceita os formatos usuais, inclusive a vírgula decimal brasileira:
    //   "-46,5450 -23,6600"   (vírgula decimal + espaço)
    //   "-46.5450,-23.6600"   (ponto decimal + vírgula separadora)
    //   "-46,5450,-23,6600"   (vírgula decimal nos dois)
    let a = null;
    let b = null;

    // 1) separados por espaço ou ponto-e-vírgula
    const porEspaco = text.split(/[;\s]+/).filter(Boolean);
    if (porEspaco.length === 2) {
      a = numeroDe(porEspaco[0]);
      b = numeroDe(porEspaco[1]);
    }
    // 2) separados por vírgula (ponto decimal)
    if (a === null || b === null) {
      const porVirgula = text.split(/[;,\s]+/).filter(Boolean);
      if (porVirgula.length === 2) {
        a = numeroDe(porVirgula[0]);
        b = numeroDe(porVirgula[1]);
      }
      // 3) vírgula decimal nos dois valores
      if ((a === null || b === null) && porVirgula.length === 4) {
        a = numeroDe(porVirgula[0] + '.' + porVirgula[1]);
        b = numeroDe(porVirgula[2] + '.' + porVirgula[3]);
      }
    }
    if (a === null || b === null) return null;

    // Heurística: se o primeiro valor parece latitude e o segundo longitude,
    // troca a ordem (a latitude de Santo André está entre -23,9 e -23,5).
    if (Math.abs(a) <= 90 && Math.abs(b) > 90) {
      const tmp = a; a = b; b = tmp;
    }
    if (a < -180 || a > 180 || b < -90 || b > 90) return null;
    return { lon: a, lat: b };
  }

  function formatCoord(pt) {
    return pt.lon.toFixed(6) + ', ' + pt.lat.toFixed(6);
  }

  function formatDistance(meters) {
    if (meters < 1000) return { v: Math.round(meters).toLocaleString('pt-BR'), u: 'metros' };
    const km = meters / 1000;
    return { v: km.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), u: 'km' };
  }

  /* ─────────────── Lista de pontos (A, B, C, D…) ─────────────── */

  /** Texto amigável de cada estado de validação do Endereço Digital. */
  const TEXTO_ESTADO = {
    [STATUS.VAZIO]: 'Sem Endereço Digital.',
    [STATUS.MALFORMADO]: 'Endereço Digital malformado.',
    [STATUS.VALIDADO]: 'Código válido — ainda não convertido em coordenadas.',
    [STATUS.CONVERTIDO]: 'Convertido em coordenadas.',
    [STATUS.FORA_DA_AREA]: 'Fora da área atendida pelo protótipo.',
    [STATUS.FALHA]: 'Falha na resolução do endereço.',
    [STATUS.INDISPONIVEL]: 'Serviço de Endereço Digital indisponível.',
    PENDENTE: 'Digitado — clique em “Validar”.',
  };

  /** Classe CSS do estado (cor do aviso). */
  function classeEstado(status) {
    if (status === STATUS.CONVERTIDO) return 'ok';
    if (status === STATUS.VALIDADO || status === 'PENDENTE') return 'idle';
    if (status === STATUS.VAZIO) return 'idle';
    return 'erro';
  }

  /** Cria A, origem e destino fixo do circuito. */
  function inicializarPontos() {
    revisoesEndereco.limpar();
    state.lista = criarListaCircuito();
    state.circuito = true;
    state.modo = 'usuario';
    renderizarPontos();
  }

  /** Desenha a lista de pontos no painel. */
  function renderizarPontos() {
    rotularPontos(state.lista);
    const n = state.lista.pontos.length;

    els.points.innerHTML = state.lista.pontos
      .map((p) => {
        const circuito = state.lista.circuito === true;
        const papel = papelPontoCircuito(p);
        const coord =
          p.latitude != null && p.longitude != null
            ? p.longitude.toFixed(6) + ', ' + p.latitude.toFixed(6)
            : '';
        const remove = p.tipo === TIPOS.PARADA;
        const arrastavel = p.tipo === TIPOS.PARADA;
        return (
          '<div class="point point--' + p.tipo + '" data-id="' + escapeHtml(p.id) + '">' +
          '<div class="point__head">' +
          // a alça é a única parte arrastável: assim o arraste não interfere
          // nos campos de edição nem na interação com o mapa
          '<span class="point__grip' + (arrastavel ? '' : ' point__grip--fixo') + '"' +
          (arrastavel ? ' draggable="true" data-arrastavel="1"' : '') +
          ' role="button" tabindex="' + (arrastavel ? '0' : '-1') + '"' +
          ' aria-label="' +
          (arrastavel
            ? 'Mover a parada ' + escapeHtml(p.rotulo) + ' na ordem do trajeto (arraste ou use as setas e os botões subir e descer)'
            : 'A origem e o destino ficam sempre nas extremidades do trajeto') +
          '"' +
          ' title="' + (arrastavel ? 'Arraste ou use as setas ↑ ↓ para mudar a ordem da rota' : 'Origem e destino ficam sempre nas extremidades') + '"></span>' +
          '<span class="point__badge">' + escapeHtml(p.rotulo) + '</span>' +
          '<span class="point__role">' + escapeHtml(papel) + '</span>' +
          '<span class="point__actions">' +
          '<button type="button" class="mini" data-acao="validar" title="Validar o Endereço Digital e convertê-lo em coordenadas">Validar</button>' +
          '<button type="button" class="mini" data-acao="map" title="Localizar este ponto no mapa" ' +
          (p.latitude != null ? '' : 'disabled') + '>🎯</button>' +
          '<button type="button" class="mini" data-acao="cima" title="Subir na ordem" ' +
          'aria-label="Subir a parada ' + escapeHtml(p.rotulo) + ' na ordem do trajeto" ' +
          (p.tipo === TIPOS.PARADA && p.indice > 1 ? '' : 'disabled') + '>↑</button>' +
          '<button type="button" class="mini" data-acao="baixo" title="Descer na ordem" ' +
          'aria-label="Descer a parada ' + escapeHtml(p.rotulo) + ' na ordem do trajeto" ' +
          (p.tipo === TIPOS.PARADA && p.indice < (circuito ? n - 1 : n - 2) ? '' : 'disabled') + '>↓</button>' +
          (remove ? '<button type="button" class="mini mini--danger" data-acao="remover" title="Remover parada">✕</button>' : '') +
          '</span>' +
          '</div>' +
          '<div class="point__row">' +
          '<input class="point__codigo" type="text" autocomplete="off" spellcheck="false" ' +
          'placeholder="Endereço Digital (ex.: 8FP9+J6)" value="' + escapeHtml(p.enderecoDigital || '') + '" />' +
          '</div>' +
          '<div class="point__estado point__estado--' + classeEstado(p.status) + '">' +
          escapeHtml(p.mensagem || TEXTO_ESTADO[p.status] || '') +
          '</div>' +
          '<div class="point__row">' +
          '<input class="point__coord" type="text" inputmode="decimal" autocomplete="off" ' +
          'placeholder="ou -46,5320 , -23,6635" value="' + escapeHtml(coord) + '" />' +
          '<button type="button" class="pick" data-pick="' + escapeHtml(p.id) + '" title="Selecionar no mapa">🗺</button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    atualizarMarcadores();
    atualizarDicaArraste();
  }

  /**
   * A dica de arraste só faz sentido quando existe algo para reordenar
   * (duas paradas ou mais) e desaparece depois da primeira reordenação.
   */
  function atualizarDicaArraste() {
    if (!els.dragHint) return;
    const paradas = state.lista.pontos.filter((p) => p.tipo === TIPOS.PARADA).length;
    els.dragHint.hidden = state.dicaArrasteVista || paradas < 2;
  }

  /**
   * Atualiza a legenda conforme o tipo de trajeto: no circuito aparece o
   * "retorno à origem" (tracejado) e some o destino.
   */
  /**
   * Atualiza a legenda:
   *   • "Retorno à origem" só aparece no circuito; "Destino" some nele;
   *   • a lista **Trechos da rota** mostra a correspondência entre cada
   *     trecho, a sua origem, o seu destino e a **sua cor** — é montada a
   *     partir dos trechos da rota calculada e refeita a cada recálculo
   *     (inclusive quando a otimização muda a sequência das paradas).
   */
  function atualizarLegenda(legs) {
    if (!els.legendReturn || !els.legendDest) return;
    els.legendReturn.hidden = !state.circuito;
    els.legendDest.hidden = state.circuito;

    if (!els.legendTrechos || !els.legendTrechosLista) return;
    const lista = Array.isArray(legs) ? legs : [];
    els.legendTrechos.hidden = lista.length === 0;
    if (!lista.length) {
      els.legendTrechosLista.innerHTML = '';
      return;
    }
    const cores = coresDosTrechos(lista);
    els.legendTrechosLista.innerHTML = lista
      .map((leg, i) => {
        const cor = leg.cor || cores[i];
        const marca = leg.retorno
          ? ' <span class="legend__retorno">retorno</span>'
          : '';
        // cada linha é um BOTÃO: clicar oculta (ou mostra) o trecho — é o
        // que resolve os trechos que passam pelo mesmo caminho
        return (
          '<button type="button" class="legend__leg" data-leg="' + i + '" ' +
          'aria-pressed="false" ' +
          'title="Ocultar o trecho ' + escapeHtml(leg.de) + ' → ' + escapeHtml(leg.para) + '">' +
          '<span class="swatch swatch--trecho" style="background:' + cor + '"></span>' +
          '<span class="legend__leg-txt">' + escapeHtml(leg.de) + ' → ' +
          escapeHtml(leg.para) + marca + '</span></button>'
        );
      })
      .join('');
    atualizarEstadoTrechos();
  }

  /* ─────────────── Marcadores ─────────────── */

  /** Mapa id do ponto → feature do marcador ( reaproveitada entre desenhos). */
  const marcadoresPorId = new Map();

  function clearMarkers() {
    markerSource.clear();
    marcadoresPorId.clear();
  }

  function addMarker(pt, kind, rotulo, id) {
    const feature = new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat([pt.lon, pt.lat])),
      kind,
      rotulo,
    });
    feature.setId(id);
    markerSource.addFeature(feature);
    marcadoresPorId.set(id, feature);
    return feature;
  }

  /**
   * Redesenha os marcadores a partir da lista de pontos.
   * As features existentes são **reaproveitadas** (posição e rótulo
   * atualizados), para que a interação de arraste continue válida.
   */
  function atualizarMarcadores() {
    const ativos = new Set();
    for (const p of state.lista.pontos) {
      if (p.latitude == null || p.longitude == null) continue;
      ativos.add(p.id);
      const coords = ol.proj.fromLonLat([p.longitude, p.latitude]);
      const existente = marcadoresPorId.get(p.id);
      if (existente) {
        existente.getGeometry().setCoordinates(coords);
        existente.set('kind', p.tipo);
        existente.set('rotulo', p.rotulo);
      } else {
        addMarker({ lon: p.longitude, lat: p.latitude }, p.tipo, p.rotulo, p.id);
      }
    }
    // remove os marcadores de pontos que sumiram (ou ficaram sem coordenada)
    for (const [id, feature] of [...marcadoresPorId.entries()]) {
      if (ativos.has(id)) continue;
      markerSource.removeFeature(feature);
      marcadoresPorId.delete(id);
    }
  }

  /* ─────────────── Seleção no mapa ─────────────── */

  function startPicking(id) {
    stopPickingOccurrence();
    state.picking = id;
    const ponto = state.lista.pontos.find((p) => p.id === id);
    els.pickLabel.textContent = ponto ? ponto.rotulo.toLowerCase() : 'ponto';
    els.pickBanner.hidden = false;
    els.map.classList.add('map--picking');
    document.querySelectorAll('.pick').forEach((b) => {
      b.classList.toggle('active', b.dataset.pick === id);
    });
    setStatus('Clique no mapa para definir o ponto ' + (ponto ? ponto.rotulo : '') + '.', 'busy');
  }

  function stopPicking() {
    state.picking = null;
    if (!state.pickingOccurrence && !state.pickingRouteObs) {
      els.pickBanner.hidden = true;
      els.map.classList.remove('map--picking');
    }
    document.querySelectorAll('.pick').forEach((b) => b.classList.remove('active'));
  }

  function startPickingOccurrence() {
    stopPicking();
    stopPickingRouteObs();
    fecharDetalheOcorrencia();
    state.pickingOccurrence = true;
    els.pickLabel.textContent = 'local da ocorrência na via';
    els.pickBanner.hidden = false;
    els.map.classList.add('map--picking');
    if (els.btnNovaOcorrencia) els.btnNovaOcorrencia.disabled = true;
    setStatus('Clique no trecho da via no mapa para registrar uma ocorrência.', 'busy');
  }

  function stopPickingOccurrence() {
    state.pickingOccurrence = false;
    if (!state.picking && !state.pickingRouteObs) {
      els.pickBanner.hidden = true;
      els.map.classList.remove('map--picking');
    }
    if (els.btnNovaOcorrencia) els.btnNovaOcorrencia.disabled = false;
  }

  function startPickingRouteObs() {
    const rotaAtiva = campoWeb.obterRotaParaObservacao();
    if (!rotaAtiva) {
      setStatus('Calcule ou abra uma rota salva antes de registrar observação.', 'err');
      return;
    }
    stopPicking();
    stopPickingOccurrence();
    state.pickingRouteObs = true;
    els.pickLabel.textContent = 'ponto da observação na rota';
    els.pickBanner.hidden = false;
    els.map.classList.add('map--picking');
    setStatus('Clique no mapa para posicionar a observação vinculada à rota.', 'busy');
  }

  function stopPickingRouteObs() {
    state.pickingRouteObs = false;
    if (!state.picking && !state.pickingOccurrence) {
      els.pickBanner.hidden = true;
      els.map.classList.remove('map--picking');
    }
  }

  els.pickCancel.addEventListener('click', () => {
    stopPicking();
    stopPickingOccurrence();
    stopPickingRouteObs();
  });

  map.on('click', async (evt) => {
    if (state.pickingRouteObs) {
      const lonLat = ol.proj.toLonLat(evt.coordinate);
      stopPickingRouteObs();
      abrirModalCampoObs({ latitude: lonLat[1], longitude: lonLat[0] });
      return;
    }

    if (state.pickingOccurrence) {
      const lonLat = ol.proj.toLonLat(evt.coordinate);
      stopPickingOccurrence();
      await iniciarRegistroOcorrenciaEm(lonLat[1], lonLat[0]);
      return;
    }

    if (!state.picking) return;
    const lonLat = ol.proj.toLonLat(evt.coordinate);
    const pt = { lon: lonLat[0], lat: lonLat[1] };
    const ponto = state.lista.pontos.find((p) => p.id === state.picking);
    let resolvido = null;
    if (ponto) {
      revisoesEndereco.invalidar(ponto.id);
      resolvido = resolverPontoNoMapa(pt.lat, pt.lon, { acao: 'selecionado' });
      atualizarPonto(state.lista, ponto.id, {
        latitude: resolvido.latitude,
        longitude: resolvido.longitude,
        status: resolvido.status,
        origem: resolvido.origem,
        mensagem: resolvido.mensagem,
        enderecoDigital: resolvido.enderecoDigital,
        codigoNormalizado: resolvido.codigoNormalizado,
        codigoCompleto: resolvido.codigoCompleto,
      });
      renderizarPontos();
    }
    stopPicking();
    if (resolvido?.naRegiao) {
      setStatus(
        'Ponto ' + (ponto ? ponto.rotulo : '') + ' definido (' + resolvido.enderecoDigital + ').',
        'ok',
      );
    } else if (resolvido) {
      setStatus(resolvido.mensagem, 'err');
    } else {
      setStatus('Ponto definido. Calcule a rota.', 'idle');
    }
  });

  // so conta como "movido pelo usuario" depois do primeiro enquadramento
  // automatico (o moveend inicial do view nao e interacao do usuario).
  let framed = false;
  map.on('moveend', () => {
    if (framed) state.userMoved = true;
  });

  // Clique em marcador/cluster de ocorrência, rota alternativa ou trecho da rota
  map.on('click', (evt) => {
    if (state.picking || state.pickingOccurrence || state.pickingRouteObs) return;

    // 1. Ocorrências no mapa (cluster expande ao clicar; item único abre detalhes)
    if (state.mostrarOcorrenciasMapa) {
      const clusterFeat = map.forEachFeatureAtPixel(
        evt.pixel,
        (f) => f,
        { layerFilter: (l) => l === occClusterLayer, hitTolerance: 6 },
      );
      if (clusterFeat) {
        const members = clusterFeat.get('features') || [];
        if (members.length > 1) {
          const coords = members.map((m) => m.getGeometry().getCoordinates());
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const [cx, cy] of coords) {
            if (cx < minX) minX = cx;
            if (cy < minY) minY = cy;
            if (cx > maxX) maxX = cx;
            if (cy > maxY) maxY = cy;
          }
          map.getView().fit([minX, minY, maxX, maxY], {
            padding: [80, 80, 80, 80],
            duration: 400,
            maxZoom: 18,
          });
          return;
        }
        if (members.length === 1) {
          const occ = members[0].get('ocorrencia');
          if (occ) {
            abrirDetalheOcorrencia(occ);
            return;
          }
        }
      }
    }

    // 2. Rota alternativa esmaecida: clique direto no mapa alterna a rota ativa
    if (state.rotasDisponiveis.length > 1) {
      const altFeat = map.forEachFeatureAtPixel(
        evt.pixel,
        (f) => f,
        { layerFilter: (l) => l === altRouteLayer, hitTolerance: 6 },
      );
      if (altFeat) {
        const altId = altFeat.get('altRouteId');
        if (altId) {
          selecionarRotaAlternativa(altId);
          return;
        }
      }
    }

    // 3. Clique em um TRECHO da rota principal: oculta/mostra para desambiguar sobreposições
    if (!state.trechos.length) return;
    const feature = map.forEachFeatureAtPixel(
      evt.pixel,
      (f) => f,
      { layerFilter: (l) => l === routeLayer, hitTolerance: 5 },
    );
    if (!feature) return;
    const indice = feature.get('legIndex');
    if (indice == null) return;
    alternarVisibilidadeTrecho(indice);
  });

  map.on('pointermove', (evt) => {
    if (!state.picking && !state.pickingOccurrence && !state.pickingRouteObs) {
      let clicavel = false;
      if (state.mostrarOcorrenciasMapa) {
        clicavel = map.hasFeatureAtPixel(evt.pixel, {
          layerFilter: (l) => l === occClusterLayer,
          hitTolerance: 6,
        });
      }
      if (!clicavel && state.rotasDisponiveis.length > 1) {
        clicavel = map.hasFeatureAtPixel(evt.pixel, {
          layerFilter: (l) => l === altRouteLayer,
          hitTolerance: 6,
        });
      }
      if (!clicavel && state.trechos.length) {
        clicavel = map.hasFeatureAtPixel(evt.pixel, {
          layerFilter: (l) => l === routeLayer,
          hitTolerance: 5,
        });
      }
      map.getTargetElement().style.cursor = clicavel ? 'pointer' : '';
      return;
    }
    const lonLat = ol.proj.toLonLat(evt.coordinate);
    map.getTargetElement().style.cursor = 'crosshair';
    els.status.textContent =
      'Clique em ' + lonLat[0].toFixed(5) + ', ' + lonLat[1].toFixed(5);
  });

  /* ─────────────── Carregamento da rede ─────────────── */

  async function loadNetwork() {
    setStatus('Carregando a rede viária…', 'busy');
    try {
      const res = await fetch('/api/network');
      const ct = res.headers?.get?.('content-type') || '';
      let data;
      if (typeof res.text === 'function' && (!res.ok || (ct && !/json/i.test(ct)))) {
        const bruto = await res.text();
        try {
          data = JSON.parse(bruto);
        } catch {
          const titulo = bruto.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
          throw new Error(
            'A URL ' +
              (res.url || '/api/network') +
              ' respondeu HTTP ' +
              res.status +
              (ct ? ' (' + ct + ')' : '') +
              (titulo ? ' ("' + titulo + '")' : '') +
              ' em vez de JSON.',
          );
        }
      } else {
        data = await res.json();
      }
      if (!res.ok) {
        throw new Error(data?.message || data?.error || ('HTTP ' + res.status));
      }
      const features = (data.features || []).map((f) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: f.properties,
      }));
      const feats = features.map(toOlFeature);
      axisSource.addFeatures(feats);
      axisCasingSource.addFeatures(feats);
      state.networkLoaded = true;
      void campoWeb.salvarCacheRede({ type: 'FeatureCollection', features });

      // Enquadra a rede carregada (a camada cobre apenas parte do
      // municipio; um centro fixo deixaria a maior parte fora da tela).
      if (!state.userMoved) {
        const extent = axisSource.getExtent();
        if (!isEmpty(extent)) {
          map.getView().fit(extent, {
            padding: [40, 40, 40, 40],
            duration: 0,
            maxZoom: 15,
          });
          framed = true;
        }
      }

      const meta = data.meta || {};
      const upd = meta.update || {};
      const originMode = meta.originMode || meta.source;
      const origem = originMode === 'wfs' ? 'GeoServer (WFS)' : 'snapshot de contingência';
      const quando = upd.lastCheckedAt
        ? new Date(upd.lastCheckedAt).toLocaleTimeString('pt-BR')
        : 'pendente';
      const warnings = meta.warnings || [];
      const emFallback = Boolean(meta.fallbackActive || originMode !== 'wfs' || warnings.length);
      loadDiagnostics();
      loadOcorrencias();
      setStatus(
        'Rede pronta (' +
          features.length.toLocaleString('pt-BR') +
          ' eixos, ' +
          origem +
          ', verificada às ' +
          quando +
          ').' +
          (warnings.length ? ' Atenção: ' + warnings[0] : ''),
        emFallback ? 'err' : 'ok',
      );
    } catch (err) {
      try {
        const cache = await campoWeb.carregarCacheRede();
        const cachedFeatures = cache?.featureCollection?.features;
        if (Array.isArray(cachedFeatures) && cachedFeatures.length) {
          axisSource.clear();
          axisCasingSource.clear();
          const feats = cachedFeatures.map(toOlFeature);
          axisSource.addFeatures(feats);
          axisCasingSource.addFeatures(feats);
          state.networkLoaded = true;
          if (!state.userMoved) {
            const extent = axisSource.getExtent();
            if (!isEmpty(extent)) {
              map.getView().fit(extent, {
                padding: [40, 40, 40, 40],
                duration: 0,
                maxZoom: 15,
              });
              framed = true;
            }
          }
          setStatus(
            'Modo offline: rede viária em cache (' +
              cachedFeatures.length.toLocaleString('pt-BR') +
              ' eixos). Rotas salvas e observações continuam disponíveis.',
            'ok',
          );
          return;
        }
      } catch {
        /* fallback ao erro original se o cache local também falhar */
      }
      setStatus('Falha ao carregar a rede: ' + err.message, 'err');
    }
  }

  /**
   * Diagnóstico do grafo.
   *
   * O painel deixou de exibir o bloco "Diagnóstico do grafo" (removido a
   * pedido do usuário), mas a chamada continua sendo feita: o endpoint
   * `/api/diagnostics` é usado pela auditoria e por quem quiser inspecionar
   * a rede pelo console do navegador.
   */
  async function loadDiagnostics() {
    try {
      const res = await fetch('/api/diagnostics');
      if (!res.ok) return;
      const d = await res.json();
      window.__app.diagnostico = d;
    } catch {
      /* diagnóstico é opcional */
    }
  }

  /* ─────────────── Ocorrências colaborativas & preferências ─────────────── */

  function atualizarPreferenciasUI() {
    const p = normalizarPreferencias(state.preferencias);
    state.preferencias = p;
    if (els.prefsSummaryText) {
      els.prefsSummaryText.textContent = resumoPreferenciasTexto(p);
    }
    document.querySelectorAll('input[name="prefmodo"]').forEach((r) => {
      r.checked = r.value === p.modo;
    });
    if (els.prefsEvitarList) {
      els.prefsEvitarList.innerHTML = gerarHtmlOpcoesCategoriasEvitar(p);
    }
  }

  function inicializarPreferenciasUI() {
    atualizarPreferenciasUI();
    document.querySelectorAll('input[name="prefmodo"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        state.preferencias = salvarPreferenciasWeb(
          { ...state.preferencias, modo: radio.value },
          window.localStorage,
        );
        atualizarPreferenciasUI();
        if (podeCalcular(state.lista).ok && state.rotaAtual) {
          calculate(state.modo);
        }
      });
    });
    if (els.prefsEvitarList) {
      els.prefsEvitarList.addEventListener('change', () => {
        const selecionadas = [...els.prefsEvitarList.querySelectorAll('input[type="checkbox"]:checked')]
          .map((c) => c.value);
        state.preferencias = salvarPreferenciasWeb(
          { ...state.preferencias, evitarCategorias: selecionadas },
          window.localStorage,
        );
        if (els.prefsSummaryText) {
          els.prefsSummaryText.textContent = resumoPreferenciasTexto(state.preferencias);
        }
        if (podeCalcular(state.lista).ok && state.rotaAtual) {
          calculate(state.modo);
        }
      });
    }
  }

  function renderizarOcorrenciasMapa() {
    occSource.clear();
    const lista = Array.isArray(state.ocorrencias) ? state.ocorrencias : [];
    if (els.occCount) els.occCount.textContent = String(lista.length);
    for (const occ of lista) {
      const lat = Number(occ?.localizacao?.latitude);
      const lon = Number(occ?.localizacao?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const feat = new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])),
        ocorrencia: occ,
      });
      feat.setId(occ.id);
      occSource.addFeature(feat);
    }
    occClusterLayer.setVisible(state.mostrarOcorrenciasMapa);
  }

  function destacarSegmentosOcorrencias(lista) {
    occSegmentHighlightSource.clear();
    const items = Array.isArray(lista) ? lista : [];
    if (!items.length) return;
    const eixos = axisSource.getFeatures();
    if (!eixos.length) return;

    const vistos = new Set();
    for (const item of items) {
      const occ = item.ocorrencia || item;
      const fid = occ.localizacao?.featureId ?? item.featureId;
      const lat = occ.localizacao?.latitude ?? item.latitude;
      const lon = occ.localizacao?.longitude ?? item.longitude;
      const classif = occ.classificacao || item.classificacao || CLASSIFICACOES.INFORMATIVO;
      if (fid == null) continue;
      const chave = `${fid}:${Math.round((lat || 0) * 1e5)}:${Math.round((lon || 0) * 1e5)}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);

      const cand = eixos.filter((f) => Number(f.get('ID')) === Number(fid));
      if (!cand.length) continue;
      let melhor = cand[0];
      if (cand.length > 1 && lat != null && lon != null) {
        const alvo = ol.proj.fromLonLat([lon, lat]);
        let bestD = Infinity;
        for (const f of cand) {
          const p = f.getGeometry().getClosestPoint(alvo);
          const d = Math.hypot(p[0] - alvo[0], p[1] - alvo[1]);
          if (d < bestD) {
            bestD = d;
            melhor = f;
          }
        }
      }
      const clone = new ol.Feature({
        geometry: melhor.getGeometry().clone(),
        classificacao: classif,
      });
      occSegmentHighlightSource.addFeature(clone);
    }
  }

  async function loadOcorrencias() {
    try {
      const res = await fetch('/api/ocorrencias');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok && Array.isArray(data.ocorrencias)) {
        state.ocorrencias = data.ocorrencias;
        renderizarOcorrenciasMapa();
      }
    } catch {
      /* ocorrências são resilientes caso servidor ainda esteja subindo */
    }
  }

  function renderizarOpcoesModalOcorrencia(catSelecionada, classifSelecionada) {
    if (els.occCats) {
      els.occCats.innerHTML = CATEGORIAS_OCORRENCIA.map((c) => {
        const ativa = c.id === catSelecionada ? ' is-active' : '';
        return (
          '<button type="button" class="occ-cat-btn' + ativa + '" data-cat="' + c.id + '">' +
          escapeHtml(c.rotulo) + '</button>'
        );
      }).join('');
    }
    if (els.occClassifs) {
      els.occClassifs.innerHTML = Object.entries(CLASSIFICACAO_META).map(([key, meta]) => {
        const checked = key === classifSelecionada ? ' checked' : '';
        return (
          '<label class="occ-chip">' +
          '<input type="radio" name="occ_classif" value="' + key + '"' + checked + ' />' +
          '<span><b>' + escapeHtml(meta.rotulo) + '</b><small>' + escapeHtml(meta.resumo) + '</small></span>' +
          '</label>'
        );
      }).join('');
    }
  }

  function atualizarBoxSegmentoModal(principal, candidatos, temRuasProximas) {
    if (!principal) return;
    if (els.occSegVia) {
      els.occSegVia.textContent = principal.logradouro || 'Via identificada';
    }
    if (els.occSegMeta) {
      els.occSegMeta.textContent =
        'Trecho associado a ' + principal.distanciaAoEixoM + ' m do ponto clicado' +
        (temRuasProximas ? ' · há outra rua próxima, confira se é esta via.' : '.');
    }
    if (els.occSegSelectWrap && els.occSegSelect) {
      if (Array.isArray(candidatos) && candidatos.length > 1) {
        els.occSegSelectWrap.hidden = false;
        els.occSegSelect.innerHTML = candidatos.map((c) => {
          const sel = Number(c.featureId) === Number(principal.featureId) ? ' selected' : '';
          return (
            '<option value="' + c.featureId + '"' + sel + '>' +
            escapeHtml(c.logradouro) + ' (' + c.distanciaAoEixoM + ' m)</option>'
          );
        }).join('');
      } else {
        els.occSegSelectWrap.hidden = true;
        els.occSegSelect.innerHTML = '';
      }
    }
  }

  async function iniciarRegistroOcorrenciaEm(lat, lon) {
    setStatus('Identificando o trecho da via…', 'busy');
    try {
      const res = await fetch('/api/ocorrencias/segmento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: lat, longitude: lon }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.principal) {
        setStatus(data?.message || 'Nenhum trecho viário próximo ao ponto clicado.', 'err');
        return;
      }

      const catPadrao = CATEGORIAS_OCORRENCIA[0];
      state.rascunhoOcorrencia = {
        latitude: lat,
        longitude: lon,
        candidatos: data.candidatos || [data.principal],
        principal: data.principal,
        temRuasProximas: !!data.temRuasProximas,
        categoria: catPadrao.id,
        classificacao: catPadrao.classificacaoPadrao,
      };
      atualizarBoxSegmentoModal(data.principal, data.candidatos, data.temRuasProximas);
      renderizarOpcoesModalOcorrencia(catPadrao.id, catPadrao.classificacaoPadrao);
      document.querySelectorAll('input[name="occ_temp"]').forEach((r) => {
        r.checked = r.value === catPadrao.temporalidadePadrao;
      });
      if (els.occDesc) els.occDesc.value = '';
      if (els.occFormErro) {
        els.occFormErro.hidden = true;
        els.occFormErro.textContent = '';
      }
      if (els.occModal) els.occModal.hidden = false;
      destacarSegmentosOcorrencias([
        {
          featureId: data.principal.featureId,
          latitude: data.principal.latitude,
          longitude: data.principal.longitude,
          classificacao: catPadrao.classificacaoPadrao,
        },
      ]);
      setStatus('Trecho identificado: ' + data.principal.logradouro + '.', 'idle');
    } catch (err) {
      setStatus('Falha ao identificar trecho da via: ' + err.message, 'err');
    }
  }

  function fecharModalRegistroOcorrencia() {
    if (els.occModal) els.occModal.hidden = true;
    state.rascunhoOcorrencia = null;
    if (!state.rotaAtual) occSegmentHighlightSource.clear();
  }

  function abrirDetalheOcorrencia(occ) {
    if (!occ || !els.occDetailModal) return;
    state.ocorrenciaSelecionada = occ;
    const cat = obterDetalhesCategoria(occ.categoria);
    const est = estiloClassificacao(occ.classificacao);
    if (els.occDetailClassif) {
      els.occDetailClassif.textContent = est.rotulo;
      els.occDetailClassif.style.background = est.fundo;
      els.occDetailClassif.style.color = est.borda;
      els.occDetailClassif.style.borderColor = est.cor;
    }
    if (els.occDetailTitulo) els.occDetailTitulo.textContent = cat ? cat.rotulo : occ.categoria;
    if (els.occDetailVia) {
      els.occDetailVia.textContent =
        (occ.localizacao?.logradouro || 'Trecho da rede') +
        ' · ' + rotuloTemporalidade(occ.temporalidade) +
        ' · ' + rotuloStatusOcorrencia(occ.status);
    }
    if (els.occDetailDesc) {
      els.occDetailDesc.textContent = occ.descricao || 'Sem descrição adicional.';
    }
    if (els.occDetailStats) {
      const c = occ.contadores || {};
      els.occDetailStats.textContent =
        'Confirmações: ' + (c.confirmacoes ?? 1) +
        ' · Resolvida: ' + (c.resolvida ?? 0) +
        ' · Contestações: ' + (c.contestacoes ?? 0) +
        ' · Última confirmação: ' + formatarDataHoraPtBr(occ.ultimaConfirmacaoEm || occ.criadoEm);
    }
    if (els.occDetailMsg) {
      els.occDetailMsg.hidden = true;
      els.occDetailMsg.textContent = '';
    }
    els.occDetailModal.hidden = false;
    destacarSegmentosOcorrencias([occ]);
  }

  function fecharDetalheOcorrencia() {
    state.ocorrenciaSelecionada = null;
    if (els.occDetailModal) els.occDetailModal.hidden = true;
  }

  async function enviarInteracaoOcorrencia(tipo) {
    const occ = state.ocorrenciaSelecionada;
    if (!occ) return;
    try {
      const res = await fetch('/api/ocorrencias/interagir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: occ.id,
          tipo,
          usuarioId: state.usuarioId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (els.occDetailMsg) {
          els.occDetailMsg.hidden = false;
          els.occDetailMsg.textContent = data?.message || 'Interação não aplicada.';
        }
        return;
      }
      await loadOcorrencias();
      const atualizada = data.ocorrencia;
      if (atualizada.status === 'resolvida') {
        fecharDetalheOcorrencia();
        setStatus('Ocorrência marcada como resolvida pela comunidade.', 'ok');
      } else {
        abrirDetalheOcorrencia(atualizada);
        if (els.occDetailMsg) {
          els.occDetailMsg.hidden = false;
          els.occDetailMsg.textContent = 'Interação registrada.';
        }
      }
      if (podeCalcular(state.lista).ok && state.rotaAtual) {
        calculate(state.modo);
      }
    } catch (err) {
      if (els.occDetailMsg) {
        els.occDetailMsg.hidden = false;
        els.occDetailMsg.textContent = 'Erro ao enviar interação: ' + err.message;
      }
    }
  }

  if (els.btnNovaOcorrencia) {
    els.btnNovaOcorrencia.addEventListener('click', startPickingOccurrence);
  }
  if (els.occMapAdd) {
    els.occMapAdd.addEventListener('click', startPickingOccurrence);
  }
  if (els.occMapToggle) {
    els.occMapToggle.addEventListener('click', () => {
      state.mostrarOcorrenciasMapa = !state.mostrarOcorrenciasMapa;
      els.occMapToggle.setAttribute('aria-pressed', String(state.mostrarOcorrenciasMapa));
      occClusterLayer.setVisible(state.mostrarOcorrenciasMapa);
    });
  }
  if (els.occModalFechar) els.occModalFechar.addEventListener('click', fecharModalRegistroOcorrencia);
  if (els.occModalCancelar) els.occModalCancelar.addEventListener('click', fecharModalRegistroOcorrencia);
  if (els.occDetailFechar) els.occDetailFechar.addEventListener('click', fecharDetalheOcorrencia);

  if (els.occActConfirmar) {
    els.occActConfirmar.addEventListener('click', () => void enviarInteracaoOcorrencia('confirmar'));
  }
  if (els.occActResolver) {
    els.occActResolver.addEventListener('click', () => void enviarInteracaoOcorrencia('resolver'));
  }
  if (els.occActContestar) {
    els.occActContestar.addEventListener('click', () => void enviarInteracaoOcorrencia('contestar'));
  }

  if (els.occSegSelect) {
    els.occSegSelect.addEventListener('change', () => {
      if (!state.rascunhoOcorrencia) return;
      const chosen = state.rascunhoOcorrencia.candidatos.find(
        (c) => Number(c.featureId) === Number(els.occSegSelect.value),
      );
      if (!chosen) return;
      state.rascunhoOcorrencia.principal = chosen;
      atualizarBoxSegmentoModal(
        chosen,
        state.rascunhoOcorrencia.candidatos,
        state.rascunhoOcorrencia.temRuasProximas,
      );
      destacarSegmentosOcorrencias([
        {
          featureId: chosen.featureId,
          latitude: chosen.latitude,
          longitude: chosen.longitude,
          classificacao: state.rascunhoOcorrencia.classificacao,
        },
      ]);
    });
  }

  if (els.occCats) {
    els.occCats.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-cat]');
      if (!btn || !state.rascunhoOcorrencia) return;
      const cat = obterDetalhesCategoria(btn.dataset.cat);
      if (!cat) return;
      state.rascunhoOcorrencia.categoria = cat.id;
      state.rascunhoOcorrencia.classificacao = cat.classificacaoPadrao;
      renderizarOpcoesModalOcorrencia(cat.id, cat.classificacaoPadrao);
      document.querySelectorAll('input[name="occ_temp"]').forEach((r) => {
        r.checked = r.value === cat.temporalidadePadrao;
      });
    });
  }

  if (els.occClassifs) {
    els.occClassifs.addEventListener('change', (ev) => {
      if (ev.target.name === 'occ_classif' && state.rascunhoOcorrencia) {
        state.rascunhoOcorrencia.classificacao = ev.target.value;
      }
    });
  }

  if (els.occForm) {
    els.occForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!state.rascunhoOcorrencia) return;
      const rasc = state.rascunhoOcorrencia;
      const classifEl = els.occForm.querySelector('input[name="occ_classif"]:checked');
      const tempEl = els.occForm.querySelector('input[name="occ_temp"]:checked');
      const payload = {
        categoria: rasc.categoria,
        classificacao: classifEl ? classifEl.value : rasc.classificacao,
        temporalidade: tempEl ? tempEl.value : 'temporaria',
        descricao: els.occDesc ? els.occDesc.value : '',
        latitude: rasc.principal.latitude,
        longitude: rasc.principal.longitude,
        featureIdPreferido: rasc.principal.featureId,
        usuarioId: state.usuarioId,
      };
      if (els.occModalSalvar) els.occModalSalvar.disabled = true;
      try {
        const res = await fetch('/api/ocorrencias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          if (els.occFormErro) {
            els.occFormErro.hidden = false;
            els.occFormErro.textContent = data?.message || 'Não foi possível salvar a ocorrência.';
          }
          return;
        }
        fecharModalRegistroOcorrencia();
        await loadOcorrencias();
        if (data.ocorrencia) abrirDetalheOcorrencia(data.ocorrencia);
        setStatus('Ocorrência registrada em ' + (data.ocorrencia?.localizacao?.logradouro || 'trecho da via') + '.', 'ok');
        if (podeCalcular(state.lista).ok && state.rotaAtual) {
          calculate(state.modo);
        }
      } catch (err) {
        if (els.occFormErro) {
          els.occFormErro.hidden = false;
          els.occFormErro.textContent = 'Falha ao salvar: ' + err.message;
        }
      } finally {
        if (els.occModalSalvar) els.occModalSalvar.disabled = false;
      }
    });
  }

  /* ─────────────── Alternativas de rota (estilo Google Maps) ─────────────── */

  function desenharRotasAlternativasEsmaecidas() {
    altRouteSource.clear();
    const naoSelecionadas = state.rotasDisponiveis.filter(
      (r) => r.id !== state.rotaSelecionadaId && r.rota?.geometry,
    );
    if (els.legendAlt) els.legendAlt.hidden = naoSelecionadas.length === 0;
    for (const alt of naoSelecionadas) {
      const feat = toOlFeature({
        type: 'Feature',
        properties: { altRouteId: alt.id, rotulo: alt.rotulo },
        geometry: alt.rota.geometry,
      });
      altRouteSource.addFeature(feat);
    }
  }

  function renderizarOcorrenciasDaRota(opcaoSelecionada, comparacao) {
    if (!els.routeOccurrences) return;
    const lista = Array.isArray(opcaoSelecionada?.ocorrenciasNoTrajeto)
      ? opcaoSelecionada.ocorrenciasNoTrajeto
      : [];
    const evitadas = Array.isArray(opcaoSelecionada?.ocorrenciasEvitadas)
      ? opcaoSelecionada.ocorrenciasEvitadas
      : [];
    const motivoSemAlt =
      state.rotasDisponiveis.length === 1 && comparacao?.motivoSemAlternativa
        ? comparacao.motivoSemAlternativa
        : null;

    if (!lista.length && !evitadas.length && !motivoSemAlt) {
      els.routeOccurrences.hidden = true;
      els.routeOccurrences.innerHTML = '';
      return;
    }

    const blocos = [];
    if (evitadas.length) {
      blocos.push(
        '<div class="route-occ__titulo">Desvios aplicados nesta rota (' + evitadas.length + ')</div>' +
        evitadas.map((o) => {
          const est = estiloClassificacao(o.classificacao);
          return (
            '<button type="button" class="route-occ__item" data-occ-id="' + escapeHtml(o.id) + '">' +
            '<span><span class="route-occ__dot" style="display:inline-block;margin-right:6px;background:' + est.cor + '"></span>' +
            'Evitou: <b>' + escapeHtml(o.categoriaLabel) + '</b>' +
            (o.logradouro ? ' · ' + escapeHtml(o.logradouro) : '') + '</span>' +
            '<span>Ver</span></button>'
          );
        }).join(''),
      );
    }
    if (lista.length) {
      blocos.push(
        '<div class="route-occ__titulo">Ocorrências neste trajeto (' + lista.length + ')</div>' +
        lista.map((o) => {
          const est = estiloClassificacao(o.classificacao);
          return (
            '<button type="button" class="route-occ__item" data-occ-id="' + escapeHtml(o.id) + '">' +
            '<span><span class="route-occ__dot" style="display:inline-block;margin-right:6px;background:' + est.cor + '"></span>' +
            '<b>' + escapeHtml(o.categoriaLabel) + '</b>' +
            (o.logradouro ? ' · ' + escapeHtml(o.logradouro) : '') + '</span>' +
            '<span>Detalhes</span></button>'
          );
        }).join(''),
      );
    }
    if (motivoSemAlt && !evitadas.length && !lista.length) {
      blocos.push('<div class="route-occ__titulo">' + escapeHtml(motivoSemAlt) + '</div>');
    }
    els.routeOccurrences.hidden = false;
    els.routeOccurrences.innerHTML = blocos.join('');
  }

  function renderizarAlternativasRota() {
    if (!els.routeAlternatives) return;
    const rotas = state.rotasDisponiveis;
    if (!rotas.length || (rotas.length === 1 && !rotas[0].ocorrenciasEvitadas?.length && !rotas[0].ocorrenciasNoTrajeto?.length)) {
      els.routeAlternatives.hidden = true;
      els.routeAlternatives.innerHTML = '';
      return;
    }
    els.routeAlternatives.hidden = false;
    els.routeAlternatives.innerHTML = rotas.map((op) => {
      const sel = op.id === state.rotaSelecionadaId ? ' is-selected' : '';
      const deltaTxt =
        op.diferencaMetros > 0
          ? '+' + formatarDistanciaCurta(op.diferencaMetros) + ' em relação à mais curta'
          : rotas.length > 1
            ? 'Menor distância'
            : '';
      return (
        '<button type="button" class="route-alt-card' + sel + '" data-route-id="' + escapeHtml(op.id) + '">' +
        '<div class="route-alt-card__top">' +
        '<span class="route-alt-card__title">' + escapeHtml(op.rotulo) + '</span>' +
        '<span class="route-alt-card__dist">' + escapeHtml(formatarDistanciaCurta(op.distance)) + '</span>' +
        '</div>' +
        (op.motivo ? '<div class="route-alt-card__motivo">' + escapeHtml(op.motivo) + '</div>' : '') +
        (deltaTxt ? '<div class="route-alt-card__delta">' + escapeHtml(deltaTxt) + '</div>' : '') +
        '</button>'
      );
    }).join('');
  }

  function selecionarRotaAlternativa(id, opcoes = {}) {
    const escolha =
      state.rotasDisponiveis.find((r) => r.id === id) || state.rotasDisponiveis[0];
    if (!escolha || !escolha.rota) return;
    state.rotaSelecionadaId = escolha.id;
    renderizarAlternativasRota();
    showRoute(escolha.rota, opcoes);
    desenharRotasAlternativasEsmaecidas();
    renderizarOcorrenciasDaRota(escolha, state.comparacaoAlternativas);

    const todasParaDestaque = [
      ...(escolha.ocorrenciasNoTrajeto || []),
      ...(escolha.ocorrenciasEvitadas || []),
    ];
    destacarSegmentosOcorrencias(
      todasParaDestaque.map((r) => state.ocorrencias.find((o) => o.id === r.id) || r),
    );
    const d = formatDistance(escolha.distance);
    setStatus(escolha.rotulo + ': ' + d.v + ' ' + d.u + '.', 'ok');
  }

  if (els.routeAlternatives) {
    els.routeAlternatives.addEventListener('click', (ev) => {
      const card = ev.target.closest('[data-route-id]');
      if (!card) return;
      selecionarRotaAlternativa(card.dataset.routeId);
    });
  }

  if (els.routeOccurrences) {
    els.routeOccurrences.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-occ-id]');
      if (!btn) return;
      const occ = state.ocorrencias.find((o) => o.id === btn.dataset.occId);
      if (!occ) return;
      abrirDetalheOcorrencia(occ);
      if (occ.localizacao?.longitude != null && occ.localizacao?.latitude != null) {
        map.getView().animate({
          center: ol.proj.fromLonLat([occ.localizacao.longitude, occ.localizacao.latitude]),
          zoom: Math.max(map.getView().getZoom(), 17),
          duration: 450,
        });
      }
    });
  }

  /**
   * Valida e converte o Endereço Digital de um ponto chamando o serviço do
   * servidor (que usa a porta fiel da lógica de CEP Digital). A resposta
   * distingue os estados: vazio, malformado, válido (ainda sem coordenadas),
   * convertido, fora da área, indisponível e falha.
   */
  async function validarEnderecoDigital(id) {
    const ponto = state.lista.pontos.find((p) => p.id === id);
    if (!ponto) return;
    const codigo = (ponto.enderecoDigital || '').trim();
    const token = revisoesEndereco.iniciar(id);
    if (!codigo) {
      atualizarPonto(state.lista, id, {
        status: STATUS.VAZIO,
        mensagem: TEXTO_ESTADO[STATUS.VAZIO],
        latitude: null,
        longitude: null,
      });
      renderizarPontos();
      return;
    }

    setStatus('Validando o Endereço Digital do ponto ' + ponto.rotulo + '…', 'busy');
    try {
      const res = await fetch('/api/endereco-digital?modo=local&codigo=' + encodeURIComponent(codigo));
      const data = await res.json();
      if (!revisoesEndereco.atual(token)) return;
      const patch = {
        status: data.status,
        mensagem: data.mensagem,
        codigoNormalizado: data.codigoNormalizado,
        codigoCompleto: data.codigoCompleto,
      };
      if (data.status === STATUS.CONVERTIDO && data.latitude != null) {
        patch.latitude = data.latitude;
        patch.longitude = data.longitude;
        patch.origem = 'codigo';
        patch.mensagem =
          'Convertido: ' + data.latitude.toFixed(6) + ', ' + data.longitude.toFixed(6) +
          (data.codigoCompleto ? ' (' + data.codigoCompleto + ')' : '');
      } else {
        // falhou: **não** se inventa coordenada — o ponto continua sem posição
        patch.latitude = null;
        patch.longitude = null;
      }
      atualizarPonto(state.lista, id, patch);
      renderizarPontos();
      setStatus(
        data.status === STATUS.CONVERTIDO
          ? 'Endereço Digital do ponto ' + ponto.rotulo + ' convertido.'
          : data.mensagem,
        data.status === STATUS.CONVERTIDO ? 'ok' : 'err',
      );
    } catch (err) {
      if (!revisoesEndereco.atual(token)) return;
      atualizarPonto(state.lista, id, {
        status: STATUS.FALHA,
        mensagem: 'Falha na resolução do endereço: ' + err.message,
        latitude: null,
        longitude: null,
      });
      renderizarPontos();
      setStatus('Falha na resolução do Endereço Digital.', 'err');
    }
  }

  /* ─────────────── Cálculo da rota ─────────────── */

  function limparAntesDoCalculo() {
    altRouteSource.clear();
    gpsTrailSource.clear();
    occSegmentHighlightSource.clear();
    state.rotasDisponiveis = [];
    state.rotaSelecionadaId = null;
    state.comparacaoAlternativas = null;
    state.rotaPlanejadaOriginal = null;
    state.idRotaGpsAtual = null;
    if (typeof campoWeb !== 'undefined') {
      campoWeb.limparSessaoGpsEmMemoria();
      campoWeb.definirRotaCalculadaAtiva(null);
    }
    limparFeedbackSaveOffline();
    if (els.legendAlt) els.legendAlt.hidden = true;
    if (els.routeAlternatives) {
      els.routeAlternatives.hidden = true;
      els.routeAlternatives.innerHTML = '';
    }
    if (els.routeOccurrences) {
      els.routeOccurrences.hidden = true;
      els.routeOccurrences.innerHTML = '';
    }
  }

  function aplicarResultadoRota(data) {
    const rotas = Array.isArray(data.rotas) && data.rotas.length
      ? data.rotas
      : [{
          id: 'unica',
          rotulo: 'Rota principal',
          recomendada: true,
          distance: data.distance,
          distanceMeters: data.distanceMeters,
          distanceKm: data.distanceKm,
          diferencaMetros: 0,
          motivo: '',
          ocorrenciasNoTrajeto: [],
          ocorrenciasEvitadas: [],
          violacoesObrigatorias: 0,
          rota: data,
        }];
    state.rotasDisponiveis = rotas;
    state.rotaSelecionadaId = data.rotaSelecionadaId || rotas[0].id;
    state.comparacaoAlternativas = data.comparacaoAlternativas || null;
    selecionarRotaAlternativa(state.rotaSelecionadaId);
  }

  let revisaoCalculo = 0;
  let assinaturaRota = null;
  async function calculate(modo = 'usuario') {
    state.modo = opcoesCalculoCircuito(modo).modo;
    state.circuito = true;
    state.lista.circuito = true;
    const revisao = ++revisaoCalculo;
    const assinatura = assinaturaPlanejador(state);
    state.rotaAtual = null;
    const verificacao = podeCalcular(state.lista);
    if (!verificacao.ok) {
      showError('Pontos incompletos', verificacao.mensagem);
      setStatus(verificacao.mensagem, 'err');
      return;
    }

    els.calc.disabled = true;
    els.calcOptimized.disabled = true;
    setStatus(state.circuito ? 'Calculando o circuito…' : 'Calculando a rota…', 'busy');
    routeSource.clear();
    if (typeof limparAntesDoCalculo === 'function') limparAntesDoCalculo();

    const pontos = state.lista.pontos.map((p) => ({
      rotulo: p.rotulo,
      latitude: p.latitude,
      longitude: p.longitude,
      enderecoDigital: p.enderecoDigital || null,
    }));

    const payload = {
      pontos,
      ...opcoesCalculoCircuito(modo),
    };
    if (state.preferencias) payload.preferencias = state.preferencias;

    try {
      const res = await fetch('/api/rota-paradas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (revisao !== revisaoCalculo || assinaturaPlanejador(state) !== assinatura) return;

      if (!data.ok) {
        showError(
          reasonTitle(data.reason),
          data.message || 'Não foi possível calcular a rota.',
          data,
        );
        // trecho parcial: desenha o que foi calculado, sem inventar o resto
        if (data.legs && data.legs.length) {
          desenharRota(data);
          atualizarLegenda(data.legs);
        } else {
          atualizarLegenda([]);
        }
        setStatus('Sem rota completa.', 'err');
        return;
      }

      if (typeof aplicarResultadoRota === 'function') {
        aplicarResultadoRota(data);
      } else {
        showRoute(data);
        const d = formatDistance(data.distance);
        setStatus('Rota calculada: ' + d.v + ' ' + d.u + '.', 'ok');
      }
    } catch (err) {
      if (revisao !== revisaoCalculo || assinaturaPlanejador(state) !== assinatura) return;
      showError('Falha de comunicação', err.message);
      setStatus('Falha ao consultar o servidor.', 'err');
    } finally {
      if (revisao === revisaoCalculo) { els.calc.disabled = false; els.calcOptimized.disabled = false; }
    }
  }

  function reasonTitle(reason) {
    switch (reason) {
      case 'COORDENADA_INVALIDA': return 'Coordenadas inválidas';
      case 'FORA_DA_REDE': return 'Ponto distante da rede viária';
      case 'SEM_CAMINHO': return 'Não existe caminho viário';
      case 'TRECHO_SEM_CAMINHO': return 'Trecho sem caminho viário';
      case 'BLOQUEADO_POR_OCORRENCIA': return 'Trajeto bloqueado por ocorrência';
      case 'PONTOS_INSUFICIENTES': return 'Pontos insuficientes';
      case 'PONTO_SEM_COORDENADA': return 'Endereço sem resolver';
      case 'REDE_VAZIA': return 'Rede viária indisponível';
      case 'API_INDISPONIVEL': return 'API Node.js indisponível';
      default: return 'Não foi possível calcular a rota';
    }
  }

  function limparFeedbackGpx() {
    if (!els.exportGpxFeedback) return;
    els.exportGpxFeedback.hidden = true;
    els.exportGpxFeedback.className = 'gpx-feedback';
    els.exportGpxFeedback.textContent = '';
  }

  function mostrarFeedbackGpx(mensagem, tipo) {
    if (!els.exportGpxFeedback) return;
    els.exportGpxFeedback.hidden = false;
    els.exportGpxFeedback.className = 'gpx-feedback gpx-feedback--' + (tipo || 'warn');
    els.exportGpxFeedback.textContent = mensagem;
  }

  function limparFeedbackSaveOffline() {
    if (!els.saveRouteOfflineFeedback) return;
    els.saveRouteOfflineFeedback.hidden = true;
    els.saveRouteOfflineFeedback.className = 'gpx-feedback';
    els.saveRouteOfflineFeedback.textContent = '';
  }

  function mostrarFeedbackSaveOffline(mensagem, tipo) {
    if (!els.saveRouteOfflineFeedback) return;
    els.saveRouteOfflineFeedback.hidden = false;
    els.saveRouteOfflineFeedback.className = 'gpx-feedback gpx-feedback--' + (tipo || 'ok');
    els.saveRouteOfflineFeedback.textContent = mensagem;
  }

  function pedirConfirmacaoCampo({
    titulo = 'Confirmar ação',
    mensagem = '',
    itens = [],
    alerta = '',
    rotuloConfirmar = 'Confirmar',
  } = {}) {
    if (!els.campoConfirmModal) {
      return Promise.resolve(typeof window.confirm === 'function' ? window.confirm(mensagem || titulo) : false);
    }
    return new Promise((resolve) => {
      if (els.campoConfirmTitulo) els.campoConfirmTitulo.textContent = titulo;
      if (els.campoConfirmMensagem) els.campoConfirmMensagem.textContent = mensagem;
      if (els.campoConfirmLista) {
        if (Array.isArray(itens) && itens.length) {
          els.campoConfirmLista.hidden = false;
          els.campoConfirmLista.innerHTML = itens.map((it) => '<li>' + escapeHtml(it) + '</li>').join('');
        } else {
          els.campoConfirmLista.hidden = true;
          els.campoConfirmLista.innerHTML = '';
        }
      }
      if (els.campoConfirmAlerta) {
        if (alerta) {
          els.campoConfirmAlerta.hidden = false;
          els.campoConfirmAlerta.textContent = alerta;
        } else {
          els.campoConfirmAlerta.hidden = true;
          els.campoConfirmAlerta.textContent = '';
        }
      }
      if (els.campoConfirmOk) els.campoConfirmOk.textContent = rotuloConfirmar;
      els.campoConfirmModal.hidden = false;

      const finalizar = (confirmado) => {
        els.campoConfirmModal.hidden = true;
        els.campoConfirmOk?.removeEventListener('click', aoConfirmar);
        els.campoConfirmCancelar?.removeEventListener('click', aoCancelar);
        els.campoConfirmFechar?.removeEventListener('click', aoCancelar);
        els.campoConfirmModal.removeEventListener('click', aoBackdrop);
        resolve(confirmado);
      };
      const aoConfirmar = () => finalizar(true);
      const aoCancelar = () => finalizar(false);
      const aoBackdrop = (ev) => {
        if (ev.target === els.campoConfirmModal) finalizar(false);
      };

      els.campoConfirmOk?.addEventListener('click', aoConfirmar);
      els.campoConfirmCancelar?.addEventListener('click', aoCancelar);
      els.campoConfirmFechar?.addEventListener('click', aoCancelar);
      els.campoConfirmModal.addEventListener('click', aoBackdrop);
    });
  }

  async function exportarGpx() {
    if (navUI?.estado?.ativo) {
      const msg = 'Encerre ou finalize a navegação em andamento antes de exportar o GPX. Os dados da navegação permanecem preservados.';
      mostrarFeedbackGpx(msg, 'err');
      setStatus(msg, 'err');
      return { ok: false, motivo: 'NAVEGACAO_EM_ANDAMENTO', mensagem: msg };
    }

    const rotaAtualValida =
      state.rotaAtual &&
      assinaturaRota === assinaturaPlanejador(state) &&
      state.rotaAtual.ok !== false &&
      !state.rotaAtual.parcial;

    const rotaCalcOriginal =
      state.rotaPlanejadaOriginal?.rota &&
      state.rotaPlanejadaOriginal.rota.ok !== false &&
      !state.rotaPlanejadaOriginal.rota.parcial
        ? state.rotaPlanejadaOriginal.rota
        : (rotaAtualValida ? state.rotaAtual : null);

    let rotaPercorrida = null;
    let pontosGps = [];
    let idGps = state.idRotaGpsAtual;
    try {
      const sessaoGps = typeof campoWeb !== 'undefined' ? campoWeb.obterUltimaExecucaoGpsSessao?.() : null;
      if (sessaoGps?.rota && !sessaoGps.rota.simulado && (!idGps || sessaoGps.rota.idCliente === idGps)) {
        rotaPercorrida = sessaoGps.rota;
        pontosGps = Array.isArray(sessaoGps.pontosGps) ? sessaoGps.pontosGps : [];
        if (!idGps) idGps = sessaoGps.rota.idCliente;
      }
      if (!idGps && rotaCalcOriginal?.idCliente && typeof campoWeb !== 'undefined') {
        const execsGps = await campoWeb.listarRotasSalvas({
          tipoRota: 'GPS',
          incluirSimuladas: false,
          limit: 40,
        });
        const vinculada = execsGps.find(
          (g) => !g.simulado && g.idRotaOrigemCliente === rotaCalcOriginal.idCliente && g.geometry,
        );
        if (vinculada) idGps = vinculada.idCliente;
      }
      if (!rotaPercorrida && idGps && typeof campoWeb !== 'undefined') {
        const regGps = await campoWeb.obterRota(idGps);
        if (regGps && !regGps.simulado) {
          rotaPercorrida = regGps;
          pontosGps = await campoWeb.listarPontosGps(idGps);
        }
      }
    } catch {
      /* mantém apenas os dados disponíveis em memória se leitura local falhar */
    }

    if (!rotaAtualValida && !rotaCalcOriginal && !rotaPercorrida && pontosGps.length < 2) {
      const msg = 'Calcule uma rota completa ou registre um percurso GPS real antes de exportar em GPX.';
      mostrarFeedbackGpx(msg, 'err');
      setStatus(msg, 'err');
      return { ok: false, motivo: 'SEM_ROTA', mensagem: msg };
    }

    if (els.exportGpx) els.exportGpx.disabled = true;
    limparFeedbackGpx();
    setStatus('Preparando exportação GPX…', 'busy');
    try {
      const rotaParaExportar = rotaAtualValida ? state.rotaAtual : null;
      const pontosExportar =
        state.rotaPlanejadaOriginal?.pontos?.length
          ? state.rotaPlanejadaOriginal.pontos
          : state.lista.pontos;
      const res = await exportarRotaGpxWeb(state.rotaAtual && rotaAtualValida ? state.rotaAtual : rotaParaExportar, {
        pontos: pontosExportar,
        rotaCalculadaOriginal: rotaCalcOriginal,
        rotaPercorrida,
        pontosGps,
        navegacaoEmAndamento: false,
      });
      if (res.ok) {
        mostrarFeedbackGpx(res.mensagem, 'ok');
        setStatus(res.mensagem, 'ok');
      } else {
        mostrarFeedbackGpx(res.mensagem, 'err');
        setStatus(res.mensagem, 'err');
      }
      return res;
    } finally {
      if (els.exportGpx) els.exportGpx.disabled = false;
    }
  }

  function showError(title, message, payload = null) {
    state.rotaAtual = null;
    state.rotasDisponiveis = [];
    state.rotaSelecionadaId = null;
    altRouteSource.clear();
    if (els.legendAlt) els.legendAlt.hidden = true;
    if (els.routeAlternatives) {
      els.routeAlternatives.hidden = true;
      els.routeAlternatives.innerHTML = '';
    }
    if (els.routeOccurrences) {
      els.routeOccurrences.hidden = true;
      els.routeOccurrences.innerHTML = '';
    }
    limparFeedbackGpx();
    limparFeedbackSaveOffline();
    if (els.exportGpx) els.exportGpx.hidden = true;
    if (els.saveRouteOffline) els.saveRouteOffline.hidden = true;
    if (els.addRouteObs) els.addRouteObs.hidden = true;
    if (els.routeCampoObs) {
      els.routeCampoObs.hidden = true;
      els.routeCampoObs.innerHTML = '';
    }
    if (els.startNav) els.startNav.hidden = true;
    els.resultBlock.hidden = false;
    els.distanceValue.className = 'distance__value is-error';
    els.distanceValue.textContent = title;
    els.distanceUnit.textContent = '';
    if (els.routeNote) {
      els.routeNote.hidden = true;
      els.routeNote.textContent = '';
    }
    els.legs.innerHTML = '';
    els.streets.innerHTML = '';
    els.streetsCount.textContent = '';
    // remove o alerta anterior para não acumular mensagens
    const anterior = document.getElementById('route-alert');
    if (anterior) anterior.remove();
    els.resultBlock.insertBefore(
      (function () {
        const d = document.createElement('div');
        d.className = 'alert alert--error';
        d.id = 'route-alert';
        d.innerHTML = '<strong>' + escapeHtml(title) + '</strong>' + escapeHtml(message);
        if (payload?.reason === 'BLOQUEADO_POR_OCORRENCIA') {
          if (Array.isArray(payload.ocorrenciasBloqueantes) && payload.ocorrenciasBloqueantes.length) {
            destacarSegmentosOcorrencias(
              payload.ocorrenciasBloqueantes.map((r) => state.ocorrencias.find((o) => o.id === r.id) || r),
            );
          }
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'mini';
          btn.style.marginTop = '8px';
          btn.textContent = 'Ignorar alertas e recalcular';
          btn.addEventListener('click', () => {
            state.preferencias = salvarPreferenciasWeb(
              { ...state.preferencias, modo: 'ignorar' },
              window.localStorage,
            );
            atualizarPreferenciasUI();
            calculate(state.modo);
          });
          d.appendChild(document.createElement('br'));
          d.appendChild(btn);
        }
        return d;
      })(),
      els.resultBlock.children[1]
    );
    routeSource.clear();
    // a legenda dos trechos também é limpa: nada de correspondence
    // colorida de uma rota que deixou de existir
    atualizarLegenda([]);
  }

  /** Desenha uma geometria (lon/lat) no mapa. */
  function desenharGeometria(geom, props) {
    if (!geom || !geom.coordinates || geom.coordinates.length < 2) return null;
    const feature = toOlFeature({
      type: 'Feature',
      properties: props || {},
      geometry: geom,
    });
    routeSource.addFeature(feature);
    return feature;
  }

  /** Ajusta o enquadramento para mostrar TODA a rota desenhada. */
  function ajustarEnquadramento() {
    const feats = routeSource.getFeatures();
    if (!feats.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of feats) {
      const e = f.getGeometry().getExtent();
      if (e[0] < minX) minX = e[0];
      if (e[1] < minY) minY = e[1];
      if (e[2] > maxX) maxX = e[2];
      if (e[3] > maxY) maxY = e[3];
    }
    map.getView().fit([minX, minY, maxX, maxY], {
      padding: [70, 70, 70, 70],
      duration: 600,
      maxZoom: 18,
    });
  }

  /**
   * Desenha a rota calculada.
   *
   * Cada trecho vira uma feature própria — assim cada um pode ter a **sua
   * cor** (a cor representa o trecho entre duas paradas, não a posição da
   * parada nem o modo de roteamento). O trecho de **retorno à origem** (rota
   * circular) é marcado (`retorno`), para ser desenhado tracejado — fica
   * visível onde o circuito fecha.
   *
   * A origem da SOURCE é limpa a cada desenho: nenhuma geometria antiga
   * sobra quando a rota é recalculada, reordenada ou editada.
   */
  function desenharRota(data, opcoes = {}) {
    routeSource.clear();
    state.trechos = [];
    const legs = Array.isArray(data.legs) ? data.legs : [];
    if (legs.length) {
      const cores = coresDosTrechos(legs);
      legs.forEach((leg, i) => {
        const feature = desenharGeometria(leg.geometry, {
          cor: leg.cor || cores[i],
          retorno: leg.retorno ? 1 : 0,
          de: leg.de,
          para: leg.para,
          legIndex: i,
          visivel: 1,
        });
        state.trechos.push({
          indice: i,
          de: leg.de,
          para: leg.para,
          cor: leg.cor || cores[i],
          retorno: !!leg.retorno,
          visivel: true,
          feature,
        });
      });
    } else if (data.geometry) {
      desenharGeometria(data.geometry, { cor: coresDosTrechos([{}])[0] });
    }
    // durante a navegação o enquadramento é controlado pelo
    // "seguir a posição" — reenquadrar aqui brigaria com ele
    if (!opcoes.semEnquadrar) ajustarEnquadramento();
  }

  /**
   * Marca a **situação** de cada trecho durante a navegação.
   *
   * `atual` = o trecho que está sendo percorrido agora (recebe destaque);
   * `percorridos` = trechos já passados (ficam esmaecidos). A **cor** de
   * cada trecho nunca muda — a cor identifica o trecho, não o estado dele.
   */
  function definirEstadoTrechos(mapa) {
    const atual = mapa && typeof mapa.atual === 'number' ? mapa.atual : null;
    const percorridos = new Set((mapa && mapa.percorridos) || []);
    for (const t of state.trechos) {
      if (!t.feature) continue;
      let situacao = null;
      if (atual != null && t.indice === atual) situacao = 'atual';
      else if (percorridos.has(t.indice)) situacao = 'percorrido';
      t.feature.set('situacao', situacao);
    }
  }

  /**
   * Oculta (ou torna visível de novo) um trecho da rota.
   *
   * É a resposta ao problema das **sobreposições**: quando dois trechos
   * passam pelo mesmo caminho, o de cima esconde o de baixo. Ocultando um
   * deles, o outro fica legível — e nada é alterado no cálculo: a rota, a
   * distância e a ordem dos trechos continuam exatamente as mesmas.
   */
  function alternarVisibilidadeTrecho(indice) {
    const trecho = state.trechos.find((t) => t.indice === indice);
    if (!trecho || !trecho.feature) return;
    trecho.visivel = !trecho.visivel;
    trecho.feature.set('visivel', trecho.visivel ? 1 : 0);
    atualizarEstadoTrechos();
    setStatus(
      (trecho.visivel ? 'Trecho exibido: ' : 'Trecho ocultado: ') +
        trecho.de + ' → ' + trecho.para +
        '. A rota e a distância não mudaram.',
      'idle',
    );
  }

  /** Reflete o estado (visível/oculto) na legenda e no painel. */
  function atualizarEstadoTrechos() {
    const visiveis = state.trechos.filter((t) => t.visivel).length;
    for (const t of state.trechos) {
      const oculta = !t.visivel;
      const linha = els.legendTrechosLista.querySelector('[data-leg="' + t.indice + '"]');
      if (linha) {
        linha.setAttribute('aria-pressed', oculta ? 'true' : 'false');
        linha.classList.toggle('is-oculto', oculta);
        linha.setAttribute(
          'title',
          (oculta ? 'Mostrar' : 'Ocultar') + ' o trecho ' + t.de + ' → ' + t.para,
        );
      }
      const item = els.legs.querySelector('[data-leg="' + t.indice + '"]');
      if (item) item.classList.toggle('leg--oculto', oculta);
    }
    if (els.legendCont) {
      els.legendCont.textContent =
        state.trechos.length > 0
          ? visiveis + '/' + state.trechos.length + ' visíveis'
          : '';
    }
    if (els.legendRestaurar) {
      els.legendRestaurar.hidden = visiveis === state.trechos.length;
    }
  }

  /** Torna visíveis todos os trechos (desfaz as ocultações). */
  function mostrarTodosTrechos() {
    let mudou = false;
    for (const t of state.trechos) {
      if (!t.visivel) {
        t.visivel = true;
        t.feature.set('visivel', 1);
        mudou = true;
      }
    }
    if (!mudou) return;
    atualizarEstadoTrechos();
    setStatus('Todos os trechos voltaram a ser exibidos.', 'idle');
  }

  /**
   * Nota compacta do trajeto (substitui a antiga tabela de estatísticas).
   *
   * O **método de otimização** continua sendo declarado: a otimização é
   * exata até 16 paradas intermediárias e heurística acima disso — nunca
   * se promete o ótimo global quando a heurística foi usada. A economia
   * sobre a ordem do usuário também é informada, inclusive quando ela é
   * ZERO (empate): nesse caso a ordem mudou, mas o custo é o mesmo.
   */
  function atualizarNotaDoTrajeto(data) {
    if (!els.routeNote) return;
    els.routeNote.hidden = false;
    els.routeNote.textContent = resumoRota(data);
  }

  function showRoute(data, opcoes = {}) {
    const old = document.getElementById('route-alert');
    if (old) old.remove();

    // a rota atual é o PLANO da navegação ativa
    state.rotaAtual = data;
    if (!opcoes.manterNavegacao) {
      state.rotaPlanejadaOriginal = {
        rota: data,
        pontos: state.lista.pontos.map((p) => ({ ...p })),
      };
      if (!opcoes.preservarGps) {
        state.idRotaGpsAtual = null;
      }
    }
    assinaturaRota = assinaturaPlanejador(state);
    limparFeedbackGpx();
    if (els.exportGpx) {
      els.exportGpx.hidden = !!((data.ok === false || data.parcial) && !state.idRotaGpsAtual);
    }
    if (els.startNav) els.startNav.hidden = false;
    // se havia navegação em curso, ela é encerrada: o trajeto planejado
    // mudou e a navegação antiga não valeria mais
    if (navUI && !opcoes.manterNavegacao) navUI.aoCalcularRota();

    els.resultBlock.hidden = false;
    const d = formatDistance(data.distance);
    els.distanceValue.className = 'distance__value';
    els.distanceValue.textContent = d.v;
    els.distanceUnit.textContent = d.u;

    const legs = data.legs || [];
    // as pernas de rua (eixo a eixo) de todos os trechos, para a lista de
    // logradouros percorridos
    const todos = legs.flatMap((l) => l.legs || []);

    atualizarNotaDoTrajeto(data);

    // distância de cada trecho, na ordem percorrida — com a COR do trecho,
    // a mesma que aparece no mapa e na legenda
    const cores = coresDosTrechos(legs);
    els.legs.innerHTML = legs
      .map((l, i) => {
        const dl = formatDistance(l.distance);
        const cor = l.cor || cores[i];
        const acesso = l.origem
          ? ' · acesso à rede ' + Math.round(l.origem.distanceToNetwork * 100) / 100 + ' m'
          : '';
        return (
          '<div class="leg' + (l.retorno ? ' leg--retorno' : '') + '" data-leg="' + i + '" ' +
          'role="button" tabindex="0" ' +
          'title="Ocultar o trecho ' + escapeHtml(l.de) + ' → ' + escapeHtml(l.para) + '">' +
          '<span class="leg__cor" style="background:' + cor + '" ' +
          'title="Cor do trecho ' + escapeHtml(l.de) + ' → ' + escapeHtml(l.para) + '"></span>' +
          '<span class="leg__de">' + escapeHtml(l.de) + '</span>' +
          '<span class="leg__seta">→</span>' +
          '<span class="leg__para">' + escapeHtml(l.para) + '</span>' +
          '<span class="leg__dist">' + dl.v + ' ' + dl.u + '</span>' +
          '<span class="leg__acesso">' +
          escapeHtml(l.retorno ? 'retorno à origem · ' + acesso : acesso) +
          '</span></div>'
        );
      })
      .join('');

    els.streets.innerHTML = todos
      .map((l) => {
        const len = l.length < 1000
          ? Math.round(l.length) + ' m'
          : (l.length / 1000).toFixed(2) + ' km';
        const tag = l.official
          ? '<span class="tag">oficial</span>'
          : '<span class="tag tag--unofficial">não oficial</span>';
        return '<li><span class="name">' + escapeHtml(l.street || 'Eixo sem nome') + ' ' + tag +
          '</span><span class="len">' + len + '</span></li>';
      })
      .join('');
    els.streetsCount.textContent = todos.length;

    // a legenda passa a listar os trechos com as suas cores
    atualizarLegenda(legs);

    // desenha a rota (no circuito, o retorno à origem vai tracejado)
    desenharRota(data, opcoes);

    // Salvamento offline acontece EXCLUSIVAMENTE quando o usuário clicar em "Salvar rotas offline"
    if (els.saveRouteOffline) {
      const temGpsSessao = !!(typeof campoWeb !== 'undefined' && campoWeb.obterUltimaExecucaoGpsSessao?.());
      els.saveRouteOffline.hidden = !!((data.ok === false || data.parcial) && !temGpsSessao);
    }
    if (els.addRouteObs) els.addRouteObs.hidden = !!(data.ok === false || data.parcial);
    if (!opcoes.naoSalvarLocal && !opcoes.manterNavegacao && data.ok !== false && !data.parcial && typeof campoWeb !== 'undefined') {
      void campoWeb.buscarRotaSalvaPorAssinatura(data, state.lista.pontos).then((jaSalva) => {
        campoWeb.definirRotaCalculadaAtiva(jaSalva || null);
        if (jaSalva) {
          state.rotaAtual.idCliente = jaSalva.idCliente;
          if (state.rotaPlanejadaOriginal?.rota === data) {
            state.rotaPlanejadaOriginal.rota.idCliente = jaSalva.idCliente;
          }
        }
        return atualizarObservacoesDaRotaAtiva();
      }).catch(() => {});
    } else if (typeof campoWeb !== 'undefined') {
      void atualizarObservacoesDaRotaAtiva();
    }
  }

  /* ─────────────── Mostrar/ocultar trechos (sobreposições) ─────────────── */

  // legenda: clicar na linha de um trecho o oculta
  els.legendTrechosLista.addEventListener('click', (ev) => {
    const linha = ev.target.closest('[data-leg]');
    if (!linha) return;
    alternarVisibilidadeTrecho(Number(linha.dataset.leg));
  });

  // painel: clicar (ou usar o teclado) na linha de um trecho o oculta
  els.legs.addEventListener('click', (ev) => {
    const linha = ev.target.closest('[data-leg]');
    if (!linha) return;
    alternarVisibilidadeTrecho(Number(linha.dataset.leg));
  });
  els.legs.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const linha = ev.target.closest('[data-leg]');
    if (!linha) return;
    ev.preventDefault();
    alternarVisibilidadeTrecho(Number(linha.dataset.leg));
  });

  if (els.legendRestaurar) {
    els.legendRestaurar.addEventListener('click', () => mostrarTodosTrechos());
  }

  /* ─────────────── Ordem dos pontos: arrastar no painel ─────────────── */

  /**
   * Re-renderiza a lista de pontos e recalcula a rota (quando o trajeto
   * está completo). Usado depois de qualquer mudança de ordem.
   */
  function reaplicarOrdem(mensagem) {
    renderizarPontos();
    if (mensagem) setStatus(mensagem, 'busy');
    if (podeCalcular(state.lista).ok) {
      calculate();
      return;
    }
    // o trajeto deixou de ser calculável (falta coordenada, não há
    // paradas…): o desenho e a legenda são limpos, para não deixar
    // geometrias antigas no mapa
    state.rotaAtual = null;
    state.rotaPlanejadaOriginal = null;
    state.idRotaGpsAtual = null;
    if (typeof campoWeb !== 'undefined') {
      campoWeb.limparSessaoGpsEmMemoria();
      campoWeb.definirRotaCalculadaAtiva(null);
    }
    limparFeedbackGpx();
    limparFeedbackSaveOffline();
    if (els.exportGpx) els.exportGpx.hidden = true;
    if (els.saveRouteOffline) els.saveRouteOffline.hidden = true;
    if (els.addRouteObs) els.addRouteObs.hidden = true;
    if (els.routeCampoObs) {
      els.routeCampoObs.hidden = true;
      els.routeCampoObs.innerHTML = '';
    }
    routeSource.clear();
    gpsTrailSource.clear();
    if (typeof limparAntesDoCalculo === 'function') limparAntesDoCalculo();
    atualizarLegenda([]);
    els.resultBlock.hidden = true;
    setStatus('O trajeto mudou: complete os pontos para recalcular a rota.', 'idle');
  }

  // O arraste aqui é de **ORDEM**: a parada arrastada troca de lugar com a
  // linha sobre a qual ela é solta. A origem (primeira linha) e o destino
  // (última linha) permanecem nas extremidades — a regra está em
  // `core/pontoTrajeto.js` (`moverPontoPara`), compartilhada com o servidor.
  els.points.addEventListener('dragstart', (ev) => {
    const alca = ev.target.closest('.point__grip[data-arrastavel]');
    const linha = alca && alca.closest('.point');
    if (!linha) return;
    state.arrastandoId = linha.dataset.id;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', linha.dataset.id);
    linha.classList.add('point--arrastando');
  });

  els.points.addEventListener('dragover', (ev) => {
    if (!state.arrastandoId) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    const alvo = ev.target.closest('.point');
    for (const l of els.points.querySelectorAll('.point--alvo')) {
      l.classList.remove('point--alvo');
    }
    if (alvo && alvo.dataset.id !== state.arrastandoId) {
      alvo.classList.add('point--alvo');
    }
  });

  els.points.addEventListener('drop', (ev) => {
    if (!state.arrastandoId) return;
    ev.preventDefault();
    const id = state.arrastandoId;
    const alvo = ev.target.closest('.point');
    limparMarcasDeArraste();
    if (!alvo) return;
    const indice = state.lista.pontos.findIndex((p) => p.id === alvo.dataset.id);
    if (indice < 0) return;
    // a linha alvo define a posição final da parada arrastada
    const movido = moverPontoPara(state.lista, id, indice);
    if (!movido) return;
    state.dicaArrasteVista = true;
    reaplicarOrdem(
      'Ordem alterada: ' + sequenciaRotulos(state.lista).join(' → ') + '. Recalculando a rota…',
    );
  });

  els.points.addEventListener('dragend', () => {
    state.arrastandoId = null;
    limparMarcasDeArraste();
  });

  function limparMarcasDeArraste() {
    state.arrastandoId = null;
    for (const l of els.points.querySelectorAll('.point--alvo, .point--arrastando')) {
      l.classList.remove('point--alvo', 'point--arrastando');
    }
  }

  /* ─────────────── Eventos da interface ─────────────── */

  // eventos delegate dos pontos (a lista é redesenhada a cada mudança)
  els.points.addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-acao]');
    if (!botao) return;
    const linha = botao.closest('.point');
    if (!linha) return;
    const id = linha.dataset.id;
    const acao = botao.dataset.acao;

    if (acao === 'validar') {
      validarEnderecoDigital(id);
    } else if (acao === 'map') {
      const ponto = state.lista.pontos.find((p) => p.id === id);
      if (!ponto || ponto.latitude == null) return;
      map.getView().animate({
        center: ol.proj.fromLonLat([ponto.longitude, ponto.latitude]),
        zoom: Math.max(map.getView().getZoom(), 17),
        duration: 500,
      });
    } else if (acao === 'cima') {
      moverPonto(state.lista, id, -1);
      state.dicaArrasteVista = true;
      reaplicarOrdem();
    } else if (acao === 'baixo') {
      moverPonto(state.lista, id, +1);
      state.dicaArrasteVista = true;
      reaplicarOrdem();
    } else if (acao === 'remover') {
      revisoesEndereco.invalidar(id);
      removerPonto(state.lista, id);
      // o trajeto mudou: a rota exibida (e as cores dos trechos) ficaram
      // desatualizadas — recalcula, ou limpa o desenho se o trajeto deixou
      // de ser calculável. Nunca sobram geometrias antigas no mapa.
      reaplicarOrdem('Parada removida. Recalculando a rota…');
    }
  });

  els.points.addEventListener('click', (ev) => {
    const botao = ev.target.closest('.pick');
    if (!botao) return;
    const id = botao.dataset.pick;
    if (state.picking === id) stopPicking();
    else startPicking(id);
  });

  // digitação: o modelo é atualizado sem redesenhar (preserva o foco)
  els.points.addEventListener('input', (ev) => {
    const linha = ev.target.closest('.point');
    if (!linha) return;
    const id = linha.dataset.id;
    const ponto = state.lista.pontos.find((p) => p.id === id);
    if (!ponto) return;

    if (ev.target.classList.contains('point__codigo')) {
      revisoesEndereco.invalidar(id);
      ponto.enderecoDigital = ev.target.value;
      // digitou um código novo: o ponto precisa ser validado de novo
      ponto.status = ev.target.value.trim() ? 'PENDENTE' : STATUS.VAZIO;
      ponto.mensagem = ev.target.value.trim() ? TEXTO_ESTADO.PENDENTE : TEXTO_ESTADO[STATUS.VAZIO];
      ponto.latitude = null;
      ponto.longitude = null;
      const estado = linha.querySelector('.point__estado');
      if (estado) {
        estado.textContent = ponto.mensagem;
        estado.className = 'point__estado point__estado--' + classeEstado(ponto.status);
      }
      atualizarMarcadores();
    } else if (ev.target.classList.contains('point__coord')) {
      revisoesEndereco.invalidar(id);
      const coords = parseCoords(ev.target.value);
      if (coords) {
        ponto.latitude = coords.lat;
        ponto.longitude = coords.lon;
        ponto.origem = 'coordenada';
        ponto.status = STATUS.CONVERTIDO;
        ponto.mensagem = 'Coordenadas informadas manualmente.';
      } else {
        ponto.latitude = null;
        ponto.longitude = null;
        ponto.status = 'PENDENTE';
        ponto.mensagem = 'Coordenadas em formato inválido.';
      }
      const estado = linha.querySelector('.point__estado');
      if (estado) {
        estado.textContent = ponto.mensagem;
        estado.className = 'point__estado point__estado--' + classeEstado(ponto.status);
      }
      atualizarMarcadores();
    }
  });

  els.points.addEventListener('keydown', (ev) => {
    // A alça de arraste também é operável pelo teclado: as setas mudam a
    // ordem da parada. Enter/Espaço NÃO calculam a rota a partir dela.
    const alca = ev.target.closest('.point__grip[data-arrastavel]');
    if (alca) {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      ev.preventDefault();
      const linha = alca.closest('.point');
      if (!linha) return;
      const id = linha.dataset.id;
      const indice = state.lista.pontos.findIndex((p) => p.id === id);
      if (indice < 0) return;
      const destino = indice + (ev.key === 'ArrowDown' ? 1 : -1);
      if (!moverPontoPara(state.lista, id, destino)) {
        setStatus('A parada já está no limite da ordem do trajeto.', 'idle');
        return;
      }
      state.dicaArrasteVista = true;
      reaplicarOrdem(
        'Ordem alterada: ' + sequenciaRotulos(state.lista).join(' → ') + '. Recalculando a rota…',
      );
      const devolvida = [...els.points.querySelectorAll('.point')]
        .find((item) => item.dataset.id === id);
      const novaAlca = devolvida && devolvida.querySelector('.point__grip');
      if (novaAlca) novaAlca.focus();
      return;
    }
    if (ev.key !== 'Enter') return;
    const linha = ev.target.closest('.point');
    if (!linha) return;
    ev.preventDefault();
    if (ev.target.classList.contains('point__codigo')) {
      validarEnderecoDigital(linha.dataset.id);
    } else {
      calculate();
    }
  });

  els.calc.addEventListener('click', () => calculate('usuario'));
  els.calcOptimized.addEventListener('click', () => calculate('otimizada'));
  if (els.exportGpx) els.exportGpx.addEventListener('click', () => void exportarGpx());

  els.addStop.addEventListener('click', () => {
    adicionarPonto(state.lista, {});
    renderizarPontos();
    setStatus(
      state.circuito
        ? 'Parada adicionada ao circuito. Informe o Endereço Digital.'
        : 'Parada adicionada. Informe o Endereço Digital.',
      'idle',
    );
    const ultima = els.points.querySelector('.point:last-child .point__codigo');
    if (ultima) ultima.focus();
  });

  els.clear.addEventListener('click', () => {
    inicializarPontos();
    atualizarLegenda();
    state.rotaAtual = null;
    state.rotaPlanejadaOriginal = null;
    state.idRotaGpsAtual = null;
    state.rotasDisponiveis = [];
    state.rotaSelecionadaId = null;
    state.comparacaoAlternativas = null;
    limparFeedbackGpx();
    limparFeedbackSaveOffline();
    if (els.exportGpx) els.exportGpx.hidden = true;
    if (els.saveRouteOffline) els.saveRouteOffline.hidden = true;
    if (els.addRouteObs) els.addRouteObs.hidden = true;
    if (els.routeCampoObs) {
      els.routeCampoObs.hidden = true;
      els.routeCampoObs.innerHTML = '';
    }
    if (els.startNav) els.startNav.hidden = true;
    gpsTrailSource.clear();
    routeObsSource.clear();
    campoWeb.limparSessaoGpsEmMemoria();
    campoWeb.definirRotaCalculadaAtiva(null);
    if (els.legendAlt) els.legendAlt.hidden = true;
    if (els.routeAlternatives) {
      els.routeAlternatives.hidden = true;
      els.routeAlternatives.innerHTML = '';
    }
    if (els.routeOccurrences) {
      els.routeOccurrences.hidden = true;
      els.routeOccurrences.innerHTML = '';
    }
    els.resultBlock.hidden = true;
    const alert = document.getElementById('route-alert');
    if (alert) alert.remove();
    routeSource.clear();
    altRouteSource.clear();
    occSegmentHighlightSource.clear();
    setStatus('Pronto', 'idle');
  });

  /* ─────────────── Campo offline-first, GPS, Observações & Sync ─────────────── */

  let pontosTrilhaAoVivo = [];

  function atualizarIndicadorSyncCampo(resumo) {
    if (!resumo || !els.campoSyncPill || !els.campoSyncTexto) return;
    els.campoSyncPill.dataset.syncState = resumo.estado || 'IDLE';
    els.campoSyncTexto.textContent = resumo.texto || 'Salvo no dispositivo';
    if (els.campoSyncRetry) {
      els.campoSyncRetry.hidden = !resumo.podeTentarManual;
      els.campoSyncRetry.title = resumo.ultimoErro || 'Tentar sincronizar agora';
    }
  }

  function classeBadgeSync(syncStatus) {
    if (syncStatus === 'SYNCED') return 'campo-badge--synced';
    if (syncStatus === 'ERROR') return 'campo-badge--error';
    return 'campo-badge--pending';
  }

  async function renderizarRotasSalvasCampo() {
    if (!els.campoRotasLista || !els.campoRotasCount) return;
    try {
      const rotas = await campoWeb.listarRotasSalvas({ incluirSimuladas: false, limit: 40 });
      els.campoRotasCount.textContent = String(rotas.length);
      if (!rotas.length) {
        els.campoRotasLista.innerHTML = '<p class="campo-vazio">Nenhuma rota salva no dispositivo.</p>';
        return;
      }
      els.campoRotasLista.innerHTML = rotas.map((r) => {
        const ehGps = r.tipoRota === 'GPS';
        const d = formatDistance(r.distanciaMetros || 0);
        const dt = formatarDataHoraPtBr(r.dataCriacao);
        const syncRotulo = campoWeb.rotuloSyncStatus(r.syncStatus);
        return (
          '<div class="saved-route-item" data-rota-id="' + escapeHtml(r.idCliente) + '">' +
          '<div class="saved-route-item__top">' +
          '<b>' + escapeHtml(r.titulo || (ehGps ? 'Execução GPS' : 'Rota calculada')) + '</b>' +
          '<span class="campo-badge ' + (ehGps ? 'campo-badge--gps' : '') + '">' + escapeHtml(r.tipoRota) + '</span>' +
          '</div>' +
          '<div class="saved-route-item__meta">' +
          escapeHtml(d.v + ' ' + d.u) + ' · ' + escapeHtml(r.status) + ' · ' + escapeHtml(dt) +
          ' · <span class="campo-badge ' + classeBadgeSync(r.syncStatus) + '">' + escapeHtml(syncRotulo) + '</span>' +
          '</div>' +
          '<div class="saved-route-item__acoes">' +
          '<button type="button" class="mini" data-acao-rota="abrir">Abrir no mapa</button>' +
          '<button type="button" class="mini" data-acao-rota="gpx">Exportar GPX</button>' +
          '<button type="button" class="mini" data-acao-rota="obs">Observações</button>' +
          '<button type="button" class="mini mini--danger" data-acao-rota="excluir">Excluir</button>' +
          '</div>' +
          '</div>'
        );
      }).join('');
    } catch {
      /* mantém lista atual se driver estiver inicializando */
    }
  }

  async function exportarRotaSalvaCampo(idCliente) {
    if (navUI?.estado?.ativo) {
      const msg = 'Encerre ou finalize a navegação em andamento antes de exportar o GPX. Os dados da navegação permanecem preservados.';
      mostrarFeedbackGpx(msg, 'err');
      setStatus(msg, 'err');
      return { ok: false, motivo: 'NAVEGACAO_EM_ANDAMENTO', mensagem: msg };
    }
    const reg = await campoWeb.obterRota(idCliente);
    if (!reg) {
      const msg = 'Rota salva não encontrada para exportação GPX.';
      mostrarFeedbackGpx(msg, 'err');
      setStatus(msg, 'err');
      return { ok: false, motivo: 'SEM_ROTA', mensagem: msg };
    }
    if (reg.tipoRota === 'GPS' && reg.simulado) {
      const msg = 'Execuções simuladas não representam percurso real de GPS para exportação.';
      mostrarFeedbackGpx(msg, 'err');
      setStatus(msg, 'err');
      return { ok: false, motivo: 'SIMULACAO_NAO_EXPORTAVEL', mensagem: msg };
    }

    let rotaCalculada = null;
    let rotaPercorrida = null;
    let pontosGps = [];
    let pontos = [];

    if (reg.tipoRota === 'GPS') {
      rotaPercorrida = reg;
      pontosGps = await campoWeb.listarPontosGps(reg.idCliente);
      if (reg.idRotaOrigemCliente) {
        const orig = await campoWeb.obterRota(reg.idRotaOrigemCliente);
        if (orig && orig.tipoRota !== 'GPS' && orig.geometry) {
          rotaCalculada = campoWeb.reconstruirRespostaRotaDeRegistro(orig) || orig;
          pontos = Array.isArray(orig.pontosJson) ? orig.pontosJson : [];
        }
      }
    } else {
      rotaCalculada = campoWeb.reconstruirRespostaRotaDeRegistro(reg) || reg;
      pontos = Array.isArray(reg.pontosJson) ? reg.pontosJson : [];
      const execsGps = await campoWeb.listarRotasSalvas({
        tipoRota: 'GPS',
        incluirSimuladas: false,
        limit: 40,
      });
      const vinculada = execsGps.find(
        (g) => !g.simulado && g.idRotaOrigemCliente === reg.idCliente && g.geometry,
      );
      if (vinculada) {
        rotaPercorrida = vinculada;
        pontosGps = await campoWeb.listarPontosGps(vinculada.idCliente);
      }
    }

    const res = await exportarRotaGpxWeb(rotaCalculada, {
      pontos,
      rotaCalculadaOriginal: rotaCalculada,
      rotaPercorrida,
      pontosGps,
      navegacaoEmAndamento: false,
    });
    if (res.ok) {
      mostrarFeedbackGpx(res.mensagem, 'ok');
      setStatus(res.mensagem, 'ok');
    } else {
      mostrarFeedbackGpx(res.mensagem, 'err');
      setStatus(res.mensagem, 'err');
    }
    return res;
  }

  async function reabrirRotaSalvaCampo(idCliente, opcoes = {}) {
    const reg = await campoWeb.obterRota(idCliente);
    if (!reg) return;
    if (reg.tipoRota === 'GPS') {
      if (reg.simulado) return;
      state.idRotaGpsAtual = reg.idCliente;
      gpsTrailSource.clear();
      if (reg.geometry) {
        const feat = toOlFeature({
          type: 'Feature',
          properties: { idCliente: reg.idCliente, tipoRota: 'GPS' },
          geometry: reg.geometry,
        });
        gpsTrailSource.addFeature(feat);
        const ext = feat.getGeometry().getExtent();
        if (!isEmpty(ext)) {
          map.getView().fit(ext, { padding: [70, 70, 70, 70], duration: 450, maxZoom: 18 });
        }
      }
      let temOrigem = false;
      if (reg.idRotaOrigemCliente) {
        const orig = await campoWeb.obterRota(reg.idRotaOrigemCliente);
        if (orig && orig.geometry) {
          temOrigem = true;
          await reabrirRotaSalvaCampo(orig.idCliente, { preservarGps: true });
          state.idRotaGpsAtual = reg.idCliente;
          // reaplica a trilha GPS sobre a rota original sem substituí-la
          if (reg.geometry) {
            gpsTrailSource.clear();
            gpsTrailSource.addFeature(toOlFeature({
              type: 'Feature',
              properties: { idCliente: reg.idCliente, tipoRota: 'GPS' },
              geometry: reg.geometry,
            }));
          }
        }
      }
      if (!temOrigem) {
        state.rotaAtual = null;
        state.rotaPlanejadaOriginal = null;
        routeSource.clear();
        altRouteSource.clear();
        limparFeedbackGpx();
        limparFeedbackSaveOffline();
        if (els.resultBlock) els.resultBlock.hidden = false;
        const d = formatDistance(reg.distanciaMetros || 0);
        if (els.distanceValue) {
          els.distanceValue.className = 'distance__value';
          els.distanceValue.textContent = d.v;
        }
        if (els.distanceUnit) els.distanceUnit.textContent = d.u;
        if (els.routeNote) {
          els.routeNote.hidden = false;
          els.routeNote.textContent =
            'Trajeto GPS real registrado (sem rota calculada vinculada).';
        }
        if (els.legs) els.legs.innerHTML = '';
        if (els.streets) els.streets.innerHTML = '';
        if (els.streetsCount) els.streetsCount.textContent = '0';
        atualizarLegenda([]);
        if (els.startNav) els.startNav.hidden = true;
        if (els.saveRouteOffline) els.saveRouteOffline.hidden = true;
        if (els.addRouteObs) els.addRouteObs.hidden = false;
        if (els.exportGpx) els.exportGpx.hidden = !reg.geometry;
        campoWeb.definirRotaCalculadaAtiva(reg);
      }
      await renderizarObservacoesDaRotaCampo(reg.idCliente);
      setStatus('Execução GPS restaurada do armazenamento local (' + reg.status + ').', 'ok');
      return;
    }

    // Rota CALCULADA: restaura pontos do circuito e desenha offline
    if (Array.isArray(reg.pontosJson) && reg.pontosJson.length >= 2) {
      const novaLista = criarListaCircuito();
      novaLista.pontos = reg.pontosJson.map((p, idx) => ({
        id: 'rest-' + idx + '-' + reg.idCliente.slice(0, 6),
        tipo: idx === 0 ? TIPOS.ORIGEM : TIPOS.PARADA,
        rotulo: p.rotulo || String.fromCharCode(65 + idx),
        enderecoDigital: p.enderecoDigital || '',
        codigoCompleto: p.codigoCompleto || '',
        latitude: p.latitude,
        longitude: p.longitude,
        origem: p.enderecoDigital ? 'codigo' : 'coordenada',
        status: p.latitude != null ? STATUS.CONVERTIDO : STATUS.VAZIO,
        mensagem: 'Restaurado do armazenamento offline.',
      }));
      rotularPontos(novaLista);
      state.lista = novaLista;
      state.modo = reg.modoCalculo || 'usuario';
      renderizarPontos();
    }

    if (!opcoes.preservarGps) {
      gpsTrailSource.clear();
      state.idRotaGpsAtual = null;
      try {
        const execsGps = await campoWeb.listarRotasSalvas({
          tipoRota: 'GPS',
          incluirSimuladas: false,
          limit: 40,
        });
        const vinculada = execsGps.find(
          (g) => !g.simulado && g.idRotaOrigemCliente === reg.idCliente && g.geometry,
        );
        if (vinculada) {
          state.idRotaGpsAtual = vinculada.idCliente;
          gpsTrailSource.addFeature(toOlFeature({
            type: 'Feature',
            properties: { idCliente: vinculada.idCliente, tipoRota: 'GPS' },
            geometry: vinculada.geometry,
          }));
        }
      } catch {
        /* segue apenas com rota calculada */
      }
    }

    campoWeb.definirRotaCalculadaAtiva(reg);
    const reconstruida = campoWeb.reconstruirRespostaRotaDeRegistro(reg);
    if (reconstruida) {
      showRoute(reconstruida, { naoSalvarLocal: true, preservarGps: true });
      setStatus('Rota salva aberta offline (' + (reg.titulo || reg.idCliente) + ').', 'ok');
    }
    await renderizarObservacoesDaRotaCampo(reg.idCliente);
  }

  async function renderizarObservacoesDaRotaCampo(idRotaCliente) {
    routeObsSource.clear();
    if (!els.routeCampoObs) return;
    if (!idRotaCliente) {
      els.routeCampoObs.hidden = true;
      els.routeCampoObs.innerHTML = '';
      return;
    }
    const lista = await campoWeb.listarObservacoes({
      idRotaCliente,
      incluirSimuladas: false,
      incluirEventos: true,
    });
    for (const obs of lista) {
      routeObsSource.addFeature(
        new ol.Feature({
          geometry: new ol.geom.Point(ol.proj.fromLonLat([obs.longitude, obs.latitude])),
          idCliente: obs.idCliente,
          status: obs.status,
        }),
      );
    }

    if (!lista.length) {
      els.routeCampoObs.hidden = false;
      els.routeCampoObs.innerHTML = '<div class="campo-vazio">Nenhuma observação registrada para esta rota.</div>';
      return;
    }

    els.routeCampoObs.hidden = false;
    els.routeCampoObs.innerHTML =
      '<div class="route-occ__titulo">Observações da rota (' + lista.length + ')</div>' +
      lista.map((obs) => {
        const tipoLbl = campoWeb.rotuloTipoObservacao(obs.tipoObservacao);
        const stLbl = campoWeb.rotuloStatusObservacaoCampo(obs.status);
        const syncLbl = campoWeb.rotuloSyncStatus(obs.syncStatus);
        const proxStatus = obs.status === 'CONCLUIDA' ? 'REABERTA' : 'CONCLUIDA';
        const proxRotulo = obs.status === 'CONCLUIDA' ? 'Reabrir' : 'Concluir';
        const eventosHtml = Array.isArray(obs.eventos) && obs.eventos.length
          ? '<details class="route-campo-obs__hist"><summary>Histórico (' + obs.eventos.length + ')</summary>' +
            obs.eventos.map((e) =>
              '<div>' + escapeHtml(e.tipoEvento) + ' · ' + escapeHtml(formatarDataHoraPtBr(e.dataEvento)) + '</div>',
            ).join('') +
            '</details>'
          : '';
        return (
          '<div class="route-campo-obs__item" data-obs-cliente="' + escapeHtml(obs.idCliente) + '">' +
          '<div class="route-campo-obs__head">' +
          '<b>' + escapeHtml(tipoLbl) + '</b>' +
          '<span><span class="campo-badge">' + escapeHtml(stLbl) + '</span> ' +
          '<span class="campo-badge ' + classeBadgeSync(obs.syncStatus) + '">' + escapeHtml(syncLbl) + '</span></span>' +
          '</div>' +
          '<p class="route-campo-obs__desc">' + escapeHtml(obs.descricao) + '</p>' +
          (obs.syncErro ? '<div class="saved-route-item__meta" style="color:#991b1b">' + escapeHtml(obs.syncErro) + '</div>' : '') +
          '<div class="route-campo-obs__acoes">' +
          '<button type="button" class="mini" data-obs-acao="editar">Editar</button>' +
          '<button type="button" class="mini" data-obs-acao="status" data-novo-status="' + proxStatus + '">' + proxRotulo + '</button>' +
          '<button type="button" class="mini mini--danger" data-obs-acao="excluir">Excluir</button>' +
          '</div>' +
          eventosHtml +
          '</div>'
        );
      }).join('');
  }

  async function atualizarObservacoesDaRotaAtiva() {
    const alvo = campoWeb.obterRotaParaObservacao();
    await renderizarObservacoesDaRotaCampo(alvo?.idCliente || null);
  }

  function preencherTiposObservacaoModal(selecionado = 'VISITA_REALIZADA') {
    if (!els.campoObsTipo) return;
    els.campoObsTipo.innerHTML = TIPO_OBSERVACAO_CATALOGO.map((t) =>
      '<option value="' + t.id + '"' + (t.id === selecionado ? ' selected' : '') + '>' +
      escapeHtml(t.rotulo) + '</option>',
    ).join('');
  }

  function abrirModalCampoObs({ idClienteEdicao = null, latitude = null, longitude = null, idRotaCliente = null, descricao = '', tipoObservacao = 'VISITA_REALIZADA' } = {}) {
    const rotaAtiva = idRotaCliente ? { idCliente: idRotaCliente } : campoWeb.obterRotaParaObservacao();
    if (!rotaAtiva) {
      setStatus('Salve a rota usando "Salvar rotas offline" ou abra uma rota salva antes de registrar observações.', 'err');
      return;
    }
    let lat = latitude;
    let lon = longitude;
    if (lat == null || lon == null) {
      const posNav = navUI?.estado?.controlador?.posicao;
      if (posNav && posNav.latitude != null) {
        lat = posNav.latitude;
        lon = posNav.longitude;
      } else {
        const p0 = state.lista.pontos.find((p) => p.latitude != null && p.longitude != null);
        if (p0) {
          lat = p0.latitude;
          lon = p0.longitude;
        } else {
          const c = ol.proj.toLonLat(map.getView().getCenter());
          lon = c[0];
          lat = c[1];
        }
      }
    }
    state.rascunhoCampoObs = {
      idClienteEdicao,
      idRotaCliente: rotaAtiva.idCliente,
      latitude: Number(lat),
      longitude: Number(lon),
    };
    if (els.campoObsModalTitulo) {
      els.campoObsModalTitulo.textContent = idClienteEdicao ? 'Editar observação da rota' : 'Nova observação da rota';
    }
    if (els.campoObsRotaLabel) {
      els.campoObsRotaLabel.textContent = 'Vínculo: ' + (campoWeb.execucaoGpsAtiva && !campoWeb.execucaoGpsAtiva.simulado ? 'Rota GPS em execução' : 'Rota calculada');
    }
    if (els.campoObsCoordLabel) {
      els.campoObsCoordLabel.textContent = 'Ponto: ' + Number(lat).toFixed(5) + ', ' + Number(lon).toFixed(5);
    }
    preencherTiposObservacaoModal(tipoObservacao);
    if (els.campoObsDesc) els.campoObsDesc.value = descricao || '';
    if (els.campoObsErro) {
      els.campoObsErro.hidden = true;
      els.campoObsErro.textContent = '';
    }
    if (els.campoObsModal) els.campoObsModal.hidden = false;
  }

  function fecharModalCampoObs() {
    state.rascunhoCampoObs = null;
    if (els.campoObsModal) els.campoObsModal.hidden = true;
  }

  async function verificarRecuperacaoGpsCampo() {
    if (!els.campoGpsRecovery) return;
    const pendentes = await campoWeb.listarExecucoesGpsEmAndamento({ incluirSimuladas: false });
    if (!pendentes.length) {
      els.campoGpsRecovery.hidden = true;
      return;
    }
    const alvo = pendentes[0];
    els.campoGpsRecovery.dataset.rotaCliente = alvo.idCliente;
    if (els.campoGpsRecoveryTxt) {
      els.campoGpsRecoveryTxt.textContent =
        'Execução GPS anterior encontrada (' + (alvo.totalPontos || 0) + ' pontos capturados). Deseja salvar a trilha capturada?';
    }
    els.campoGpsRecovery.hidden = false;
  }

  const campoWeb = criarServicoCampoWeb({
    obterUsuarioId: () => state.usuarioId,
    aoMudarSync: atualizarIndicadorSyncCampo,
    aoMudar: () => {
      void renderizarRotasSalvasCampo();
    },
  });

  if (els.campoSyncRetry) {
    els.campoSyncRetry.addEventListener('click', () => {
      setStatus('Tentando sincronizar registros pendentes…', 'busy');
      void campoWeb.sincronizarAgora().then((r) => {
        if (r?.ok) setStatus('Sincronização concluída.', 'ok');
        else if (r?.message) setStatus(r.message, 'err');
      });
    });
  }

  if (els.campoGpsFinalizar) {
    els.campoGpsFinalizar.addEventListener('click', () => {
      const id = els.campoGpsRecovery?.dataset?.rotaCliente;
      if (!id) return;
      void campoWeb.recuperarExecucaoPendente(id, 'finalizar').then((res) => {
        if (els.campoGpsRecovery) els.campoGpsRecovery.hidden = true;
        if (res?.rota?.geometry && !res.rota.simulado) {
          state.idRotaGpsAtual = res.rota.idCliente;
          void reabrirRotaSalvaCampo(res.rota.idCliente);
        }
        setStatus('Trilha GPS recuperada e salva localmente.', 'ok');
      });
    });
  }

  if (els.campoGpsDescartar) {
    els.campoGpsDescartar.addEventListener('click', () => {
      const id = els.campoGpsRecovery?.dataset?.rotaCliente;
      if (!id) return;
      void campoWeb.recuperarExecucaoPendente(id, 'descartar').then(() => {
        if (els.campoGpsRecovery) els.campoGpsRecovery.hidden = true;
      });
    });
  }

  if (els.campoRotasLista) {
    els.campoRotasLista.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-acao-rota]');
      const card = ev.target.closest('[data-rota-id]');
      if (!btn || !card) return;
      const id = card.dataset.rotaId;
      if (btn.dataset.acaoRota === 'abrir') {
        void reabrirRotaSalvaCampo(id);
      } else if (btn.dataset.acaoRota === 'gpx') {
        void exportarRotaSalvaCampo(id);
      } else if (btn.dataset.acaoRota === 'obs') {
        void reabrirRotaSalvaCampo(id).then(() => {
          if (els.routeCampoObs) els.routeCampoObs.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        });
      } else if (btn.dataset.acaoRota === 'excluir') {
        if (navUI?.estado?.ativo && campoWeb.execucaoGpsAtiva?.idCliente === id) {
          setStatus('Encerre a navegação em andamento antes de excluir esta rota.', 'err');
          return;
        }
        const reg = await campoWeb.obterRota(id);
        if (!reg) return;
        const titulo = reg.titulo || (reg.tipoRota === 'GPS' ? 'Execução GPS' : 'Rota calculada');
        const confirmado = await pedirConfirmacaoCampo({
          titulo: 'Excluir rota salva',
          mensagem: `Deseja excluir localmente a rota "${titulo}"?`,
          itens: [
            'A rota salva será removida do armazenamento local do dispositivo.',
            'Observações, eventos e pontos GPS vinculados exclusivamente a esta rota também serão excluídos localmente.',
            'Outras rotas salvas, preferências do aplicativo e dados já sincronizados no servidor não serão afetados.',
          ],
          alerta: 'Esta exclusão local não pode ser desfeita neste dispositivo.',
          rotuloConfirmar: 'Excluir rota',
        });
        if (!confirmado) return;
        try {
          const estavaAtivaCalc = campoWeb.rotaCalculadaAtiva?.idCliente === id;
          const estavaAtivaGps = state.idRotaGpsAtual === id;
          await campoWeb.excluirRotaSalva(id);
          if (estavaAtivaGps) {
            state.idRotaGpsAtual = null;
            gpsTrailSource.clear();
          }
          if (estavaAtivaCalc) {
            if (state.rotaAtual?.idCliente === id) delete state.rotaAtual.idCliente;
            if (state.rotaPlanejadaOriginal?.rota?.idCliente === id) {
              delete state.rotaPlanejadaOriginal.rota.idCliente;
            }
          }
          await renderizarRotasSalvasCampo();
          await atualizarObservacoesDaRotaAtiva();
          setStatus('Rota salva excluída do dispositivo.', 'ok');
        } catch (err) {
          setStatus(err?.message || 'Não foi possível excluir a rota salva.', 'err');
        }
      }
    });
  }

  if (els.campoLimparDadosLocais) {
    els.campoLimparDadosLocais.addEventListener('click', async () => {
      const navAtiva = !!(navUI?.estado?.ativo);
      if (navAtiva) {
        const prosseguirNav = await pedirConfirmacaoCampo({
          titulo: 'Navegação em andamento',
          mensagem: 'Existe uma navegação em andamento neste momento. Limpar os dados locais agora irá interromper e descartar a navegação atual.',
          alerta: 'Confirme primeiro se deseja interromper a navegação em andamento para prosseguir com a limpeza local.',
          rotuloConfirmar: 'Interromper navegação e continuar',
        });
        if (!prosseguirNav) return;
      }

      const confirmado = await pedirConfirmacaoCampo({
        titulo: 'Limpar dados locais',
        mensagem: 'Esta ação removerá permanentemente do armazenamento local deste dispositivo:',
        itens: [
          'Todas as rotas salvas offline;',
          'Todos os percursos GPS gravados e pontos de trilha locais;',
          'Todas as observações de campo e históricos locais;',
          'Todas as ocorrências locais (cache offline, alertas e marcadores na tela);',
          'Registros temporários e fila pendente de sincronização local.',
        ],
        alerta:
          'Ação irreversível nos dados locais deste dispositivo. Suas preferências do trajeto, configurações, identificação e dados já existentes no servidor remoto serão preservados.',
        rotuloConfirmar: 'Limpar dados locais',
      });
      if (!confirmado) return;

      try {
        if (navAtiva && navUI) {
          navUI.aoCalcularRota();
        }
        await campoWeb.limparDadosLocais({ forcarInterrupcaoNavegacao: true });
        clienteRede.limparOcorrenciasLocais?.();
        routeSource.clear();
        gpsTrailSource.clear();
        routeObsSource.clear();
        altRouteSource.clear();
        occSegmentHighlightSource.clear();
        pontosTrilhaAoVivo = [];
        state.rotaAtual = null;
        state.rotaPlanejadaOriginal = null;
        state.idRotaGpsAtual = null;
        state.rotasDisponiveis = [];
        state.rotaSelecionadaId = null;
        state.comparacaoAlternativas = null;
        state.ocorrencias = [];
        stopPickingOccurrence();
        fecharModalRegistroOcorrencia();
        fecharDetalheOcorrencia();
        renderizarOcorrenciasMapa();
        limparFeedbackGpx();
        limparFeedbackSaveOffline();
        if (els.exportGpx) els.exportGpx.hidden = true;
        if (els.saveRouteOffline) els.saveRouteOffline.hidden = true;
        if (els.addRouteObs) els.addRouteObs.hidden = true;
        if (els.startNav) els.startNav.hidden = true;
        if (els.legendAlt) els.legendAlt.hidden = true;
        if (els.routeAlternatives) {
          els.routeAlternatives.hidden = true;
          els.routeAlternatives.innerHTML = '';
        }
        if (els.routeOccurrences) {
          els.routeOccurrences.hidden = true;
          els.routeOccurrences.innerHTML = '';
        }
        if (els.routeCampoObs) {
          els.routeCampoObs.hidden = true;
          els.routeCampoObs.innerHTML = '';
        }
        if (els.campoGpsRecovery) els.campoGpsRecovery.hidden = true;
        if (els.resultBlock) els.resultBlock.hidden = true;
        atualizarLegenda([]);
        await renderizarRotasSalvasCampo();
        setStatus('Dados locais limpos (preferências e configurações preservadas).', 'ok');
      } catch (err) {
        setStatus(err?.message || 'Não foi possível limpar os dados locais.', 'err');
      }
    });
  }

  if (els.saveRouteOffline) {
    els.saveRouteOffline.addEventListener('click', async () => {
      const rotaCalc =
        state.rotaAtual && state.rotaAtual.ok !== false && !state.rotaAtual.parcial
          ? state.rotaAtual
          : null;
      const rotaOrig =
        state.rotaPlanejadaOriginal?.rota &&
        state.rotaPlanejadaOriginal.rota.ok !== false &&
        !state.rotaPlanejadaOriginal.rota.parcial
          ? state.rotaPlanejadaOriginal.rota
          : null;
      const temGpsSessao = !!campoWeb.obterUltimaExecucaoGpsSessao();
      if (!rotaCalc && !rotaOrig && !temGpsSessao) return;

      els.saveRouteOffline.disabled = true;
      limparFeedbackSaveOffline();
      try {
        const pontos =
          state.rotaPlanejadaOriginal?.pontos?.length
            ? state.rotaPlanejadaOriginal.pontos
            : state.lista.pontos;
        const res = await campoWeb.salvarRotasOffline({
          rotaCalculada: rotaCalc,
          rotaCalculadaOriginal: rotaOrig,
          pontos,
          modo: state.modo,
          circular: state.circuito,
        });
        if (res?.rotaCalculada) {
          if (state.rotaAtual) state.rotaAtual.idCliente = res.rotaCalculada.idCliente;
          if (state.rotaPlanejadaOriginal?.rota) {
            state.rotaPlanejadaOriginal.rota.idCliente = res.rotaCalculada.idCliente;
          }
        }
        if (res?.rotaGps) {
          state.idRotaGpsAtual = res.rotaGps.idCliente;
        }
        await renderizarRotasSalvasCampo();
        await atualizarObservacoesDaRotaAtiva();
        const msg = res?.jaExistia
          ? 'As rotas atuais já estão salvas offline no dispositivo (nenhuma duplicação criada).'
          : res?.rotaCalculada && res?.rotaGps
            ? 'Rota calculada e trajeto GPS salvos no dispositivo para uso offline.'
            : 'Rota salva no dispositivo (disponível offline).';
        mostrarFeedbackSaveOffline(msg, 'ok');
        setStatus(msg, 'ok');
      } catch (err) {
        const msg = err?.message || 'Não foi possível salvar as rotas offline.';
        mostrarFeedbackSaveOffline(msg, 'err');
        setStatus(msg, 'err');
      } finally {
        els.saveRouteOffline.disabled = false;
      }
    });
  }

  if (els.addRouteObs) {
    els.addRouteObs.addEventListener('click', () => startPickingRouteObs());
  }

  if (els.navAddObs) {
    els.navAddObs.addEventListener('click', () => {
      const pos = navUI?.estado?.controlador?.posicao;
      if (pos && pos.latitude != null) {
        abrirModalCampoObs({ latitude: pos.latitude, longitude: pos.longitude });
      } else {
        startPickingRouteObs();
      }
    });
  }

  if (els.campoObsFechar) els.campoObsFechar.addEventListener('click', fecharModalCampoObs);
  if (els.campoObsCancelar) els.campoObsCancelar.addEventListener('click', fecharModalCampoObs);

  if (els.campoObsForm) {
    els.campoObsForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const rasc = state.rascunhoCampoObs;
      if (!rasc) return;
      const tipoObservacao = els.campoObsTipo ? els.campoObsTipo.value : 'VISITA_REALIZADA';
      const descricao = els.campoObsDesc ? els.campoObsDesc.value : '';
      try {
        if (rasc.idClienteEdicao) {
          await campoWeb.editarObservacao({
            idCliente: rasc.idClienteEdicao,
            tipoObservacao,
            descricao,
          });
          setStatus('Observação atualizada localmente.', 'ok');
        } else {
          await campoWeb.criarObservacao({
            idRotaCliente: rasc.idRotaCliente,
            latitude: rasc.latitude,
            longitude: rasc.longitude,
            tipoObservacao,
            descricao,
          });
          setStatus('Observação salva no dispositivo e vinculada à rota.', 'ok');
        }
        fecharModalCampoObs();
        await renderizarObservacoesDaRotaCampo(rasc.idRotaCliente);
      } catch (err) {
        if (els.campoObsErro) {
          els.campoObsErro.hidden = false;
          els.campoObsErro.textContent = err.message || 'Erro ao salvar observação.';
        }
      }
    });
  }

  if (els.routeCampoObs) {
    els.routeCampoObs.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-obs-acao]');
      const card = ev.target.closest('[data-obs-cliente]');
      if (!btn || !card) return;
      const idCliente = card.dataset.obsCliente;
      const obs = await campoWeb.repositorio.driver.getObservacao(idCliente);
      if (!obs) return;

      if (btn.dataset.obsAcao === 'editar') {
        abrirModalCampoObs({
          idClienteEdicao: obs.idCliente,
          idRotaCliente: obs.idRotaCliente,
          latitude: obs.latitude,
          longitude: obs.longitude,
          descricao: obs.descricao,
          tipoObservacao: obs.tipoObservacao,
        });
      } else if (btn.dataset.obsAcao === 'status') {
        const novoStatus = btn.dataset.novoStatus;
        await campoWeb.alterarStatusObservacao({ idCliente: obs.idCliente, novoStatus });
        await renderizarObservacoesDaRotaCampo(obs.idRotaCliente);
        setStatus('Status da observação atualizado no dispositivo.', 'ok');
      } else if (btn.dataset.obsAcao === 'excluir') {
        const tipoLbl = campoWeb.rotuloTipoObservacao(obs.tipoObservacao);
        const confirmado = await pedirConfirmacaoCampo({
          titulo: 'Excluir observação',
          mensagem: `Deseja excluir localmente a observação "${tipoLbl}" (${obs.descricao || ''})?`,
          alerta: 'A observação e seu histórico local serão removidos sem afetar a rota nem outras observações.',
          rotuloConfirmar: 'Excluir observação',
        });
        if (!confirmado) return;
        try {
          await campoWeb.excluirObservacao(obs.idCliente);
          await renderizarObservacoesDaRotaCampo(obs.idRotaCliente);
          setStatus('Observação excluída do dispositivo.', 'ok');
        } catch (err) {
          setStatus(err?.message || 'Não foi possível excluir a observação.', 'err');
        }
      }
    });
  }

  /* ─────────────── Arranque ─────────────── */

  // exposto para automação e depuração no console do navegador
  // versão do front-end (ajuda a identificar cache antigo no navegador)
  window.__appVersion = '20261117-5';
  window.__app = {
    map,
    state,
    osmLayer,
    satLayer,
    axisSource,
    axisCasingSource,
    routeSource,
    gpsTrailSource,
    routeObsSource,
    altRouteSource,
    occSource,
    occClusterSource,
    occSegmentHighlightSource,
    markerSource,
    campo: campoWeb,
    // ganchos usados pela interface de navegação ativa
    showRoute,
    desenharRota,
    atualizarLegenda,
    definirEstadoTrechos,
    setStatus,
    renderizarPontos,
    ajustarEnquadramento,
    definirCamadaBase,
    selecionarRotaAlternativa,
    loadOcorrencias,
        fetchApi: fetch,
        clienteRede,
        aoIniciarNavegacaoCampo: async (rota, opts) => {
          pontosTrilhaAoVivo = [];
          gpsTrailSource.clear();
          if (!state.rotaPlanejadaOriginal && rota && rota.ok !== false && !rota.parcial) {
            state.rotaPlanejadaOriginal = {
              rota,
              pontos: state.lista.pontos.map((p) => ({ ...p })),
            };
          }
          if (opts?.modo !== 'simulacao') {
            state.idRotaGpsAtual = null;
          }
          const rotaPlano = state.rotaPlanejadaOriginal?.rota || rota;
          const exec = await campoWeb.iniciarNavegacaoGps(rotaPlano, opts);
          if (opts?.modo !== 'simulacao' && exec?.idCliente) {
            state.idRotaGpsAtual = exec.idCliente;
          }
          return exec;
        },
        aoPontoGpsNavegacaoCampo: async (p) => {
          const res = await campoWeb.registrarPontoGps(p);
          if (res?.aceito && res?.ponto && !res.ponto.simulado) {
            if (!pontosTrilhaAoVivo.length || res.novoSegmento) {
              pontosTrilhaAoVivo.push([]);
            }
            pontosTrilhaAoVivo[pontosTrilhaAoVivo.length - 1].push([
              res.ponto.longitude,
              res.ponto.latitude,
            ]);
            const validos = pontosTrilhaAoVivo.filter((seg) => seg.length >= 2);
            if (validos.length === 1) {
              gpsTrailSource.clear();
              gpsTrailSource.addFeature(toOlFeature({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: validos[0] },
              }));
            } else if (validos.length > 1) {
              gpsTrailSource.clear();
              gpsTrailSource.addFeature(toOlFeature({
                type: 'Feature',
                geometry: { type: 'MultiLineString', coordinates: validos },
              }));
            }
          }
          return res;
        },
        aoPausarNavegacaoCampo: () => campoWeb.pausarNavegacaoGps(),
        aoRetomarNavegacaoCampo: () => campoWeb.retomarNavegacaoGps(),
        aoEncerrarNavegacaoCampo: async (opts) => {
          const res = await campoWeb.finalizarNavegacaoGps(opts);
          if (res?.rota && !res.rota.simulado) {
            if (res.rota.geometry) {
              state.idRotaGpsAtual = res.rota.idCliente;
            } else if (state.idRotaGpsAtual === res.rota.idCliente) {
              state.idRotaGpsAtual = null;
            }
          }
          const temCalc = !!(state.rotaPlanejadaOriginal?.rota || (state.rotaAtual?.ok !== false && !state.rotaAtual?.parcial));
          const temGps = !!(state.idRotaGpsAtual && res?.rota?.geometry && !res.rota.simulado);
          if (temGps && !temCalc && (!state.rotaAtual || els.resultBlock?.hidden)) {
            if (els.resultBlock) els.resultBlock.hidden = false;
            const d = formatDistance(res.rota.distanciaMetros || 0);
            if (els.distanceValue) {
              els.distanceValue.className = 'distance__value';
              els.distanceValue.textContent = d.v;
            }
            if (els.distanceUnit) els.distanceUnit.textContent = d.u;
            if (els.routeNote) {
              els.routeNote.hidden = false;
              els.routeNote.textContent =
                'Trajeto GPS real registrado (sem rota calculada vinculada).';
            }
            if (els.legs) els.legs.innerHTML = '';
            if (els.streets) els.streets.innerHTML = '';
            if (els.streetsCount) els.streetsCount.textContent = '0';
            atualizarLegenda([]);
            if (els.startNav) els.startNav.hidden = true;
            if (els.addRouteObs) els.addRouteObs.hidden = true;
          }
          if (els.exportGpx) {
            els.exportGpx.hidden = !(temCalc || state.idRotaGpsAtual);
          }
          if (els.saveRouteOffline) {
            els.saveRouteOffline.hidden = !(temCalc || temGps || campoWeb.obterUltimaExecucaoGpsSessao());
          }
          await atualizarObservacoesDaRotaAtiva();
          return res;
        },
        exportarRotaSalvaCampo,
        exportarGpx,
      };
  // a rota atual é lida sempre do estado (nunca fica desatualizada)
  Object.defineProperty(window.__app, 'rotaAtual', {
    get: () => state.rotaAtual && assinaturaRota === assinaturaPlanejador(state) ? state.rotaAtual : null,
  });

  // Interface de navegação ativa (GPS real + modo de teste). É criada
  // depois de `window.__app` existir, porque ela usa o mapa e os ganchos.
  const navUI = criarInterfaceNavegacao(window.__app);
  window.__app.nav = navUI;

  // Service Worker: apenas quando a aplicação roda diretamente na raiz (PWA Node);
  // dentro de <iframe> ou em subpasta estática (/public/) do WebForms/IIS, o SW
  // na raiz não existe nem deve assumir o escopo do portal pai.
  const emIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  const naRaiz = !/\/public(?:\/|$)/i.test(window.location?.pathname || '/');
  if ('serviceWorker' in navigator && window.isSecureContext !== false && !emIframe && naRaiz) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((e) => console.warn('Service Worker não registrado:', e.message));
    });
  }

  inicializarPontos();
  inicializarPreferenciasUI();
  atualizarLegenda();
  setStatus('Carregando a rede viária…', 'busy');
  void campoWeb.inicializar().then(async () => {
    await renderizarRotasSalvasCampo();
    await verificarRecuperacaoGpsCampo();
    if (navigator.onLine !== false) void campoWeb.sincronizarPendentes();
  });
  window.addEventListener('online', () => { void campoWeb.sincronizarPendentes(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) {
      void campoWeb.sincronizarPendentes();
    }
  });
  loadNetwork();
})();
