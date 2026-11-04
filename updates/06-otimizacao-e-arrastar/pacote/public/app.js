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
  criarListaPontos,
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

(function () {
  'use strict';

  const ol = window.ol;

  /* ─────────────── Estado ─────────────── */

  const state = {
    picking: null, // id do ponto que está sendo selecionado no mapa
    networkLoaded: false,
    lastRoute: null,
    // lista de pontos do trajeto (origem, paradas, destino)
    lista: criarListaPontos(),
    // modo da rota: 'otimizada' (menor rota) | 'usuario' (ordem definida)
    modo: 'otimizada',
    // id do ponto que está sendo arrastado no painel (reordenação)
    arrastandoId: null,
  };

  const $ = (sel) => document.querySelector(sel);

  const els = {
    points: $('#points'),
    modes: $('#modes'),
    addStop: $('#add-stop'),
    dragHint: $('#drag-hint'),
    calc: $('#calc'),
    swap: $('#swap'),
    clear: $('#clear'),
    resultBlock: $('#result-block'),
    distanceValue: $('#distance-value'),
    distanceUnit: $('#distance-unit'),
    stats: $('#stats'),
    legs: $('#legs'),
    streets: $('#streets'),
    streetsCount: $('#streets-count'),
    networkStats: $('#network-stats'),
    diagnostics: $('#diagnostics'),
    status: $('#status'),
    pickBanner: $('#pick-banner'),
    pickLabel: $('#pick-label'),
    pickCancel: $('#pick-cancel'),
    map: $('#map'),
  };

  /* ─────────────── Mapa ─────────────── */

  const MAP_VIEW = { center: [-46.4255, -23.7031], zoom: 13 };

  const map = new ol.Map({
    target: els.map,
    layers: [
      new ol.layer.Tile({
        // classe aplicada ao container da camada: o CSS aplica um filtro
        // que clareia e dessatura o mapa-base, para que a rede viária
        // (e a rota) se destaquem.
        className: 'basemap',
        source: new ol.source.OSM(),
        opacity: 1,
      }),
    ],
    view: new ol.View({
      center: ol.proj.fromLonLat(MAP_VIEW.center),
      zoom: MAP_VIEW.zoom,
      maxZoom: 19,
    }),
  });

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
    style: [
      // halo externo: destaca a rota sobre a rede e sobre o mapa-base
      new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: 'rgba(255,255,255,0.95)',
          width: 9,
          lineCap: 'round',
          lineJoin: 'round',
        }),
      }),
      // contorno escuro
      new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: 'rgba(23,32,48,0.85)',
          width: 6.4,
          lineCap: 'round',
          lineJoin: 'round',
        }),
      }),
      // núcleo âmbar
      new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: '#ffc233',
          width: 3.6,
          lineCap: 'round',
          lineJoin: 'round',
        }),
      }),
    ],
  });

  // ── Camada dos marcadores (A, B, C, D…) ────────────────────────────────
  const markerSource = new ol.source.Vector({ features: [] });
  const markerLayer = new ol.layer.Vector({
    source: markerSource,
    style: (feature) => {
      const kind = feature.get('kind'); // 'origin' | 'parada' | 'destino'
      const rotulo = feature.get('rotulo') || '';
      const color =
        kind === 'origin' ? '#2ea043' : kind === 'destino' ? '#f85149' : '#1f6feb';
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 8,
          fill: new ol.style.Fill({ color }),
          stroke: new ol.style.Stroke({ color: '#fff', width: 2.5 }),
        }),
        text: new ol.style.Text({
          text: rotulo,
          font: 'bold 11px sans-serif',
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
    atualizarPonto(state.lista, id, {
      latitude: lonLat[1],
      longitude: lonLat[0],
      // o Endereço Digital anterior deixa de valer para a nova posição:
      // o código é zerado (nada é inventado) e o ponto passa a ser
      // "convertido" a partir da nova coordenada.
      enderecoDigital: '',
      codigoNormalizado: null,
      codigoCompleto: null,
      status: STATUS.CONVERTIDO,
      origem: 'mapa',
      mensagem: `Movido no mapa: ${lonLat[1].toFixed(6)}, ${lonLat[0].toFixed(6)}`,
    });
    renderizarPontos();
    setStatus(`Ponto ${ponto.rotulo} movido. Recalculando a rota...`, 'busy');
    // recalcula automaticamente quando o trajeto está completo
    if (podeCalcular(state.lista)) calculate();
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

  /** Cria a lista inicial: origem (A) e destino (D). */
  function inicializarPontos() {
    state.lista = criarListaPontos();
    adicionarPonto(state.lista, {});
    adicionarPonto(state.lista, {});
    renderizarPontos();
  }

  /** Desenha a lista de pontos no painel. */
  function renderizarPontos() {
    rotularPontos(state.lista);
    const n = state.lista.pontos.length;

    els.points.innerHTML = state.lista.pontos
      .map((p) => {
        const papel =
          p.tipo === TIPOS.ORIGEM ? 'Origem' : p.tipo === TIPOS.DESTINO ? 'Destino' : 'Parada ' + p.rotulo;
        const coord =
          p.latitude != null && p.longitude != null
            ? p.longitude.toFixed(6) + ', ' + p.latitude.toFixed(6)
            : '';
        const remove = p.tipo === TIPOS.PARADA;
        const arrastavel = p.tipo === TIPOS.PARADA;
        return (
          '<div class="point point--' + p.tipo + '" data-id="' + escapeHtml(p.id) + '"' +
          (arrastavel ? ' draggable="true" data-arrastavel="1"' : '') + '>' +
          '<div class="point__head">' +
          '<span class="point__grip' + (arrastavel ? '' : ' point__grip--fixo') + '"' +
          ' title="' + (arrastavel ? 'Arraste para mudar a ordem da rota' : 'Origem e destino ficam sempre nas extremidades') + '"></span>' +
          '<span class="point__badge">' + escapeHtml(p.rotulo) + '</span>' +
          '<span class="point__role">' + escapeHtml(papel) + '</span>' +
          '<span class="point__actions">' +
          '<button type="button" class="mini" data-acao="validar" title="Validar o Endereço Digital e convertê-lo em coordenadas">Validar</button>' +
          '<button type="button" class="mini" data-acao="map" title="Localizar este ponto no mapa" ' +
          (p.latitude != null ? '' : 'disabled') + '>🎯</button>' +
          '<button type="button" class="mini" data-acao="cima" title="Subir na ordem" ' +
          (p.tipo === TIPOS.PARADA && p.indice > 1 ? '' : 'disabled') + '>↑</button>' +
          '<button type="button" class="mini" data-acao="baixo" title="Descer na ordem" ' +
          (p.tipo === TIPOS.PARADA && p.indice < n - 2 ? '' : 'disabled') + '>↓</button>' +
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
    if (ponto) {
      atualizarPonto(state.lista, ponto.id, {
        latitude: pt.lat,
        longitude: pt.lon,
        status: STATUS.CONVERTIDO,
        origem: 'mapa',
        mensagem: 'Ponto selecionado no mapa.',
        enderecoDigital: ponto.enderecoDigital || '',
      });
      renderizarPontos();
    }
    stopPicking();
    setStatus('Ponto definido. Calcule a rota.', 'idle');
  });

  // so conta como "movido pelo usuario" depois do primeiro enquadramento
  // automatico (o moveend inicial do view nao e interacao do usuario).
  let framed = false;
  map.on('moveend', () => {
    if (framed) state.userMoved = true;
  });

  map.on('pointermove', (evt) => {
    if (!state.picking) {
      map.getTargetElement().style.cursor = '';
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
      const data = await res.json();
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
      const linhas = {
        'Fonte': meta.source === 'wfs' ? 'GeoServer (WFS)' : 'snapshot local',
        'Estratégia de carga': meta.strategy || '—',
        'Feições': (meta.features || features.length).toLocaleString('pt-BR'),
        'Carregado em': new Date(meta.builtAt || Date.now()).toLocaleTimeString('pt-BR'),
      };
      if (upd.enabled) {
        linhas['Atualização automática'] = `a cada ${Math.round((upd.checkIntervalMs || 0) / 60000)} min`;
        linhas['Última verificação'] = upd.lastCheckedAt
          ? new Date(upd.lastCheckedAt).toLocaleTimeString('pt-BR')
          : 'pendente';
        if (upd.lastChangeAt) {
          linhas['Rede atualizada em'] = new Date(upd.lastChangeAt).toLocaleTimeString('pt-BR');
        }
      }
      els.networkStats.innerHTML = rows(linhas);

      const warnings = meta.warnings || [];
      if (warnings.length) {
        els.networkStats.innerHTML +=
          '<div class="alert alert--warn" style="grid-column:1/-1;margin-top:8px">' +
          warnings.map(escapeHtml).join('<br>') + '</div>';
      }

      loadDiagnostics();
      setStatus('Rede pronta (' + features.length.toLocaleString('pt-BR') + ' eixos).', 'ok');
    } catch (err) {
      setStatus('Falha ao carregar a rede: ' + err.message, 'err');
      els.networkStats.innerHTML =
        '<div class="alert alert--error"><strong>Erro</strong>' + escapeHtml(err.message) + '</div>';
    }
  }

  async function loadDiagnostics() {
    try {
      const res = await fetch('/api/diagnostics');
      if (!res.ok) return;
      const d = await res.json();
      els.diagnostics.innerHTML = rows({
        'Nós': (d.nodes || 0).toLocaleString('pt-BR'),
        'Arestas': (d.edges || 0).toLocaleString('pt-BR'),
        'Cruzamentos': (d.crossings || 0).toLocaleString('pt-BR'),
        'Toques de extremidade': (d.touches || 0).toLocaleString('pt-BR'),
        'Snaps (< 5 cm)': (d.snaps || 0).toLocaleString('pt-BR'),
        'Fusões de extremidade': (d.merges || 0).toLocaleString('pt-BR'),
        'Duplicidades removidas': (d.duplicatesRemoved || 0).toLocaleString('pt-BR'),
        'Componentes conexas': (d.components || 0).toLocaleString('pt-BR'),
        'Maior componente': (d.largestComponent || 0).toLocaleString('pt-BR'),
        'Construção': (d.buildMs || 0) + ' ms',
      });
    } catch {
      /* diagnóstico é opcional */
    }
  }

  function rows(obj) {
    return Object.entries(obj)
      .map(([k, v]) => '<span class="k">' + escapeHtml(k) + '</span><span class="v">' + escapeHtml(v) + '</span>')
      .join('');
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

  async function calculate() {
    const verificacao = podeCalcular(state.lista);
    if (!verificacao.ok) {
      showError('Pontos incompletos', verificacao.mensagem);
      setStatus(verificacao.mensagem, 'err');
      return;
    }

    els.calc.disabled = true;
    setStatus('Calculando a rota…', 'busy');
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
        body: JSON.stringify({ pontos, modo: state.modo }),
      });
      const data = await res.json();

      if (!data.ok) {
        showError(reasonTitle(data.reason), data.message || 'Não foi possível calcular a rota.');
        // trecho parcial: desenha o que foi calculado, sem inventar o resto
        if (data.legs && data.legs.length) desenharGeometria(data.geometry);
        setStatus('Sem rota completa.', 'err');
        return;
      }

      showRoute(data);
      const d = formatDistance(data.distance);
      setStatus('Rota calculada: ' + d.v + ' ' + d.u + '.', 'ok');
    } catch (err) {
      showError('Falha de comunicação', err.message);
      setStatus('Falha ao consultar o servidor.', 'err');
    } finally {
      els.calc.disabled = false;
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

  function showError(title, message) {
    els.resultBlock.hidden = false;
    els.distanceValue.className = 'distance__value is-error';
    els.distanceValue.textContent = title;
    els.distanceUnit.textContent = '';
    els.stats.innerHTML = '';
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
  }

  /** Desenha uma geometria (lon/lat) no mapa. */
  function desenharGeometria(geom) {
    if (!geom || !geom.coordinates || geom.coordinates.length < 2) return null;
    const feature = toOlFeature({
      type: 'Feature',
      properties: {},
      geometry: geom,
    });
    routeSource.addFeature(feature);
    map.getView().fit(feature.getGeometry().getExtent(), {
      padding: [70, 70, 70, 70],
      duration: 600,
      maxZoom: 17,
    });
    return feature;
  }

  function showRoute(data) {
    const old = document.getElementById('route-alert');
    if (old) old.remove();

    els.resultBlock.hidden = false;
    const d = formatDistance(data.distance);
    els.distanceValue.className = 'distance__value';
    els.distanceValue.textContent = d.v;
    els.distanceUnit.textContent = d.u;

    const legs = data.legs || [];
    const todos = legs.flatMap((l) => l.legs || []);
    const oficial = todos.filter((l) => l.official).length;

    const modoRotulo = data.modo === 'otimizada' ? 'Menor rota (otimizada)' : 'Ordem do usuário';
    const linhas = {
      'Paradas intermediárias': data.paradas != null ? data.paradas : Math.max(0, legs.length - 1),
      'Trechos': legs.length,
      'Ordem do trajeto': modoRotulo,
      'Sequência percorrida': (data.sequencia || []).join(' → ') || '—',
      'Logradouros oficiais': oficial + ' de ' + todos.length,
      'Nós na rota': legs.reduce((s, l) => s + (l.nodeCount || 0), 0),
    };
    if (data.modo === 'otimizada' && data.sequenciaUsuario) {
      const mudou = data.sequenciaUsuario.join() !== (data.sequencia || []).join();
      linhas['Sequência informada'] = data.sequenciaUsuario.join(' → ');
      if (mudou) linhas['Ordem alterada'] = 'sim (pela otimização)';
    }
    if (data.comparacao) {
      linhas['Economia da otimização'] =
        Math.round(data.comparacao.economia) + ' m (' +
        data.comparacao.economiaPercentual.toFixed(1) + ' %)';
    }
    if (data.otimizacao) {
      linhas['Método de otimização'] =
        data.otimizacao.metodo === 'exato'
          ? 'exato (Held-Karp)'
          : 'heurístico (vizinho mais próximo + 2-opt)';
    }
    els.stats.innerHTML = rows(linhas);

    // distância de cada trecho, na ordem do usuário
    els.legs.innerHTML = legs
      .map((l) => {
        const dl = formatDistance(l.distance);
        const acesso = l.origem
          ? ' · acesso à rede ' + Math.round(l.origem.distanceToNetwork * 100) / 100 + ' m'
          : '';
        return (
          '<div class="leg"><span class="leg__de">' + escapeHtml(l.de) + '</span>' +
          '<span class="leg__seta">→</span>' +
          '<span class="leg__para">' + escapeHtml(l.para) + '</span>' +
          '<span class="leg__dist">' + dl.v + ' ' + dl.u + '</span>' +
          '<span class="leg__acesso">' + escapeHtml(acesso) + '</span></div>'
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

    // desenha a rota (traço único, com todas as paradas)
    desenharGeometria(data.geometry);
  }

  /* ─────────────── Ordem dos pontos: arrastar no painel ─────────────── */

  /**
   * Re-renderiza a lista de pontos e recalcula a rota (quando o trajeto
   * está completo). Usado depois de qualquer mudança de ordem.
   */
  function reaplicarOrdem(mensagem) {
    renderizarPontos();
    if (mensagem) setStatus(mensagem, 'busy');
    if (podeCalcular(state.lista)) calculate();
  }

  // O arraste aqui é de **ORDEM**: a parada arrastada troca de lugar com a
  // linha sobre a qual ela é solta. A origem (primeira linha) e o destino
  // (última linha) permanecem nas extremidades — a regra está em
  // `core/pontoTrajeto.js` (`moverPontoPara`), compartilhada com o servidor.
  els.points.addEventListener('dragstart', (ev) => {
    const linha = ev.target.closest('.point[data-arrastavel]');
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
      reaplicarOrdem();
    } else if (acao === 'baixo') {
      moverPonto(state.lista, id, +1);
      reaplicarOrdem();
    } else if (acao === 'remover') {
      removerPonto(state.lista, id);
      renderizarPontos();
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

  els.calc.addEventListener('click', calculate);

  // seletor de ordem do trajeto
  els.modes.addEventListener('change', (ev) => {
    const alvo = ev.target;
    if (alvo && alvo.name === 'modo') {
      state.modo = alvo.value === 'otimizada' ? 'otimizada' : 'usuario';
      setStatus(
        state.modo === 'otimizada'
          ? 'Modo: menor rota (a ordem das paradas será otimizada).'
          : 'Modo: ordem do usuário (A → B → C… como você informou).',
        'idle'
      );
    }
  });

  els.addStop.addEventListener('click', () => {
    adicionarPonto(state.lista, {});
    renderizarPontos();
    setStatus('Parada adicionada. Informe o Endereço Digital.', 'idle');
    const ultima = els.points.querySelector('.point:last-child .point__codigo');
    if (ultima) ultima.focus();
  });

  els.swap.addEventListener('click', () => {
    const pontos = state.lista.pontos;
    if (pontos.length < 2) return;
    // inverte o trajeto inteiro: o destino vira origem e vice-versa, e as
    // paradas intermediárias mantêm a ordem (C → B → A vira A → B → C)
    pontos.reverse();
    rotularPontos(state.lista);
    renderizarPontos();
    setStatus('Trajeto invertido.', 'idle');
  });

  els.clear.addEventListener('click', () => {
    inicializarPontos();
    els.resultBlock.hidden = true;
    const alert = document.getElementById('route-alert');
    if (alert) alert.remove();
    routeSource.clear();
    setStatus('Pronto', 'idle');
  });

  /* ─────────────── Arranque ─────────────── */

  // exposto para automação e depuração no console do navegador
  // versão do front-end (ajuda a identificar cache antigo no navegador)
  window.__appVersion = '20261022';
  window.__app = { map, state, axisSource, axisCasingSource, routeSource, markerSource };

  inicializarPontos();
  setStatus('Carregando a rede viária…', 'busy');
  loadNetwork();
})();
