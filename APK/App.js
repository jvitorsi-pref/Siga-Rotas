/**
 * APLICATIVO MOBILE REACT NATIVE — ROTEAMENTO VIÁRIO DE SANTO ANDRÉ (A PÉ)
 * ========================================================================
 *
 * Transformação completa do simulador de rotas viárias de Santo André para
 * React Native (Android APK).
 *
 * Recursos:
 *  • Motor topológico 100% local no dispositivo (UTM 23S + A* + conectores);
 *  • Rede viária oficial e não oficial (`siga:SIGA_EIXO_LOG_OFICIAL_E_NAO`);
 *  • Suporte a múltiplas paradas ordenadas (A → B → C → D…);
 *  • Resolução e validação de Endereço Digital (CEP Digital de Santo André);
 *  • Entrada por coordenadas decimais ou seleção direta por toque no mapa;
 *  • Sincronização direta com o GeoServer WFS da Prefeitura + snapshot offline.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  SafeAreaView,
  Keyboard,
} from 'react-native';

import {
  criarListaPontos,
  adicionarPonto,
  removerPonto,
  atualizarPonto,
  moverPonto,
  rotularPontos,
  podeCalcular,
  STATUS,
} from './src/core/pontoTrajeto.js';
import { mobileNetworkService } from './src/services/mobileNetworkService.js';
import {
  parseCoords,
  formatDistanceParts,
  reasonTitle,
  TEXTO_ESTADO,
} from './src/utils/formatters.js';
import { PointCard } from './src/components/PointCard.js';
import { RouteResultPanel } from './src/components/RouteResultPanel.js';
import { RoadNetworkMap } from './src/components/RoadNetworkMap.js';
import { COLORS } from './src/theme/colors.js';

function criarListaInicial() {
  const lista = criarListaPontos();
  adicionarPonto(lista, {});
  adicionarPonto(lista, {});
  return {
    pontos: lista.pontos.map((p) => ({ ...p })),
    sequencia: lista.sequencia,
  };
}

export default function App() {
  const mapRef = useRef(null);

  // Estado da lista de pontos (A, B, C, D…)
  const [lista, setLista] = useState(() => criarListaInicial());
  const [pickingId, setPickingId] = useState(null);

  // Estado da rede viária
  const [networkFeatures, setNetworkFeatures] = useState([]);

  // Estado do cálculo de rota
  const [calculating, setCalculating] = useState(false);
  const [routeResult, setRouteResult] = useState(null);
  const [routeError, setRouteError] = useState(null);
  const [partialGeometry, setPartialGeometry] = useState(null);

  // Barra de status inferior (idle | busy | ok | err)
  const [statusInfo, setStatusInfo] = useState({
    text: 'Carregando a rede viária…',
    kind: 'busy',
  });

  // Modo de layout mobile: 'split' (mapa + painel), 'map' (mapa expandido), 'panel' (painel expandido)
  const [layoutMode, setLayoutMode] = useState('split');

  const setStatus = useCallback((text, kind = 'idle') => {
    setStatusInfo({ text, kind });
  }, []);

  const cloneLista = (l) => {
    rotularPontos(l);
    return {
      pontos: l.pontos.map((p) => ({ ...p })),
      sequencia: l.sequencia,
    };
  };

  // Carregamento inicial da rede viária e assinatura de atualizações
  useEffect(() => {
    let mounted = true;

    const syncFromState = () => {
      if (!mounted) return;
      const feats = mobileNetworkService.state?.features || [];
      setNetworkFeatures(feats);
    };

    const unsubscribe = mobileNetworkService.subscribe(() => {
      syncFromState();
    });

    setStatus('Carregando a rede viária…', 'busy');
    mobileNetworkService
      .ensureReady()
      .then((st) => {
        if (!mounted) return;
        syncFromState();
        mobileNetworkService.startAutoUpdate();
        setStatus(
          `Rede pronta (${st.features.length.toLocaleString('pt-BR')} eixos).`,
          'ok'
        );
      })
      .catch((err) => {
        if (!mounted) return;
        setStatus(`Falha ao carregar a rede: ${err.message}`, 'err');
      });

    return () => {
      mounted = false;
      unsubscribe();
      mobileNetworkService.stopAutoUpdate();
    };
  }, [setStatus]);

  // ─────────────── Manipulação dos pontos do trajeto ───────────────

  const handleChangeCodigo = (id, text) => {
    setLista((atual) => {
      const copia = cloneLista(atual);
      const trimmed = text.trim();
      atualizarPonto(copia, id, {
        enderecoDigital: text,
        status: trimmed ? 'PENDENTE' : STATUS.VAZIO,
        mensagem: trimmed ? TEXTO_ESTADO.PENDENTE : TEXTO_ESTADO[STATUS.VAZIO],
        latitude: null,
        longitude: null,
      });
      return cloneLista(copia);
    });
  };

  const handleValidateCodigo = async (id) => {
    Keyboard.dismiss();
    const ponto = lista.pontos.find((p) => p.id === id);
    if (!ponto) return;
    const codigo = (ponto.enderecoDigital || '').trim();

    if (!codigo) {
      setLista((atual) => {
        const copia = cloneLista(atual);
        atualizarPonto(copia, id, {
          status: STATUS.VAZIO,
          mensagem: TEXTO_ESTADO[STATUS.VAZIO],
          latitude: null,
          longitude: null,
        });
        return cloneLista(copia);
      });
      return;
    }

    setStatus(`Validando o Endereço Digital do ponto ${ponto.rotulo}…`, 'busy');
    try {
      const data = await mobileNetworkService.resolverEnderecoDigital(codigo);
      setLista((atual) => {
        const copia = cloneLista(atual);
        const patch = {
          status: data.status,
          mensagem: data.mensagem,
          codigoNormalizado: data.codigoNormalizado,
          codigoCompleto: data.codigoCompleto,
        };
        if (data.status === STATUS.CONVERTIDO && data.latitude != null) {
          patch.latitude = data.latitude;
          patch.longitude = data.longitude;
          patch.origem = 'codigo';
          patch.mensagem =
            `Convertido: ${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}` +
            (data.codigoCompleto ? ` (${data.codigoCompleto})` : '');
        } else {
          patch.latitude = null;
          patch.longitude = null;
        }
        atualizarPonto(copia, id, patch);
        return cloneLista(copia);
      });

      if (data.status === STATUS.CONVERTIDO && data.latitude != null) {
        if (pickingId === id) {
          setPickingId(null);
        }
        setStatus('CEP Digital encontrado', 'ok');
        mapRef.current?.centerPoint(data.longitude, data.latitude);
      } else {
        setStatus(data.mensagem, 'err');
      }
    } catch (err) {
      setLista((atual) => {
        const copia = cloneLista(atual);
        atualizarPonto(copia, id, {
          status: STATUS.FALHA,
          mensagem: `Falha na resolução do endereço: ${err.message}`,
          latitude: null,
          longitude: null,
        });
        return cloneLista(copia);
      });
      setStatus('Falha na resolução do Endereço Digital.', 'err');
    }
  };

  const handleChangeCoordText = (id, text) => {
    const coords = parseCoords(text);
    setLista((atual) => {
      const copia = cloneLista(atual);
      if (coords) {
        atualizarPonto(copia, id, {
          latitude: coords.lat,
          longitude: coords.lon,
          origem: 'coordenada',
          status: STATUS.CONVERTIDO,
          mensagem: 'Coordenadas informadas manualmente.',
        });
      } else if (!text.trim()) {
        atualizarPonto(copia, id, {
          latitude: null,
          longitude: null,
          status: STATUS.VAZIO,
          mensagem: TEXTO_ESTADO[STATUS.VAZIO],
        });
      } else {
        atualizarPonto(copia, id, {
          latitude: null,
          longitude: null,
          status: 'PENDENTE',
          mensagem: 'Coordenadas em formato inválido.',
        });
      }
      return cloneLista(copia);
    });
  };

  const handleTogglePickMap = (id) => {
    Keyboard.dismiss();
    if (pickingId === id) {
      setPickingId(null);
      setStatus('Seleção no mapa cancelada.', 'idle');
      return;
    }
    const ponto = lista.pontos.find((p) => p.id === id);
    setPickingId(id);
    if (layoutMode === 'panel') {
      setLayoutMode('split');
    }
    setStatus(
      `Toque no mapa para definir o ponto ${ponto ? ponto.rotulo : ''}.`,
      'busy'
    );
  };

  const handleMapPickCoordinate = ({ lon, lat }) => {
    if (!pickingId) return;
    setLista((atual) => {
      const copia = cloneLista(atual);
      const ponto = copia.pontos.find((p) => p.id === pickingId);
      if (ponto) {
        atualizarPonto(copia, ponto.id, {
          latitude: lat,
          longitude: lon,
          status: STATUS.CONVERTIDO,
          origem: 'mapa',
          mensagem: 'Ponto selecionado no mapa.',
          enderecoDigital: ponto.enderecoDigital || '',
        });
      }
      return cloneLista(copia);
    });
    setPickingId(null);
    setStatus('Ponto definido no mapa. Calcule a rota.', 'idle');
  };

  const handleFocusMap = (ponto) => {
    Keyboard.dismiss();
    if (!ponto || ponto.latitude == null || ponto.longitude == null) return;
    if (layoutMode === 'panel') setLayoutMode('split');
    mapRef.current?.centerPoint(ponto.longitude, ponto.latitude);
  };

  const handleMoveUp = (id) => {
    Keyboard.dismiss();
    setLista((atual) => {
      const copia = cloneLista(atual);
      moverPonto(copia, id, -1);
      return cloneLista(copia);
    });
  };

  const handleMoveDown = (id) => {
    Keyboard.dismiss();
    setLista((atual) => {
      const copia = cloneLista(atual);
      moverPonto(copia, id, +1);
      return cloneLista(copia);
    });
  };

  const handleRemoveStop = (id) => {
    Keyboard.dismiss();
    setLista((atual) => {
      const copia = cloneLista(atual);
      removerPonto(copia, id);
      return cloneLista(copia);
    });
  };

  const handleAddStop = () => {
    Keyboard.dismiss();
    setLista((atual) => {
      const copia = cloneLista(atual);
      adicionarPonto(copia, {});
      return cloneLista(copia);
    });
    setStatus('Parada adicionada. Informe o Endereço Digital ou selecione no mapa.', 'idle');
  };

  const handleSwap = () => {
    Keyboard.dismiss();
    setLista((atual) => {
      if (atual.pontos.length < 2) return atual;
      const copia = cloneLista(atual);
      copia.pontos.reverse();
      rotularPontos(copia);
      return cloneLista(copia);
    });
    setStatus('Trajeto invertido.', 'idle');
  };

  const handleClear = () => {
    Keyboard.dismiss();
    setPickingId(null);
    setLista(criarListaInicial());
    setRouteResult(null);
    setRouteError(null);
    setPartialGeometry(null);
    setStatus('Pronto', 'idle');
  };

  // ─────────────── Cálculo da rota ───────────────

  const handleCalculate = async () => {
    Keyboard.dismiss();
    const verificacao = podeCalcular(lista);
    if (!verificacao.ok) {
      setRouteResult(null);
      setPartialGeometry(null);
      setRouteError({
        title: 'Pontos incompletos',
        message: verificacao.mensagem,
      });
      setStatus(verificacao.mensagem, 'err');
      return;
    }

    setCalculating(true);
    setStatus('Calculando a rota…', 'busy');
    setRouteResult(null);
    setRouteError(null);
    setPartialGeometry(null);

    const pontosPayload = lista.pontos.map((p) => ({
      rotulo: p.rotulo,
      latitude: p.latitude,
      longitude: p.longitude,
      enderecoDigital: p.enderecoDigital || null,
    }));

    try {
      const data = await mobileNetworkService.calcularRotaParadas(pontosPayload);
      if (!data.ok) {
        setRouteError({
          title: reasonTitle(data.reason),
          message: data.message || 'Não foi possível calcular a rota.',
        });
        if (data.legs && data.legs.length && data.geometry) {
          setPartialGeometry(data.geometry);
        }
        setStatus('Sem rota completa.', 'err');
        return;
      }

      setRouteResult(data);
      const d = formatDistanceParts(data.distance);
      setStatus(`Rota calculada: ${d.v} ${d.u}.`, 'ok');
    } catch (err) {
      setRouteError({
        title: 'Falha no cálculo',
        message: err.message,
      });
      setStatus('Falha ao calcular a rota.', 'err');
    } finally {
      setCalculating(false);
    }
  };

  const pickingPoint = pickingId
    ? lista.pontos.find((p) => p.id === pickingId) || null
    : null;

  const activeRouteGeometry = routeResult?.geometry || partialGeometry || null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <View style={styles.root}>
        {/* Cabeçalho compacto com logo SIGA APP e alternador de visualização */}
        <View style={styles.header}>
          <View style={styles.headerLogoWrap}>
            <Image
              source={require('./assets/logo-siga-app.png')}
              style={styles.headerLogo}
              resizeMode="contain"
              accessibilityLabel="SIGA APP"
            />
          </View>

          <View style={styles.modeSwitch}>
            <TouchableOpacity
              style={[
                styles.modeBtn,
                layoutMode === 'split' && styles.modeBtnActive,
              ]}
              onPress={() => {
                Keyboard.dismiss();
                setLayoutMode('split');
              }}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  layoutMode === 'split' && styles.modeBtnTextActive,
                ]}
              >
                Dividido
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeBtn,
                layoutMode === 'map' && styles.modeBtnActive,
              ]}
              onPress={() => {
                Keyboard.dismiss();
                setLayoutMode('map');
              }}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  layoutMode === 'map' && styles.modeBtnTextActive,
                ]}
              >
                Mapa
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeBtn,
                layoutMode === 'panel' && styles.modeBtnActive,
              ]}
              onPress={() => {
                Keyboard.dismiss();
                setLayoutMode('panel');
              }}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  layoutMode === 'panel' && styles.modeBtnTextActive,
                ]}
              >
                Painel
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Área do Mapa Cartográfico */}
        {layoutMode !== 'panel' && (
          <View
            style={[
              styles.mapArea,
              layoutMode === 'map' ? styles.mapAreaFull : styles.mapAreaSplit,
            ]}
          >
            <RoadNetworkMap
              ref={mapRef}
              features={networkFeatures}
              markers={lista.pontos}
              routeGeometry={activeRouteGeometry}
              pickingPoint={pickingPoint}
              onCancelPick={() => {
                setPickingId(null);
                setStatus('Pronto', 'idle');
              }}
              onMapPickCoordinate={handleMapPickCoordinate}
            />
          </View>
        )}

        {/* Painel de Controle e Resultados */}
        {layoutMode !== 'map' && (
          <ScrollView
            style={styles.panelScroll}
            contentContainerStyle={styles.panelContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Pontos do trajeto</Text>

              {lista.pontos.map((p) => (
                <PointCard
                  key={p.id}
                  ponto={p}
                  totalPontos={lista.pontos.length}
                  isPicking={pickingId === p.id}
                  onChangeCodigo={handleChangeCodigo}
                  onValidateCodigo={handleValidateCodigo}
                  onChangeCoordText={handleChangeCoordText}
                  onTogglePickMap={handleTogglePickMap}
                  onFocusMap={handleFocusMap}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                  onRemove={handleRemoveStop}
                  onSubmitCalculate={handleCalculate}
                />
              ))}

              <TouchableOpacity
                style={styles.btnGhost}
                onPress={handleAddStop}
              >
                <Text style={styles.btnGhostText}>+ Adicionar parada</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btnPrimary, calculating && styles.btnDisabled]}
                disabled={calculating}
                onPress={handleCalculate}
              >
                <Text style={styles.btnPrimaryText}>
                  {calculating ? 'Calculando rota…' : 'Calcular rota'}
                </Text>
              </TouchableOpacity>

              <View style={styles.secondaryButtonsRow}>
                <TouchableOpacity
                  style={[styles.btnGhost, styles.btnHalf]}
                  onPress={handleSwap}
                >
                  <Text style={styles.btnGhostText}>⇅ Inverter</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btnGhost, styles.btnHalf]}
                  onPress={handleClear}
                >
                  <Text style={styles.btnGhostText}>Limpar</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Bloco de Resultado da Rota */}
            <RouteResultPanel
              routeResult={routeResult}
              routeError={routeError}
            />
          </ScrollView>
        )}

        {/* Rodapé de Status Fixo */}
        <View style={styles.footer}>
          <View
            style={[
              styles.statusDot,
              statusInfo.kind === 'ok' && { backgroundColor: COLORS.ok },
              statusInfo.kind === 'busy' && { backgroundColor: COLORS.accent },
              statusInfo.kind === 'err' && { backgroundColor: COLORS.err },
            ]}
          />
          <Text
            style={[
              styles.statusText,
              statusInfo.kind === 'ok' && { color: COLORS.ok },
              statusInfo.kind === 'busy' && { color: COLORS.accent },
              statusInfo.kind === 'err' && { color: COLORS.err },
            ]}
            numberOfLines={1}
          >
            {statusInfo.text}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    backgroundColor: COLORS.panel,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerLogoWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerLogo: {
    width: 163,
    height: 40,
    maxWidth: '100%',
    aspectRatio: 541 / 133,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: COLORS.inputBg,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  modeBtn: {
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  modeBtnActive: {
    backgroundColor: COLORS.accentStrong,
  },
  modeBtnText: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  modeBtnTextActive: {
    color: COLORS.white,
  },
  mapArea: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  mapAreaSplit: {
    height: '42%',
    minHeight: 210,
  },
  mapAreaFull: {
    flex: 1,
  },
  panelScroll: {
    flex: 1,
    backgroundColor: COLORS.panel,
  },
  panelContent: {
    paddingBottom: 20,
  },
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
  btnPrimary: {
    backgroundColor: COLORS.accentStrong,
    borderColor: COLORS.accentStrong,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 7,
  },
  btnDisabled: {
    opacity: 0.55,
  },
  btnPrimaryText: {
    color: COLORS.white,
    fontSize: 13.5,
    fontWeight: '700',
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    marginTop: 6,
  },
  btnGhostText: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '600',
  },
  secondaryButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  btnHalf: {
    flex: 1,
  },
  footer: {
    backgroundColor: COLORS.panel,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.muted,
  },
  statusText: {
    color: COLORS.muted,
    fontSize: 12,
    flex: 1,
  },
});
