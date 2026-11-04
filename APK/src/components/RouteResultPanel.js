/**
 * PAINEL DE RESULTADO DA ROTA E LOGRADOUROS PERCORRIDOS
 * =====================================================
 *
 * Equivalente nativo em React Native da seção `#result-block` de `public/index.html`.
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import { formatDistanceParts, formatStreetLength } from '../utils/formatters.js';
import { COLORS } from '../theme/colors';

export function RouteResultPanel({ routeResult, routeError, routeSegments = [], onToggleSegment, onRestoreSegments }) {
  const [streetsOpen, setStreetsOpen] = useState(true);

  if (!routeResult && !routeError) return null;

  if (routeError) {
    return (
      <View style={styles.block}>
        <Text style={styles.blockTitle}>Resultado</Text>
        <Text style={styles.errorHeadline}>{routeError.title}</Text>
        <View style={styles.alertError}>
          <Text style={styles.alertErrorTitle}>{routeError.title}</Text>
          <Text style={styles.alertErrorBody}>{routeError.message}</Text>
        </View>
      </View>
    );
  }

  const dist = formatDistanceParts(routeResult.distance);
  const legs = routeResult.legs || [];
  const allStreetLegs = legs.flatMap((l) => l.legs || []);
  const officialCount = allStreetLegs.filter((l) => l.official).length;
  const totalNodes = legs.reduce((acc, l) => acc + (l.nodeCount || 0), 0);
  const paradasCount =
    routeResult.paradas != null ? routeResult.paradas : Math.max(0, legs.length - 1);

  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Resultado</Text>

      {/* Distância Total */}
      <View style={styles.distanceRow}>
        <Text style={styles.distanceValue}>{dist.v}</Text>
        <Text style={styles.distanceUnit}>{dist.u}</Text>
      </View>

      {/* Métricas gerais do trajeto */}
      <View style={styles.statsGrid}>
        <StatRow label="Paradas intermediárias" value={String(paradasCount)} />
        <StatRow label="Trechos" value={String(legs.length)} />
        <StatRow
          label="Sequência"
          value={(routeResult.sequenciaCompleta || routeResult.sequencia || []).join(' → ') || '—'}
        />
        <StatRow
          label="Logradouros oficiais"
          value={`${officialCount} de ${allStreetLegs.length}`}
        />
        <StatRow label="Nós na rota" value={String(totalNodes)} />
      </View>

      {/* Detalhamento de cada trecho (A → B, B → C, …) */}
      <View style={styles.legsList}>
        {legs.map((l, idx) => {
          const dl = formatDistanceParts(l.distance);
          const acesso = l.origem
            ? `Acesso à rede: ${Math.round(l.origem.distanceToNetwork * 100) / 100} m`
            : '';
          return (
            <TouchableOpacity key={`leg-${idx}`}
              accessibilityRole="button"
              accessibilityLabel={`${routeSegments[idx]?.visivel === false ? 'Mostrar' : 'Ocultar'} trecho ${l.de} para ${l.para}`}
              accessibilityState={{ selected: routeSegments[idx]?.visivel !== false }}
              onPress={() => onToggleSegment?.(idx)}
              style={[styles.legCard, { borderLeftWidth: 3.5, borderLeftColor: routeSegments[idx]?.cor || l.cor || COLORS.route }, routeSegments[idx]?.visivel === false && { opacity: 0.5 }]}>
              <Text style={styles.legAccess}>{l.retorno ? 'Retorno à origem · ' : ''}{routeSegments[idx]?.visivel === false ? 'Oculto — toque para mostrar' : 'Toque para ocultar no mapa'}</Text>
              <View style={styles.legTopRow}>
                <Text style={styles.legBadge}>{l.de}</Text>
                <Text style={styles.legArrow}>→</Text>
                <Text style={styles.legBadge}>{l.para}</Text>
                <Text style={styles.legDist}>
                  {dl.v} {dl.u}
                </Text>
              </View>
              {acesso ? <Text style={styles.legAccess}>{acesso}</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {routeSegments.some((t) => !t.visivel) && (
        <TouchableOpacity style={styles.summaryHeader} accessibilityRole="button" onPress={onRestoreSegments}>
          <Text style={styles.summaryTitle}>Mostrar todos os trechos</Text>
        </TouchableOpacity>
      )}

      {/* Lista numerada dos logradouros percorridos */}
      <TouchableOpacity
        style={styles.summaryHeader}
        onPress={() => setStreetsOpen((v) => !v)}
      >
        <Text style={styles.summaryTitle}>
          {streetsOpen ? '▾' : '▸'} Logradouros percorridos
        </Text>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{allStreetLegs.length}</Text>
        </View>
      </TouchableOpacity>

      {streetsOpen && (
        <View style={styles.streetsContainer}>
          {allStreetLegs.map((item, idx) => (
            <View key={`st-${idx}`} style={styles.streetItem}>
              <View style={styles.streetIndexCircle}>
                <Text style={styles.streetIndexText}>{idx + 1}</Text>
              </View>
              <View style={styles.streetNameWrap}>
                <Text style={styles.streetName}>
                  {item.street || 'Eixo sem nome'}
                </Text>
                <View
                  style={[
                    styles.tag,
                    !item.official && styles.tagUnofficial,
                  ]}
                >
                  <Text
                    style={[
                      styles.tagText,
                      !item.official && styles.tagTextUnofficial,
                    ]}
                  >
                    {item.official ? 'OFICIAL' : 'NÃO OFICIAL'}
                  </Text>
                </View>
              </View>
              <Text style={styles.streetLen}>{formatStreetLength(item.length)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function StatRow({ label, value }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statKey}>{label}</Text>
      <Text style={styles.statVal}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  blockTitle: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: COLORS.muted,
    fontWeight: '700',
    marginBottom: 10,
  },
  errorHeadline: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.err,
    marginBottom: 8,
  },
  alertError: {
    backgroundColor: COLORS.errBg,
    borderColor: COLORS.errBorder,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  alertErrorTitle: {
    color: COLORS.err,
    fontWeight: '700',
    fontSize: 12.5,
    marginBottom: 3,
  },
  alertErrorBody: {
    color: COLORS.err,
    fontSize: 12,
    lineHeight: 17,
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
    marginBottom: 8,
  },
  distanceValue: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.accent,
  },
  distanceUnit: {
    fontSize: 15,
    color: COLORS.muted,
    fontWeight: '500',
  },
  statsGrid: {
    gap: 4,
    marginVertical: 8,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statKey: {
    color: COLORS.muted,
    fontSize: 12,
  },
  statVal: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  legsList: {
    marginTop: 8,
    gap: 5,
  },
  legCard: {
    backgroundColor: COLORS.panel2,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 9,
  },
  legTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legBadge: {
    color: COLORS.accent,
    fontWeight: '700',
    fontSize: 12,
  },
  legArrow: {
    color: COLORS.muted,
    fontSize: 12,
  },
  legDist: {
    marginLeft: 'auto',
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600',
  },
  legAccess: {
    color: COLORS.muted,
    fontSize: 10.5,
    marginTop: 2,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 4,
  },
  summaryTitle: {
    color: COLORS.muted,
    fontSize: 12.5,
    fontWeight: '600',
  },
  countBadge: {
    backgroundColor: COLORS.panel2,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    marginLeft: 6,
  },
  countBadgeText: {
    color: COLORS.textSecondary,
    fontSize: 11,
  },
  streetsContainer: {
    marginTop: 6,
  },
  streetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  streetIndexCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.panel2,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streetIndexText: {
    color: COLORS.muted,
    fontSize: 10,
  },
  streetNameWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  streetName: {
    color: COLORS.text,
    fontSize: 12,
  },
  tag: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  tagUnofficial: {
    borderColor: COLORS.warnBorder,
    backgroundColor: COLORS.warnBg,
  },
  tagText: {
    fontSize: 9,
    color: COLORS.muted,
  },
  tagTextUnofficial: {
    color: COLORS.warn,
  },
  streetLen: {
    color: COLORS.muted,
    fontSize: 11.5,
  },
});
