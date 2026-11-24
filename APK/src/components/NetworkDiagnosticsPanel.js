/**
 * PAINEL DA REDE VIÁRIA E DIAGNÓSTICO DO GRAFO
 * ============================================
 *
 * Exibe os metadados da rede carregada (`siga:SIGA_EIXO_LOG_OFICIAL_E_NAO`),
 * o estado da conexão com o backend Node.js (direto ou via `ApiProxy.ashx`),
 * a configuração opcional do endereço do servidor no dispositivo e o diagnóstico
 * completo da construção do grafo topológico.
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { COLORS } from '../theme/colors.js';
import { apresentarRede } from '../utils/networkPresentation.js';

export function NetworkDiagnosticsPanel({
  meta,
  diagnostics,
  syncing,
  operacao,
  feedback,
  onRetry,
  onCheckUpdates,
  onRefreshWfs,
  onSaveApiUrl,
}) {
  const [diagOpen, setDiagOpen] = useState(false);
  const [serverConfigOpen, setServerConfigOpen] = useState(false);
  const [apiUrlDraft, setApiUrlDraft] = useState(null);

  if (!meta) {
    return (
      <View style={styles.block}>
        <Text style={styles.blockTitle}>Rede viária</Text>
        {feedback?.kind === 'err' ? <>
          <Text accessibilityRole="alert" style={styles.errorText}>{feedback.text}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.syncBtn} disabled={syncing} onPress={onRetry}>
            <Text style={styles.syncBtnText}>Tentar carregar rede novamente</Text>
          </TouchableOpacity>
        </> : <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={COLORS.accent} />
          <Text style={styles.mutedText}>Construindo grafo viário em UTM 23S…</Text>
        </View>}
      </View>
    );
  }

  const upd = meta.update || {};
  const apresentacao = apresentarRede(meta);
  const warnings = apresentacao.avisos;
  const currentApiUrl = meta?.remoteApi?.url || '';
  const draftValue = apiUrlDraft !== null ? apiUrlDraft : currentApiUrl;

  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Rede viária</Text>

      <View style={styles.statsGrid}>
        <Row label="Fonte" value={apresentacao.fonte} />
        <Row label="Persistência" value={apresentacao.cache} />
        <Row label="Cálculo" value={apresentacao.calculo} />
        <Row label="Backend" value={apresentacao.transporte} />
        {apresentacao.servidor ? <Row label="URL do servidor" value={apresentacao.servidor} /> : null}
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
        {!upd.enabled && <Row label="Atualização automática" value="Desativada" />}
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

      {!!feedback && <Text accessibilityRole={feedback.kind === 'err' ? 'alert' : undefined}
        style={feedback.kind === 'err' ? styles.errorText : styles.mutedText}>{feedback.text}</Text>}
      {apresentacao.erros.length > 0 && <View style={styles.warnBox}>
        <Text style={styles.warnText}>Erros recentes de atualização</Text>
        {apresentacao.erros.map((e, i) => <Text key={`erro-${i}`} style={styles.warnText}>{e}</Text>)}
      </View>}

      {/* Consulta e download da rede viária WFS / Node.js. */}
      <View style={styles.syncActions}>
        <TouchableOpacity
          style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
          disabled={syncing}
          accessibilityRole="button" accessibilityState={{ disabled: !!syncing, busy: !!syncing }}
          onPress={onCheckUpdates}
        >
          <Text style={styles.syncBtnText}>
            {operacao === 'verificar' ? 'Verificando WFS…' : '↻ Verificar atualizações'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
          disabled={syncing}
          accessibilityRole="button" accessibilityState={{ disabled: !!syncing, busy: !!syncing }}
          onPress={onRefreshWfs}
        >
          <Text style={styles.syncBtnText}>{operacao === 'baixar' ? 'Atualizando…' : 'Atualizar ruas'}</Text>
        </TouchableOpacity>
      </View>

      {/* Configuração opcional da URL do backend (API direta ou ApiProxy.ashx) */}
      {typeof onSaveApiUrl === 'function' && (
        <>
          <TouchableOpacity
            style={styles.diagToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: serverConfigOpen }}
            onPress={() => {
              const next = !serverConfigOpen;
              if (next) setApiUrlDraft(currentApiUrl);
              setServerConfigOpen(next);
            }}
          >
            <Text style={styles.diagToggleText}>
              {serverConfigOpen ? '▾' : '▸'} Configurar servidor backend
            </Text>
          </TouchableOpacity>

          {serverConfigOpen && (
            <View style={styles.serverConfigBox}>
              <Text style={styles.serverHintText}>
                Informe a URL do Node.js (ex.: https://api.../SigaRotas) ou do proxy WebForms (ex.: https://portal.../SigaApp/SigaRotas/ApiProxy.ashx). Sem servidor ou sem rede, o app opera localmente.
              </Text>
              <TextInput
                style={styles.serverInput}
                value={draftValue}
                onChangeText={(txt) => setApiUrlDraft(txt)}
                placeholder="https://portal.../SigaApp/SigaRotas/ApiProxy.ashx"
                placeholderTextColor={COLORS.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                editable={!syncing}
              />
              <View style={styles.serverActionsRow}>
                <TouchableOpacity
                  style={[styles.syncBtn, styles.serverPrimaryBtn, syncing && styles.syncBtnDisabled]}
                  disabled={syncing}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!syncing, busy: operacao === 'conectar' }}
                  onPress={() => onSaveApiUrl(draftValue)}
                >
                  <Text style={styles.serverPrimaryBtnText}>
                    {operacao === 'conectar' ? 'Conectando…' : 'Conectar e sincronizar'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
                  disabled={syncing}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!syncing }}
                  onPress={() => {
                    setApiUrlDraft('');
                    return onSaveApiUrl('');
                  }}
                >
                  <Text style={styles.syncBtnText}>Usar modo local</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
      )}

      {/* Diagnóstico detalhado do grafo */}
      {diagnostics && (
        <>
          <TouchableOpacity
            style={styles.diagToggle}
            accessibilityRole="button" accessibilityState={{ expanded: diagOpen }}
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
  errorText: { color: COLORS.err, fontSize: 12, marginVertical: 8 },
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
    flex: 1,
    color: COLORS.muted,
    fontSize: 12,
  },
  valText: {
    flex: 1,
    textAlign: 'right',
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
    color: COLORS.warn,
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
  serverConfigBox: {
    marginTop: 8,
    padding: 10,
    backgroundColor: COLORS.panel2,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 8,
    gap: 8,
  },
  serverHintText: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
  },
  serverInput: {
    backgroundColor: COLORS.bg,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    color: COLORS.text,
    fontSize: 12,
  },
  serverActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  serverPrimaryBtn: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  serverPrimaryBtnText: {
    color: COLORS.panel,
    fontSize: 11.5,
    fontWeight: '700',
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
