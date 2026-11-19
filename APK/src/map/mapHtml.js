import { ESTILO_TRECHO_JS } from './styleScript.js';
import { CAMADAS_BASE, CAMADA_PADRAO, CAMADA_SATELITE } from './camadaBase.js';

export const MAP_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; user-select: none; }
  html, body, #map {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: #ffffff;
    overflow: hidden;
    touch-action: none;
  }
  .basemap {
    filter: grayscale(0.75) contrast(0.88) brightness(1.06) saturate(0.5);
    opacity: 0.92;
  }
  .basemap-satellite {
    opacity: 1;
  }
  .ol-zoom {
    top: 12px;
    right: 12px;
    left: auto;
  }
  .ol-zoom button {
    background: #ffffff !important;
    color: #045127 !important;
    border: 1px solid #d0d7de !important;
    width: 36px !important;
    height: 36px !important;
    font-size: 18px !important;
    border-radius: 6px !important;
    margin-bottom: 4px !important;
  }
  .ol-attribution {
    right: 8px !important;
    bottom: 6px !important;
    left: auto !important;
    max-width: 205px !important;
    background: rgba(255, 255, 255, 0.92) !important;
    border: 1px solid #d0d7de !important;
    border-radius: 6px !important;
    padding: 2px 6px !important;
    font-size: 9.5px !important;
    line-height: 1.2 !important;
    color: #374151 !important;
    z-index: 4 !important;
  }
  .ol-attribution ul {
    margin: 0 !important;
    padding: 0 !important;
    font-size: 9.5px !important;
    color: #374151 !important;
  }
  .ol-attribution a {
    color: #045127 !important;
    text-decoration: underline !important;
  }
  .ol-attribution button {
    color: #045127 !important;
    background: transparent !important;
    font-weight: 700 !important;
  }
  #fallback-canvas {
    display: none;
    width: 100%;
    height: 100%;
    background: #ffffff;
  }
  #fallback-zoom {
    display: none;
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 2;
    flex-direction: column;
  }
  #fallback-zoom[hidden] { display: none !important; }
  #fallback-zoom button {
    background: #ffffff;
    color: #045127;
    border: 1px solid #d0d7de;
    width: 36px;
    height: 36px;
    font-size: 18px;
    line-height: 1;
    border-radius: 6px;
    margin-bottom: 4px;
    padding: 0;
  }
</style>
</head>
<body>
<div id="map"></div>
<canvas id="fallback-canvas"></canvas>
<div id="fallback-zoom" hidden>
  <button type="button" id="fallback-zoom-in" aria-label="Aproximar mapa">+</button>
  <button type="button" id="fallback-zoom-out" aria-label="Afastar mapa">−</button>
</div>

<script>

(function () {
  function iniciarMapa() {
  function postToRN(payload) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  var estiloTrecho = ${ESTILO_TRECHO_JS};
  var CAMADAS_BASE = ${JSON.stringify(CAMADAS_BASE)};
  var CAMADA_PADRAO = ${JSON.stringify(CAMADA_PADRAO)};
  var CAMADA_SATELITE = ${JSON.stringify(CAMADA_SATELITE)};

  function normalizarCamadaBase(valor) {
    return valor === CAMADA_SATELITE ? CAMADA_SATELITE : CAMADA_PADRAO;
  }

  var state = {
    features: [],
    routeGeometry: null,
    segments: [],
    altRoutes: [],
    highlightSegments: [],
    gpsTrailGeometry: null,
    routeObservations: [],
    occurrences: [],
    showOccurrences: true,
    position: null,
    markers: [],
    picking: false,
    basemapMode: CAMADA_PADRAO
  };

  function corOcorrencia(classificacao) {
    if (classificacao === 'evita' || classificacao === 'bloqueio_total') return '#dc2626';
    if (classificacao === 'penaliza' || classificacao === 'penalidade_severa') return '#d97706';
    return '#0284c7';
  }
  function glifoCategoria(categoria) {
    var mapa = {
      escadaria: '≡',
      terreno_irregular: '≈',
      rua_ingreme: '↗',
      passagem_estreita: '⇥',
      buracos: '●',
      alagamento: '∿',
      obra_bloqueio: '✕',
      calcada_inexistente: '!',
      obstaculo: '▲',
      outras: '•'
    };
    return mapa[categoria] || '•';
  }

  // =========================================================================
  // MODO 1: OpenLayers 10 (com mapa-base OSM / Satélite + camadas vetoriais)
  // =========================================================================
  if (window.ol) {
    var ol = window.ol;
    var osmLayer = new ol.layer.Tile({
      className: 'basemap',
      visible: true,
      zIndex: 0,
      source: new ol.source.OSM({
        maxZoom: 19,
        interpolate: true
      }),
      opacity: 1
    });
    var satDef = CAMADAS_BASE[CAMADA_SATELITE];
    var satSource = ol.source && typeof ol.source.XYZ === 'function'
      ? new ol.source.XYZ({
          url: satDef.url,
          maxZoom: satDef.maxZoom,
          interpolate: satDef.interpolate,
          attributions: satDef.atribuicaoHtml,
          attributionsCollapsible: false
        })
      : null;
    var satLayer = satSource
      ? new ol.layer.Tile({
          className: 'basemap-satellite',
          visible: false,
          zIndex: 0,
          source: satSource,
          opacity: 1
        })
      : null;

    var baseLayers = satLayer ? [osmLayer, satLayer] : [osmLayer];
    var map = new ol.Map({
      target: document.getElementById('map'),
      layers: baseLayers,
      view: new ol.View({
        center: ol.proj.fromLonLat([-46.4255, -23.7031]),
        zoom: 13,
        minZoom: 5,
        maxZoom: 22
      })
    });

    var errosSatelite = 0;
    var satCarregado = false;
    function emitirStatusBase(status, message) {
      postToRN({
        type: 'BASEMAP_STATUS',
        mode: state.basemapMode,
        status: status,
        message: message || ''
      });
    }

    function aplicarCamadaBase(modo) {
      var proximo = normalizarCamadaBase(modo);
      state.basemapMode = proximo;
      errosSatelite = 0;
      if (proximo === CAMADA_SATELITE && satLayer) {
        if (typeof osmLayer.setVisible === 'function') osmLayer.setVisible(false);
        else osmLayer.visible = false;
        if (typeof satLayer.setVisible === 'function') satLayer.setVisible(true);
        else satLayer.visible = true;
        satCarregado = false;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          emitirStatusBase('offline', 'Sem conexão com a internet: imagens de satélite exigem rede ativa. Você pode voltar para o Mapa padrão.');
        } else {
          emitirStatusBase('loading', '');
        }
      } else if (proximo === CAMADA_SATELITE && !satLayer) {
        emitirStatusBase('unavailable', 'Camada de satélite indisponível nesta versão do mapa.');
      } else {
        if (satLayer) {
          if (typeof satLayer.setVisible === 'function') satLayer.setVisible(false);
          else satLayer.visible = false;
        }
        if (typeof osmLayer.setVisible === 'function') osmLayer.setVisible(true);
        else osmLayer.visible = true;
        emitirStatusBase('ready', '');
      }
    }

    if (satSource && typeof satSource.on === 'function') {
      satSource.on('tileloadstart', function () {
        if (state.basemapMode !== CAMADA_SATELITE) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          emitirStatusBase('offline', 'Sem conexão com a internet: imagens de satélite exigem rede ativa. Você pode voltar para o Mapa padrão.');
        }
      });
      satSource.on('tileloadend', function () {
        if (state.basemapMode !== CAMADA_SATELITE) return;
        errosSatelite = 0;
        satCarregado = true;
        emitirStatusBase('ready', '');
      });
      satSource.on('tileloaderror', function () {
        if (state.basemapMode !== CAMADA_SATELITE) return;
        errosSatelite += 1;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          emitirStatusBase('offline', 'Sem conexão com a internet: imagens de satélite indisponíveis. O mapa padrão continua disponível.');
          return;
        }
        var limite = satCarregado ? 5 : 3;
        if (errosSatelite >= limite) {
          emitirStatusBase('unavailable', 'Não foi possível carregar as imagens de satélite no momento. Você pode voltar para o Mapa padrão.');
        }
      });
    }

    if (window.addEventListener) {
      window.addEventListener('offline', function () {
        if (state.basemapMode === CAMADA_SATELITE) {
          emitirStatusBase('offline', 'Conexão perdida: novas imagens de satélite não podem ser baixadas offline.');
        }
      });
      window.addEventListener('online', function () {
        if (state.basemapMode === CAMADA_SATELITE) {
          errosSatelite = 0;
          emitirStatusBase('loading', '');
          if (satSource && typeof satSource.refresh === 'function') satSource.refresh();
        }
      });
    }

    var axisCasingSource = new ol.source.Vector({ features: [] });
    var axisCasingLayer = new ol.layer.Vector({
      source: axisCasingSource,
      zIndex: 10,
      declutter: true,
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: 'rgba(255,255,255,0.9)',
          width: 3.6,
          lineCap: 'round',
          lineJoin: 'round'
        })
      })
    });

    var axisSource = new ol.source.Vector({ features: [] });
    var styleOfficial = new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: '#4d5f73',
        width: 1.8,
        lineCap: 'round',
        lineJoin: 'round'
      })
    });
    var styleUnofficial = new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: '#c2620d',
        width: 1.7,
        lineCap: 'round',
        lineJoin: 'round',
        lineDash: [4, 3]
      })
    });

    var axisLayer = new ol.layer.Vector({
      source: axisSource,
      zIndex: 11,
      declutter: true,
      style: function (feature) {
        return Number(feature.get('COD_LOG')) === 0 ? styleUnofficial : styleOfficial;
      }
    });

    var routeSource = new ol.source.Vector({ features: [] });
    var routeLayer = new ol.layer.Vector({
      source: routeSource,
      zIndex: 20,
      style: function (feature) {
        var t = estiloTrecho({ cor: feature.get('cor'), retorno: feature.get('retorno'),
          visivel: feature.get('visivel'), situacao: feature.get('situacao') });
        if (!t.visivel) return null;
        return [
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: t.haloCor, width: t.halo, lineCap: 'round', lineJoin: 'round', lineDash: t.dash }) }),
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: t.contornoCor, width: t.contorno, lineCap: 'round', lineJoin: 'round', lineDash: t.dash }) }),
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: t.nucleoCor, width: t.nucleo, lineCap: 'round', lineJoin: 'round', lineDash: t.dash }) })
        ];
      }
    });

    var markerSource = new ol.source.Vector({ features: [] });
    var markerLayer = new ol.layer.Vector({
      source: markerSource,
      zIndex: 25,
      style: function (feature) {
        var kind = feature.get('kind');
        var rotulo = feature.get('rotulo') || '';
        var color = kind === 'origem' ? '#2ea043' : kind === 'destino' ? '#f85149' : '#045127';
        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: 10,
            fill: new ol.style.Fill({ color: color }),
            stroke: new ol.style.Stroke({ color: '#ffffff', width: 2.5 })
          }),
          text: new ol.style.Text({
            text: rotulo,
            font: 'bold 12px sans-serif',
            fill: new ol.style.Fill({ color: '#ffffff' })
          })
        });
      }
    });

    map.addLayer(axisCasingLayer);
    map.addLayer(axisLayer);
    map.addLayer(routeLayer);
    map.addLayer(markerLayer);
    var positionSource = new ol.source.Vector({ features: [] });
    map.addLayer(new ol.layer.Vector({ source: positionSource, zIndex: 30,
      style: function (feature) { return new ol.style.Style({ image: new ol.style.Circle({ radius: 7,
        fill: new ol.style.Fill({ color: feature.get('simulado') ? '#7c3aed' : '#045127' }),
        stroke: new ol.style.Stroke({ color: '#ffffff', width: 2.5 }) }) }); }
    }));

    // Camadas colaborativas adicionadas após positionSource para preservar índices 0..4
    var altRouteSource = new ol.source.Vector({ features: [] });
    var altRouteLayer = new ol.layer.Vector({
      source: altRouteSource,
      zIndex: 18,
      style: function () {
        return [
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.8)', width: 7, lineCap: 'round', lineJoin: 'round' }) }),
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(100,116,139,0.75)', width: 4, lineCap: 'round', lineJoin: 'round', lineDash: [10, 6] }) })
        ];
      }
    });
    var occSegmentSource = new ol.source.Vector({ features: [] });
    var occSegmentLayer = new ol.layer.Vector({
      source: occSegmentSource,
      zIndex: 19,
      style: function (feature) {
        var c = corOcorrencia(feature.get('classificacao'));
        return [
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.9)', width: 9, lineCap: 'round', lineJoin: 'round' }) }),
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: c, width: 5, lineCap: 'round', lineJoin: 'round' }) })
        ];
      }
    });
    var occSource = new ol.source.Vector({ features: [] });
    var occClusterSource = ol.source && typeof ol.source.Cluster === 'function'
      ? new ol.source.Cluster({ distance: 38, minDistance: 22, source: occSource })
      : occSource;
    var occLayer = new ol.layer.Vector({
      source: occClusterSource,
      zIndex: 23,
      visible: true,
      style: function (feature) {
        var inner = typeof feature.get === 'function' ? feature.get('features') : null;
        if (inner && inner.length > 1) {
          var temBloqueio = inner.some(function (it) { return it.get('classificacao') === 'evita'; });
          var temSevera = inner.some(function (it) { return it.get('classificacao') === 'penaliza'; });
          var corCl = temBloqueio ? '#dc2626' : (temSevera ? '#d97706' : '#0284c7');
          return new ol.style.Style({
            image: new ol.style.Circle({
              radius: 13,
              fill: new ol.style.Fill({ color: corCl }),
              stroke: new ol.style.Stroke({ color: '#ffffff', width: 2.5 })
            }),
            text: new ol.style.Text({
              text: String(inner.length),
              font: 'bold 11px sans-serif',
              fill: new ol.style.Fill({ color: '#ffffff' })
            })
          });
        }
        var target = inner && inner.length === 1 ? inner[0] : feature;
        var cls = target.get('classificacao');
        var glyph = glifoCategoria(target.get('categoria'));
        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: 10,
            fill: new ol.style.Fill({ color: corOcorrencia(cls) }),
            stroke: new ol.style.Stroke({ color: '#ffffff', width: 2.2 })
          }),
          text: new ol.style.Text({
            text: glyph,
            font: 'bold 11px sans-serif',
            fill: new ol.style.Fill({ color: '#ffffff' })
          })
        });
      }
    });
    var gpsTrailSource = new ol.source.Vector({ features: [] });
    var gpsTrailLayer = new ol.layer.Vector({
      source: gpsTrailSource,
      zIndex: 21,
      style: function () {
        return [
          new ol.style.Style({
            stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.9)', width: 6, lineCap: 'round', lineJoin: 'round' })
          }),
          new ol.style.Style({
            stroke: new ol.style.Stroke({ color: '#047857', width: 3.4, lineCap: 'round', lineJoin: 'round', lineDash: [8, 6] })
          })
        ];
      }
    });
    var routeObsSource = new ol.source.Vector({ features: [] });
    var routeObsLayer = new ol.layer.Vector({
      source: routeObsSource,
      zIndex: 27,
      style: function (feature) {
        var st = feature.get('status');
        var fill = st === 'CONCLUIDA' ? '#15803d' : st === 'REABERTA' ? '#b45309' : '#1d4ed8';
        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: 8.5,
            fill: new ol.style.Fill({ color: fill }),
            stroke: new ol.style.Stroke({ color: '#ffffff', width: 2.2 })
          }),
          text: new ol.style.Text({
            text: 'O',
            font: 'bold 10px sans-serif',
            fill: new ol.style.Fill({ color: '#ffffff' })
          })
        });
      }
    });

    map.addLayer(altRouteLayer);
    map.addLayer(occSegmentLayer);
    map.addLayer(gpsTrailLayer);
    map.addLayer(occLayer);
    map.addLayer(routeObsLayer);

    var geojson = new ol.format.GeoJSON({
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857'
    });

    function isExtentValid(ext) {
      return ext && ext.length === 4 && isFinite(ext[0]) && isFinite(ext[2]);
    }

    map.on('singleclick', function (evt) {
      if (!state.picking && typeof map.forEachFeatureAtPixel === 'function') {
        var clicadaRouteObs = map.forEachFeatureAtPixel(evt.pixel, function (feat) { return feat; }, {
          layerFilter: function (layer) { return layer === routeObsLayer; },
          hitTolerance: 8
        });
        if (clicadaRouteObs && clicadaRouteObs.get && clicadaRouteObs.get('idCliente')) {
          postToRN({ type: 'ROUTE_OBS_CLICK', idCliente: clicadaRouteObs.get('idCliente') });
          return;
        }
        var clicadaOcc = map.forEachFeatureAtPixel(evt.pixel, function (feat) { return feat; }, {
          layerFilter: function (layer) { return layer === occLayer; },
          hitTolerance: 8
        });
        if (clicadaOcc) {
          var sub = typeof clicadaOcc.get === 'function' ? clicadaOcc.get('features') : null;
          if (sub && sub.length > 1) {
            var cGeom = clicadaOcc.getGeometry && clicadaOcc.getGeometry();
            if (cGeom && typeof cGeom.getCoordinates === 'function') {
              map.getView().animate({
                center: cGeom.getCoordinates(),
                zoom: Math.min((map.getView().getZoom() || 14) + 2, 19),
                duration: 260
              });
              return;
            }
          }
          var alvoOcc = sub && sub.length === 1 ? sub[0] : clicadaOcc;
          var occId = alvoOcc.get && alvoOcc.get('occId');
          if (occId) {
            postToRN({ type: 'OCC_CLICK', id: occId });
            return;
          }
        }
        var clicadaAlt = map.forEachFeatureAtPixel(evt.pixel, function (feat) { return feat; }, {
          layerFilter: function (layer) { return layer === altRouteLayer; },
          hitTolerance: 8
        });
        if (clicadaAlt && clicadaAlt.get && clicadaAlt.get('altId')) {
          postToRN({ type: 'ALT_ROUTE_CLICK', id: clicadaAlt.get('altId') });
          return;
        }
      }
      var lonLat = ol.proj.toLonLat(evt.coordinate);
      postToRN({
        type: 'MAP_CLICK',
        lon: lonLat[0],
        lat: lonLat[1],
        // o zoom permite calcular a tolerância do toque em metros
        zoom: map.getView().getZoom()
      });
    });

    window.__handleRNMessage = function (msg) {
      if (!msg || !msg.type) return;

      if (msg.type === 'SET_NETWORK') {
        axisSource.clear();
        axisCasingSource.clear();
        var rawFeatures = msg.features || [];
        var olFeats = [];
        for (var i = 0; i < rawFeatures.length; i++) {
          try {
            var f = rawFeatures[i];
            olFeats.push(geojson.readFeature({
              type: 'Feature',
              geometry: f.geometry,
              properties: f.properties
            }));
          } catch (e) {}
        }
        axisSource.addFeatures(olFeats);
        axisCasingSource.addFeatures(olFeats);
        var ext = axisSource.getExtent();
        if (msg.fit !== false && isExtentValid(ext)) {
          map.getView().fit(ext, { padding: [30, 30, 30, 30], maxZoom: 15, duration: 300 });
        }
        postToRN({ type: 'NETWORK_RENDERED', count: olFeats.length });
      } else if (msg.type === 'SET_MARKERS') {
        markerSource.clear();
        var pts = msg.markers || [];
        for (var j = 0; j < pts.length; j++) {
          var p = pts[j];
          if (p.latitude == null || p.longitude == null) continue;
          var mf = new ol.Feature({
            geometry: new ol.geom.Point(ol.proj.fromLonLat([p.longitude, p.latitude])),
            kind: p.tipo,
            rotulo: p.rotulo
          });
          markerSource.addFeature(mf);
        }
      } else if (msg.type === 'SET_POSITION') {
        positionSource.clear();
        if (msg.position && isFinite(msg.position.longitude) && isFinite(msg.position.latitude)) {
          positionSource.addFeature(geojson.readFeature({ type: 'Feature', properties: { simulado: msg.position.simulado === true },
            geometry: { type: 'Point', coordinates: [msg.position.longitude, msg.position.latitude] } }));
        }
      } else if (msg.type === 'SET_ROUTE') {
        routeSource.clear();
        var segments = msg.segments && msg.segments.length ? msg.segments : [{ geometry: msg.geometry }];
        for (var ri = 0; ri < segments.length; ri++) {
          var segment = segments[ri];
          var geom = segment.geometry;
          if (!geom || !geom.coordinates || geom.coordinates.length < 2) continue;
          var rf = geojson.readFeature({ type: 'Feature', properties: {
            cor: segment.cor, retorno: segment.retorno, visivel: segment.visivel,
            situacao: segment.situacao, indice: segment.indice
          }, geometry: geom });
          routeSource.addFeature(rf);
        }
        var rExt = routeSource.getExtent();
        if (msg.fit !== false && isExtentValid(rExt)) {
          map.getView().fit(rExt, { padding: [55, 55, 55, 55], maxZoom: 18, duration: 500 });
        }
      } else if (msg.type === 'CENTER_POINT') {
        if (msg.lon != null && msg.lat != null) {
          map.getView().animate({
            center: ol.proj.fromLonLat([msg.lon, msg.lat]),
            zoom: Math.max(map.getView().getZoom() || 15, 17),
            duration: 450
          });
        }
      } else if (msg.type === 'RESIZE_MAP') {
        map.updateSize();
      } else if (msg.type === 'FIT_NETWORK') {
        var nExt = axisSource.getExtent();
        if (isExtentValid(nExt)) {
          map.getView().fit(nExt, { padding: [30, 30, 30, 30], maxZoom: 15, duration: 450 });
        }
      } else if (msg.type === 'FIT_ROUTE') {
        var rtExt = routeSource.getExtent();
        if (isExtentValid(rtExt)) {
          map.getView().fit(rtExt, { padding: [55, 55, 55, 55], maxZoom: 18, duration: 450 });
        }
      } else if (msg.type === 'SET_BASEMAP') {
        aplicarCamadaBase(msg.mode);
      } else if (msg.type === 'SET_PICKING') {
        state.picking = !!msg.picking;
      } else if (msg.type === 'SET_ALT_ROUTES') {
        altRouteSource.clear();
        var alts = msg.altRoutes || [];
        for (var ai = 0; ai < alts.length; ai++) {
          var alt = alts[ai];
          if (!alt || !alt.geometry || !alt.geometry.coordinates || alt.geometry.coordinates.length < 2) continue;
          altRouteSource.addFeature(geojson.readFeature({
            type: 'Feature',
            properties: { altId: alt.id },
            geometry: alt.geometry
          }));
        }
      } else if (msg.type === 'SET_HIGHLIGHT_SEGMENTS') {
        occSegmentSource.clear();
        var hSegs = msg.segments || [];
        for (var hi = 0; hi < hSegs.length; hi++) {
          var hs = hSegs[hi];
          if (!hs || !hs.geometry || !hs.geometry.coordinates || hs.geometry.coordinates.length < 2) continue;
          occSegmentSource.addFeature(geojson.readFeature({
            type: 'Feature',
            properties: { classificacao: hs.classificacao || 'informativo' },
            geometry: hs.geometry
          }));
        }
      } else if (msg.type === 'SET_OCCURRENCES') {
        occSource.clear();
        var occs = msg.occurrences || [];
        for (var oi = 0; oi < occs.length; oi++) {
          var occ = occs[oi];
          var occLoc = (occ && occ.localizacao) || occ;
          if (!occ || occLoc.latitude == null || occLoc.longitude == null) continue;
          var of = new ol.Feature({
            geometry: new ol.geom.Point(ol.proj.fromLonLat([occLoc.longitude, occLoc.latitude])),
            occId: occ.id,
            categoria: occ.categoria,
            classificacao: occ.classificacao
          });
          occSource.addFeature(of);
        }
      } else if (msg.type === 'SET_SHOW_OCCURRENCES') {
        state.showOccurrences = msg.show !== false;
        if (typeof occLayer.setVisible === 'function') occLayer.setVisible(state.showOccurrences);
        else occLayer.visible = state.showOccurrences;
      } else if (msg.type === 'SET_GPS_TRAIL') {
        gpsTrailSource.clear();
        if (msg.geometry && msg.geometry.coordinates && msg.geometry.coordinates.length >= 2) {
          gpsTrailSource.addFeature(geojson.readFeature({
            type: 'Feature',
            properties: { tipo: 'GPS' },
            geometry: msg.geometry
          }));
        }
      } else if (msg.type === 'SET_ROUTE_OBS') {
        routeObsSource.clear();
        var rObs = msg.observations || [];
        for (var roi = 0; roi < rObs.length; roi++) {
          var ro = rObs[roi];
          if (!ro || ro.latitude == null || ro.longitude == null) continue;
          routeObsSource.addFeature(new ol.Feature({
            geometry: new ol.geom.Point(ol.proj.fromLonLat([ro.longitude, ro.latitude])),
            idCliente: ro.idCliente,
            status: ro.status
          }));
        }
      }
    };

    postToRN({ type: 'MAP_READY', engine: 'openlayers' });
    return;
  }

  // =========================================================================
  // MODO 2: Fallback Canvas 2D Offline (caso o aparelho esteja sem internet
  // para baixar o script do OpenLayers)
  // =========================================================================
  document.getElementById('map').style.display = 'none';
  var canvas = document.getElementById('fallback-canvas');
  canvas.style.display = 'block';
  var ctx = canvas.getContext('2d');

  var view = {
    centerLon: -46.525,
    centerLat: -23.665,
    scale: 18000 // pixels por grau de longitude
  };

  // Mesma faixa e a mesma relação zoom × resolução do OpenLayers 10, para que
  // o fallback não invente uma escala incompatível com o mapa vetorial.
  var ZOOM_MIN = 5, ZOOM_MAX = 22;
  var ESCALA_BASE = 111319.49079327358 / 156543.03392804097;

  function zoomDaEscala(escala) {
    return Math.log(escala / ESCALA_BASE) / Math.LN2;
  }

  function escalaDoZoom(zoom) {
    return ESCALA_BASE * Math.pow(2, zoom);
  }

  function limitarEscala(escala) {
    var z = zoomDaEscala(escala);
    if (!isFinite(z)) return escala;
    return escalaDoZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)));
  }

  function geometryLines(geometry) {
    if (!geometry) return [];
    return geometry.type === 'MultiLineString' ? geometry.coordinates :
      geometry.type === 'LineString' ? [geometry.coordinates] : [];
  }

  function fitGeometries(geometries) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var gi = 0; gi < geometries.length; gi++) {
      var lines = geometryLines(geometries[gi]);
      for (var li = 0; li < lines.length; li++) {
        for (var pi = 0; pi < lines[li].length; pi++) {
          var point = lines[li][pi];
          if (!isFinite(point[0]) || !isFinite(point[1])) continue;
          minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
          minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
        }
      }
    }
    if (!isFinite(minX)) return;
    view.centerLon = (minX + maxX) / 2;
    view.centerLat = (minY + maxY) / 2;
    view.scale = limitarEscala(Math.min(
      Math.max(1, window.innerWidth - 110) / Math.max(maxX - minX, 0.0001),
      Math.max(1, window.innerHeight - 110) / Math.max(maxY - minY, 0.0001)));
  }

  function routeGeometries() {
    return state.segments.length ? state.segments.map(function (t) { return t.geometry; }) : [state.routeGeometry];
  }

  function resize() {
    canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
    canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
    draw();
  }
  window.addEventListener('resize', resize);

  function lonLatToXY(lon, lat) {
    var dpr = window.devicePixelRatio || 1;
    var cx = canvas.width / 2;
    var cy = canvas.height / 2;
    var x = cx + (lon - view.centerLon) * view.scale * dpr;
    var y = cy - (lat - view.centerLat) * view.scale * dpr;
    return [x, y];
  }

  function xyToLonLat(x, y) {
    var dpr = window.devicePixelRatio || 1;
    var cx = canvas.width / 2;
    var cy = canvas.height / 2;
    var lon = view.centerLon + (x * dpr - cx) / (view.scale * dpr);
    var lat = view.centerLat - (y * dpr - cy) / (view.scale * dpr);
    return [lon, lat];
  }

  function drawRing(coords) {
    if (!coords || coords.length < 2) return;
    var p0 = lonLatToXY(coords[0][0], coords[0][1]);
    ctx.moveTo(p0[0], p0[1]);
    for (var i = 1; i < coords.length; i++) {
      var p = lonLatToXY(coords[i][0], coords[i][1]);
      ctx.lineTo(p[0], p[1]);
    }
  }

  function draw() {
    var dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Casca branca
    ctx.beginPath();
    for (var i = 0; i < state.features.length; i++) {
      var g = state.features[i].geometry;
      if (!g) continue;
      if (g.type === 'LineString') drawRing(g.coordinates);
      else if (g.type === 'MultiLineString') {
        for (var r = 0; r < g.coordinates.length; r++) drawRing(g.coordinates[r]);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3.4 * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Núcleo oficial
    ctx.beginPath();
    for (var i2 = 0; i2 < state.features.length; i2++) {
      var f = state.features[i2];
      if (Number(f.properties && f.properties.COD_LOG) === 0) continue;
      var g2 = f.geometry;
      if (!g2) continue;
      if (g2.type === 'LineString') drawRing(g2.coordinates);
      else if (g2.type === 'MultiLineString') {
        for (var r2 = 0; r2 < g2.coordinates.length; r2++) drawRing(g2.coordinates[r2]);
      }
    }
    ctx.strokeStyle = '#4d5f73';
    ctx.lineWidth = 1.6 * dpr;
    ctx.stroke();

    // Núcleo não oficial: mesma cor e tracejado do OpenLayers.
    ctx.beginPath();
    for (var ui = 0; ui < state.features.length; ui++) {
      var uf = state.features[ui];
      if (Number(uf.properties && uf.properties.COD_LOG) !== 0) continue;
      var ul = geometryLines(uf.geometry);
      for (var uj = 0; uj < ul.length; uj++) drawRing(ul[uj]);
    }
    ctx.strokeStyle = '#c2620d'; ctx.lineWidth = 1.7 * dpr;
    ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.stroke(); ctx.setLineDash([]);

    // Rotas alternativas não selecionadas (tracejado discreto)
    for (var ari = 0; ari < state.altRoutes.length; ari++) {
      var altItem = state.altRoutes[ari];
      if (!altItem || !altItem.geometry) continue;
      var altLines = geometryLines(altItem.geometry);
      ctx.setLineDash([10 * dpr, 6 * dpr]);
      for (var al = 0; al < altLines.length; al++) {
        ctx.beginPath(); drawRing(altLines[al]);
        ctx.strokeStyle = 'rgba(100,116,139,0.75)';
        ctx.lineWidth = 4 * dpr;
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Segmentos destacados por ocorrências
    for (var hsi = 0; hsi < state.highlightSegments.length; hsi++) {
      var hSeg = state.highlightSegments[hsi];
      if (!hSeg || !hSeg.geometry) continue;
      var hLines = geometryLines(hSeg.geometry);
      for (var hl = 0; hl < hLines.length; hl++) {
        ctx.beginPath(); drawRing(hLines[hl]);
        ctx.strokeStyle = corOcorrencia(hSeg.classificacao);
        ctx.lineWidth = 6 * dpr;
        ctx.stroke();
      }
    }

    // Trilha GPS real percorrida (nunca substitui a rota calculada)
    if (state.gpsTrailGeometry && state.gpsTrailGeometry.coordinates) {
      var gpsLines = geometryLines(state.gpsTrailGeometry);
      ctx.setLineDash([8 * dpr, 6 * dpr]);
      for (var gl = 0; gl < gpsLines.length; gl++) {
        ctx.beginPath(); drawRing(gpsLines[gl]);
        ctx.strokeStyle = '#047857';
        ctx.lineWidth = 3.5 * dpr;
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Um desenho por perna: ocultar nunca modifica a geometria da rota.
    var segments = state.segments.length ? state.segments : [{ geometry: state.routeGeometry }];
    for (var si = 0; si < segments.length; si++) {
      var segment = segments[si];
      var style = estiloTrecho(segment);
      if (!style.visivel || !segment.geometry) continue;
      var rc = segment.geometry.coordinates;
      var styles = [
        { color: style.haloCor, width: style.halo * dpr },
        { color: style.contornoCor, width: style.contorno * dpr },
        { color: style.nucleoCor, width: style.nucleo * dpr }
      ];
      ctx.setLineDash(style.dash.map(function (v) { return v * dpr; }));
      for (var s = 0; s < styles.length; s++) {
        ctx.beginPath(); drawRing(rc);
        ctx.strokeStyle = styles[s].color; ctx.lineWidth = styles[s].width; ctx.stroke();
      }
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // Marcadores
    for (var m = 0; m < state.markers.length; m++) {
      var mk = state.markers[m];
      if (mk.latitude == null || mk.longitude == null) continue;
      var pt = lonLatToXY(mk.longitude, mk.latitude);
      var col = mk.tipo === 'origem' ? '#2ea043' : mk.tipo === 'destino' ? '#f85149' : '#045127';
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 10 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 2.5 * dpr;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + Math.round(11 * dpr) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mk.rotulo || '', pt[0], pt[1]);
    }
    if (state.position) {
      var np = lonLatToXY(state.position.longitude, state.position.latitude);
      ctx.beginPath(); ctx.arc(np[0], np[1], 7 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = state.position.simulado === true ? '#7c3aed' : '#045127'; ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5 * dpr; ctx.stroke();
    }
    if (state.routeObservations && state.routeObservations.length) {
      for (var cro = 0; cro < state.routeObservations.length; cro++) {
        var rObsItem = state.routeObservations[cro];
        if (!rObsItem || rObsItem.latitude == null || rObsItem.longitude == null) continue;
        var roPt = lonLatToXY(rObsItem.longitude, rObsItem.latitude);
        ctx.beginPath();
        ctx.arc(roPt[0], roPt[1], 8 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = rObsItem.status === 'CONCLUIDA' ? '#15803d' : rObsItem.status === 'REABERTA' ? '#b45309' : '#1d4ed8';
        ctx.fill();
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }
    if (state.showOccurrences && state.occurrences.length) {
      for (var oci = 0; oci < state.occurrences.length; oci++) {
        var oc = state.occurrences[oci];
        var ocLoc = (oc && oc.localizacao) || oc;
        if (!oc || ocLoc.latitude == null || ocLoc.longitude == null) continue;
        var op = lonLatToXY(ocLoc.longitude, ocLoc.latitude);
        ctx.beginPath();
        ctx.arc(op[0], op[1], 10 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = corOcorrencia(oc.classificacao);
        ctx.fill();
        ctx.lineWidth = 2.2 * dpr;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + Math.round(11 * dpr) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glifoCategoria(oc.categoria), op[0], op[1]);
      }
    }
  }

  // Zoom ancorado no ponteiro: o ponto geográfico sob o dedo/cursor não anda.
  function zoomAt(clientX, clientY, fator) {
    if (!isFinite(clientX) || !isFinite(clientY) || !fator || fator <= 0) return false;
    var alvo = limitarEscala(view.scale * fator);
    if (!isFinite(alvo) || Math.abs(alvo - view.scale) < 1e-9) return false;
    var ancora = xyToLonLat(clientX, clientY);
    view.scale = alvo;
    var dpr = window.devicePixelRatio || 1;
    view.centerLon = ancora[0] - (clientX * dpr - canvas.width / 2) / (view.scale * dpr);
    view.centerLat = ancora[1] + (clientY * dpr - canvas.height / 2) / (view.scale * dpr);
    draw();
    return true;
  }

  canvas.addEventListener('wheel', function (e) {
    if (!e.deltaY) return;
    if (e.preventDefault) e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.pow(2, -e.deltaY / 400));
  }, { passive: false });

  canvas.addEventListener('dblclick', function (e) {
    if (e.preventDefault) e.preventDefault();
    zoomAt(e.clientX, e.clientY, 2);
  });

  var ponteiros = {};
  var toque = null;       // arrastar/soltar com um dedo
  var pinca = null;       // dois dedos: distância e centro anteriores
  var ultimoToque = null; // duplo toque no mesmo ponto para aproximar

  function ponteirosAtivos() {
    var lista = [];
    for (var id in ponteiros) if (ponteiros.hasOwnProperty(id)) lista.push(ponteiros[id]);
    return lista;
  }
  function distanciaEntre(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
  function centroEntre(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function iniciarPinca() {
    var lista = ponteirosAtivos();
    if (lista.length < 2) { pinca = null; return; }
    pinca = { distancia: distanciaEntre(lista[0], lista[1]), centro: centroEntre(lista[0], lista[1]) };
    ultimoToque = null;
  }

  canvas.addEventListener('pointerdown', function (e) {
    var id = e.pointerId == null ? 'default' : e.pointerId;
    ponteiros[id] = { x: e.clientX, y: e.clientY };
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(id); } catch (erro) {} }
    if (ponteirosAtivos().length === 1) {
      toque = { x: e.clientX, y: e.clientY, moved: false };
      pinca = null;
    } else {
      toque = null;
      iniciarPinca();
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    var id = e.pointerId == null ? 'default' : e.pointerId;
    if (!ponteiros[id]) {
      if (!toque) return;
      id = 'default';
      ponteiros[id] = { x: toque.x, y: toque.y };
    }
    ponteiros[id] = { x: e.clientX, y: e.clientY };

    if (pinca) {
      var lista = ponteirosAtivos();
      if (lista.length < 2) return;
      var centro = centroEntre(lista[0], lista[1]);
      var distancia = distanciaEntre(lista[0], lista[1]);
      if (pinca.distancia > 0 && distancia > 0) {
        var anterior = pinca;
        pinca = { distancia: distancia, centro: centro };
        zoomAt(centro.x, centro.y, distancia / anterior.distancia);
        view.centerLon -= (centro.x - anterior.centro.x) / view.scale;
        view.centerLat += (centro.y - anterior.centro.y) / view.scale;
        draw();
      }
      return;
    }
    if (!toque) return;
    var dx = e.clientX - toque.x;
    var dy = e.clientY - toque.y;
    if (Math.hypot(dx, dy) > 6) toque.moved = true;
    if (toque.moved) {
      ultimoToque = null;
      view.centerLon -= dx / view.scale;
      view.centerLat += dy / view.scale;
      toque.x = e.clientX;
      toque.y = e.clientY;
      draw();
    }
  });

  function encerrarPonteiro(e) {
    var id = e.pointerId == null ? 'default' : e.pointerId;
    delete ponteiros[id];
    if (pinca) {
      pinca = null;
      toque = null;
      if (ponteirosAtivos().length === 1) {
        var restante = ponteirosAtivos()[0];
        toque = { x: restante.x, y: restante.y, moved: true };
      }
      return;
    }
    if (toque && !toque.moved) {
      var agora = Date.now();
      var mesmoPonto = ultimoToque &&
        Math.hypot(e.clientX - ultimoToque.x, e.clientY - ultimoToque.y) <= 24;
      var intervaloDuplo = ultimoToque && (agora - ultimoToque.t) >= 20 && (agora - ultimoToque.t) <= 320;
      if (e.pointerType === 'touch' && mesmoPonto && intervaloDuplo) {
        ultimoToque = null;
        toque = null;
        zoomAt(e.clientX, e.clientY, 2);
        return;
      }
      if (e.pointerType === 'touch') {
        ultimoToque = { x: e.clientX, y: e.clientY, t: agora };
      }
      var ll = xyToLonLat(e.clientX, e.clientY);
      if (!state.picking && state.showOccurrences && state.occurrences.length) {
        var hitOcc = null;
        var hitDist = Infinity;
        var dprClick = window.devicePixelRatio || 1;
        for (var ho = 0; ho < state.occurrences.length; ho++) {
          var cand = state.occurrences[ho];
          var candLoc = (cand && cand.localizacao) || cand;
          if (!cand || candLoc.latitude == null || candLoc.longitude == null) continue;
          var ptOcc = lonLatToXY(candLoc.longitude, candLoc.latitude);
          var distPx = Math.hypot(ptOcc[0] / dprClick - e.clientX, ptOcc[1] / dprClick - e.clientY);
          if (distPx <= 16 && distPx < hitDist) {
            hitDist = distPx;
            hitOcc = cand;
          }
        }
        if (hitOcc) {
          postToRN({ type: 'OCC_CLICK', id: hitOcc.id });
          toque = null;
          return;
        }
      }
      postToRN({
        type: 'MAP_CLICK',
        lon: ll[0],
        lat: ll[1],
        zoom: zoomDaEscala(view.scale)
      });
    }
    toque = null;
  }

  canvas.addEventListener('pointerup', encerrarPonteiro);
  canvas.addEventListener('pointercancel', function (e) {
    var id = e.pointerId == null ? 'default' : e.pointerId;
    delete ponteiros[id];
    pinca = null;
    toque = null;
  });

  // Controles +/− com a mesma aparência do .ol-zoom, disponíveis sem CDN.
  var caixaZoom = document.getElementById('fallback-zoom');
  if (caixaZoom && caixaZoom !== canvas && caixaZoom.querySelectorAll) {
    caixaZoom.hidden = false;
    caixaZoom.style.display = 'flex';
    var passos = [['#fallback-zoom-in', 2], ['#fallback-zoom-out', 0.5]];
    for (var pz = 0; pz < passos.length; pz++) {
      var botao = document.querySelector(passos[pz][0]);
      if (!botao) continue;
      (function (fator) {
        botao.addEventListener('click', function (e) {
          if (e && e.preventDefault) e.preventDefault();
          zoomAt(window.innerWidth / 2, window.innerHeight / 2, fator);
        });
      })(passos[pz][1]);
    }
  }

  window.__handleRNMessage = function (msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'SET_NETWORK') {
      state.features = msg.features || [];
      if (msg.fit !== false) fitGeometries(state.features.map(function (f) { return f.geometry; }));
      draw();
      postToRN({ type: 'NETWORK_RENDERED', count: state.features.length });
    } else if (msg.type === 'SET_MARKERS') {
      state.markers = msg.markers || [];
      draw();
    } else if (msg.type === 'SET_POSITION') {
      state.position = msg.position && isFinite(msg.position.longitude) && isFinite(msg.position.latitude) ? msg.position : null;
      draw();
    } else if (msg.type === 'SET_ROUTE') {
      state.routeGeometry = msg.geometry || null;
      state.segments = msg.segments || [];
      if (msg.fit !== false) fitGeometries(routeGeometries());
      draw();
    } else if (msg.type === 'RESIZE_MAP') {
      resize();
    } else if (msg.type === 'FIT_NETWORK') {
      fitGeometries(state.features.map(function (f) { return f.geometry; })); draw();
    } else if (msg.type === 'FIT_ROUTE') {
      fitGeometries(routeGeometries()); draw();
    } else if (msg.type === 'CENTER_POINT') {
      if (msg.lon != null && msg.lat != null) {
        view.centerLon = msg.lon;
        view.centerLat = msg.lat;
        // Mesmo critério do OpenLayers: centralizar aproxima até o zoom 17,
        // sem afastar quem já está mais perto.
        if (zoomDaEscala(view.scale) < 17) view.scale = escalaDoZoom(17);
        draw();
      }
    } else if (msg.type === 'SET_BASEMAP') {
      var proximoBase = normalizarCamadaBase(msg.mode);
      state.basemapMode = proximoBase;
      if (proximoBase === CAMADA_SATELITE) {
        postToRN({
          type: 'BASEMAP_STATUS',
          mode: CAMADA_SATELITE,
          status: 'unavailable',
          message: 'Satélite indisponível sem conexão; exibindo malha viária local.'
        });
      } else {
        postToRN({
          type: 'BASEMAP_STATUS',
          mode: CAMADA_PADRAO,
          status: 'ready',
          message: ''
        });
      }
    } else if (msg.type === 'SET_PICKING') {
      state.picking = !!msg.picking;
    } else if (msg.type === 'SET_ALT_ROUTES') {
      state.altRoutes = msg.altRoutes || [];
      draw();
    } else if (msg.type === 'SET_HIGHLIGHT_SEGMENTS') {
      state.highlightSegments = msg.segments || [];
      draw();
    } else if (msg.type === 'SET_OCCURRENCES') {
      state.occurrences = msg.occurrences || [];
      draw();
    } else if (msg.type === 'SET_SHOW_OCCURRENCES') {
      state.showOccurrences = msg.show !== false;
      draw();
    } else if (msg.type === 'SET_GPS_TRAIL') {
      state.gpsTrailGeometry = msg.geometry || null;
      draw();
    } else if (msg.type === 'SET_ROUTE_OBS') {
      state.routeObservations = msg.observations || [];
      draw();
    }
  };

  resize();
  postToRN({ type: 'MAP_READY', engine: 'canvas-fallback' });
  }
  // CDN indisponível ou lento não pode impedir o mapa vetorial local.
  // CSS é carregado dinamicamente para não bloquear o início do Canvas.
  if (window.ol) { iniciarMapa(); return; }
  var iniciado = false;
  var script = document.createElement('script');
  var prazo = setTimeout(iniciar, 3000);
  function iniciar() {
    if (iniciado) return;
    iniciado = true; clearTimeout(prazo);
    script.onload = script.onerror = null;
    if (window.ol) {
      var css = document.createElement('link'); css.rel = 'stylesheet';
      css.href = 'https://cdn.jsdelivr.net/npm/ol@v10.2.1/ol.css'; document.head.appendChild(css);
    }
    iniciarMapa();
  }
  script.async = true;
  script.src = 'https://cdn.jsdelivr.net/npm/ol@v10.2.1/dist/ol.js';
  script.onload = iniciar; script.onerror = iniciar;
  document.head.appendChild(script);

})();
</script>
</body>
</html>`;
