# Unificação Web / Android — acompanhamento

> **Escopo ativo revisado pelo usuário:** coleta de dados de localização adiada. O foco passa a ser o planejamento e os recursos já disponíveis. Novos trajetos são somente circuitos, com A como origem e destino; as ações são **Calcular rota** (ordem dos cards) e **Calcular rota otimizada** (menor distância total). Esta decisão substitui as referências anteriores a seletores de tipo/ordem e à prioridade de implementar coleta nativa.


Referências fixas: **APK = visual; Web = funcionalidades**. Trabalho em andamento, não aceite final.

## Etapa 1 — auditoria comparativa do código ativo

**Atualização:** a auditoria detalhada do código ativo foi consolidada em [AUDITORIA-COMPARATIVA.md](AUDITORIA-COMPARATIVA.md), com inventário reproduzível em [INVENTARIO-UNIFICACAO.md](INVENTARIO-UNIFICACAO.md). A tabela abaixo é o resumo inicial, não a matriz completa. A conclusão da auditoria estática não significa aprovação visual ou execução em Android.

`updates/` contém pacotes históricos, não implementações ativas. Web: `public/`, `server/`, `core/`. Android: `APK/App.js`, componentes, serviço e motor em `APK/src/`.

| Recurso | Web inicial | APK inicial | Ação |
|---|---|---|---|
| Identidade | Escura/azul | Clara/verde, logo SIGA | Aplicar tokens, logo, cartões e alternador de layout do APK à Web |
| Grafo, UTM, interseções, A* | Motor completo, correções caminho mínimo | Cópia anterior do router | Usar o motor Web por reexportação, sem alterar algoritmo |
| WFS, atualização | Backend Node, cache em disco | Fetch nativo, AsyncStorage, snapshot embarcado | Preservar adaptadores e diferença de URL Hermes |
| Coordenadas, Plus Codes, mapa | Sim | Sim | Preservar |
| Inclusão, remoção, inversão, ordem manual | Sim, arrastar e botões | Sim, botões | Preservar botões; arrastar nativo pendente |
| TSP / saída curta / circuito | Sim | Não | Compartilhar orquestrador Web e expor opções nativas |
| Cores/seleção de segmentos e legendas | Sim | Rota de cor única | Integração cartográfica nativa pendente |
| GPS, navegação, desvios, chegada | Sim | Ausente | Adaptar UI nativa ao núcleo existente (pendente) |
| Simulação e progresso | Sim | Ausente | Adaptar núcleo e controles (pendente) |
| Coleta, residências, recuperação | IndexedDB | Ausente | Adaptador AsyncStorage e UI nativa pendentes |
| Offline | Shell PWA e coleta local; cálculo depende da API | Motor e snapshot locais | Não confundir shell offline com planejamento offline Web |
| Sincronização de coleta com API | Ainda não implementada na Web | Ausente | Não declarar funcionalidade inexistente; requer contrato/backend |
| Layout dividido/mapa/painel | Ausente | Sim | Preservar APK e disponibilizar na Web |
| Mapa alternativo canvas | Não | Sim, fallback da WebView | Preservar |

## Etapa 2 — plano / proteção

1. Não modificar `core/router.js`, `graph.js`, `ordemParadas.js` ou `rotaParadas.js`: referência funcional única.
2. Reexportar núcleo puro a partir dos caminhos Android atuais; Metro observa a raiz para resolver imports compartilhados. Manter WFS nativo (adaptação Hermes), snapshot e serviço nativo.
3. Alterações visuais Web não removem IDs, controles ou listeners. Tokens saem da paleta existente do APK; nenhuma reformulação do APK.
4. Integrações incrementais, com testes de identidade do motor e cenários comuns; validar build Metro e Android separadamente.
5. Não substituir rotas por retas/APIs externas. Não declarar conclusão com base apenas em testes Node.

## Critérios de aceite ainda necessários

- Paridade de todos os itens pendentes da tabela.
- Comparação visual em navegador e aparelho/emulador com capturas nas mesmas dimensões.
- GPS real, retomada após encerramento, desconexão, atualização WFS e sincronização testados nos dois ambientes.
- Build Android e execução real, além dos testes do motor.

## Etapas 3–5 — entrega incremental em 04/11/2026

### Implementado

- Web: paleta clara/verde extraída do APK, logo original, cartões/campos, cabeçalho e alternador Dividido/Mapa/Painel. Em telas estreitas, mapa acima do painel (42%), como no APK. IDs e funcionalidades existentes mantidos. ResizeObserver atualiza o mapa quando o layout muda.
- Android: nove módulos puros passam a reexportar o núcleo Web; o volume removido desses arquivos é código duplicado, não remoção de funcionalidades. WFS nativo permanece separado por compatibilidade Hermes.
- Android: opções de menor rota total, saída curta, ordem manual e circuito chamam o orquestrador original. O estado da lista preserva o indicador de circuito e a rotulagem de paradas.
- Metro: raiz compartilhada observada e dependências resolvidas em APK/node_modules. Snapshot embarcado, serviço nativo, fallback canvas e aparência dos componentes existentes preservados.
- Scripts de teste das duas versões corrigidos para Node 22 (`test/*.test.js`).
- Cache PWA versionado, incluindo o logo; manifesto com cores institucionais.

### Arquivos alterados

| Grupo | Arquivos |
|---|---|
| UI Android | `APK/App.js` |
| Integração compartilhada | `APK/metro.config.js`, `APK/src/core/{config,enderecoDigital,enderecoDigitalService,geo,graph,pontoTrajeto,rotaParadas,router,spatialIndex}.js` |
| UI Web | `public/index.html`, `public/styles.css`, `public/app.js`, `public/logo-siga-app.png` |
| PWA | `public/sw.js`, `public/manifest.webmanifest` |
| Testes e documentação | `package.json`, `APK/package.json`, `test/paridade.test.js`, `docs/UNIFICACAO.md` |

### Evidências de teste

| Comando / cenário | Resultado |
|---|---|
| `npm test` antes das mudanças (com glob explícito, pois script original falhava em Node 22) | 217/217 |
| `node --test APK/test/*.test.js` antes da integração completa | 64/64 |
| `npm test` após alterações | 232/232 |
| `npm test --prefix APK` após alterações | 64/64 |
| Novos testes de paridade | 9 verificações de identidade dos módulos + 6 cenários de rota (3 modos × aberto/circuito). Igualdade de sequência, geometria, distâncias e metadados, excluindo apenas tempo de execução `ms` |
| `cd APK && CI=1 npx expo export --platform android --output-dir /home/user/android-export` | Bundle Hermes Android gerado, 515 módulos; artefatos fora do Git |
| `node --check public/app.js`, `git diff --check` | Sem erros |
| Servidor Web | Iniciado na porta 8094, escutando 0.0.0.0 |
| Smoke visual Playwright | Bloqueado: Chromium não instalado no ambiente; sem comparação visual executada |
| APK Gradle / emulador / dispositivo | Não executado: ambiente sem Java/SDK Android |

Os testes de paridade executam o núcleo JavaScript em Node, **não** o GPS ou a interface Android. A exportação valida resolução Metro e geração Hermes, **não** instalação de APK. Tiles externos e WFS ao vivo não foram validados nesta rede restrita. O motor em `core/` permaneceu inalterado.

### Pendências obrigatórias (não declarar concluído)

1. Navegação/GPS/desvios/chegada e simulação na UI Android usando os módulos Web existentes.
2. Coleta, residências, persistência/recuperação Android; preservar separação entre dados reais e simulados.
3. Segmentos coloridos/selecionáveis e legenda dinâmica na WebView e no fallback canvas Android.
4. Planejamento offline Web; atualmente apenas shell e coleta são offline.
5. Sincronização de coleta com API: a própria Web declara essa etapa futura, portanto requer implementação e contrato, não mera transposição.
6. Reordenação por arrasto Android, revisão de todas as ações e testes de estado obsoleto após edição.
7. Comparação visual completa (a alteração CSS é uma primeira transposição, não fidelidade visual homologada), mapa e controles em diferentes telas; captura em aparelho Android.
8. Compilar APK com Gradle, instalar e executar os mesmos cenários, inclusive perda de rede, recuperação após encerramento e GPS real.
9. Revisão de dependências: `npm install` na raiz sinalizou uma vulnerabilidade alta; não foi aplicada atualização de dependências fora do escopo sem avaliação.

**Estado: integração parcial verificável; critérios finais do pedido ainda não satisfeitos.**


## Continuação — consolidação da Etapa 1

Nesta rodada não houve novas alterações no runtime. Acrescentados `docs/AUDITORIA-COMPARATIVA.md`, `docs/INVENTARIO-UNIFICACAO.md` e `tools/inventario-unificacao.mjs`; este acompanhamento foi atualizado. A matriz detalhada distingue UI ativa, código latente, configuração declarada e recurso ausente. O inventário verificou os 20 arquivos core/server sem diferenças em relação ao commit-base. Foram reproduzidos problemas de geometria persistida e fonte de sessão recuperada, registrados sem alterar regras nesta etapa. Os próximos trabalhos devem começar pelas regressões e contratos identificados, antes de ampliar a UI.

## Continuação — regressões de coleta e circuito (Etapa 3)

### Escopo implementado nesta rodada

| Achado | Correção | Evidência / limite |
|---|---|---|
| F01 | `salvarRota` aceita GeoJSON LineString da API e mantém o esquema v1 de coordenadas em array | Teste de persistência e reabertura. Registros antigos já salvos com geometry vazia não são migrados automaticamente |
| F02 | `adota` restaura fonte, conta pontos/estimados a partir dos dados, continua numeração pela maior ordem e passa contexto à fábrica da fonte | Teste de sessão simulada recuperada. UI trava seletor da fonte enquanto ativa/pausada |
| F02 (integração) | `recuperacaoColeta.js` prepara a simulação usando o plano original na mesma versão e última posição salva; UI não substitui simulação por GPS | Quatro testes de contrato. Se plano/versão/trechos estiverem ausentes, retomada fica pausada com aviso, sem usar outro plano |
| F03 | Ponto estimado de lacuna conserva fonte simulada; leituras e registros manuais de fonte incompatível são recusados | Testes de lacuna simulada e rejeição nos dois sentidos GPS/simulação |
| F04 | Escritas automáticas/manuais/flush usam a mesma fila; lote que falha volta ao buffer, mantendo IDs e ordem | Testes com escrita bloqueada, falha transitória, novas leituras e retry, sem duplicação |
| F04 (transições) | Pausa/encerramento desligam a fonte antes do I/O; falha não declara encerramento; retry de metadados é permitido | Testes de falha persistente do lote e dos metadados. UI apresenta erros, sem promise rejection silenciosa nesses controles |
| Proteção de sessão | Não criar nova coleta por cima de uma sessão pausada | Teste de preservação do ID e quantidade de sessões |
| F08 | APK recebe flag de circuito nos cartões; limite do botão descer acompanha o núcleo; inversão bloqueada no handler e botão; limpar preserva modalidade do trajeto | Quatro testes nativos de regras do controle; comparação direta dos limites com `moverPonto`. Bundle Hermes gerado; interação visual ainda não testada |

Os seis primeiros testes novos foram executados **antes** das correções e falharam nos defeitos esperados. Depois foram adicionadas coberturas de preparação de retomada, proveniência, metadados e controles nativos. Total de novos testes nesta rodada: **13 Web + 4 APK**.

### Proteção do motor e mudanças justificadas

O conjunto original de `core/` contém tanto motor viário quanto coleta/persistência. Nesta rodada **dois arquivos de campo foram corrigidos**: `core/coleta.js` e `core/armazenamentoLocal.js`; foi adicionado `core/recuperacaoColeta.js`. Logo, a afirmação anterior de que todo `core/` está intacto vale apenas para as rodadas anteriores, não para o estado atual.

**Grafo, UTM, índice espacial, A*, WFS, ordem/TSP, roteamento com paradas, cores e todos os arquivos do servidor permanecem iguais à base.** O inventário agora distingue as três mudanças de campo por SHA-256 exato aprovado, sem liberar modificações arbitrárias nesses arquivos. O script retorna falha se encontrar diferença fora desses hashes; os novos hashes estão registrados no inventário.

### Arquivos desta rodada

- Regras de campo: `core/armazenamentoLocal.js`, `core/coleta.js`, novo `core/recuperacaoColeta.js`.
- Web: `public/coletaUI.js`, `public/sw.js` (cache v3 e novo módulo de recuperação).
- APK: `APK/App.js`, `APK/src/components/PointCard.js`, novo `APK/src/utils/controlesTrajeto.js`.
- Testes: `test/armazenamentoLocal.test.js`, `test/coleta.test.js`, novos `test/recuperacaoColeta.test.js` e `APK/test/controlesTrajeto.test.js`.
- Rastreabilidade: `tools/inventario-unificacao.mjs`, `docs/INVENTARIO-UNIFICACAO.md`, `docs/UNIFICACAO.md`, nota de status em `docs/AUDITORIA-COMPARATIVA.md`.

### Resultados

| Verificação | Resultado |
|---|---|
| `npm test` | **245/245**, zero falhas/ignorados |
| `npm test --prefix APK` | **68/68**, zero falhas/ignorados |
| `node tools/inventario-unificacao.mjs` | 101 arquivos, 21 em core/server; três mudanças de campo explicitamente aprovadas, nenhuma diferença não aprovada |
| `node --check` nos módulos de coleta/recuperação e UI | Sem erros |
| `git diff --check` | Sem erros |
| `cd APK && CI=1 npx expo export --platform android --output-dir /home/user/android-export-continuacao` | Bundle Hermes Android, 516 módulos; saída fora do repositório |

### Limites e próximos passos

- O retry retém o lote **em memória** até a transação funcionar. Não torna uma gravação que falhou resistente à morte de processo; a UI pede nova tentativa antes de fechar.
- Retomada simulada exige plano persistido e versão original; versões históricas de plano ainda não são guardadas separadamente. F06 (vínculo preciso sessão/plano) continua pendente, assim como F05 (abrir plano como estado completo do planejador).
- Recuperar distância de simulação projeta a última posição no plano salvo; os testes atuais cobrem uma rota aberta simples. Circuitos sobrepostos/recálculo exigem cenários adicionais.
- F07 (respostas obsoletas durante edição), F09–F16 e integrações de navegação/coleta Android/cartografia colorida/offline Web/sync continuam pendentes.
- Não houve teste visual, GPS real, morte real de processo, IndexedDB em navegador ou instalação de APK nesta rodada. Testes de persistência usam o adaptador transacional em memória.
- A alteração no circuito não é paridade completa do APK; apenas corrige regras dos controles que já foram integrados.

**Estado do produto: implementação parcial em andamento; não concluído.**

## Continuação — cartografia por trechos no APK (Etapa 3)

### Implementado nesta rodada

- `APK/App.js` mantém a visibilidade dos segmentos separada do resultado da rota e associada à identidade desse resultado. Uma rota nova começa com todos os segmentos visíveis; trocar de layout preserva a seleção no estado do app.
- `trechosParaMapa` adapta `legs` para a bridge com índice, rótulos, cor, geometria original, retorno e visibilidade. Usa a paleta compartilhada `core/coresTrechos.js` quando necessário; não altera distâncias, sequência nem geometria.
- Cada trecho agora é uma feature OpenLayers e um desenho independente no canvas offline. Preservados halo branco, contorno escuro, espessuras originais, marcadores e tema; o núcleo assume a cor definida pelo motor. O retorno usa tracejado `[12, 7]` nos dois renderizadores.
- Legenda e cartões do resultado permitem ocultar/exibir um trecho e restaurar todos, com identificação do retorno e estado acessível. Legenda mostra quantidade visível e limita a altura com rolagem. Seleção por toque é pelos cartões/legenda, como a referência funcional Web — não foi adicionada seleção geométrica por toque na linha.
- Ocultar/restaurar envia `fit: false`, evitando reenquadramento e sem chamar cálculo de rota. Mesmo com todos os trechos ocultos, a bridge não desenha uma rota âmbar de substituição.
- O canvas passa a atender `FIT_NETWORK` e `FIT_ROUTE`, incluindo redes MultiLineString, além de enquadrar rede/rota na carga inicial. O fallback agora desenha também o núcleo laranja tracejado dos eixos não oficiais, antes omitido.
- O painel de resultado usa `sequenciaCompleta`, exibindo a origem novamente no fechamento do circuito.
- O HTML da WebView foi extraído para módulo próprio para permitir execução direta de testes, sem carregar React Native. O código de estilo inserido na WebView é texto literal: não depende de `Function.toString()`, que não deve ser usado para transportar fonte de funções compiladas em bytecode Hermes.

### Arquivos desta rodada

- `APK/App.js`.
- `APK/src/components/RoadNetworkMap.js`, `APK/src/components/RouteResultPanel.js`.
- Novos `APK/src/map/mapHtml.js`, `APK/src/map/routePresentation.js`, `APK/src/map/styleScript.js`.
- Novo `APK/test/mapaTrechos.test.js`.
- `docs/UNIFICACAO.md`, `docs/AUDITORIA-COMPARATIVA.md`, inventário regenerado.

A extração do HTML explica a redução do componente do mapa; o renderizador não foi removido nem substituído por outra API.

### Testes e resultados

Oito testes novos verificam:

1. Adaptação sem mutar legs/geometria/distância/ordem.
2. Paleta compartilhada para pernas sem cor explícita.
3. Espessuras/halo originais e tracejado do retorno.
4. Mensagens de cor/ocultar/restaurar e ausência de reenquadramento no OpenLayers.
5. Limpeza e compatibilidade com geometria simples no OpenLayers.
6. Mensagens equivalentes no canvas, inclusive todos ocultos sem fallback indevido.
7. Limpeza e geometria simples no canvas.
8. FIT_ROUTE/FIT_NETWORK offline e desenho laranja tracejado de MultiLineString.

Os testes executam **o script efetivamente inserido no HTML da WebView**, em `node:vm`, com adaptadores falsos para DOM/OpenLayers e contexto canvas que registra comandos. Isso verifica a bridge e os comandos/estilos enviados, **não rasterização, gestos Android, acessibilidade real, posicionamento de overlays ou carregamento da CDN**.

| Verificação | Resultado |
|---|---|
| `npm test` | **245/245**, zero falhas/ignorados |
| `npm test --prefix APK` | **76/76**, zero falhas/ignorados |
| `node tools/inventario-unificacao.mjs` | 105 arquivos inventariados; 21 core/server; nenhuma diferença fora das três exceções de campo registradas anteriormente |
| Expo export Android | **Sucesso**, bundle Hermes com 519 módulos, em `/home/user/android-export-cartografia` (fora do Git) |
| Sintaxe dos scripts embutidos e `git diff --check` | Sem erros |

### Estado dos achados e limites

- M02/M03/M06: adaptação funcional dos segmentos completos à UI/bridge implementada, ainda aguardando validação visual/dispositivo.
- F10: comandos de enquadramento do canvas implementados e testados no adaptador; interação real pendente.
- M04: a especificação de estilo aceita estado atual/percorrido, mas **não há navegação nativa integrada** para produzir esses estados. Não contar isso como navegação pronta.
- Geometria parcial em erro mantém o fallback anterior de geometria única; legenda por perna de resultado parcial ainda não foi integrada.
- Método/economia da otimização ainda precisam ser apresentados no resultado nativo; a troca para sequência completa não resolve essa pendência.
- Homologação visual: conferir legenda rolável e controles em mapas pequenos, número elevado de paradas, teclado aberto, layouts e circuito com trechos sobrepostos.
- Demais pendências da auditoria permanecem: recuperação completa de plano ativo (F05/F06), respostas obsoletas (F07), persistência deep WFS, navegação/GPS/simulação/coleta Android, planejamento offline Web, sincronização de campo, PWA e build/execução de APK.

**Produto ainda em implementação; esta entrega não encerra a unificação.**

## Continuação — navegação simulada no APK (Etapa 3)

### Implementado

- Novo `mobileNavigationService.js` orquestra os **mesmos** `core/navegacao.js`, `core/instrucoes.js` e `core/simulador.js` usados pela Web. Não contém novo algoritmo de progresso, chegada, desvio, instruções ou roteamento.
- Novo painel nativo usa os tokens/componentes visuais existentes do APK. Oferece iniciar/pausar/retomar/encerrar/reiniciar, progresso, distância restante/percorrida, instrução, próxima parada, precisão simulada, paradas concluídas e mensagens de estado.
- Controles de simulação: velocidades 1/2/5/10/25/50x, ±100m, início por trecho, desvio/volta à rota, perda/recuperação de sinal e coordenadas manuais (latitude; longitude). São leituras sintéticas; não há solicitação de GPS.
- Identificação **MODO DE TESTE — posição simulada, não é GPS real** no painel e sobre o mapa, inclusive no layout Mapa. A fonte de simulação recusa leituras sem `simulado: true`.
- Bridge envia posição para marcador próprio em OpenLayers e canvas; trecho atual ganha destaque e percorridos ficam esmaecidos, sem trocar a identidade da cor nem modificar a geometria.
- Centralização explícita funciona por mensagem enviada após o mapa estar pronto; no layout Painel, abre Dividido para exibir a posição. Não foi implementado seguimento automático contínuo de câmera nesta rodada.
- Desvio confirmado usa `mobileNetworkService.calcularRotaParadas` sobre o grafo local. Mantém paradas restantes na ordem manual e, no circuito, inclui a origem original no fim da lista restante. Não troca o retorno original pelo ponto do desvio. Não instala resultado parcial/falha como rota completa.
- Recálculo atualiza o resultado/mapa sem reenquadramento automático durante a navegação. Limpa o deslocamento lateral artificial depois de instalar a nova rota, evitando aplicar repetidamente o cenário sintético à nova geometria.
- Respostas de recálculo tardias são ignoradas depois de encerrar, reiniciar, pausar/retomar ou descartar a sessão. Temporizador do simulador é liberado ao concluir/encerrar/desmontar.
- Edição de pontos/modo no APK encerra a navegação e invalida o plano; cálculo de planejamento recebe identificador de revisão, de modo que respostas anteriores não reinstalem uma rota após essa invalidação. Isso cobre parte nativa de F07; validação assíncrona de endereços e versão Web ainda precisam de revisão própria.

### Testes e resultados

**12 novos testes do serviço**: equivalência de métricas e instruções com controlador Web, chegada estável, conclusão/liberação da fonte, pausa/retomada/reinício, recálculo circular real no grafo sintético, falha sem geometria substituta, quatro casos de resposta tardia, comandos/sinal/proveniência, simulador original e recusa de rota parcial.

**4 novos testes da bridge**: posição simulada independente/removível e estilo de atual/percorrido, nos dois renderizadores. Como antes, são testes VM/adaptadores, não rasterização ou execução da WebView Android.

| Verificação | Resultado |
|---|---|
| `npm test` | **245/245** |
| `npm test --prefix APK` | **92/92** |
| Inventário | 108 arquivos; nenhuma mudança fora das três exceções de campo da rodada anterior |
| Expo export Android / Hermes | Sucesso, **524 módulos**, artefatos em `/home/user/android-export-navegacao`, fora do Git |
| Sintaxe de script WebView e `git diff --check` | Sem erros |

### Arquivos desta rodada

- Novos `APK/src/services/mobileNavigationService.js`, `APK/src/components/NavigationPanel.js`, `APK/test/navegacaoMobile.test.js`.
- Alterados `APK/App.js`, `APK/src/components/RoadNetworkMap.js`, `APK/src/map/mapHtml.js`, `APK/test/mapaTrechos.test.js`.
- Documentação e inventário atualizados.

Nenhum módulo original do motor, controlador Web, simulador Web ou instruções foi modificado nesta rodada. As correções anteriores de coleta/persistência permanecem identificadas separadamente pelos hashes aprovados.

### Pendências e limites explícitos

- **Situação histórica ao fechar a simulação:** GPS nativo ainda não estava integrado. A continuação abaixo implementa o adaptador e as permissões, mas a localização real ainda exige homologação em aparelho.
- A simulação não é coleta: não salva pontos/residências nem equivale a rastreamento de campo. Coleta e repositório nativos seguem pendentes.
- Navegação não é persistida após encerramento do processo. Não foi testada em aparelho/emulador, nem homologada visualmente com teclado/mapa pequeno/legenda/controles simultâneos.
- Reiniciar navegação recomeça o plano vigente, com controlador novo; se houve recálculo, o plano vigente é o recalculado. Não significa recuperar automaticamente todas as paradas do planejamento inicial.
- O controlador compartilhado conserva seus critérios e limitações em saltos para trechos futuros/circuitos sobrepostos. Os testes de equivalência não provam todos os cenários de uso real.
- Falha em recálculo é apresentada; nova tentativa depende de sair/retornar à rota ou novo cenário, como no controlador existente. Não foi adicionado retry infinito.
- F05/F06, demais partes de F07, atualização WFS/cache, método/economia no resultado, planejamento offline Web, sincronização e build/execução do APK continuam pendentes.

**Estado: navegação simulada integrada em código e testada no serviço/bridge; produto ainda não concluído.**


## Continuação — GPS nativo foreground (Etapa 3)

### Implementação

- `APK/src/services/nativeGPS.js`: fonte injetável, permissão foreground explícita ao iniciar, verificação de localização habilitada e acompanhamento de alta precisão. Não solicita localização ao importar o módulo ou montar a tela.
- `nativeLocation.js`: binding com `expo-location ~18.0.10` e AppState; dependência/lock, configuração Expo e permissões coarse/fine no manifesto Android atualizados. O autolinking Android identifica `expo.modules.location.LocationModule`.
- Pausar/encerrar libera assinatura, listener e watchdog. Sair do primeiro plano pausa a navegação e exige retomada manual; não há rastreamento de background ou foreground service ativo. O manifesto da dependência declara seu serviço, mas esta implementação não inicia tarefas de background.
- Negação de permissão, GPS desativado, falha de abertura, posição inválida e silêncio de 30 s produzem avisos; nunca mudam automaticamente para simulação. A posição anterior permanece visível se faltar sinal.
- Leituras aceitas são identificadas como GPS, não simulação. Rejeitam cache acima de 10 s, timestamps mais de 5 s no futuro, timestamps repetidos/fora de ordem e leituras marcadas `mocked` pelo Android. Não é detecção infalível de falsificação.
- Solicita atualizações a cada 1 s, sem distância mínima, permitindo novas leituras mesmo parado para confirmar chegada; a entrega real depende do provedor/Android. Não modifica os critérios de chegada/desvio do núcleo.
- Serviço de navegação separa modos, protege aberturas/retomadas/recálculos assíncronos contra resultados obsoletos e bloqueia comandos sintéticos no modo GPS. UI mantém identidade do APK, oferece GPS real ou Simulação, e mapa distingue GPS verde de simulação roxa.

### Verificações executadas nesta rodada

| Verificação | Resultado |
|---|---|
| `npm test` | **245/245**, sem falhas/ignorados |
| `npm test --prefix APK` | **111/111**, sem falhas/ignorados |
| Testes adicionados de GPS | 12 adaptador + 5 serviço + 2 mapa = **19** |
| Exportação Expo Android/Hermes | **602 módulos**, bundle **9,1 MB**, sucesso |
| Autolinking Android | expo-location 18.0.10 / LocationModule identificado |
| Inventário | **111 arquivos**, **21 protegidos**, **3 exceções aprovadas**, **0 fora dos hashes aprovados** |
| `git diff --check` | Sem erros |

Testes usam localização, relógio, timers e AppState injetados: permissão negada/permanente, reabertura, cancelamento durante permissão, watcher tardio removido, pausa/retomada, saída do foreground, cache/mock/duplicação, timeout e falha nativa. Serviço testa métricas equivalentes ao controlador Web, separação de proveniência, ausência de fallback, concorrência e comandos sintéticos bloqueados. Testes de mapa executam bridge em VM, não uma WebView Android real.

Arquivos novos: `nativeGPS.js`, `nativeLocation.js`, `APK/test/nativeGPS.test.js`. Alterados nesta rodada: serviço/painel de navegação, App, mapa/HTML, testes de navegação/mapa, package.json/lock, app.json, manifesto Android e documentação/inventário. **Nenhuma alteração adicional no motor de roteamento ou demais módulos core nesta rodada.**

### O que ainda não foi demonstrado

Exportação Hermes e autolinking **não são compilação Gradle nem APK instalado**. Não há evidência em aparelho/emulador de prompt Android, precisão, bateria, serviços de localização, retomada, chegada ou recálculo em deslocamento real. A sessão não é persistida após morte do processo. Coleta/persistência nativas, recuperação do planejador, demais proteções assíncronas, offline, sincronização, assinatura de release e paridade visual continuam pendentes, conforme plano e auditoria.

**Estado: mais uma integração concluída em código e testes automatizados; unificação do produto ainda não concluída.**


## Continuação — recuperação do planejamento e vínculo de coleta Web (F05/F06; F07 parcial)

### Defeitos reproduzidos antes da correção

Quatro cenários executaram funções reais de `public/coletaUI.js` da base `449746b985e23ba2517df55ae67d98751c4e168c`, com ganchos de UI injetados e armazenamento real em memória: **4 falhas de asserção antes**. O início escolhia o último plano salvo (não o ativo); plano ainda não salvo iniciava sessão sem ID; edição durante persistência não impedia vínculo obsoleto; abrir circuito salvo não atualizava `state.circuito`. Logs locais: `/home/user/plano-before.log`.

### Correções

- Novo `public/planoPersistido.js`, adaptador de integração sem cálculo de rotas: valida/copia o snapshot e normaliza GeoJSON para o esquema existente. Não altera grafo, sequência otimizada, distâncias, trechos ou geometria viária.
- `app.abrirPlanoSalvo` valida antes de mudar estado e sincroniza lista/rótulos/tipos/status de coordenadas, circuito, modo, radios, inversão, marcadores, painel, legenda, rota ativa e encerramento da navegação anterior pelo gancho existente `showRoute`.
- Abertura invalida respostas de cálculo anteriores. Cálculos concorrentes e erros antigos são descartados; edições enquanto aguarda resposta também impedem aplicá-la. Abertura de plano protege resultados de leituras antigas ou de leitura concorrente com edição.
- A rota exposta a navegação/coleta só é considerada atual enquanto a assinatura dos pontos/circuito/modo coincide com o planejamento capturado. Plano visível obsoleto impede início de coleta; não vira silenciosamente coleta GPS livre.
- Iniciar coleta com plano ativo garante primeiro sua persistência e usa **o ID/versão desse plano**. Falha de gravação impede início; edição durante o await exige nova tentativa. Coleta GPS intencionalmente sem plano continua permitida e não adota nenhum plano salvo ao acaso.
- Um plano aberto por ID preserva exatamente esse ID e versão, mesmo se houver outro registro com conteúdo igual. Se essa versão foi alterada/removida, a operação é recusada, sem vincular outra versão silenciosamente.
- Repetir Salvar para conteúdo idêntico é idempotente. Conteúdo diferente gera novo ID, versão inicial 1: não se sobrescreve o plano de sessões anteriores só porque sequência e distância coincidem. Versões de registros antigos são preservadas; não foi criado comando de revisão destrutiva.
- Simulação de coleta exige rota ativa; não escolhe mais a última rota salva como fallback. Ações encapsuladas de planejamento/início/pausa/retomada/encerramento não executam simultaneamente; erro libera o bloqueio para nova tentativa.
- `public/sw.js`: cache v4 inclui o novo módulo. Ainda não torna o cálculo via API utilizável offline.

### Resultados atuais

| Verificação | Resultado |
|---|---|
| Regressões contra a UI anterior | **4 falhas esperadas**, por asserção de comportamento |
| `test/planoPersistido.test.js` atual | **19/19**, incluindo funções reais extraídas da UI com dependências injetadas |
| `npm test` | **264/264**, zero falhas/ignorados |
| `npm test --prefix APK` | **111/111**, zero falhas/ignorados |
| Inventário | **113 arquivos**, **21 protegidos**, **3 exceções aprovadas**, **0 não aprovadas** |
| Sintaxe dos módulos Web e `git diff --check` | Sem erros |

A suíte cobre identidade de plano, geometria diferente com mesma distância/sequência, idempotência sem invalidar retomada simulada, ID explícito/versionamento, validação e cópia, hidratação de controles/estado, coleta livre versus plano obsoleto, persistência antes da coleta, concorrência de cálculo/abertura e desbloqueio após erro. Ela **não executa DOM/OpenLayers em navegador nem IndexedDB real**: armazenamento em memória e ganchos injetados continuam evidência de integração unitária, não homologação visual/offline.

Arquivos desta rodada: novos `public/planoPersistido.js` e `test/planoPersistido.test.js`; alterados `public/app.js`, `public/coletaUI.js`, `public/sw.js` e documentação/inventário. **Nenhuma nova alteração no core ou APK nesta rodada.** Exportação Hermes/autolinking reportados na seção GPS são da rodada anterior, não uma nova execução Android aqui.

F05/F06 estão corrigidos em código Web e cobertos por regressões, mas ainda exigem confirmação no navegador com persistência real. F07 permanece parcial: resolução de endereços e outros callbacks/ciclo de vida requerem revisão adicional; não se afirma que toda edição encerre automaticamente uma navegação em curso. Coleta/persistência nativas e demais pendências de offline/sync/aparelho permanecem abertas. **Produto não concluído.**


## Continuação — circuitos obrigatórios e dois botões de cálculo

### Alterações de interface (Web e APK)

- Removidos os seletores de tipo de trajeto e ordem do trajeto. Removido o controle de inversão: A permanece fixo.
- Lista inicial e Limpar deixam somente o card A, identificado como **Origem e destino**. Adicionar parada continua criando B, C, D etc.; todas as demais posições são paradas editáveis/removíveis/reordenáveis, inclusive a última. Não é criado card duplicado para o retorno a A. É necessário adicionar e resolver ao menos uma parada para calcular.
- **Calcular rota** chama explicitamente `modo: usuario, circular: true`; **Calcular rota otimizada**, imediatamente abaixo, chama `modo: otimizada, circular: true`. Enter e os recálculos automáticos do planejador usam ordem do usuário, sem reaproveitar uma seleção de otimização anterior.
- Ambos os botões ficam bloqueados durante o cálculo. A otimização não reordena nem apaga os cards: a sequência aplicada aparece no resultado e nos trechos. O retorno é incluído no objetivo e na distância calculada pelo motor original.
- Legendas passam a identificar A como origem e destino; não mostram um destino independente em vermelho. No Web, a legenda de circuito é inicializada antes da primeira rota.
- Novo contrato puro `public/planejamentoCircuito.js`, reexportado no APK, compartilha lista inicial, rótulo dos cards e opções dos dois comandos, sem duplicar regras do motor.
- Compatibilidade com planos antigos: abrir um plano não circular recupera os pontos como circuito, mas **não usa sua geometria aberta como circuito pronto**. Exige cálculo para obter o retorno pela rede. A pequena adaptação em `coletaUI.js` apenas impede anunciar/desenhar esse plano legado como ativo; não implementa recursos novos de coleta.
- Service worker v5 inclui o novo módulo. Paleta, componentes e identidade visual existentes foram mantidos.

### Evidências desta rodada

| Verificação | Resultado |
|---|---|
| `npm test` | **273/273**, sem falhas/ignorados |
| `npm test --prefix APK` | **119/119**, sem falhas/ignorados |
| Cenários compartilhados | 5 por plataforma: inicialização/limpeza, edição das paradas, comandos, rota manual e otimizada no grafo |
| Integração dos comandos | 3 testes por plataforma: bindings e execução dos handlers reais com dependências injetadas |
| Regressões de plano salvo | Atualizadas para circuito obrigatório; novo caso impede mostrar plano aberto como circuito pronto |
| Exportação Android/Hermes | **604 módulos**, bundle **9,1 MB**, sucesso |
| Inventário | **118 arquivos**, **21 protegidos**, **3 exceções históricas aprovadas**, **0 não aprovadas** |
| `git diff --check` | Sem erros |

**Navegador real:** Chromium headless com Playwright, servido pelo aplicativo em 8094. Validada inicialização com A, ausência dos seletores antigos, criação de B/C/D, legendas, cliques nos dois botões e payloads enviados à API real, manutenção dos quatro cards e Limpar retornando a um único card A. Capturas em 1440×1000 e 390×844; zero erros JavaScript nesse fluxo.

No mesmo cenário de coordenadas do snapshot viário real:

| Comando | Sequência resultante | Distância total com retorno |
|---|---|---|
| Calcular rota | A → B → C → D → A | **431,7316 m** |
| Calcular rota otimizada | A → C → D → B → A | **315,0886 m** |

Coordenadas [longitude, latitude]: A [-46.50761262, -23.71127804], B [-46.50668913, -23.7124069], C [-46.50720399, -23.71174796], D [-46.50691357, -23.71219929]. Logs/capturas locais: `/home/user/circuito-browser.log`, `/home/user/circuito-web-desktop.png`, `/home/user/circuito-web-mobile.png`. São evidências de um fluxo Web, não prova de todos os recursos nem equivalência visual com Android.

**Motor preservado:** nenhum arquivo de core/server foi alterado nesta rodada. Opções históricas, incluindo trajetos abertos e saída curta, permanecem no motor/API para compatibilidade e nas regressões de núcleo; não são oferecidas nos novos controles. Não houve mudança de algoritmo, limites de otimização, A*, geometria ou distâncias.

### Pendências sob o escopo revisado

- **Coleta de dados de localização adiada por solicitação expressa.** Não foi removido o código histórico, mas integração/persistência/coleta nativas não são a prioridade da continuação.
- APK exportado, mas sem compilação Gradle/instalação/gestos em aparelho nesta rodada. O teste Web não homologa a WebView Android.
- Demais etapas de paridade dos recursos disponíveis, proteções assíncronas restantes, offline e homologação visual continuam abertas. A conclusão destas alterações de planejamento não significa conclusão de toda a unificação.
