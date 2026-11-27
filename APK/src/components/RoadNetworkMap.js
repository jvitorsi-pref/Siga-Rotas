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
  ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { COLORS } from '../theme/colors';

import { criarSincronizacaoMapa } from '../map/mapSync.js';
import { MAP_HTML } from '../map/mapHtml.js';
import { CAMADA_PADRAO, CAMADA_SATELITE, opcoesCamadasBase, normalizarCamadaBase } from '../map/camadaBase.js';
import { CATEGORIAS_OCORRENCIA } from '../ocorrencias/catalogo.js';
const MAP_SOURCE = { html: MAP_HTML };

function WarningIcon({ active = false }) {
  const triangleColor = active ? COLORS.white : COLORS.accent;
  const markColor = active ? COLORS.accent : COLORS.white;
  return (
    <View style={styles.warnIconBox} accessible={false}>
      <View style={[styles.warnTriangle, { borderBottomColor: triangleColor }]} />
      <Text style={[styles.warnExclamation, { color: markColor }]}>!</Text>
    </View>
  );
}

function CenterIcon({ color = COLORS.accent }) {
  return (
    <View style={styles.centerIconBox} accessible={false}>
      <View style={[styles.centerIconRing, { borderColor: color }]} />
      <View style={[styles.centerIconDot, { backgroundColor: color }]} />
      <View style={[styles.centerTickTop, { backgroundColor: color }]} />
      <View style={[styles.centerTickBottom, { backgroundColor: color }]} />
      <View style={[styles.centerTickLeft, { backgroundColor: color }]} />
      <View style={[styles.centerTickRight, { backgroundColor: color }]} />
    </View>
  );
}

export const RoadNetworkMap = forwardRef(function RoadNetworkMap(
  {
    features,
    visible = true,
    bottomInsetPx = 0,
    basemapMode = CAMADA_PADRAO,
    onChangeBasemap,
    markers,
    routeGeometry,
    routeSegments,
    navigationPosition,
    centerRequest,
    isSimulating,
    isGPS,
    suppressRouteFit = false,
    onToggleSegment,
    onRestoreSegments,
    pickingPoint,
    onCancelPick,
    onMapPickCoordinate,
    onMapClick,
    occurrences,
    showOccurrences,
    occCategoryFilter = null,
    onChangeOccCategoryFilter,
    visitMarkers,
    onVisitMarkerClick,
    altRoutes,
    highlightSegments,
    pickingOccurrence = false,
    onCancelPickOccurrence,
    onMapPickOccurrence,
    onOccurrenceClick,
    onAltRouteClick,
    onToggleOccurrences,
    onStartPickOccurrence,
    onRequestCurrentLocation,
    locatingCurrent = false,
    locationFeedback = null,
    gpsTrailGeometry,
    routeObservations,
    pickingRouteObs = false,
    onCancelPickRouteObs,
    onMapPickRouteObs,
    onRouteObservationClick,
  },
  ref
) {
  const webviewRef = useRef(null);
  const syncRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapSession, setMapSession] = useState(0);
  const [showLegend, setShowLegend] = useState(false);
  const [occMenuOpen, setOccMenuOpen] = useState(false);
  const [basemapStatus, setBasemapStatus] = useState(null);
  const modoBaseAtivo = normalizarCamadaBase(basemapMode);
  const opcoesBase = opcoesCamadasBase();

  if (!syncRef.current) syncRef.current = criarSincronizacaoMapa(payload => {
    if (!webviewRef.current) return;
    const script = `window.__handleRNMessage && window.__handleRNMessage(${JSON.stringify(payload)}); true;`;
    webviewRef.current.injectJavaScript(script);
  });
  const sendMessageToMap = payload => syncRef.current.comando(payload);

  useImperativeHandle(ref, () => ({
    centerPoint(lon, lat) { sendMessageToMap({ type: 'CENTER_POINT', lon, lat }); },
    fitNetwork() { sendMessageToMap({ type: 'FIT_NETWORK' }); },
    fitRoute() { sendMessageToMap({ type: 'FIT_ROUTE' }); },
  }));

  useEffect(() => {
    syncRef.current.atualizar({ ready: mapReady, session: mapSession, visible,
      basemapMode: modoBaseAtivo,
      ...(bottomInsetPx > 0 ? { bottomInsetPx } : {}),
      features, markers, routeGeometry, routeSegments, navigationPosition,
      centerRequest, suppressRouteFit,
      ...(occurrences !== undefined ? { occurrences } : {}),
      ...(showOccurrences !== undefined ? { showOccurrences } : {}),
      ...(occCategoryFilter !== null && occCategoryFilter !== undefined ? { occCategoryFilter } : {}),
      ...(visitMarkers !== undefined ? { visitMarkers } : {}),
      ...(altRoutes !== undefined ? { altRoutes } : {}),
      ...(highlightSegments !== undefined ? { highlightSegments } : {}),
      ...(gpsTrailGeometry !== undefined ? { gpsTrailGeometry } : {}),
      ...(routeObservations !== undefined ? { routeObservations } : {}),
      ...(pickingPoint || pickingOccurrence || pickingRouteObs ? { picking: true } : occurrences !== undefined ? { picking: false } : {}) });
  }, [mapReady, mapSession, visible, bottomInsetPx, modoBaseAtivo, features, markers, routeGeometry, routeSegments, navigationPosition, centerRequest, suppressRouteFit, occurrences, showOccurrences, occCategoryFilter, visitMarkers, altRoutes, highlightSegments, gpsTrailGeometry, routeObservations, pickingPoint, pickingOccurrence, pickingRouteObs]);

  useEffect(() => {
    if (modoBaseAtivo === CAMADA_PADRAO) {
      setBasemapStatus(null);
    }
  }, [modoBaseAtivo]);

  useEffect(() => {
    if (!visible) {
      setOccMenuOpen(false);
    }
  }, [visible]);

  const handleWebViewMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') {
        setMapReady(true);
        setMapSession(n => n + 1);
      } else if (data.type === 'BASEMAP_STATUS') {
        if (data.status === 'offline' || data.status === 'unavailable') {
          setBasemapStatus({ status: data.status, message: data.message });
        } else {
          setBasemapStatus(null);
        }
      } else if (data.type === 'OCC_CLICK') {
        setOccMenuOpen(false);
        if (onOccurrenceClick) onOccurrenceClick(data.id);
      } else if (data.type === 'VISIT_CLICK') {
        setOccMenuOpen(false);
        if (onVisitMarkerClick) onVisitMarkerClick(data.visitaId);
      } else if (data.type === 'ROUTE_OBS_CLICK') {
        setOccMenuOpen(false);
        if (onRouteObservationClick) onRouteObservationClick(data.idCliente);
      } else if (data.type === 'ALT_ROUTE_CLICK') {
        setOccMenuOpen(false);
        if (onAltRouteClick) onAltRouteClick(data.id);
      } else if (data.type === 'MAP_CLICK') {
        setOccMenuOpen(false);
        // Com a seleção de ponto, observação ou ocorrência ativa, o toque define o alvo.
        if (pickingPoint && onMapPickCoordinate) {
          onMapPickCoordinate({ lon: data.lon, lat: data.lat });
        } else if (pickingRouteObs && onMapPickRouteObs) {
          onMapPickRouteObs({ lon: data.lon, lat: data.lat });
        } else if (pickingOccurrence && onMapPickOccurrence) {
          onMapPickOccurrence({ lon: data.lon, lat: data.lat });
        } else if (onMapClick) {
          onMapClick({ lon: data.lon, lat: data.lat, zoom: data.zoom });
        }
      }
    } catch {
      /* ignora mensagem malformada */
    }
  };

  return (
    <View style={styles.container} onLayout={() => syncRef.current.redimensionar()}>
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={MAP_SOURCE}
        style={styles.webview}
        onMessage={handleWebViewMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        mixedContentMode="always"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      />

      {/* Seletor de mapa de fundo (Mapa padrão / Satélite) */}
      <View style={styles.basemapControl}>
        <View
          style={styles.basemapSwitch}
          accessibilityRole="radiogroup"
          accessibilityLabel="Mapa de fundo"
        >
          {opcoesBase.map((opcao, idx) => {
            const ativo = modoBaseAtivo === opcao.id;
            return (
              <TouchableOpacity
                key={opcao.id}
                style={[
                  styles.basemapBtn,
                  idx > 0 && styles.basemapBtnBorder,
                  ativo && styles.basemapBtnActive,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: ativo }}
                onPress={() => onChangeBasemap?.(opcao.id)}
              >
                <Text
                  style={[
                    styles.basemapBtnText,
                    ativo && styles.basemapBtnTextActive,
                  ]}
                >
                  {opcao.rotulo}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {modoBaseAtivo === CAMADA_SATELITE && basemapStatus?.message ? (
          <View style={styles.basemapNotice}>
            <Text style={styles.basemapNoticeText}>{basemapStatus.message}</Text>
            <TouchableOpacity
              style={styles.basemapNoticeBtn}
              accessibilityRole="button"
              onPress={() => onChangeBasemap?.(CAMADA_PADRAO)}
            >
              <Text style={styles.basemapNoticeBtnText}>Usar mapa padrão</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {(isSimulating || isGPS) && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 50, left: 12, right: 58, padding: 7, borderWidth: 1, borderColor: COLORS.accent, backgroundColor: COLORS.panel, borderRadius: 7 }}>
          <Text style={{ color: COLORS.accent, fontSize: 11, fontWeight: '700' }}>{isSimulating ? 'MODO DE TESTE — posição simulada, não é GPS real' : 'GPS real — grava em segundo plano até encerrar'}</Text>
        </View>
      )}
      {locationFeedback?.message ? (
        <View style={[styles.basemapNotice, styles.locationBanner]} accessibilityRole="alert">
          <Text style={[styles.basemapNoticeText, { color: locationFeedback.status === 'error' ? '#b91c1c' : COLORS.warn }]}>
            {locationFeedback.message}
          </Text>
        </View>
      ) : null}
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
      {!pickingPoint && pickingRouteObs && (
        <View style={styles.pickBanner}>
          <Text style={styles.pickBannerText}>
            Toque no mapa para marcar a{' '}
            <Text style={styles.pickBannerBold}>observação da rota</Text>
          </Text>
          <TouchableOpacity style={styles.pickCancelBtn} onPress={onCancelPickRouteObs}>
            <Text style={styles.pickCancelText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}
      {!pickingPoint && !pickingRouteObs && pickingOccurrence && (
        <View style={styles.pickBanner}>
          <Text style={styles.pickBannerText}>
            Toque sobre uma via no mapa para sinalizar uma{' '}
            <Text style={styles.pickBannerBold}>ocorrência</Text>
          </Text>
          <TouchableOpacity style={styles.pickCancelBtn} onPress={onCancelPickOccurrence}>
            <Text style={styles.pickCancelText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}

      {occMenuOpen && (
        <TouchableOpacity
          style={styles.popoverBackdrop}
          activeOpacity={1}
          accessibilityRole="button"
          accessibilityLabel="Fechar menu de ocorrências"
          onPress={() => setOccMenuOpen(false)}
        />
      )}

      {/* Controles flutuantes rápidos do mapa (alinhados no canto inferior direito, acima do painel retrátil) */}
      <View style={[styles.quickControls, { bottom: 12 + Math.max(0, Number(bottomInsetPx) || 0) }]}>
        {occMenuOpen && (typeof onStartPickOccurrence === 'function' || typeof onToggleOccurrences === 'function') && (
          <View style={styles.occPopover} accessibilityRole="menu">
            {typeof onStartPickOccurrence === 'function' && (
              <TouchableOpacity
                style={[styles.popoverItem, pickingOccurrence && styles.popoverItemActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: !!pickingOccurrence }}
                onPress={() => {
                  setOccMenuOpen(false);
                  if (pickingOccurrence) onCancelPickOccurrence?.();
                  else onStartPickOccurrence();
                }}
              >
                <Text style={[styles.popoverItemIcon, pickingOccurrence && styles.popoverItemTextActive]}>
                  +
                </Text>
                <Text style={[styles.popoverItemText, pickingOccurrence && styles.popoverItemTextActive]}>
                  Nova Ocorrência
                </Text>
              </TouchableOpacity>
            )}
            {typeof onToggleOccurrences === 'function' && (
              <TouchableOpacity
                style={[
                  styles.popoverItem,
                  typeof onStartPickOccurrence === 'function' && styles.popoverItemBorder,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: showOccurrences !== false }}
                onPress={onToggleOccurrences}
              >
                <Text style={styles.popoverItemIcon}>
                  {showOccurrences !== false ? '✓' : '○'}
                </Text>
                <Text style={styles.popoverItemText}>Visualizar</Text>
                <View
                  style={[
                    styles.popoverBadge,
                    showOccurrences !== false ? styles.popoverBadgeOn : styles.popoverBadgeOff,
                  ]}
                >
                  <Text
                    style={[
                      styles.popoverBadgeText,
                      showOccurrences !== false ? styles.popoverBadgeTextOn : styles.popoverBadgeTextOff,
                    ]}
                  >
                    {showOccurrences !== false ? 'Ativo' : 'Oculto'}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            {typeof onChangeOccCategoryFilter === 'function' && (
              <View style={styles.occCategorySection}>
                <Text style={styles.occCategoryTitle}>Filtrar categorias no mapa</Text>
                <View style={styles.occCategoryWrap}>
                  <TouchableOpacity
                    style={[styles.occCategoryChip, !occCategoryFilter && styles.occCategoryChipActive]}
                    onPress={() => onChangeOccCategoryFilter(null)}
                  >
                    <Text style={[styles.occCategoryChipText, !occCategoryFilter && styles.occCategoryChipTextActive]}>
                      Todas
                    </Text>
                  </TouchableOpacity>
                  {CATEGORIAS_OCORRENCIA.map((cat) => {
                    const ativa = occCategoryFilter === cat.id;
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        style={[styles.occCategoryChip, ativa && styles.occCategoryChipActive]}
                        onPress={() => onChangeOccCategoryFilter(ativa ? null : cat.id)}
                      >
                        <Text style={[styles.occCategoryChipText, ativa && styles.occCategoryChipTextActive]}>
                          {cat.icone} {cat.rotulo}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        )}

        {(typeof onStartPickOccurrence === 'function' || typeof onToggleOccurrences === 'function') && (
          <TouchableOpacity
            style={[styles.iconControlBtn, (pickingOccurrence || occMenuOpen) && styles.controlBtnActive]}
            accessibilityRole="button"
            accessibilityLabel="Ocorrências"
            accessibilityState={{ expanded: occMenuOpen }}
            onPress={() => {
              setShowLegend(false);
              setOccMenuOpen((v) => !v);
            }}
          >
            <WarningIcon active={pickingOccurrence || occMenuOpen} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.iconControlBtn, locatingCurrent && styles.controlBtnLocating]}
          accessibilityRole="button"
          accessibilityLabel="Centralizar na localização atual"
          disabled={locatingCurrent}
          onPress={() => {
            setOccMenuOpen(false);
            onRequestCurrentLocation?.();
          }}
        >
          {locatingCurrent ? (
            <ActivityIndicator size="small" color="#0284c7" />
          ) : (
            <CenterIcon color="#0284c7" />
          )}
        </TouchableOpacity>

        {routeGeometry?.coordinates?.length >= 2 && (
          <TouchableOpacity
            style={styles.controlBtn}
            accessibilityRole="button"
            accessibilityLabel="Centralizar rota no mapa"
            onPress={() => {
              setOccMenuOpen(false);
              sendMessageToMap({ type: 'FIT_ROUTE' });
            }}
          >
            <Text style={styles.controlBtnText}>Rota</Text>
          </TouchableOpacity>
        )}

        {!showLegend ? (
          <TouchableOpacity
            style={styles.controlBtn}
            accessibilityRole="button"
            accessibilityLabel="Abrir legenda"
            accessibilityState={{ expanded: false }}
            onPress={() => {
              setOccMenuOpen(false);
              setShowLegend(true);
            }}
          >
            <Text style={styles.controlBtnText}>Legenda</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.legend}>
            <ScrollView style={{ maxHeight: 190 }} contentContainerStyle={{ flexGrow: 1 }}>
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.legendBody}
                accessibilityRole="button"
                accessibilityLabel="Fechar legenda"
                onPress={() => setShowLegend(false)}
              >
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
                  <View style={[styles.swatchDot, { backgroundColor: '#0ea5e9' }]} />
                  <Text style={styles.legendText}>Sua localização (GPS)</Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.swatchDot, { backgroundColor: COLORS.origin }]} />
                  <Text style={styles.legendText}>Origem e destino (A)</Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.swatchDot, { backgroundColor: COLORS.stop }]} />
                  <Text style={styles.legendText}>Parada intermediária</Text>
                </View>
                {!!visitMarkers?.length && (
                  <>
                    <View style={styles.legendRow}>
                      <View style={[styles.swatchDiamond, { backgroundColor: '#0f766e' }]} />
                      <Text style={styles.legendText}>Visitas planejadas ({visitMarkers.length})</Text>
                    </View>
                    {visitMarkers.some((v) => v.status === 'oportunistica_sugerida') && (
                      <View style={styles.legendRow}>
                        <View style={[styles.swatchDiamond, { backgroundColor: '#7c3aed' }]} />
                        <Text style={styles.legendText}>Sugestão próxima ao trajeto</Text>
                      </View>
                    )}
                  </>
                )}
                {!!altRoutes?.length && (
                  <View style={styles.legendRow}>
                    <View style={[styles.swatchLine, { backgroundColor: '#64748b' }]} />
                    <Text style={styles.legendText}>Rota alternativa</Text>
                  </View>
                )}
                {!!occurrences?.length && (
                  <View style={styles.legendRow}>
                    <View style={[styles.swatchDot, { backgroundColor: '#d97706' }]} />
                    <Text style={styles.legendText}>Ocorrências ({occurrences.length})</Text>
                  </View>
                )}
                {!!routeSegments?.length && (
                  <Text style={styles.legendText}>{routeSegments.filter((t) => t.visivel).length}/{routeSegments.length} trechos visíveis</Text>
                )}
                {(routeSegments || []).map((t) => (
                  <TouchableOpacity key={t.indice} style={styles.legendRow}
                    accessibilityRole="button" accessibilityLabel={`${t.visivel ? 'Ocultar' : 'Mostrar'} trecho ${t.de} para ${t.para}${t.retorno ? ', retorno à origem' : ''}`}
                    accessibilityState={{ selected: t.visivel }}
                    onPress={() => onToggleSegment?.(t.indice)}>
                    <View style={[styles.swatchLine, { backgroundColor: t.cor, opacity: t.visivel ? 1 : 0.35 }]} />
                    <Text style={[styles.legendText, !t.visivel && { textDecorationLine: 'line-through' }]}>
                      {t.de} → {t.para}{t.retorno ? ' · retorno' : ''}{t.visivel ? '' : ' · oculto'}
                    </Text>
                  </TouchableOpacity>
                ))}
                {(routeSegments || []).some((t) => !t.visivel) && (
                  <TouchableOpacity accessibilityRole="button" onPress={onRestoreSegments}>
                    <Text style={[styles.legendText, { color: COLORS.accent }]}>Mostrar todos os trechos</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}
      </View>
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
  basemapControl: {
    position: 'absolute',
    top: 12,
    left: 12,
    maxWidth: '72%',
    gap: 6,
  },
  basemapSwitch: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 7,
    overflow: 'hidden',
  },
  basemapBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  basemapBtnBorder: {
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
  },
  basemapBtnActive: {
    backgroundColor: COLORS.accentStrong,
  },
  basemapBtnText: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  basemapBtnTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  basemapNotice: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderColor: COLORS.warnBorder,
    borderWidth: 1,
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 9,
    gap: 6,
    alignItems: 'flex-start',
  },
  basemapNoticeText: {
    color: COLORS.warn,
    fontSize: 11,
    lineHeight: 15,
  },
  basemapNoticeBtn: {
    borderColor: COLORS.accent,
    borderWidth: 1,
    borderRadius: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: COLORS.white,
  },
  basemapNoticeBtnText: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: '600',
  },
  pickBanner: {
    position: 'absolute',
    top: 50,
    left: 12,
    right: 58,
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
  popoverBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  quickControls: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    maxWidth: '94%',
    gap: 6,
    zIndex: 6,
  },
  iconControlBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 7,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  controlBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 7,
    height: 36,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  controlBtnActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  controlBtnText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  controlBtnTextActive: {
    color: '#ffffff',
  },
  warnIconBox: {
    width: 18,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  warnTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 16,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderStyle: 'solid',
  },
  warnExclamation: {
    position: 'absolute',
    top: 4,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 11,
    textAlign: 'center',
  },
  centerIconBox: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  centerIconRing: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.8,
  },
  centerIconDot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  centerTickTop: {
    position: 'absolute',
    top: 0,
    width: 2,
    height: 3,
    borderRadius: 1,
  },
  centerTickBottom: {
    position: 'absolute',
    bottom: 0,
    width: 2,
    height: 3,
    borderRadius: 1,
  },
  centerTickLeft: {
    position: 'absolute',
    left: 0,
    width: 3,
    height: 2,
    borderRadius: 1,
  },
  centerTickRight: {
    position: 'absolute',
    right: 0,
    width: 3,
    height: 2,
    borderRadius: 1,
  },
  occPopover: {
    position: 'absolute',
    bottom: 44,
    right: 0,
    width: 245,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    zIndex: 8,
  },
  popoverItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 11,
    gap: 8,
    backgroundColor: '#ffffff',
  },
  popoverItemBorder: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  popoverItemActive: {
    backgroundColor: COLORS.accent,
  },
  popoverItemIcon: {
    width: 16,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.accent,
  },
  popoverItemText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
    color: COLORS.text,
  },
  popoverItemTextActive: {
    color: COLORS.white,
  },
  popoverBadge: {
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderWidth: 1,
  },
  popoverBadgeOn: {
    backgroundColor: 'rgba(4, 81, 39, 0.1)',
    borderColor: 'rgba(4, 81, 39, 0.35)',
  },
  popoverBadgeOff: {
    backgroundColor: COLORS.panel2,
    borderColor: COLORS.border,
  },
  popoverBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  popoverBadgeTextOn: {
    color: COLORS.accent,
  },
  popoverBadgeTextOff: {
    color: COLORS.muted,
  },
  legend: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 8,
    maxWidth: 225,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  legendBody: {
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
  controlBtnLocating: {
    borderColor: '#0ea5e9',
    backgroundColor: '#f0f9ff',
  },
  locationBanner: {
    position: 'absolute',
    top: 52,
    left: 12,
    right: 58,
    zIndex: 9,
  },
  occCategorySection: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
    gap: 6,
  },
  occCategoryTitle: {
    fontSize: 10.5,
    fontWeight: '700',
    color: COLORS.muted,
    textTransform: 'uppercase',
  },
  occCategoryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  occCategoryChip: {
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#ffffff',
  },
  occCategoryChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  occCategoryChipText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: COLORS.text,
  },
  occCategoryChipTextActive: {
    color: '#ffffff',
  },
  swatchDiamond: {
    width: 9,
    height: 9,
    transform: [{ rotate: '45deg' }],
    borderRadius: 1.5,
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
