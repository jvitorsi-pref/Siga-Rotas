/**
 * COMPONENTE DE MAPA CARTOGRÁFICO INTERATIVO (REACT NATIVE)
 * =========================================================
 *
 * Renderiza a malha viária de Santo André (`siga:SIGA_EIXO_LOG_OFICIAL_E_NAO`),
 * a rota calculada em 3 camadas e os marcadores rotulados (A, B, C, D…)
 * preservando a cartografia exata do projeto original:
 *
 *  • Base OpenStreetMap clareada e dessaturada;
 *  • Rede viária em duas camadas (casca branca 3,6 px + núcleo azul-cinza 1,8 px);
 *  • Eixos não oficializados (`COD_LOG = 0`) em laranja tracejado (`#c2620d`);
 *  • Rota em três níveis (halo branco 9 px, contorno escuro 6,4 px, núcleo âmbar 3,6 px);
 *  • Marcadores circulares com rótulo (A, B, C…) e cores por papel (origem, parada, destino);
 *  • Fallback vetorial Canvas HTML5 embutido caso o aparelho esteja 100% offline.
 */

import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { COLORS } from '../theme/colors';

const MAP_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@v10.2.1/ol.css" />
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
    filter: grayscale(0.82) brightness(1.19) contrast(0.8) saturate(0.45);
    opacity: 0.95;
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
  .ol-attribution { display: none !important; }
  #fallback-canvas {
    display: none;
    width: 100%;
    height: 100%;
    background: #e9eef2;
  }
</style>
</head>
<body>
<div id="map"></div>
<canvas id="fallback-canvas"></canvas>

<script src="https://cdn.jsdelivr.net/npm/ol@v10.2.1/dist/ol.js"></script>
<script>
(function () {
  function postToRN(payload) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  var state = {
    features: [],
    routeGeometry: null,
    markers: [],
    picking: false
  };

  // =========================================================================
  // MODO 1: OpenLayers 10 (com mapa-base OSM + camadas vetoriais)
  // =========================================================================
  if (window.ol) {
    var ol = window.ol;
    var map = new ol.Map({
      target: document.getElementById('map'),
      layers: [
        new ol.layer.Tile({
          className: 'basemap',
          source: new ol.source.OSM()
        })
      ],
      view: new ol.View({
        center: ol.proj.fromLonLat([-46.4255, -23.7031]),
        zoom: 13,
        maxZoom: 19
      })
    });

    var axisCasingSource = new ol.source.Vector({ features: [] });
    var axisCasingLayer = new ol.layer.Vector({
      source: axisCasingSource,
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
      declutter: true,
      style: function (feature) {
        return Number(feature.get('COD_LOG')) === 0 ? styleUnofficial : styleOfficial;
      }
    });

    var routeSource = new ol.source.Vector({ features: [] });
    var routeLayer = new ol.layer.Vector({
      source: routeSource,
      style: [
        new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: 'rgba(255,255,255,0.95)',
            width: 9,
            lineCap: 'round',
            lineJoin: 'round'
          })
        }),
        new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: 'rgba(23,32,48,0.85)',
            width: 6.4,
            lineCap: 'round',
            lineJoin: 'round'
          })
        }),
        new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: '#ffc233',
            width: 3.6,
            lineCap: 'round',
            lineJoin: 'round'
          })
        })
      ]
    });

    var markerSource = new ol.source.Vector({ features: [] });
    var markerLayer = new ol.layer.Vector({
      source: markerSource,
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

    var geojson = new ol.format.GeoJSON({
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857'
    });

    function isExtentValid(ext) {
      return ext && ext.length === 4 && isFinite(ext[0]) && isFinite(ext[2]);
    }

    map.on('singleclick', function (evt) {
      var lonLat = ol.proj.toLonLat(evt.coordinate);
      postToRN({
        type: 'MAP_CLICK',
        lon: lonLat[0],
        lat: lonLat[1]
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
        if (isExtentValid(ext)) {
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
      } else if (msg.type === 'SET_ROUTE') {
        routeSource.clear();
        var geom = msg.geometry;
        if (geom && geom.coordinates && geom.coordinates.length >= 2) {
          var rf = geojson.readFeature({
            type: 'Feature',
            properties: {},
            geometry: geom
          });
          routeSource.addFeature(rf);
          var rExt = rf.getGeometry().getExtent();
          if (isExtentValid(rExt)) {
            map.getView().fit(rExt, { padding: [55, 55, 55, 55], maxZoom: 17, duration: 500 });
          }
        }
      } else if (msg.type === 'CENTER_POINT') {
        if (msg.lon != null && msg.lat != null) {
          map.getView().animate({
            center: ol.proj.fromLonLat([msg.lon, msg.lat]),
            zoom: Math.max(map.getView().getZoom() || 15, 17),
            duration: 450
          });
        }
      } else if (msg.type === 'FIT_NETWORK') {
        var nExt = axisSource.getExtent();
        if (isExtentValid(nExt)) {
          map.getView().fit(nExt, { padding: [30, 30, 30, 30], maxZoom: 15, duration: 450 });
        }
      } else if (msg.type === 'FIT_ROUTE') {
        var rtExt = routeSource.getExtent();
        if (isExtentValid(rtExt)) {
          map.getView().fit(rtExt, { padding: [55, 55, 55, 55], maxZoom: 17, duration: 450 });
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
    scale: 18000 // pixels por grau
  };

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
    ctx.fillStyle = '#e5eaef';
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

    // Rota
    if (state.routeGeometry && state.routeGeometry.coordinates) {
      var rc = state.routeGeometry.coordinates;
      var styles = [
        { color: 'rgba(255,255,255,0.95)', width: 9 * dpr },
        { color: 'rgba(23,32,48,0.85)', width: 6.4 * dpr },
        { color: '#ffc233', width: 3.6 * dpr }
      ];
      for (var s = 0; s < styles.length; s++) {
        ctx.beginPath();
        drawRing(rc);
        ctx.strokeStyle = styles[s].color;
        ctx.lineWidth = styles[s].width;
        ctx.stroke();
      }
    }

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
  }

  var touchStart = null;
  canvas.addEventListener('pointerdown', function (e) {
    touchStart = { x: e.clientX, y: e.clientY, moved: false };
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!touchStart) return;
    var dx = e.clientX - touchStart.x;
    var dy = e.clientY - touchStart.y;
    if (Math.hypot(dx, dy) > 6) touchStart.moved = true;
    if (touchStart.moved) {
      view.centerLon -= dx / view.scale;
      view.centerLat += dy / view.scale;
      touchStart.x = e.clientX;
      touchStart.y = e.clientY;
      draw();
    }
  });
  canvas.addEventListener('pointerup', function (e) {
    if (touchStart && !touchStart.moved) {
      var ll = xyToLonLat(e.clientX, e.clientY);
      postToRN({ type: 'MAP_CLICK', lon: ll[0], lat: ll[1] });
    }
    touchStart = null;
  });

  window.__handleRNMessage = function (msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'SET_NETWORK') {
      state.features = msg.features || [];
      draw();
      postToRN({ type: 'NETWORK_RENDERED', count: state.features.length });
    } else if (msg.type === 'SET_MARKERS') {
      state.markers = msg.markers || [];
      draw();
    } else if (msg.type === 'SET_ROUTE') {
      state.routeGeometry = msg.geometry || null;
      draw();
    } else if (msg.type === 'CENTER_POINT') {
      if (msg.lon != null && msg.lat != null) {
        view.centerLon = msg.lon;
        view.centerLat = msg.lat;
        draw();
      }
    }
  };

  resize();
  postToRN({ type: 'MAP_READY', engine: 'canvas-fallback' });
})();
</script>
</body>
</html>`;

export const RoadNetworkMap = forwardRef(function RoadNetworkMap(
  {
    features,
    markers,
    routeGeometry,
    pickingPoint,
    onCancelPick,
    onMapPickCoordinate,
  },
  ref
) {
  const webviewRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [showLegend, setShowLegend] = useState(true);

  const sendMessageToMap = (payload) => {
    if (!webviewRef.current || !mapReady) return;
    const script = `window.__handleRNMessage && window.__handleRNMessage(${JSON.stringify(payload)}); true;`;
    webviewRef.current.injectJavaScript(script);
  };

  useImperativeHandle(ref, () => ({
    centerPoint(lon, lat) {
      sendMessageToMap({ type: 'CENTER_POINT', lon, lat });
    },
    fitNetwork() {
      sendMessageToMap({ type: 'FIT_NETWORK' });
    },
    fitRoute() {
      sendMessageToMap({ type: 'FIT_ROUTE' });
    },
  }));

  // Envia a rede viária para o mapa assim que ambos estiverem prontos
  useEffect(() => {
    if (mapReady && Array.isArray(features) && features.length > 0) {
      sendMessageToMap({ type: 'SET_NETWORK', features });
    }
  }, [mapReady, features]);

  // Atualiza os marcadores (A, B, C, D…)
  useEffect(() => {
    if (mapReady) {
      sendMessageToMap({ type: 'SET_MARKERS', markers: markers || [] });
    }
  }, [mapReady, markers]);

  // Atualiza a geometria da rota
  useEffect(() => {
    if (mapReady) {
      sendMessageToMap({ type: 'SET_ROUTE', geometry: routeGeometry || null });
    }
  }, [mapReady, routeGeometry]);

  const handleWebViewMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') {
        setMapReady(true);
      } else if (data.type === 'MAP_CLICK') {
        if (onMapPickCoordinate) {
          onMapPickCoordinate({ lon: data.lon, lat: data.lat });
        }
      }
    } catch {
      /* ignora mensagem malformada */
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: MAP_HTML }}
        style={styles.webview}
        onMessage={handleWebViewMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        mixedContentMode="always"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      />

      {!mapReady && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Inicializando mapa cartográfico…</Text>
        </View>
      )}

      {/* Banner de seleção de ponto no mapa (idêntico ao pick-banner web) */}
      {pickingPoint && (
        <View style={styles.pickBanner}>
          <Text style={styles.pickBannerText}>
            Toque no mapa para definir o ponto{' '}
            <Text style={styles.pickBannerBold}>{pickingPoint.rotulo}</Text>
          </Text>
          <TouchableOpacity style={styles.pickCancelBtn} onPress={onCancelPick}>
            <Text style={styles.pickCancelText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Controles flutuantes rápidos do mapa */}
      <View style={styles.quickControls}>
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => sendMessageToMap({ type: 'FIT_NETWORK' })}
        >
          <Text style={styles.controlBtnText}>🗺 Rede</Text>
        </TouchableOpacity>
        {routeGeometry?.coordinates?.length >= 2 && (
          <TouchableOpacity
            style={styles.controlBtn}
            onPress={() => sendMessageToMap({ type: 'FIT_ROUTE' })}
          >
            <Text style={styles.controlBtnText}>📍 Rota</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => setShowLegend((v) => !v)}
        >
          <Text style={styles.controlBtnText}>{showLegend ? '▾ Legenda' : '▴ Legenda'}</Text>
        </TouchableOpacity>
      </View>

      {/* Legenda cartográfica nativa */}
      {showLegend && (
        <View style={styles.legend}>
          <View style={styles.legendRow}>
            <View style={[styles.swatchLine, { backgroundColor: COLORS.axis }]} />
            <Text style={styles.legendText}>Eixo viário oficial</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.swatchLine, { backgroundColor: COLORS.axisUnofficial }]} />
            <Text style={styles.legendText}>Eixo não oficializado</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.swatchRoute, { backgroundColor: COLORS.route }]} />
            <Text style={styles.legendText}>Rota calculada</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.swatchDot, { backgroundColor: COLORS.origin }]} />
            <Text style={styles.legendText}>Origem (A)</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.swatchDot, { backgroundColor: COLORS.stop }]} />
            <Text style={styles.legendText}>Parada intermediária</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.swatchDot, { backgroundColor: COLORS.dest }]} />
            <Text style={styles.legendText}>Destino</Text>
          </View>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.inputBg,
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  pickBanner: {
    position: 'absolute',
    top: 12,
    left: 14,
    right: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderColor: COLORS.accent,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 6,
  },
  pickBannerText: {
    color: COLORS.text,
    fontSize: 12.5,
    flex: 1,
    marginRight: 8,
  },
  pickBannerBold: {
    fontWeight: '700',
    color: COLORS.accent,
  },
  pickCancelBtn: {
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 5,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  pickCancelText: {
    color: COLORS.muted,
    fontSize: 11.5,
  },
  quickControls: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    gap: 6,
  },
  controlBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  controlBtnText: {
    color: COLORS.accent,
    fontSize: 11.5,
    fontWeight: '600',
  },
  legend: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swatchLine: {
    width: 16,
    height: 3,
    borderRadius: 2,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  swatchRoute: {
    width: 16,
    height: 5,
    borderRadius: 2,
  },
  swatchDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  legendText: {
    color: COLORS.textSecondary,
    fontSize: 11,
  },
});
