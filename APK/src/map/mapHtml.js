import { ESTILO_TRECHO_JS } from './styleScript.js';

export const MAP_HTML = `<!DOCTYPE html>
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

  var estiloTrecho = ${ESTILO_TRECHO_JS};

  var state = {
    features: [],
    routeGeometry: null,
    segments: [],
    position: null,
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
    map.addLayer(new ol.layer.Vector({ source: positionSource,
      style: function (feature) { return new ol.style.Style({ image: new ol.style.Circle({ radius: 7,
        fill: new ol.style.Fill({ color: feature.get('simulado') ? '#7c3aed' : '#045127' }),
        stroke: new ol.style.Stroke({ color: '#ffffff', width: 2.5 }) }) }); }
    }));

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
          map.getView().fit(rExt, { padding: [55, 55, 55, 55], maxZoom: 17, duration: 500 });
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
    view.scale = Math.min(Math.max(1, window.innerWidth - 110) / Math.max(maxX - minX, 0.0001),
      Math.max(1, window.innerHeight - 110) / Math.max(maxY - minY, 0.0001));
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
      fitGeometries(state.features.map(function (f) { return f.geometry; }));
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
    } else if (msg.type === 'FIT_NETWORK') {
      fitGeometries(state.features.map(function (f) { return f.geometry; })); draw();
    } else if (msg.type === 'FIT_ROUTE') {
      fitGeometries(routeGeometries()); draw();
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
