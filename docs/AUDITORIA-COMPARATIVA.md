# Etapa 1 — auditoria comparativa Web / APK

**Atualização de implementação:** F01–F06/F08 receberam correções de integração; M02/M03/M06 e F10 receberam adaptação da cartografia. Navegação simulada e adaptador GPS nativo foreground foram integrados em código no APK. F05/F06 agora têm hidratação centralizada no Web e vínculo por snapshot exato/ID e versão explícitos; F07 recebeu proteções parciais nas duas plataformas. GPS em aparelho, coleta nativa e homologação visual seguem pendentes. A matriz abaixo preserva o retrato histórico da auditoria. Consulte [UNIFICACAO.md](UNIFICACAO.md) para limites e resultados atuais (**273 Web / 119 APK**) e as exceções exatas de coleta/persistência na proteção do núcleo.

**Revisão de escopo posterior:** coleta de localização fica adiada. As interfaces atuais passam a oferecer somente circuitos (A como origem e destino), com **Calcular rota** para ordem do usuário e **Calcular rota otimizada** para menor distância total. Seletores de tipo/ordem e inversão saíram da UI por decisão do usuário; as capacidades do motor foram preservadas. A matriz histórica abaixo não deve ser confundida com os controles atuais. Ver evidências da rodada de circuitos em `UNIFICACAO.md`.


Data: 04/11/2026. Referência de entrada: commit `449746b985e23ba2517df55ae67d98751c4e168c`.

**APK define a aparência. Web define funcionalidades/regras.** Esta auditoria descreve a base e distingue as integrações parciais já feitas nesta branch. Não é homologação de produto, aprovação visual ou teste em aparelho.

## 1. Método, escopo e rastreabilidade

- Código ativo: todos os 18 módulos `core/`, dois serviços `server/`, HTML/CSS/JS próprios de `public/`, `APK/App.js`, quatro componentes nativos, serviço mobile, formatadores, paleta e adaptadores do núcleo. Revisão dos contratos e caminhos de execução, importações, listeners, transições de estado e persistência.
- Configurações: Metro, Expo, dependências/scripts, manifesto Android, configurações de build Gradle/EAS. Dados: ambos os snapshots; terceiros: OpenLayers local na Web e CDN no APK.
- Testes e ferramentas: inventariados separadamente; os testes Node cobrem o núcleo, não equivalem à execução do aplicativo Android.
- `updates/01...14` e README extenso contêm evolução histórica; não são outra versão ativa a integrar. Documentação não foi aceita como prova quando contradiz o código.
- Evidência mecânica: [INVENTARIO-UNIFICACAO.md](INVENTARIO-UNIFICACAO.md), regenerável com `node tools/inventario-unificacao.mjs`: 97 arquivos próprios/configurações/testes/ferramentas, situação contra a base, exports e hashes dos 20 arquivos `core/`/`server/`. Vendor não auditado internamente como código do produto.
- Evidência de execução nesta rodada: testes Node e sondagens de contrato em memória. Limites: sem Chromium, SDK/emulador, localização real ou WFS ao vivo neste ambiente. Portanto “existe” abaixo significa fluxo identificável em código, não homologação operacional.

Legenda: **UI** = acessível ao usuário; **núcleo** = serviço/algoritmo sem interface; **declarado** = comentário/configuração sem execução correspondente; **ausente** = não localizado no código ativo.

## 2. Arquitetura real e pontos de compartilhamento

### Web

`public/index.html → public/app.js → /api/network, /api/rota-paradas, /api/endereco-digital → server/index.js → NetworkService → core/graph.js + core/router.js + core/rotaParadas.js + core/ordemParadas.js`.

Navegação: `public/navegacaoUI.js → core/{navegacao,instrucoes,fonteGPS,simulador}.js`; recálculo via mesma API de rotas. Coleta: `public/coletaUI.js → core/{coleta,armazenamentoLocal}.js → adaptador IndexedDB` (fallback em memória com aviso). Nenhum endpoint de envio de coleta existe no servidor.

### Android

`APK/App.js → PointCard / RouteResultPanel / RoadNetworkMap → MobileNetworkService → grafo local + roteamento local`. AsyncStorage guarda a rede; snapshot embarcado garante carga inicial sem internet. Mapa é WebView com HTML/JS, OpenLayers via CDN; se `window.ol` não existe, usa canvas vetorial próprio. React Native não usa a Web como página principal.

`NetworkDiagnosticsPanel.js` existe, **mas não é importado/montado por App.js**. Não contar como diagnóstico acessível hoje. A aparência de referência é a tela montada por App.js; componente não montado é recurso latente a preservar, não autorização para redesenhar a tela principal.

### Compartilhável sem reconstrução arquitetural

- Motor puro, gestão dos pontos, cores, Plus Codes, otimização, navegação/instruções/simulador.
- Repositório de coleta, desde que receba adaptador transacional nativo compatível (não basta importar IndexedDB no Android).
- GPS por interface injetável: navegador usa `navigator.geolocation`; nativo precisa fonte e permissões próprias.
- Não compartilhar DOM/OpenLayers nem componentes React Native diretamente. Adaptar apresentação e transportes; manter regras no núcleo.
- WFS Android conserva montagem manual de query porque a cópia nativa evita dependência de `URL.searchParams` em Hermes. `node:fs`, `node:crypto` e HTTP Node ficam no servidor/ferramentas, não no bundle mobile.

## 3. Matriz funcional detalhada

| ID | Recurso / regra | Web na base | APK na base | Ação / estado atual |
|---|---|---|---|---|
| P01 | Origem/destino A/B, rótulos e papéis | UI, `app.js`, `pontoTrajeto.js` | UI, `App.js`, `PointCard.js` | Preservar; núcleo agora compartilhado |
| P02 | Coordenadas com ponto/vírgula, sinais e validação | Parser local no app | Parser em `utils/formatters.js` | Duplicação de parser/textos; extrair somente após testes de equivalência; não prometer detectar lat/lon locais ambíguos |
| P03 | CEP Digital curto/completo, normalização, região, status | API local → `enderecoDigital*` | Serviço local → mesma família | Preservar resolver e referência geográfica; já reexportado |
| P04 | Serviço corporativo SIGA | Adaptador com conector injetável, sem conector configurado | Mesmo contrato | **Não está conectado**; não confundir conversão local com integração corporativa |
| P05 | Escolher no mapa/cancelar/centralizar ponto | UI + marcadores | UI + bridge WebView | Preservar e testar toque/teclado/layout |
| P06 | Adicionar/excluir paradas; origem/destino fixos | UI | UI | Compartilhado; testar circuito, inclusive última parada |
| P07 | Reordenar ↑↓ e arrastar | Ambos, arrasto por HTML e atalho teclado | Apenas ↑↓ | Arrasto nativo pendente; limites dos botões nativos ainda pressupõem destino fixo |
| P08 | Inverter e limpar | UI; inversão bloqueada em circuito | UI, sem circuito na base | APK recebeu circuito, mas inversão ainda não é bloqueada; alinhar regra Web |
| P09 | Ordem manual | UI, padrão do núcleo/API | UI, única opção | Preservar sequência exata |
| P10 | Menor total, TSP exato/heurístico | UI + `ordemParadas.js` | Ausente | Núcleo/seletores integrados parcialmente; falta apresentar método/economia no resultado nativo |
| P11 | Saída curta como desempate, não outro objetivo | UI e Held-Karp específico | Ausente | Integrado no cálculo/seletores; falta explicar desempate na UI nativa |
| P12 | Circuito A→…→A, origem não duplicada em card | UI + núcleo | Ausente | Integrado parcialmente; revisar botões, mensagens, legenda e resultado |
| P13 | Falhas e trecho parcial explícitos | Erros e geometria parcial | Erros e geometria parcial | Preservar sem fabricar conexão reta |
| P14 | Estatísticas, sequência, logradouros oficiais/não oficiais | UI e nota de otimização/economia | UI com grade de estatísticas própria | Preservar formato visual APK; adicionar informações funcionais ausentes |
| P15 | Edição/reordenação durante cálculo e resultados obsoletos | Estado e resposta assíncronos sem versionamento | Mesmo risco | Corrigir integração com token/revisão; não mexer no motor |
| M01 | Rede oficial/não oficial, halo/tracejado, marcadores | OpenLayers local | OpenLayers CDN ou canvas | Preservar cartografia APK, inclusive fallback |
| M02 | Cores por trecho, retorno tracejado | UI + `coresTrechos.js` | Uma geometria âmbar | Núcleo agora retorna cores, mas bridge só envia geometry; falta integrar os dois renderizadores |
| M03 | Selecionar/ocultar trecho, sobreposições, restaurar todos | UI, legenda + cards; não altera distância | Ausente | Levar comportamento ao APK sem mudar cálculo |
| M04 | Trecho atual/percorrido em navegação | Destaque/esmaecimento, identidade da cor mantida | Ausente | Integrar estado na bridge e legenda |
| M05 | Enquadrar rede/rota, zoom, arrastar mapa | UI | UI, canvas incompleto | Preservar controles; implementar FIT_NETWORK/FIT_ROUTE no fallback |
| M06 | Legenda geral e dinâmica | UI | Geral colapsável; não dinâmica | Preservar colapso APK; acrescentar segmentos |
| M07 | Layout Dividido/Mapa/Painel | Ausente | UI, split 42%, retrato | Já transposto parcialmente à Web; falta homologação visual/responsiva |
| N01 | Iniciar/pausar/retomar/encerrar navegação | UI + controlador | Ausente | Reutilizar `navegacao.js`, criar apresentação/fonte nativas |
| N02 | GPS, precisão, rumo, velocidade, perda de sinal | Fonte navegador + vigia na UI | Sem fonte/permissões de localização | Adaptador nativo e permissões; HTTPS/segurança no navegador |
| N03 | Progresso, distância restante, próxima parada | Projeção na geometria, desambiguação por progresso | Ausente | Compartilhar controlador, não distância em linha reta |
| N04 | Chegada estável e conclusão | 3 leituras, raio e precisão | Ausente | Preservar todos os limiares e eventos |
| N05 | Desvio persistente e recálculo | 3 leituras + tolerância por precisão; API, paradas restantes na ordem manual | Ausente | Invocar mesmo roteador local no APK; não reotimizar silenciosamente |
| N06 | Instruções por geometria/logradouro | `instrucoes.js`, painel | Ausente | Levar textos/estado ao APK; não há voz/TTS a migrar |
| N07 | Seguir posição/centralizar após pan | UI | Ausente | Integrar bridge e controles |
| S01 | Simulação pela geometria e tempo | UI + `simulador.js` | Ausente | Compartilhar simulador, sinalizar MODO DE TESTE |
| S02 | Velocidades, início por trecho, ±100m, reinício/pausa | UI | Ausente | Preservar todos os controles |
| S03 | Cenários desvio/sinal/manual | UI; núcleo também permite precisão sintética | Ausente | Distinguir cenário acessível de API de teste |
| C01 | Salvar/versionar/listar/abrir plano | UI + IndexedDB | Ausente | Adaptador nativo e UI; tratar inconsistências de geometria/recuperação antes de copiar |
| C02 | Excluir plano salvo | UI existe; regra bloqueia não sincronizado | Ausente | Preservar proteção contra perda; resolver ausência de sincronização com contrato explícito |
| C03 | Iniciar/pausar/retomar/encerrar coleta | UI + `coleta.js` | Ausente | Preservar estados e gravações em fila |
| C04 | Filtros GPS | Precisão, repetição, salto, deslocamento mínimo | Ausente | Compartilhar núcleo; testes de equivalência |
| C05 | Lacuna e ponto estimado identificado | Núcleo | Ausente | Preservar identificação, corrigir proveniência em sessão simulada |
| C06 | Rastro percorrido vs plano salvo vs posição | Três camadas distintas | Ausente | Adaptar mapa nativo sem confundir plano com medição |
| C07 | Recuperar sessão interrompida | UI adota última sessão aberta, retomada manual | Ausente | Adaptar persistência; restaurar fonte/configurações corretamente |
| C08 | Capturar residência, formulário e classificação | UI: nova/corrigida/confirmada; coordenadas, precisão, Plus Code | Ausente | Implementar no APK com mesmo contrato |
| C09 | Marcar residência na posição da coleta | UI, vinculada à sessão/fonte | Ausente | Preservar fonte real/simulada |
| C10 | Possível duplicidade local | Aviso por raio 30m na captura | Ausente | Não bloquear silenciosamente; equivalência nativa |
| C11 | IDs agente/dispositivo, vínculo plano/versão | localStorage + registros | Ausente | Persistência nativa; conferir vínculo com plano efetivamente usado |
| C12 | Histórico append-only, limpeza e estados de sync | API do repositório, sem UI completa | Ausente | Preservar contrato latente; não anunciar UI inexistente |
| O01 | Abrir offline | Shell PWA após cache, não primeira visita | Snapshot/canvas no primeiro uso offline | Preservar vantagem APK e ampliar Web sem trocar motor |
| O02 | Calcular/recalcular offline no cliente | Não, depende de API; servidor pode usar snapshot sem WFS | Motor local | APK exclusivo; levar núcleo/dados ao cliente Web em etapa própria |
| O03 | Coleta e dados persistentes offline | Sim, IndexedDB; memória com aviso se indisponível | Só cache de rede hoje | Não confundir cache WFS com persistência de coleta |
| O04 | Tiles externos offline | Sem download/cache massivo | Sem tiles; canvas vetorial | Preservar limites de uso; não prometer mapa-base offline |
| W01 | WFS single/startIndex/CQL-range, retentativas e validação | Núcleo + backend | Núcleo nativo equivalente | Preservar paginação resiliente e erros |
| W02 | Refresh e verificação leve/completa | Serviço/API | Serviço + timers | Atualização da rede não é sincronização de dados de campo |
| W03 | Esquema, diagnósticos e metadados | API; UI ativa consulta diagnóstico | Serviço/componente, painel não montado | Mapear API e recursos latentes; integrar acesso nativo sem redesenho |
| W04 | Persistência da rede atualizada | Snapshot disco | AsyncStorage; deep update não grava | Corrigir caminho deep e quota/avisos |
| W05 | Notificação de mudança da rede | Backend emite eventos; UI Web faz carga inicial | App assina serviço e atualiza features | Não há push Web/SSE/poll automático de nova rede identificado |
| W06 | API remota no APK | Backend disponível | Opção `remoteApiUrl` sem consumidor | Declaração não implementada; definir necessidade, não anunciar suporte |
| A01 | Sincronização de campo | Fila local/estados, botão desabilitado; sem endpoint | Ausente | Contrato e backend novos necessários; preservar pendências offline |
| A02 | Instalação/PWA e pacote Android | Manifest/SW | Expo/Gradle/EAS | Ícones PWA ausentes; scripts APK Gradle atuais usam gradlew.bat; validar release/assinatura |

## 4. Regras do motor a proteger

Fontes: `core/{config,geo,spatialIndex,graph,router,ordemParadas,rotaParadas,coresTrechos}.js`.

- UTM 23S/EPSG:32723, distâncias métricas reais, índice espacial e topologia por geometria, interseções/toques/snaps/conectores; preservar tolerâncias de `GRAPH_DEFAULTS`, classificação de logradouro e diagnósticos.
- A* com overlay e corte de aresta por comprimento ao longo da polilinha; cópia antiga Android difere nesse corte. Manter correção Web, incluindo caminho na mesma aresta, componentes desconexas e validação de continuidade.
- Snap máximo padrão 100m nos adaptadores; pontos sem coordenadas, fora da rede ou sem caminho geram erros explícitos. Não “fechar” falha por linha reta. Conectores topológicos já existentes não são uma autorização para substituir roteamento por retas.
- Matriz obtida de `routeOnGraph`. Até **16 intermediários** usa Held-Karp; acima disso heurística vizinho mais próximo + 2-opt; otimização limitada a **80 pontos totais**. Ordem manual não tem esse limite de otimização. Não prometer ótimo global no ramo heurístico.
- Circuito fixa origem e custo de retorno; destino fixo no trajeto aberto. Saída curta é desempate no ramo exato, não muda objetivo total; ramo heurístico não chama Held-KarpSaidaCurta.
- Cores pertencem aos trechos e não mudam com ocultação/progresso. `sequenciaCompleta`, `retorno`, `comparacao`, `otimizacao.metodo`, `parcial` e erro da conexão fazem parte do contrato.
- Preservar resolução local do CEP Digital, referência de Santo André e restrição de região. Modo SIGA exige conector real, hoje não configurado.

**Integridade:** os 20 arquivos `core/`/`server/` são byte a byte iguais à base. Reexports Android já aplicados usam o motor original; não o substituem.

## 5. Achados e incompatibilidades que impedem o aceite

| ID | Evidência | Impacto / prioridade | Tratamento planejado |
|---|---|---|---|
| F01 | `armazenamentoLocal.js:salvarRota` aceita geometry apenas array; `coletaUI.js:salvarRota` passa objeto GeoJSON | Geometria concatenada salva como `[]`; desenho do plano salvo fica vazio. **Alta** | Normalizar contrato na integração, com teste de ida e volta |
| F02 | `coleta.js:adota` não restaura fonte; `coletaUI.js:recuperarAoAbrir` não restaura modo/plano do simulador | Sessão simulada pode retomar com fonte errada. **Crítica** para proveniência | Restaurar fonte, impedir mistura, reconstruir plano; testar reinício |
| F03 | `coleta.js` monta ponto intermediário de lacuna sem flag `simulado` | Estimado de sessão simulada pode ser rotulado como GPS. **Alta** | Preservar tipo estimado e fonte separadamente |
| F04 | `coleta.js:gravarBuffer` esvazia buffer antes de aguardar armazenamento; catch só avisa | Possível perda de lote em falha de escrita. **Alta** | Retenção/retry sem duplicação; testar quota e fechamento |
| F05 | `coletaUI.js:abrirRota` repõe lista, mas não sincroniza `state.circuito`, `state.modo`, radios e `rotaAtual` | Plano aberto não equivale automaticamente a plano ativo/navegável. **Alta** | Hidratação única com contrato de rota válida |
| F06 | `iniciarColeta` associa último plano salvo, não valida correspondência com plano ativo; heurística de versão só sequência/distância | Vínculo plano/versão pode ser incorreto. **Alta** | Identidade explícita do plano |
| F07 | `app.js`/`App.js` não revisionam requests; edições e respostas assíncronas | Rota/endereço antigo pode reaparecer após edição/limpeza. **Alta** | Token de revisão e invalidação da integração |
| F08 | APK `PointCard:canMoveDown` usa `totalPontos - 2`; App permite inverter circuito | Integração parcial de circuito viola limites/ origem fixa Web. **Alta**, introduzida pela integração parcial | Ajustar limites dependentes de circuito e bloquear inversão |
| F09 | `MobileNetworkService:_doCheck(deep)` muda state sem AsyncStorage; `remoteApiUrl` só no construtor | Rede atualizada pode sumir no reinício; opção remota sem efeito. **Média/alta** | Persistência única e comunicação correta de suporte |
| F10 | Canvas trata SET_*/CENTER_POINT; não FIT_NETWORK/FIT_ROUTE | Botões nativos presentes sem efeito offline. **Média** | Implementar enquadramento no fallback |
| F11 | `NetworkDiagnosticsPanel` não montado; README afirma painel | Recurso apenas latente. **Média** | Preservar arquivo; definir acesso compatível com layout existente |
| F12 | Manifest PWA cita `icon.svg`/`icon-maskable.svg`, arquivos ausentes | Instalação/identidade PWA incompletas. **Média** | Gerar ícones a partir de identidade existente, validar manifesto |
| F13 | Release Gradle usa signingConfig debug; scripts APK usam `.bat`; sem permissões GPS/dep nativa | Bundle não garante APK distribuível nem GPS. **Alta** | Build por SO, configuração de assinatura própria e fonte/permissões nativas |
| F14 | Web/App textos de saída curta e lista salva a tratam por vezes como ordem manual | Mensagem não representa modo calculado. **Média** | Textos derivados de enum comum |
| F15 | Componente WebView usa CDN e background canvas diferente; alternar layout desmonta mapa nativo | Offline precisa fallback funcional; viewport/legenda reiniciam no remount | Testar sem rede e estado de visualização, sem redesenho |
| F16 | Sem cliente/endpoints de sync; removerRota bloqueia pendente | “Excluir” não conclui para rota nova por regra deliberada, não botão quebrado | Preservar proteção, resolver junto da sincronização |

F01 e F02 foram reproduzidos em Node com repositório em memória: geometry GeoJSON persiste `[]`; sessão salva com `fonte: simulacao` apresenta `estado.fonte: gps` após `adota`. Bloqueio de exclusão pendente retorna `NAO_SINCRONIZADO`. Os demais achados são leitura de caminho de código/risco identificado, não execução em aparelho.

### Dados: mesma contagem não é mesma versão

Ambos os snapshots têm **4.545 feições**. Comparação por `properties.ID`: nenhuma geometria diferente, nenhum ID Web ausente no APK, **uma feição com propriedades diferentes**. Hashes de features ordenadas diferem; timestamps também. Não inferir paridade por contagem. Aceite deve fixar o mesmo snapshot/versionamento para comparação, sem apagar mecanismo nativo de atualização.

## 6. Referência visual e recursos exclusivos a preservar

Referências visuais normativas: `APK/App.js:styles`, `src/theme/colors.js`, `PointCard.js:styles`, `RouteResultPanel.js:styles`, `RoadNetworkMap.js` (HTML/CSS e styles nativos). Claro, fundo/painel `#ffffff`, cartão `#f6f8fa`, verde `#045127`, texto `#111827`, borda `#d0d7de`; manter logotipo original, cartão com faixa lateral, badges, tipografia/hierarquia, raio 8, padding e controles existentes. Layout mobile: cabeçalho compacto, mapa 42%, painel rolável, status fixo.

A Web tem muitos controles adicionais; devem ser adaptados ao vocabulário visual existente, não removidos para caber no APK. A primeira transposição CSS ainda não comprova fidelidade de sombras, componentes sobrepostos, estados de alerta, ícones, espaçamentos e telas grandes. Não alterar o APK para fazê-lo parecer com a Web modificada.

Exclusivos APK: primeiro cálculo offline com snapshot embarcado; WFS nativo sem CORS; fallback canvas; logo e paleta; três layouts; legenda colapsável; teclado/blurs nativos. Exclusivos Web: arrasto acessível por teclado; segmentos ocultáveis; navegação/instruções/simulação; coleta/residências e repositório local/fila; API de diagnóstico/admin; PWA. Recursos latentes: painel diagnóstico Android, modo SIGA injetável, métodos internos de histórico/limpeza. Ausentes em ambos: sync de campo real; não declarar recurso pronto.

## 7. Plano de integração refinado (Etapa 2)

1. **Congelar motor e dados de teste:** executar inventário/hashes; usar mesmo snapshot e opções; preservar todos os módulos originais. Novos adaptadores chamam os mesmos contratos.
2. **Contratos e regressões antes da UI:** reproduções para F01–F08; normalização de plano persistido, recuperação de fonte, revisão assíncrona e limites de circuito. Correções em regras só se justificadas por defeito reproduzido, com testes e registro — nunca reescrever motor.
3. **Cartografia nativa:** transmitir legs/retorno/cor/visibilidade/estado e posição para OpenLayers e canvas; preservar halo/marcadores. Testar os dois renderizadores e enquadramento offline.
4. **Fonte GPS e navegação nativas:** adaptador injetável, permissão e erros; manter núcleo `navegacao/instrucoes/simulador`. Estados e cenários iguais; sem novo algoritmo de rota.
5. **Repositório nativo de campo:** adaptador com semântica de transação/ordenação/IDs/filas; não persistir tudo num único JSON sem estratégia de falha/quota/concorrência. Integrar UI pelo padrão visual APK. Testar recuperação após morte de processo.
6. **Offline Web:** carregar grafo/snapshot local com versionamento e atualização, preferencialmente fora da thread de UI; mesmo motor e sem API substituta. Política de armazenamento, sem cache massivo de tiles externos.
7. **Sync:** especificar API, autenticação/autorização, IDs idempotentes, lote/ACK, versões/conflitos, retry, vínculo agente/dispositivo e proteção dos dados de residência. Não inventar endpoint/servidor remoto; fila só marca sincronizado após confirmação real.
8. **Visual Web e validação:** conferir lado a lado com APK original, estados completos e breakpoints; acessibilidade, teclado e legendas. Manter tela Android sem redesenho.
9. **Aceite executável:** bundle + Gradle + aparelho/emulador + browser; não tratar Node como teste Android.

Não exige substituir a arquitetura inteira: conservar Node/API, React Native e WebView, compartilhar núcleo e adicionar adaptadores nos limites de plataforma.

## 8. Cenários de aceite comuns e cobertura

| Cenário | Base de teste existente | Validação adicional obrigatória |
|---|---|---|
| Mesma aresta curva/interseção, A* vs caminho mínimo, componentes desconexas | graph/router/caminhoMinimo/fidelity | Mesmo snapshot nos dois runtimes; distância, continuidade e geometria |
| Aberta e circular; manual, otimizada, saída curta; empate e >16 intermediários | circular/ordemParadas/ordemOtimizada/otimizacaoAuditoria/paridade | Botões/cards/legendas; informação de ramo heurístico |
| Código curto/completo, inválido, fora da área; coords vírgula/ponto; mapa | enderecoDigital + ferramentas validar-paradas | Teclado/toque, retorno assíncrono após edição |
| Ocultar todos/um/restaurar; retorno sobreposto | coresTrechos + validar-trechos-coloridos | Ambos renderizadores APK, sem alterar total/ordem |
| Chegada estável, GPS impreciso/desvio oscilante, perda de sinal | navegacao.test.js | GPS real/permissão, UI/recálculo e liberação da fonte |
| Simulação pausa/retoma, velocidade, início, desvio/sinal/manual | navegacao.test.js + ferramentas | Sinalização contínua de teste e fonte em registros após recuperação |
| Salvar/abrir plano e circuito, reabrir app, adotar sessão | armazenamentoLocal/coleta + validar-offline | Geometria concatenada, plano ativo, modo e fonte, falhas de escrita |
| Residência nova/corrigida/confirmada, aviso duplicidade, marcar na coleta | coleta/armazenamentoLocal | UI, IDs/versão, campo real vs simulado |
| Atualização WFS leve/deep, indisponibilidade, cache corrupto/quota | wfs/update/API | Cache nativo após restart, Web refletindo nova versão |
| Sem API e sem rede no primeiro uso/reabertura | ferramentas offline, snapshot APK | Distinção abrir/coletar/calcular/tiles; primeiro uso Web |
| Sync com falha/retry/ACK duplicado/conflito | Não existe implementação | Testes de contrato e ponta a ponta após backend |
| Retrato/desktop, layouts, alertas, teclado, legendas | Ferramentas Playwright existentes | Capturas comparativas e testes em Android; bloqueados neste ambiente |

Os 15 testes novos de paridade verificam o núcleo reexportado em Node: nove identidades de módulos e seis combinações de rotas. Como chamam a mesma implementação, não demonstram adaptação da UI, performance Hermes nem igualdade de snapshots em produção.

## 9. Fechamento da etapa

**Etapa 1 concluída como auditoria estática comparativa do código ativo**, com inventário, fluxos, diferenças, recursos latentes/exclusivos, defeitos identificados e plano rastreável. A auditoria não promete ausência absoluta de defeitos: testes dinâmicos, visual e aparelho pertencem à Etapa 4 e continuam pendentes.

Etapa 2: plano técnico registrado acima, ainda sujeito a ajustes de implementação e definição do contrato de sync. Etapa 3: integração parcial da rodada anterior, **não avançada nesta rodada de auditoria**. Etapas 4/5: evidências parciais e pendências documentadas; produto não concluído.

### Verificação ao encerrar esta rodada de auditoria

- `node tools/inventario-unificacao.mjs`: 97 arquivos inventariados; 20 arquivos de motor/servidor protegidos; zero alterações nesses 20 arquivos.
- `npm test`: 232 aprovados, zero falhas/ignorados.
- `npm test --prefix APK`: 64 aprovados, zero falhas/ignorados.
- `git diff --check`: sem erros de whitespace.
- Nenhuma nova modificação em código de runtime nesta rodada. Build Hermes e disponibilidade da prévia foram evidências da rodada anterior; não foram apresentados como nova execução de APK nesta auditoria.
