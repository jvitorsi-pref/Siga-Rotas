/**
 * PAINEL DA REDE VIÁRIA E DIAGNÓSTICO DO GRAFO
 * ============================================
 *
 * Exibe os metadados da rede carregada (`siga:SIGA_EIXO_LOG_OFICIAL_E_NAO`),
 * o status de atualização automática, botões de sincronização direta com o
 * GeoServer WFS da Prefeitura de Santo André e o diagnóstico completo da
 * construção do grafo topológico.
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { COLORS } from '../theme/colors';

export function NetworkDiagnosticsPanel({
  meta,
  diagnostics,
  syncing,
  onCheckUpdates,
  onRefreshWfs,
}) {
  const [diagOpen, setDiagOpen] = useState(false);

  if (!meta) {
    return (
      <View style={styles.block}>
        <Text style={styles.blockTitle}>Rede viária</Text>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={COLORS.accent} />
          <Text style={styles.mutedText}>Construindo grafo viário em UTM 23S…</Text>
        </View>
      </View>
    );
  }

  const upd = meta.update || {};
  const warnings = meta.warnings || [];
  const sourceLabel =
    meta.source === 'wfs'
      ? 'GeoServer (WFS ao vivo)'
      : meta.source === 'wfs-cache'
        ? 'Cache local (WFS)'
        : 'Snapshot local embutido';

  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Rede viária</Text>

      <View style={styles.statsGrid}>
        <Row label="Fonte" value={sourceLabel} />
        <Row label="Estratégia de carga" value={meta.strategy || '—'} />
        <Row label="Feições" value={Number(meta.features || 0).toLocaleString('pt-BR')} />
        <Row
          label="Carregado em"
          value={new Date(meta.builtAt || Date.now()).toLocaleTimeString('pt-BR')}
        />
        {upd.enabled && (
          <>
            <Row
              label="Atualização automática"
              value={`a cada ${Math.round((upd.checkIntervalMs || 0) / 60000)} min`}
            />
            <Row
              label="Última verificação"
              value={
                upd.lastCheckedAt
                  ? new Date(upd.lastCheckedAt).toLocaleTimeString('pt-BR')
                  : 'pendente'
              }
            />
            {upd.lastChangeAt ? (
              <Row
                label="Rede atualizada em"
                value={new Date(upd.lastChangeAt).toLocaleTimeString('pt-BR')}
              />
            ) : null}
          </>
        )}
      </View>

      {warnings.length > 0 && (
        <View style={styles.warnBox}>
          {warnings.map((w, idx) => (
            <Text key={`w-${idx}`} style={styles.warnText}>
              • {w}
            </Text>
          ))}
        </View>
      )}

      {/* Ações de sincronização com o WFS da Prefeitura */}
      <View style={styles.syncActions}>
        <TouchableOpacity
          style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
          disabled={syncing}
          onPress={onCheckUpdates}
        >
          <Text style={styles.syncBtnText}>
            {syncing ? 'Consultando WFS…' : '↻ Verificar atualizações'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
          disabled={syncing}
          onPress={onRefreshWfs}
        >
          <Text style={styles.syncBtnText}>⬇ Baixar do GeoServer</Text>
        </TouchableOpacity>
      </View>

      {/* Diagnóstico detalhado do grafo */}
      {diagnostics && (
        <>
          <TouchableOpacity
            style={styles.diagToggle}
            onPress={() => setDiagOpen((v) => !v)}
          >
            <Text style={styles.diagToggleText}>
              {diagOpen ? '▾' : '▸'} Diagnóstico do grafo
            </Text>
          </TouchableOpacity>

          {diagOpen && (
            <View style={styles.statsGrid}>
              <Row label="Nós" value={Number(diagnostics.nodes || 0).toLocaleString('pt-BR')} />
              <Row label="Arestas" value={Number(diagnostics.edges || 0).toLocaleString('pt-BR')} />
              <Row
                label="Cruzamentos"
                value={Number(diagnostics.crossings || 0).toLocaleString('pt-BR')}
              />
              <Row
                label="Toques de extremidade"
                value={Number(diagnostics.touches || 0).toLocaleString('pt-BR')}
              />
              <Row
                label="Snaps (< 5 cm)"
                value={Number(diagnostics.snaps || 0).toLocaleString('pt-BR')}
              />
              <Row
                label="Conectores (5 cm – 1 m)"
                value={Number(diagnostics.connectors || 0).toLocaleString('pt-BR')}
              />
              <Row
                label="Fusões de extremidade"
                value={Number(diagnostics.merges || 0).toLocaleString('pt-BR')}
              />
              <Row
                label="Duplicidades removidas"
                value={Number(diagnostics.duplicatesRemoved || 0).toLocaleString('pt-BR')}
              />
              <Row
                label="Componentes conexas"
                value={Number(diagnostics.components || 0).toLocaleString('pt-BR')}
              />
              <Row
                label="Maior componente"
                value={Number(diagnostics.largestComponent || 0).toLocaleString('pt-BR')}
              />
              <Row label="Construção" value={`${diagnostics.buildMs || 0} ms`} />
            </View>
          )}
        </>
      )}
    </View>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.keyText}>{label}</Text>
      <Text style={styles.valText}>{value}</Text>
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
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mutedText: {
    color: COLORS.muted,
    fontSize: 12,
  },
  statsGrid: {
    gap: 4,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  keyText: {
    color: COLORS.muted,
    fontSize: 12,
  },
  valText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '600',
  },
  warnBox: {
    backgroundColor: COLORS.warnBg,
    borderColor: COLORS.warnBorder,
    borderWidth: 1,
    borderRadius: 7,
    padding: 8,
    marginTop: 8,
    gap: 4,
  },
  warnText: {
    color: '#e3c168',
    fontSize: 11.5,
  },
  syncActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  syncBtn: {
    flex: 1,
    backgroundColor: COLORS.panel2,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 7,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  syncBtnDisabled: {
    opacity: 0.5,
  },
  syncBtnText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '600',
  },
  diagToggle: {
    marginTop: 12,
    paddingVertical: 4,
  },
  diagToggleText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
});
