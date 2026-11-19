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

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  AppState,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  adicionarPonto,
  removerPonto,
  atualizarPonto,
  moverPonto,
  rotularPontos,
  podeCalcular,
  STATUS,
} from './src/core/pontoTrajeto.js';
import { NetworkDiagnosticsPanel } from './src/components/NetworkDiagnosticsPanel.js';
import { criarPainelRede } from './src/services/networkPanelService.js';
import { NavigationPanel } from './src/components/NavigationPanel.js';
import { criarFonteGPSReal } from './src/services/nativeLocation.js';
import { criarNavegacaoMobile } from './src/services/mobileNavigationService.js';
import { mobileNetworkService } from './src/services/mobileNetworkService.js';
import { OcorrenciasMobileService } from './src/services/ocorrenciasMobileService.js';
import { MODOS_PREFERENCIA, preferenciasPadrao } from './src/ocorrencias/preferencias.js';
import {
  parseCoords,
  formatDistanceParts,
  reasonTitle,
  TEXTO_ESTADO,
} from './src/utils/formatters.js';
import { PointCard } from './src/components/PointCard.js';
import { RoutePreferencesSection } from './src/components/RoutePreferencesSection.js';
import { OccurrenceModal } from './src/components/OccurrenceModal.js';
import { RouteResultPanel } from './src/components/RouteResultPanel.js';
import { RoadNetworkMap } from './src/components/RoadNetworkMap.js';
import { trechosParaMapa } from './src/map/routePresentation.js';
import { trechoSobClique } from './src/utils/trechoNoMapa.js';
import { criarRevisoesEndereco } from './src/utils/revisoesEndereco.js';
import { criarListaCircuito, opcoesCalculoCircuito, resolverPontoNoMapa } from './src/utils/planejamentoCircuito.js';
import { exportarRotaGpxMobile } from './src/services/mobileGpxExport.js';
import { CAMADA_PADRAO, CAMADAS_BASE, normalizarCamadaBase } from './src/map/camadaBase.js';
import { carregarCamadaBaseMobile, salvarCamadaBaseMobile } from './src/services/basemapPreference.js';
import { COLORS } from './src/theme/colors.js';

export default function App() {
  const mapRef = useRef(null);
  const revisoesEndereco = useRef(null);
  if (!revisoesEndereco.current) revisoesEndereco.current = criarRevisoesEndereco();

  // Estado da lista de pontos (A, B, C, D…)
  const [lista, setLista] = useState(criarListaCircuito);
  const [pickingId, setPickingId] = useState(null);
  const [pickingOccurrence, setPickingOccurrence] = useState(false);

  // Estado colaborativo de ocorrências e preferências de trajeto
  const ocorrenciasServiceRef = useRef(null);
  if (!ocorrenciasServiceRef.current) {
    ocorrenciasServiceRef.current = new OcorrenciasMobileService({
      storage: AsyncStorage,
      networkService: mobileNetworkService,
    });
  }
  const [usuarioId, setUsuarioId] = useState(null);
  const [preferencias, setPreferencias] = useState(preferenciasPadrao);
  const preferenciasRef = useRef(preferencias);
  preferenciasRef.current = preferencias;
  const [ocorrencias, setOcorrencias] = useState([]);
  const ocorrenciasRef = useRef(ocorrencias);
  ocorrenciasRef.current = ocorrencias;
  const [showOccurrences, setShowOccurrences] = useState(true);
  const [occModal, setOccModal] = useState({
    visible: false,
    mode: 'create',
    segmentoPreview: null,
    coordinate: null,
    ocorrencia: null,
    submitting: false,
    errorText: null,
  });

  // Estado das alternativas de rota
  const [routeAlternatives, setRouteAlternatives] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [comparacaoAlternativas, setComparacaoAlternativas] = useState(null);
  const lastCalcModeRef = useRef('usuario');

  // Estado da rede viária
  const [networkFeatures, setNetworkFeatures] = useState([]);
  const [networkCacheWarning, setNetworkCacheWarning] = useState(null);
  const [networkPanel, setNetworkPanel] = useState({ meta: null, diagnostics: null, operacao: 'carregar', feedback: null });
  const networkPanelRef = useRef(null);

  // Estado do cálculo de rota
  const [calculating, setCalculating] = useState(false);
  const [routeResult, setRouteResult] = useState(null);
  const [navigation, setNavigation] = useState(null);
  const [navigationCenter, setNavigationCenter] = useState(null);
  const navigationRef = useRef(null);
  const calculoRef = useRef(0);
  if (!navigationRef.current) navigationRef.current = criarNavegacaoMobile({
    calcularRotaParadas: (pontos, options) => mobileNetworkService.calcularRotaParadas(pontos, {
      ...options,
      preferencias: preferenciasRef.current,
      ocorrencias: ocorrenciasRef.current,
    }),
    criarFonteGPS: criarFonteGPSReal,
    aoMudar: setNavigation,
    aoRecalcular: setRouteResult,
  });
  const [visibilidade, setVisibilidade] = useState({ rota: null, ocultos: [] });
  const ocultos = useMemo(() => visibilidade.rota === routeResult ? visibilidade.ocultos : [], [visibilidade, routeResult]);
  const routeSegments = useMemo(() => trechosParaMapa((routeResult?.legs || []).map((leg, indice) => ({
    ...leg, situacao: navigation ? (navigation.concluida || indice < navigation.trechoAtual ? 'percorrido' : indice === navigation.trechoAtual ? 'atual' : null) : null,
  })), ocultos), [routeResult, ocultos, navigation?.trechoAtual, navigation?.execucao, navigation?.concluida]);
  const toggleSegment = (indice) => setVisibilidade((anterior) => {
    const atuais = anterior.rota === routeResult ? anterior.ocultos : [];
    return { rota: routeResult, ocultos: atuais.includes(indice)
      ? atuais.filter((i) => i !== indice) : [...atuais, indice] };
  });
  const restoreSegments = () => setVisibilidade({ rota: routeResult, ocultos: [] });

  // Toque no mapa sem seleção de ponto: oculta/mostra o trecho mais próximo,
  // como o clique em `routeLayer` no Web. Não recalcula nem altera distâncias.
  const handleMapClick = ({ lon, lat, zoom } = {}) => {
    if (!routeSegments.length) return;
    const alvo = trechoSobClique(routeSegments, lon, lat, { zoom });
    if (!alvo) return;
    const trecho = routeSegments[alvo.indice];
    toggleSegment(alvo.indice);
    setStatus(
      trecho.visivel === false
        ? `Trecho ${trecho.de} → ${trecho.para} mostrado novamente.`
        : `Trecho ${trecho.de} → ${trecho.para} oculto. A legenda permite mostrar de novo.`,
      'idle',
    );
  };
  const [routeError, setRouteError] = useState(null);
  const [partialGeometry, setPartialGeometry] = useState(null);
  const [exportingGpx, setExportingGpx] = useState(false);
  const [gpxFeedback, setGpxFeedback] = useState(null);

  useEffect(() => {
    setGpxFeedback(null);
  }, [routeResult, routeError, lista]);

  // Barra de status inferior (idle | busy | ok | err)
  const [statusInfo, setStatusInfo] = useState({
    text: 'Carregando a rede viária…',
    kind: 'busy',
  });

  // Modo de layout mobile: 'split' (mapa + painel), 'map' (mapa expandido), 'panel' (painel expandido)
  const [layoutMode, setLayoutMode] = useState('split');
  const [basemapMode, setBasemapMode] = useState(CAMADA_PADRAO);
  const basemapTouchedRef = useRef(false);

  const setStatus = useCallback((text, kind = 'idle') => {
    setStatusInfo({ text, kind });
  }, []);

  useEffect(() => {
    let ativo = true;
    void carregarCamadaBaseMobile().then((salvo) => {
      if (ativo && !basemapTouchedRef.current) {
        setBasemapMode(normalizarCamadaBase(salvo));
      }
    });
    return () => { ativo = false; };
  }, []);

  const cloneLista = (l) => {
    rotularPontos(l);
    return {
      pontos: l.pontos.map((p) => ({ ...p })),
      sequencia: l.sequencia,
      circuito: l.circuito,
    };
  };

  // Edição invalida navegação/plano e respostas de cálculo anteriores.
  useEffect(() => {
    calculoRef.current++;
    navigationRef.current.encerrar();
    setRouteResult(null); setRouteError(null); setPartialGeometry(null); setCalculating(false); setNavigationCenter(null);
    setRouteAlternatives(null); setSelectedRouteId(null); setComparacaoAlternativas(null);
  }, [lista]);
  useEffect(() => () => { revisoesEndereco.current.limpar(); calculoRef.current++; navigationRef.current.descartar(); }, []);

  // O painel é dono da assinatura/comandos; não atualiza a UI após descarte.
  useEffect(() => {
    let ultimoFeedback = null;
    const svcOcc = ocorrenciasServiceRef.current;
    void svcOcc.obterOuCriarUsuarioId().then((uid) => setUsuarioId(uid));
    void svcOcc.carregarPreferencias().then((pref) => setPreferencias(pref));
    void svcOcc.listarAtivas().then((ativas) => setOcorrencias(ativas)).catch(() => {});

    const painel = criarPainelRede({ service: mobileNetworkService, aoMudar: (estado) => {
      setNetworkPanel(estado);
      setNetworkFeatures(estado.features);
      setNetworkCacheWarning(estado.meta?.cache?.error || null);
      if (estado.feedback && estado.feedback !== ultimoFeedback) {
        ultimoFeedback = estado.feedback;
        setStatus(estado.feedback.text, estado.feedback.kind);
      }
    } });
    networkPanelRef.current = painel;
    void painel.abrir();
    const appStateSub = AppState?.addEventListener?.('change', (nextState) => {
      if (nextState === 'active') {
        void mobileNetworkService.syncWithServer().then(() => svcOcc.listarAtivas().then((ativas) => setOcorrencias(ativas))).catch(() => {});
      }
    });
    return () => {
      appStateSub?.remove?.();
      painel.descartar();
      networkPanelRef.current = null;
    };
  }, [setStatus]);

  // ─────────────── Manipulação dos pontos do trajeto ───────────────

  const handleChangeCodigo = (id, text) => {
    revisoesEndereco.current.invalidar(id);
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
    const token = revisoesEndereco.current.iniciar(id);

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
      if (!revisoesEndereco.current.atual(token)) return;
      setLista((atual) => {
        if (!revisoesEndereco.current.atual(token) || !atual.pontos.some(p => p.id === id && (p.enderecoDigital || '').trim() === codigo)) return atual;
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
      if (!revisoesEndereco.current.atual(token)) return;
      setLista((atual) => {
        if (!revisoesEndereco.current.atual(token) || !atual.pontos.some(p => p.id === id && (p.enderecoDigital || '').trim() === codigo)) return atual;
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
    revisoesEndereco.current.invalidar(id);
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
    revisoesEndereco.current.invalidar(pickingId);
    let resolvido = null;
    try {
      resolvido = resolverPontoNoMapa(lat, lon, { acao: 'selecionado' });
    } catch {
      resolvido = null;
    }
    setLista((atual) => {
      const copia = cloneLista(atual);
      const ponto = copia.pontos.find((p) => p.id === pickingId);
      if (ponto) {
        if (resolvido) {
          atualizarPonto(copia, ponto.id, {
            latitude: resolvido.latitude,
            longitude: resolvido.longitude,
            status: resolvido.status,
            origem: resolvido.origem,
            mensagem: resolvido.mensagem,
            enderecoDigital: resolvido.enderecoDigital,
            codigoNormalizado: resolvido.codigoNormalizado,
            codigoCompleto: resolvido.codigoCompleto,
          });
        } else {
          atualizarPonto(copia, ponto.id, {
            latitude: lat,
            longitude: lon,
            status: STATUS.CONVERTIDO,
            origem: 'mapa',
            mensagem: 'Ponto selecionado no mapa.',
            enderecoDigital: ponto.enderecoDigital || '',
          });
        }
      }
      return cloneLista(copia);
    });
    setPickingId(null);
    if (resolvido?.naRegiao) {
      setStatus(`Ponto definido no mapa (${resolvido.enderecoDigital}).`, 'ok');
    } else if (resolvido) {
      setStatus(resolvido.mensagem, 'err');
    } else {
      setStatus('Ponto definido no mapa. Calcule a rota.', 'idle');
    }
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
    revisoesEndereco.current.invalidar(id);
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

  const handleClear = () => {
    revisoesEndereco.current.limpar();
    Keyboard.dismiss();
    setPickingId(null);
    setPickingOccurrence(false);
    setLista(criarListaCircuito());
    setRouteResult(null);
    setRouteAlternatives(null);
    setSelectedRouteId(null);
    setComparacaoAlternativas(null);
    setRouteError(null);
    setPartialGeometry(null);
    setGpxFeedback(null);
    setStatus('Pronto', 'idle');
  };

  const handleExportGpx = async () => {
    if (exportingGpx) return;
    Keyboard.dismiss();
    if (!routeResult || routeResult.ok === false || routeResult.parcial) {
      const msg = 'Calcule uma rota completa antes de exportar em GPX.';
      setGpxFeedback({ kind: 'err', text: msg });
      setStatus(msg, 'err');
      return;
    }
    setExportingGpx(true);
    setGpxFeedback(null);
    setStatus('Preparando exportação GPX…', 'busy');
    try {
      const res = await exportarRotaGpxMobile(routeResult, { pontos: lista.pontos });
      if (res.ok) {
        setGpxFeedback({ kind: 'ok', text: res.mensagem });
        setStatus(res.mensagem, 'ok');
      } else if (res.cancelado) {
        setGpxFeedback({ kind: 'warn', text: res.mensagem });
        setStatus(res.mensagem, 'idle');
      } else {
        setGpxFeedback({ kind: 'err', text: res.mensagem });
        setStatus(res.mensagem, 'err');
      }
    } finally {
      setExportingGpx(false);
    }
  };

  const handleChangeBasemap = (modo) => {
    Keyboard.dismiss();
    const proximo = normalizarCamadaBase(modo);
    basemapTouchedRef.current = true;
    setBasemapMode(proximo);
    void salvarCamadaBaseMobile(proximo);
    const info = CAMADAS_BASE[proximo];
    setStatus(`Mapa de fundo alterado para ${info.rotulo} (${info.provedor}).`, 'idle');
  };

  // ─────────────── Ocorrências colaborativas e alternativas ───────────────

  const limparAlternativas = () => {
    setRouteAlternatives(null);
    setSelectedRouteId(null);
    setComparacaoAlternativas(null);
  };

  const selecionarAlternativa = (altId, listaAlts = routeAlternatives) => {
    const alts = Array.isArray(listaAlts) ? listaAlts : [];
    const escolhida = alts.find((r) => r.id === altId) || alts[0];
    if (!escolhida) return;
    setSelectedRouteId(escolhida.id);
    setRouteResult(escolhida.rota || routeResult);
    const d = formatDistanceParts(escolhida.distance ?? escolhida.rota?.distance);
    setStatus(`Rota selecionada (${escolhida.rotulo || escolhida.id}): ${d.v} ${d.u}.`, 'ok');
  };

  const aplicarResultadoAlternativas = (data) => {
    if (Array.isArray(data.rotas) && data.rotas.length) {
      const idAtivo = data.rotaSelecionadaId || data.rotas[0].id;
      const escolhida = data.rotas.find((r) => r.id === idAtivo) || data.rotas[0];
      setRouteAlternatives(data.rotas);
      setComparacaoAlternativas(data.comparacaoAlternativas || null);
      setSelectedRouteId(escolhida.id);
      setRouteResult(escolhida.rota || data);
      const d = formatDistanceParts(escolhida.distance ?? data.distance);
      const qtdAlts = data.rotas.length;
      setStatus(
        qtdAlts > 1
          ? `Rota calculada (${qtdAlts} opções): ${d.v} ${d.u}.`
          : `Rota calculada: ${d.v} ${d.u}.`,
        'ok',
      );
      return;
    }
    setRouteAlternatives(null);
    setSelectedRouteId(null);
    setComparacaoAlternativas(null);
    setRouteResult(data);
    const d = formatDistanceParts(data.distance);
    setStatus(`Rota calculada: ${d.v} ${d.u}.`, 'ok');
  };

  const handleChangePreferencias = async (novasPrefs) => {
    const salvas = await ocorrenciasServiceRef.current.salvarPreferencias(novasPrefs);
    setPreferencias(salvas);
    preferenciasRef.current = salvas;
    if ((routeResult?.ok || routeError?.bloqueadaPorRestricao) && podeCalcular(lista).ok) {
      void handleCalculate(lastCalcModeRef.current || 'usuario', salvas);
    }
  };

  const handleStartPickOccurrence = () => {
    Keyboard.dismiss();
    setPickingId(null);
    setPickingOccurrence(true);
    if (layoutMode === 'panel') setLayoutMode('split');
    setStatus('Toque sobre uma rua no mapa para registrar uma ocorrência.', 'busy');
  };

  const handleMapPickOccurrence = async ({ lon, lat }) => {
    setPickingOccurrence(false);
    setStatus('Identificando o segmento viário…', 'busy');
    try {
      const seg = await ocorrenciasServiceRef.current.associarSegmento({
        latitude: lat,
        longitude: lon,
      });
      if (!seg?.ok) {
        setStatus(seg?.message || 'Toque mais próximo de uma via mapeada (até 45 m).', 'err');
        return;
      }
      setOccModal({
        visible: true,
        mode: 'create',
        segmentoPreview: seg,
        coordinate: { lon, lat },
        ocorrencia: null,
        submitting: false,
        errorText: null,
      });
      setStatus(`Via identificada: ${seg.principal?.logradouro || 'Trecho viário'}.`, 'idle');
    } catch (err) {
      setStatus(err?.message || 'Não foi possível identificar a via.', 'err');
    }
  };

  const handleOpenOccurrenceDetail = (occOuId) => {
    const occ =
      typeof occOuId === 'string'
        ? ocorrencias.find((o) => o.id === occOuId)
        : ocorrencias.find((o) => o.id === occOuId?.id) || occOuId;
    if (!occ) return;
    setOccModal({
      visible: true,
      mode: 'detail',
      segmentoPreview: null,
      coordinate: null,
      ocorrencia: occ,
      submitting: false,
      errorText: null,
    });
  };

  const handleSubmitCreateOccurrence = async (payload) => {
    setOccModal((prev) => ({ ...prev, submitting: true, errorText: null }));
    try {
      const res = await ocorrenciasServiceRef.current.registrar(payload, { usuarioId });
      if (!res?.ok) {
        setOccModal((prev) => ({
          ...prev,
          submitting: false,
          errorText: res?.message || 'Não foi possível registrar a ocorrência.',
        }));
        return;
      }
      const ativas = await ocorrenciasServiceRef.current.listarAtivas();
      setOcorrencias(ativas);
      ocorrenciasRef.current = ativas;
      setOccModal((prev) => ({ ...prev, visible: false, submitting: false }));
      setStatus(
        res.pendenteSincronizacao
          ? 'Ocorrência salva offline e será sincronizada ao reconectar.'
          : 'Ocorrência registrada e aplicada à rede.',
        'ok',
      );
      if ((routeResult?.ok || routeError) && podeCalcular(lista).ok) {
        void handleCalculate(lastCalcModeRef.current || 'usuario');
      }
    } catch (err) {
      setOccModal((prev) => ({
        ...prev,
        submitting: false,
        errorText: err?.message || 'Falha ao registrar ocorrência.',
      }));
    }
  };

  const handleInteractOccurrence = async (id, tipo) => {
    setOccModal((prev) => ({ ...prev, submitting: true, errorText: null }));
    try {
      const res = await ocorrenciasServiceRef.current.interagir({ id, tipo, usuarioId });
      if (!res?.ok) {
        setOccModal((prev) => ({
          ...prev,
          submitting: false,
          errorText: res?.message || 'Não foi possível registrar sua resposta.',
        }));
        return;
      }
      const ativas = await ocorrenciasServiceRef.current.listarAtivas();
      setOcorrencias(ativas);
      ocorrenciasRef.current = ativas;
      const aindaAtiva = ativas.find((o) => o.id === id);
      setOccModal((prev) => ({
        ...prev,
        visible: !!aindaAtiva,
        ocorrencia: aindaAtiva || res.ocorrencia,
        submitting: false,
      }));
      setStatus(
        res.pendenteSincronizacao
          ? 'Interação salva offline para sincronização posterior.'
          : 'Interação registrada.',
        'ok',
      );
      if ((routeResult?.ok || routeError) && podeCalcular(lista).ok) {
        void handleCalculate(lastCalcModeRef.current || 'usuario');
      }
    } catch (err) {
      setOccModal((prev) => ({
        ...prev,
        submitting: false,
        errorText: err?.message || 'Falha ao interagir com a ocorrência.',
      }));
    }
  };

  // ─────────────── Cálculo da rota ───────────────

  const handleCalculate = async (modo = 'usuario', prefOverride = null) => {
    Keyboard.dismiss();
    if (typeof lastCalcModeRef !== 'undefined') lastCalcModeRef.current = modo;
    const verificacao = podeCalcular(lista);
    if (!verificacao.ok) {
      setRouteResult(null);
      setPartialGeometry(null);
      if (typeof limparAlternativas === 'function') limparAlternativas();
      setRouteError({
        title: 'Pontos incompletos',
        message: verificacao.mensagem,
      });
      setStatus(verificacao.mensagem, 'err');
      return;
    }

    navigationRef.current.encerrar();
    const requestId = ++calculoRef.current;
    setCalculating(true);
    setStatus('Calculando a rota…', 'busy');
    setRouteResult(null);
    if (typeof limparAlternativas === 'function') limparAlternativas();
    setRouteError(null);
    setPartialGeometry(null);

    const pontosPayload = lista.pontos.map((p) => ({
      rotulo: p.rotulo,
      latitude: p.latitude,
      longitude: p.longitude,
      enderecoDigital: p.enderecoDigital || null,
    }));

    const opcoesCalc = { ...opcoesCalculoCircuito(modo) };
    if (prefOverride != null) opcoesCalc.preferencias = prefOverride;
    else if (typeof preferenciasRef !== 'undefined' && preferenciasRef.current != null) {
      opcoesCalc.preferencias = preferenciasRef.current;
    }
    if (typeof ocorrenciasRef !== 'undefined' && Array.isArray(ocorrenciasRef.current) && ocorrenciasRef.current.length > 0) {
      opcoesCalc.ocorrencias = ocorrenciasRef.current;
    }

    try {
      const data = await mobileNetworkService.calcularRotaParadas(pontosPayload, opcoesCalc);
      if (requestId !== calculoRef.current) return;
      if (!data.ok) {
        setRouteError({
          title: reasonTitle(data.reason),
          message: data.message || 'Não foi possível calcular a rota.',
          bloqueadaPorRestricao:
            data.reason === 'BLOQUEADO_POR_OCORRENCIA' ||
            data.bloqueadaPorRestricao === true,
        });
        if (data.legs && data.legs.length && data.geometry) {
          setPartialGeometry(data.geometry);
        }
        setStatus('Sem rota completa.', 'err');
        return;
      }

      if (typeof aplicarResultadoAlternativas === 'function') {
        aplicarResultadoAlternativas(data);
      } else {
        setRouteResult(data);
        const d = formatDistanceParts(data.distance);
        setStatus(`Rota calculada: ${d.v} ${d.u}.`, 'ok');
      }
    } catch (err) {
      if (requestId !== calculoRef.current) return;
      setRouteError({
        title: 'Falha no cálculo',
        message: err.message,
      });
      setStatus('Falha ao calcular a rota.', 'err');
    } finally {
      if (requestId === calculoRef.current) setCalculating(false);
    }
  };

  const pickingPoint = pickingId
    ? lista.pontos.find((p) => p.id === pickingId) || null
    : null;

  const activeRouteGeometry = routeResult?.geometry || partialGeometry || null;

  const altRoutesMap = useMemo(() => {
    if (!Array.isArray(routeAlternatives) || routeAlternatives.length <= 1) return [];
    return routeAlternatives
      .filter((r) => r.id !== selectedRouteId && r.rota?.geometry)
      .map((r) => ({ id: r.id, geometry: r.rota.geometry }));
  }, [routeAlternatives, selectedRouteId]);

  const highlightSegmentsMap = useMemo(() => {
    const ativa =
      (Array.isArray(routeAlternatives) &&
        routeAlternatives.find((r) => r.id === selectedRouteId)) ||
      null;
    const listaOcc = ativa?.ocorrenciasNoTrajeto || routeResult?.ocorrenciasNoTrajeto || [];
    const out = [];
    for (const oc of listaOcc) {
      const match = ocorrencias.find((item) => item.id === oc.id);
      const fid = match?.localizacao?.featureId ?? oc.featureId ?? null;
      if (fid == null) continue;
      const feat = networkFeatures.find((f) => Number(f.properties?.ID) === Number(fid));
      if (feat?.geometry) {
        out.push({
          id: oc.id,
          classificacao: oc.classificacao || match?.classificacao,
          geometry: feat.geometry,
        });
      }
    }
    return out;
  }, [routeAlternatives, selectedRouteId, routeResult, ocorrencias, networkFeatures]);

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
          <View
            pointerEvents={layoutMode === 'panel' ? 'none' : 'auto'}
            accessibilityElementsHidden={layoutMode === 'panel'}
            importantForAccessibility={layoutMode === 'panel' ? 'no-hide-descendants' : 'auto'}
            style={[
              styles.mapArea,
              layoutMode === 'panel' && styles.mapAreaHidden,
              layoutMode === 'map' ? styles.mapAreaFull : styles.mapAreaSplit,
            ]}
          >
            <RoadNetworkMap
              ref={mapRef}
              visible={layoutMode !== 'panel'}
              basemapMode={basemapMode}
              onChangeBasemap={handleChangeBasemap}
              features={networkFeatures}
              markers={lista.pontos}
              routeGeometry={activeRouteGeometry}
              routeSegments={routeSegments}
              navigationPosition={navigation?.posicao}
              centerRequest={navigationCenter}
              isSimulating={navigation?.modo === 'simulacao'}
              isGPS={navigation?.modo === 'gps'}
              suppressRouteFit={!!navigation}
              onToggleSegment={toggleSegment}
              onRestoreSegments={restoreSegments}
              pickingPoint={pickingPoint}
              onCancelPick={() => {
                setPickingId(null);
                setStatus('Pronto', 'idle');
              }}
              onMapPickCoordinate={handleMapPickCoordinate}
              onMapClick={handleMapClick}
              occurrences={ocorrencias}
              showOccurrences={showOccurrences}
              altRoutes={altRoutesMap}
              highlightSegments={highlightSegmentsMap}
              pickingOccurrence={pickingOccurrence}
              onStartPickOccurrence={handleStartPickOccurrence}
              onCancelPickOccurrence={() => {
                setPickingOccurrence(false);
                setStatus('Pronto', 'idle');
              }}
              onMapPickOccurrence={handleMapPickOccurrence}
              onOccurrenceClick={handleOpenOccurrenceDetail}
              onAltRouteClick={(altId) => selecionarAlternativa(altId)}
              onToggleOccurrences={() => setShowOccurrences((v) => !v)}
            />
          </View>

        {/* Painel de Controle e Resultados */}
        {layoutMode !== 'map' && (
          <ScrollView
            style={styles.panelScroll}
            contentContainerStyle={styles.panelContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Pontos do trajeto</Text>
              {!!networkCacheWarning && <Text accessibilityRole="alert" style={styles.cacheWarning}>{networkCacheWarning}</Text>}

              {lista.pontos.map((p) => (
                <PointCard
                  key={p.id}
                  ponto={p}
                  totalPontos={lista.pontos.length}
                  circuito={lista.circuito}
                  isPicking={pickingId === p.id}
                  onChangeCodigo={handleChangeCodigo}
                  onValidateCodigo={handleValidateCodigo}
                  onChangeCoordText={handleChangeCoordText}
                  onTogglePickMap={handleTogglePickMap}
                  onFocusMap={handleFocusMap}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                  onRemove={handleRemoveStop}
                  onSubmitCalculate={() => handleCalculate('usuario')}
                />
              ))}

              <Text style={styles.circuitHint}>A é a origem e o destino. O retorno a A é automático.</Text>

              <TouchableOpacity
                style={styles.btnGhost}
                onPress={handleAddStop}
              >
                <Text style={styles.btnGhostText}>+ Adicionar parada</Text>
              </TouchableOpacity>

              <RoutePreferencesSection
                preferencias={preferencias}
                onChangePreferencias={handleChangePreferencias}
              />

              <TouchableOpacity
                style={[styles.btnPrimary, calculating && styles.btnDisabled]}
                disabled={calculating}
                onPress={() => handleCalculate('usuario')}
              >
                <Text style={styles.btnPrimaryText}>
                  {calculating ? 'Calculando rota…' : 'Calcular rota'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btnPrimary, calculating && styles.btnDisabled]}
                disabled={calculating}
                accessibilityHint="Otimiza a distância total, incluindo o retorno a A"
                onPress={() => handleCalculate('otimizada')}
              >
                <Text style={styles.btnPrimaryText}>Calcular rota otimizada</Text>
              </TouchableOpacity>

              <View style={styles.secondaryButtonsRow}>
                <TouchableOpacity
                  style={[styles.btnGhost, styles.btnHalf]}
                  onPress={handleClear}
                >
                  <Text style={styles.btnGhostText}>Limpar</Text>
                </TouchableOpacity>
              </View>
            </View>

            <NavigationPanel estado={navigation} controller={navigationRef.current}
              podeIniciar={!!routeResult?.ok} onStart={(modo) => navigationRef.current.iniciar(routeResult, modo)}
              onCenter={() => {
                if (navigation?.posicao) {
                  setNavigationCenter({ ...navigation.posicao });
                  if (layoutMode === 'panel') setLayoutMode('split');
                }
              }} />

            {/* Bloco de Resultado da Rota */}
            <RouteResultPanel
              routeResult={routeResult}
              routeSegments={routeSegments}
              onToggleSegment={toggleSegment}
              onRestoreSegments={restoreSegments}
              onExportGpx={handleExportGpx}
              exportingGpx={exportingGpx}
              gpxFeedback={gpxFeedback}
              routeError={routeError}
              routeAlternatives={routeAlternatives}
              selectedRouteId={selectedRouteId}
              comparacaoAlternativas={comparacaoAlternativas}
              onSelectAlternative={(altId) => selecionarAlternativa(altId)}
              onInspectOccurrence={(oc) => {
                const match = ocorrencias.find((o) => o.id === oc.id);
                if (match) {
                  const loc = match.localizacao || match;
                  if (layoutMode === 'panel') setLayoutMode('split');
                  if (loc.longitude != null && loc.latitude != null) {
                    mapRef.current?.centerPoint(loc.longitude, loc.latitude);
                  }
                  handleOpenOccurrenceDetail(match);
                }
              }}
              onBypassAlerts={() => {
                void handleChangePreferencias({
                  ...preferencias,
                  modo: MODOS_PREFERENCIA.IGNORAR,
                });
              }}
            />

            <OccurrenceModal
              visible={occModal.visible}
              mode={occModal.mode}
              segmentoPreview={occModal.segmentoPreview}
              coordinate={occModal.coordinate}
              ocorrencia={occModal.ocorrencia}
              usuarioId={usuarioId}
              submitting={occModal.submitting}
              errorText={occModal.errorText}
              onClose={() => setOccModal((prev) => ({ ...prev, visible: false }))}
              onSubmitCreate={handleSubmitCreateOccurrence}
              onInteract={handleInteractOccurrence}
              onFocusCoordinate={(coord) => {
                setOccModal((prev) => ({ ...prev, visible: false }));
                if (layoutMode === 'panel') setLayoutMode('split');
                mapRef.current?.centerPoint(coord.longitude, coord.latitude);
              }}
            />

            <NetworkDiagnosticsPanel
              meta={networkPanel.meta} diagnostics={networkPanel.diagnostics}
              syncing={!!networkPanel.operacao} operacao={networkPanel.operacao}
              feedback={networkPanel.feedback}
              onRetry={() => networkPanelRef.current?.executar('carregar')}
              onCheckUpdates={() => networkPanelRef.current?.executar('verificar')}
              onRefreshWfs={() => networkPanelRef.current?.executar('baixar')}
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
  mapAreaHidden: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
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
  cacheWarning: { color: COLORS.warn, backgroundColor: COLORS.warnBg, borderColor: COLORS.warnBorder, borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12 },
  circuitHint: { color: COLORS.muted, marginBottom: 12 },
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
