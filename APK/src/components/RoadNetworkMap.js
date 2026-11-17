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
const MAP_SOURCE = { html: MAP_HTML };

export const RoadNetworkMap = forwardRef(function RoadNetworkMap(
  {
    features,
    visible = true,
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
  },
  ref
) {
  const webviewRef = useRef(null);
  const syncRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapSession, setMapSession] = useState(0);
  const [showLegend, setShowLegend] = useState(true);
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
      features, markers, routeGeometry, routeSegments, navigationPosition,
      centerRequest, suppressRouteFit });
  }, [mapReady, mapSession, visible, modoBaseAtivo, features, markers, routeGeometry, routeSegments, navigationPosition, centerRequest, suppressRouteFit]);

  useEffect(() => {
    if (modoBaseAtivo === CAMADA_PADRAO) {
      setBasemapStatus(null);
    }
  }, [modoBaseAtivo]);

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
      } else if (data.type === 'MAP_CLICK') {
        // Com a seleção de ponto ativa, o toque define o ponto. Sem seleção,
        // o toque pode ocultar/mostrar um trecho da rota (paridade com o Web).
        if (pickingPoint && onMapPickCoordinate) {
          onMapPickCoordinate({ lon: data.lon, lat: data.lat });
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
          <Text style={{ color: COLORS.accent, fontSize: 11, fontWeight: '700' }}>{isSimulating ? 'MODO DE TESTE — posição simulada, não é GPS real' : 'GPS real — navegação em primeiro plano'}</Text>
        </View>
      )}
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
          <ScrollView style={{ maxHeight: 190 }} contentContainerStyle={{ gap: 4 }}>
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
            <Text style={styles.legendText}>Origem e destino (A)</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.swatchDot, { backgroundColor: COLORS.stop }]} />
            <Text style={styles.legendText}>Parada intermediária</Text>
          </View>
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
          </ScrollView>
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
  quickControls: {
    position: 'absolute',
    bottom: 48,
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
    maxWidth: '68%',
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
