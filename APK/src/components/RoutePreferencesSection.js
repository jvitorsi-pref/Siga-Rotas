import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { CATEGORIAS_OCORRENCIA } from '../ocorrencias/catalogo.js';
import { MODOS_PREFERENCIA, normalizarPreferencias } from '../ocorrencias/preferencias.js';
import { COLORS } from '../theme/colors';

const OPCOES_MODO = [
  { id: MODOS_PREFERENCIA.CONSIDERAR, rotulo: 'Equilibrada (considera alertas e evita bloqueios)' },
  { id: MODOS_PREFERENCIA.PRIORIZAR_SEM_DIFICULDADES, rotulo: 'Priorizar trechos sem dificuldades (1,5x)' },
  { id: MODOS_PREFERENCIA.IGNORAR, rotulo: 'Ignorar alertas (somente menor distância)' },
];

export function RoutePreferencesSection({
  preferencias,
  onChangePreferencias,
}) {
  const [expanded, setExpanded] = useState(false);
  const norm = normalizarPreferencias(preferencias);
  const evitarSet = new Set(norm.evitarCategorias || []);
  const modoAtual = OPCOES_MODO.find((m) => m.id === norm.modo) || OPCOES_MODO[0];

  const selecionarModo = (modo) => {
    onChangePreferencias?.(normalizarPreferencias({ ...norm, modo }));
  };

  const alternarCategoria = (catId) => {
    const proximo = new Set(evitarSet);
    if (proximo.has(catId)) proximo.delete(catId);
    else proximo.add(catId);
    onChangePreferencias?.(
      normalizarPreferencias({ ...norm, evitarCategorias: Array.from(proximo) }),
    );
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        accessibilityRole="button"
        onPress={() => setExpanded((v) => !v)}
      >
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>
            {expanded ? '▾' : '▸'} Preferências do trajeto
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {modoAtual.rotulo}
            {evitarSet.size > 0 ? ` · ${evitarSet.size} categoria(s) evitada(s)` : ''}
          </Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          <Text style={styles.sectionLabel}>Comportamento diante de alertas</Text>
          <View style={styles.modesWrap}>
            {OPCOES_MODO.map((op) => {
              const ativo = norm.modo === op.id;
              return (
                <TouchableOpacity
                  key={op.id}
                  style={[styles.modeBtn, ativo && styles.modeBtnActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: ativo }}
                  onPress={() => selecionarModo(op.id)}
                >
                  <Text style={[styles.modeText, ativo && styles.modeTextActive]}>
                    {op.rotulo}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 10 }]}>
            Evitar sempre categorias específicas
          </Text>
          <View style={styles.chipsWrap}>
            {CATEGORIAS_OCORRENCIA.map((cat) => {
              const ativo = evitarSet.has(cat.id);
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.chip, ativo && styles.chipActive]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ativo }}
                  onPress={() => alternarCategoria(cat.id)}
                >
                  <Text style={[styles.chipText, ativo && styles.chipTextActive]}>
                    {cat.rotulo}
                  </Text>
                </TouchableOpacity>
              );
            })}
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
  headerTextWrap: {
    gap: 2,
  },
  title: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 11,
    color: COLORS.muted,
  },
  body: {
    paddingHorizontal: 11,
    paddingBottom: 11,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 9,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.muted,
    marginBottom: 6,
  },
  modesWrap: {
    gap: 5,
  },
  modeBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    backgroundColor: COLORS.panel,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  modeBtnActive: {
    borderColor: COLORS.accent,
    backgroundColor: '#f2f8f4',
  },
  modeText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  modeTextActive: {
    color: COLORS.accent,
    fontWeight: '700',
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
    paddingVertical: 4,
    paddingHorizontal: 9,
    backgroundColor: COLORS.panel,
  },
  chipActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent,
  },
  chipText: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  chipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
