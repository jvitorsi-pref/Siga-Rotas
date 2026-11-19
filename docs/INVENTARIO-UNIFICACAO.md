# Inventário técnico — unificação

Gerado por `node tools/inventario-unificacao.mjs`. Base: `f13abdc44537507dcb95b6784cef52ea28c2529c`.

Inventário mecânico de arquivos próprios ativos, testes e ferramentas; não afirma validação visual nem execução Android. Vendor OpenLayers, snapshots e arquivos Android gerados são dependências/recursos, não incluídos na tabela de exports. Pacotes em `updates/` são históricos e não entram no grafo de imports ativo.

## Proteção do motor

19 arquivos de core/server comparados à base; alterados: server/index.js, server/networkService.js, server/ocorrenciasService.js. Mudanças fora dos hashes aprovados: **nenhuma**.

## Arquivos

| Arquivo | Linhas | Situação | Exports / reexports |
|---|---:|---|---|
| `APK/App.js` | 1293 | Alterado | — |
| `APK/android/app/src/main/AndroidManifest.xml` | 34 | Igual à base | — |
| `APK/app.json` | 45 | Igual à base | — |
| `APK/eas.json` | 27 | Igual à base | — |
| `APK/metro.config.js` | 10 | Igual à base | — |
| `APK/package.json` | 34 | Igual à base | — |
| `APK/src/components/NavigationPanel.js` | 89 | Igual à base | NavigationPanel |
| `APK/src/components/NetworkDiagnosticsPanel.js` | 402 | Alterado | NetworkDiagnosticsPanel |
| `APK/src/components/OccurrenceModal.js` | 603 | Novo | OccurrenceModal |
| `APK/src/components/PointCard.js` | 339 | Igual à base | PointCard |
| `APK/src/components/RoadNetworkMap.js` | 537 | Alterado | RoadNetworkMap |
| `APK/src/components/RoutePreferencesSection.js` | 191 | Novo | RoutePreferencesSection |
| `APK/src/components/RouteResultPanel.js` | 657 | Alterado | RouteResultPanel |
| `APK/src/config/apiConfig.js` | 68 | Novo | STORAGE_KEY_API_URL, STORAGE_KEY_PENDING_SYNC, LOCAL_MODE_SENTINEL, normalizarApiUrl, resolverTipoTransporteApi, montarUrlEndpointApi, resolverApiUrlInicial |
| `APK/src/core/config.js` | 3 | Igual à base | → ../../../core/config.js |
| `APK/src/core/enderecoDigital.js` | 3 | Igual à base | → ../../../core/enderecoDigital.js |
| `APK/src/core/enderecoDigitalService.js` | 3 | Igual à base | → ../../../core/enderecoDigitalService.js |
| `APK/src/core/geo.js` | 3 | Igual à base | → ../../../core/geo.js |
| `APK/src/core/graph.js` | 3 | Igual à base | → ../../../core/graph.js |
| `APK/src/core/pontoTrajeto.js` | 3 | Igual à base | → ../../../core/pontoTrajeto.js |
| `APK/src/core/rotaParadas.js` | 3 | Igual à base | → ../../../core/rotaParadas.js |
| `APK/src/core/router.js` | 3 | Igual à base | → ../../../core/router.js |
| `APK/src/core/spatialIndex.js` | 3 | Igual à base | → ../../../core/spatialIndex.js |
| `APK/src/core/wfs.js` | 530 | Igual à base | WfsError, parseServiceException, fetchNetwork, describeLayer, checkForUpdates |
| `APK/src/map/camadaBase.js` | 2 | Igual à base | → ../../../public/camadaBase.js |
| `APK/src/map/mapHtml.js` | 1163 | Alterado | MAP_HTML |
| `APK/src/map/mapSync.js` | 60 | Alterado | criarSincronizacaoMapa |
| `APK/src/map/routePresentation.js` | 13 | Igual à base | trechosParaMapa |
| `APK/src/map/styleScript.js` | 24 | Igual à base | ESTILO_TRECHO_JS |
| `APK/src/ocorrencias/catalogo.js` | 2 | Novo | → ../../../ocorrencias/catalogo.js |
| `APK/src/ocorrencias/preferencias.js` | 2 | Novo | → ../../../ocorrencias/preferencias.js |
| `APK/src/ocorrencias/regras.js` | 2 | Novo | → ../../../ocorrencias/regras.js |
| `APK/src/ocorrencias/roteamentoAlternativo.js` | 2 | Novo | → ../../../ocorrencias/roteamentoAlternativo.js |
| `APK/src/services/basemapPreference.js` | 15 | Igual à base | carregarCamadaBaseMobile, salvarCamadaBaseMobile |
| `APK/src/services/mobileGpxExport.js` | 13 | Igual à base | exportarRotaGpxMobile |
| `APK/src/services/mobileGpxExportCore.js` | 105 | Igual à base | descreverPastaSaf, exportarRotaGpxMobileCore |
| `APK/src/services/mobileNavigationService.js` | 148 | Igual à base | criarNavegacaoMobile |
| `APK/src/services/mobileNetworkService.js` | 13 | Igual à base | MobileNetworkService, mobileNetworkService |
| `APK/src/services/mobileNetworkServiceCore.js` | 1001 | Alterado | STORAGE_KEY_SNAPSHOT, fingerprintOf, MobileNetworkServiceCore |
| `APK/src/services/nativeGPS.js` | 75 | Igual à base | criarFonteGPSNativa |
| `APK/src/services/nativeLocation.js` | 7 | Igual à base | criarFonteGPSReal |
| `APK/src/services/networkPanelService.js` | 106 | Alterado | criarPainelRede |
| `APK/src/services/ocorrenciasMobileService.js` | 324 | Novo | STORAGE_KEY_OCORRENCIAS_CACHE, STORAGE_KEY_OCORRENCIAS_PENDENTES, OcorrenciasMobileService |
| `APK/src/theme/colors.js` | 33 | Igual à base | COLORS |
| `APK/src/utils/controlesTrajeto.js` | 13 | Igual à base | podeDescerParada, inverterTrajeto |
| `APK/src/utils/formatters.js` | 141 | Alterado | numeroDe, parseCoords, formatCoord, formatDistanceParts, formatStreetLength, TEXTO_ESTADO, classeEstado, reasonTitle |
| `APK/src/utils/gpx.js` | 2 | Igual à base | → ../../../public/gpx.js |
| `APK/src/utils/networkPresentation.js` | 72 | Alterado | apresentarRede |
| `APK/src/utils/planejamentoCircuito.js` | 8 | Igual à base | — |
| `APK/src/utils/resumoRota.js` | 2 | Igual à base | — |
| `APK/src/utils/revisoesEndereco.js` | 2 | Igual à base | — |
| `APK/src/utils/trechoNoMapa.js` | 99 | Igual à base | metrosPorPixel, toleranciaDoClique, distanciaPontoSegmentoMetros, trechoSobClique |
| `APK/test/basemapPreference.test.js` | 41 | Igual à base | — |
| `APK/test/circuitoUI.test.js` | 24 | Igual à base | — |
| `APK/test/controlesTrajeto.test.js` | 33 | Igual à base | — |
| `APK/test/enderecoDigital.test.js` | 514 | Igual à base | — |
| `APK/test/enderecoUI.test.js` | 4 | Igual à base | — |
| `APK/test/fidelity.test.js` | 416 | Igual à base | — |
| `APK/test/gpxMobile.test.js` | 164 | Igual à base | — |
| `APK/test/gradleLauncher.test.js` | 54 | Igual à base | — |
| `APK/test/graph.test.js` | 280 | Igual à base | — |
| `APK/test/helpers.js` | 91 | Igual à base | ROOT, loadRealFeatures, feature, official, unofficial, road, offset |
| `APK/test/mapRender.test.js` | 82 | Igual à base | — |
| `APK/test/mapSync.test.js` | 48 | Igual à base | — |
| `APK/test/mapaTrechos.test.js` | 396 | Igual à base | — |
| `APK/test/mobileNetworkService.test.js` | 253 | Alterado | — |
| `APK/test/nativeGPS.test.js` | 83 | Igual à base | — |
| `APK/test/navegacaoMobile.test.js` | 139 | Igual à base | — |
| `APK/test/networkPanel.test.js` | 103 | Alterado | — |
| `APK/test/networkPanelRender.test.js` | 81 | Alterado | — |
| `APK/test/ocorrenciasApk.test.js` | 455 | Novo | — |
| `APK/test/resumoRota.test.js` | 4 | Igual à base | — |
| `APK/test/routeResultRender.test.js` | 40 | Igual à base | — |
| `APK/test/router.test.js` | 509 | Igual à base | — |
| `APK/test/trechoNoMapa.test.js` | 84 | Igual à base | — |
| `APK/test/wfs.test.js` | 295 | Igual à base | — |
| `core/config.js` | 202 | Igual à base | WFS_BASE_URL, LAYER_NAME, KNOWN_ATTRIBUTES, METRIC_CRS, GRAPH_DEFAULTS, WFS_DEFAULTS, UPDATE_DEFAULTS, MAP_VIEW |
| `core/coresTrechos.js` | 105 | Igual à base | PALETA_TRECHOS, TOTAL_CORES, corPorIndice, coresDosTrechos, colorirTrechos |
| `core/enderecoDigital.js` | 431 | Igual à base | ALFABETO_CEP_DIGITAL, LATITUDE_REFERENCIA_CEP_DIGITAL, LONGITUDE_REFERENCIA_CEP_DIGITAL, RESOLUCAO_CEP_DIGITAL, REGIAO, CoordenadaNaRegiao, NormalizarCoordenadaParaBanco, NormalizarCepDigitalParaBanco, CodificarCompleto, CodificarCurto, Completar, DecodificarCentro, NormalizarCepDigital, ValidarSintaxeCepDigital, DecodificarCepDigital, ResolverEnderecoDigital |
| `core/enderecoDigitalService.js` | 231 | Igual à base | MODOS, criarServicoEnderecoDigital |
| `core/fonteGPS.js` | 178 | Igual à base | ERROS_GPS, criarFonteGPS |
| `core/geo.js` | 261 | Igual à base | project, unproject, dist, haversine, projectPointOnSegment, distancePointToSegment, pointOnSegment, cross, segmentIntersection, polylineLength, formatDistance |
| `core/graph.js` | 1384 | Igual à base | buildGraph, buildEdgeIndex |
| `core/instrucoes.js` | 171 | Igual à base | anguloNoVertice, ruaDoTrecho, metros, instrucaoAtual, distanciaRestanteParaParada |
| `core/navegacao.js` | 511 | Igual à base | EXECUCAO, PADRAO_OPCOES, planoDeNavegacao, projetarNoPlano, pernaDoPlano, criarNavegacao |
| `core/ordemParadas.js` | 437 | Igual à base | LIMITE_EXATO, LIMITE_TOTAL, matrizDistancias, custoDaOrdem, vizinhoMaisProximo, doisOpt, heldKarp, heldKarpSaidaCurta, otimizarOrdem |
| `core/pontoTrajeto.js` | 242 | Igual à base | TIPOS, STATUS, criarListaPontos, criarPonto, rotularPontos, adicionarPonto, removerPonto, atualizarPonto, moverPonto, moverPontoPara, podeCalcular, contarParadas, sequenciaRotulos |
| `core/rotaParadas.js` | 331 | Igual à base | MODOS_ORDEM, calcularRotaComParadas |
| `core/router.js` | 718 | Igual à base | findNearestEdge, routeOnGraph, isValidLonLat, validatePathContinuity |
| `core/simulador.js` | 344 | Igual à base | VELOCIDADE_BASE, VELOCIDADES, criarSimulador |
| `core/spatialIndex.js` | 147 | Igual à base | GridIndex, computeBBox |
| `core/wfs.js` | 528 | Igual à base | WfsError, parseServiceException, fetchNetwork, describeLayer, checkForUpdates |
| `ocorrencias/catalogo.js` | 224 | Novo | CLASSIFICACOES, STATUS_OCORRENCIA, TEMPORALIDADES, ACOES_COLABORATIVAS, CLASSIFICACAO_META, CATEGORIAS_OCORRENCIA, GRUPOS_CATEGORIA, obterCategoria, validarCategoria, validarClassificacao, obterClassificacaoMeta |
| `ocorrencias/preferencias.js` | 71 | Novo | MODOS_PREFERENCIA, ESCALAS_PENALIDADE, preferenciasPadrao, normalizarPreferencias, chaveStoragePreferencias, chaveStorageUsuarioId |
| `ocorrencias/regras.js` | 515 | Novo | associarSegmentoDaRede, localizarArestasDaOcorrencia, reavaliarStatus, atualizarExpiracoes, criarOcorrencia, aplicarInteracao, ocorrenciaInfluenciaCalculo |
| `ocorrencias/roteamentoAlternativo.js` | 531 | Novo | extrairArestasDaRota, resumirOcorrencia, construirGrafoDerivado, inspecionarOcorrenciasNaRota, calcularRotaComAlternativas |
| `package.json` | 49 | Igual à base | — |
| `public/app.js` | 2770 | Alterado | — |
| `public/camadaBase.js` | 203 | Igual à base | CAMADA_PADRAO, CAMADA_SATELITE, CHAVE_CAMADA_BASE, CAMADAS_BASE, normalizarCamadaBase, opcoesCamadasBase, lerPreferenciaCamadaSync, salvarPreferenciaCamadaSync, lerPreferenciaCamadaAsync, salvarPreferenciaCamadaAsync, criarMonitorSatelite |
| `public/clienteRede.js` | 772 | Alterado | detectarConfiguracaoAmbiente, criarClienteRede |
| `public/config.js` | 22 | Novo | — |
| `public/exportarGpxWeb.js` | 70 | Igual à base | exportarRotaGpxWeb |
| `public/gpx.js` | 285 | Igual à base | nomeArquivoGpx, gerarGpxRota |
| `public/index.html` | 374 | Alterado | — |
| `public/manifest.webmanifest` | 39 | Igual à base | — |
| `public/navegacaoUI.js` | 669 | Igual à base | criarInterfaceNavegacao |
| `public/network.snapshot.js` | 3 | Novo | — |
| `public/ocorrenciasUI.js` | 167 | Novo | obterOuCriarUsuarioIdWeb, lerPreferenciasWeb, salvarPreferenciasWeb, formatarDataHoraPtBr, resumoPreferenciasTexto, estiloClassificacao, simboloCategoria, rotuloStatusOcorrencia, rotuloTemporalidade, formatarDistanciaCurta, gerarHtmlOpcoesCategoriasEvitar, obterDetalhesCategoria |
| `public/planejamentoCircuito.js` | 107 | Igual à base | criarListaCircuito, opcoesCalculoCircuito, papelPontoCircuito, assinaturaPlanejador, resolverPontoNoMapa |
| `public/resumoRota.js` | 41 | Igual à base | rotuloModo, resumoRota |
| `public/revisoesEndereco.js` | 11 | Igual à base | criarRevisoesEndereco |
| `public/styles.css` | 1664 | Alterado | — |
| `public/sw.js` | 120 | Alterado | — |
| `server/index.js` | 722 | Alterado | parsePoint, createServer |
| `server/networkService.js` | 704 | Alterado | SNAPSHOT_PATH, NetworkService |
| `server/ocorrenciasService.js` | 156 | Novo | OCORRENCIAS_PATH, OcorrenciasService |
| `test/api.test.js` | 251 | Alterado | — |
| `test/camadaBase.test.js` | 140 | Igual à base | — |
| `test/caminhoMinimo.test.js` | 376 | Igual à base | — |
| `test/cenariosCircuito.js` | 45 | Igual à base | testarCircuitos |
| `test/cenariosEnderecoUI.js` | 66 | Igual à base | testarEnderecos |
| `test/cenariosResumoRota.js` | 27 | Igual à base | testarResumo |
| `test/circuitoUI.test.js` | 26 | Igual à base | — |
| `test/circular.test.js` | 400 | Igual à base | — |
| `test/clienteRede.test.js` | 420 | Alterado | — |
| `test/coresTrechos.test.js` | 213 | Igual à base | — |
| `test/enderecoDigital.test.js` | 513 | Igual à base | — |
| `test/enderecoUI.test.js` | 4 | Igual à base | — |
| `test/fidelity.test.js` | 415 | Igual à base | — |
| `test/gpx.test.js` | 329 | Igual à base | — |
| `test/graph.test.js` | 279 | Igual à base | — |
| `test/helpers.js` | 90 | Igual à base | ROOT, loadRealFeatures, feature, official, unofficial, road, offset |
| `test/integracao-arquitetura.test.js` | 448 | Novo | — |
| `test/mapaIntegracao.test.js` | 132 | Igual à base | — |
| `test/navegacao.test.js` | 454 | Igual à base | — |
| `test/ocorrencias.test.js` | 283 | Novo | — |
| `test/ocorrenciasApi.test.js` | 232 | Novo | — |
| `test/ocorrenciasWeb.test.js` | 252 | Novo | — |
| `test/ordemOtimizada.test.js` | 430 | Igual à base | — |
| `test/ordemParadas.test.js` | 450 | Igual à base | — |
| `test/otimizacaoAuditoria.test.js` | 331 | Igual à base | — |
| `test/paridade.test.js` | 115 | Alterado | — |
| `test/pwa.test.js` | 109 | Igual à base | — |
| `test/resumoRota.test.js` | 19 | Igual à base | — |
| `test/rotaAlternativa.test.js` | 288 | Novo | — |
| `test/router.test.js` | 508 | Igual à base | — |
| `test/update.test.js` | 510 | Alterado | — |
| `test/wfs.test.js` | 294 | Igual à base | — |
| `tools/audit-fidelity.js` | 358 | Igual à base | — |
| `tools/auditar-caminho-minimo.js` | 446 | Igual à base | — |
| `tools/auditar-ordem-paradas.js` | 501 | Igual à base | — |
| `tools/auditar-otimizacao.js` | 250 | Igual à base | — |
| `tools/diagnose-connections.js` | 160 | Igual à base | — |
| `tools/diagnose-detours.js` | 126 | Igual à base | — |
| `tools/experiment-tolerance.js` | 94 | Igual à base | — |
| `tools/fetch-network.js` | 183 | Alterado | — |
| `tools/gerar-icones-pwa.mjs` | 48 | Igual à base | — |
| `tools/inspect-layer.js` | 135 | Igual à base | — |
| `tools/inventario-unificacao.mjs` | 53 | Alterado | — |
| `tools/report-network.js` | 170 | Igual à base | — |
| `tools/validar-circular.mjs` | 195 | Igual à base | — |
| `tools/validar-mapa.mjs` | 93 | Igual à base | — |
| `tools/validar-navegacao.mjs` | 246 | Igual à base | — |
| `tools/validar-otimizacao.js` | 263 | Igual à base | — |
| `tools/validar-otimizacao.mjs` | 264 | Igual à base | — |
| `tools/validar-paradas.mjs` | 134 | Igual à base | — |
| `tools/validar-saida-curta.mjs` | 182 | Igual à base | — |
| `tools/validar-trechos-coloridos.mjs` | 289 | Igual à base | — |
| `tools/validate-routes.js` | 170 | Igual à base | — |
| `tools/verificar-integridade-motor.mjs` | 122 | Igual à base | — |

## SHA-256 do núcleo e servidor

```text
b4963c14ca86f546396893825d4d2181314f15e58cc62d94a39c081b273d207c  core/config.js
622837d18d8eef37827c19444f95cd3f7ddf84a56ef09cded96fef4adf866ae9  core/coresTrechos.js
6f4b9bb43777ba2439d5b2df56007c6268f585255b0a5d9f0a8c1f434d9e951a  core/enderecoDigital.js
3ac88e2cba8055c338e6fd84dbca910bac621a39b33e80a3b420808414cd05e7  core/enderecoDigitalService.js
bb1649dfdd0b4ebde0737bf5599beb713fb8e0e9a1d2bb4fd43c8568502e63c5  core/fonteGPS.js
8c0df3930137598b22cf8988cf0f807dd47fc138dcc0aa5c52ce247e70f9d69c  core/geo.js
5ccbf4713d13fba97be9222f7047132c32c1729b1fcf2bd6afd19771ed10c76c  core/graph.js
31c390855ae0e0c4c250b8baf2da9d2cc953d4e30c605cdfd6369f1df05dce50  core/instrucoes.js
11b9289a42863c2a737f30717d4f8435f54ec6c36376f488ef2a0b4b2ff878ad  core/navegacao.js
f8e95bb587127afd5d306869ac43b9dae802ba40b0b9a7637a977a46eed9952e  core/ordemParadas.js
24d1e765aa50a9e0095a5923edf5f79486d96e11653da212d42e5d6db5e24334  core/pontoTrajeto.js
1972a9507f661eb88e90d79673160b2c0eb4a7365ffb0296c52bcaa22fe61b12  core/rotaParadas.js
d35050e85a39097f2cdc68a89da0f9001000634d99384614341cc1992cd57b97  core/router.js
e8aef1e6a6b05c70661dbe5f10326ed1067551d5ca4883dc32281f7138dd4314  core/simulador.js
4726a3b44a5d168de0252ec57d47110c3f531f363ce5557b2d656d836c073730  core/spatialIndex.js
f207d568cb4aafdec6a5579116a4d2e69efbfd4251be6d07230e2fbc00e9e3a6  core/wfs.js
c36934696684df9116ae1dfa460ba0816748c6ad5c6a666366397746fbddc111  server/index.js
c82e6d1af9a71f38d2382277cf5408370d24a088659b5f3e087dbd2fb5306728  server/networkService.js
0cd123e4e20c1c1c7aa957af8ffe882fca0f41dd3a8624c5375ef62ae1d4cd90  server/ocorrenciasService.js
```
