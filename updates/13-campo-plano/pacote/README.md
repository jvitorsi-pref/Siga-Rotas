# Rodada 13 — Coleta de campo: persistência local (FASE 1 e FASE 2 do plano)

> **Objetivo desta rodada:** transformar o motor de roteamento em uma base
> para **mapeamento territorial colaborativo** — o agente de saúde planeja
> uma rota, percorre o território, registra o trajeto real e cadastra a
> localização de residências, **funcionando sem conexão** e sincronizando
> depois.
>
> **O que foi entregue agora:** o diagnóstico do projeto existente, o plano
> de evolução em 7 fases e a **primeira etapa funcional**: persistência
> local (IndexedDB) de rota planejada, sessão de coleta GPS e localização
> de residência, com recuperação após recarregar o aplicativo.
>
> **O que NÃO foi entregue (e por quê):** a API de sincronização, a revisão
> visual dos trajetos, a validação/publicação de novos caminhos e a
> integração deles ao roteador são as fases 4 a 7. Nenhuma delas é
> declarada como pronta, porque não existem.

---

## 1. Diagnóstico do projeto existente (FASE 1)

### 1.1 O que já existe e foi reaproveitado

| Componente | Onde | Como foi usado |
|---|---|---|
| Motor de roteamento a pé (A*/Dijkstra sobre grafo) | `core/router.js`, `core/graph.js` | **inalterado** — o cálculo de rota continua igual |
| Ordem otimizada (Held-Karp) e ordem do usuário | `core/ordemParadas.js`, `core/rotaParadas.js` | **inalterado** — os dois modos seguem idênticos |
| Fonte de GPS real (Geolocation API) | `core/fonteGPS.js` | **reaproveitada** na sessão de coleta (mesma fonte, mesma permissão, mesmos erros) |
| Plus Code / Endereço Digital | `core/enderecoDigital.js` | **reaproveitado** — o código é calculado **localmente**, sem rede e sem serviço externo |
| Distâncias em metros | `core/geo.js` (`haversine`) | **reaproveitada** para medir o trajeto percorrido |
| Lista de pontos (rótulos A, B, C…) | `core/pontoTrajeto.js` | **reaproveitada** para restaurar uma rota salva no painel |
| Interface OpenLayers + navegação ativa | `public/app.js`, `public/navegacaoUI.js` | **mantidas** — a coleta é mais um painel, não uma reescrita |
| API HTTP + GeoServer | `server/index.js`, `core/wfs.js` | **inalterados** — nenhuma rota de cálculo foi tocada |

**Nenhuma dependência nova** foi adicionada: nem biblioteca de mapas, nem
de geocodificação, nem de ORM, nem de framework. O único pacote novo é o
Playwright, que já era dependência de desenvolvimento (validadores de
navegador).

### 1.2 O que **não** existe no projeto (lacunas reais)

1. **Não há banco de dados nem camada de dados de aplicação.** O servidor
   (`server/index.js`) só serve arquivos estáticos e três rotas de cálculo
   (`/api/route`, `/api/rota-paradas`, `/api/endereco-digital`) sobre o
   grafo montado em memória a partir do snapshot do GeoServer. Não há
   tabelas, não há migração, não há repositório persistente.
2. **Não há autenticação nem autorização.** Nenhum endpoint exige
   credencial; `Access-Control-Allow-Origin: *` está liberado. Isso **tem
   de mudar** antes de qualquer dado de agente de saúde circular.
3. **Não há qualquer noção de usuário/agente.** Não existe "quem coletou".
4. **Não há cliente de sincronização nem fila** no aparelho.
5. **Não há camada de mapa offline.** O mapa-base é `ol.source.OSM()`
   (tiles da internet, com a política de uso da comunidade OSM) e a rede
   viária vem do servidor — sem rede, **não há cálculo de rota**.

### 1.3 Riscos e dependências

| Risco | Onde | Como está tratado |
|---|---|---|
| Dados de saúde no aparelho (LGPD, aparelho compartilhado/perdido) | §9 | Etapa 1: **nenhum dado de paciente** é gravado — só geografia e metadados; a separation patient/geography está desenhada no registro (§4.4) |
| Sem autenticação no servidor | §6 | A API de sincronização **não foi criada** de propósito: ela só deve nascer junto com a autenticação (etapa 4) |
| Sem banco de dados | §6 | A camada de persistência local é **independente** do servidor: os registros carregam um id gerado no aparelho e um estado de sincronização — o servidor poderá gravá-los em qualquer backend (Oracle do SIGA, PostgreSQL ou outro) |
| Armazenamento do aparelho pode encher | §5 | Erro de cota com mensagem clara (`descreverErroArmazenamento`), aviso na interface e **nada é apagado** antes da confirmação do servidor |
| Navegador em modo privado | §5 | Fallback para armazenamento em memória + aviso explícito de que os dados não sobreviverão ao recarregamento |
| Rastreamento em segundo plano | §3 | O navegador **não** garante GPS em background: a coleta é explícita, o watcher é liberado ao pausar/encerrar e a limitação está documentada (§3.6) |
| Licenças de mapa/tiles | §7 | Nenhum download massivo de tiles foi implementado; o Service Worker **não** cacheia `/api/*` nem tiles externos |

---

## 2. Plano de evolução (7 fases)

Cada fase é entregue e validada **separadamente**. O estado atual é
marcado.

| Fase | Entrega | Estado |
|---|---|---|
| **1 — Diagnóstico e plano** | Levantamento do que existe, lacunas, riscos, plano | ✅ **esta rodada** |
| **2 — Persistência offline** | Rota planejada, sessão GPS e localizações gravadas no aparelho, com recuperação | ✅ **esta rodada** |
| **3 — Interface de coleta** | Iniciar/pausar/retomar/encerrar, ver o trajeto real no mapa, recuperar coleta interrompida, registrar residência | ✅ **parcial** — o painel e a recuperação estão prontos; falta o "modo de revisão" (§5) |
| **4 — API e sincronização** | Endpoints de sincronização, autenticação, idempotência, lotes, retentativas, conflitos | ⏳ pendente |
| **5 — Revisão dos trajetos** | Tela para o responsável ver, corrigir, aprovar ou rejeitar trajetos coletados | ⏳ pendente |
| **6 — Validação e publicação** | Comparar trajetos com a rede, gerar segmentos candidatos, aprovar, publicar em camada própria | ⏳ pendente |
| **7 — Integração ao roteador** | Os segmentos aprovados entram no grafo (camada separada, nunca misturada com a oficial) | ⏳ pendente |

### 2.1 Arquivos previstos por fase (o que já existe hoje está marcado)

**Fase 2 (entregue)** — novos:
`core/armazenamentoLocal.js` · `core/coleta.js` · `test/armazenamentoLocal.test.js` ·
`test/coleta.test.js` · `tools/validar-offline.mjs` · `public/sw.js` ·
`public/manifest.webmanifest` · `public/icon.svg` · `public/icon-maskable.svg`

alterados: `public/index.html` · `public/app.js` · `public/styles.css` ·
`server/index.js` (MIME do manifesto) · `package.json` (script de validação)

**Fase 4 (proposta — a implementar, com decisão do servidor)** — novos:
`core/sincronizacao.js` (cliente, lotes, retentativas) ·
`server/coletaService.js` (persistência no servidor) ·
`server/autenticacao.js` (identidade do agente) ·
`test/sincronizacao.test.js`

alterados: `server/index.js` (rotas) · `core/config.js` (endereço da API) ·
`public/coletaUI.js` (envio) · `public/index.html` (botão de sincronizar)

**Fase 5/6 (proposta)** — novos:
`server/validacaoCaminhos.js` (comparação com a rede, geração de candidatos) ·
`public/revisaoUI.js` (tela de aprovação) · `core/caminhosColetados.js` (formato
do segmento candidato) · `data/caminhos.aprovados.geojson` (camada publicada)

**Fase 7 (proposta)** — alterados: `core/graph.js` (fonte de eixos
aprovados, **separada** da oficial) · `core/wfs.js` (leitura da camada nova)

---

## 3. Rastreamento do trajeto real — como foi implementado

### 3.1 A sessão de coleta (`core/coleta.js`)

Estados: `inativa → ativa ⇄ pausada → encerrada`.

Cada leitura do GPS passa por filtros **explícitos** (nada é inventado):

| Situação | Regra | Efeito |
|---|---|---|
| Coordenada inválida | fora de ±90/±180 | descartada, contada |
| Baixa precisão | `accuracy` > 50 m (configurável) | descartada, contada, informada |
| Repetição | < 3 m em menos de 5 s | descartada, contada |
| Salto de GPS | > 120 m **e** velocidade implícita > 12 m/s (≈43 km/h) | descartado, avisado |
| Deslocamento mínimo | < 1,5 m | não grava ponto novo |
| Perda de sinal | silêncio > 30 s | sessão marcada como "sinal perdido" + aviso |
| Lacuna | na volta do sinal, se `estimarLacunas` | grava um ponto **`tipo: 'estimado'`**, `motivo: 'lacuna'` — **nunca como medido** |

Cada ponto gravado leva: `id`, `ordem`, `sessaoId`, `latitude`, `longitude`,
`precisao`, `rumo`, `velocidade`, `timestamp`, `horario` (ISO), `tipo`
(`medido`/`estimado`) e `motivo`.

O trajeto é desenhado no mapa em **verde-azulado**, separado da rota
planejada (que mantém as cores por trecho) e da rota salva recuperada
(**roxa tracejada**).

### 3.2 Gravação imediata

O ponto é gravado no aparelho **assim que é aceito** (não só no fim da
sessão): uma queda do aplicativo não custa o trajeto já percorrido. As
gravações são enfileiradas para que duas transações do IndexedDB nunca
disputem a mesma loja.

### 3.3 Recuperação

Ao abrir o aplicativo, as sessões **ativas/pausadas** encontradas no
armazenamento são oferecidas como "coleta interrompida". O controlador
**adota** a sessão (`coleta.adota(id)`): é a **mesma** sessão, com os
mesmos pontos e com a numeração continuando — o botão "Retomar" segue de
onde parou.

### 3.4 Modo de teste (posição simulada) — como na navegação

A coleta tem as **duas** fontes de posição, exatamente como a navegação
ativa:

| Fonte | O que é | Como se marca |
|---|---|---|
| **GPS real** | a localização do aparelho | — |
| **Simulação** | posição **fictícia**, calculada sobre a geometria da rota (`core/simulador.js`, o mesmo módulo da navegação) | aviso permanente **“MODO DE TESTE — a posição registrada é SIMULADA”**, e **cada ponto gravado** carrega `fonte: 'simulacao'` e `simulado: true` |

A separação é feita em **três lugares**, para que um trajeto de teste
nunca possa ser confundido com uma medição de campo:

1. a **sessão** grava a origem (`fonte: 'gps' | 'simulacao'`);
2. **cada ponto** grava a sua origem;
3. a interface mostra o aviso enquanto a simulação está ativa.

No modo de teste o simulador oferece: pausar/retomar, reiniciar, avançar e
retroceder 100 m e a velocidade (1× a 50×). A simulação **precisa de uma
rota** (a atual ou a última salva no aparelho) — sem plano não há o que
percorrer, e a interface diz isso em vez de simular um caminho inventado.

Uma regra do filtro de GPS foi ajustada para o modo de teste: o filtro de
**salto** (deslocamento impossível para uma caminhada) **não** se aplica
à posição simulada, porque lá o salto é intencional (o botão “avançar
100 m”). Os demais filtros (repetição, deslocamento mínimo, perda de
sinal) continuam valendo — por isso o painel mostra, por exemplo, “49
descartados” numa simulação lenta.

### 3.5 Marcar a residência durante o trajeto

O botão **“Marcar residência aqui”** (visível durante a coleta) grava a
**posição atual** como a localização da residência que o agente está
visitando:

* coordenadas, precisão e **Plus Code** (calculado localmente);
* ligada à **sessão de coleta** (`sessaoId`), de modo que a localização
  fica no mesmo rastro do trajeto;
* classificação (`nova` / `corrigida` / `confirmada`) e observações;
* sem posição ainda ⇒ a ação é **recusada** com a explicação
  (`SEM_POSICAO`), sem gravar registro vazio.

Funciona nos dois modos: no GPS real, marca onde o agente está; no modo de
teste, marca a posição simulada (e o registro fica marcado como
simulado).

### 3.6 Limitações reais do rastreamento (documentadas, não escondidas)

* **Não há rastreamento em segundo plano garantido.** O navegador só
  entrega posição com a aba visível; em iOS e em Android com economia de
  bateria, o watcher é interrompido pelo sistema. A coleta foi feita para
  funcionar **com o aplicativo aberto na mão** — o que, na prática de
  visita domiciliar, é o caso normal.
* A precisão do GPS em rua estreita e com prédios altos é ruim: por isso
  existe o limite de 50 m e o registro da precisão **de cada** ponto.
* O ponto estimado de lacuna **não** substitui medição: ele existe para
  não quebrar a linha do trajeto e está marcado como tal.
* O `watchPosition` do navegador entrega no ritmo que puder: o intervalo
  real varia de 1 s a vários segundos.

---

## 4. Localização de residências e Plus Code

### 4.1 Captura

Botão "Capturar posição atual" → `getCurrentPosition` (uma única leitura, sem
ficar assistindo) → o formulário mostra **latitude, longitude, precisão
estimada e o Plus Code**; o agente pode **corrigir** qualquer campo antes de
salvar e **repetir** a captura.

### 4.2 Plus Code

Calculado **localmente** por `core/enderecoDigital.js` (Open Location Code,
alfabeto `23456789CFGHJMPQRVWX`) — sem rede, sem serviço externo de
geocodificação, sem custo.

> O Plus Code **identifica o lugar**; ele **não** comprova que o endereço
> oficial foi validado. A interface diz isso ao lado do formulário, e a
> classificação (`nova` / `corrigida` / `confirmada`) é explícita.

### 4.3 Duplicidade e histórico

Antes de salvar, a nova localização é comparada **localmente** com as já
gravadas (raio de 30 m): havendo uma a poucos metros, a interface avisa e
pede confirmação. Cada alteração relevante fica no **histórico** da
localização (`historico[]`, com data e valores anterior/novo).

### 4.4 Separação entre dado do paciente e dado geográfico

O registro de localização **não** tem campo de paciente, prontuário ou
identificador de pessoa: é `{latitude, longitude, precisão, Plus Code,
classificação, sessão, agente, dispositivo, histórico}`. A vínculo com o
paciente é responsabilidade do sistema de atendimento (que não existe
ainda) — quando existir, ele referencia o `id` do registro de localização,
sem misturar os dois mundos. Nenhum dado de paciente é gravado no
aplicativo nesta fase.

---

## 5. Armazenamento offline

### 5.1 Onde

`core/armazenamentoLocal.js` — IndexedDB com 5 lojas:

| Loja | Conteúdo |
|---|---|
| `rotasPlanejadas` | rota salva (pontos, sequência, pernas, geometria, versão) |
| `sessoes` | sessões de coleta (estado, agente, rota usada, versão, contadores) |
| `pontos` | pontos GPS (índice por `sessaoId`) |
| `residencias` | localizações (com histórico) |
| `operacoes` | fila de sincronização (uma entrada por registro alterado) |

### 5.2 Garantias

* **Transações atômicas**: cada gravação é uma transação do IndexedDB; se
  algo falha, nada fica pela metade (o teste "transação atômica — falha não
  deixa registro pela metade" cobre isso).
* **Estados**: `pendente → sincronizando → sincronizado | erro`. O estado
  vive no registro **e** na operação da fila.
* **Nada é apagado antes da confirmação**: `removerRota()` recusa uma rota
  que não esteja `sincronizado`, e `limpar()` só apaga o que o servidor já
  confirmou.
* **Idempotência**: cada registro e cada operação recebem um id gerado **no
  aparelho** (`rta_…`, `ses_…`, `pto_…`, `res_…`, `op_…`); reenviar o mesmo
  registro não cria duplicata (a fila de operações é única por
  registro+tipo).
* **Cota/erro**: `descreverErroArmazenamento()` traduz "espaço
  insuficiente" e "armazenamento bloqueado" para mensagens claras.
* **Modo privado**: fallback para memória, com aviso explícito de que os
  dados **não** sobreviverão ao recarregamento.

### 5.3 Service Worker / PWA

`public/sw.js` (network-first) guarda apenas o **esqueleto** do
aplicativo. `/api/*` **nunca** é cacheado (a rede tem vários MB e muda com
frequência; e duplicar dados coletados no cache do navegador seria um
problema de privacidade). `public/manifest.webmanifest` + ícones SVG
permitem a instalação na tela inicial.

### 5.4 O que continua disponível sem conexão

| Funcionalidade | Offline |
|---|---|
| Abrir o aplicativo | ✅ (esqueleto em cache) |
| Salvar/recuperar rota planejada | ✅ |
| Coletar o trajeto real (GPS) | ✅ |
| Registrar localização de residência | ✅ |
| Ver e recuperar coleta interrompida | ✅ |
| **Calcular** rota nova | ❌ (precisa do grafo, que está no servidor) |
| Ver o mapa-base | ⚠️ só se o tile já estiver no cache do navegador — **não** é garantido |
| Sincronizar com o servidor | ❌ (etapa 4) |

---

## 6. Sincronização com a API — por que ela **não** foi feita agora

A API atual não tem **nenhum** mecanismo de persistência nem de
identidade. Criar `/api/sincronizacao` agora produziria um endpoint que
recebe dados de agente de saúde **sem autenticação** — o oposto do que a
LGPD e a instrução "não invente endpoints antes de inspecionar o que já
existe" pedem.

O que **está pronto** para a etapa 4:

* a fila de operações (`operacoes`), com estado e tentativas;
* os ids gerados no aparelho (chave de idempotência);
* `marcarEstadoRegistro()` e `atualizarOperacao()` (as transições de
  estado);
* a regra de "não apagar antes de confirmar";
* os ganches `online`/`offline` na interface.

Quando a autenticação existir, a etapa 4 será: endpoints idempotentes
(`POST /api/coleta/sincronizar` com lote + confirmação **por registro**),
autenticação do agente, retentativa com espera progressiva e resolução
explícita de conflitos (estratégia proposta: **última versão vence para o
mesmo registro**, com o histórico preservado no servidor; para registros
editados em aparelhos diferentes, o conflito é **reportado**, não
sobrescrito silenciosamente).

---

## 7. Processamento dos caminhos coletados (fases 5 e 6 — ainda não existe)

O que está garantido **desde já** (e evita problemas futuros):

* o trajeto bruto fica **separado** da rede oficial (nada é gravado no
  snapshot do GeoServer);
* os pontos guardam a precisão e marcam as estimativas;
* a comparação com a rede será feita **no servidor**, com o mesmo grafo do
  roteador;
* os segmentos candidatos terão origem, data, versão e estado de
  validação próprios;
* a publicação será em **camada geográfica separada**, e a rede oficial
  **só** será alterada por decisão humana explícita.

Nada disso está implementado ainda — está escrito aqui para que a etapa 6
não misture dado de campo com dado oficial.

---

## 8. Segurança e privacidade (o que foi feito nesta etapa)

* **Nenhuma credencial** é gravada no IndexedDB (nem senha, nem token).
* **Nenhum dado de paciente** é gravado: só geografia e metadados.
* O identificador do agente é **local e anônimo** (`agente_…`), até que
  exista autenticação no servidor (etapa 4) — então passa a ser o usuário
  autenticado.
* A comparação de duplicidade é **local**: nada da lista de localizações
  sai do aparelho.
* O Plus Code é calculado **no aparelho**: nenhum serviço externo de
  geocodificação recebe as coordenadas.
* O Service Worker **não** cacheia `/api/*`: dados coletados não são
  duplicados no cache do navegador.
* **Risco que permanece** (e precisa de política): o armazenamento do
  navegador é legível por qualquer script da mesma origem e sobrevive ao
  fechamento do aplicativo. Para aparelho compartilhado, o procedimento
  recomendado é: sincronizar, descartar os dados locais
  (`limpar({somenteSincronizados:true})`) e bloquear o aplicativo com o
  bloqueio de tela do próprio celular. A política de descarte seguro e de
  encerramento de sessão é da etapa 4/5, junto com a autenticação.

---

## 9. Ferramentas e custos

* **Reaproveitadas**: OpenLayers 10.6.1 (já vendorizado), Geolocation API,
  IndexedDB, Service Worker, PWA, o `haversine` e o Plus Code do próprio
  projeto. **Nenhuma dependência nova** (o Playwright já era dev).
* **Licenças**: o projeto é MIT; o OpenLayers é BSD-2; os tiles do
  OpenStreetMap são usados pela API pública do OSM (a política exige uso
  responsável — **não** há download massivo aqui); o GeoServer é do
  município.
* **Custos que existem** (não são zero):
  * hospedagem do servidor Node (uma VM pequena basta; a rede atual já é
    carregada em memória, ~1 s por carga);
  * dispositivos dos agentes (celular com GPS — o gargalo real);
  * armazenamento por aparelho (limitado; a cota é um risco real);
  * manutenção: a rede viária muda e o snapshot precisa ser atualizado;
  * **futuro**: um banco de dados para os dados coletados (etapa 4) e
    armazenamento de tiles para uso offline (etapa 7, com autorização do
    provedor).

---

## 10. Arquivos desta rodada

**Novos**
* `core/armazenamentoLocal.js` — IndexedDB + fila + transações
* `core/coleta.js` — sessão de coleta, filtros de GPS, Plus Code local,
  **modo de teste** (fonte simulada) e marcação de residência
* `test/armazenamentoLocal.test.js` — **13 testes**
* `test/coleta.test.js` — **24 testes** (inclui o modo de teste e a marcação de residência)
* `tools/validar-offline.mjs` — validação no navegador (22 conferências)
* `public/sw.js`, `public/manifest.webmanifest`, `public/icon.svg`,
  `public/icon-maskable.svg`
* `updates/13-campo-plano/imagens/painel-modo-teste.png` — o painel no
  modo de teste, com o aviso, os controles e a residência marcada

**Alterados**
* `public/index.html` — painel "Coleta de campo", manifesto, versão do cache
* `public/app.js` — cria a interface de coleta, registra o Service Worker,
  expõe `renderizarPontos`/`ajustarEnquadramento`
* `public/styles.css` — estilos do painel de coleta
* `server/index.js` — MIME `application/manifest+json`
* `package.json` — script `validar:offline`
* `README.md` — §23

**Não alterados (de propósito)**: `core/router.js`, `core/graph.js`,
`core/ordemParadas.js`, `core/rotaParadas.js`, `core/wfs.js`,
`core/config.js`, `core/navegacao.js`, `core/fonteGPS.js`,
`core/enderecoDigital.js`, `core/pontoTrajeto.js` e todo o resto do
roteamento. **Nenhuma funcionalidade foi removida.**

---

## 11. Como validar

```bash
npm test                  # 202 testes (165 anteriores + 13 + 24 novos)
npm run validar:offline   # validação no navegador (22 conferências)
npm run validar:otimizacao # o roteamento continua igual (regressão)
npm run auditar:otimizacao  # auditoria numérica da otimização
```

O validador de navegador (`tools/validar-offline.mjs`) **desliga a rede**
no meio do caminho e prova que: a rota salva sobrevive ao recarregamento, a
coleta acumula pontos sem servidor, a coleta interrompida é recuperada e
retomada **na mesma sessão**, e a localização de residência fica gravada
com Plus Code.

### Resultados reais desta rodada

| Verificação | Resultado |
|---|---|
| `npm test` | **202/202 PASSING** |
| `npm run validar:offline` | **VALIDAÇÃO OFFLINE APROVADA** (32/32, com 10 conferências do modo de teste) |
| `npm run validar:mapa` | Validação visual concluída |
| `npm run validar:paradas` | Validação visual concluída |
| `npm run validar:otimizacao` | **VALIDAÇÃO VISUAL APROVADA** |
| `npm run validar:circular` | **VALIDAÇÃO VISUAL APROVADA** |
| `npm run validar:trechos` | **VALIDAÇÃO VISUAL APROVADA** |
| `npm run validar:navegacao` | **VALIDAÇÃO VISUAL APROVADA** |
| `npm run auditar:otimizacao` | nenhuma inconsistência encontrada |

---

## 12. Próxima etapa (FASE 4)

**API de sincronização + autenticação**, nesta ordem:

1. decidir a identidade do agente (o servidor não tem autenticação: é a
   lacuna que trava a etapa);
2. definir o esquema de persistência dos registros coletados (o projeto
   **não tem banco** — a decisão é do servidor/município);
3. `POST /api/coleta/sincronizar` idempotente, com lote e confirmação
   **por registro**;
4. cliente de sincronização com retentativa exponencial, execuções
   disparadas ao abrir o aplicativo e no evento `online` (não só Background
   Sync);
5. política de conflito e de descarte seguro dos dados locais.
