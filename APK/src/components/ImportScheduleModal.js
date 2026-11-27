import React, { useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../theme/colors';

export function ImportScheduleModal({
  visible = false,
  arquivo = '',
  preview = null,
  onCancel,
  onConfirm,
}) {
  const [modoImportacao, setModoImportacao] = useState('mesclar');
  if (!visible || !preview) return null;

  const registros = Array.isArray(preview.registros) ? preview.registros : [];
  const erros = Array.isArray(preview.erros) ? preview.erros : [];
  const avisos = Array.isArray(preview.avisos) ? preview.avisos : [];
  const duplicados = Array.isArray(preview.duplicadosIgnorados) ? preview.duplicadosIgnorados : [];
  const amostra = registros.slice(0, 8);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Pré-visualização da importação</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                Arquivo: {arquivo || 'planilha.xlsx'}
              </Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onCancel} accessibilityLabel="Fechar">
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsRow}>
            <View style={[styles.statPill, styles.statOk]}>
              <Text style={styles.statValue}>{registros.length}</Text>
              <Text style={styles.statLabel}>Válidos</Text>
            </View>
            <View style={[styles.statPill, styles.statWarn]}>
              <Text style={styles.statValue}>{duplicados.length}</Text>
              <Text style={styles.statLabel}>Duplicados</Text>
            </View>
            <View style={[styles.statPill, erros.length ? styles.statErr : styles.statMuted]}>
              <Text style={styles.statValue}>{erros.length}</Text>
              <Text style={styles.statLabel}>Com erro</Text>
            </View>
          </View>

          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeChip, modoImportacao === 'mesclar' && styles.modeChipActive]}
              onPress={() => setModoImportacao('mesclar')}
            >
              <Text style={[styles.modeChipText, modoImportacao === 'mesclar' && styles.modeChipTextActive]}>
                Mesclar com atuais
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeChip, modoImportacao === 'substituir' && styles.modeChipActive]}
              onPress={() => setModoImportacao('substituir')}
            >
              <Text style={[styles.modeChipText, modoImportacao === 'substituir' && styles.modeChipTextActive]}>
                Substituir lista
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.listScroll} nestedScrollEnabled>
            {amostra.length === 0 ? (
              <Text style={styles.emptyText}>
                Nenhum paciente válido com localização encontrada nesta planilha.
              </Text>
            ) : (
              amostra.map((reg, idx) => (
                <View key={`${reg.id}-${idx}`} style={styles.rowCard}>
                  <View style={styles.rowTop}>
                    <Text style={styles.rowName}>{reg.nome}</Text>
                    <Text style={styles.rowBadge}>{reg.prioridadeLabel}</Text>
                  </View>
                  <Text style={styles.rowMeta}>
                    {reg.enderecoDigital || `${reg.latitude.toFixed(5)}, ${reg.longitude.toFixed(5)}`} · {reg.frequenciaAlvo}
                  </Text>
                  {!!reg.condicao && (
                    <Text style={styles.rowSub}>Condição: {reg.condicao}</Text>
                  )}
                </View>
              ))
            )}
            {registros.length > amostra.length && (
              <Text style={styles.moreText}>
                + {registros.length - amostra.length} registro(s) válido(s) adicional(is).
              </Text>
            )}

            {avisos.length > 0 && (
              <View style={styles.noticeBox}>
                <Text style={styles.noticeTitle}>Avisos ({avisos.length})</Text>
                {avisos.slice(0, 5).map((av, i) => (
                  <Text key={i} style={styles.noticeLine}>
                    • Linha {av.linha}: {av.mensagem}
                  </Text>
                ))}
              </View>
            )}

            {erros.length > 0 && (
              <View style={styles.errBox}>
                <Text style={styles.errTitle}>Linhas ignoradas por erro ({erros.length})</Text>
                {erros.slice(0, 6).map((er, i) => (
                  <Text key={i} style={styles.errLine}>
                    • Linha {er.linha}: {er.mensagem}
                  </Text>
                ))}
              </View>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, registros.length === 0 && styles.confirmBtnDisabled]}
              disabled={registros.length === 0}
              onPress={() => onConfirm?.({ registros, substituir: modoImportacao === 'substituir' })}
            >
              <Text style={styles.confirmBtnText}>
                Confirmar ({registros.length})
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: COLORS.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    maxHeight: '88%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 11.5,
    color: COLORS.muted,
    marginTop: 2,
  },
  closeBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  closeText: {
    fontSize: 13,
    color: COLORS.muted,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  statPill: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  statOk: { backgroundColor: '#f0fdf4', borderColor: '#86efac' },
  statWarn: { backgroundColor: '#fffbeb', borderColor: '#fcd34d' },
  statErr: { backgroundColor: '#fef2f2', borderColor: '#fca5a5' },
  statMuted: { backgroundColor: COLORS.panel2, borderColor: COLORS.border },
  statValue: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  statLabel: { fontSize: 10.5, color: COLORS.muted },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  modeChip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    backgroundColor: COLORS.panel2,
  },
  modeChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  modeChipText: { fontSize: 12, fontWeight: '600', color: COLORS.text },
  modeChipTextActive: { color: COLORS.white },
  listScroll: {
    maxHeight: 280,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 12.5,
    color: COLORS.muted,
    paddingVertical: 12,
  },
  rowCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
    backgroundColor: COLORS.panel2,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowName: { fontSize: 12.5, fontWeight: '700', color: COLORS.text, flex: 1 },
  rowBadge: { fontSize: 11, fontWeight: '700', color: COLORS.accent },
  rowMeta: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  rowSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  moreText: { fontSize: 11.5, color: COLORS.muted, marginVertical: 4 },
  noticeBox: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    gap: 3,
  },
  noticeTitle: { fontSize: 11.5, fontWeight: '700', color: '#92400e' },
  noticeLine: { fontSize: 11, color: '#92400e' },
  errBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    gap: 3,
  },
  errTitle: { fontSize: 11.5, fontWeight: '700', color: '#991b1b' },
  errLine: { fontSize: 11, color: '#991b1b' },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 12.5, fontWeight: '600', color: COLORS.text },
  confirmBtn: {
    flex: 1.4,
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  confirmBtnDisabled: { opacity: 0.45 },
  confirmBtnText: { fontSize: 12.5, fontWeight: '700', color: COLORS.white },
});
