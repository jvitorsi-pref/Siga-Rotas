import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../theme/colors';
import {
  ESTADOS_SHEET,
  alturaDoEstadoSheet,
  calcularAlturasSheet,
  normalizarEstadoSheet,
  proximoEstadoPorToque,
  resolverProximoEstadoSheet,
} from './bottomSheetLayout.js';

export {
  ESTADOS_SHEET,
  calcularAlturasSheet,
  resolverProximoEstadoSheet,
  proximoEstadoPorToque,
};

export function BottomSheetPanel({
  sheetState = ESTADOS_SHEET.MID,
  onChangeSheetState,
  containerHeight = 720,
  summaryTitle = 'Planejamento e trajeto',
  summaryBadge = '',
  children,
}) {
  const estadoNorm = normalizarEstadoSheet(sheetState);
  const alturas = useMemo(() => calcularAlturasSheet(containerHeight), [containerHeight]);
  const alturaAlvo = alturaDoEstadoSheet(estadoNorm, alturas);

  const heightAnim = useRef(new Animated.Value(alturaAlvo)).current;
  const dragStartHeightRef = useRef(alturaAlvo);
  const latestStateRef = useRef({ estadoNorm, alturas, onChangeSheetState });
  latestStateRef.current = { estadoNorm, alturas, onChangeSheetState };

  useEffect(() => {
    Animated.spring(heightAnim, {
      toValue: alturaAlvo,
      useNativeDriver: false,
      bounciness: 3,
      speed: 18,
    }).start();
  }, [alturaAlvo, heightAnim]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, gs) => Math.abs(gs.dy) > 6 && Math.abs(gs.dy) > Math.abs(gs.dx),
        onPanResponderGrant: () => {
          const { estadoNorm: cur, alturas: hMap } = latestStateRef.current;
          dragStartHeightRef.current = alturaDoEstadoSheet(cur, hMap);
          heightAnim.stopAnimation((val) => {
            if (Number.isFinite(val)) dragStartHeightRef.current = val;
          });
        },
        onPanResponderMove: (_evt, gs) => {
          const { alturas: hMap } = latestStateRef.current;
          const next = Math.max(hMap.collapsed, Math.min(hMap.expanded, dragStartHeightRef.current - gs.dy));
          heightAnim.setValue(next);
        },
        onPanResponderRelease: (_evt, gs) => {
          const { estadoNorm: cur, alturas: hMap, onChangeSheetState: onChange } = latestStateRef.current;
          const alturaAtual = Math.max(hMap.collapsed, Math.min(hMap.expanded, dragStartHeightRef.current - gs.dy));
          const proximo = resolverProximoEstadoSheet({
            estadoAtual: cur,
            alturaAtual,
            dy: gs.dy,
            vy: gs.vy,
            alturas: hMap,
          });
          const destAltura = alturaDoEstadoSheet(proximo, hMap);
          Animated.spring(heightAnim, {
            toValue: destAltura,
            useNativeDriver: false,
            bounciness: 3,
            speed: 18,
          }).start();
          if (proximo !== cur) onChange?.(proximo);
        },
        onPanResponderTerminate: (_evt, gs) => {
          const { estadoNorm: cur, alturas: hMap } = latestStateRef.current;
          const destAltura = alturaDoEstadoSheet(cur, hMap);
          Animated.spring(heightAnim, {
            toValue: destAltura,
            useNativeDriver: false,
            bounciness: 3,
            speed: 18,
          }).start();
        },
      }),
    [heightAnim]
  );

  const labelBotaoAlternar =
    estadoNorm === ESTADOS_SHEET.COLLAPSED
      ? 'Painel'
      : estadoNorm === ESTADOS_SHEET.MID
        ? 'Expandir'
        : 'Reduzir';

  return (
    <Animated.View style={[styles.sheet, { height: heightAnim }]}>
      <View
        style={styles.handleArea}
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Barra do painel inferior. Arraste para cima ou para baixo para ajustar a altura."
      >
        <View style={styles.pill} />
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.summaryTap}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`${summaryTitle}. Tocar para alternar altura do painel`}
            onPress={() => onChangeSheetState?.(proximoEstadoPorToque(estadoNorm))}
          >
            <Text style={styles.summaryTitle} numberOfLines={1}>
              {summaryTitle}
            </Text>
            {!!summaryBadge && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{summaryBadge}</Text>
              </View>
            )}
          </TouchableOpacity>
          <View style={styles.quickButtons}>
            {estadoNorm !== ESTADOS_SHEET.COLLAPSED && (
              <TouchableOpacity
                style={styles.stepBtn}
                accessibilityRole="button"
                accessibilityLabel="Minimizar painel para visualizar mais mapa"
                onPress={() => onChangeSheetState?.(ESTADOS_SHEET.COLLAPSED)}
              >
                <Text style={styles.stepBtnText}>Mapa</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.stepBtn, styles.stepBtnPrimary]}
              accessibilityRole="button"
              accessibilityLabel={`${labelBotaoAlternar} painel`}
              onPress={() => onChangeSheetState?.(proximoEstadoPorToque(estadoNorm))}
            >
              <Text style={styles.stepBtnPrimaryText}>{labelBotaoAlternar}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {estadoNorm !== ESTADOS_SHEET.COLLAPSED && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          nestedScrollEnabled={true}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.panel,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
    zIndex: 20,
    overflow: 'hidden',
  },
  handleArea: {
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 14,
    backgroundColor: COLORS.panel,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pill: {
    alignSelf: 'center',
    width: 44,
    height: 4.5,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  summaryTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  summaryTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: COLORS.text,
    flexShrink: 1,
  },
  badge: {
    backgroundColor: 'rgba(4, 81, 39, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.accent,
  },
  quickButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 7,
    paddingVertical: 5,
    paddingHorizontal: 9,
    backgroundColor: COLORS.panel2,
  },
  stepBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: COLORS.text,
  },
  stepBtnPrimary: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  stepBtnPrimaryText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.white,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 28,
  },
});
