# Roteamento Viário de Santo André (a pé) — Projeto React Native (Android APK)

Adaptação do **Motor de Roteamento Viário de Santo André** (`siga:SIGA_EIXO_LOG_OFICIAL_E_NAO`) para **React Native (Expo / Android Nativo)**, em processo de unificação com o Web. Exportação Hermes não equivale a APK instalado/homologado; consulte [o relatório de integração](../docs/UNIFICACAO.md) para evidências e pendências.

### Fluxo atual

- Somente circuitos: A é origem e destino; B, C, D etc. são paradas editáveis. Não há card duplicado para o retorno.
- **Persistência offline-first e SQLite (`expo-sqlite`):** rotas calculadas, trajetos percorridos por GPS real (`LineString` / `MultiLineString` com filtragem de ruído/saltos), observações vinculadas à rota + histórico de eventos e o cache da rede viária são salvos imediatamente em SQLite local (`APK/src/services/armazenamentoSqlite.js`). Há painel de **Rotas salvas**, recuperação de execução GPS interrompida, marcadores e trilhas em camada separada no mapa (OpenLayers e fallback Canvas 2D), e sincronização em lote ordenada com `SigaRotasCampo.ashx`. Ao regenerar a pasta `android/`, execute `npx expo prebuild --platform android` para manter o plugin nativo `expo-sqlite`.
- **Calcular rota** respeita a ordem dos cards; **Calcular rota otimizada**, logo abaixo, otimiza a distância total incluindo a volta a A.
- Tocar num trecho da rota no mapa, sem seleção de ponto ativa, oculta/mostra aquele trecho (o mesmo comportamento do Web). A legenda e os cartões continuam mostrando todos de novo. A seleção de ponto no mapa continua tendo prioridade.
- O resultado informa o modo aplicado, método de otimização e economia recebidos do motor, com os mesmos rótulos do Web. Método heurístico não é apresentado como garantia de ótimo global; comparação ausente é declarada indisponível. Circuitos empatados só indicam mudança de ordem quando a sequência realmente mudou, ignorando a repetição final de A.
- Nas visualizações **Painel** e **Dividido**, role abaixo do resultado da rota para acessar **Rede viária**. O painel mostra fonte, cache, atualização automática, erros do serviço e diagnóstico expansível do grafo. **Verificar atualizações** consulta o conteúdo WFS; **Baixar do GeoServer** solicita uma atualização completa.
- Fonte “WFS — carregado nesta sessão” não indica conexão ativa. Cache local e snapshot embarcado são identificados separadamente. Falha de gravação informa quando uma atualização ficou apenas em memória.
- Alternar Painel/Dividido/Mapa mantém a mesma WebView e a preferência da legenda. No modo Painel ela fica invisível e sem interação/acessibilidade, mas retida em memória para não perder a câmera. Redimensionar não reenquadra a rota; novos cálculos ou os comandos explícitos Rede/Rota continuam podendo enquadrar.
- Se o CDN do OpenLayers falhar ou ultrapassar o prazo nominal de 3 s, o mapa vetorial Canvas inicia sem depender dele. Não troca de motor se o script chegar depois. O Canvas usa o fundo claro, rede/rotas/pontos locais, arraste, roda do mouse, pinça e os botões +/− no mesmo lugar/aparência do OpenLayers; não oferece tiles OSM offline, rotação, inércia nem teclado como o mapa vetorial completo.
- O painel **Rede viária** exibe fonte, cache, modo de cálculo (servidor Node.js × local no aparelho), transporte (`API Node.js direta` × `Proxy WebForms ApiProxy.ashx`), URL configurada, erros do serviço e diagnóstico expansível do grafo. Também permite configurar/alterar a URL do servidor backend diretamente no aparelho (**▸ Configurar servidor backend**) sem precisar recompilar o APK.
- **Conexão servidor × local automática:** quando há uma URL de servidor configurada (via `EXPO_PUBLIC_SIGA_API_URL` no build ou salva em **Rede viária**), o app consulta o servidor Node.js primeiro e alterna automaticamente para contingência local offline caso fique sem internet ou o backend esteja fora (enfileirando ocorrências/votos pendentes e sincronizando ao reconectar). Sem nenhuma URL configurada, o app opera 100% local no aparelho.
- O aplicativo também inclui preferências individuais de trajeto (considerar, priorizar sem dificuldades ou ignorar alertas), ocorrências colaborativas nas vias (com modal de registro/confirmação/contestação) e seleção de rotas alternativas quando desvios são encontrados.

---

## 1. Arquitetura Mobile (Como o projeto foi transformado)

Na versão original Web (`server/` + `public/`), o navegador precisava obrigatoriamente de um servidor Node.js intermediário porque o GeoServer da Prefeitura de Santo André (`https://sigamapa.santoandre.sp.gov.br/geoserver/siga/wfs`) não envia cabeçalhos CORS (`Access-Control-Allow-Origin`).

No aplicativo **React Native para Android**:
1. **Motor de Roteamento 100% On-Device (`src/core/`)**:
   - Toda a inteligência geométrica e algorítmica foi preservada integralmente e roda nativamente no runtime JavaScript (Hermes) do Android:
     - Projeção métrica **UTM Zona 23S (`EPSG:32723`)** via séries de Snyder com erro `< 1 cm` (`src/core/geo.js`);
     - Índice espacial em grade uniforme (`src/core/spatialIndex.js`);
     - Construção topológica do grafo com detecção de cruzamentos reais, toques, snaps (`≤ 5 cm`), conectores de junção (`5 cm – 1 m`), corte de segmentos, Union-Find e remoção de duplicidades (`src/core/graph.js`);
     - Algoritmo **A\*** com fila de prioridade (Binary Heap) e divisão temporária de arestas preservando todos os vértices intermediários das curvas (`src/core/router.js`);
     - Orquestração de **múltiplas paradas ordenadas** (`A → B → C → D…`, `src/core/rotaParadas.js` e `src/core/pontoTrajeto.js`);
     - Porta fiel do **Endereço Digital (CEP Digital de Santo André)** de `CalculoGeometriaDAL` (`src/core/enderecoDigital.js` e `src/core/enderecoDigitalService.js`).
2. **Funcionamento Offline Imediato + Sincronização Direta com o WFS (`src/services/mobileNetworkService.js`)**:
   - O snapshot oficial da rede viária (`src/data/network.snapshot.json`, com **4.545 feições**) vai **embutido dentro do APK**, permitindo que o aplicativo carregue o grafo e calcule rotas mesmo sem internet.
   - Como o `fetch` nativo do Android **não possui restrição de CORS de navegador**, o próprio celular/emulador consulta diretamente o endpoint WFS da Prefeitura (`https://sigamapa.santoandre.sp.gov.br/geoserver/siga/wfs`), faz paginação automática (`single` → `startIndex` → `cql-range` em `src/core/wfs.js`) e persiste atualizações localmente via `@react-native-async-storage/async-storage`.
3. **Interface Nativa React Native + Mapa Cartográfico (`src/components/`)**:
   - Alternador rápido de visualização no topo: **Dividido** (Mapa + Painel), **Mapa** (Tela cheia) e **Painel** (Tela cheia).
   - Cartões nativos de pontos (`PointCard.js`) com validação de Endereço Digital, entrada de coordenadas decimais (com suporte a vírgula brasileira e inversão automática `lat, lon`), reordenação (`↑`/`↓`), foco no mapa (`🎯`) e seleção por toque no mapa (`🗺`).
   - Painel nativo de resultados (`RouteResultPanel.js`) com distância total, métricas, trechos (`A → B`, `B → C`) e lista numerada de logradouros percorridos (`oficial` / `não oficial`).
   - Painel nativo de diagnóstico do grafo e atualização WFS (`NetworkDiagnosticsPanel.js`), montado em `App.js`, com comandos/ciclo de vida em `networkPanelService.js`.
   - Mapa cartográfico (`RoadNetworkMap.js`) mantendo a cartografia de casca + núcleo dos eixos viários, eixos não oficializados tracejados, rota em 3 níveis (halo branco + contorno escuro + núcleo âmbar) e fallback vetorial em Canvas HTML5 2D caso o aparelho esteja 100% offline.

---

## 2. Estrutura de Diretórios (`APK/`)

```text
APK/
├── App.js                                # Componente raiz React Native (telas, estado, ações)
├── index.js                              # Entrypoint React Native (AppRegistry)
├── app.json                              # Configuração Expo / Android (package, permissões, tema)
├── eas.json                              # Configuração EAS Build para gerar .apk direto
├── package.json                          # Dependências e scripts de execução/build
├── babel.config.js                       # Configuração Babel (babel-preset-expo)
├── metro.config.js                       # Configuração Metro Bundler
├── android/                              # Projeto nativo Android (Gradle, Manifest, Kotlin)
│   ├── build.gradle
│   ├── settings.gradle
│   ├── gradle.properties
│   └── app/
│       ├── build.gradle
│       └── src/main/
│           ├── AndroidManifest.xml
│           ├── java/br/gov/sp/santoandre/roteamentoviario/
│           │   ├── MainActivity.kt
│           │   └── MainApplication.kt
│           └── res/values/
│               ├── colors.xml
│               ├── strings.xml
│               └── styles.xml
└── src/
    ├── components/
    │   ├── RoadNetworkMap.js             # Mapa interativo (OpenLayers 10 + Fallback Canvas Offline)
    │   ├── PointCard.js                  # Cartão nativo de cada ponto (A, B, C, D…)
    │   ├── RouteResultPanel.js           # Resultado da rota, trechos e logradouros percorridos
    │   └── NetworkDiagnosticsPanel.js    # Status da rede WFS/Snapshot e diagnóstico do grafo
    ├── core/                             # Motor de roteamento viário (isomórfico / Hermes)
    │   ├── config.js
    │   ├── enderecoDigital.js
    │   ├── enderecoDigitalService.js
    │   ├── geo.js
    │   ├── graph.js
    │   ├── pontoTrajeto.js
    │   ├── rotaParadas.js
    │   ├── router.js
    │   ├── spatialIndex.js
    │   └── wfs.js
    ├── data/
    │   └── network.snapshot.json         # Snapshot embutido da malha viária de Santo André
    ├── services/
    │   └── mobileNetworkService.js       # Ciclo de vida do grafo no Android + cache + WFS
    ├── theme/
    │   └── colors.js                     # Paleta escura fiel ao projeto original
    └── utils/
        └── formatters.js                 # Parsing de coordenadas e formatação de distâncias
```

---

## 3. Como Emular no Android e Gerar o APK

### Pré-requisitos
- **Node.js ≥ 20** instalado e no `PATH`
- **Android Studio** (com Android SDK + um dispositivo virtual **AVD** criado) para emulação local, **ou** o aplicativo **Expo Go** instalado em um celular Android físico.

### Opção A — Rodar direto no Emulador Android (ou celular físico)
```bash
cd APK
npm install

# Inicia o bundler e abre automaticamente no emulador Android aberto (AVD)
npm run android:go
```

### Opção B — Compilar e instalar o APK nativo localmente (Gradle / Android Studio)
Com o Android SDK (`ANDROID_HOME`) e JDK 17 configurados:
```bash
cd APK
npm install

# Compila e instala no emulador conectado:
npm run android

# Ou gera o arquivo .apk diretamente pelo wrapper (Windows, Linux e macOS):
npm run apk:release      # release
npm run apk:debug        # debug
```

O wrapper `scripts/gradle.mjs` escolhe `gradlew` ou `gradlew.bat`, repassa os
argumentos e informa quando falta JDK/SDK. `SIGA_GRADLE_DRY=1` só imprime o
comando. O diretório `android/` já está versionado: se você o apagar, rode
`npx expo prebuild --platform android` para recriá-lo (inclui o
`android/app/debug.keystore`, que **não** é versionado por ser chave).

### Assinatura de distribuição

O release usa a chave de **debug** enquanto não existir um keystore próprio —
serve para testes, **não para publicar**. Para assinar de verdade, crie o
keystore uma única vez e um `android/keystore.properties` (ambos fora do Git):

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore siga-release.keystore \
  -alias siga -keyalg RSA -keysize 2048 -validity 10000
```

`android/keystore.properties`:
```properties
storeFile=../../siga-release.keystore
storePassword=...
keyAlias=siga
keyPassword=...
```

Com esse arquivo presente, `assembleRelease` assina com ele; sem o arquivo,
continua compilando com a chave de debug. Nesta sessão não há JDK/Android SDK,
então o build e a assinatura **não foram executados** — a configuração foi
apenas validada por leitura e testes.
O arquivo `.apk` pronto para instalação será gerado em:
`APK/android/app/build/outputs/apk/release/app-release.apk` (ou `debug/app-debug.apk`).

Para instalar o `.apk` gerado no emulador Android via ADB:
```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

### Opção C — Gerar o `.apk` na nuvem (sem precisar do Android Studio local)
O arquivo `eas.json` já está configurado com `"buildType": "apk"`:
```bash
cd APK
npm install
npx eas-cli build --platform android --profile preview
```
Ao concluir, o EAS disponibiliza o link direto e QR Code para baixar e instalar o `.apk` no emulador ou celular Android.

### Opção D — Apontar o APK para o servidor backend em produção

O APK funciona **100% offline** por padrão usando o snapshot embutido, ou **integrado ao backend centralizado Node.js** (inclusive usando exatamente o mesmo `ApiProxy.ashx` do portal WebForms, sem exigir abertura de portas ou ARR/URL Rewrite no IIS). Consulte também [webforms/README-WEBFORMS.md](../webforms/README-WEBFORMS.md).

1. **No build do APK (recomendado para distribuição):** defina `EXPO_PUBLIC_SIGA_API_URL` antes de compilar (`npm run apk:release` ou `eas build`):
   ```bash
   # Via proxy WebForms existente no IIS:
   EXPO_PUBLIC_SIGA_API_URL=https://seu-portal.santoandre.sp.gov.br/SigaApp/SigaRotas/ApiProxy.ashx

   # Ou via URL direta / proxy reverso /api/*:
   # EXPO_PUBLIC_SIGA_API_URL=https://api-rotas.santoandre.sp.gov.br
   ```
   O arquivo `src/config/apiConfig.js` detecta automaticamente URLs terminadas em `.ashx` e traduz as rotas para `?endpoint=%2Fapi%2F...`.

2. **Direto no aparelho (sem recompilar o APK):**
   - Abra o painel **Rede viária** → toque em **▸ Configurar servidor backend**;
   - Digite a URL do servidor Node.js ou do `ApiProxy.ashx` e toque em **Conectar e sincronizar** (fica salva no `AsyncStorage` do aparelho);
   - Para voltar a operar apenas offline no aparelho, toque em **Usar modo local**.

> **Atenção ao IIS em produção:** se o portal WebForms exigir login (*Forms Auth* / *Windows Auth*), libere acesso anônimo para `ApiProxy.ashx` no IIS para que as chamadas externas do celular não recebam redirecionamento HTML de login.

