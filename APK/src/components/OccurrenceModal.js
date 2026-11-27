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
  ACOES_COLABORATIVAS,
  CATEGORIAS_OCORRENCIA,
  CLASSIFICACOES,
  CLASSIFICACAO_META,
  STATUS_OCORRENCIA,
  TEMPORALIDADES,
  obterCategoriaExibicao,
} from '../ocorrencias/catalogo.js';
import { COLORS } from '../theme/colors';

const COR_CLASSIFICACAO = {
  [CLASSIFICACOES.INFORMATIVO]: '#0284c7',
  [CLASSIFICACOES.PENALIZA]: '#d97706',
  [CLASSIFICACOES.EVITA]: '#dc2626',
};

const ROTULO_STATUS = {
  [STATUS_OCORRENCIA.ATIVA]: 'Ativa',
  [STATUS_OCORRENCIA.EM_ANALISE]: 'Em análise',
  [STATUS_OCORRENCIA.RESOLVIDA]: 'Resolvida',
  [STATUS_OCORRENCIA.EXPIRADA]: 'Expirada',
};

export function OccurrenceModal({
  visible,
  mode, // 'create' | 'detail'
  segmentoPreview,
  coordinate,
  ocorrencia,
  usuarioId,
  submitting = false,
  errorText = null,
  onClose,
  onSubmitCreate,
  onInteract,
  onFocusCoordinate,
}) {
  const [categoria, setCategoria] = useState(CATEGORIAS_OCORRENCIA[0].id);
  const [classificacao, setClassificacao] = useState(
    CATEGORIAS_OCORRENCIA[0].classificacaoPadrao || CLASSIFICACOES.PENALIZA,
  );
  const [temporalidade, setTemporalidade] = useState(
    CATEGORIAS_OCORRENCIA[0].temporalidadePadrao || TEMPORALIDADES.TEMPORARIA,
  );
  const [descricao, setDescricao] = useState('');
  const [featureIdPreferido, setFeatureIdPreferido] = useState(null);

  useEffect(() => {
    if (!visible) return;
    const catPadrao = CATEGORIAS_OCORRENCIA[0];
    setCategoria(catPadrao.id);
    setClassificacao(catPadrao.classificacaoPadrao || CLASSIFICACOES.PENALIZA);
    setTemporalidade(catPadrao.temporalidadePadrao || TEMPORALIDADES.TEMPORARIA);
    setDescricao('');
    setFeatureIdPreferido(segmentoPreview?.principal?.featureId ?? null);
  }, [visible, segmentoPreview]);

  if (!visible) return null;

  const principal =
    (segmentoPreview?.candidatos || []).find(
      (c) => String(c.featureId) === String(featureIdPreferido),
    ) || segmentoPreview?.principal;

  const catInfo = ocorrencia ? obterCategoriaExibicao(ocorrencia.categoria) : null;
  const loc = ocorrencia?.localizacao || ocorrencia || {};
  const contadores = ocorrencia?.contadores || {};
  const interacoes = Array.isArray(ocorrencia?.interacoes) ? ocorrencia.interacoes : [];
  const minhaInteracao = interacoes.find((i) => i.usuarioId === usuarioId)?.tipo || null;
  const jaVotouConfirmar = minhaInteracao === ACOES_COLABORATIVAS.CONFIRMAR;
  const jaVotouResolver = minhaInteracao === ACOES_COLABORATIVAS.RESOLVER;
  const jaVotouContestar = minhaInteracao === ACOES_COLABORATIVAS.CONTESTAR;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {mode === 'create' ? 'Sinalizar ocorrência na via' : 'Detalhes da ocorrência'}
            </Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
            {mode === 'create' ? (
              <>
                <View style={styles.streetBox}>
                  <Text style={styles.streetLabel}>Via associada</Text>
                  <Text style={styles.streetValue}>
                    {principal?.logradouro || 'Via sem denominação'}
                  </Text>
                  {principal?.distanciaAoEixoM != null && (
                    <Text style={styles.streetHint}>
                      Distância do toque ao eixo: {Math.round(principal.distanciaAoEixoM * 10) / 10} m
                    </Text>
                  )}
                  {segmentoPreview?.temRuasProximas && (segmentoPreview?.candidatos?.length || 0) > 1 && (
                    <View style={{ marginTop: 6 }}>
                      <Text style={styles.streetHint}>Vias próximas encontradas:</Text>
                      <View style={styles.chipsWrap}>
                        {segmentoPreview.candidatos.map((cand) => {
                          const ativo = String(cand.featureId) === String(principal?.featureId);
                          return (
                            <TouchableOpacity
                              key={String(cand.featureId)}
                              style={[styles.chip, ativo && styles.chipActive]}
                              onPress={() => setFeatureIdPreferido(cand.featureId)}
                            >
                              <Text style={[styles.chipText, ativo && styles.chipTextActive]}>
                                {cand.logradouro || `Trecho #${cand.featureId}`} ({Math.round(cand.distanciaAoEixoM ?? 0)} m)
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  )}
                </View>

                <Text style={styles.fieldLabel}>Tipo de ocorrência</Text>
                <View style={styles.chipsWrap}>
                  {CATEGORIAS_OCORRENCIA.map((cat) => {
                    const ativo = categoria === cat.id;
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        style={[styles.chip, ativo && styles.chipActive]}
                        onPress={() => {
                          setCategoria(cat.id);
                          setClassificacao(cat.classificacaoPadrao);
                          setTemporalidade(cat.temporalidadePadrao);
                        }}
                      >
                        <Text style={[styles.chipText, ativo && styles.chipTextActive]}>
                          {cat.rotulo}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.fieldLabel}>Impacto no trajeto</Text>
                <View style={styles.colList}>
                  {Object.values(CLASSIFICACOES).map((cls) => {
                    const meta = CLASSIFICACAO_META[cls];
                    const ativo = classificacao === cls;
                    const cor = COR_CLASSIFICACAO[cls] || COLORS.accent;
                    return (
                      <TouchableOpacity
                        key={cls}
                        style={[styles.clsRow, ativo && { borderColor: cor, backgroundColor: '#f8fafc' }]}
                        onPress={() => setClassificacao(cls)}
                      >
                        <View style={[styles.clsDot, { backgroundColor: cor }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.clsTitle}>{meta.rotulo}</Text>
                          <Text style={styles.clsDesc}>{meta.resumo}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.fieldLabel}>Duração estimada</Text>
                <View style={styles.rowGap}>
                  <TouchableOpacity
                    style={[
                      styles.halfBtn,
                      temporalidade === TEMPORALIDADES.TEMPORARIA && styles.chipActive,
                    ]}
                    onPress={() => setTemporalidade(TEMPORALIDADES.TEMPORARIA)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        temporalidade === TEMPORALIDADES.TEMPORARIA && styles.chipTextActive,
                      ]}
                    >
                      Temporária
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.halfBtn,
                      temporalidade === TEMPORALIDADES.PERMANENTE && styles.chipActive,
                    ]}
                    onPress={() => setTemporalidade(TEMPORALIDADES.PERMANENTE)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        temporalidade === TEMPORALIDADES.PERMANENTE && styles.chipTextActive,
                      ]}
                    >
                      Permanente
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Observação (opcional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex.: calçada obstruída próximo à esquina"
                  placeholderTextColor={COLORS.muted}
                  value={descricao}
                  onChangeText={setDescricao}
                  maxLength={240}
                />

                {!!errorText && <Text style={styles.errorText}>{errorText}</Text>}

                <TouchableOpacity
                  style={[styles.primaryBtn, submitting && styles.disabledBtn]}
                  disabled={submitting}
                  onPress={() =>
                    onSubmitCreate?.({
                      categoria,
                      classificacao,
                      temporalidade,
                      descricao: descricao.trim(),
                      latitude: principal?.latitude ?? coordinate?.lat,
                      longitude: principal?.longitude ?? coordinate?.lon,
                      featureIdPreferido: principal?.featureId ?? featureIdPreferido ?? null,
                    })
                  }
                >
                  <Text style={styles.primaryBtnText}>
                    {submitting ? 'Registrando…' : 'Registrar na via'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : ocorrencia ? (
              <>
                <View style={styles.detailBadges}>
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor:
                          COR_CLASSIFICACAO[ocorrencia.classificacao] || COLORS.accent,
                      },
                    ]}
                  >
                    <Text style={styles.badgeText}>
                      {CLASSIFICACAO_META[ocorrencia.classificacao]?.rotulo || ocorrencia.classificacao}
                    </Text>
                  </View>
                  <View style={styles.badgeNeutral}>
                    <Text style={styles.badgeNeutralText}>
                      {ROTULO_STATUS[ocorrencia.status] || ocorrencia.status}
                    </Text>
                  </View>
                </View>

                <Text style={styles.detailTitle}>
                  {catInfo?.rotulo || ocorrencia.categoria}
                </Text>
                {!!catInfo?.legado && (
                  <Text style={styles.streetHint}>
                    Categoria anterior preservada apenas para consulta histórica.
                  </Text>
                )}
                <Text style={styles.detailStreet}>
                  {loc.logradouro || 'Via da rede municipal'}
                </Text>
                {!!ocorrencia.descricao && (
                  <Text style={styles.detailDesc}>{ocorrencia.descricao}</Text>
                )}

                <View style={styles.votesBox}>
                  <Text style={styles.votesText}>
                    Confirmações: {contadores.confirmacoes ?? 1} · Resoluções:{' '}
                    {contadores.resolvida ?? 0} · Contestações:{' '}
                    {contadores.contestacoes ?? 0}
                  </Text>
                  <Text style={styles.streetHint}>
                    Tipo:{' '}
                    {ocorrencia.temporalidade === TEMPORALIDADES.PERMANENTE
                      ? 'Permanente'
                      : 'Temporária'}
                  </Text>
                </View>

                {!!errorText && <Text style={styles.errorText}>{errorText}</Text>}

                <View style={styles.colList}>
                  <TouchableOpacity
                    style={[styles.actionBtn, jaVotouConfirmar && styles.disabledBtn]}
                    disabled={submitting || jaVotouConfirmar}
                    onPress={() => onInteract?.(ocorrencia.id, ACOES_COLABORATIVAS.CONFIRMAR)}
                  >
                    <Text style={styles.actionBtnText}>
                      {jaVotouConfirmar ? '✓ Já confirmado por você' : 'Confirmar ocorrência'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, jaVotouResolver && styles.disabledBtn]}
                    disabled={submitting || jaVotouResolver}
                    onPress={() => onInteract?.(ocorrencia.id, ACOES_COLABORATIVAS.RESOLVER)}
                  >
                    <Text style={styles.actionBtnText}>
                      {jaVotouResolver ? '✓ Resolução já registrada' : 'Sinalizar como resolvida'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, jaVotouContestar && styles.disabledBtn]}
                    disabled={submitting || jaVotouContestar}
                    onPress={() => onInteract?.(ocorrencia.id, ACOES_COLABORATIVAS.CONTESTAR)}
                  >
                    <Text style={styles.actionBtnText}>
                      {jaVotouContestar ? '✓ Contestação registrada' : 'Contestar informação'}
                    </Text>
                  </TouchableOpacity>

                  {typeof onFocusCoordinate === 'function' &&
                    loc.latitude != null &&
                    loc.longitude != null && (
                      <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={() =>
                          onFocusCoordinate({
                            latitude: loc.latitude,
                            longitude: loc.longitude,
                          })
                        }
                      >
                        <Text style={styles.secondaryBtnText}>Centralizar no mapa</Text>
                      </TouchableOpacity>
                    )}
                </View>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
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
    padding: 6,
  },
  closeText: {
    fontSize: 16,
    color: COLORS.muted,
    fontWeight: '700',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollBody: {
    padding: 16,
    gap: 10,
  },
  streetBox: {
    backgroundColor: COLORS.panel2,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  streetLabel: {
    fontSize: 10.5,
    textTransform: 'uppercase',
    color: COLORS.muted,
    fontWeight: '700',
  },
  streetValue: {
    fontSize: 13.5,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 2,
  },
  streetHint: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
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
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: COLORS.panel,
  },
  chipActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent,
  },
  chipText: {
    fontSize: 11.5,
    color: COLORS.textSecondary,
  },
  chipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  colList: {
    gap: 6,
  },
  clsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 9,
    backgroundColor: COLORS.panel,
  },
  clsDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
  },
  clsTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.text,
  },
  clsDesc: {
    fontSize: 11,
    color: COLORS.muted,
  },
  rowGap: {
    flexDirection: 'row',
    gap: 8,
  },
  halfBtn: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 8,
    backgroundColor: COLORS.panel,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12.5,
    color: COLORS.text,
    backgroundColor: COLORS.panel,
  },
  errorText: {
    color: COLORS.err,
    fontSize: 12,
    fontWeight: '600',
  },
  primaryBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '700',
  },
  disabledBtn: {
    opacity: 0.55,
  },
  detailBadges: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  badge: {
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  badgeNeutral: {
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: COLORS.panel2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  badgeNeutralText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  detailStreet: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.accent,
  },
  detailDesc: {
    fontSize: 12.5,
    color: COLORS.textSecondary,
    backgroundColor: COLORS.panel2,
    padding: 9,
    borderRadius: 7,
  },
  votesBox: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 9,
    backgroundColor: COLORS.panel2,
  },
  votesText: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '600',
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: '#f2f8f4',
  },
  actionBtnText: {
    color: COLORS.accent,
    fontSize: 12.5,
    fontWeight: '700',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: COLORS.panel,
  },
  secondaryBtnText: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '600',
  },
});
