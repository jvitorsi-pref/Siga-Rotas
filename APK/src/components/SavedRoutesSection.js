import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import {
  rotuloSyncStatus,
  TIPO_ROTA,
} from '../campo/modeloCampo.js';
import { COLORS } from '../theme/colors.js';

function formatarDistanciaCurta(metros) {
  const n = Number(metros);
  if (!Number.isFinite(n) || n <= 0) return '0 m';
  if (n >= 1000) return `${(n / 1000).toFixed(2)} km`;
  return `${Math.round(n)} m`;
}

export function SavedRoutesSection({
  rotas = [],
  canSaveCurrent = false,
  saving = false,
  saveFeedback = null,
  onSaveCurrent,
  onOpenRoute,
  onExportRoute,
  onDeleteRoute,
  onClearLocalData,
  onRefresh,
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        accessibilityRole="button"
        onPress={() => setExpanded((v) => !v)}
      >
        <View style={styles.headerRow}>
          <Text style={styles.title}>
            {expanded ? '▾' : '▸'} Rotas salvas ({rotas.length})
          </Text>
          {canSaveCurrent && (
            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              disabled={saving}
              accessibilityRole="button"
              onPress={(e) => {
                e?.stopPropagation?.();
                onSaveCurrent?.();
              }}
            >
              <Text style={styles.saveBtnText}>
                {saving ? 'Salvando…' : 'Salvar rotas offline'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>

      {!!saveFeedback?.text && (
        <Text
          accessibilityRole="alert"
          style={[
            styles.feedbackText,
            saveFeedback.kind === 'err' ? styles.feedbackErr : styles.feedbackOk,
          ]}
        >
          {saveFeedback.text}
        </Text>
      )}

      {expanded && (
        <View style={styles.body}>
          {rotas.length === 0 ? (
            <Text style={styles.empty}>
              Nenhuma rota salva no dispositivo ainda. Use o botão "Salvar rotas offline" quando desejar disponibilizar rotas para uso offline.
            </Text>
          ) : (
            rotas.map((rota) => (
              <TouchableOpacity
                key={rota.idCliente}
                style={styles.card}
                accessibilityRole="button"
                onPress={() => onOpenRoute?.(rota.idCliente)}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {rota.titulo || (rota.tipoRota === TIPO_ROTA.GPS ? 'Trajeto GPS real' : 'Rota calculada')}
                  </Text>
                  <View style={[styles.badge, rota.syncStatus === 'SYNCED' ? styles.badgeOk : styles.badgePending]}>
                    <Text style={styles.badgeText}>
                      {rotuloSyncStatus(rota.syncStatus)}
                    </Text>
                  </View>
                </View>
                <Text style={styles.cardMeta}>
                  {rota.tipoRota === TIPO_ROTA.GPS ? 'GPS real' : 'Calculada'} · {formatarDistanciaCurta(rota.distanciaMetros)} · {rota.pontosJson?.length || 0} parada(s)
                </Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.cardAction}>Toque para abrir offline</Text>
                  <View style={styles.cardActionsGroup}>
                    {typeof onExportRoute === 'function' && !rota.simulado && (
                      <TouchableOpacity
                        style={styles.exportSavedBtn}
                        accessibilityRole="button"
                        onPress={(e) => {
                          e?.stopPropagation?.();
                          onExportRoute(rota.idCliente);
                        }}
                      >
                        <Text style={styles.exportSavedBtnText}>Exportar GPX</Text>
                      </TouchableOpacity>
                    )}
                    {typeof onDeleteRoute === 'function' && (
                      <TouchableOpacity
                        style={styles.deleteSavedBtn}
                        accessibilityRole="button"
                        onPress={(e) => {
                          e?.stopPropagation?.();
                          onDeleteRoute(rota);
                        }}
                      >
                        <Text style={styles.deleteSavedBtnText}>Excluir</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
          <View style={styles.footerActions}>
            {typeof onRefresh === 'function' && (
              <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
                <Text style={styles.refreshBtnText}>Atualizar lista</Text>
              </TouchableOpacity>
            )}
            {typeof onClearLocalData === 'function' && (
              <TouchableOpacity
                style={styles.clearLocalBtn}
                accessibilityRole="button"
                onPress={onClearLocalData}
              >
                <Text style={styles.clearLocalBtnText}>Limpar dados locais</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.panel2,
    overflow: 'hidden',
  },
  header: {
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.text,
  },
  saveBtn: {
    borderWidth: 1,
    borderColor: COLORS.accentStrong,
    backgroundColor: COLORS.accentStrong,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  saveBtnText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
  },
  body: {
    paddingHorizontal: 11,
    paddingBottom: 11,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
    gap: 6,
  },
  empty: {
    fontSize: 11.5,
    color: COLORS.muted,
    lineHeight: 16,
  },
  card: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 7,
    backgroundColor: COLORS.panel,
    padding: 9,
    gap: 3,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeOk: {
    backgroundColor: '#dcfce7',
  },
  badgePending: {
    backgroundColor: '#fef3c7',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.text,
  },
  cardMeta: {
    fontSize: 11,
    color: COLORS.muted,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 2,
  },
  cardAction: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: '600',
    color: COLORS.accentStrong,
  },
  exportSavedBtn: {
    borderWidth: 1,
    borderColor: COLORS.accentStrong,
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: COLORS.panel2,
  },
  exportSavedBtnText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: COLORS.accentStrong,
  },
  cardActionsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deleteSavedBtn: {
    borderWidth: 1,
    borderColor: COLORS.errBorder,
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: COLORS.errBg,
  },
  deleteSavedBtnText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: COLORS.err,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 4,
  },
  clearLocalBtn: {
    borderWidth: 1,
    borderColor: COLORS.errBorder,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: COLORS.panel,
  },
  clearLocalBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.err,
  },
  feedbackText: {
    paddingHorizontal: 11,
    paddingBottom: 7,
    fontSize: 11,
    fontWeight: '600',
  },
  feedbackOk: {
    color: COLORS.ok,
  },
  feedbackErr: {
    color: COLORS.err,
  },
  refreshBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  refreshBtnText: {
    fontSize: 11,
    color: COLORS.accentStrong,
    fontWeight: '600',
  },
});
