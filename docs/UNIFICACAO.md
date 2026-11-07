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

### Dica de arraste corrigida (defeito visual reproduzido)

A pílula “Arraste as paradas **B**, **C**… no painel para mudar a ordem da rota” ficava **sempre visível**, inclusive com o trajeto contendo só A, sobrepondo o mapa — uma divergência em relação à tela do APK, que não tem esse elemento. Agora a dica:

- nasce oculta no HTML (não pisca no primeiro desenho);
- só aparece com **duas paradas ou mais** (quando há o que reordenar);
- desaparece após a primeira reordenação por arraste, setas ou botões e **não volta** naquela sessão;
- continua sendo apenas texto (`pointer-events: none`), sem interceptar cliques no mapa.

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


## Continuação — validações de endereço assíncronas (F07 parcial)

Escopo mantido: coleta de localização adiada; planejamento continua somente em circuitos, com os dois botões de cálculo. Esta rodada não adiciona recursos de coleta e não altera o serviço de CEP Digital nem o motor.

### Problemas reproduzidos e correção

Foram executados os handlers reais anteriores de Web/APK com respostas controladas: **8 falhas de asserção antes da correção**, quatro por plataforma (editar e voltar ao mesmo código, substituir por coordenada manual, duas validações fora de ordem e erro antigo depois de resposta nova). Não é apenas comparar o texto do código: ao voltar ao texto anterior, uma requisição antiga continua obsoleta.

Novo `public/revisoesEndereco.js`, reexportado por `APK/src/utils/revisoesEndereco.js`, mantém um token opaco por ponto. Cada nova validação substitui o token anterior. Edição de código/coordenada, escolha ou arraste no mapa e remoção invalidam o ponto; Limpar e encerramento da página/componente invalidam todos. No Web, abrir plano salvo também invalida as validações pendentes.

Antes de aplicar sucesso ou erro, os handlers verificam o token. Resposta descartada não altera coordenadas/status, não apresenta mensagem de erro/sucesso e não recentraliza o mapa. No APK há ainda uma verificação dentro do updater funcional de estado, incluindo existência do ponto e código atual, para não aplicar resultado que tenha ficado obsoleto enquanto a atualização aguardava processamento pelo React. A requisição de transporte não é abortada: seu resultado deixa de ter autoridade sobre a UI.

### Testes e resultados

| Verificação | Resultado |
|---|---|
| Regressões contra os handlers anteriores | **8 falhas esperadas**, todas de comportamento |
| Mesmos cenários sobre os handlers reais Web e APK | **10/10 por plataforma** |
| `npm test` | **283/283**, zero falhas/ignorados |
| `npm test --prefix APK` | **129/129**, zero falhas/ignorados |
| Expo Android/Hermes | **606 módulos**, bundle **9,1 MB**, exportação concluída |
| Inventário | **123 arquivos**, **21 protegidos**, **3 exceções históricas aprovadas**, **0 não aprovadas** |
| `git diff --check` | Sem erros |

`test/cenariosEnderecoUI.js` fornece os mesmos dez cenários para `test/enderecoUI.test.js` e `APK/test/enderecoUI.test.js`. Além dos quatro defeitos reproduzidos, verifica sucesso/erro atuais e cancelamento por mapa, remoção, limpeza e desmontagem. Os testes dos handlers injetam serviços/estado; não equivalem a executar React Native em aparelho. Os cenários de cancelamento por ciclo de vida exercitam a invalidação lógica, não o Android AppState real.

**Verificação adicional em Chromium real:** eventos de digitação, clique em Validar, seleção no mapa OpenLayers, Limpar e remoção de parada. Seis cenários passaram: coordenada manual preservada; edição que volta ao mesmo código preservada; segunda validação vence; mapa preservado; limpeza não recupera ponto antigo; remoção não recupera parada. Zero erros JavaScript. As respostas da API de endereços foram interceptadas e entregues em ordem controlada: a evidência é de concorrência da UI real, não de disponibilidade/correção de um provedor externo de CEP Digital.

Logs locais: `/home/user/enderecos-before.log`, `enderecos-focused.log`, `enderecos-web-tests.log`, `enderecos-apk-tests.log`, `enderecos-export.log`, `enderecos-browser.log`.

Arquivos: novos `public/revisoesEndereco.js`, `APK/src/utils/revisoesEndereco.js`, `test/cenariosEnderecoUI.js`, `test/enderecoUI.test.js`, `APK/test/enderecoUI.test.js`; alterados `public/app.js`, `APK/App.js`, `public/sw.js` (cache v6 inclui o novo módulo), teste de abertura de plano e documentação/inventário. **Nenhum arquivo core/server, nem implementação de coleta, foi alterado nesta rodada.**

### Limites e próximos pontos

F07 continua parcial: estes testes cobrem a resolução de endereços, não todos os fluxos de edição durante navegação/recálculo, nem a homologação completa do ciclo de vida nativo. F09 (persistência da atualização WFS), diagnósticos, mapa/remontagem/offline, demais recursos disponíveis e execução do APK em aparelho continuam pendentes. **Unificação ainda em andamento; coleta de localização segue adiada.**


## Continuação — persistência da atualização WFS no APK (F09)

### Falha reproduzida

A verificação profunda alterava o grafo em memória, mas não gravava o snapshot em AsyncStorage. A mesma regressão foi executada sobre a classe anterior (extraída do arquivo original, com dependências nativas substituídas por adaptadores): **1 falha esperada**, zero gravações onde deveria haver uma. Não é evidência de falha no motor; é uma falha de integração entre atualização e cache.

### Implementação

- `mobileNetworkService.js` passa a ser um binding nativo pequeno, mantendo classe, singleton e export de fingerprint existentes. A implementação do ciclo de vida foi movida para `mobileNetworkServiceCore.js`, com AsyncStorage/snapshot/WFS injetáveis. As dependências padrão continuam sendo o cliente WFS nativo, o snapshot embarcado e os mesmos módulos de grafo/roteamento/endereço. Não foi criado um motor alternativo.
- Refresh explícito, atualização profunda e atualização disparada por mudança de contagem usam uma única rotina de aplicação/persistência. O grafo continua sendo construído pelo `buildGraph` original.
- Snapshots vazios, com contagem total incompatível ou sem arestas válidas são recusados antes de substituir a rede atual. Cache ilegível/inválido mantém sua cópia em disco intacta e tenta o snapshot embarcado; o problema fica explícito em metadados e aviso de tela.
- Ao reabrir, um snapshot WFS salvo recebe fonte **`wfs-cache`**, não “WFS ao vivo”. A ausência normal de cache no primeiro uso não é apresentada como erro.
- Falha de gravação não derruba a rede recém-carregada em RAM. O metadado de cache fica **`memory-only`** e um aviso no painel do APK informa que a atualização não foi salva para a próxima abertura. Nova verificação profunda sem mudança de conteúdo também tenta novamente a gravação pendente.
- Tokens de requisição descartam respostas antigas; uma fila serializa as gravações aceitas, evitando que escrita antiga termine depois da mais nova e a sobrescreva. Rejeição não bloqueia as operações seguintes.
- `allowWfs: false` impede refresh/verificação e o fallback de download quando não existe rede local válida. Não cria grafo fictício para simular sucesso offline.
- Corrigida a promessa documental de `remoteApiUrl`: a opção histórica não tinha delegação implementada. Metadados agora informam `supported: false` e execução local, mesmo quando a opção está preenchida. **Nenhuma delegação remota foi implementada nesta rodada.**

### Evidências

| Verificação | Resultado |
|---|---|
| Regressão executada sobre serviço anterior | **1 falha esperada**, por ausência de gravação |
| Nova suíte `APK/test/mobileNetworkService.test.js` | **14/14** |
| `npm test` | **283/283**, sem falhas/ignorados |
| `npm test --prefix APK` | **143/143**, sem falhas/ignorados |
| Exportação Android/Hermes | **607 módulos**, bundle **9,11 MB**, sucesso |
| Inventário | **125 arquivos**, **21 protegidos**, **3 exceções históricas aprovadas**, **0 não aprovadas** |
| `git diff --check` | Sem erros |

Os testes exercitam grafo e roteador originais, com armazenamento e transporte injetados: primeira abertura offline, aplicação/gravação profunda e reinício, rota circular na rede recuperada, refresh/verificação leve, quota/retentativa, quatro formas de cache inválido, rejeição de payload WFS inválido sem destruir a rede/cache anteriores, resposta obsoleta, serialização de escritas, falha de transporte e nova tentativa, WFS desativado, fallback sem snapshot e metadados de execução remota não suportada.

O teste de reinício cria uma **nova instância do serviço** sobre o mesmo adaptador de armazenamento, desativa WFS e calcula A → B → A com a geometria recuperada; **não mata/reabre um processo Android real**. AsyncStorage/SQLite, limite de quota e renderização do aviso ainda precisam de teste em aparelho. As respostas WFS são fixtures controladas, não consultas ao GeoServer nesta rodada. A suíte Web foi reexecutada como regressão; o cache móvel não implica que o Web passe a calcular rotas offline.

Arquivos desta rodada: novo `APK/src/services/mobileNetworkServiceCore.js` e `APK/test/mobileNetworkService.test.js`; alterados binding `mobileNetworkService.js`, `APK/App.js` para o aviso de cache, e documentação/inventário. Logs: `/home/user/cache-before.log`, `cache-focused.log`, `cache-web-tests.log`, `cache-apk-tests.log`, `cache-export.log`.

**Nenhum arquivo de core/server ou implementação de coleta foi alterado nesta rodada.** F09 tem correção de persistência e declaração explícita do limite remoto em código/testes; integração remota não passou a existir. Acesso ao painel de diagnósticos (F11), offline/remontagem do mapa (F15), outros fluxos assíncronos e homologação do APK permanecem pendentes. **Coleta de localização segue adiada e a unificação continua em andamento.**


## Continuação — acesso ao diagnóstico da rede no APK (F11)

O componente `NetworkDiagnosticsPanel.js`, antes existente mas não montado, agora é acessível nas visualizações **Painel** e **Dividido**, abaixo do resultado da rota. Não foram alterados os modos de circuito nem os botões de cálculo; coleta permanece adiada.

### Integração e comportamento

- `App.js` monta o componente existente, preservando suas seções/contadores e a paleta do APK. O controle de assinatura, carregamento inicial, comandos e liberação foi extraído para `networkPanelService.js`, sem duplicar regras de rede/roteamento. O serviço de rede continua o responsável por grafo, cache, ordenação de atualizações e WFS.
- O painel recebe fonte, feições, estratégia, cache, atualização automática, último check/mudança, erros recentes e contadores efetivos do grafo. **Verificar atualizações** solicita verificação profunda; **Baixar do GeoServer** usa o refresh completo. Ambos ficam bloqueados durante operação manual/inicial; trava síncrona também impede dois toques antes da atualização de estado React.
- Falha inicial não fica em um spinner permanente: mostra erro e permite tentar carregar novamente. Falha de atualização conserva a rede anterior e permite nova tentativa.
- `networkPresentation.js` distingue snapshot, cache WFS e “WFS — carregado nesta sessão”. Nenhuma fonte é apresentada como prova de conectividade atual. Exibe persistência/erro de quota, limite remoto não suportado e até cinco erros recentes fornecidos pelo serviço.
- O diagnóstico é expansível e expõe nós, arestas, cruzamentos, toques, snaps, conectores, fusões, duplicidades, componentes e tempo de construção já produzidos pelo motor. Botões e expansão recebem papéis/estados de acessibilidade; avisos usam os tokens de cor existentes, inclusive contraste de texto compatível com o tema claro.
- Descartar o controlador remove listener e para timers; sucesso/erro tardios não atualizam a UI nem iniciam novos timers. Não aborta o HTTP já iniciado ou reverte uma persistência válida do serviço. Alternar para layout **Mapa** apenas oculta o painel: o controlador vive no componente raiz, não no ScrollView condicional.
- Atualizações automáticas renovam os dados do painel sem reescrever continuamente a barra de status com uma mensagem antiga. O cálculo de uma rota já exibida não é refeito silenciosamente ao atualizar a rede; novos cálculos usam a rede atual.
- Metadados do serviço passam a declarar atualização automática desativada se `allowWfs` estiver desligado, coerente com os timers/consultas.

### Evidências desta rodada

| Verificação | Resultado |
|---|---|
| Testes novos de controlador/apresentação | **13/13**, incluindo integração com grafo/cache originais |
| Testes do JSX real com primitivas RN/hooks injetados | **6/6** |
| `npm test` | **283/283**, sem falhas/ignorados |
| `npm test --prefix APK` | **162/162**, sem falhas/ignorados |
| Exportação Android/Hermes | **610 módulos**, bundle **9,12 MB**, sucesso |
| Inventário | **129 arquivos**, **21 protegidos**, **3 exceções históricas aprovadas**, **0 não aprovadas** |
| `git diff --check` | Sem erros |

Controlador: carregamento, assinatura, comandos profundos/refresh, duplicação de toques, erro inicial e retry, erro de atualização, sucesso/erro tardio após descarte, retirada de listeners/timers, assinatura única e dados automáticos. Integração usa o serviço real para mostrar grafo e falha de quota, tentar gravar de novo e reabrir uma nova instância offline com fonte `wfs-cache`.

Componente: JSX original transpilado pelo Babel do APK, com `View/Text/TouchableOpacity`, hooks e estilos injetados; verifica carregamento, erro/retry, fonte/cache/quota/limite remoto, bloqueio de comandos, expansão dos contadores e ligação do painel em App. **Não é uma renderização React Native/Android real, screenshot, gesto, leitor de tela ou homologação visual.** Transporte/armazenamento continuam controlados nos testes; a exportação não instala APK.

Arquivos desta rodada: novos `networkPanelService.js`, `networkPresentation.js`, `APK/test/networkPanel.test.js`, `APK/test/networkPanelRender.test.js`; alterados `APK/App.js`, `NetworkDiagnosticsPanel.js`, metadado de atualização em `mobileNetworkServiceCore.js`, `APK/README.md` e documentação/inventário. Logs: `/home/user/painel-focused.log`, `painel-web-tests.log`, `painel-apk-tests.log`, `painel-export.log`.

**Nenhum arquivo core/server nem implementação de coleta foi alterado nesta rodada.** F11 está integrado em código e testado com as limitações acima. Mapa/offline/remontagem (F15), demais fluxos assíncronos e homologação Android continuam abertos. **Produto ainda não concluído; coleta de localização segue adiada.**


## Continuação — ciclo de vida do mapa e inicialização offline (F15 parcial)

### Alterações

- `App.js` não desmonta mais `RoadNetworkMap` ao escolher **Painel**. O contêiner torna-se absoluto/invisível, mantém dimensões positivas e deixa de consumir espaço do painel. Não recebe toques e sai da árvore de acessibilidade enquanto oculto. A WebView permanece em memória por decisão explícita de preservar câmera/estado.
- `RoadNetworkMap` usa uma referência estável para a fonte HTML, evitando tratá-la como uma nova fonte em cada render. A legenda mantém o estado React ao trocar layout. Uma nova mensagem `MAP_READY` ressincroniza as camadas se houver recarga efetiva da WebView.
- Novo `mapSync.js` controla somente a ponte de apresentação: rede, marcadores, rota, segmentos, posição e comandos. Alternar visibilidade ou redimensionar não pede fit nem reenvia uma rede inteira sem mudança. Atualização WFS não reposiciona uma câmera já inicializada.
- Nova rota planejada continua sendo enquadrada; se for calculada com mapa oculto, o fit é adiado até ficar visível. Ocultar trecho ou recalcular durante navegação não reposiciona a câmera. Limpar uma rota cancela seu fit pendente.
- Comandos explícitos Rede/Rota/Centralizar funcionam mesmo se emitidos antes de a WebView estar pronta/visível: fica pendente o comando mais recente. Uma centralização solicitada por prop e cancelada enquanto oculta não volta depois para uma posição antiga. A centralização explícita tem prioridade sobre o enquadramento automático.
- Protocolo `RESIZE_MAP`: OpenLayers chama `updateSize`; Canvas redimensiona/redesenha sem refazer o enquadramento, preservando centro e escala. `SET_NETWORK` aceita `fit: false`, como `SET_ROUTE` já aceitava.
- O script OpenLayers deixa de bloquear o HTML: carregamento assíncrono com prazo nominal de **3 s**, fallback imediato em erro. CSS também é anexado dinamicamente quando o OpenLayers chega, sem bloquear o Canvas. Uma biblioteca que chegue após o fallback não troca o motor nem apaga sua apresentação.
- Fundo Canvas ajustado ao branco do tema APK, preservando cores/tracejados dos eixos, trechos e posições. Nenhum grafo, distância, otimização ou geometria viária foi recalculado pela apresentação.

### Testes desta rodada

| Verificação | Resultado |
|---|---|
| Focados do mapa | **34/34** (14 anteriores + **20 novos**) |
| Novos cenários | 10 sincronização; 4 componente com hooks/RN injetados; 6 bridge/boot/Canvas em VM |
| `npm test` | **283/283**, sem falhas/ignorados |
| `npm test --prefix APK` | **182/182**, sem falhas/ignorados |
| Expo Android/Hermes | **611 módulos**, bundle **9,13 MB**, sucesso |
| Inventário | **132 arquivos**, **21 protegidos**, **3 exceções históricas aprovadas**, **0 não aprovadas** |
| `git diff --check` | Sem erros |

Os testes de sincronização usam os mesmos objetos de dados ao ocultar/mostrar e verificam ausência de fit/reenvio indevidos; cobrem rota nova oculta, navegação, fila de comandos, cancelamento, camadas após nova sessão e limpeza. O JSX real do componente é transpilado com as ferramentas do APK, mas hooks, primitivas RN e WebView são injetados: verifica retenção da fonte/ref/legenda, resize e remontagem de camadas. **Não executa a hierarquia nativa Android nem prova o comportamento de opacity/acessibilidade em aparelho.**

**HTML real em Chromium:** três cenários passaram — CDN abortado (Canvas), CDN pendente além do prazo (Canvas) e OpenLayers carregado (biblioteca/CSS servidos pela cópia vendor local de teste). Foram enviados rede/trecho com retorno, centralização, pan e resize; medidos centro e deslocamento geográfico por pixel antes/depois, sem perda de câmera/escala. No OpenLayers também foi aplicado zoom com wheel antes do resize. No caso de atraso, o script foi liberado depois para confirmar que não houve segundo `MAP_READY` nem troca para outro motor. Zero erros JavaScript nos três cenários. Não foram baixados tiles nem dependências remotas reais nesta verificação.

O teste Chromium executa o HTML utilizado pelo APK, não o componente `react-native-webview` em Android; a troca de layout nativo é coberta apenas pelo componente com hooks injetados e pela política de sincronização. Isso amplia a evidência de apresentação offline, mas não é homologação visual/gestual do APK.

Arquivos desta rodada: novo `APK/src/map/mapSync.js`, `APK/test/mapSync.test.js`, `APK/test/mapRender.test.js`; alterados `APK/App.js`, `RoadNetworkMap.js`, `mapHtml.js`, `mapaTrechos.test.js`, README e documentação/inventário. Logs: `/home/user/mapa-focused.log`, `mapa-browser.log`, `mapa-web-tests.log`, `mapa-apk-tests.log`, `mapa-export.log`. Capturas locais: `/home/user/map-canvas-offline.png`, `map-canvas-timeout.png`, `map-openlayers.png`.

### Limites mantidos

- Canvas continua sendo fallback vetorial, sem tiles/base OSM offline e sem equivalência completa de zoom/pinch/gestos com OpenLayers. Centro/escala são preservados, mas esta rodada não acrescenta gestos de zoom ao Canvas.
- Manter a WebView oculta usa memória; impacto de bateria/memória, layout, rotação, leitor de tela e eventual descarte do processo de renderização precisam de aparelho. Uma recarga da WebView repõe os dados, mas não promete recuperar a câmera perdida por morte do processo nem a sessão após encerrar o app.
- O CDN continua sendo usado para OpenLayers na operação normal; apenas deixou de ser requisito bloqueante para o fallback local. Não há cache/download em massa de tiles.
- Web não ganhou cálculo offline: permanece dependente da API para calcular rotas. Demais fluxos assíncronos e paridade visual/funcional completa ainda estão pendentes.

**Nenhum arquivo core/server ou implementação de coleta foi alterado nesta rodada. Coleta de localização segue adiada. Unificação ainda em andamento.**


## Continuação — resultado de otimização e rótulos comuns (F14)

### Paridade de apresentação

O APK ainda não mostrava o método de otimização/economia disponíveis na nota do Web. Novo `public/resumoRota.js`, reexportado no APK, agora fornece uma única apresentação para a nota Web e para `RouteResultPanel`. Usa exclusivamente modo, método, comparação e sequências entregues pelo motor: não calcula uma nova rota nem refaz custos/otimização.

- Distingue ordem do usuário, otimizada e o modo histórico saída curta. Método exato/Held-Karp, seu desempate e heurística são identificados a partir do valor recebido; **heurística explicita ausência de garantia de ótimo global**. Método trivial não é chamado Held-Karp e método desconhecido não é inventado.
- Economia em metros/percentual é formatada de forma consistente nas duas plataformas. Comparação ausente/inválida fica explicitamente indisponível; não se transforma em economia zero. Valor negativo é apresentado como distância maior que a ordem do usuário, não como ganho.
- Corrigida uma regressão de texto no Web: comparar `sequenciaUsuario` fechada com `sequencia` aberta fazia o A final parecer uma mudança de ordem em empate. O novo resumo normaliza apenas a repetição de fechamento antes da comparação de rótulos. Arredondar economia pequena para zero não a torna empate exato.
- O resultado nativo mantém métricas, cards/cores dos trechos, retorno, ocultação e logradouros existentes; acrescenta a nota compacta com os tokens de tema do APK.
- A lista de planos já salvos no Web reutiliza o rótulo correto do modo, inclusive saída curta. Esta alteração é **somente texto da lista existente**, não avanço na coleta ou sincronização adiada. Não reintroduz seletores antigos: continuam apenas os dois botões de circuito.
- Service worker v7 inclui o módulo comum.

### Verificações

| Verificação | Resultado |
|---|---|
| Regressão da nota anterior sobre fechamento do circuito | **1 falha esperada**, por mensagem incorreta de ordem alterada |
| Novos testes | **17/17**: 6 cenários comuns por plataforma, 2 hooks Web reais, 3 JSX de resultado nativo |
| `npm test` | **291/291**, sem falhas/ignorados |
| `npm test --prefix APK` | **191/191**, sem falhas/ignorados (contagem daquela rodada; a atual é 195) |
| Exportação Android/Hermes | **613 módulos**, bundle **9,13 MB**, sucesso |
| Inventário | **138 arquivos**, **21 protegidos**, **3 exceções históricas aprovadas**, **0 não aprovadas** |
| `git diff --check` | Sem erros |

Asserções cobrem rótulos, método, não mutação dos resultados, comparação inválida, sinal/zero/arredondamento, fechamento do circuito e erro de rota não apresentado como otimização bem-sucedida. Testes JSX usam hooks/primitivas RN injetados, **não renderização Android real**.

**Navegador real + API local real, usando coordenadas do snapshot:** quatro cenários Web passaram sem erros JavaScript: manual; otimizada com método exato e economia **117 m (27,0 %)** na precisão exibida; empate com ordem realmente alterada; circuito de duas posições para o qual o motor não fornece método/comparação. Neste último, a UI declarou os dados indisponíveis, sem inventar metadados ou modificar o comportamento do motor. O texto no DOM foi comparado ao resumo comum em cada cenário.

Os registros de plano existentes não persistem todos os metadados de otimização/comparação; abrir um plano histórico pode continuar mostrando informação indisponível. Não foi alterado o esquema de persistência para simular que esses metadados existiam.

Arquivos novos: `public/resumoRota.js`, reexport `APK/src/utils/resumoRota.js`, `test/cenariosResumoRota.js`, `test/resumoRota.test.js`, `APK/test/resumoRota.test.js`, `APK/test/routeResultRender.test.js`. Alterados: `public/app.js`, rótulo em `public/coletaUI.js`, `public/sw.js`, `RouteResultPanel.js`, README e documentação/inventário. Logs: `/home/user/resumo-before.log`, `resumo-focused.log`, `resumo-browser.log`, `resumo-web-tests.log`, `resumo-apk-tests.log`, `resumo-export.log`.

**Nenhum arquivo core/server, algoritmo de otimização ou implementação de coleta foi alterado nesta rodada.** F14 recebeu resumo comum e regressões; confirmação visual em aparelho, demais fluxos assíncronos, gestos Canvas e paridade completa ainda estão pendentes. **Coleta continua adiada; unificação ainda em andamento.**


## Continuação — identidade/recursos da instalação Web (F12)

### Correção

O manifesto ativo apontava para `icon.svg` e `icon-maskable.svg` inexistentes; o favicon embutido usava outra arte. Foram criados quatro PNGs a partir do **logotipo original do APK**, sem recortar o brasão, redesenhar ou trocar paleta:

| Arquivo | Uso | Dimensões |
|---|---|---|
| `public/icons/icon-192.png` | Manifesto `any` e favicon | 192 × 192 |
| `public/icons/icon-512.png` | Manifesto `any` | 512 × 512 |
| `public/icons/icon-maskable-512.png` | Manifesto `maskable` | 512 × 512 |
| `public/icons/apple-touch-icon.png` | Ícone Apple | 180 × 180 |

O logo mantém proporção, é centralizado sobre branco e fica inteiro. Na variante maskable, o retângulo da arte fica dentro do círculo seguro de raio 40% da imagem; pixels fora desse círculo foram verificados como brancos. O formato horizontal do logo foi preservado, não convertido em símbolo quadrado novo: avaliação de legibilidade do atalho real segue pendente.

O manifesto agora usa o nome do APK, nome curto SIGA-Rotas e descrição do fluxo de circuitos, sem prometer cálculo Web offline/coleta homologada. `index.html` aponta favicon e Apple para os novos arquivos. O worker **v8** inclui manifesto e os quatro ícones; mantém a exclusão de API/dados e recursos externos. Nenhum novo mecanismo de persistência ou cálculo foi adicionado.

`npm run gerar:icones:pwa` executa `tools/gerar-icones-pwa.mjs`, usando o Playwright já existente. Lê somente a arte do APK e grava os PNGs em `public/icons/`. Requer Chromium do Playwright ou `PWA_CHROMIUM_PATH`; não é executado no servidor nem altera o APK. Os arquivos gerados são versionados. Versões diferentes do Chromium podem rasterizar/comprimir de forma ligeiramente diferente; não se promete reprodução byte a byte entre browsers.

### Evidências

| Verificação | Resultado |
|---|---|
| Teste contra o manifesto anterior | **1 falha de asserção esperada**: ícone PNG exigido não declarado |
| Novos testes PWA | **8/8**, metadados, dimensões PNG, pixels/área segura, origem do logo, precache e fallback offline |
| `npm test` | **299/299**, sem falhas/ignorados |
| `npm test --prefix APK` | **191/191**, sem falhas/ignorados (contagem daquela rodada; a atual é 195) |
| Exportação Android/Hermes | **613 módulos**, **9,13 MB**, sucesso; hash do bundle igual ao da rodada anterior |
| Inventário | **140 arquivos próprios de código/configuração**, **21 protegidos**, **3 exceções históricas aprovadas**, **0 não aprovadas** |
| `git diff --check` | Sem erros |

**Chromium real + servidor local real:** `Page.getAppManifest` e `Page.getInstallabilityErrors` retornaram listas de erros vazias. Os quatro PNGs retornaram HTTP 200 com MIME `image/png` e bytes iguais aos arquivos do repositório. Após concluir o precache, a conexão foi desativada: manifesto e ícones foram recuperados pelo worker, imagens decodificadas nas dimensões declaradas e a interface foi recarregada com o card A. Zero erros JavaScript (`pageerror`). Falhas esperadas de acesso à API offline não são tratadas como cálculo offline funcionando.

O teste confirma recursos/requisitos no Chromium utilizado; **não instalou efetivamente um atalho no sistema operacional, não valida Safari/iOS nem Android nativo**, tampouco a apresentação do ícone no launcher. Instalação pode exigir HTTPS, contexto de aba principal e ação do usuário. Primeiro acesso totalmente offline, sem cache prévio, não está coberto nem prometido.

Os PNGs não entram na tabela mecânica de exports do inventário; são quatro assets pequenos adicionais (cerca de 104 KiB no total). Fonte original do APK e cópia do Web continuam byte a byte idênticas. SHA-256 dos assets:

```text
c1ef577ccaab4f23f2cfee114a796a44935dfd60419add1de982907fde74fd67  apple-touch-icon.png
55305d4e1cf43449401c6e5e077f6cc15bdeec46527fcc8ad479b2a1e6484faa  icon-192.png
f629ae92074412bf39200a4669a762ee997f531a0b6d4c17c39f8479ad685973  icon-512.png
82ed500059e321254e8fdfe902416355cc66c61207c83bdc836c21371a1c844f  icon-maskable-512.png
```

Código/configuração alterados nesta rodada: manifesto, favicon/Apple no HTML, lista/cache-version do worker, script npm de geração. Novos: gerador, `test/pwa.test.js` e os quatro PNGs; README e documentação atualizados. Logs: `/home/user/pwa-before.log`, `pwa-browser.log`, `pwa-web-tests.log`, `pwa-apk-tests.log`, `pwa-export.log`.

**Nenhum arquivo core/server, regra de rota, componente nativo ou implementação de coleta alterado nesta rodada. Coleta segue adiada e a unificação permanece parcial.**


## Continuação — zoom e interação no mapa offline (F10/M05 parcial)

### Problema reproduzido

No fallback Canvas usado quando o CDN do OpenLayers falha ou atrasa, só era possível **arrastar** e tocar. Não havia roda do mouse, pinça nem controles `+/−`, e `CENTER_POINT` apenas mudava o centro — sem a aproximação que o OpenLayers aplica ao centralizar um ponto. O mapa continuava tecnicamente utilizável, mas oferecia menos controle do que o mapa vetorial e o zoom por gesto não existia offline.

### Correção

- **Zoom ancorado no ponteiro:** o ponto geográfico sob o cursor/dedo permanece fixo; a escala é reaplicada ao centro para não “escorregar” a rede.
- **Mesma faixa do OpenLayers:** a conversão usa a relação de resolução do EPSG:3857 (`111319,49 / 156543,03`) e limita o zoom a 5–21, em vez de inventar uma escala incompatível. Os enquadramentos de rede/rota também respeitam esses limites.
- **Roda do mouse e pinça:** a roda usa `deltaY` com `preventDefault`; a pinça acompanha dois ponteiros, amplia/reduz pela razão das distâncias e desloca pelo centro entre os dedos. Pinça e arraste não geram `MAP_CLICK`; toque simples continua selecionando o ponto.
- **Controles `+/−`:** div própria do Canvas, oculta, exibida apenas quando o fallback está ativo. Mantém a posição (12 px, canto superior direito), o tamanho de 36 px, fundo branco, borda `#d0d7de`, raio 6 e verde `#045127` dos botões do OpenLayers, com rótulos acessíveis “Aproximar/Afastar mapa”.
- **Centralizar igual ao mapa vetorial:** `CENTER_POINT` aproxima até o zoom 17 quando o mapa está mais afastado e não afasta quem já está mais perto.
- Nenhum motor, rota, distância, cor, camada ou tile foi alterado. O Canvas continua **sem tiles do OSM offline**, sem rotação, inércia, teclado ou todos os controles do OpenLayers.

### Evidências

| Verificação | Resultado |
|---|---|
| Testes novos contra o módulo anterior (`HEAD`) | **4/4 falham**, incluindo a ausência de roda/pinça e o zoom ao centralizar |
| `APK/test/mapaTrechos.test.js` | **24/24** focados, incluindo limites de zoom e área segura dos botões |
| `npm test` | **299/299** |
| `npm test --prefix APK` | **195/195** |
| Exportação Android/Hermes | **613 módulos**, **9,14 MB**, sucesso |
| Inventário | **140 arquivos próprios**, **21 protegidos**, **3 exceções aprovadas**, **0 não aprovadas** |
| `git diff --check` | Sem erros |

**Chromium real:** o HTML do mapa foi servido com o CDN bloqueado. Com o fallback ativo, a roda do mouse reduziu a distância entre dois cliques na metade (razão **0,50**), o botão `−` dobrou (**2,00**) e a pinça sintética aproximou pela metade (**0,50**), sem gerar `MAP_CLICK` e sem erros JavaScript. Os controles estavam visíveis. A regressão dos três cenários anteriores (CDN abortado, CDN pendente e OpenLayers servido localmente) continuou preservando centro e escala após pan e resize, com zero erros.

Esses resultados são do Chromium; não são gestos físicos em WebView/Android nem comprovam a aparência no aparelho. A pinça foi simulada por `PointerEvent`, e não há rasterização da WebView. Tiles do OSM offline, rotação, inércia e navegação por teclado continuam ausentes no fallback.

Arquivos alterados nesta rodada: `APK/src/map/mapHtml.js`, `APK/test/mapaTrechos.test.js`, README, `APK/README.md`, documentação. Nenhum arquivo `core/`/`server/`, regra de rota ou implementação de coleta foi alterado. Logs: `/home/user/mapa-zoom-{web-tests,apk-tests,export}.log`, `/home/user/mapa-zoom-regressao.log`; script de navegador `/home/user/browser-check/check-canvas-zoom.cjs`; screenshot `/home/user/map-canvas-zoom.png`.

**Coleta de localização segue adiada; a unificação continua parcial.**


## Continuação — layouts responsivos e reordenação por teclado (M07/P07 parcial)

### O que foi verificado

Os três layouts da Web (**Dividido**, **Mapa** e **Painel**) foram medidos em Chromium real, em **1280×800** e **390×844**, com a rede viária carregada do servidor local:

| Verificação | Desktop | Celular |
|---|---|---|
| Dividido: mapa × painel | 900×743 / 380 px | 390×354 / 390×433 |
| Painel: mapa oculto, painel inteiro | sim | sim |
| Mapa: painel oculto, mapa em toda a largura | sim | sim |
| Canvas reajustado e **não remontado** | sim | sim |
| Câmera preservada ao voltar ao Dividido | desvio 0 px | desvio 0 px |
| Rede redesenhada sem reenquadrar | mesmos 49.371/2.705 px | idem |
| Rolagem horizontal | nenhuma | nenhuma |

Também foram conferidas as larguras **320, 360, 390, 768, 900, 1024 e 1440 px**: sem rolagem horizontal e com o mapa/painel ocupando o esperado em cada faixa. No celular o mapa fica com **42%** da altura, o mesmo valor de `mapAreaSplit` do APK.

### Defeito reproduzido na Web

A alça de reordenação é um `span` com `role="button"` e `tabindex="0"`, portanto recebe foco e é anunciada como botão. Mas o tratamento de teclado só reconhecia **Enter** no contêiner de pontos: as setas não reordenavam nada e **Enter na alça executava o cálculo da rota**, produzindo “Resolva o Endereço Digital…” em vez de mover a parada. O rótulo prometia “use também os botões subir e descer”, mas não o atalho de teclado.

### Correção

- **↑ / ↓** na alça focada movem a parada uma posição, usando a **mesma** regra do arraste e dos botões (`moverPontoPara`, em `core/pontoTrajeto.js`). A origem continua fixa e a lista é renumerada; a rota é recalculada quando o trajeto está completo.
- Ao chegar ao limite, o foco permanece e o rodapé informa “A parada já está no limite da ordem do trajeto.”, sem alterar a lista.
- Depois da reordenação, o **foco volta para a alça da mesma parada** (o contêiner é redesenhado).
- **Enter/Espaço na alça não calculam mais a rota**; o Enter nos campos e botões continua com o comportamento anterior.
- `aria-label`/`title` passaram a citar as setas. Nenhum limite, cor, regra de motor, arraste existente ou botão ↑↓ foi alterado. O APK não ganhou arraste nativo nesta rodada.

### Evidências

| Verificação | Resultado |
|---|---|
| Versão anterior da alça (só Enter, sem setas) | Falha em **“seta desce a parada”** no Chromium |
| Versão anterior da dica (sempre visível) | Falha em **“com uma parada ainda não há o que reordenar”** |
| Teste de navegador da reordenação | **Aprovado**: dica oculta → visível com 2 paradas → oculta após reordenar; linha B desce, foco acompanha, ↑ desfaz, ↑ no limite avisa, Enter não calcula, 0 erros |
| `npm test` | **299/299** |
| `npm test --prefix APK` | **195/195** |
| Inventário | **140 arquivos**, **21 protegidos**, **3 exceções**, **0 não aprovadas** |
| `git diff --check` | Sem erros |

Arquivos alterados: `public/app.js`, `public/index.html`, `README.md`, `docs/AUDITORIA-COMPARATIVA.md`, `docs/UNIFICACAO.md`. Nenhum arquivo `core/`/`server/`, componente nativo, regra de rota ou coleta foi alterado. Script de navegador: `/home/user/browser-check/check-reordenacao.cjs` (aceita `SIGA_URL`); layout: `/home/user/browser-check/check-layout.cjs`. Logs: `/home/user/{layout-browser,reordenacao-browser,reordenacao-antes-dica,reordenacao-antes-teclado,reordenacao-web-tests,reordenacao-apk-tests}.log`.

**O arraste nativo no APK, a homologação em aparelho, os tiles offline do Canvas e a coleta de localização continuam pendentes. Unificação ainda parcial.**


## Continuação — toque no trecho do mapa no APK (M03)

### Lacuna

No Web, clicar num trecho da rota o oculta (e clicar de novo o mostra), o que resolve sobreposições; no APK só era possível fazer isso pela legenda e pelo cartão do trecho. O toque no mapa era usado apenas para selecionar um ponto e, sem seleção, era ignorado.

### Implementação

- A mensagem `MAP_CLICK` da WebView passou a levar o **zoom** (OpenLayers e Canvas) junto de `lon`/`lat`.
- Novo módulo puro `APK/src/utils/trechoNoMapa.js`: distância ponto–segmento em metros (projeção local equiretangular), tolerância de **8 px convertidos em metros** pelo zoom, limitada a **3–60 m** (12 m quando a mensagem não traz zoom). Só trechos **visíveis** são candidatos; empate é decidido pelo menor índice; `LineString` e `MultiLineString` são aceitos; geometrias inválidas são ignoradas.
- `RoadNetworkMap`: com `pickingPoint` ativo, o toque continua definindo o ponto; sem seleção, chama `onMapClick`.
- `App`: o toque oculta o trecho mais próximo visível e informa no rodapé; tocar de novo mostra. Não recalcula, não reordena, não muda distância, cor ou legenda. Um toque longe de qualquer trecho não faz nada.

### Evidências

| Verificação | Resultado |
|---|---|
| Testes novos contra o código anterior | **3/3 falham** (sem zoom, sem alternância por toque, sem o helper) |
| Novos testes | **9** (7 do módulo + 1 da WebView + 1 do Canvas) |
| `APK/test/trechoNoMapa.test.js` | **7/7**, incluindo zoom alto/baixo, sobreposição, oculto, `MultiLineString` e geometria inválida |
| `npm test` | **299/299** |
| `npm test --prefix APK` | **204/204** naquele momento (**208/208** após o F13) |
| Exportação Android/Hermes | **614 módulos**, **9,15 MB** |
| Inventário | **142 arquivos** naquele momento (**143** após o F13), **21 protegidos**, **3 exceções aprovadas**, **0 não aprovadas** |
| `git diff --check` | Sem erros |

**Rota real da API** (A→B→C→A, 3 pernas, 3.114,28 m): toque exatamente na geometria devolve a perna 0 com distância 0 e tolerância **8,75 m** no zoom 17; desvio de 15 m e de 40 m não devolve trecho; com a perna 0 oculta, o mesmo toque também não devolve nada. O cálculo da rota não participa deste caminho.

**Chromium real (após reinstalar o navegador via pacote npm):** o HTML do mapa foi servido com o CDN bloqueado (Canvas) e com o OpenLayers vendorizado localmente. Nos dois motores o clique devolveu `lon=-46.5`, `lat=-23.7` e **zoom 17**; arrastar **não** gerou `MAP_CLICK`; zero erros JavaScript.

Limites: a ponte foi verificada em Chromium e o cálculo do trecho em Node com a geometria real do servidor; **não é toque físico na WebView/Android**, nem homologa a sensação de tolerância em tela. O valor de 8 px segue o `hitTolerance` do Web, mas pode precisar de ajuste após teste em aparelho. A construção do APK (Gradle/assinatura) continua fora deste ambiente.

Arquivos: `APK/src/utils/trechoNoMapa.js` (novo), `APK/App.js`, `APK/src/components/RoadNetworkMap.js`, `APK/src/map/mapHtml.js`, `APK/test/trechoNoMapa.test.js` (novo), `APK/test/mapRender.test.js`, `APK/test/mapaTrechos.test.js`, READMEs e documentação. Logs: `/home/user/trecho-{web-tests,apk-tests,export,antes}.log`; script de navegador `/tmp/br/check-clique-map.cjs` (Chromium de `@sparticuz/chromium` + `playwright-core` instalados fora do repositório).

**Coleta de localização segue adiada; unificação ainda parcial.**


## Continuação — build multiplataforma e assinatura do APK (F13 parcial)

### Defeitos reproduzidos na configuração

- `apk:debug` e `apk:release` chamavam `gradlew.bat` diretamente: **quebravam no Linux/macOS**.
- O `gradlew` versionado não tinha permissão de execução (modo 644).
- O release usava a **chave de debug**, sem caminho para um keystore próprio; `*.keystore` está no `.gitignore`, então o `android/app/debug.keystore` também não é versionado e precisa ser recriado por `expo prebuild`.
- Nada disso foi compilado nesta sessão: **não há JDK nem Android SDK** no ambiente.

### Alterações

- Novo `APK/scripts/gradle.mjs`: escolhe `gradlew.bat` (Windows) ou `gradlew` (Linux/macOS), repassa argumentos, mantém shell apenas no Windows e explica a falha quando falta JDK/SDK. `SIGA_GRADLE_DRY=1` imprime o comando; sem tarefa, sai com código 2.
- `package.json` do APK passa a usar `node scripts/gradle.mjs assembleDebug|assembleRelease`.
- `android/app/build.gradle`: `signingConfigs.release` e o `buildTypes.release` leem `android/keystore.properties` quando existir; **sem o arquivo, o release continua usando a chave de debug** (comportamento anterior preservado). `android/keystore.properties` foi incluído no `.gitignore`.
- `gradlew` recebeu permissão de execução.
- README do APK documenta o wrapper, o keystore e a limitação de não publicar com a chave de debug.

### Evidências

| Verificação | Resultado |
|---|---|
| Testes do wrapper (`APK/test/gradleLauncher.test.js`) | **4/4** |
| Modo de conferência | `{"cwd":"…/APK/android","executavel":"./gradlew","argumentos":["assembleRelease"]}` |
| Sem tarefa | mensagem de uso e código **2** |
| Scripts npm | sem `gradlew.bat`; caminhos `node scripts/gradle.mjs …` |
| Configuração de assinatura | lida por teste: propriedades, fallback debug e `.gitignore` do keystore.properties |
| `npm test --prefix APK` | **208/208** |
| `npm test` | **299/299** |
| `npm run apk:release` no Linux | alcança o `gradlew` (antes falhava no `.bat`); o Gradle para em `JAVA_HOME is not set` |
| Inventário | **143 arquivos**, **21 protegidos**, **3 exceções**, **0 não aprovadas** |
| Exportação Hermes | **614 módulos**, **9,15 MB** |

**O que não foi demonstrado:** `gradlew assembleRelease` de verdade, geração/validação de keystore, assinatura do APK, instalação e publicação. Sem JDK 17 e Android SDK, o wrapper só foi executado em modo de conferência. O README agora diz isso explicitamente.

Arquivos: `APK/scripts/gradle.mjs` (novo), `APK/test/gradleLauncher.test.js` (novo), `APK/package.json`, `APK/android/app/build.gradle`, `APK/.gitignore`, `APK/README.md`, documentação. Nenhum arquivo `core/`/`server/`, regra de rota ou coleta foi alterado.

**Coleta de localização segue adiada; unificação ainda parcial.**
