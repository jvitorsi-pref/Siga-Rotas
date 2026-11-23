import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
} from 'react-native';
import {
  STATUS_OBSERVACAO,
  TIPO_OBSERVACAO_CATALOGO,
  rotuloStatusObservacaoCampo,
  rotuloSyncStatus,
  rotuloTipoObservacao,
} from '../campo/modeloCampo.js';
import { COLORS } from '../theme/colors.js';

export function RouteObservationModal({
  visible,
  mode = 'create', // 'create' | 'detail'
  coordinate = null,
  observacao = null,
  eventos = [],
  submitting = false,
  errorText = null,
  onClose,
  onSubmitCreate,
  onSubmitEdit,
  onChangeStatus,
  onFocusCoordinate,
}) {
  const [tipoObservacao, setTipoObservacao] = useState(TIPO_OBSERVACAO_CATALOGO[0].id);
  const [descricao, setDescricao] = useState('');
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (!visible) return;
    if (mode === 'detail' && observacao) {
      setTipoObservacao(observacao.tipoObservacao || TIPO_OBSERVACAO_CATALOGO[0].id);
      setDescricao(observacao.descricao || '');
      setMotivo('');
    } else {
      setTipoObservacao(TIPO_OBSERVACAO_CATALOGO[0].id);
      setDescricao('');
      setMotivo('');
    }
  }, [visible, mode, observacao]);

  if (!visible) return null;

  const lat = mode === 'create' ? coordinate?.lat : observacao?.latitude;
  const lon = mode === 'create' ? coordinate?.lon : observacao?.longitude;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {mode === 'create' ? 'Nova observação na rota' : 'Observação da rota'}
            </Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
            {lat != null && lon != null && (
              <Text style={styles.coordText}>
                Local: {Number(lat).toFixed(6)}, {Number(lon).toFixed(6)}
              </Text>
            )}

            {mode === 'detail' && observacao && (
              <View style={styles.statusBanner}>
                <Text style={styles.statusBannerText}>
                  Status: {rotuloStatusObservacaoCampo(observacao.status)} · {rotuloSyncStatus(observacao.syncStatus)}
                </Text>
              </View>
            )}

            <Text style={styles.label}>Tipo de observação</Text>
            <View style={styles.chipsWrap}>
              {TIPO_OBSERVACAO_CATALOGO.map((cat) => {
                const active = tipoObservacao === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setTipoObservacao(cat.id)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {cat.rotulo}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Descrição de campo</Text>
            <TextInput
              style={styles.textarea}
              multiline
              numberOfLines={3}
              value={descricao}
              onChangeText={setDescricao}
              placeholder="Descreva o registro operacional encontrado no trecho…"
              placeholderTextColor={COLORS.muted}
            />

            {!!errorText && <Text style={styles.errorText}>{errorText}</Text>}

            {mode === 'create' ? (
              <TouchableOpacity
                style={[styles.primaryBtn, submitting && { opacity: 0.6 }]}
                disabled={submitting}
                onPress={() =>
                  onSubmitCreate?.({
                    latitude: lat,
                    longitude: lon,
                    tipoObservacao,
                    descricao,
                  })
                }
              >
                <Text style={styles.primaryBtnText}>
                  {submitting ? 'Salvando…' : 'Salvar observação'}
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.primaryBtn, submitting && { opacity: 0.6 }]}
                  disabled={submitting}
                  onPress={() =>
                    onSubmitEdit?.({
                      idCliente: observacao.idCliente,
                      tipoObservacao,
                      descricao,
                    })
                  }
                >
                  <Text style={styles.primaryBtnText}>
                    {submitting ? 'Salvando…' : 'Salvar alterações'}
                  </Text>
                </TouchableOpacity>

                <Text style={styles.label}>Alterar status</Text>
                <TextInput
                  style={styles.input}
                  value={motivo}
                  onChangeText={setMotivo}
                  placeholder="Motivo opcional da transição…"
                  placeholderTextColor={COLORS.muted}
                />
                <View style={styles.statusRow}>
                  {observacao?.status !== STATUS_OBSERVACAO.CONCLUIDA && (
                    <TouchableOpacity
                      style={styles.statusBtn}
                      disabled={submitting}
                      onPress={() =>
                        onChangeStatus?.({
                          idCliente: observacao.idCliente,
                          novoStatus: STATUS_OBSERVACAO.CONCLUIDA,
                          motivo,
                        })
                      }
                    >
                      <Text style={styles.statusBtnText}>Concluir</Text>
                    </TouchableOpacity>
                  )}
                  {observacao?.status === STATUS_OBSERVACAO.CONCLUIDA && (
                    <TouchableOpacity
                      style={styles.statusBtn}
                      disabled={submitting}
                      onPress={() =>
                        onChangeStatus?.({
                          idCliente: observacao.idCliente,
                          novoStatus: STATUS_OBSERVACAO.REABERTA,
                          motivo,
                        })
                      }
                    >
                      <Text style={styles.statusBtnText}>Reabrir</Text>
                    </TouchableOpacity>
                  )}
                  {lat != null && lon != null && (
                    <TouchableOpacity
                      style={styles.statusBtn}
                      onPress={() => onFocusCoordinate?.({ latitude: lat, longitude: lon })}
                    >
                      <Text style={styles.statusBtnText}>Focar no mapa</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text style={styles.label}>Histórico de eventos ({eventos.length})</Text>
                {eventos.length === 0 ? (
                  <Text style={styles.emptyHist}>Sem eventos registrados.</Text>
                ) : (
                  eventos.map((ev) => {
                    const dados = ev.dadosEvento || {};
                    const statusNovo = dados.statusNovo || null;
                    const descNova = dados.depois?.descricao || dados.descricao || null;
                    const motivoEv = dados.motivo || null;
                    return (
                      <View key={ev.idCliente} style={styles.eventCard}>
                        <Text style={styles.eventTitle}>
                          {ev.tipoEvento}
                          {statusNovo ? ` → ${rotuloStatusObservacaoCampo(statusNovo)}` : ''}
                        </Text>
                        <Text style={styles.eventMeta}>
                          {ev.idUsuario || 'agente'} · {ev.dataEvento} · {rotuloSyncStatus(ev.syncStatus)}
                        </Text>
                        {!!descNova && (
                          <Text style={styles.eventDesc}>{descNova}</Text>
                        )}
                        {!!motivoEv && <Text style={styles.eventDesc}>Motivo: {motivoEv}</Text>}
                      </View>
                    );
                  })
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: COLORS.panel,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: '86%',
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  closeBtn: {
    padding: 4,
  },
  closeText: {
    fontSize: 16,
    color: COLORS.muted,
    fontWeight: '700',
  },
  scroll: {
    maxHeight: '100%',
  },
  scrollBody: {
    padding: 16,
    gap: 10,
  },
  coordText: {
    fontSize: 11.5,
    color: COLORS.muted,
  },
  statusBanner: {
    borderRadius: 8,
    backgroundColor: COLORS.panel2,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 9,
  },
  statusBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  label: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.muted,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.panel2,
  },
  chipActive: {
    backgroundColor: COLORS.accentStrong,
    borderColor: COLORS.accentStrong,
  },
  chipText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  chipTextActive: {
    color: COLORS.white,
  },
  textarea: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    minHeight: 74,
    textAlignVertical: 'top',
    color: COLORS.text,
    backgroundColor: COLORS.inputBg,
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: COLORS.text,
    backgroundColor: COLORS.inputBg,
    fontSize: 12.5,
  },
  errorText: {
    color: COLORS.err,
    fontSize: 12,
    fontWeight: '600',
  },
  primaryBtn: {
    backgroundColor: COLORS.accentStrong,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: COLORS.white,
    fontSize: 13.5,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: COLORS.panel2,
  },
  statusBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  emptyHist: {
    fontSize: 12,
    color: COLORS.muted,
  },
  eventCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.panel2,
    padding: 9,
    gap: 2,
  },
  eventTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  eventMeta: {
    fontSize: 10.5,
    color: COLORS.muted,
  },
  eventDesc: {
    fontSize: 11.5,
    color: COLORS.textSecondary,
  },
});
