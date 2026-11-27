import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  PERIODOS_PLANEJAMENTO,
  ROTULOS_PERIODO,
  STATUS_VISITA,
  STATUS_VISITA_META,
} from '../planejamento/modeloVisitas.js';
import { COLORS } from '../theme/colors';

const FILTROS_STATUS = [
  { id: 'todos', rotulo: 'Todas' },
  { id: STATUS_VISITA.PLANEJADA, rotulo: 'Planejadas' },
  { id: STATUS_VISITA.OPORTUNISTICA_SUGERIDA, rotulo: 'Sugeridas' },
  { id: STATUS_VISITA.REALIZADA, rotulo: 'Realizadas' },
  { id: STATUS_VISITA.NAO_REALIZADA, rotulo: 'Não realizadas' },
];

export function VisitPlanningSection({
  pacientes = [],
  plano = null,
  periodo = PERIODOS_PLANEJAMENTO.SEMANAL,
  sugestoesProximas = [],
  feedback = null,
  onChangePeriodo,
  onPickImport,
  onDownloadTemplate,
  onGeneratePlan,
  onApplyToRoute,
  onAddVisitToRoute,
  onUpdateVisitStatus,
  onFocusVisit,
  onClearVisits,
}) {
  const [expanded, setExpanded] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState('todos');

  const visitasPlano = Array.isArray(plano?.visitas) ? plano.visitas : [];
  const totalPlanejadas = visitasPlano.filter((v) => v.status === STATUS_VISITA.PLANEJADA).length;
  const totalRealizadas = visitasPlano.filter((v) => v.status === STATUS_VISITA.REALIZADA).length;

  const itensCombinados = [
    ...visitasPlano,
    ...sugestoesProximas.filter((sug) => !visitasPlano.some((v) => v.pacienteId === sug.pacienteId)),
  ];

  const itensFiltrados = filtroStatus === 'todos'
    ? itensCombinados
    : itensCombinados.filter((v) => v.status === filtroStatus);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((v) => !v)}
      >
        <View style={styles.headerRow}>
          <Text style={styles.title}>
            {expanded ? '▾' : '▸'} Planejamento de visitas ({pacientes.length})
          </Text>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryPillText}>
              {totalRealizadas}/{visitasPlano.length || 0} concluídas
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      {!!feedback?.message && (
        <View
          style={[
            styles.feedbackBox,
            feedback.status === 'error' ? styles.feedbackErr : styles.feedbackOk,
          ]}
        >
          <Text
            style={[
              styles.feedbackText,
              { color: feedback.status === 'error' ? '#991b1b' : '#065f46' },
            ]}
          >
            {feedback.message}
          </Text>
        </View>
      )}

      {expanded && (
        <View style={styles.body}>
          <View style={styles.periodRow} accessibilityRole="radiogroup" aria-label="Período de planejamento">
            {Object.values(PERIODOS_PLANEJAMENTO).map((perId) => {
              const ativo = periodo === perId;
              return (
                <TouchableOpacity
                  key={perId}
                  style={[styles.periodBtn, ativo && styles.periodBtnActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: ativo }}
                  onPress={() => onChangePeriodo?.(perId)}
                >
                  <Text style={[styles.periodBtnText, ativo && styles.periodBtnTextActive]}>
                    {ROTULOS_PERIODO[perId]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.actionsGrid}>
            <TouchableOpacity style={styles.actionBtnPrimary} onPress={onPickImport}>
              <Text style={styles.actionBtnPrimaryText}>Importar planilha (.xlsx)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtnGhost} onPress={onDownloadTemplate}>
              <Text style={styles.actionBtnGhostText}>Baixar modelo (.xlsx)</Text>
            </TouchableOpacity>
          </View>

          {pacientes.length > 0 && (
            <View style={styles.actionsGrid}>
              <TouchableOpacity style={styles.actionBtnSecondary} onPress={onGeneratePlan}>
                <Text style={styles.actionBtnSecondaryText}>Gerar planejamento</Text>
              </TouchableOpacity>
              {totalPlanejadas > 0 && (
                <TouchableOpacity style={styles.actionBtnPrimary} onPress={onApplyToRoute}>
                  <Text style={styles.actionBtnPrimaryText}>
                    Aplicar à rota ({totalPlanejadas})
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {sugestoesProximas.length > 0 && (
            <View style={styles.suggestionBanner}>
              <Text style={styles.suggestionTitle}>
                Sugestão oportunística próxima ao trajeto ({sugestoesProximas.length})
              </Text>
              <Text style={styles.suggestionHint}>
                Pacientes pendentes próximos à rota calculada que podem ser incluídos no percurso:
              </Text>
              {sugestoesProximas.map((sug) => (
                <View key={sug.id} style={styles.suggestionCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suggestionName}>{sug.nome}</Text>
                    <Text style={styles.suggestionMeta}>
                      {Math.round(sug.distanciaTrajetoMetros || 0)} m do trajeto · Prioridade {Math.round(sug.pontuacaoPrioridade || 0)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.includeBtn}
                    onPress={() => onAddVisitToRoute?.(sug)}
                  >
                    <Text style={styles.includeBtnText}>+ Rota</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {itensCombinados.length > 0 && (
            <>
              <View style={styles.filterRow}>
                {FILTROS_STATUS.map((f) => {
                  const ativo = filtroStatus === f.id;
                  return (
                    <TouchableOpacity
                      key={f.id}
                      style={[styles.filterChip, ativo && styles.filterChipActive]}
                      onPress={() => setFiltroStatus(f.id)}
                    >
                      <Text style={[styles.filterChipText, ativo && styles.filterChipTextActive]}>
                        {f.rotulo}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.visitList}>
                {itensFiltrados.map((visita) => {
                  const meta = STATUS_VISITA_META[visita.status] || STATUS_VISITA_META[STATUS_VISITA.PLANEJADA];
                  return (
                    <View key={visita.id} style={styles.visitCard}>
                      <TouchableOpacity
                        style={styles.visitHeader}
                        onPress={() => onFocusVisit?.(visita)}
                      >
                        <Text style={styles.visitName} numberOfLines={1}>
                          {visita.nome}
                        </Text>
                        <View style={[styles.statusBadge, { backgroundColor: meta.fundo, borderColor: meta.cor }]}>
                          <Text style={[styles.statusBadgeText, { color: meta.cor }]}>
                            {meta.rotulo}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      <Text style={styles.visitMeta}>
                        Prioridade {Math.round(visita.pontuacaoPrioridade || 0)} · {visita.enderecoDigital || `${Number(visita.latitude).toFixed(5)}, ${Number(visita.longitude).toFixed(5)}`}
                      </Text>
                      {Array.isArray(visita.motivosPrioridade) && visita.motivosPrioridade.length > 0 && (
                        <Text style={styles.visitReasons}>
                          {visita.motivosPrioridade.join(' · ')}
                        </Text>
                      )}
                      <View style={styles.visitActions}>
                        {visita.status !== STATUS_VISITA.REALIZADA && (
                          <TouchableOpacity
                            style={styles.miniOkBtn}
                            onPress={() => onUpdateVisitStatus?.(visita.id, STATUS_VISITA.REALIZADA)}
                          >
                            <Text style={styles.miniOkText}>✓ Realizada</Text>
                          </TouchableOpacity>
                        )}
                        {visita.status !== STATUS_VISITA.NAO_REALIZADA && (
                          <TouchableOpacity
                            style={styles.miniWarnBtn}
                            onPress={() => onUpdateVisitStatus?.(visita.id, STATUS_VISITA.NAO_REALIZADA)}
                          >
                            <Text style={styles.miniWarnText}>✕ Não realizada</Text>
                          </TouchableOpacity>
                        )}
                        {visita.status !== STATUS_VISITA.PLANEJADA && (
                          <TouchableOpacity
                            style={styles.miniNeutralBtn}
                            onPress={() => onUpdateVisitStatus?.(visita.id, STATUS_VISITA.PLANEJADA)}
                          >
                            <Text style={styles.miniNeutralText}>Replanejar</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.miniNeutralBtn}
                          onPress={() => onAddVisitToRoute?.(visita)}
                        >
                          <Text style={styles.miniNeutralText}>+ Rota</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {pacientes.length === 0 ? (
            <Text style={styles.emptyHint}>
              Importe uma planilha Excel (.xlsx) com pacientes da área para gerar automaticamente o cronograma diário, semanal ou mensal de visitas.
            </Text>
          ) : (
            <TouchableOpacity style={styles.clearBtn} onPress={onClearVisits}>
              <Text style={styles.clearBtnText}>Limpar planejamento local</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.clinicalNote}>
            Classificação operacional para ordenação em campo; critérios clínicos oficiais são plugáveis via serviço técnico habilitado.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.panel,
    overflow: 'hidden',
  },
  header: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: COLORS.panel2,
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
  summaryPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: 'rgba(15, 118, 110, 0.12)',
  },
  summaryPillText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#0f766e',
  },
  feedbackBox: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  feedbackOk: { backgroundColor: '#ecfdf5' },
  feedbackErr: { backgroundColor: '#fef2f2' },
  feedbackText: { fontSize: 11.5, fontWeight: '600' },
  body: {
    padding: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  periodRow: {
    flexDirection: 'row',
    gap: 6,
  },
  periodBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 7,
    paddingVertical: 6,
    alignItems: 'center',
    backgroundColor: COLORS.panel2,
  },
  periodBtnActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  periodBtnText: { fontSize: 11.5, fontWeight: '600', color: COLORS.text },
  periodBtnTextActive: { color: COLORS.white, fontWeight: '700' },
  actionsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtnPrimary: {
    flex: 1,
    backgroundColor: COLORS.accent,
    borderRadius: 7,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  actionBtnPrimaryText: { color: COLORS.white, fontSize: 11.5, fontWeight: '700' },
  actionBtnSecondary: {
    flex: 1,
    backgroundColor: '#0f766e',
    borderRadius: 7,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  actionBtnSecondaryText: { color: COLORS.white, fontSize: 11.5, fontWeight: '700' },
  actionBtnGhost: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 7,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    backgroundColor: COLORS.panel,
  },
  actionBtnGhostText: { color: COLORS.accent, fontSize: 11.5, fontWeight: '700' },
  suggestionBanner: {
    borderWidth: 1,
    borderColor: '#c4b5fd',
    backgroundColor: '#f5f3ff',
    borderRadius: 8,
    padding: 9,
    gap: 6,
  },
  suggestionTitle: { fontSize: 12, fontWeight: '700', color: '#5b21b6' },
  suggestionHint: { fontSize: 11, color: '#6d28d9' },
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#ddd6fe',
    borderRadius: 7,
    padding: 7,
  },
  suggestionName: { fontSize: 12, fontWeight: '700', color: COLORS.text },
  suggestionMeta: { fontSize: 10.5, color: COLORS.muted },
  includeBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  includeBtnText: { fontSize: 11, fontWeight: '700', color: COLORS.white },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
    backgroundColor: COLORS.panel2,
  },
  filterChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  filterChipText: { fontSize: 11, fontWeight: '600', color: COLORS.text },
  filterChipTextActive: { color: COLORS.white },
  visitList: {
    gap: 8,
  },
  visitCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 9,
    backgroundColor: COLORS.panel2,
    gap: 4,
  },
  visitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  visitName: { fontSize: 12.5, fontWeight: '700', color: COLORS.text, flex: 1 },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusBadgeText: { fontSize: 10.5, fontWeight: '700' },
  visitMeta: { fontSize: 11, color: COLORS.muted },
  visitReasons: { fontSize: 10.5, color: COLORS.textSecondary },
  visitActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  miniOkBtn: {
    borderWidth: 1,
    borderColor: '#15803d',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#f0fdf4',
  },
  miniOkText: { fontSize: 11, fontWeight: '700', color: '#15803d' },
  miniWarnBtn: {
    borderWidth: 1,
    borderColor: '#dc2626',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#fef2f2',
  },
  miniWarnText: { fontSize: 11, fontWeight: '700', color: '#dc2626' },
  miniNeutralBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: COLORS.white,
  },
  miniNeutralText: { fontSize: 11, fontWeight: '600', color: COLORS.text },
  emptyHint: { fontSize: 11.5, color: COLORS.muted, lineHeight: 16 },
  clearBtn: {
    borderWidth: 1,
    borderColor: 'rgba(207, 34, 46, 0.4)',
    borderRadius: 7,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: '#fff5f5',
  },
  clearBtnText: { fontSize: 11.5, fontWeight: '600', color: COLORS.dest },
  clinicalNote: {
    fontSize: 10.5,
    color: COLORS.muted,
    lineHeight: 14,
  },
});
