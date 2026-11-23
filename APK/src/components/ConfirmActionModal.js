import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { COLORS } from '../theme/colors.js';

export function ConfirmActionModal({
  visible = false,
  title = 'Confirmar ação',
  message = '',
  items = [],
  alertText = null,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  submitting = false,
  onConfirm,
  onCancel,
}) {
  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onCancel} disabled={submitting}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
            {!!message && <Text style={styles.message}>{message}</Text>}

            {Array.isArray(items) && items.length > 0 && (
              <View style={styles.list}>
                {items.map((item, idx) => (
                  <Text key={idx} style={styles.listItem}>
                    • {item}
                  </Text>
                ))}
              </View>
            )}

            {!!alertText && (
              <View style={styles.alertBox}>
                <Text style={styles.alertText}>{alertText}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              disabled={submitting}
              accessibilityRole="button"
              onPress={onCancel}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, submitting && { opacity: 0.6 }]}
              disabled={submitting}
              accessibilityRole="button"
              onPress={onConfirm}
            >
              <Text style={styles.confirmText}>
                {submitting ? 'Processando…' : confirmLabel}
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  card: {
    backgroundColor: COLORS.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '700',
    color: COLORS.text,
  },
  closeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  closeText: {
    fontSize: 15,
    color: COLORS.muted,
    fontWeight: '700',
  },
  scroll: {
    maxHeight: 340,
  },
  body: {
    padding: 14,
    gap: 10,
  },
  message: {
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 18,
  },
  list: {
    gap: 4,
    paddingLeft: 4,
  },
  listItem: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
  },
  alertBox: {
    borderWidth: 1,
    borderColor: COLORS.errBorder,
    backgroundColor: COLORS.errBg,
    borderRadius: 8,
    padding: 10,
  },
  alertText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.err,
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.panel2,
  },
  cancelText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: COLORS.text,
  },
  confirmBtn: {
    borderRadius: 7,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: COLORS.err,
  },
  confirmText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.white,
  },
});
