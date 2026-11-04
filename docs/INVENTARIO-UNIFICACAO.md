# Inventário técnico — unificação

Gerado por `node tools/inventario-unificacao.mjs`. Base: `449746b985e23ba2517df55ae67d98751c4e168c`.

Inventário mecânico de arquivos próprios ativos, testes e ferramentas; não afirma validação visual nem execução Android. Vendor OpenLayers, snapshots e arquivos Android gerados são dependências/recursos, não incluídos na tabela de exports. Pacotes em `updates/` são históricos e não entram no grafo de imports ativo.

## Proteção do motor

21 arquivos de core/server comparados à base; alterados: core/armazenamentoLocal.js, core/coleta.js, core/recuperacaoColeta.js. Mudanças fora dos hashes aprovados de integração de campo: **nenhuma**. As exceções são correções de persistência/coleta e um novo preparador de retomada; não incluem grafo, A*, TSP, WFS ou servidor.

## Arquivos

| Arquivo | Linhas | Situação | Exports / reexports |
|---|---:|---|---|
| `APK/App.js` | 856 | Alterado | — |
| `APK/android/app/src/main/AndroidManifest.xml` | 34 | Alterado | — |
| `APK/app.json` | 45 | Alterado | — |
| `APK/eas.json` | 27 | Igual à base | — |
| `APK/metro.config.js` | 10 | Alterado | — |
| `APK/package.json` | 33 | Alterado | — |
| `APK/src/components/NavigationPanel.js` | 89 | Novo | NavigationPanel |
| `APK/src/components/NetworkDiagnosticsPanel.js` | 272 | Igual à base | NetworkDiagnosticsPanel |
| `APK/src/components/PointCard.js` | 342 | Alterado | PointCard |
| `APK/src/components/RoadNetworkMap.js` | 355 | Alterado | RoadNetworkMap |
| `APK/src/components/RouteResultPanel.js` | 355 | Alterado | RouteResultPanel |
| `APK/src/core/config.js` | 3 | Alterado | → ../../../core/config.js |
| `APK/src/core/enderecoDigital.js` | 3 | Alterado | → ../../../core/enderecoDigital.js |
| `APK/src/core/enderecoDigitalService.js` | 3 | Alterado | → ../../../core/enderecoDigitalService.js |
| `APK/src/core/geo.js` | 3 | Alterado | → ../../../core/geo.js |
| `APK/src/core/graph.js` | 3 | Alterado | → ../../../core/graph.js |
| `APK/src/core/pontoTrajeto.js` | 3 | Alterado | → ../../../core/pontoTrajeto.js |
| `APK/src/core/rotaParadas.js` | 3 | Alterado | → ../../../core/rotaParadas.js |
| `APK/src/core/router.js` | 3 | Alterado | → ../../../core/router.js |
| `APK/src/core/spatialIndex.js` | 3 | Alterado | → ../../../core/spatialIndex.js |
| `APK/src/core/wfs.js` | 530 | Igual à base | WfsError, parseServiceException, fetchNetwork, describeLayer, checkForUpdates |
| `APK/src/map/mapHtml.js` | 522 | Novo | MAP_HTML |
| `APK/src/map/routePresentation.js` | 13 | Novo | trechosParaMapa |
| `APK/src/map/styleScript.js` | 24 | Novo | ESTILO_TRECHO_JS |
| `APK/src/services/mobileNavigationService.js` | 148 | Novo | criarNavegacaoMobile |
| `APK/src/services/mobileNetworkService.js` | 459 | Igual à base | fingerprintOf, MobileNetworkService, mobileNetworkService |
| `APK/src/services/nativeGPS.js` | 75 | Novo | criarFonteGPSNativa |
| `APK/src/services/nativeLocation.js` | 7 | Novo | criarFonteGPSReal |
| `APK/src/theme/colors.js` | 33 | Igual à base | COLORS |
| `APK/src/utils/controlesTrajeto.js` | 13 | Novo | podeDescerParada, inverterTrajeto |
| `APK/src/utils/formatters.js` | 139 | Igual à base | numeroDe, parseCoords, formatCoord, formatDistanceParts, formatStreetLength, TEXTO_ESTADO, classeEstado, reasonTitle |
| `APK/test/controlesTrajeto.test.js` | 33 | Novo | — |
| `APK/test/enderecoDigital.test.js` | 514 | Igual à base | — |
| `APK/test/fidelity.test.js` | 416 | Igual à base | — |
| `APK/test/graph.test.js` | 280 | Igual à base | — |
| `APK/test/helpers.js` | 91 | Igual à base | ROOT, loadRealFeatures, feature, official, unofficial, road, offset |
| `APK/test/mapaTrechos.test.js` | 179 | Novo | — |
| `APK/test/nativeGPS.test.js` | 83 | Novo | — |
| `APK/test/navegacaoMobile.test.js` | 139 | Novo | — |
| `APK/test/router.test.js` | 509 | Igual à base | — |
| `APK/test/wfs.test.js` | 295 | Igual à base | — |
| `core/armazenamentoLocal.js` | 798 | Alterado | ESTADO, STORE, TIPO_OPERACAO, STORES, VERSAO_ESQUEMA, descreverErroArmazenamento, novoId, criarAdaptadorMemoria, criarAdaptadorIndexedDB, criarArmazenamento |
| `core/coleta.js` | 796 | Alterado | ESTADO_COLETA, TIPO_PONTO, MOTIVO, FONTE, CLASSIFICACAO, CONFIG_PADRAO, criarColeta, capturarPosicao, montarLocalizacaoResidencia, detectarDuplicado |
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
| `core/recuperacaoColeta.js` | 24 | Novo | prepararRetomadaSimulada |
| `core/rotaParadas.js` | 331 | Igual à base | MODOS_ORDEM, calcularRotaComParadas |
| `core/router.js` | 718 | Igual à base | findNearestEdge, routeOnGraph, isValidLonLat, validatePathContinuity |
| `core/simulador.js` | 344 | Igual à base | VELOCIDADE_BASE, VELOCIDADES, criarSimulador |
| `core/spatialIndex.js` | 147 | Igual à base | GridIndex, computeBBox |
| `core/wfs.js` | 528 | Igual à base | WfsError, parseServiceException, fetchNetwork, describeLayer, checkForUpdates |
| `package.json` | 49 | Alterado | — |
| `public/app.js` | 1619 | Alterado | — |
| `public/coletaUI.js` | 977 | Alterado | criarInterfaceColeta |
| `public/index.html` | 428 | Alterado | — |
| `public/manifest.webmanifest` | 29 | Alterado | — |
| `public/navegacaoUI.js` | 668 | Igual à base | criarInterfaceNavegacao |
| `public/planoPersistido.js` | 56 | Novo | assinaturaPlanejador, snapshotPlano, persistirPlanoAtivo, prepararPlanoSalvo |
| `public/styles.css` | 1334 | Alterado | — |
| `public/sw.js` | 107 | Alterado | — |
| `server/index.js` | 445 | Igual à base | parsePoint, createServer |
| `server/networkService.js` | 561 | Igual à base | SNAPSHOT_PATH, NetworkService |
| `test/api.test.js` | 166 | Igual à base | — |
| `test/armazenamentoLocal.test.js` | 259 | Alterado | — |
| `test/caminhoMinimo.test.js` | 376 | Igual à base | — |
| `test/circular.test.js` | 400 | Igual à base | — |
| `test/coleta.test.js` | 615 | Alterado | — |
| `test/coresTrechos.test.js` | 213 | Igual à base | — |
| `test/enderecoDigital.test.js` | 513 | Igual à base | — |
| `test/fidelity.test.js` | 415 | Igual à base | — |
| `test/graph.test.js` | 279 | Igual à base | — |
| `test/helpers.js` | 90 | Igual à base | ROOT, loadRealFeatures, feature, official, unofficial, road, offset |
| `test/navegacao.test.js` | 454 | Igual à base | — |
| `test/ordemOtimizada.test.js` | 430 | Igual à base | — |
| `test/ordemParadas.test.js` | 450 | Igual à base | — |
| `test/otimizacaoAuditoria.test.js` | 331 | Igual à base | — |
| `test/paridade.test.js` | 50 | Novo | — |
| `test/planoPersistido.test.js` | 151 | Novo | — |
| `test/recuperacaoColeta.test.js` | 27 | Novo | — |
| `test/router.test.js` | 508 | Igual à base | — |
| `test/update.test.js` | 397 | Igual à base | — |
| `test/wfs.test.js` | 294 | Igual à base | — |
| `tools/audit-fidelity.js` | 358 | Igual à base | — |
| `tools/auditar-caminho-minimo.js` | 446 | Igual à base | — |
| `tools/auditar-ordem-paradas.js` | 501 | Igual à base | — |
| `tools/auditar-otimizacao.js` | 250 | Igual à base | — |
| `tools/diagnose-connections.js` | 160 | Igual à base | — |
| `tools/diagnose-detours.js` | 126 | Igual à base | — |
| `tools/experiment-tolerance.js` | 94 | Igual à base | — |
| `tools/fetch-network.js` | 94 | Igual à base | — |
| `tools/inspect-layer.js` | 135 | Igual à base | — |
| `tools/inventario-unificacao.mjs` | 48 | Novo | — |
| `tools/report-network.js` | 170 | Igual à base | — |
| `tools/validar-circular.mjs` | 195 | Igual à base | — |
| `tools/validar-mapa.mjs` | 93 | Igual à base | — |
| `tools/validar-navegacao.mjs` | 246 | Igual à base | — |
| `tools/validar-offline.mjs` | 333 | Igual à base | — |
| `tools/validar-otimizacao.js` | 263 | Igual à base | — |
| `tools/validar-otimizacao.mjs` | 264 | Igual à base | — |
| `tools/validar-paradas.mjs` | 134 | Igual à base | — |
| `tools/validar-saida-curta.mjs` | 182 | Igual à base | — |
| `tools/validar-trechos-coloridos.mjs` | 289 | Igual à base | — |
| `tools/validate-routes.js` | 170 | Igual à base | — |
| `tools/verificar-integridade-motor.mjs` | 122 | Igual à base | — |

## SHA-256 do núcleo e servidor

```text
a3f55756eaff5015048e67b28ef363b3d6030017b07ddcbe81c807cb213b18a9  core/armazenamentoLocal.js
637480cc0f18a3376d8b58e0b08f985133985522a344d1728861b942bc1b5df4  core/coleta.js
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
b0af107b671c6fcb154d4b03f1a04b3ffc82b76795598386560eecd5335150fc  core/recuperacaoColeta.js
1972a9507f661eb88e90d79673160b2c0eb4a7365ffb0296c52bcaa22fe61b12  core/rotaParadas.js
d35050e85a39097f2cdc68a89da0f9001000634d99384614341cc1992cd57b97  core/router.js
e8aef1e6a6b05c70661dbe5f10326ed1067551d5ca4883dc32281f7138dd4314  core/simulador.js
4726a3b44a5d168de0252ec57d47110c3f531f363ce5557b2d656d836c073730  core/spatialIndex.js
f207d568cb4aafdec6a5579116a4d2e69efbfd4251be6d07230e2fbc00e9e3a6  core/wfs.js
33f82ffbd3abd44af591eb824fbf1deccbc454829302a05072d2111f0531f758  server/index.js
577f63f5719e07f993ce269b725deb189eff325e87d2850615507785d20f5147  server/networkService.js
```
