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
import { resumoRota } from '../utils/resumoRota.js';
import { formatDistanceParts, formatStreetLength } from '../utils/formatters.js';
import { COLORS } from '../theme/colors';

export function RouteResultPanel({
  routeResult,
  routeError,
  gpsRouteInfo = null,
  routeSegments = [],
  onToggleSegment,
  onRestoreSegments,
  onExportGpx,
  exportingGpx = false,
  gpxFeedback = null,
  routeAlternatives = null,
  selectedRouteId = null,
  comparacaoAlternativas = null,
  onSelectAlternative,
  onInspectOccurrence,
  onBypassAlerts,
}) {
  const [streetsOpen, setStreetsOpen] = useState(true);

  if (!routeResult && !routeError && !gpsRouteInfo) return null;

  if (!routeResult && !routeError && gpsRouteInfo) {
    const distGps = formatDistanceParts(gpsRouteInfo.distanciaMetros || 0);
    return (
      <View style={styles.block}>
        <Text style={styles.blockTitle}>Resultado (GPS Real)</Text>
        <View style={styles.distanceRow}>
          <Text style={styles.distanceValue}>{distGps.v}</Text>
          <Text style={styles.distanceUnit}>{distGps.u}</Text>
        </View>
        <Text style={styles.routeNote}>
          Trajeto GPS real registrado (sem rota calculada vinculada).
        </Text>
        {typeof onExportGpx === 'function' && (
          <View style={styles.gpxSection}>
            <TouchableOpacity
              style={[styles.exportGpxBtn, exportingGpx && styles.exportGpxBtnDisabled]}
              disabled={exportingGpx}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!exportingGpx, busy: !!exportingGpx }}
              onPress={onExportGpx}
            >
              <Text style={styles.exportGpxBtnText}>
                {exportingGpx ? 'Salvando GPX…' : 'Exportar GPX'}
              </Text>
            </TouchableOpacity>
            {!!gpxFeedback?.text && (
              <View
                style={[
                  styles.gpxFeedbackBox,
                  gpxFeedback.kind === 'err' && styles.gpxFeedbackErr,
                  gpxFeedback.kind === 'warn' && styles.gpxFeedbackWarn,
                  gpxFeedback.kind === 'ok' && styles.gpxFeedbackOk,
                ]}
              >
                <Text
                  accessibilityRole={gpxFeedback.kind === 'err' ? 'alert' : undefined}
                  style={[
                    styles.gpxFeedbackText,
                    gpxFeedback.kind === 'err' && styles.gpxFeedbackTextErr,
                    gpxFeedback.kind === 'warn' && styles.gpxFeedbackTextWarn,
                    gpxFeedback.kind === 'ok' && styles.gpxFeedbackTextOk,
                  ]}
                >
                  {gpxFeedback.text}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  }

  if (routeError) {
    return (
      <View style={styles.block}>
        <Text style={styles.blockTitle}>Resultado</Text>
        <Text style={styles.errorHeadline}>{routeError.title}</Text>
        <View style={styles.alertError}>
          <Text style={styles.alertErrorTitle}>{routeError.title}</Text>
          <Text style={styles.alertErrorBody}>{routeError.message}</Text>
          {routeError.bloqueadaPorRestricao && typeof onBypassAlerts === 'function' && (
            <TouchableOpacity
              style={styles.bypassBtn}
              accessibilityRole="button"
              onPress={onBypassAlerts}
            >
              <Text style={styles.bypassBtnText}>
                Ignorar alertas e calcular rota mais curta
              </Text>
            </TouchableOpacity>
          )}
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

  const alternativas = Array.isArray(routeAlternatives) ? routeAlternatives : [];
  const rotaAtivaObj =
    alternativas.find((r) => r.id === selectedRouteId) ||
    alternativas[0] ||
    null;
  const ocorrenciasNoTrajeto =
    rotaAtivaObj?.ocorrenciasNoTrajeto || routeResult.ocorrenciasNoTrajeto || [];

  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Resultado</Text>

      {/* Distância Total */}
      <View style={styles.distanceRow}>
        <Text style={styles.distanceValue}>{dist.v}</Text>
        <Text style={styles.distanceUnit}>{dist.u}</Text>
      </View>

      <Text style={styles.routeNote}>{resumoRota(routeResult)}</Text>

      {alternativas.length > 1 && (
        <View style={styles.altSection}>
          <Text style={styles.altSectionTitle}>
            Rotas alternativas ({alternativas.length})
          </Text>
          {!!comparacaoAlternativas?.resumo && (
            <Text style={styles.altSummary}>{comparacaoAlternativas.resumo}</Text>
          )}
          <View style={styles.altList}>
            {alternativas.map((alt) => {
              const selecionada = (selectedRouteId || alternativas[0].id) === alt.id;
              const ad = formatDistanceParts(alt.distance);
              const delta = Number(alt.diferencaMetros || 0);
              const deltaTxt =
                delta === 0
                  ? 'Referência'
                  : `${delta > 0 ? '+' : ''}${Math.round(delta)} m`;
              return (
                <TouchableOpacity
                  key={alt.id}
                  style={[styles.altCard, selecionada && styles.altCardActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selecionada }}
                  onPress={() => onSelectAlternative?.(alt.id)}
                >
                  <View style={styles.altTopRow}>
                    <Text style={[styles.altTitle, selecionada && styles.altTitleActive]}>
                      {alt.rotulo || alt.id}
                    </Text>
                    <Text style={styles.altDist}>
                      {ad.v} {ad.u} ({deltaTxt})
                    </Text>
                  </View>
                  {!!alt.motivo && <Text style={styles.altReason}>{alt.motivo}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {ocorrenciasNoTrajeto.length > 0 && (
        <View style={styles.occRouteBox}>
          <Text style={styles.occRouteTitle}>
            Ocorrências no trajeto ({ocorrenciasNoTrajeto.length})
          </Text>
          {ocorrenciasNoTrajeto.map((oc) => (
            <TouchableOpacity
              key={oc.id}
              style={styles.occRouteItem}
              accessibilityRole="button"
              onPress={() => onInspectOccurrence?.(oc)}
            >
              <Text style={styles.occRouteItemTitle}>
                {oc.categoriaLabel || oc.rotuloCategoria || oc.categoria} —{' '}
                {oc.classificacao === 'evita'
                  ? 'Evita o trecho'
                  : oc.classificacao === 'penaliza'
                    ? 'Aumenta o custo'
                    : 'Informativo'}
              </Text>
              <Text style={styles.occRouteItemSub}>
                {oc.logradouro || 'Via da rede'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

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

      {routeResult?.ok !== false && !routeResult?.parcial && typeof onExportGpx === 'function' && (
        <View style={styles.gpxSection}>
          <TouchableOpacity
            style={[styles.exportGpxBtn, exportingGpx && styles.exportGpxBtnDisabled]}
            disabled={exportingGpx}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!exportingGpx, busy: !!exportingGpx }}
            onPress={onExportGpx}
          >
            <Text style={styles.exportGpxBtnText}>
              {exportingGpx ? 'Salvando GPX…' : 'Exportar GPX'}
            </Text>
          </TouchableOpacity>

          {!!gpxFeedback?.text && (
            <View
              style={[
                styles.gpxFeedbackBox,
                gpxFeedback.kind === 'err' && styles.gpxFeedbackErr,
                gpxFeedback.kind === 'warn' && styles.gpxFeedbackWarn,
                gpxFeedback.kind === 'ok' && styles.gpxFeedbackOk,
              ]}
            >
              <Text
                accessibilityRole={gpxFeedback.kind === 'err' ? 'alert' : undefined}
                style={[
                  styles.gpxFeedbackText,
                  gpxFeedback.kind === 'err' && styles.gpxFeedbackTextErr,
                  gpxFeedback.kind === 'warn' && styles.gpxFeedbackTextWarn,
                  gpxFeedback.kind === 'ok' && styles.gpxFeedbackTextOk,
                ]}
              >
                {gpxFeedback.text}
              </Text>
            </View>
          )}
        </View>
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
  routeNote: { color: COLORS.muted, fontSize: 11.5, lineHeight: 17, marginVertical: 8, padding: 8, borderLeftWidth: 2, borderLeftColor: COLORS.border, backgroundColor: COLORS.panel2 },
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
  gpxSection: {
    marginTop: 12,
    gap: 6,
  },
  exportGpxBtn: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.accent,
    borderWidth: 1,
    borderRadius: 7,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  exportGpxBtnDisabled: {
    opacity: 0.55,
  },
  exportGpxBtnText: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  gpxFeedbackBox: {
    backgroundColor: COLORS.panel2,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  gpxFeedbackOk: {
    backgroundColor: 'rgba(46, 160, 67, 0.1)',
    borderColor: 'rgba(46, 160, 67, 0.4)',
  },
  gpxFeedbackWarn: {
    backgroundColor: COLORS.warnBg,
    borderColor: COLORS.warnBorder,
  },
  gpxFeedbackErr: {
    backgroundColor: COLORS.errBg,
    borderColor: COLORS.errBorder,
  },
  gpxFeedbackText: {
    color: COLORS.text,
    fontSize: 11.5,
    lineHeight: 16,
  },
  gpxFeedbackTextOk: {
    color: COLORS.ok,
  },
  gpxFeedbackTextWarn: {
    color: COLORS.warn,
  },
  gpxFeedbackTextErr: {
    color: COLORS.err,
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
  bypassBtn: {
    marginTop: 9,
    borderWidth: 1,
    borderColor: COLORS.err,
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: COLORS.panel,
    alignItems: 'center',
  },
  bypassBtnText: {
    color: COLORS.err,
    fontSize: 12,
    fontWeight: '700',
  },
  altSection: {
    marginTop: 8,
    marginBottom: 8,
    gap: 6,
  },
  altSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  altSummary: {
    fontSize: 11,
    color: COLORS.muted,
  },
  altList: {
    gap: 6,
  },
  altCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 7,
    padding: 9,
    backgroundColor: COLORS.panel2,
  },
  altCardActive: {
    borderColor: COLORS.accent,
    borderWidth: 1.5,
    backgroundColor: '#f2f8f4',
  },
  altTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  altTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
  },
  altTitleActive: {
    color: COLORS.accent,
  },
  altDist: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  altReason: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 2,
  },
  occRouteBox: {
    marginTop: 4,
    marginBottom: 8,
    padding: 9,
    borderWidth: 1,
    borderColor: COLORS.warnBorder,
    backgroundColor: COLORS.warnBg,
    borderRadius: 7,
    gap: 5,
  },
  occRouteTitle: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.warn,
  },
  occRouteItem: {
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  occRouteItemTitle: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.text,
  },
  occRouteItemSub: {
    fontSize: 10.5,
    color: COLORS.muted,
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
