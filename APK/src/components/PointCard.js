/**
 * CARTÃO DE PONTO DO TRAJETO (ORIGEM, PARADA OU DESTINO)
 * ======================================================
 *
 * Equivalente nativo em React Native de `.point` em `public/app.js`.
 * Suporta:
 *  • Entrada e validação de Endereço Digital (CEP Digital de Santo André);
 *  • Entrada manual de coordenadas decimais (lon,lat ou lat,lon, com vírgula ou ponto);
 *  • Botão 🗺 para selecionar o ponto diretamente no mapa;
 *  • Botão 🎯 para centralizar o mapa no ponto;
 *  • Reordenação (↑ / ↓) e remoção (✕) de paradas intermediárias.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Keyboard,
} from 'react-native';
import { podeDescerParada } from '../utils/controlesTrajeto.js';
import { TIPOS } from '../core/pontoTrajeto.js';
import { TEXTO_ESTADO, classeEstado } from '../utils/formatters.js';
import { COLORS } from '../theme/colors';

export function PointCard({
  ponto,
  totalPontos,
  circuito = false,
  isPicking,
  onChangeCodigo,
  onValidateCodigo,
  onChangeCoordText,
  onTogglePickMap,
  onFocusMap,
  onMoveUp,
  onMoveDown,
  onRemove,
  onSubmitCalculate,
}) {
  const isOrigem = ponto.tipo === TIPOS.ORIGEM;
  const isDestino = ponto.tipo === TIPOS.DESTINO;
  const isParada = ponto.tipo === TIPOS.PARADA;

  const roleLabel = isOrigem
    ? 'Origem'
    : isDestino
      ? 'Destino'
      : `Parada ${ponto.rotulo}`;

  const accentColor = isOrigem
    ? COLORS.origin
    : isDestino
      ? COLORS.dest
      : COLORS.stop;

  const formattedCoord =
    ponto.latitude != null && ponto.longitude != null
      ? `${Number(ponto.longitude).toFixed(6)}, ${Number(ponto.latitude).toFixed(6)}`
      : '';

  const [coordInput, setCoordInput] = useState(formattedCoord);
  const codigoInputRef = useRef(null);
  const coordInputRef = useRef(null);

  const dismissInputs = () => {
    codigoInputRef.current?.blur();
    coordInputRef.current?.blur();
    Keyboard.dismiss();
  };

  // Sincroniza quando a coordenada vem do mapa ou do Endereço Digital
  useEffect(() => {
    if (ponto.origem === 'mapa' || ponto.origem === 'codigo' || (ponto.latitude == null && ponto.longitude == null && ponto.status === 'VAZIO')) {
      setCoordInput(formattedCoord);
    }
  }, [ponto.latitude, ponto.longitude, ponto.origem, ponto.status, formattedCoord]);

  const handleCoordChange = (text) => {
    setCoordInput(text);
    onChangeCoordText(ponto.id, text);
  };

  const estadoKind = classeEstado(ponto.status);
  const estadoText = ponto.mensagem || TEXTO_ESTADO[ponto.status] || '';

  const canMoveUp = isParada && ponto.indice > 1;
  const canMoveDown = podeDescerParada(ponto, totalPontos, circuito);
  const hasCoord = ponto.latitude != null && ponto.longitude != null;

  return (
    <View style={[styles.card, { borderLeftColor: accentColor }]}>
      {/* Cabeçalho do ponto: Rótulo (A/B/C), Papel e Ações */}
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: accentColor }]}>
          <Text style={styles.badgeText}>{ponto.rotulo}</Text>
        </View>
        <Text style={styles.roleText}>{roleLabel}</Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.miniBtn}
            onPress={() => {
              dismissInputs();
              onValidateCodigo(ponto.id);
            }}
            accessibilityLabel={`Validar Endereço Digital do ponto ${ponto.rotulo}`}
          >
            <Text style={styles.miniBtnText}>Validar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.miniBtn, !hasCoord && styles.miniBtnDisabled]}
            disabled={!hasCoord}
            onPress={() => {
              dismissInputs();
              onFocusMap(ponto);
            }}
            accessibilityLabel={`Localizar ponto ${ponto.rotulo} no mapa`}
          >
            <Text style={styles.miniBtnText}>🎯</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.miniBtn, !canMoveUp && styles.miniBtnDisabled]}
            disabled={!canMoveUp}
            onPress={() => {
              dismissInputs();
              onMoveUp(ponto.id);
            }}
            accessibilityLabel="Subir parada na ordem"
          >
            <Text style={styles.miniBtnText}>↑</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.miniBtn, !canMoveDown && styles.miniBtnDisabled]}
            disabled={!canMoveDown}
            onPress={() => {
              dismissInputs();
              onMoveDown(ponto.id);
            }}
            accessibilityLabel="Descer parada na ordem"
          >
            <Text style={styles.miniBtnText}>↓</Text>
          </TouchableOpacity>

          {isParada && (
            <TouchableOpacity
              style={[styles.miniBtn, styles.miniBtnDanger]}
              onPress={() => {
                dismissInputs();
                onRemove(ponto.id);
              }}
              accessibilityLabel={`Remover parada ${ponto.rotulo}`}
            >
              <Text style={[styles.miniBtnText, styles.miniBtnDangerText]}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Linha 1: Endereço Digital (CEP Digital de Santo André) */}
      <View style={styles.row}>
        <TextInput
          ref={codigoInputRef}
          style={[styles.input, styles.codigoInput]}
          value={ponto.enderecoDigital || ''}
          onChangeText={(text) => onChangeCodigo(ponto.id, text)}
          onSubmitEditing={() => {
            dismissInputs();
            onValidateCodigo(ponto.id);
          }}
          placeholder="Endereço Digital (ex.: 8FP9+J6)"
          placeholderTextColor={COLORS.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
        />
      </View>

      {/* Mensagem de estado do Endereço Digital / Coordenada */}
      <Text
        style={[
          styles.estado,
          estadoKind === 'ok' && styles.estadoOk,
          estadoKind === 'erro' && styles.estadoErro,
        ]}
      >
        {estadoText}
      </Text>

      {/* Linha 2: Coordenadas decimais ou seleção no mapa */}
      <View style={styles.row}>
        <TextInput
          ref={coordInputRef}
          style={styles.input}
          value={coordInput}
          onChangeText={handleCoordChange}
          onSubmitEditing={() => {
            dismissInputs();
            onSubmitCalculate();
          }}
          placeholder="ou -46,5320 , -23,6635"
          placeholderTextColor={COLORS.muted}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
        />
        <TouchableOpacity
          style={[styles.pickBtn, isPicking && styles.pickBtnActive]}
          onPress={() => {
            dismissInputs();
            onTogglePickMap(ponto.id);
          }}
          accessibilityLabel={`Selecionar ponto ${ponto.rotulo} no mapa`}
        >
          <Text style={styles.pickBtnText}>🗺</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 3.5,
    borderRadius: 8,
    backgroundColor: COLORS.panel2,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 7,
  },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 11.5,
    fontWeight: '700',
  },
  roleText: {
    flex: 1,
    fontSize: 11.5,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.inputBg,
    borderRadius: 5,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  miniBtnDisabled: {
    opacity: 0.35,
  },
  miniBtnDanger: {
    borderColor: 'rgba(207, 34, 46, 0.45)',
  },
  miniBtnText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  miniBtnDangerText: {
    color: COLORS.dest,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 7,
    color: COLORS.text,
    paddingHorizontal: 9,
    paddingVertical: 6,
    fontSize: 12.5,
  },
  codigoInput: {
    letterSpacing: 0.5,
  },
  estado: {
    marginTop: 4,
    marginBottom: 2,
    fontSize: 11,
    color: COLORS.muted,
  },
  estadoOk: {
    color: COLORS.ok,
  },
  estadoErro: {
    color: COLORS.err,
  },
  pickBtn: {
    width: 38,
    height: 36,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickBtnActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  pickBtnText: {
    fontSize: 15,
  },
});
