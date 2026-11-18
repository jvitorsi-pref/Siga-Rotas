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

  // a casca fica ABAIXO do núcleo da rede, e ambos abaixo da rota
  map.addLayer(axisCasingLayer);
  map.addLayer(axisLayer);
  map.addLayer(routeLayer);
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
    els.pickBanner.hidden = true;
    els.map.classList.remove('map--picking');
    document.querySelectorAll('.pick').forEach((b) => b.classList.remove('active'));
  }

  els.pickCancel.addEventListener('click', stopPicking);

  map.on('click', (evt) => {
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

  // clique em um TRECHO da rota: oculta (ou torna visível de novo). É a
  // solução para as sobreposições — quando dois trechos passam pelo mesmo
  // caminho, basta ocultar um deles para ver o outro.
  map.on('click', (evt) => {
    if (state.picking) return; // o clique está definindo um ponto
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
    if (!state.picking) {
      // cursor de "clique" quando o ponteiro está sobre um trecho
      let sobreTrecho = false;
      if (state.trechos.length) {
        sobreTrecho = map.hasFeatureAtPixel(evt.pixel, {
          layerFilter: (l) => l === routeLayer,
          hitTolerance: 5,
        });
      }
      map.getTargetElement().style.cursor = sobreTrecho ? 'pointer' : '';
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
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const ct = res.headers?.get?.('content-type') || '';
      let data;
      if (typeof res.text === 'function' && ct && !/json/i.test(ct)) {
        const bruto = await res.text();
        try {
          data = JSON.parse(bruto);
        } catch {
          const titulo = bruto.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
          throw new Error(
            'A URL ' +
              (res.url || '/api/network') +
              ' respondeu ' +
              ct +
              (titulo ? ' ("' + titulo + '")' : '') +
              ' em vez de JSON.',
          );
        }
      } else {
        data = await res.json();
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
      const origem = meta.source === 'wfs' ? 'GeoServer (WFS)' : 'snapshot local';
      const quando = upd.lastCheckedAt
        ? new Date(upd.lastCheckedAt).toLocaleTimeString('pt-BR')
        : 'pendente';
      const warnings = meta.warnings || [];
      // o painel não mostra mais as estatísticas da rede (o bloco foi
      // removido a pedido do usuário); o que importa continua visível no
      // rodapé de status: a origem dos dados, a última verificação e
      // qualquer aviso (rede desatualizada, WFS fora do ar…)
      loadDiagnostics();
      setStatus(
        'Rede pronta (' +
          features.length.toLocaleString('pt-BR') +
          ' eixos, ' +
          origem +
          ', verificada às ' +
          quando +
          ').' +
          (warnings.length ? ' Atenção: ' + warnings[0] : ''),
        warnings.length ? 'err' : 'ok',
      );
    } catch (err) {
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

  /* ─────────────── Endereço Digital ─────────────── */

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

    const pontos = state.lista.pontos.map((p) => ({
      rotulo: p.rotulo,
      latitude: p.latitude,
      longitude: p.longitude,
      enderecoDigital: p.enderecoDigital || null,
    }));

    try {
      const res = await fetch('/api/rota-paradas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pontos,
          ...opcoesCalculoCircuito(modo),
        }),
      });
      const data = await res.json();
      if (revisao !== revisaoCalculo || assinaturaPlanejador(state) !== assinatura) return;

      if (!data.ok) {
        showError(reasonTitle(data.reason), data.message || 'Não foi possível calcular a rota.');
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

      showRoute(data);
      const d = formatDistance(data.distance);
      setStatus('Rota calculada: ' + d.v + ' ' + d.u + '.', 'ok');
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
      case 'PONTOS_INSUFICIENTES': return 'Pontos insuficientes';
      case 'PONTO_SEM_COORDENADA': return 'Endereço sem resolver';
      case 'REDE_VAZIA': return 'Rede viária indisponível';
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

  async function exportarGpx() {
    const rotaValida =
      state.rotaAtual &&
      assinaturaRota === assinaturaPlanejador(state) &&
      state.rotaAtual.ok !== false &&
      !state.rotaAtual.parcial;
    if (!rotaValida) {
      const msg = 'Calcule uma rota completa antes de exportar em GPX.';
      mostrarFeedbackGpx(msg, 'err');
      setStatus(msg, 'err');
      return { ok: false, motivo: 'SEM_ROTA', mensagem: msg };
    }

    if (els.exportGpx) els.exportGpx.disabled = true;
    limparFeedbackGpx();
    setStatus('Preparando exportação GPX…', 'busy');
    try {
      const res = await exportarRotaGpxWeb(state.rotaAtual, { pontos: state.lista.pontos });
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

  function showError(title, message) {
    state.rotaAtual = null;
    limparFeedbackGpx();
    if (els.exportGpx) els.exportGpx.hidden = true;
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
    assinaturaRota = assinaturaPlanejador(state);
    limparFeedbackGpx();
    if (els.exportGpx) els.exportGpx.hidden = !!(data.ok === false || data.parcial);
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
    limparFeedbackGpx();
    if (els.exportGpx) els.exportGpx.hidden = true;
    routeSource.clear();
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
    limparFeedbackGpx();
    if (els.exportGpx) els.exportGpx.hidden = true;
    if (els.startNav) els.startNav.hidden = true;
    els.resultBlock.hidden = true;
    const alert = document.getElementById('route-alert');
    if (alert) alert.remove();
    routeSource.clear();
    setStatus('Pronto', 'idle');
  });

  /* ─────────────── Arranque ─────────────── */

  // exposto para automação e depuração no console do navegador
  // versão do front-end (ajuda a identificar cache antigo no navegador)
  window.__appVersion = '20261117-4';
  window.__app = {
    map,
    state,
    osmLayer,
    satLayer,
    axisSource,
    axisCasingSource,
    routeSource,
    markerSource,
    // ganchos usados pela interface de navegação ativa
    showRoute,
    desenharRota,
    atualizarLegenda,
    definirEstadoTrechos,
    setStatus,
    renderizarPontos,
    ajustarEnquadramento,
    definirCamadaBase,
    fetchApi: fetch,
    clienteRede,
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
  atualizarLegenda();
  setStatus('Carregando a rede viária…', 'busy');
  loadNetwork();
})();
