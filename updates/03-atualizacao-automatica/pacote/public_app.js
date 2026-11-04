/* ==========================================================================
   Aplicação de roteamento viário de Santo André (a pé)
   --------------------------------------------------------------------------
   Interface em OpenLayers. Todo o cálculo de rota acontece no backend
   (o GeoServer não envia cabeçalhos CORS, portanto o navegador não pode
   consultar o WFS diretamente) — ver README, seção "Arquitetura".
   ========================================================================== */

(function () {
  'use strict';

  const ol = window.ol;

  /* ─────────────── Estado ─────────────── */

  const state = {
    picking: null, // 'origin' | 'destination' | null
    networkLoaded: false,
    lastRoute: null,
  };

  const $ = (sel) => document.querySelector(sel);

  const els = {
    origin: $('#origin'),
    destination: $('#destination'),
    calc: $('#calc'),
    swap: $('#swap'),
    clear: $('#clear'),
    resultBlock: $('#result-block'),
    distanceValue: $('#distance-value'),
    distanceUnit: $('#distance-unit'),
    stats: $('#stats'),
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

  // ── Camada dos marcadores ──────────────────────────────────────────────
  const markerSource = new ol.source.Vector({ features: [] });
  const markerLayer = new ol.layer.Vector({
    source: markerSource,
    style: (feature) => {
      const kind = feature.get('kind');
      const color = kind === 'origin' ? '#2ea043' : '#f85149';
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 7,
          fill: new ol.style.Fill({ color }),
          stroke: new ol.style.Stroke({ color: '#fff', width: 2.5 }),
        }),
        text: new ol.style.Text({
          text: kind === 'origin' ? 'A' : 'B',
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

  /* ─────────────── Marcadores ─────────────── */

  function clearMarkers() {
    markerSource.clear();
  }

  function addMarker(pt, kind) {
    const feature = new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat([pt.lon, pt.lat])),
      kind,
    });
    markerSource.addFeature(feature);
  }

  function updateMarkers() {
    clearMarkers();
    const o = parseCoords(els.origin.value);
    const d = parseCoords(els.destination.value);
    if (o) addMarker(o, 'origin');
    if (d) addMarker(d, 'destination');
  }

  /* ─────────────── Seleção no mapa ─────────────── */

  function startPicking(which) {
    state.picking = which;
    els.pickLabel.textContent = which === 'origin' ? 'origem' : 'destino';
    els.pickBanner.hidden = false;
    els.map.classList.add('map--picking');
    document.querySelectorAll('.pick').forEach((b) => {
      b.classList.toggle('active', b.dataset.pick === which);
    });
    setStatus('Clique no mapa para definir a ' + (which === 'origin' ? 'origem' : 'destino') + '.', 'busy');
  }

  function stopPicking() {
    state.picking = null;
    els.pickBanner.hidden = true;
    els.map.classList.remove('map--picking');
    document.querySelectorAll('.pick').forEach((b) => b.classList.remove('active'));
  }

  document.querySelectorAll('.pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      const which = btn.dataset.pick;
      if (state.picking === which) stopPicking();
      else startPicking(which);
    });
  });
  els.pickCancel.addEventListener('click', stopPicking);

  map.on('click', (evt) => {
    if (!state.picking) return;
    const lonLat = ol.proj.toLonLat(evt.coordinate);
    const pt = { lon: lonLat[0], lat: lonLat[1] };
    const input = state.picking === 'origin' ? els.origin : els.destination;
    input.value = formatCoord(pt);
    input.classList.remove('invalid');
    updateMarkers();
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

  /* ─────────────── Cálculo da rota ─────────────── */

  async function calculate() {
    const origin = parseCoords(els.origin.value);
    const destination = parseCoords(els.destination.value);

    els.origin.classList.toggle('invalid', !origin && els.origin.value.trim() !== '');
    els.destination.classList.toggle('invalid', !destination && els.destination.value.trim() !== '');

    if (!origin || !destination) {
      showError(
        'Coordenadas inválidas',
        'Informe origem e destino no formato "longitude, latitude" ' +
        '(ex.: -46.545000, -23.660000). Verifique também o sinal.'
      );
      setStatus('Coordenadas inválidas.', 'err');
      return;
    }

    els.calc.disabled = true;
    setStatus('Calculando a rota…', 'busy');
    routeSource.clear();

    const url =
      '/api/route?origin=' + encodeURIComponent(origin.lon + ',' + origin.lat) +
      '&destination=' + encodeURIComponent(destination.lon + ',' + destination.lat);

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (!data.ok) {
        showError(reasonTitle(data.reason), data.message || 'Não foi possível calcular a rota.');
        setStatus('Sem rota.', 'err');
        return;
      }

      showRoute(data);
      setStatus('Rota calculada: ' + formatDistance(data.distance).v + ' ' + formatDistance(data.distance).u + '.', 'ok');
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

  function showRoute(data) {
    const old = document.getElementById('route-alert');
    if (old) old.remove();

    els.resultBlock.hidden = false;
    const d = formatDistance(data.distance);
    els.distanceValue.className = 'distance__value';
    els.distanceValue.textContent = d.v;
    els.distanceUnit.textContent = d.u;

    const legs = data.legs || [];
    const official = legs.filter((l) => l.official).length;
    els.stats.innerHTML = rows({
      'Origem (ajuste à rede)': Math.round(data.origin.distanceToNetwork * 100) / 100 + ' m',
      'Destino (ajuste à rede)': Math.round(data.destination.distanceToNetwork * 100) / 100 + ' m',
      'Trechos percorridos': legs.length,
      'Logradouros oficiais': official + ' de ' + legs.length,
      'Nós na rota': data.nodeCount,
    });

    els.streets.innerHTML = legs
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
    els.streetsCount.textContent = legs.length;

    // desenha a rota
    const geom = data.geometry;
    if (geom && geom.coordinates && geom.coordinates.length > 1) {
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
    }
  }

  /* ─────────────── Eventos da interface ─────────────── */

  els.calc.addEventListener('click', calculate);
  els.origin.addEventListener('input', updateMarkers);
  els.destination.addEventListener('input', updateMarkers);
  els.origin.addEventListener('keydown', (e) => { if (e.key === 'Enter') calculate(); });
  els.destination.addEventListener('keydown', (e) => { if (e.key === 'Enter') calculate(); });

  els.swap.addEventListener('click', () => {
    const o = els.origin.value;
    els.origin.value = els.destination.value;
    els.destination.value = o;
    updateMarkers();
  });

  els.clear.addEventListener('click', () => {
    els.origin.value = '';
    els.destination.value = '';
    els.resultBlock.hidden = true;
    const alert = document.getElementById('route-alert');
    if (alert) alert.remove();
    routeSource.clear();
    updateMarkers();
    setStatus('Pronto', 'idle');
  });

  /* ─────────────── Arranque ─────────────── */

  // exposto para automação e depuração no console do navegador
  // versão do front-end (ajuda a identificar cache antigo no navegador)
  window.__appVersion = '20261021';
  window.__app = { map, state, axisSource, axisCasingSource, routeSource, markerSource };

  setStatus('Carregando a rede viária…', 'busy');
  loadNetwork();
})();
