/** Sincroniza dados/câmera sem recriar a WebView ao alternar o layout. */
const VAZIO = [];
export function criarSincronizacaoMapa(enviar) {
  let ultimo = {}, pronto = false, visivel = false, enquadrado = false, pendente = null, comandoPendente = null, origemComando = null;
  function comando(payload) {
    if (!pronto || !visivel) { comandoPendente = payload; origemComando = 'imperativo'; return; }
    comandoPendente = null; origemComando = null;
    pendente = null; enquadrado = true; enviar(payload);
  }
  function redimensionar() { if (pronto && visivel) enviar({ type: 'RESIZE_MAP' }); }
  function atualizar(p) {
    pronto = !!p.ready; visivel = p.visible !== false;
    if (!pronto) return;
    if (ultimo.session !== p.session) { ultimo = {}; enquadrado = false; pendente = null; }
    const features = p.features || VAZIO, geometry = p.routeGeometry || null;
    if (ultimo.features !== features) {
      enviar({ type: 'SET_NETWORK', features, fit: false });
      if (features.length && !enquadrado && pendente !== 'route') pendente = 'network';
    }
    if (ultimo.markers !== p.markers) enviar({ type: 'SET_MARKERS', markers: p.markers || VAZIO });
    if (ultimo.routeGeometry !== geometry || ultimo.routeSegments !== p.routeSegments || ultimo.suppressRouteFit !== p.suppressRouteFit) {
      enviar({ type: 'SET_ROUTE', geometry, segments: p.routeSegments || VAZIO, fit: false });
      if (geometry && ultimo.routeGeometry !== geometry && !p.suppressRouteFit) pendente = 'route';
      if ((!geometry || p.suppressRouteFit) && pendente === 'route') pendente = !enquadrado && features.length ? 'network' : null;
    }
    if (ultimo.position !== p.navigationPosition) enviar({ type: 'SET_POSITION', position: p.navigationPosition || null });
    if (p.centerRequest && p.centerRequest !== ultimo.centerRequest) {
      comandoPendente = { type: 'CENTER_POINT', lon: p.centerRequest.longitude, lat: p.centerRequest.latitude };
      origemComando = 'prop';
    } else if (!p.centerRequest && origemComando === 'prop') {
      comandoPendente = null; origemComando = null;
    }
    if (visivel && ultimo.visible !== true) redimensionar();
    if (visivel && comandoPendente) {
      const payload = comandoPendente; comandoPendente = null; comando(payload);
    } else if (visivel && pendente) {
      enviar({ type: pendente === 'route' ? 'FIT_ROUTE' : 'FIT_NETWORK' }); pendente = null; enquadrado = true;
    }
    ultimo = { ...p, features, routeGeometry: geometry, position: p.navigationPosition, visible: visivel };
  }
  return { atualizar, comando, redimensionar };
}
