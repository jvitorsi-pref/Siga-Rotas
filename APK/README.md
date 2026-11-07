# Roteamento Viário de Santo André (a pé) — Projeto React Native (Android APK)

Adaptação do **Motor de Roteamento Viário de Santo André** (`siga:SIGA_EIXO_LOG_OFICIAL_E_NAO`) para **React Native (Expo / Android Nativo)**, em processo de unificação com o Web. Exportação Hermes não equivale a APK instalado/homologado; consulte [o relatório de integração](../docs/UNIFICACAO.md) para evidências e pendências.

### Fluxo atual

- Somente circuitos: A é origem e destino; B, C, D etc. são paradas editáveis. Não há card duplicado para o retorno.
- **Calcular rota** respeita a ordem dos cards; **Calcular rota otimizada**, logo abaixo, otimiza a distância total incluindo a volta a A.
- Tocar num trecho da rota no mapa, sem seleção de ponto ativa, oculta/mostra aquele trecho (o mesmo comportamento do Web). A legenda e os cartões continuam mostrando todos de novo. A seleção de ponto no mapa continua tendo prioridade.
- O resultado informa o modo aplicado, método de otimização e economia recebidos do motor, com os mesmos rótulos do Web. Método heurístico não é apresentado como garantia de ótimo global; comparação ausente é declarada indisponível. Circuitos empatados só indicam mudança de ordem quando a sequência realmente mudou, ignorando a repetição final de A.
- Nas visualizações **Painel** e **Dividido**, role abaixo do resultado da rota para acessar **Rede viária**. O painel mostra fonte, cache, atualização automática, erros do serviço e diagnóstico expansível do grafo. **Verificar atualizações** consulta o conteúdo WFS; **Baixar do GeoServer** solicita uma atualização completa.
- Fonte “WFS — carregado nesta sessão” não indica conexão ativa. Cache local e snapshot embarcado são identificados separadamente. Falha de gravação informa quando uma atualização ficou apenas em memória.
- Alternar Painel/Dividido/Mapa mantém a mesma WebView e a preferência da legenda. No modo Painel ela fica invisível e sem interação/acessibilidade, mas retida em memória para não perder a câmera. Redimensionar não reenquadra a rota; novos cálculos ou os comandos explícitos Rede/Rota continuam podendo enquadrar.
- Se o CDN do OpenLayers falhar ou ultrapassar o prazo nominal de 3 s, o mapa vetorial Canvas inicia sem depender dele. Não troca de motor se o script chegar depois. O Canvas usa o fundo claro, rede/rotas/pontos locais, arraste, roda do mouse, pinça e os botões +/− no mesmo lugar/aparência do OpenLayers; não oferece tiles OSM offline, rotação, inércia nem teclado como o mapa vetorial completo.
- O painel trata da **rede viária**, não de sincronização de dados coletados. **Coleta de localização está adiada** por decisão do usuário. Cálculo continua local; delegação por URL remota não está implementada.
- Estado validado em código/testes: **299 testes Web / 208 APK**, exportação Android/Hermes. Execução/gestos, AsyncStorage real e aparência em aparelho ainda requerem homologação.

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
