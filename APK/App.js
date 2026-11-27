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
import { criarServicoCampoMobile } from './src/services/campoMobileService.js';
import { rotuloIndicadorSync, SYNC_STATUS, TIPO_ROTA, reconstruirRespostaRotaDeRegistro } from './src/campo/modeloCampo.js';
import { SavedRoutesSection } from './src/components/SavedRoutesSection.js';
import { RouteObservationsSection } from './src/components/RouteObservationsSection.js';
import { RouteObservationModal } from './src/components/RouteObservationModal.js';
import { ConfirmActionModal } from './src/components/ConfirmActionModal.js';
import { BottomSheetPanel } from './src/components/BottomSheetPanel.js';
import {
  ESTADOS_SHEET,
  calcularAlturasSheet,
  calcularInsetMapaParaSheet,
} from './src/components/bottomSheetLayout.js';
import { VisitPlanningSection } from './src/components/VisitPlanningSection.js';
import { ImportScheduleModal } from './src/components/ImportScheduleModal.js';
import { obterLocalizacaoAtual } from './src/services/currentLocation.js';
import {
  carregarPlanejamentoMobile,
  exportarModeloPlanilhaMobile,
  limparPlanejamentoMobile,
  normalizarPeriodoPlanejamento,
  normalizarStatusVisita,
  PERIODOS_PLANEJAMENTO,
  planejarVisitasPeriodo,
  salvarPlanejamentoMobile,
  selecionarELerPlanilhaMobile,
  STATUS_VISITA,
  sugerirVisitasProximasAoTrajeto,
} from './src/services/planejamentoMobileService.js';
import { COLORS } from './src/theme/colors.js';

export default function App() {
  const mapRef = useRef(null);
  const revisoesEndereco = useRef(null);
  if (!revisoesEndereco.current) revisoesEndereco.current = criarRevisoesEndereco();

  // Estado da lista de pontos (A, B, C, D…)
  const [lista, setLista] = useState(criarListaCircuito);
  const listaRef = useRef(lista);
  listaRef.current = lista;
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
  const usuarioIdRef = useRef(null);
  usuarioIdRef.current = usuarioId;
  const [preferencias, setPreferencias] = useState(preferenciasPadrao);
  const preferenciasRef = useRef(preferencias);
  preferenciasRef.current = preferencias;
  const [ocorrencias, setOcorrencias] = useState([]);
  const ocorrenciasRef = useRef(ocorrencias);
  ocorrenciasRef.current = ocorrencias;
  const [showOccurrences, setShowOccurrences] = useState(true);
  const [occCategoryFilter, setOccCategoryFilter] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [locatingCurrent, setLocatingCurrent] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState(null);

  // Estado de planejamento de visitas ACS (offline-first via SQLite)
  const [pacientesTerritorio, setPacientesTerritorio] = useState([]);
  const [planoVisitas, setPlanoVisitas] = useState(null);
  const [periodoPlanejamento, setPeriodoPlanejamento] = useState(PERIODOS_PLANEJAMENTO.SEMANAL);
  const [visitFeedback, setVisitFeedback] = useState(null);
  const [importPreviewModal, setImportPreviewModal] = useState({
    visible: false,
    arquivo: '',
    preview: null,
  });
  const [occModal, setOccModal] = useState({
    visible: false,
    mode: 'create',
    segmentoPreview: null,
    coordinate: null,
    ocorrencia: null,
    submitting: false,
    errorText: null,
  });

  // Estado offline-first de campo (SQLite + Sync WebForms)
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [savingRoute, setSavingRoute] = useState(false);
  const [saveOfflineFeedback, setSaveOfflineFeedback] = useState(null);
  const [gpsTrailGeometry, setGpsTrailGeometry] = useState(null);
  const [gpsRecordForExport, setGpsRecordForExport] = useState(null);
  const [routeObservations, setRouteObservations] = useState([]);
  const [pendingRecovery, setPendingRecovery] = useState([]);
  const [pickingRouteObs, setPickingRouteObs] = useState(false);
  const [syncSummary, setSyncSummary] = useState({ estado: 'IDLE', texto: 'Salvo no dispositivo', pendentes: 0, erros: 0 });
  const [routeObsModal, setRouteObsModal] = useState({
    visible: false,
    mode: 'create',
    coordinate: null,
    observacao: null,
    eventos: [],
    submitting: false,
    errorText: null,
  });
  const [confirmModal, setConfirmModal] = useState({
    visible: false,
    title: '',
    message: '',
    items: [],
    alertText: null,
    confirmLabel: 'Confirmar',
    submitting: false,
    onConfirm: null,
  });

  const campoServiceRef = useRef(null);
  const refreshCampoUiRef = useRef(null);
  if (!campoServiceRef.current) {
    campoServiceRef.current = criarServicoCampoMobile({
      obterApiUrl: () => mobileNetworkService.options.remoteApiUrl,
      obterUsuarioId: () => usuarioIdRef.current || 'agente-mobile',
      obterDispositivoId: () => usuarioIdRef.current || 'apk-siga-rotas',
      estaOnline: () => !!mobileNetworkService.options.remoteApiUrl && mobileNetworkService.remote.lastError == null,
      aoMudar: () => {
        void refreshCampoUiRef.current?.();
      },
      aoMudarSync: (resumo) => {
        if (!resumo) return;
        const ind = typeof resumo.texto === 'string' ? resumo : rotuloIndicadorSync(resumo);
        setSyncSummary({
          ...resumo,
          estado: ind.estado || resumo.estado || 'IDLE',
          texto: typeof ind.texto === 'string' ? ind.texto : 'Salvo no dispositivo',
        });
      },
    });
  }

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
  const restoringSavedRouteRef = useRef(false);
  const plannedRouteOriginalRef = useRef(null);
  const lastGpsExecutionIdRef = useRef(null);
  const gpsExecQueueRef = useRef(Promise.resolve());
  if (!navigationRef.current) navigationRef.current = criarNavegacaoMobile({
    calcularRotaParadas: (pontos, options) => mobileNetworkService.calcularRotaParadas(pontos, {
      ...options,
      preferencias: preferenciasRef.current,
      ocorrencias: ocorrenciasRef.current,
    }),
    criarFonteGPS: criarFonteGPSReal,
    aoMudar: setNavigation,
    aoRecalcular: setRouteResult,
    aoIniciarExecucao: (rota, opts) => {
      if (!plannedRouteOriginalRef.current && rota?.ok !== false && !rota?.parcial) {
        plannedRouteOriginalRef.current = {
          rota,
          pontos: (listaRef.current?.pontos || []).map((p) => ({ ...p })),
        };
      }
      if (opts?.modo !== 'simulacao') {
        lastGpsExecutionIdRef.current = null;
        setGpsRecordForExport(null);
      }
      const rotaPlano = plannedRouteOriginalRef.current?.rota || rota;
      const prom = campoServiceRef.current?.iniciarNavegacaoGps(rotaPlano, opts);
      if (prom) {
        gpsExecQueueRef.current = prom.then((exec) => {
          if (opts?.modo !== 'simulacao' && exec?.idCliente) {
            lastGpsExecutionIdRef.current = exec.idCliente;
          }
          return exec;
        }).catch(() => {});
      }
    },
    aoAtualizarPontoExecucao: (ponto) => {
      const prom = campoServiceRef.current?.registrarPontoGps(ponto).then((res) => {
        if (res?.aceito && res?.geometria) {
          setGpsTrailGeometry(res.geometria);
        }
      });
      if (prom) gpsExecQueueRef.current = prom.catch(() => {});
    },
    aoPausarExecucao: () => {
      const prom = campoServiceRef.current?.pausarNavegacaoGps();
      if (prom) gpsExecQueueRef.current = prom.catch(() => {});
    },
    aoRetomarExecucao: () => {
      const prom = campoServiceRef.current?.retomarNavegacaoGps();
      if (prom) gpsExecQueueRef.current = prom.catch(() => {});
    },
    aoEncerrarExecucao: (info) => {
      const prom = campoServiceRef.current?.finalizarNavegacaoGps(info).then((res) => {
        if (res?.rota && !res.rota.simulado) {
          if (res.rota.geometry) {
            lastGpsExecutionIdRef.current = res.rota.idCliente;
            setGpsRecordForExport(res.rota);
          } else if (lastGpsExecutionIdRef.current === res.rota.idCliente) {
            lastGpsExecutionIdRef.current = null;
            setGpsRecordForExport(null);
          }
        }
        void refreshCampoUiRef.current?.();
        return res;
      });
      if (prom) gpsExecQueueRef.current = prom.catch(() => {});
    },
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
  }, [routeResult, routeError, lista, gpsRecordForExport]);

  // Barra de status inferior (idle | busy | ok | err)
  const [statusInfo, setStatusInfo] = useState({
    text: 'Carregando a rede viária…',
    kind: 'busy',
  });

  // Bottom sheet retrátil em 3 estágios (collapsed | mid | expanded) sobre o mapa em tela cheia
  const [sheetState, setSheetState] = useState(ESTADOS_SHEET.MID);
  const [mapStageHeight, setMapStageHeight] = useState(700);
  const [basemapMode, setBasemapMode] = useState(CAMADA_PADRAO);
  const basemapTouchedRef = useRef(false);

  const mapBottomInset = useMemo(() => {
    const alturas = calcularAlturasSheet(mapStageHeight);
    return calcularInsetMapaParaSheet(sheetState, alturas);
  }, [mapStageHeight, sheetState]);

  const garantirMapaVisivel = useCallback(() => {
    setSheetState((prev) => (prev === ESTADOS_SHEET.EXPANDED ? ESTADOS_SHEET.MID : prev));
  }, []);

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
    if (restoringSavedRouteRef.current) {
      restoringSavedRouteRef.current = false;
      return;
    }
    calculoRef.current++;
    navigationRef.current.encerrar();
    plannedRouteOriginalRef.current = null;
    lastGpsExecutionIdRef.current = null;
    setGpsRecordForExport(null);
    setSaveOfflineFeedback(null);
    setRouteResult(null); setRouteError(null); setPartialGeometry(null); setCalculating(false); setNavigationCenter(null);
    setRouteAlternatives(null); setSelectedRouteId(null); setComparacaoAlternativas(null);
    setGpsTrailGeometry(null);
    campoServiceRef.current?.limparSessaoGpsEmMemoria();
    campoServiceRef.current?.definirRotaCalculadaAtiva(null);
  }, [lista]);
  useEffect(() => () => { revisoesEndereco.current.limpar(); calculoRef.current++; navigationRef.current.descartar(); }, []);

  const refreshCampoUi = useCallback(async () => {
    const svc = campoServiceRef.current;
    if (!svc) return;
    try {
      const [rotas, pendentesRec, resumo] = await Promise.all([
        svc.listarRotasSalvas({ limit: 40 }),
        svc.listarExecucoesGpsEmAndamento(),
        svc.obterResumoSincronizacao(),
      ]);
      setSavedRoutes(rotas || []);
      setPendingRecovery(pendentesRec || []);
      const ind = typeof resumo?.texto === 'string' ? resumo : rotuloIndicadorSync(resumo || {});
      setSyncSummary({
        ...(resumo || {}),
        estado: ind.estado || resumo?.estado || 'IDLE',
        texto: typeof ind.texto === 'string' ? ind.texto : 'Salvo no dispositivo',
      });
      const rotaObsAlvo = svc.obterRotaParaObservacao();
      if (rotaObsAlvo?.idCliente) {
        const obs = await svc.listarObservacoes({ idRotaCliente: rotaObsAlvo.idCliente });
        setRouteObservations(obs || []);
      } else {
        setRouteObservations([]);
      }
    } catch {
      /* mantém estado anterior se o banco ainda estiver inicializando */
    }
  }, []);
  refreshCampoUiRef.current = refreshCampoUi;

  // O painel é dono da assinatura/comandos; não atualiza a UI após descarte.
  useEffect(() => {
    let ultimoFeedback = null;
    const svcOcc = ocorrenciasServiceRef.current;
    const svcCampo = campoServiceRef.current;
    void svcOcc.obterOuCriarUsuarioId().then((uid) => {
      usuarioIdRef.current = uid;
      setUsuarioId(uid);
    });
    void svcOcc.carregarPreferencias().then((pref) => setPreferencias(pref));
    void svcOcc.listarAtivas().then((ativas) => setOcorrencias(ativas)).catch(() => {});
    void svcCampo.inicializar().then(async () => {
      await refreshCampoUi();
      const carregado = await carregarPlanejamentoMobile(svcCampo.repositorio?.driver);
      setPacientesTerritorio(carregado.pacientes || []);
      setPeriodoPlanejamento(carregado.periodo || PERIODOS_PLANEJAMENTO.SEMANAL);
      if (carregado.plano) {
        setPlanoVisitas(carregado.plano);
      } else if (carregado.pacientes?.length) {
        setPlanoVisitas(planejarVisitasPeriodo(carregado.pacientes, { periodo: carregado.periodo }));
      }
    });

    const painel = criarPainelRede({ service: mobileNetworkService, aoMudar: (estado) => {
      setNetworkPanel(estado);
      setNetworkFeatures(estado.features);
      if (Array.isArray(estado.features) && estado.features.length > 0 && estado.meta?.fingerprint) {
        void svcCampo.repositorio.salvarCacheRede({
          type: 'FeatureCollection',
          features: estado.features,
          meta: estado.meta,
        }).catch(() => {});
      }
      setNetworkCacheWarning(estado.meta?.cache?.error || null);
      if (estado.feedback && estado.feedback !== ultimoFeedback) {
        ultimoFeedback = estado.feedback;
        setStatus(estado.feedback.text, estado.feedback.kind);
      }
    } });
    networkPanelRef.current = painel;
    void painel.abrir().then(() => {
      void svcOcc.listarAtivas().then((ativas) => setOcorrencias(ativas)).catch(() => {});
      void svcCampo.sincronizarPendentes().catch(() => {});
    });
    const appStateSub = AppState?.addEventListener?.('change', (nextState) => {
      if (nextState === 'active') {
        void mobileNetworkService.checkForChanges({ deep: false }).then(() => {
          void svcOcc.listarAtivas().then((ativas) => setOcorrencias(ativas)).catch(() => {});
          void svcCampo.sincronizarPendentes().catch(() => {});
        }).catch(() => {});
      }
    });
    return () => {
      appStateSub?.remove?.();
      painel.descartar();
      networkPanelRef.current = null;
    };
  }, [setStatus, refreshCampoUi]);

  const handleSaveApiUrl = async (rawUrl) => {
    const res = await networkPanelRef.current?.configurarServidor(rawUrl);
    if (res?.ok && res.mode === 'remote') {
      await ocorrenciasServiceRef.current
        ?.listarAtivas()
        .then((ativas) => setOcorrencias(ativas))
        .catch(() => {});
      void campoServiceRef.current?.sincronizarPendentes().catch(() => {});
    }
    return res;
  };

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
    setSheetState(ESTADOS_SHEET.COLLAPSED);
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
    setSheetState(ESTADOS_SHEET.MID);
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
    garantirMapaVisivel();
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
    setPickingRouteObs(false);
    plannedRouteOriginalRef.current = null;
    lastGpsExecutionIdRef.current = null;
    setGpsRecordForExport(null);
    setLista(criarListaCircuito());
    setRouteResult(null);
    setRouteAlternatives(null);
    setSelectedRouteId(null);
    setComparacaoAlternativas(null);
    setRouteError(null);
    setPartialGeometry(null);
    setGpxFeedback(null);
    setSaveOfflineFeedback(null);
    setGpsTrailGeometry(null);
    campoServiceRef.current?.limparSessaoGpsEmMemoria();
    campoServiceRef.current?.definirRotaCalculadaAtiva(null);
    setStatus('Pronto', 'idle');
  };

  const handleExportGpx = async () => {
    if (exportingGpx) return;
    Keyboard.dismiss();

    const navEstado = navigationRef.current?.estado;
    const navEmAndamento =
      !!navEstado && (navEstado.execucao === 'ativo' || navEstado.execucao === 'pausado');
    if (navEmAndamento) {
      const msg = 'Encerre ou finalize a navegação em andamento antes de exportar o GPX. Os dados da navegação permanecem preservados.';
      setGpxFeedback({ kind: 'err', text: msg });
      setStatus(msg, 'err');
      return;
    }

    setExportingGpx(true);
    setGpxFeedback(null);
    setStatus('Preparando exportação GPX…', 'busy');
    try {
      await gpsExecQueueRef.current;

      const svc = campoServiceRef.current;
      const rotaCalcOriginal = plannedRouteOriginalRef.current?.rota || null;
      const pontosCalc = plannedRouteOriginalRef.current?.pontos?.length
        ? plannedRouteOriginalRef.current.pontos
        : lista.pontos;

      let rotaPercorrida = gpsRecordForExport && !gpsRecordForExport.simulado ? gpsRecordForExport : null;
      let pontosGps = [];
      let idGps = lastGpsExecutionIdRef.current || rotaPercorrida?.idCliente || null;

      if (svc) {
        const sessaoGps = svc.obterUltimaExecucaoGpsSessao?.();
        if (sessaoGps?.rota && !sessaoGps.rota.simulado && (!idGps || sessaoGps.rota.idCliente === idGps)) {
          rotaPercorrida = sessaoGps.rota;
          pontosGps = Array.isArray(sessaoGps.pontosGps) ? sessaoGps.pontosGps : [];
          if (!idGps) idGps = sessaoGps.rota.idCliente;
        }
        if (!idGps && rotaCalcOriginal?.idCliente) {
          const execs = await svc.listarRotasSalvas({
            tipoRota: TIPO_ROTA.GPS,
            incluirSimuladas: false,
            limit: 40,
          });
          const vinc = execs.find(
            (g) => !g.simulado && g.idRotaOrigemCliente === rotaCalcOriginal.idCliente && g.geometry,
          );
          if (vinc) {
            idGps = vinc.idCliente;
            rotaPercorrida = vinc;
          }
        }
        if (idGps && pontosGps.length < 2) {
          const regGps = await svc.obterRota(idGps);
          if (regGps && !regGps.simulado) {
            rotaPercorrida = regGps;
            pontosGps = await svc.listarPontosGps(idGps);
          }
        }
      }

      const res = await exportarRotaGpxMobile(routeResult, {
        pontos: pontosCalc,
        rotaCalculadaOriginal: rotaCalcOriginal,
        rotaPercorrida,
        pontosGps,
        navegacaoEmAndamento: false,
      });
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

  const handleExportSavedRoute = async (idCliente) => {
    if (exportingGpx) return;
    Keyboard.dismiss();

    const navEstado = navigationRef.current?.estado;
    const navEmAndamento =
      !!navEstado && (navEstado.execucao === 'ativo' || navEstado.execucao === 'pausado');
    if (navEmAndamento) {
      const msg = 'Encerre ou finalize a navegação em andamento antes de exportar o GPX. Os dados da navegação permanecem preservados.';
      setGpxFeedback({ kind: 'err', text: msg });
      setStatus(msg, 'err');
      return;
    }

    const svc = campoServiceRef.current;
    if (!svc) return;

    setExportingGpx(true);
    setGpxFeedback(null);
    setStatus('Preparando exportação GPX…', 'busy');
    try {
      const reg = await svc.obterRota(idCliente);
      if (!reg) {
        const msg = 'Rota salva não encontrada para exportação GPX.';
        setGpxFeedback({ kind: 'err', text: msg });
        setStatus(msg, 'err');
        return;
      }

      let rotaCalculada = null;
      let rotaPercorrida = null;
      let pontosGps = [];
      let pontos = [];

      if (reg.tipoRota === TIPO_ROTA.GPS) {
        rotaPercorrida = reg;
        pontosGps = await svc.listarPontosGps(reg.idCliente);
        if (reg.idRotaOrigemCliente) {
          const orig = await svc.obterRota(reg.idRotaOrigemCliente);
          if (orig && orig.tipoRota !== TIPO_ROTA.GPS && orig.geometry) {
            rotaCalculada = reconstruirRespostaRotaDeRegistro(orig) || orig;
            pontos = Array.isArray(orig.pontosJson) ? orig.pontosJson : [];
          }
        }
      } else {
        rotaCalculada = reconstruirRespostaRotaDeRegistro(reg) || reg;
        pontos = Array.isArray(reg.pontosJson) ? reg.pontosJson : [];
        const execs = await svc.listarRotasSalvas({
          tipoRota: TIPO_ROTA.GPS,
          incluirSimuladas: false,
          limit: 40,
        });
        const vinc = execs.find(
          (g) => !g.simulado && g.idRotaOrigemCliente === reg.idCliente && g.geometry,
        );
        if (vinc) {
          rotaPercorrida = vinc;
          pontosGps = await svc.listarPontosGps(vinc.idCliente);
        }
      }

      const res = await exportarRotaGpxMobile(rotaCalculada, {
        pontos,
        rotaCalculadaOriginal: rotaCalculada,
        rotaPercorrida,
        pontosGps,
        navegacaoEmAndamento: false,
      });
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
    setSaveOfflineFeedback(null);
    setGpsRecordForExport(null);
    setGpsTrailGeometry(null);
    lastGpsExecutionIdRef.current = null;
    plannedRouteOriginalRef.current = null;
    campoServiceRef.current?.limparSessaoGpsEmMemoria();
    campoServiceRef.current?.definirRotaCalculadaAtiva(null);
  };

  const selecionarAlternativa = (altId, listaAlts = routeAlternatives) => {
    const alts = Array.isArray(listaAlts) ? listaAlts : [];
    const escolhida = alts.find((r) => r.id === altId) || alts[0];
    if (!escolhida) return;
    setSelectedRouteId(escolhida.id);
    const novaRota = escolhida.rota || routeResult;
    plannedRouteOriginalRef.current = {
      rota: novaRota,
      pontos: lista.pontos.map((p) => ({ ...p })),
    };
    lastGpsExecutionIdRef.current = null;
    setGpsRecordForExport(null);
    setSaveOfflineFeedback(null);
    campoServiceRef.current?.limparSessaoGpsEmMemoria();
    setRouteResult(novaRota);
    const d = formatDistanceParts(escolhida.distance ?? escolhida.rota?.distance);
    setStatus(`Rota selecionada (${escolhida.rotulo || escolhida.id}): ${d.v} ${d.u}.`, 'ok');
    if (novaRota?.ok) {
      void campoServiceRef.current?.buscarRotaSalvaPorAssinatura(novaRota, lista.pontos)
        .then((jaSalva) => {
          campoServiceRef.current?.definirRotaCalculadaAtiva(jaSalva || null);
          if (jaSalva && plannedRouteOriginalRef.current?.rota === novaRota) {
            plannedRouteOriginalRef.current.rota.idCliente = jaSalva.idCliente;
          }
          return refreshCampoUi();
        })
        .catch(() => {});
    }
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
      garantirMapaVisivel();
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
    garantirMapaVisivel();
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
    setSheetState(ESTADOS_SHEET.COLLAPSED);
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

      const rotaPersistir = Array.isArray(data.rotas) && data.rotas.length
        ? (data.rotas.find((r) => r.id === (data.rotaSelecionadaId || data.rotas[0].id))?.rota || data)
        : data;
      if (typeof plannedRouteOriginalRef !== 'undefined') {
        plannedRouteOriginalRef.current = {
          rota: rotaPersistir,
          pontos: lista.pontos.map((p) => ({ ...p })),
        };
      }
      if (typeof lastGpsExecutionIdRef !== 'undefined') lastGpsExecutionIdRef.current = null;
      if (typeof setGpsRecordForExport === 'function') setGpsRecordForExport(null);
      // Salvamento offline acontece EXCLUSIVAMENTE ao clicar em "Salvar rotas offline"
      if (typeof campoServiceRef !== 'undefined') {
        void campoServiceRef.current?.buscarRotaSalvaPorAssinatura(rotaPersistir, lista.pontos)
          .then((jaSalva) => {
            campoServiceRef.current?.definirRotaCalculadaAtiva(jaSalva || null);
            if (jaSalva && plannedRouteOriginalRef.current?.rota === rotaPersistir) {
              plannedRouteOriginalRef.current.rota.idCliente = jaSalva.idCliente;
            }
            return refreshCampoUi();
          })
          .catch(() => {});
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

  // ─────────────── Persistência offline de rotas e observações ───────────────

  const handleSaveCurrentRoute = async () => {
    const svc = campoServiceRef.current;
    if (!svc || savingRoute) return;
    const rotaCalc = routeResult?.ok && !routeResult?.parcial ? routeResult : null;
    const rotaOrig =
      plannedRouteOriginalRef.current?.rota?.ok && !plannedRouteOriginalRef.current?.rota?.parcial
        ? plannedRouteOriginalRef.current.rota
        : null;
    const temGpsSessao = !!svc.obterUltimaExecucaoGpsSessao?.();
    if (!rotaCalc && !rotaOrig && !temGpsSessao) return;

    setSavingRoute(true);
    setSaveOfflineFeedback(null);
    try {
      const pontos = plannedRouteOriginalRef.current?.pontos?.length
        ? plannedRouteOriginalRef.current.pontos
        : lista.pontos;
      const res = await svc.salvarRotasOffline({
        rotaCalculada: rotaCalc,
        rotaCalculadaOriginal: rotaOrig,
        pontos,
        modo: lastCalcModeRef.current || 'usuario',
        circular: true,
      });
      if (res?.rotaCalculada && plannedRouteOriginalRef.current?.rota) {
        plannedRouteOriginalRef.current.rota.idCliente = res.rotaCalculada.idCliente;
      }
      if (res?.rotaGps) {
        lastGpsExecutionIdRef.current = res.rotaGps.idCliente;
        setGpsRecordForExport(res.rotaGps);
      }
      await refreshCampoUi();
      const msg = res?.jaExistia
        ? 'As rotas atuais já estão salvas offline (nenhuma duplicação criada).'
        : res?.rotaCalculada && res?.rotaGps
          ? 'Rota calculada e trajeto GPS salvos no dispositivo para uso offline.'
          : 'Rota salva no dispositivo (disponível offline).';
      setSaveOfflineFeedback({ kind: 'ok', text: msg });
      setStatus(msg, 'ok');
    } catch (err) {
      const msg = err?.message || 'Não foi possível salvar a rota offline.';
      setSaveOfflineFeedback({ kind: 'err', text: msg });
      setStatus(msg, 'err');
    } finally {
      setSavingRoute(false);
    }
  };

  const handleDeleteSavedRoute = async (rota) => {
    const svc = campoServiceRef.current;
    if (!svc || !rota?.idCliente) return;
    const navEstado = navigationRef.current?.estado;
    const navAtiva = !!navEstado && (navEstado.execucao === 'ativo' || navEstado.execucao === 'pausado');
    if (navAtiva && svc.execucaoGpsAtiva?.idCliente === rota.idCliente) {
      setStatus('Encerre a navegação em andamento antes de excluir esta rota.', 'err');
      return;
    }

    const titulo = rota.titulo || (rota.tipoRota === TIPO_ROTA.GPS ? 'Trajeto GPS real' : 'Rota calculada');
    setConfirmModal({
      visible: true,
      title: 'Excluir rota salva',
      message: `Deseja excluir localmente a rota "${titulo}"?`,
      items: [
        'A rota salva será removida do armazenamento local do dispositivo.',
        'Observações, eventos e pontos GPS vinculados exclusivamente a esta rota também serão excluídos localmente.',
        'Outras rotas salvas, preferências do aplicativo e registros já sincronizados no servidor permanecem preservados.',
      ],
      alertText: 'Esta exclusão local não pode ser desfeita neste dispositivo.',
      confirmLabel: 'Excluir rota',
      submitting: false,
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, submitting: true }));
        try {
          const id = rota.idCliente;
          const estavaNoGps = lastGpsExecutionIdRef.current === id || gpsRecordForExport?.idCliente === id;
          await svc.excluirRotaSalva(id);
          if (estavaNoGps) {
            lastGpsExecutionIdRef.current = null;
            setGpsRecordForExport(null);
            setGpsTrailGeometry(null);
          }
          if (plannedRouteOriginalRef.current?.rota?.idCliente === id) {
            delete plannedRouteOriginalRef.current.rota.idCliente;
          }
          setConfirmModal((prev) => ({ ...prev, visible: false, submitting: false, onConfirm: null }));
          await refreshCampoUi();
          setStatus('Rota salva excluída do dispositivo.', 'ok');
        } catch (err) {
          setConfirmModal((prev) => ({ ...prev, visible: false, submitting: false, onConfirm: null }));
          setStatus(err?.message || 'Não foi possível excluir a rota salva.', 'err');
        }
      },
    });
  };

  const handleDeleteRouteObservation = (obs) => {
    const svc = campoServiceRef.current;
    if (!svc || !obs?.idCliente) return;
    setConfirmModal({
      visible: true,
      title: 'Excluir observação',
      message: `Deseja excluir localmente esta observação (${obs.descricao || obs.tipoObservacao})?`,
      items: [
        'A observação e seu histórico de eventos local serão removidos do dispositivo.',
        'A rota vinculada, outras observações e dados já enviados ao servidor não serão afetados.',
      ],
      alertText: 'Esta exclusão local não pode ser desfeita neste dispositivo.',
      confirmLabel: 'Excluir observação',
      submitting: false,
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, submitting: true }));
        try {
          await svc.excluirObservacao(obs.idCliente);
          setRouteObsModal((prev) =>
            prev.observacao?.idCliente === obs.idCliente
              ? { ...prev, visible: false, observacao: null }
              : prev,
          );
          setConfirmModal((prev) => ({ ...prev, visible: false, submitting: false, onConfirm: null }));
          await refreshCampoUi();
          setStatus('Observação excluída do dispositivo.', 'ok');
        } catch (err) {
          setConfirmModal((prev) => ({ ...prev, visible: false, submitting: false, onConfirm: null }));
          setStatus(err?.message || 'Não foi possível excluir a observação.', 'err');
        }
      },
    });
  };

  const abrirConfirmacaoFinalLimpezaDados = (navAtiva) => {
    setConfirmModal({
      visible: true,
      title: 'Limpar dados locais',
      message: 'Esta ação removerá permanentemente do armazenamento local deste dispositivo:',
      items: [
        'Todas as rotas salvas offline;',
        'Todos os percursos GPS gravados e pontos de trilha locais;',
        'Todas as observações de campo e históricos locais;',
        'Todas as ocorrências locais (cache e fila pendente de envio);',
        'Registros temporários e fila pendente de sincronização local.',
      ],
      alertText:
        'Ação irreversível nos dados locais deste dispositivo. Suas preferências do trajeto, configurações do servidor, identificação do usuário e dados já existentes no servidor remoto serão preservados.',
      confirmLabel: navAtiva ? 'Interromper navegação e limpar tudo' : 'Limpar dados locais',
      submitting: false,
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, submitting: true }));
        try {
          if (navAtiva) {
            navigationRef.current.encerrar();
          }
          await campoServiceRef.current.limparDadosLocais({ forcarInterrupcaoNavegacao: true });
          await ocorrenciasServiceRef.current?.limparDadosLocais?.();
          plannedRouteOriginalRef.current = null;
          lastGpsExecutionIdRef.current = null;
          setGpsRecordForExport(null);
          setGpsTrailGeometry(null);
          setRouteResult(null);
          setRouteAlternatives(null);
          setSelectedRouteId(null);
          setComparacaoAlternativas(null);
          setRouteError(null);
          setPartialGeometry(null);
          setGpxFeedback(null);
          setSaveOfflineFeedback(null);
          setRouteObservations([]);
          setSavedRoutes([]);
          setPendingRecovery([]);
          setOcorrencias([]);
          ocorrenciasRef.current = [];
          setPickingOccurrence(false);
          setOccModal({
            visible: false,
            mode: 'detail',
            segmentoPreview: null,
            coordinate: null,
            ocorrencia: null,
            submitting: false,
            errorText: null,
          });
          setRouteObsModal((prev) => ({ ...prev, visible: false, observacao: null }));
          setConfirmModal((prev) => ({ ...prev, visible: false, submitting: false, onConfirm: null }));
          await refreshCampoUi();
          setStatus('Dados locais limpos (preferências e configurações preservadas).', 'ok');
        } catch (err) {
          setConfirmModal((prev) => ({ ...prev, visible: false, submitting: false, onConfirm: null }));
          setStatus(err?.message || 'Não foi possível limpar os dados locais.', 'err');
        }
      },
    });
  };

  const handleClearLocalData = () => {
    Keyboard.dismiss();
    const navEstado = navigationRef.current?.estado;
    const navAtiva = !!navEstado && (navEstado.execucao === 'ativo' || navEstado.execucao === 'pausado');
    if (navAtiva) {
      setConfirmModal({
        visible: true,
        title: 'Navegação em andamento',
        message: 'Existe uma navegação em andamento neste momento. Limpar os dados locais agora irá interromper e descartar a navegação atual.',
        items: [],
        alertText: 'Confirme primeiro se deseja interromper a navegação em andamento para prosseguir com a limpeza.',
        confirmLabel: 'Interromper navegação e continuar',
        submitting: false,
        onConfirm: () => abrirConfirmacaoFinalLimpezaDados(true),
      });
      return;
    }
    abrirConfirmacaoFinalLimpezaDados(false);
  };

  const handleOpenSavedRoute = async (idCliente) => {
    Keyboard.dismiss();
    try {
      const svc = campoServiceRef.current;
      const registro = await svc.obterRota(idCliente);
      if (!registro) return;
      if (registro.tipoRota === TIPO_ROTA.GPS && registro.simulado) return;

      let rotaCalculadaReg = registro.tipoRota === TIPO_ROTA.GPS ? null : registro;
      let trilhaGps = null;
      let gpsReg = null;

      if (registro.tipoRota === TIPO_ROTA.GPS) {
        gpsReg = registro;
        trilhaGps = registro.geometry || null;
        if (registro.idRotaOrigemCliente) {
          const orig = await svc.obterRota(registro.idRotaOrigemCliente);
          if (orig && orig.tipoRota !== TIPO_ROTA.GPS && orig.geometry) {
            rotaCalculadaReg = orig;
          }
        }
      } else {
        const execucoes = await svc.listarRotasSalvas({
          tipoRota: TIPO_ROTA.GPS,
          incluirSimuladas: false,
          limit: 50,
        });
        const gpsVinc = execucoes.find(
          (g) => !g.simulado && g.idRotaOrigemCliente === registro.idCliente && g.geometry,
        );
        if (gpsVinc) {
          gpsReg = gpsVinc;
          trilhaGps = gpsVinc.geometry;
        }
      }

      if (rotaCalculadaReg) {
        svc.definirRotaCalculadaAtiva(rotaCalculadaReg);
        const reconstruida = reconstruirRespostaRotaDeRegistro(rotaCalculadaReg);
        if (Array.isArray(rotaCalculadaReg.pontosJson) && rotaCalculadaReg.pontosJson.length >= 2) {
          const novaLista = criarListaCircuito();
          novaLista.pontos = rotaCalculadaReg.pontosJson.map((p, idx) => ({
            id: `saved-${idx}-${Date.now()}`,
            rotulo: p.rotulo || String.fromCharCode(65 + idx),
            enderecoDigital: p.enderecoDigital || '',
            codigoNormalizado: p.enderecoDigital || null,
            codigoCompleto: p.codigoCompleto || p.enderecoDigital || null,
            latitude: p.latitude,
            longitude: p.longitude,
            origem: 'salva',
            status: STATUS.CONVERTIDO,
            mensagem: 'Carregado da rota salva offline.',
          }));
          rotularPontos(novaLista);
          restoringSavedRouteRef.current = true;
          setLista(novaLista);
        }
        plannedRouteOriginalRef.current = {
          rota: rotaCalculadaReg,
          pontos: Array.isArray(rotaCalculadaReg.pontosJson) ? rotaCalculadaReg.pontosJson : [],
        };
        setRouteResult(reconstruida);
      } else {
        // Cenário C: execução GPS real sem rota calculada vinculada
        svc.definirRotaCalculadaAtiva(registro);
        plannedRouteOriginalRef.current = null;
        setRouteResult(null);
      }

      lastGpsExecutionIdRef.current = gpsReg?.idCliente || null;
      setGpsRecordForExport(gpsReg);
      setRouteError(null);
      setPartialGeometry(null);
      setRouteAlternatives(null);
      setSelectedRouteId(null);
      setComparacaoAlternativas(null);
      setGpsTrailGeometry(trilhaGps);
      await refreshCampoUi();
      setStatus(`Rota salva aberta offline (${registro.titulo || 'Rota'}).`, 'ok');
    } catch (err) {
      setStatus(err?.message || 'Falha ao abrir rota salva.', 'err');
    }
  };

  const handleRecoverGpsSession = async (idCliente, acao) => {
    try {
      const res = await campoServiceRef.current.recuperarExecucaoPendente(idCliente, acao);
      if (acao === 'finalizar' && res?.rota?.geometry && !res.rota.simulado) {
        lastGpsExecutionIdRef.current = res.rota.idCliente;
        setGpsRecordForExport(res.rota);
        setGpsTrailGeometry(res.rota.geometry);
      }
      await refreshCampoUi();
      setStatus(acao === 'descartar' ? 'Execução GPS pendente descartada.' : 'Execução GPS recuperada e salva.', 'ok');
    } catch (err) {
      setStatus(err?.message || 'Falha ao recuperar sessão GPS.', 'err');
    }
  };

  const handleStartPickRouteObs = () => {
    Keyboard.dismiss();
    if (!campoServiceRef.current?.obterRotaParaObservacao()) {
      setStatus('Salve a rota em "Salvar rotas offline" ou abra uma rota salva antes de registrar observações.', 'err');
      return;
    }
    setPickingId(null);
    setPickingOccurrence(false);
    setPickingRouteObs(true);
    setSheetState(ESTADOS_SHEET.COLLAPSED);
    setStatus('Toque no mapa para marcar o local da observação da rota.', 'busy');
  };

  const handleMapPickRouteObs = ({ lon, lat }) => {
    setPickingRouteObs(false);
    setRouteObsModal({
      visible: true,
      mode: 'create',
      coordinate: { lon, lat },
      observacao: null,
      eventos: [],
      submitting: false,
      errorText: null,
    });
  };

  const handleCreateRouteObsAtGps = () => {
    if (!navigation?.posicao) return;
    setRouteObsModal({
      visible: true,
      mode: 'create',
      coordinate: { lon: navigation.posicao.longitude, lat: navigation.posicao.latitude },
      observacao: null,
      eventos: [],
      submitting: false,
      errorText: null,
    });
  };

  const handleOpenRouteObservationDetail = async (obsOuId) => {
    const obs =
      typeof obsOuId === 'string'
        ? routeObservations.find((o) => o.idCliente === obsOuId)
        : obsOuId;
    if (!obs) return;
    let eventos = [];
    try {
      eventos = await campoServiceRef.current.repositorio.listarEventosObservacao(obs.idCliente);
    } catch {
      eventos = [];
    }
    setRouteObsModal({
      visible: true,
      mode: 'detail',
      coordinate: null,
      observacao: obs,
      eventos,
      submitting: false,
      errorText: null,
    });
  };

  const handleSubmitCreateRouteObs = async (payload) => {
    setRouteObsModal((prev) => ({ ...prev, submitting: true, errorText: null }));
    try {
      await campoServiceRef.current.criarObservacao(payload);
      await refreshCampoUi();
      setRouteObsModal((prev) => ({ ...prev, visible: false, submitting: false }));
      setStatus('Observação salva no dispositivo.', 'ok');
    } catch (err) {
      setRouteObsModal((prev) => ({
        ...prev,
        submitting: false,
        errorText: err?.message || 'Não foi possível salvar a observação.',
      }));
    }
  };

  const handleSubmitEditRouteObs = async (payload) => {
    setRouteObsModal((prev) => ({ ...prev, submitting: true, errorText: null }));
    try {
      const res = await campoServiceRef.current.editarObservacao(payload);
      const eventos = await campoServiceRef.current.repositorio.listarEventosObservacao(payload.idCliente);
      await refreshCampoUi();
      setRouteObsModal((prev) => ({
        ...prev,
        observacao: res.observacao,
        eventos,
        submitting: false,
      }));
      setStatus('Observação atualizada no dispositivo.', 'ok');
    } catch (err) {
      setRouteObsModal((prev) => ({
        ...prev,
        submitting: false,
        errorText: err?.message || 'Não foi possível editar a observação.',
      }));
    }
  };

  const handleChangeStatusRouteObs = async (payload) => {
    setRouteObsModal((prev) => ({ ...prev, submitting: true, errorText: null }));
    try {
      const res = await campoServiceRef.current.alterarStatusObservacao(payload);
      const eventos = await campoServiceRef.current.repositorio.listarEventosObservacao(payload.idCliente);
      await refreshCampoUi();
      setRouteObsModal((prev) => ({
        ...prev,
        observacao: res.observacao,
        eventos,
        submitting: false,
      }));
      setStatus('Status da observação atualizado.', 'ok');
    } catch (err) {
      setRouteObsModal((prev) => ({
        ...prev,
        submitting: false,
        errorText: err?.message || 'Não foi possível alterar o status.',
      }));
    }
  };

  const handleSyncCampoAgora = async () => {
    setStatus('Sincronizando registros de campo…', 'busy');
    const res = await campoServiceRef.current.sincronizarAgora();
    await refreshCampoUi();
    if (res?.ok) {
      setStatus('Registros de campo sincronizados.', 'ok');
    } else {
      setStatus('Registros mantidos localmente para sincronização posterior.', 'idle');
    }
  };

  // Centralização em localização real do GPS (nunca faz fallback para FIT_NETWORK)
  const handleRequestCurrentLocation = async () => {
    if (locatingCurrent) return;
    Keyboard.dismiss();
    setLocatingCurrent(true);
    setLocationFeedback(null);
    setStatus('Obtendo localização GPS atual…', 'busy');
    try {
      const res = await obterLocalizacaoAtual();
      const posRaw = res?.position || res?.posicao;
      if (!res?.ok || !posRaw) {
        const msg = res?.message || res?.mensagem || 'Não foi possível obter sua localização atual.';
        setLocationFeedback({ status: 'error', message: msg });
        setStatus(msg, 'err');
        return;
      }
      const pos = { ...posRaw, simulado: false };
      setCurrentLocation(pos);
      setNavigationCenter({ latitude: pos.latitude, longitude: pos.longitude, ts: Date.now() });
      garantirMapaVisivel();
      const precTxt = pos.precisao != null ? ` (±${Math.round(pos.precisao)} m)` : '';
      setStatus(`Mapa centralizado na sua localização atual${precTxt}.`, 'ok');
    } finally {
      setLocatingCurrent(false);
    }
  };

  // Sugestões oportunísticas e marcadores do planejamento de visitas
  const sugestoesProximas = useMemo(() => {
    if (!routeResult?.ok || !routeResult?.geometry || !pacientesTerritorio.length) return [];
    return sugerirVisitasProximasAoTrajeto({
      pacientes: pacientesTerritorio,
      visitasPlanejadas: planoVisitas?.visitas || [],
      routeGeometry: routeResult.geometry,
      raioMetros: 220,
      limite: 5,
    });
  }, [routeResult, pacientesTerritorio, planoVisitas]);

  const visitMarkers = useMemo(() => {
    const mapa = new Map();
    for (const v of planoVisitas?.visitas || []) {
      if (v && v.latitude != null && v.longitude != null) {
        mapa.set(v.pacienteId || v.id, {
          id: v.id,
          nome: v.nome,
          latitude: v.latitude,
          longitude: v.longitude,
          status: v.status,
        });
      }
    }
    for (const s of sugestoesProximas) {
      const key = s.pacienteId || s.id;
      if (!mapa.has(key) && s.latitude != null && s.longitude != null) {
        mapa.set(key, {
          id: s.id,
          nome: s.nome,
          latitude: s.latitude,
          longitude: s.longitude,
          status: STATUS_VISITA.OPORTUNISTICA_SUGERIDA,
        });
      }
    }
    return [...mapa.values()];
  }, [planoVisitas, sugestoesProximas]);

  const persistirPlanejamento = useCallback(async (pacientesAtualizados, planoAtualizado, periodoAtual = periodoPlanejamento) => {
    await salvarPlanejamentoMobile({
      pacientes: pacientesAtualizados,
      plano: planoAtualizado,
      periodo: periodoAtual,
      sqlite: campoServiceRef.current?.repositorio?.driver,
    });
  }, [periodoPlanejamento]);

  const handleDownloadTemplatePlanilha = async () => {
    const res = await exportarModeloPlanilhaMobile();
    if (res?.ok) {
      setVisitFeedback({ status: 'ok', message: res.mensagem });
      setStatus(res.mensagem, 'ok');
    } else if (!res?.cancelado) {
      setVisitFeedback({ status: 'error', message: res?.mensagem || 'Não foi possível salvar a planilha modelo.' });
    }
  };

  const handlePickImportPlanilha = async () => {
    setVisitFeedback(null);
    const res = await selecionarELerPlanilhaMobile();
    if (!res?.ok) {
      if (!res?.cancelado) {
        setVisitFeedback({ status: 'error', message: res?.mensagem || 'Falha ao importar planilha.' });
      }
      return;
    }
    setImportPreviewModal({
      visible: true,
      arquivo: res.arquivo,
      preview: res.preview,
    });
  };

  const handleConfirmImportPlanilha = async ({ registros, substituir }) => {
    const base = substituir ? [] : pacientesTerritorio;
    const mapa = new Map();
    for (const item of [...base, ...(registros || [])]) {
      if (item?.id) mapa.set(item.id, item);
    }
    const listaFinal = [...mapa.values()];
    const novoPlano = planejarVisitasPeriodo(listaFinal, {
      periodo: periodoPlanejamento,
      origemCoord: lista.pontos[0]?.latitude != null ? lista.pontos[0] : null,
      visitasAnteriores: planoVisitas?.visitas || [],
    });
    setPacientesTerritorio(listaFinal);
    setPlanoVisitas(novoPlano);
    setImportPreviewModal({ visible: false, arquivo: '', preview: null });
    await persistirPlanejamento(listaFinal, novoPlano, periodoPlanejamento);
    const msg = `${registros.length} paciente(s) carregado(s) e ${novoPlano.visitas.length} visita(s) planejada(s).`;
    setVisitFeedback({ status: 'ok', message: msg });
    setStatus(msg, 'ok');
  };

  const handleChangePeriodoPlanejamento = async (novoPeriodo) => {
    const norm = normalizarPeriodoPlanejamento(novoPeriodo);
    setPeriodoPlanejamento(norm);
    const novoPlano = pacientesTerritorio.length
      ? planejarVisitasPeriodo(pacientesTerritorio, {
          periodo: norm,
          origemCoord: lista.pontos[0]?.latitude != null ? lista.pontos[0] : null,
          visitasAnteriores: planoVisitas?.visitas || [],
        })
      : null;
    setPlanoVisitas(novoPlano);
    await persistirPlanejamento(pacientesTerritorio, novoPlano, norm);
  };

  const handleGenerateVisitPlan = async () => {
    if (!pacientesTerritorio.length) return;
    const novoPlano = planejarVisitasPeriodo(pacientesTerritorio, {
      periodo: periodoPlanejamento,
      origemCoord: lista.pontos[0]?.latitude != null ? lista.pontos[0] : null,
      visitasAnteriores: planoVisitas?.visitas || [],
    });
    setPlanoVisitas(novoPlano);
    await persistirPlanejamento(pacientesTerritorio, novoPlano, periodoPlanejamento);
    setVisitFeedback({ status: 'ok', message: `Planejamento atualizado com ${novoPlano.visitas.length} visita(s).` });
  };

  const handleUpdateVisitStatus = async (visitaId, novoStatus) => {
    const statusNorm = normalizarStatusVisita(novoStatus);
    const visitasAtualizadas = (planoVisitas?.visitas || []).map((v) =>
      v.id === visitaId ? { ...v, status: statusNorm, atualizadoEm: new Date().toISOString() } : v,
    );
    const pacientesAtualizados = pacientesTerritorio.map((p) => {
      const visitaAlvo = visitasAtualizadas.find((v) => v.id === visitaId && v.pacienteId === p.id);
      if (!visitaAlvo) return p;
      return {
        ...p,
        ultimaVisitaEm: statusNorm === STATUS_VISITA.REALIZADA ? new Date().toISOString() : p.ultimaVisitaEm,
      };
    });
    const novoPlano = planoVisitas ? { ...planoVisitas, visitas: visitasAtualizadas } : null;
    setPacientesTerritorio(pacientesAtualizados);
    setPlanoVisitas(novoPlano);
    await persistirPlanejamento(pacientesAtualizados, novoPlano, periodoPlanejamento);
  };

  const adicionarVisitasAoTrajeto = useCallback((visitasAlvo) => {
    const validas = (visitasAlvo || []).filter((v) => v && v.latitude != null && v.longitude != null);
    if (!validas.length) return;
    setLista((atual) => {
      const copia = cloneLista(atual);
      for (const v of validas) {
        const jaExiste = copia.pontos.some(
          (p) => p.latitude != null && p.longitude != null &&
            Math.abs(p.latitude - v.latitude) < 0.00005 &&
            Math.abs(p.longitude - v.longitude) < 0.00005,
        );
        if (jaExiste) continue;
        // Preenche origem A caso esteja vazia, senão adiciona parada intermediária
        const vazio = copia.pontos.find((p) => p.latitude == null && p.tipo !== 'destino');
        if (vazio) {
          atualizarPonto(copia, vazio.id, {
            latitude: v.latitude,
            longitude: v.longitude,
            enderecoDigital: v.enderecoDigital || '',
            status: STATUS.CONVERTIDO,
            origem: v.enderecoDigital ? 'codigo' : 'coordenada',
            mensagem: `Visita: ${v.nome}`,
          });
        } else {
          const criado = adicionarPonto(copia, {
            latitude: v.latitude,
            longitude: v.longitude,
            enderecoDigital: v.enderecoDigital || '',
            status: STATUS.CONVERTIDO,
            origem: v.enderecoDigital ? 'codigo' : 'coordenada',
            mensagem: `Visita: ${v.nome}`,
          });
          if (!criado) break;
        }
      }
      return cloneLista(copia);
    });
    const msg = validas.length === 1
      ? `Visita "${validas[0].nome}" incluída no trajeto.`
      : `${validas.length} visita(s) aplicada(s) como paradas do trajeto.`;
    setVisitFeedback({ status: 'ok', message: msg });
    setStatus(msg, 'ok');
  }, [setStatus]);

  const handleClearVisits = async () => {
    setPacientesTerritorio([]);
    setPlanoVisitas(null);
    setVisitFeedback({ status: 'ok', message: 'Planejamento local de visitas removido.' });
    await limparPlanejamentoMobile(campoServiceRef.current?.repositorio?.driver);
  };

  const sheetSummaryTitle = routeResult?.ok
    ? `Rota · ${(() => { const d = formatDistanceParts(routeResult.distance); return `${d.v} ${d.u}`; })()}`
    : planoVisitas?.visitas?.length
      ? `Planejamento · ${planoVisitas.visitas.length} visita(s)`
      : 'Planejamento e trajeto';
  const sheetSummaryBadge = routeResult?.ok
    ? `${lista.pontos.length} ponto(s)`
    : pacientesTerritorio.length > 0
      ? `${pacientesTerritorio.length} paciente(s)`
      : '';

  const handleVisitMarkerClick = (visitaId) => {
    const visita =
      (planoVisitas?.visitas || []).find((v) => v.id === visitaId) ||
      sugestoesProximas.find((s) => s.id === visitaId);
    if (!visita) return;
    setSheetState(ESTADOS_SHEET.MID);
    setStatus(`Visita selecionada: ${visita.nome}`, 'idle');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <View style={styles.root}>
        {/* Cabeçalho compacto com logo SIGA APP (sem abas antigas Dividido/Mapa/Painel) */}
        <View style={styles.header}>
          <View style={styles.headerLogoWrap}>
            <Image
              source={require('./assets/logo-siga-app.png')}
              style={styles.headerLogo}
              resizeMode="contain"
              accessibilityLabel="SIGA APP"
            />
          </View>
          <View style={styles.headerMetaPill}>
            <Text style={styles.headerMetaText}>
              {planoVisitas?.visitas?.length
                ? `${planoVisitas.visitas.length} visita(s)`
                : `${lista.pontos.length} ponto(s)`}
            </Text>
          </View>
        </View>

        {/* Área principal: mapa em tela cheia + painel inferior retrátil em 3 estágios */}
        <View
          style={styles.mapStage}
          onLayout={(e) => {
            const h = e?.nativeEvent?.layout?.height;
            if (h > 0) setMapStageHeight(h);
          }}
        >
          <RoadNetworkMap
            ref={mapRef}
            visible={true}
            bottomInsetPx={mapBottomInset}
            basemapMode={basemapMode}
            onChangeBasemap={handleChangeBasemap}
            features={networkFeatures}
            markers={lista.pontos}
            routeGeometry={activeRouteGeometry}
            routeSegments={routeSegments}
            navigationPosition={navigation?.posicao || currentLocation}
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
            occCategoryFilter={occCategoryFilter}
            onChangeOccCategoryFilter={setOccCategoryFilter}
            visitMarkers={visitMarkers}
            onVisitMarkerClick={handleVisitMarkerClick}
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
            onRequestCurrentLocation={handleRequestCurrentLocation}
            locatingCurrent={locatingCurrent}
            locationFeedback={locationFeedback}
            gpsTrailGeometry={gpsTrailGeometry}
            routeObservations={routeObservations}
            pickingRouteObs={pickingRouteObs}
            onCancelPickRouteObs={() => {
              setPickingRouteObs(false);
              setStatus('Pronto', 'idle');
            }}
            onMapPickRouteObs={handleMapPickRouteObs}
            onRouteObservationClick={handleOpenRouteObservationDetail}
          />

          <BottomSheetPanel
            sheetState={sheetState}
            onChangeSheetState={setSheetState}
            containerHeight={mapStageHeight}
            summaryTitle={sheetSummaryTitle}
            summaryBadge={sheetSummaryBadge}
          >
            <VisitPlanningSection
              pacientes={pacientesTerritorio}
              plano={planoVisitas}
              periodo={periodoPlanejamento}
              sugestoesProximas={sugestoesProximas}
              feedback={visitFeedback}
              onChangePeriodo={handleChangePeriodoPlanejamento}
              onPickImport={handlePickImportPlanilha}
              onDownloadTemplate={handleDownloadTemplatePlanilha}
              onGeneratePlan={handleGenerateVisitPlan}
              onApplyToRoute={() => {
                const pendentes = (planoVisitas?.visitas || []).filter(
                  (v) => v.status === STATUS_VISITA.PLANEJADA,
                );
                adicionarVisitasAoTrajeto(pendentes);
              }}
              onAddVisitToRoute={(visita) => adicionarVisitasAoTrajeto([visita])}
              onUpdateVisitStatus={handleUpdateVisitStatus}
              onFocusVisit={(visita) => {
                if (visita?.latitude != null && visita?.longitude != null) {
                  garantirMapaVisivel();
                  mapRef.current?.centerPoint(visita.longitude, visita.latitude);
                }
              }}
              onClearVisits={handleClearVisits}
            />

            <View style={styles.block}>
              <Text style={styles.blockTitle}>Pontos do trajeto</Text>
              {!!networkCacheWarning && <Text accessibilityRole="alert" style={styles.cacheWarning}>{networkCacheWarning}</Text>}

              {pendingRecovery.length > 0 && (
                <View style={styles.recoveryBanner}>
                  <Text style={styles.recoveryTitle}>
                    Rota GPS interrompida detectada ({pendingRecovery[0].totalPontos ?? 0} pontos)
                  </Text>
                  <View style={styles.recoveryActions}>
                    <TouchableOpacity
                      style={styles.recoveryBtnPrimary}
                      onPress={() => handleRecoverGpsSession(pendingRecovery[0].idCliente, 'finalizar')}
                    >
                      <Text style={styles.recoveryBtnPrimaryText}>Finalizar e salvar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.recoveryBtnGhost}
                      onPress={() => handleRecoverGpsSession(pendingRecovery[0].idCliente, 'descartar')}
                    >
                      <Text style={styles.recoveryBtnGhostText}>Descartar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

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

              <SavedRoutesSection
                rotas={savedRoutes}
                canSaveCurrent={!!routeResult?.ok || !!(gpsRecordForExport && !gpsRecordForExport.simulado)}
                saving={savingRoute}
                saveFeedback={saveOfflineFeedback}
                onSaveCurrent={handleSaveCurrentRoute}
                onOpenRoute={handleOpenSavedRoute}
                onExportRoute={handleExportSavedRoute}
                onDeleteRoute={handleDeleteSavedRoute}
                onClearLocalData={handleClearLocalData}
                onRefresh={refreshCampoUi}
              />
            </View>

            <NavigationPanel estado={navigation} controller={navigationRef.current}
              podeIniciar={!!routeResult?.ok} onStart={(modo) => navigationRef.current.iniciar(routeResult, modo)}
              onCenter={() => {
                if (navigation?.posicao) {
                  setNavigationCenter({ ...navigation.posicao });
                  garantirMapaVisivel();
                }
              }} />

            <RouteObservationsSection
              rotaAlvo={campoServiceRef.current?.obterRotaParaObservacao()}
              hasRouteOnScreen={!!routeResult?.ok || !!(gpsRecordForExport && !gpsRecordForExport.simulado)}
              observacoes={routeObservations}
              hasActiveGpsPosition={!!navigation?.posicao}
              pickingObservation={pickingRouteObs}
              onStartPickMap={handleStartPickRouteObs}
              onCancelPickMap={() => {
                setPickingRouteObs(false);
                setStatus('Pronto', 'idle');
              }}
              onCreateAtGpsPosition={handleCreateRouteObsAtGps}
              onOpenObservation={handleOpenRouteObservationDetail}
              onDeleteObservation={handleDeleteRouteObservation}
            />

            {/* Bloco de Resultado da Rota */}
            <RouteResultPanel
              routeResult={routeResult}
              gpsRouteInfo={!routeResult && gpsRecordForExport && !gpsRecordForExport.simulado ? gpsRecordForExport : null}
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
                  garantirMapaVisivel();
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

            <NetworkDiagnosticsPanel
              meta={networkPanel.meta} diagnostics={networkPanel.diagnostics}
              syncing={!!networkPanel.operacao} operacao={networkPanel.operacao}
              feedback={networkPanel.feedback}
              onRetry={() => networkPanelRef.current?.executar('carregar')}
              onCheckUpdates={() => networkPanelRef.current?.executar('verificar')}
              onRefreshWfs={() => networkPanelRef.current?.executar('baixar')}
              onSaveApiUrl={handleSaveApiUrl}
            />
          </BottomSheetPanel>
        </View>

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
            garantirMapaVisivel();
            mapRef.current?.centerPoint(coord.longitude, coord.latitude);
          }}
        />

        <RouteObservationModal
          visible={routeObsModal.visible}
          mode={routeObsModal.mode}
          coordinate={routeObsModal.coordinate}
          observacao={routeObsModal.observacao}
          eventos={routeObsModal.eventos}
          submitting={routeObsModal.submitting}
          errorText={routeObsModal.errorText}
          onClose={() => setRouteObsModal((prev) => ({ ...prev, visible: false }))}
          onSubmitCreate={handleSubmitCreateRouteObs}
          onSubmitEdit={handleSubmitEditRouteObs}
          onChangeStatus={handleChangeStatusRouteObs}
          onDeleteObservation={handleDeleteRouteObservation}
          onFocusCoordinate={(coord) => {
            setRouteObsModal((prev) => ({ ...prev, visible: false }));
            garantirMapaVisivel();
            mapRef.current?.centerPoint(coord.longitude, coord.latitude);
          }}
        />

        <ImportScheduleModal
          visible={importPreviewModal.visible}
          arquivo={importPreviewModal.arquivo}
          preview={importPreviewModal.preview}
          onCancel={() => setImportPreviewModal({ visible: false, arquivo: '', preview: null })}
          onConfirm={handleConfirmImportPlanilha}
        />

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
          <TouchableOpacity
            style={[
              styles.syncPill,
              syncSummary.estado === SYNC_STATUS.SYNCED && styles.syncPillOk,
              syncSummary.estado === SYNC_STATUS.ERROR && styles.syncPillErr,
              (syncSummary.estado === SYNC_STATUS.PENDING || syncSummary.estado === SYNC_STATUS.SYNCING) && styles.syncPillWarn,
            ]}
            accessibilityRole="button"
            onPress={handleSyncCampoAgora}
          >
            <Text style={styles.syncPillText} numberOfLines={1}>
              {syncSummary.texto || 'Salvo no dispositivo'}
            </Text>
          </TouchableOpacity>
        </View>

        <ConfirmActionModal
          visible={confirmModal.visible}
          title={confirmModal.title}
          message={confirmModal.message}
          items={confirmModal.items}
          alertText={confirmModal.alertText}
          confirmLabel={confirmModal.confirmLabel}
          submitting={confirmModal.submitting}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal((prev) => ({ ...prev, visible: false, submitting: false, onConfirm: null }))}
        />
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
  headerMetaPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel2,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  headerMetaText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.accent,
  },
  mapStage: {
    flex: 1,
    position: 'relative',
    backgroundColor: COLORS.inputBg,
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
  syncPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 175,
  },
  syncPillOk: {
    backgroundColor: '#dcfce7',
    borderColor: '#86efac',
  },
  syncPillWarn: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
  },
  syncPillErr: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
  },
  syncPillText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: COLORS.text,
  },
  recoveryBanner: {
    backgroundColor: COLORS.warnBg,
    borderColor: COLORS.warnBorder,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    gap: 8,
  },
  recoveryTitle: {
    color: COLORS.warn,
    fontSize: 12,
    fontWeight: '700',
  },
  recoveryActions: {
    flexDirection: 'row',
    gap: 8,
  },
  recoveryBtnPrimary: {
    backgroundColor: COLORS.accentStrong,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  recoveryBtnPrimaryText: {
    color: COLORS.white,
    fontSize: 11.5,
    fontWeight: '700',
  },
  recoveryBtnGhost: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.panel,
  },
  recoveryBtnGhostText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '600',
  },
});
