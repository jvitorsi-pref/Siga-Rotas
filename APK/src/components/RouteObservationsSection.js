import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import {
  rotuloStatusObservacaoCampo,
  rotuloSyncStatus,
  rotuloTipoObservacao,
} from '../campo/modeloCampo.js';
import { COLORS } from '../theme/colors.js';

export function RouteObservationsSection({
  rotaAlvo,
  hasRouteOnScreen = false,
  observacoes = [],
  hasActiveGpsPosition = false,
  pickingObservation = false,
  onStartPickMap,
  onCancelPickMap,
  onCreateAtGpsPosition,
  onOpenObservation,
  onDeleteObservation,
}) {
  if (!rotaAlvo) {
    if (!hasRouteOnScreen) return null;
    return (
      <View style={styles.block}>
        <Text style={styles.blockTitle}>Observações desta rota</Text>
        <Text style={styles.empty}>
          Salve a rota usando o botão "Salvar rotas offline" para registrar e gerenciar observações vinculadas a ela.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <View style={styles.headerRow}>
        <Text style={styles.blockTitle}>
          Observações desta rota ({observacoes.length})
        </Text>
        <Text style={styles.routeLabel} numberOfLines={1}>
          {rotaAlvo.titulo || 'Rota ativa'}
        </Text>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.btnAction, pickingObservation && styles.btnActionActive]}
          accessibilityRole="button"
          onPress={pickingObservation ? onCancelPickMap : onStartPickMap}
        >
          <Text style={[styles.btnActionText, pickingObservation && styles.btnActionTextActive]}>
            {pickingObservation ? 'Cancelar toque no mapa' : '+ Marcar observação no mapa'}
          </Text>
        </TouchableOpacity>

        {hasActiveGpsPosition && (
          <TouchableOpacity
            style={styles.btnAction}
            accessibilityRole="button"
            onPress={onCreateAtGpsPosition}
          >
            <Text style={styles.btnActionText}>+ Na posição GPS atual</Text>
          </TouchableOpacity>
        )}
      </View>

      {observacoes.length === 0 ? (
        <Text style={styles.empty}>
          Nenhuma observação de campo vinculada a esta rota.
        </Text>
      ) : (
        <View style={styles.list}>
          {observacoes.map((obs) => (
            <TouchableOpacity
              key={obs.idCliente}
              style={styles.card}
              accessibilityRole="button"
              onPress={() => onOpenObservation?.(obs)}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardType}>{rotuloTipoObservacao(obs.tipoObservacao)}</Text>
                <Text style={styles.cardStatus}>
                  {rotuloStatusObservacaoCampo(obs.status)} · {rotuloSyncStatus(obs.syncStatus)}
                </Text>
              </View>
              <Text style={styles.cardDesc} numberOfLines={2}>
                {obs.descricao}
              </Text>
              <View style={styles.cardFooterRow}>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {Number(obs.latitude).toFixed(5)}, {Number(obs.longitude).toFixed(5)} · Toque para editar
                </Text>
                {typeof onDeleteObservation === 'function' && (
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    accessibilityRole="button"
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      onDeleteObservation(obs);
                    }}
                  >
                    <Text style={styles.deleteBtnText}>Excluir</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  blockTitle: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: COLORS.muted,
    fontWeight: '700',
  },
  routeLabel: {
    flex: 1,
    textAlign: 'right',
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  btnAction: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.panel2,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  btnActionActive: {
    backgroundColor: COLORS.accentStrong,
    borderColor: COLORS.accentStrong,
  },
  btnActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  btnActionTextActive: {
    color: COLORS.white,
  },
  empty: {
    fontSize: 12,
    color: COLORS.muted,
  },
  list: {
    gap: 6,
  },
  card: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.panel2,
    padding: 9,
    gap: 3,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  cardType: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  cardStatus: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.accentStrong,
  },
  cardDesc: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  cardMeta: {
    flex: 1,
    fontSize: 10.5,
    color: COLORS.muted,
  },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 2,
  },
  deleteBtn: {
    borderWidth: 1,
    borderColor: COLORS.errBorder,
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: COLORS.errBg,
  },
  deleteBtnText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: COLORS.err,
  },
});
