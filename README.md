# Motor de roteamento viário de Santo André — **apenas rotas a pé**

Aplicação de roteamento viário para o município de **Santo André/SP**, alimentada pela
camada WFS do GeoServer da Prefeitura:

| | |
|---|---|
| **Camada** | `siga:SIGA_EIXO_LOG_OFICIAL_E_NAO` (eixos oficiais **e** não oficiais) |
| **Endpoint** | `https://sigamapa.santoandre.sp.gov.br/geoserver/siga/wfs` |
| **Interface** | OpenLayers 10 (vendorizado localmente) |
| **Backend** | Node.js ≥ 20, **sem dependências externas** |
| **Motor** | grafo viário próprio + A\* sobre nós/arestas reais |

O cálculo da rota é feito **inteiramente a partir da geometria da rede viária** publicada
pela camada. Não é usada nenhuma API externa de roteamento, e `turf.shortestPath` (que
opera sobre uma GeoJSON de linha, não sobre um grafo de nós e arestas) não é usado em
nenhum momento.

---

## 1. Sumário

1. [Instalação e execução](#2-instalação-e-execução)
2. [O que foi inspecionado na camada (dados reais)](#3-o-que-foi-inspecionado-na-camada-dados-reais)
3. [Estratégia de paginação e carregamento do WFS](#4-estratégia-de-paginação-e-carregamento-do-wfs)
4. [Construção do grafo: nós, arestas e conexões](#5-construção-do-grafo-nós-arestas-e-conexões)
5. [Justificativa das tolerâncias](#6-justificativa-das-tolerâncias)
6. [Algoritmo de roteamento](#7-algoritmo-de-roteamento)
7. [Arquitetura: por que há backend](#8-arquitetura-por-que-há-backend)
8. [API HTTP](#9-api-http)
9. [Testes](#10-testes)
10. [Limitações conhecidas dos dados viários](#11-limitações-conhecidas-dos-dados-viários)
11. [Atualização automática da rede (a view muda, o app acompanha)](#12-atualização-automática-da-rede-a-view-muda-o-app-acompanha)
12. [Estrutura de diretórios](#13-estrutura-de-diretórios)
13. [Atualizações por rodada (`updates/`)](#14-atualizações-por-rodada-updates)
14. [Endereço Digital (CEP Digital) e rota com múltiplas paradas](#15-endereço-digital-cep-digital-e-rota-com-múltiplas-paradas)
15. [Rota otimizada (menor rota) e arrastar os pontos no mapa](#16-rota-otimizada-menor-rota-e-arrastar-os-pontos-no-mapa)
16. [Rota circular (A → B → C → D → A)](#17-rota-circular-a--b--c--d--a)
17. [Trechos coloridos e quantidade dinâmica de paradas](#18-trechos-coloridos-quantidade-dinâmica-de-paradas-e-modos-de-roteamento)
18. [Trechos selecionáveis (ocultar as sobreposições)](#19-trechos-selecionáveis-ocultar-as-sobreposições)
19. [Navegação ativa (GPS real + modo de teste)](#20-navegação-ativa-gps-real--modo-de-teste)
20. [Auditoria da rota otimizada e limpeza do painel](#21-auditoria-da-rota-otimizada-e-limpeza-do-painel)
21. [Correção do menor caminho entre cada par (etapa 1 da otimização)](#22-correção-do-menor-caminho-entre-cada-par-etapa-1-da-otimização)
22. [Coleta de campo: persistência local e recuperação offline](#23-coleta-de-campo-persistência-local-e-recuperação-offline)
23. [Auditoria da ordem de visita: o empate, a primeira perna e o modo “saída curta”](#24-auditoria-da-ordem-de-visita-o-empate-a-primeira-perna-e-o-modo-saída-curta)
24. [Interface de modos: “Rota otimizada” × “Ordem das paradas”](#25-interface-de-modos-rota-otimizada--ordem-das-paradas)
25. [Interface de planejamento de visitas (em quatro etapas)](#26-interface-de-planejamento-de-visitas-em-quatro-etapas)
26. [Migração para React Native (Android)](#27-migração-para-react-native-android)
27. [Identidade SIGA + a tela do mapa](#28-identidade-siga--a-tela-do-mapa-rodada-18)
28. [Reformulação visual unificada (web + React Native)](#29-reformulação-visual-unificada-web--react-native-rodada-19)
29. [O visual das duas versões igualado à imagem de referência (rodada 20)](#30-o-visual-das-duas-versões-igualado-à-imagem-de-referência-rodada-20)
30. [Cópia paralela da rodada 10 (simulador de iniciar rota)](#31-cópia-paralela-da-rodada-10-simulador-de-iniciar-rota)
31. [Cópia de trabalho fora do projeto (com o simulador de trajeto)](#32-cópia-de-trabalho-fora-do-projeto-com-o-simulador-de-trajeto)

---

## 2. Instalação e execução

### Requisitos

* **Node.js ≥ 20** (usa `node:test`, `fetch` nativo e módulos ESM).
* Nenhum pacote npm em **runtime**. O projeto **não tem dependências** para
  rodar — o Playwright aparece só como dependência de *desenvolvimento*,
  usado pela validação visual (`npm run validar:mapa`, opcional).

```bash
cd santo-andre-routing

# (opcional, mas recomendado) baixa a rede do GeoServer e grava o snapshot
npm run fetch

# sobe a aplicação (API + interface) COM a atualização automática ligada
npm start
```

Por padrão o servidor **acompanha a camada sozinho**: verifica a cada 5 min se
o total de eixos mudou e, a cada 6 h, se o conteúdo mudou (ver
[seção 12](#12-atualização-automática-da-rede-a-view-muda-o-app-acompanha)).
Para desligar ou ajustar o ritmo:

```bash
npm start -- --no-auto-update            # não verifica sozinho
npm start -- --check-interval 2          # verificação leve a cada 2 min
npm start -- --deep-check-interval 120   # verificação completa a cada 2 h
```

Abra **<http://localhost:8080/>**.

| Comando | O que faz |
|---|---|
| `npm start` | Sobe o servidor (API + interface) na porta 8080 |
| `npm run dev` | Idem, com recarga automática (`node --watch`) |
| `npm test` | Executa a suíte de testes (233 casos) |
| `npm run fetch` | Baixa a rede do GeoServer e grava `data/network.snapshot.json` |
| `npm run fetch -- --force-pagination` | Força a paginação por faixa de ID (ver §4) |
| `npm run inspect` | Relata a estrutura real da camada (atributos, geometrias, grafo) |
| `npm run validate` | Validação cruzada das rotas (A\* × Dijkstra, continuidade, geometria) |
| `npm run report` | Relatório de qualidade da rede (`-- --markdown` para gerar em Markdown) |
| `npm run diagnose` | Mede as junções da camada e as ligações que faltam |
| `npm run fidelity` | Auditoria de fidelidade geométrica das rotas (250 rotas) |
| `npm run validar:mapa` | Validação **visual** no navegador (Chromium headless) — requer `npx playwright install chromium` e o servidor no ar |
| `npm run validar:paradas` | Validação **visual** do Endereço Digital e da rota com paradas (A → B → C) |
| `npm run validar:tsp` | Otimização da ordem de visita na **rede real** (várias ordens informadas × menor rota) |
| `npm run validar:otimizacao` | Validação **visual** da menor rota e do **arraste** dos pontos no mapa |
| `npm run validar:circular` | Validação **visual** da rota **circular** (A → … → A): fechamento, retorno tracejado e arraste |
| `npm run validar:trechos` | Validação **visual** dos **trechos coloridos**: uma cor por trecho, legenda, arraste e remoção |
| `npm run validar:navegacao` | Validação **visual** da **navegação ativa**: modo de teste, progresso, chegada, desvio com recálculo e erro de GPS |
| `npm run auditar:otimizacao` | **Auditoria numérica** do modo "Menor rota total": matriz de custos, Held-Karp × força bruta, trecho desenhado × matriz, economia (ver §21) |
| `npm run auditar:caminho-minimo` | **Auditoria da etapa 1**: o menor caminho entre cada par contra uma referência independente, simetria do custo, coerência com a geometria e acesso à rede (ver §22) |
| `npm run auditar:ordem` | **Auditoria da ordem de visita**: reprodução do caso do print, matriz nos dois sentidos, todas as ordens do circuito, Held-Karp × força bruta, desenho × custado e rota ótima × vizinho mais próximo (ver §24) |
| `npm run validar:modos` | Validação **visual** da nova interface de modos: os dois botões, o circuito fixo, a ordem calculada × a ordem dos cartões, o arraste, a renumeração e o Endereço Digital (ver §25) |
| `npm run validar:offline` | **Validação da coleta de campo no navegador**: a rota salva sobrevive ao recarregamento, a coleta GPS acumula sem servidor, a coleta interrompida é recuperada e retomada, a localização de residência fica gravada com Plus Code (ver §23) |

Opções do servidor: `node server/index.js --port 8080 --host 0.0.0.0`
(ou as variáveis de ambiente `PORT` e `HOST`).

### Cartografia da interface

A leitura do mapa é otimizada para a **rede viária**, não para o mapa-base:

* **Base clareada** — os tiles do OpenStreetMap passam por um filtro CSS
  (`grayscale` + `brightness` + `contrast`) que os torna um fundo neutro e
  claro. Nenhum servidor de tiles externo é acrescentado: a atribuição do OSM
  é preservada e o mapa continua funcionando igual.
* **Rede viária em duas camadas** — técnica de cartografia urbana de
  *casca + núcleo*:
  * a **casca** (branco, 3,6 px) fica por baixo e separa a rua do mapa-base,
    criando o halo de legibilidade;
  * o **núcleo** (azul-cinza, 1,8 px) dá a cor da via.
* **Eixos não oficializados** (`COD_LOG = 0`) aparecem em **laranja
  tracejado**, distinguindo-os dos logradouros oficiais.
* **Rota** — três níveis: halo branco, contorno escuro e núcleo âmbar, para ficar
  acima da rede e do mapa-base sem ambiguidade.
* **Ponto de partida e locais de visita** — marcadores circulares com halo
  branco e a letra interna (A no ponto de partida, B, C… nos locais).

### Como usar

A tela de planejamento é lida em **quatro etapas** (ver
[seção 26](#26-interface-de-planejamento-de-visitas-em-quatro-etapas)):

1. **Ponto de partida** — o percurso **começa e termina** aqui. Informe o
   **Endereço Digital** (CEP Digital) e clique em **Validar**, **ou** clique
   em **Selecionar no mapa** e clique no mapa, **ou** clique em **Usar minha
   localização**. As coordenadas (`longitude, latitude` em decimal, ex.:
   `-46.545000, -23.660000`) ficam em **Coordenadas (opções avançadas)**;
2. **Locais de visita** — clique em **+ Adicionar outro local** para cada
   endereço, na ordem em que serão visitados. Cada cartão traz o endereço,
   o botão **Validar** e um menu **⋯** (ver no mapa, mover para cima, mover
   para baixo, remover). **Arraste a alça** do cartão para trocar a ordem; o
   percurso é recalculado sozinho;
3. **Como organizar o percurso** — escolha entre os dois cartões:
   * **Melhor percurso** — o sistema organiza as visitas para reduzir a
     distância total percorrida;
   * **Seguir minha ordem** — o sistema visita os locais na sequência da lista;
4. **Calcular meu percurso** — o percurso aparece no mapa com uma cor por
   trecho, a distância total e a lista de logradouros percorridos.

> O percurso é **sempre uma volta**: sai do ponto de partida, visita todos os
> locais e volta ao ponto de partida.
>
> A entrada em formato `latitude, longitude` também é aceita: quando o primeiro
> número tem módulo ≤ 90 e o segundo > 90, a ordem é invertida automaticamente.
>
> *(extra)* **arraste** um marcador no mapa para mudar a posição de um ponto —
> a rota também é recalculada.

---

## 3. O que foi inspecionado na camada (dados reais)

Nada abaixo é suposição — tudo foi medido com `npm run inspect` contra o servidor.

### 3.1 Atributos publicados (`DescribeFeatureType`)

| Atributo | Tipo | Anulável | Uso no motor |
|---|---|---|---|
| `ID` | `xsd:decimal` | não | identificador único da feição (4.119 valores, sem repetição) |
| `COD_LOG` | `xsd:decimal` | sim | `0` ⇒ logradouro **não oficializado**; `> 0` ⇒ oficial |
| `TPO_LOGRADOURO` | `xsd:string` | não | tipo: `RUA`, `TRV`, `PCA`, `AVN`, `EST`, `LGO`, `ALM`, `PRQ`, `VID`, `PSL`, `CAM`, `ROD`, `JD`, `PTE`, `MAR` |
| `COD_TITULO_LOGRADOURO` | `xsd:string` | sim | título (DR, STA, PROF, …) |
| `NOM_LOGRADOURO` | `xsd:string` | não | nome do logradouro |
| `DSC_LOGRADOURO` | `xsd:string` | sim | descrição completa (ex.: `AVENIDA QUINZE DE NOVEMBRO`) |

> A geometria **não** vem como atributo: no GeoJSON ela aparece no membro `geometry`.
> O `DescribeFeatureType` também declara um elemento `GEOMETRY` do tipo
> `gml:GeometryPropertyType` — é a geometria, não um atributo de negócio.

### 3.2 Volume e tipos de geometria

| Métrica | Valor |
|---|---|
| Feições | **4.119** na inspeção (a camada tem mudado desde então: **4.287** hoje) |
| Partes (após abrir os `MultiLineString`) | 5.851 |
| `LineString` / `MultiLineString` | 3.343 / 776 |
| Partes degeneradas (vértices coincidentes) | 16 (descartadas) |
| Vértices totais | 48.326 |
| Extensão | lon −46,5673 … −46,2840 · lat −23,8000 … −23,6061 |
| Eixos **não oficializados** (`COD_LOG = 0`) | 10 (`RUA NÃO OFICIALIZADA`) |

A camada cobre **apenas a área urbana central** de Santo André — não o município inteiro.

### 3.3 Geometria real: o que a camada **não** traz

* **Nenhum atributo de nível, gabarito ou passagem em nível diferente.** A camada é uma
  *view* do banco que publica apenas os atributos da tabela de logradouros.
  Consequentemente, **é impossível, a partir destes dados, distinguir um cruzamento em
  nível de um viaduto**. O motor trata isso explicitamente (ver §5.5 e §11).
* Nenhum atributo de sentido de circulação, de largura, de faixa de pedestres ou de
  restrição a pedestres.

---

## 4. Estratégia de paginação e carregamento do WFS

Esta seção é resultado de **experimentos reais** contra o servidor da Prefeitura
(20/10/2026). As quatro abordagens foram testadas.

### 4.1 O que funciona e o que não funciona nesta camada

| # | Mecanismo | Resultado medido |
|---|---|---|
| **A** | `startIndex` (paginação por deslocamento) | ❌ **QUEBRA.** O servidor responde `ServiceException`: `Cannot do natural order without a primary key, please add it or specify a manual sort over existing attributes`. A camada é uma view SQL que não expõe chave primária ordenável. |
| **B** | `BBOX` (filtro espacial) | ❌ **QUEBRA.** Tanto na forma KVP (`&bbox=…`) quanto na forma XML (`<Filter><BBOX><gml:Envelope>`), devolve `numberMatched = 0` mesmo para janelas que contêmThousands de feições. |
| **C** | `CQL_FILTER` por **faixa** de `ID` | ✅ **FUNCIONA.** `CQL_FILTER=ID>=1001 AND ID<2001` devolve exatamente as feições da faixa. O `ID` é atributo real do banco, então o filtro é avaliado no servidor. |
| **C′** | `CQL_FILTER` com operador `IN` | ❌ **Não suportado.** `ID IN (4159,4155,4160)` devolve **0** feições. Por isso a paginação é por **faixa**, nunca por lista. |
| **D** | Requisição única com `maxFeatures` alto | ✅ **FUNCIONA.** As 4.119 feições em ~1,7 s / 2,6 MB. |

### 4.2 Algoritmo implementado (`core/wfs.js`)

```
1. Requisição única com maxFeatures = 5000          → estratégia "single"
      ↓ se o total declarado pelo servidor for maior
2. Paginação por startIndex                           → estratégia "startIndex"
      ↓ se o servidor responder ServiceException sobre chave primária
3. Paginação por faixa de ID (CQL_FILTER)            → estratégia "cql-range"
      3a. Lista os IDs com propertyName=ID (payload minúsculo, sem geometria)
      3b. Se a listagem vier truncada pelo limite de maxFeatures, faz uma
          varredura por faixas, ampliando a janela quando há lacunas de ID
      3c. Para cada janela [lo, hi): CQL_FILTER=ID>=lo AND ID<hi
      3d. Deduplica por ID e confere o total contra o declarado pelo servidor
```

A escolha da estratégia é **automática e é registrada** em `meta.strategy` e em
`warnings`, de modo que a interface mostra como a rede foi obtida.

### 4.3 Prova de equivalência entre as estratégias

```bash
npm run fetch                                          # estratégia "single"  (1 requisição)
npm run fetch -- --force-pagination --out /tmp/p.json  # estratégia "cql-range" (6 requisições)
```

Comparando os dois snapshots:

```
estratégia A: single     req: 1  feats: 4119
estratégia B: cql-range  req: 6  feats: 4119
mesmo conjunto de IDs: True
feições com geometria diferente entre as estratégias: 0
diagnóstico idêntico: True        (10.413 nós / 13.993 arestas em ambas)
```

Ou seja: a paginação por faixa recupera **exatamente** a mesma rede da requisição única.

### 4.4 Tratamento de falhas

| Situação | Tratamento |
|---|---|
| Timeout (120 s por requisição) | `AbortController` → `WfsError` explícito |
| HTTP 5xx / 429 | até 3 tentativas com *backoff* exponencial |
| HTTP 4xx | **não** é repetido (falha imediata) |
| JSON inválido | erro descritivo com os primeiros 400 caracteres |
| `ServiceException` do OGC | é interpretada e reprocessada (é assim que a queda de `startIndex` → `cql-range` é detectada) |
| Resposta incompleta | comparada com o total declarado pelo servidor; a diferença vira aviso |
| Conexão recusada | 3 tentativas e erro final com a URL e a causa |

---

## 5. Construção do grafo: nós, arestas e conexões

Implementado em `core/graph.js` (≈1.100 linhas comentadas). Pipeline completo:

```
GeoJSON  →  1. NORMALIZAÇÃO  →  2. ÍNDICE  →  3. INTERSEÇÕES  →  4. SNAP/MERGE
        →  5. CORTE  →  6. NÓS (union-find)  →  7. ARESTAS  →  8. HIGIENE
```

### 5.1 Normalização (`normalizeParts`)

* `LineString` e `MultiLineString` são abertos em **partes** poligonais independentes
  (5.851 partes a partir de 4.119 feições).
* Vértices consecutivos coincidentes são removidos; partes com menos de 2 pontos ou de
  comprimento zero são descartadas (16 no conjunto real).
* Cada vértice é projetado de **EPSG:4326 → UTM 23S (EPSG:32723)**.
  A projeção Transversal de Mercator foi implementada em `core/geo.js` (séries de Snyder),
  sem dependências. **Validação**: contra o `srsName=EPSG:32723` do próprio GeoServer,
  a diferença é de **0,22 mm**.

### 5.2 Índice espacial

Grade uniforme de 60 m sobre os **segmentos** (não sobre as feições), com
branch-and-bound na expansão de anéis. É usada tanto para achar pares de eixos que
podem se cruzar quanto para localizar o segmento mais próximo de um ponto.

### 5.3 Interseções reais (`detectIntersections`)

Para cada par de segmentos candidatos (via índice), o motor classifica a relação
geométrica:

| Relação | Tratamento |
|---|---|
| **Cruzamento** (interior × interior) | ponto de corte nos **dois** eixos + **união** dos nós → é um cruzamento de verdade |
| **Toque** (extremidade × interior) | ponto de corte nos dois eixos + **união** dos nós → beco sem saída que encontra outra rua |
| **Toque** (extremidade × extremidade) | união direta dos dois nós |
| **Sobreposição** (colinear) | corte dos dois eixos nos extremos do trecho compartilhado + união das extremidades → o trecho compartilhado vira **uma** aresta só |

Medido na camada real: **370 cruzamentos**, **19.304 toques**, **236 sobreposições**.
Os 370 cruzamentos são exatamente os casos em que um eixo **passa por cima** de outro
sem estar partido — sem o corte, o grafo teria “pontos cegos” e a rota poderia saltar
de uma rua para outra sem existir caminho.

### 5.4 Ajuste de extremidades e conectores de junção (`detectSnapEvents`)

Uma rua da camada pode terminar **sem encostar** na rua que ela cruza. Há três
situações, tratadas conforme a distância da lacuna:

| Lacuna | Tratamento | Geometria original |
|---|---|---|
| **≤ 5 cm** | **SNAP** — a extremidade é movida para o ponto de contato e o outro eixo é partido ali | corrigida (desvio ≤ 5 cm) |
| **≤ 5 cm** (outra extremidade) | **MERGE** — as duas pontas são fundidas no ponto médio | corrigida |
| **5 cm … 1 m** | **CONECTOR** — as pontas ficam **exatamente onde estão** e a ligação é feita por um trecho curto, com o comprimento real da lacuna | **intacta** |

O conector é o que resolve as rotas que davam uma volta desnecessária. A rua A
termina a 50 cm da rua B: sem o conector, o pedestre precisa contornar o quarteirão
inteiro para atravessar; com ele, a rota passa direto e a distância inclui
corretamente os 50 cm percorridos.

Medido na camada real: **455 snaps**, **110 fusões** e **103 conectores**. Nenhuma
geometria de eixo é alterada por um conector — ele é uma aresta própria, e a rota
soma o comprimento real da lacuna.

> **Por que 1 m é o limite?** Nenhuma rua real termina a 1 m de outra rua: uma
> lacuna de até 1 m é ruído de digitalização, não uma separação. Acima de 2 m o
> volume cresce muito (375 casos entre 5 e 10 m, 512 entre 10 e 25 m), o que
> indica ruas realmente distintas — por isso o limite é 1 m (§6).

### 5.5 Cruzamentos em nível diferente (viadutos)

Como a camada **não publica nível**, o motor:

1. **conecta** todos os cruzamentos geométricos (o dado é a evidência disponível);
2. **classifica separadamente** os 27 cruzamentos em que uma das vias é uma rodovia
   (`TPO_LOGRADOURO = 'ROD'` ou nome contendo “RODOVIA”) — são os candidatos naturais a
   passagem em nível diferente;
3. permite **recusar** esses cruzamentos com a opção `excludeRoadCrossings: true`
   (o padrão é `false`, ou seja, conectar). Quando recusados, eles aparecem no
   diagnóstico (`rejectedCrossings`).

Nada é inventado: sem atributo de nível, a decisão é explícita, configurável e
reportada — nunca silenciosa.

### 5.6 Corte e criação dos nós

Cada eixo é partido nos seus pontos de corte. Cada ponta de um trecho é uma **porta**.
As portas que representam o mesmo cruzamento são unidas por **union-find**, produzindo
os **nós** do grafo.

> ⚠️ Detalhe que custou uma correção real: quando dois cortes coincidem (o mesmo
> ponto, ou seja, dois eventos diferentes), apenas um sobrevive. Se as uniões ainda
> apontarem para o corte descartado, a junção é **perdida em silêncio** e a rede se
> fragmenta. Por isso os cortes descartados são *canonizados* para o representante
> (`resolveCut`) e o diagnóstico expõe `junctionsLost` — que é **0** na rede real.

### 5.7 Arestas e pesos

Cada trecho partido vira uma aresta com:

* **peso = comprimento real** do trecho, medido na projeção UTM 23S;
* **atributos originais preservados** (`ID`, `COD_LOG`, `TPO_LOGRADOURO`,
  `NOM_LOGRADOURO`, `DSC_LOGRADOURO`) — é assim que a resposta traz o nome de cada
  logradouro percorrido;
* geometria completa (todos os vértices), para a reconstrução da rota;
* quando a parte é um **anel fechado** (a rua começa e termina no mesmo nó,
  sem cruzamento interior — uma praça em círculo), a aresta é criada como
  **laço** (`loop: true`) com a geometria **inteira** do anel: sem ela, a praça
  sumia do mapa de rotas.

Resultado na rede real: **10.874 nós** e **14.617 arestas** (camada de 4.287 eixos).

### 5.8 Higiene: duplicidades e componentes

* **Duplicidade geométrica** = mesma dupla de nós + mesmo comprimento (± 0,5 m) +
  mesmo ponto médio (± 0,5 m). Ruas **paralelas legítimas** têm pontos médios
  diferentes e **não são descartadas**. → 432 duplicidades removidas na rede real.
* **Componentes conexas** são calculadas e reportadas: **321 componentes**, sendo a
  maior com 9.078 nós (83,5 % da rede). As demais são, na prática, eixos isolados
  (ruas sem saída, trechos internos de quadras,wns em condomínio).

> **Verificação independente**: uma referência em PostGIS/Shapely (`unary_union` com
> *noding* exato) sobre os mesmos dados resulta em **390 componentes**, com a maior
> contendo 8.226 segmentos — praticamente idêntico aos 338/8.405 do motor. A
> pequena diferença vem das junções por *snap* (5 cm) que o motor aceita e o
> *noding* topológico exato não.

### 5.9 Resultado

```
nós                : 10.874
arestas            : 14.617
cruzamentos        : 436
toques             : 19.611
sobreposições      : 236
snaps (< 5 cm)     : 473
fusões             : 110
duplicidades       : 455 (removidas)
junções perdidas   : 0
conectores (< 1 m) : 103
junções unificadas : 20.709   (perdidas: 0)
duplicidades       : 443 (removidas)
componentes        : 317 (maior: 8.712 — 83 % dos nós)
tempo de construção: ~0,8 s
```

---

## 6. Justificativa das tolerâncias

Medição feita sobre as **11.702 extremidades** de eixo da camada real:

| Distância da extremidade até o eixo mais próximo | Nº de extremidades |
|---|---|
| exatamente 0 cm | 9.241 |
| até 1 cm | 2.457 |
| entre 1 cm e 5 cm | **4** |
| entre 5 cm e 1 m | **0** |
| acima de 1 m | 0 |

Conclusão: **5 cm é o maior valor seguro**. Abaixo de 5 cm há um "vazio" completo
(nenhuma extremidade entre 5 cm e 1 m), e 5 cm equivalem a **1,25 mm** numa base 1:25.000
— muito abaixo da distância real entre ruas paralelas.

| Parâmetro | Valor | Papel |
|---|---|---|
| `snapTolerance` | **0,05 m** | correção geométrica: a ponta é movida até o contato |
| `junctionTolerance` | **1,00 m** | **conector**: a ponta fica onde está e a ligação é feita por um trecho curto, com o comprimento real da lacuna |
| `nodeMergeTolerance` | 0,005 m | unificação de nós já coincidentes |
| `intersectEpsilon` | 1 µm | tolerância numérica da classificação de interseções |
| `duplicateMidpointTolerance` | 0,5 m | prova de duplicidade geométrica |
| `maxSnapDistance` | 100 m | acima disso o ponto é considerado **fora da rede** |

### 6.1 A distribuição que justifica a tolerância de junção

A medição acima (§6) considerava apenas pares **extremidade × extremidade**.
A medição que realmente importa é **extremidade × interior de eixo** — é assim
que uma rua termina a poucos centímetros de outra sem tocá-la:

| Distância da extremidade ao eixo mais próximo | Nº de extremidades |
|---|---|
| exatamente 0 cm | 9.774 |
| até 5 cm | 28 |
| 5 – 10 cm | 16 |
| 10 – 25 cm | 42 |
| 25 – 50 cm | 13 |
| 50 cm – 1 m | 32 |
| 1 – 2 m | 30 |
| 2 – 5 m | 128 |
| 5 – 10 m | 375 |
| 10 – 25 m | 512 |

A distribuição tem um **joelho claro**: até 1 m há 103 casos (ruído de
digitalização); a partir de 2 m o volume cresce e passa a ser dominado por ruas
que realmente não se tocam. Daí o limite de 1 m.

### 6.2 O efeito medido da tolerância de junção

Comparando o grafo com `junctionTolerance = 0` (antes) e `= 1 m` (agora), em
**1.500 pares de pontos**:

| | Antes (5 cm) | Agora (1 m) |
|---|---|---|
| componentes conexas | 426 | **317** |
| nós na maior componente | 8.367 | **8.712** |
| rotas que **não existiam** | — | **+81** passaram a existir |
| rotas encurtadas | — | **683** (45 %) |
| rotas alongadas | — | **0** |
| ganho total de distância | — | **169,7 km** |
| maior ganho numa rota | — | **1.204 m** |
| pior razão rota/linha reta | 20,87× | **9,48×** (6,05× após a correção geométrica da rodada 4) |

---

## 7. Algoritmo de roteamento

`core/router.js`:

1. **Validação** das coordenadas (faixa, finitude) → erro explícito se inválidas.
2. **Projeção** do ponto para UTM 23S.
3. **Projeção sobre a rede**: busca do segmento mais próximo com branch-and-bound.
   Se a distância exceder `maxSnapDistance` (100 m), a resposta é
   `FORA_DA_REDE` com a distância medida.
4. **Nós temporários**: se a origem ou o destino cai no meio de uma aresta, a aresta
   é dividida no ponto projetado, criando um nó temporário. A rota começa/termina
   exatamente no ponto informado.
5. **A\*** com fila de prioridade binária:
   * custo `g` = soma dos comprimentos reais;
   * heurística `h` = distância euclidiana até o destino.
     Como o peso de cada aresta é **≥** à distância euclidiana entre suasextremidades,
     `h` é **admissível e consistente** ⇒ o A* devolve o **caminho viário de menor
     comprimento**.
6. **Montagem do trajeto**: ordem das arestas percorridas, junção das coordenadas na
   ordem correta (invertendo o sentido quando necessário), legs com logradouro e
   comprimento, lista de ruas e geometria final em EPSG:4326.

O grafo é **não direcional** (pedestres caminham nos dois sentidos) e a camada não
publica sentido de circulação, portanto nenhum sentido é imposto.

**Não há linha reta em lugar nenhum do cálculo.** Quando não existe caminho, a
resposta é `SEM_CAMINHO` — nunca um segmento fictício.

### Validações internas da rota

* arestas consecutivas **compartilham um nó** (nunca há salto);
* a **soma dos trechos** é idêntica à distância total (tolerância 1e-6 m);
* a **geometria final** tem o mesmo comprimento geodésico da rota (± 1 m);
* a geometria começa no ponto projetado da origem e termina no do destino.

### Fidelidade geométrica (rodada 4)

A rota devolvida é a **concatenação das geometrias originais** dos eixos
percorridos — nada mais:

* cada aresta percorrida é recortada da cadeia **original** do eixo
  (`sliceAlongEdge`), **mantendo todos os vértices intermediários**: uma praça
  ou uma curva continua sendo uma praça ou uma curva;
* quando o sentido de percurso é **invertido**, a cadeia **inteira** é
  revertida — não só os extremos;
* na concatenação são removidas **apenas** as repetições consecutivas
  (≤ 1e-6 m), nunca vértices;
* a geometria de cada aresta é a **dela própria**: a tolerância de junção não
  move mais a rua desenhada. A discrepância entre os dois lados de uma
  interseção é apenas **medida** e reportada em `result.warnings` acima de 1 cm;
* **nenhuma** linha é criada para "emendar" trechos: onde a passagem não está
  confirmada, o problema fica registrado (e a rota não passa).

Medido: desvio máximo até a malha desenhada **0,44 m** (as lacunas reais de até
1 m da base), desvio contra a rede completa **0,011 m** — antes: 35,52 m.
Detalhes e provas em `updates/04-fidelidade-geometrica/`.

---

## 8. Arquitetura: por que há backend

A decisão **não** é stylistic: ela é forçada pelo servidor.

> **O GeoServer da Prefeitura de Santo André não devolve cabeçalhos `Access-Control-Allow-Origin`.**
> Verificado com `curl -H "Origin: http://localhost:8080"`: a resposta vem com
> `HTTP/2 200` e `content-type: application/json`, **sem nenhum cabeçalho CORS**.
> Uma requisição direta do navegador para o WFS é, portanto, bloqueada.

Além disso:

| Critério | Navegador | Backend (escolhido) |
|---|---|---|
| CORS com o WFS | ❌ bloqueado | ✅ resolvido pelo proxy |
| Custo de construir o grafo | ~0,8 s de CPU **na máquina do usuário**, a cada carga de página | ✅ uma vez, em memória no servidor |
| Snapshot em disco | ❌ impossível | ✅ persistência local |
| Cache compartilhado | ❌ | ✅ um grafo para todos os usuários |
| Tempo até a primeira rota | 1 requisição de 2,6 MB + 0,8 s de parse por usuário | ✅ 0,8 s uma única vez |
| Atualização da rede | ❌ cada aba refaz tudo | ✅ `POST /api/refresh` |

A **decisão final**: backend Node.js com grafo em memória + snapshot em disco, e a
interface apenas consome `/api/route`.

**O motor (`core/`) é isomórfico**: não usa nada específico do Node nem do navegador
(só `fetch`, `Map`, `Set`, `TypedArray`). Ele roda no servidor **e** dentro de um
*Web Worker* no navegador — o que permite, no futuro, uma variante 100 % cliente para
uso offline, sem reescrever o algoritmo.

### Desempenho medido

| Operação | Tempo |
|---|---|
| Carregar a rede do WFS (4.287 feições) | ~2,1 s |
| Construir o grafo | ~0,9 s |
| Rota (A\* sobre 14.617 arestas) | **< 2 ms** |
| Arrancar o servidor usando o snapshot local | ~0,9 s (inclui a construção do grafo) |

A rede **não** é reconstruída a cada rota: o grafo fica em memória e é invalidado
apenas quando a camada muda.

---

## 9. API HTTP

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/health` | estado do cache e do grafo |
| `GET` | `/api/network` | FeatureCollection GeoJSON da rede + metadados |
| `GET` | `/api/route?origin=lon,lat&destination=lon,lat` | calcula a rota |
| `GET` | `/api/diagnostics` | diagnóstico completo da construção do grafo |
| `GET` | `/api/layer-schema` | `DescribeFeatureType` (atributos publicados) |
| `POST` | `/api/refresh` | força a reconstrução do grafo a partir do WFS |
| `POST` | `/api/updates` | força uma verificação **completa** de mudanças na camada |
| `GET` | `/api/endereco-digital?codigo=…` | resolve um Endereço Digital (CEP Digital) em coordenadas |
| `GET`/`POST` | `/api/rota-paradas` | rota com múltiplas paradas: `{"modo":"usuario\|otimizada","pontos":[{"rotulo":"A","latitude":…,"longitude":…}, …]}` |

Códigos de resposta da rota: **200** com a rota · **422** com `ok: false` e o motivo
(`SEM_CAMINHO`, `FORA_DA_REDE`, `COORDENADA_INVALIDA`, `TRECHO_SEM_CAMINHO`,
`PONTOS_SEM_CONEXAO`, `LIMITE_DE_PONTOS`) · **400** para parâmetros malformados.

**Ordem do trajeto** (ver [seção 16](#16-rota-otimizada-menor-rota-e-arrastar-os-pontos-no-mapa)):

```bash
curl -X POST http://localhost:8080/api/rota-paradas \
  -H 'Content-Type: application/json' \
  -d '{"modo":"otimizada","pontos":[
        {"rotulo":"A","latitude":-23.6526875,"longitude":-46.5081875},
        {"rotulo":"B","latitude":-23.6966277,"longitude":-46.5348612}]}'
```

```jsonc
{
  "ok": true,
  "modo": "otimizada",
  "distance": 15319.58,          // metros
  "sequencia": ["A", "C", "B", "D"],      // ordem percorrida
  "sequenciaUsuario": ["A", "B", "C", "D"], // ordem informada
  "otimizacao": { "metodo": "exato", "ms": 27, "custo": 15319.58 },
  "comparacao": {
    "distanciaUsuario": 23323.13,
    "distanciaOtimizada": 15319.58,
    "economia": 8003.55,
    "economiaPercentual": 34.3
  }
}
```

**Endereço Digital** (ver [seção 15](#15-endereço-digital-cep-digital-e-rota-com-múltiplas-paradas)):

```bash
curl "http://localhost:8080/api/endereco-digital?codigo=8FP9%2BJ6"
```

```jsonc
{
  "ok": true,
  "status": "CONVERTIDO",       // VAZIO | MALFORMADO | VALIDADO | CONVERTIDO
                                 // | FORA_DA_AREA | INDISPONIVEL | FALHA
  "servico": "local",            // local | siga
  "codigoNormalizado": "8FP9+J6",
  "codigoCompleto": "588M8FP9+J6",
  "latitude": -23.6634375,
  "longitude": -46.5319375,
  "naRegiao": true
}
```

Exemplo:

```bash
curl "http://localhost:8080/api/route?origin=-46.5449,-23.6600&destination=-46.5200,-23.6500"
```

```jsonc
{
  "ok": true,
  "distance": 3057.31,          // metros
  "distanceMeters": 3057,
  "distanceKm": 3.057,
  "geometry": { "type": "LineString", "coordinates": [ /* … */ ] },
  "legs": [
    { "street": "RUA CATEQUESE", "type": "RUA", "codLog": 41200, "official": true, "length": 312.4 }
  ],
  "streets": ["RUA CATEQUESE", "AVENIDA QUINZE DE NOVEMBRO", "…"],
  "origin": { "snapped": { "lon": -46.5447, "lat": -23.6606 }, "distanceToNetwork": 18.27 },
  "destination": { "snapped": { … }, "distanceToNetwork": 29.96 },
  "nodeCount": 36
}
```

---

## 10. Testes

```bash
npm test        # 243 casos
```

Saída verificada nesta entrega:

```
# tests 243
# pass 243
# fail 0
```

| Arquivo | Casos | O que cobre |
|---|---|---|
| `test/graph.test.js` | 14 | projeção UTM (ida e volta **e** confronto com o EPSG:32723 do GeoServer), cruzamento real, tolerância de 5 cm, ruas apenas próximas **não** conectadas, recusa de cruzamento com rodovia, duplicidades, rede desconectada, eixo com repetição de vértice, camada com > 1.000 feições, **nenhuma junção perdida** |
| `test/router.test.js` | 17 | origem e destino no mesmo segmento (nos dois sentidos), rotas entre ruas conectadas, trechos oficiais + não oficiais, exclusão de eixos não oficializados, rede desconectada, ponto distante da rede, ponto fora da área coberta, coordenadas inválidas, rota em “U” (caminho ≠ linha reta), continuidade das arestas, geometria ordenada, soma dos trechos = distância, integração com a rede real, **A\* × Dijkstra com resultado idêntico** |
| `test/wfs.test.js` | 9 | paginação completa (> 1.000 feições, sem perdas), detecção da falha de `startIndex` e migração para CQL, uso de `startIndex` quando o servidor suporta, requisição única, descoberta de atributos via `DescribeFeatureType`, JSON inválido, `ServiceException`, erro HTTP permanente não repetido, integridade do snapshot real |
| `test/api.test.js` | 10 | todos os endpoints, formatos de entrada, código HTTP correto, aplicação estática, OpenLayers vendorizado, **ausência de dependência de API de roteamento externa** |
| `test/ordemParadas.test.js` | 15 | **otimização da ordem de visita** (rodada 6): ordem otimizada nunca é pior que a informada, **Held-Karp = força bruta**, 2-opt nunca piora, matriz de distâncias simétrica e com desigualdade triangular (fecho métrico), soma dos trechos = distância total, modo "ordem do usuário" respeita a sequência, **geometria preservada** na rota otimizada, pontos sem conexão recusados com motivo explícito, **mover um ponto muda a rota** (rede com ramificações), limites declarados, **arrastar a ordem no painel** (a parada troca de lugar, origem/destino ficam fixos, a ordem arrastada define a rota) |
| `test/enderecoDigital.test.js` | 16 | **Endereço Digital e paradas** (rodada 5): Plus Code completo válido, Plus Code encurtado (expansão com a referência do município), código inválido, endereço fora da área, código truncado (fidelidade à classe), falha × vazio, coordenada próxima de um eixo (com a distância de acesso), ponto distante da rede, rota origem→destino, rota com duas ou mais paradas, adição/edição/remoção de paradas, reordenação, trecho sem conexão viável (sem linha reta), alteração de endereço após o cálculo, **curvas preservadas em todos os trechos**, integração com a rede real |
| `test/fidelity.test.js` | 8 | **fidelidade geométrica** (rodada 4): rota com muitas curvas, eixos consecutivos, aresta percorrida em sentido inverso, rota através de uma interseção, mistura de eixos oficiais e não oficializados, **continuidade** entre todas as arestas, **concatenação das geometrias originais** e regressão do círculo (praça em anel = 1 nó / 1 aresta, comprimento = meia circunferência) |
| `test/circular.test.js` | 13 | **rota circular** (rodada 7): o circuito **termina obrigatoriamente na origem**, o trecho de fechamento **não é uma linha reta**, o modo otimizado acha o **menor ciclo** (conferido com a força bruta), a ordem do usuário é respeitada, arrastar um card muda a ordem, casos de borda (só a origem, uma parada, pontos coincidentes, coordenada inválida, ausência de caminho **inclusive no retorno**), lista em modo circuito **sem card de destino**, Held-Karp em ciclo inclui o fecho |
| `test/coresTrechos.test.js` | 7 | **cores por trecho** (rodada 8): paleta com cores distintas e bem formadas, **trechos adjacentes com cores diferentes**, paleta esgotada com reutilização **organizada**, atribuição **determinística** e independente do modo, a cor representa o **trecho** (e não a posição da parada), o **retorno à origem tem cor própria** e a rota é contínua, **quantidade de paradas dinâmica** |
| `test/interfaceModos.test.js` | 15 | **interface de modos** (rodada 15): nenhum radio de tipo/modo, **exatamente dois botões** com título e descrição, **um modo ativo por vez** (`aria-pressed`), aviso do circuito, botão “Inverter” removido, legenda com “Retorno à origem” e sem “Destino”, Endereço Digital/coordenadas/seleção no mapa preservados, **“Rota otimizada” devolve o menor circuito** (conferido contra as 6 ordens do circuito) **com o desempate validado**, o **circuito sempre fecha na origem**, **“Ordem das paradas” respeita a ordem dos cartões** (e é mais longa), adicionar/remover/reordenar parada com **renumeração** e a origem fixa |
| `test/interfacePlanejamento.test.js` | 10 | **interface de planejamento** (rodada 16): as três etapas na ordem, o ponto de partida isolado com “Início e fim do percurso” e as ações de mapa/localização, os locais numerados em linguagem de visita (“1ª visita”…) com os ids internos preservados, alça de arraste + menu com **mover para cima / mover para baixo / remover**, **exatamente dois** cartões de opção com os textos pedidos e **nenhum** seletor de “Ida e volta”, o botão **“Calcular meu percurso”** depois das opções, o resultado dentro do corpo rolável do painel, **terminologia sem jargão**, coordenadas atrás das “opções avançadas”, ponto de partida **sem** menu de ações, lista com rolagem própria + legenda recolhível, mensagens **faladas** |
| `test/update.test.js` | 13 | atualização automática: verificação leve sem mudança, eixos adicionados, eixos removidos, **correção de eixo já existente** (detecta a verificação completa), impressão digital estável, **troca atômica do grafo**, falha do WFS sem derrubar o servidor nem o estado, verificações concorrentes compartilhando uma execução, temporizador ligado/desligado, carga inicial como linha de base, **WFS fora do ar ⇒ snapshot local ainda serve rotas**, status exposto |

Os testes usam **redes sintéticas** (determinísticas) para os cenários de grafo e
roteamento, e o **snapshot real** (`data/network.snapshot.json`) para os cenários de
integração. Nenhum teste depende da rede do município.

### 10.1 Validação cruzada das rotas (`npm run validate`)

Ferramenta de aceitação independente dos testes: para **2.000 pares de pontos**
sorteados dentro da maior componente conexa, ela recalcula cada rota com
**Dijkstra puro** (o mesmo motor, sem heurística) e compara com o resultado do A\*.

```
  pares testados                 : 2000
  com rota                       : 2000
  sem rota (componentes dist.)   : 0
  A* x Dijkstra divergentes      : 0        <-- o A* devolve o caminho ótimo
  problemas de continuidade       : 0        <-- as arestas sempre se encostam
  problemas de soma              : 0        <-- soma dos trechos = distância
  problemas de geometria         : 0        <-- comprimento da geometria = distância
  razao rota/linha reta (mediana): 1.33x
  razao rota/linha reta (max.)   : 6.05x

  VALIDACAO APROVADA
```

A razão entre a rota e a linha reta (mediana 1,33×) comprova que o trajeto é
**viário** e nunca um segmento fictício: no caso mais tortuoso, a rota é 6 vezes
mais longa que a reta — exatamente o que se espera em uma malha viária real.

### 10.2 Auditoria de fidelidade geométrica (`npm run fidelity`)

Ferramenta da rodada 4: sorteia **250 rotas** e mede o quanto o traçado se
afasta da malha desenhada (amostragem a cada ~2 m sobre a linha da rota, e não
só sobre os vértices), além de conferir a **soma dos trechos** e a presença de
**todos os vértices** das pernas na geometria devolvida.

```
  DESVIO DA ROTA ATÉ A MALHA ORIGINAL (m)
  rotas analisadas            : 250
  desvio máximo (pior rota)   : 0.44 m
  desvio p95                  : 0.32 m
  desvio médio por rota       : 0.078 m
  rotas com soma de trechos ok: 250
  rotas com soma ERRADA       : 0
  rotas com geometria perdida : 0

  DESVIO ATÉ A REDE COMPLETA (inclui os conectores de junção)
  desvio máximo               : 0.011 m
  desvio p95                  : 0.001 m
  rotas que usam conector      : 63 de 250
  parcela de rota em conector  : máx 0.04 % (lacunas reais de até 1 m)
```

Antes da rodada 4 o mesmo script acusava **35,52 m** de desvio máximo (p95
5,87 m). Os 0,44 m restantes são **lacunas reais da base** (até 1 m entre dois
eixos que não se tocam), cobertas por conectores honestos; contra a rede
completa o traçado é fiel a **1,1 cm**.

### 10.3 Validação visual no mapa (`npm run validar:mapa`)

Aplica a rota real na interface OpenLayers (Chromium headless do Playwright) e
grava as capturas em `updates/04-fidelidade-geometrica/imagens/`. Foi assim que
o defeito original foi confirmado — e corrigido — **no mapa**, e não só no
código. Requer `npx playwright install chromium` e o servidor no ar.

O `test/wfs.test.js` sobe um **GeoServer simulado** que reproduz fielmente as
particularidades do servidor real (falha de `startIndex`, `BBOX` inoperante, `IN`
não suportado, `CQL_FILTER` funcional), de modo que a estratégia de paginação é
exercitada sem depender da Prefeitura.

---

## 11. Limitações conhecidas dos dados viários

> Estas limitações são **do dado**, não do algoritmo. Cada uma foi medida.

0. **A camada muda durante o dia — e isso foi observado ao vivo.** Durante a
   validação da atualização automática o total de eixos da view passou de
   **4.119 → 4.137 → 4.138 → 4.146** em cerca de dez minutos, sem qualquer
   intervenção: a Prefeitura edita a view enquanto a aplicação está no ar.
   Foi exatamente esse cenário que motivou a verificação automática
   ([seção 12](#12-atualização-automática-da-rede-a-view-muda-o-app-acompanha)):
   o servidor detectou a mudança, reconstruiu o grafo e passou a servir a rede
   nova **sem reiniciar**. Os números de nós/arestas deste documento
   (10.874/14.617) correspondem à camada de **4.287 eixos**; com a camada de
   4.119 eixos eram 10.491/14.163 — é o dado que muda, não o método.

1. **Não há informação de nível.** Viadutos e passagens inferiores não são
   distinguíveis de cruzamentos em nível. O motor conecta os cruzamentos
   geométricos e **reporta** os 27 que envolvem uma rodovia. É possível recusá-los
   (`excludeRoadCrossings: true`), ao custo de desligar a conexão em pontos onde o
  apedestre realmente atravessa. **Não há como acertar os dois casos simultaneamente
   com estes dados.**
2. **A camada cobre só a área urbana central.** A extensão vai de lon −46,5673 a
   −46,2840 e lat −23,8000 a −23,6061 — não o município inteiro. Pontos fora dessa
   área são recusados com `FORA_DA_REDE` e a distância medida.
3. **321 componentes conexas.** A maior reúne 9.078 de 10.874 nós (83,5 %). As demais
   são eixos isolados (ruas sem saída, trechos internos). **Não é possível traçar
   rota entre dois pontos em componentes diferentes** — a resposta é `SEM_CAMINHO`.
   (Antes dos conectores de junção eram 338 componentes; a ligação das 103 junções
   com lacuna de até 1 m dissolveu 21 delas.)
4. **Não há calçadas.** A rota corre sobre o **eixo** da via (o eixo da rua), não pelo
   passeio. É a aproximação usual para dados de eixo viário.
5. **Não há restrição a pedestres.** A camada não publica informação de permissão,
   sentido, largura ou faixa de pedestres. Logo, a rota pode incluir trechos de
   rodovia (há 3 eixos com `TPO = ROD`). Para uso operacional seria preciso cruzar
   com outra fonte (ex.:oclucões de pedestres da CET/EMTU).
6. **Não há sentido de circulação.** Como o pedido é *apenas rotas a pé*, o grafo é
   não direcional e nenhum sentido é imposto.
7. **16 partes degeneradas** (vértices coincidentes) e **236 sobreposições
   colineares** foram tratados automaticamente (corte + fusão de duplicidade).
8. **Os nomes vêm de `DSC_LOGRADOURO`**, que é o texto mais descritivo disponível
   (ex.: `AVENIDA QUINZE DE NOVEMBRO`). Quando ausente, o motor usa
   `NOM_LOGRADOURO` e, na falta dele, `Eixo sem nome`.
9. **178 eixos não oficializados** (`COD_LOG = 0`) fazem parte da rede por padrão;
   podem ser excluídos com `includeUnofficialAxes: false`.
10. **Lacunas de até 1 m entre eixos** (102 casos: a mesma rua digitalizada em
   trechos separados) são unidas por **conectores** — arestas honestas, com o
   comprimento real da lacuna e a geometria original das duas pontas
   preservadas. Eles representam **≤ 0,04 %** do comprimento das rotas que os
   usam. Onde a lacuna é maior, **nada é inventado**: a rota simplesmente não
   passa.
11. **A mesma interseção digitalizada de dois lados** pode ter os dois cortes
   separados por alguns milímetros. Isso **não** desloca mais a rota (cada
   aresta mantém a sua própria coordenada): a discrepância é apenas **medida e
   reportada** em `result.warnings` quando passa de 1 cm.
12. **Praças em anel fechado** (44 na camada) são agora percorríveis como
   laços (aresta única com a geometria completa do anel). Antes, 7 delas
   ficavam sem nenhuma aresta e sumiam do mapa de rotas.

---

## 12. Atualização automática da rede (a view muda, o app acompanha)

> **Resposta curta:** sim. O servidor observa a camada `siga:SIGA_EIXO_LOG_OFICIAL_E_NAO`
> sozinho e, quando ela muda, **reconstrói o grafo e troca a rede em uso sem
> reiniciar nada e sem interromper as rotas em andamento**.

### 12.1 Como funciona

| Nível | Quando | O que faz | Custo |
|---|---|---|---|
| **Leve** | a cada **5 min** (padrão) | `GetFeature` com `maxFeatures=1` e compara o `totalFeatures` do servidor com o total em uso | ~600 bytes, ~1 s |
| **Completo** | a cada **6 h** (padrão) | baixa a camada inteira e compara a **impressão digital** (SHA-256) do conteúdo | ~2,7 MB, ~3 s |

A verificação leve é barata e cobre o caso mais comum (a Prefeitura acrescenta
ou remove eixos). A verificação completa baixa o conteúdo e compara a
impressão digital: é a única forma de detectar a **correção de um eixo que já
existia** (rua renomeada, traçado redesenhado) — o total não muda nesses casos.

**Impressão digital** (`fingerprintOf`, em `server/networkService.js`): SHA-256
sobre as feições **ordenadas por `ID`** e com as coordenadas **arredondadas**,
para que a mesma rede produza sempre a mesma impressão e qualquer alteração
real de geometria produza outra.

### 12.2 Troca atômica do grafo

A recarga **não** acontece dentro da requisição que detecta a mudança:

1. a rede nova é baixada e o grafo novo é **construído por inteiro** (nós,
   arestas, conectores, índices);
2. só então `this.state` é substituído — de uma vez só, por atribuição;
3. as requisições em andamento continuam usando o grafo antigo até o fim e
   passam a usar o novo na chamada seguinte.

Nunca existe um grafo "pela metade" em uso. O novo snapshot é gravado em
disco depois da troca, para o próximo arranque.

### 12.3 Resiliência: o WFS pode cair

O GeoServer da Prefeitura não é um serviço com SLA. Se ele ficar lento ou
fora do ar:

* a **verificação leve falha rápido** (timeout de 20 s, 1 tentativa) e o erro
  fica registrado em `update.errors` — a aplicação **não** trava;
* a **rede em uso continua valendo**: rotas são servidas normalmente com os
  dados da última atualização bem-sucedida;
* se o WFS estiver fora do ar **no arranque**, o servidor usa o **snapshot
  local** (mesmo vencido) e avisa no painel da interface
  (*"GeoServer WFS indisponível — servindo o último snapshot local"*);
* quando o WFS volta, a próxima verificação bem-sucedida recompõe a rede
  automaticamente.

### 12.4 Como observar o estado

```bash
# situação da atualização automática
curl -s http://localhost:8080/api/health | jq .update
```

```json
{
  "enabled": true,
  "checkIntervalMs": 300000,
  "deepCheckIntervalMs": 21600000,
  "checkTimeoutMs": 20000,
  "lastCheckedAt": "2026-10-21T21:25:12.004Z",
  "lastChangeAt": "2026-10-21T21:25:12.401Z",
  "lastResult": { "deep": false, "changed": true, "reason": "total de feições alterado (4137 -> 4138)", "serverTotal": 4138, "knownTotal": 4137, "elapsedMs": 1973 },
  "errors": []
}
```

O rodapé de status da interface mostra a **origem dos dados** (GeoServer ou
snapshot local), a **hora da última verificação** e qualquer **aviso** (rede
desatualizada, WFS fora do ar). O painel lateral **não** exibe mais o bloco
"Rede viária" — ele foi removido na rodada 11 a pedido do usuário (§21).

### 12.5 Verificação imediata sob demanda

```bash
# força uma verificação COMPLETA (baixa a camada e compara a impressão digital)
curl -s -X POST http://localhost:8080/api/updates | jq '{ok, deep, changed, reason, serverTotal, knownTotal}'
```

### 12.6 Configuração

Linha de comando (intervalos em **minutos**) e variáveis de ambiente:

```bash
node server/index.js \
  --check-interval 5          # verificação leve a cada 5 min (padrão)
  --deep-check-interval 360   # verificação completa a cada 6 h (padrão)
  --no-auto-update            # desliga a verificação automática
```

```bash
CHECK_INTERVAL_MIN=5 DEEP_CHECK_INTERVAL_MIN=360 NO_AUTO_UPDATE=1 npm start
```

| Opção | Padrão | Efeito |
|---|---|---|
| `--check-interval <min>` | 5 | intervalo da verificação leve |
| `--deep-check-interval <min>` | 360 | intervalo da verificação completa |
| `--no-auto-update` | — | desliga a atualização automática (uso offline) |

Com `--no-auto-update` o servidor funciona exatamente como antes: usa o
snapshot dentro do TTL e só busca no WFS quando necessário.

### 12.7 Recarga manual (continua disponível)

```bash
curl -X POST http://localhost:8080/api/refresh   # invalida o cache e reconstrói
npm run fetch                                    # baixa a rede e grava o snapshot
```

### 12.8 Política de cache

| Item | Valor |
|---|---|
| TTL do snapshot em disco | 6 horas |
| Grafo em memória | até a próxima troca automática (ou `POST /api/refresh`) |
| Em arranque | usa o snapshot se estiver dentro do TTL; senão busca no WFS |
| WFS fora do ar no arranque | usa o snapshot vencido, com aviso na interface |

### 12.9 Detectar mudanças na origem manualmente

A camada não expõe um `timeStamp` de feição utilizável, e o `resultType=hits`
do WFS 1.0.0 com `outputFormat=application/json` devolve `numberOfFeatures="0"`
(só o WFS 1.1.0 em XML é confiável). A comparação usada pela verificação leve
é o `totalFeatures` do GeoJSON:

```bash
curl "https://sigamapa.santoandre.sp.gov.br/geoserver/siga/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=siga:SIGA_EIXO_LOG_OFICIAL_E_NAO&outputFormat=application/json&srsName=EPSG:4326&maxFeatures=1" | jq .totalFeatures
# → 4136
```

### 12.10 Ajustes de comportamento

As opções do grafo ficam em `core/config.js` (`GRAPH_DEFAULTS`) e podem ser
sobrescritas ao construir:

```js
buildGraph(features, {
  snapTolerance: 0.05,          // tolerância de junção
  excludeRoadCrossings: false,  // recusar cruzamentos em que uma via é RODOVIA
  includeUnofficialAxes: true,  // manter eixos com COD_LOG = 0
  pedestrianBlockedTypes: [],   // tipos a excluir para pedestres
  maxSnapDistance: 100,         // distância máxima até a rede
});
```

## 13. Estrutura de diretórios

```
santo-andre-routing/
├── core/                     motor isomórfico (roda no servidor e no navegador)
│   ├── config.js             endpoints, CRS, tolerâncias justificadas
│   ├── armazenamentoLocal.js persistência local (IndexedDB): rotas, sessões,
│   │                         pontos, localizações e fila de sincronização
│   ├── coleta.js             sessão de coleta GPS: filtros de leitura,
│   │                         lacunas estimadas, Plus Code local
│   ├── coresTrechos.js       paleta de cores por trecho da rota
│   ├── enderecoDigital.js    CEP Digital: porta fiel de CalculoGeometriaDAL
│   ├── enderecoDigitalService.js  interface de serviço (local | SIGA)
│   ├── geo.js                projeção UTM 23S (ida e volta), geometria planar
│   ├── fonteGPS.js           fonte de posição real (Geolocation API):
│   │                         permissão, erros e contexto seguro
│   ├── instrucoes.js         instrução do momento (logradouro + manobra
│   │                         deduzidas da geometria)
│   ├── navegacao.js          controlador de navegação (plano, projeção,
│   │                         progresso, chegada, desvio, recálculo)
│   ├── ordemParadas.js       otimização da ordem de visita (fecho métrico,
│   │                         Held-Karp e 2-opt)
│   ├── pontoTrajeto.js       lista de pontos do trajeto (rótulos A, B, C…)
│   ├── rotaParadas.js        trechos na ordem escolhida (reusa o A*)
│   ├── simulador.js          fonte de posição simulada (modo de teste:
│   │                         tempo real, interpolação, cenários)
│   ├── spatialIndex.js       índice espacial de grade uniforme
│   ├── graph.js              construção do grafo (nós, arestas, conexões)
│   ├── router.js             A*, projeção de pontos, montagem do trajeto
│   └── wfs.js                cliente WFS (paginação, retries, diagnóstico)
│
├── server/
│   ├── index.js              servidor HTTP + API + arquivos estáticos
│   └── networkService.js     cache do grafo, snapshot em disco, refresh
│
├── updates/                  histórico: uma pasta por rodada de atualização
│   ├── 01-conectores-e-juncao/
│   ├── 02-melhor-rota-e-estilo/
│   ├── 03-atualizacao-automatica/
│   ├── 04-fidelidade-geometrica/   causa, correções, medições e imagens
│   ├── 05-endereco-digital-e-paradas/  CEP Digital e rota A→B→C→D
│   ├── 06-otimizacao-e-arrastar/  menor rota (TSP) e arraste dos pontos
│   ├── 07-rota-circular/        rota circular A→B→C→D→A (TSP em ciclo)
│   ├── 08-trechos-coloridos/     uma cor por trecho + paradas dinâmicas
│   ├── 09-trechos-selecionaveis/ ocultar trechos sobrepostos
│   ├── 10-navegacao-ativa/        navegação ativa (GPS real + simulador)
│   ├── 11-auditoria-otimizacao/  auditoria da otimização + limpeza do painel
│   ├── 12-caminho-minimo/        correção do menor caminho por par
│   ├── 13-campo-plano/           coleta de campo: plano e persistência local
│   ├── 14-auditoria-ordem-paradas/  auditoria da ordem de visita
│   └── 15-interface-modos/       interface de dois modos + circuito fixo
│
├── data/
│   ├── network.snapshot.json  cache em disco (gerado por "npm run fetch")
│   └── referencias/           evidências: GeoJSON completo + respostas
│                               cruas do WFS (provas da paginação)
│
├── public/                   interface OpenLayers
│   ├── index.html            layout
│   ├── styles.css            tema
│   ├── app.js                mapa, entrada de pontos, desenho da rota
│   ├── navegacaoUI.js        painel da navegação ativa e do simulador
│   ├── coletaUI.js           painel da coleta de campo (rodada 13)
│   ├── sw.js                 Service Worker: aplicativo abre sem conexão
│   ├── manifest.webmanifest  manifesto do PWA (instalável)
│   ├── icon.svg              ícone do aplicativo
│   └── vendor/ol/            OpenLayers 10.6.1 vendorizado (ol.js + ol.css)
│
├── tools/
│   ├── fetch-network.js      baixa a rede e grava o snapshot
│   ├── inspect-layer.js      relatório da estrutura real da camada
│   ├── report-network.js     relatório de qualidade da rede
│   ├── validate-routes.js    validação cruzada A* × Dijkstra
│   ├── audit-fidelity.js     fidelidade geométrica da rota (rodada 4)
│   ├── validar-mapa.mjs      validação visual no navegador (Playwright)
│   ├── validar-paradas.mjs   validação visual do Endereço Digital + paradas
│   ├── validar-otimizacao.js  otimização na rede real (várias ordens)
│   ├── validar-otimizacao.mjs  validação visual da otimização + arraste
│   ├── validar-circular.mjs  validação visual da rota circular
│   ├── validar-trechos-coloridos.mjs  validação visual dos trechos coloridos
│   ├── validar-navegacao.mjs  validação visual da navegação ativa
│   ├── auditar-otimizacao.js auditoria numérica do modo otimizado (rodada 11)
│   ├── auditar-caminho-minimo.js auditoria do menor caminho por par (rodada 12)
│   ├── auditar-ordem-paradas.js  auditoria da ordem de visita (rodada 14)
│   ├── validar-offline.mjs   validação da coleta de campo no navegador (13)
│   ├── validar-modos.mjs     validação visual dos dois modos e do circuito (15)
│   ├── lib-interface.mjs     auxiliares de interface dos validadores (16)
│
├── test/                     243 testes (node:test)
│   ├── helpers.js            fábricas de features sintéticas + snapshot real
│   ├── graph.test.js
│   ├── router.test.js
│   ├── wfs.test.js           GeoServer simulado
│   ├── api.test.js
│   ├── update.test.js        atualização automática (GeoServer simulado)
│   ├── fidelity.test.js      fidelidade geométrica da rota (rodada 4)
│   ├── enderecoDigital.test.js  Endereço Digital e paradas (rodada 5)
│   ├── ordemParadas.test.js  otimização da ordem de visita (rodada 6)
│   ├── circular.test.js     rota circular A→…→A (rodada 7)
│   ├── coresTrechos.test.js cores por trecho (rodada 8)
│   ├── navegacao.test.js     navegação ativa, GPS e simulador (rodada 10)
│   ├── otimizacaoAuditoria.test.js  auditoria da otimização (rodada 11)
│   ├── caminhoMinimo.test.js    menor caminho por par (rodada 12)
│   ├── armazenamentoLocal.test.js  persistência local (rodada 13)
│   ├── coleta.test.js          sessão de coleta GPS (rodada 13)
│   ├── ordemOtimizada.test.js  ordem otimizada: objetivo, desempate e
│   │                             consistência entre custo e desenho (rodada 14)
│   ├── interfaceModos.test.js  interface de dois modos e circuito fixo (15)
│   └── interfacePlanejamento.test.js  interface de planejamento em etapas (16)
│
├── mobile/                   aplicativo React Native (Android) — rodada 17
│   ├── app/                  navegação por arquivo (expo-router)
│   ├── src/
│   │   ├── domain/           regras de negócio (sem React)
│   │   ├── motor/            integração com o motor (reusa ../core)
│   │   ├── data/             porta de dados (a API .NET entra aqui)
│   │   ├── estado/           estado da tela
│   │   ├── ui/               tema, ícones e componentes
│   │   └── screens/          telas
│   ├── docs/                 auditoria e plano da migração
│   ├── metro.config.js       apelido @motor/* → ../core/*
│   └── tsconfig.json         paths + allowJs (tipos inferidos do motor)
│
├── package.json              sem dependências de runtime (Playwright só como dev)
└── README.md
```

### API interna do motor

```js
import { buildGraph } from './core/graph.js';
import { routeOnGraph } from './core/router.js';

const graph = buildGraph(features, options);   // 0,9 s para 4.287 eixos
const route = routeOnGraph(graph, {lon, lat}, {lon, lat});
```

---

## 14. Atualizações por rodada (`updates/`)

O projeto é **entregue em rodadas**. Cada rodada tem uma pasta própria em
`updates/`, com o pedido original, as decisões, os arquivos tocados, como
validar e o resultado medido — além das capturas de tela da validação:

| Pasta | Rodada | Entrega |
|---|---|---|
| `updates/01-conectores-e-juncao/` | conectores de junção de 1 m, duplicidades, A\* correto | 10.491 nós · 14.163 arestas · 317 componentes · **81 rotas novas** · 683 encurtadas |
| `updates/02-melhor-rota-e-estilo/` | sempre a melhor rota + base clara com ruas em destaque | **0 divergências** A\* × Dijkstra em 2.000 pares · cartografia em 3 camadas |
| `updates/03-atualizacao-automatica/` | a view mudou: o app acompanha sozinho | leve 5 min + completa 6 h · troca atômica · **64/64 testes** |
| `updates/04-fidelidade-geometrica/` | a rota precisa **seguir o eixo desenhado** (curvas, mudanças de direção) | desvio máximo **35,52 m → 0,44 m** · contra a rede completa **0,011 m** · 7 praças em anel recuperadas · **72/72 testes** · prova no mapa |
| `updates/05-endereco-digital-e-paradas/` | informar os pontos pelo **Endereço Digital** e traçar rota com **paradas A, B, C…** na ordem do usuário | porta fiel de `CalculoGeometriaDAL` · interface de serviço pronta para o SIGA · **88/88 testes** · 7,47 km A→B→C na aplicação real |
| `updates/06-otimizacao-e-arrastar/` | a **menor rota** otimizada (ordem das paradas) + **arrastar a ordem no painel lateral** + as **duas opções** (menor rota × ordem do usuário) | Held-Karp exato até 16 paradas · economia de **4.081–16.950 m (8,5–28 %)** na rede real · arraste da ordem com recálculo automático · **103/103 testes** |
| `updates/07-rota-circular/` | **rota circular** A → B → C → D → **A** (linha de ônibus), com as duas estratégias (menor ciclo × ordem do usuário) | fecho calculado na rede real (nunca linha reta) · retorno tracejado no mapa · economia de **8.004 m (28,5 %)** · **116/116 testes** |
| `updates/08-trechos-coloridos/` | **uma cor por trecho** na visualização (inclusive o retorno à origem), **quantidade de paradas dinâmica** e os dois modos de roteamento | paleta de 12 cores testada (vizinhas sempre diferentes) · legenda trecho↔cor reconstruída a cada recálculo · **123/123 testes** |
| `updates/09-trechos-selecionaveis/` | **ocultar/mostrar trechos** para resolver as sobreposições (clique no mapa, na legenda ou no painel) | a rota e a distância **não mudam** ao ocultar · estado visível/oculto na legenda e no painel · botão "Mostrar todos" |
| `updates/10-navegacao-ativa/` | **navegação ativa** sobre a rota calculada: GPS real + **modo de teste** (simulador), progresso sobre a geometria, chegada, desvio com **recálculo pela mesma API** | um controlador para as duas fontes · desvio com tolerância e persistência · recálculo preservando a ordem das paradas · faixa "MODO DE TESTE" · **142/142 testes** · validação visual 15/15 |
| `updates/11-auditoria-otimizacao/` | **auditoria** do modo "Menor rota total" sobre a rede real + **limpeza do painel** | matriz de custos × força bruta × Held-Karp · trecho desenhado = célula da matriz · **o empate não é defeito** (matriz simétrica ⇒ ciclo reverso tem o mesmo custo) · 15 testes novos · 2 blocos do painel removidos · nota compacta com o método e a economia |
| `updates/12-caminho-minimo/` | **correção da etapa 1** (o menor caminho entre cada par): as arestas virtuais do acesso à rede recebiam como custo o **nº de caracteres do ID** em vez do comprimento métrico | 1,8 % dos pares com custo até 135,08 m acima do mínimo e 2,5 % assimétricos → **0 e 0** · referência independente · 8 testes (3 deles falhavam com o defeito) · cenário do print reproduzido |
| `updates/14-auditoria-ordem-paradas/` | **auditoria da ordem de visita**: o caso do print reproduzido na rede real, todas as ordens do circuito enumeradas e o algoritmo conferido (matriz, Held-Karp, reconstrução, retorno à origem, desenho × custo) | **nenhum defeito no cálculo** — o empate de 1.720 m é real (o ciclo e o seu reverso custam o mesmo) · nova opção **“Menor rota total (saída curta)”** que desempata pela primeira perna **sem alterar o total** · 16 testes novos · **218/218 testes** |
| `updates/15-interface-modos/` | **interface de modos**: os rádios de tipo e de ordem viraram **dois botões** (“Rota otimizada” × “Ordem das paradas”), o trajeto é **sempre um circuito** (origem → paradas → volta à origem) e o painel ficou origem → paradas → modo → calcular | o otimizador **não foi tocado** (mesma implementação validada da rodada 14) · modo “usuário” intacto · arraste, remoção e renumeração preservados · 15 testes novos · **233/233 testes** · validação visual dos dois modos **APROVADA**, 0 erros de console |
| `updates/13-campo-plano/` | **coleta de campo**: diagnóstico do projeto, plano de evolução em 7 fases e a primeira etapa funcional — rota planejada, sessão de coleta GPS e localização de residência **persistidas no aparelho** | IndexedDB com transações e fila de sincronização · coleta sobrevive ao recarregamento (mesma sessão) · Plus Code calculado localmente · sem dependência nova · **202/202 testes** · validação de navegador **32/32** com a rede desligada |
| `updates/17-react-native/` | **início da migração para React Native (Android)**: estrutura do aplicativo, primeira tela de planejamento e o **motor original rodando dentro do aparelho** | **`core/` com zero linhas alteradas** — o app usa os mesmos arquivos (`@motor/*` → `../core/*`) · teste de **equivalência** com o motor (13/13) · valores de referência preservados (21.590 m / 30.863 m) · bundle Android gerado · **aplicação web intacta (243/243)** |
| `updates/18-identidade-siga-mapa/` | **identidade visual do SIGA Santo André** no aplicativo mobile + **ícone da marca** + **tela do mapa** com o caminho real | paleta idêntica à da web (`#0f1419`, `#2f81f7`, `#2ea043`…, raio 8 px) · ícone do app, adaptativo, splash e favicon feitos do arquivo enviado · traçado real do motor em SVG, na cartografia da web (halo, contorno, cor por parte, retorno tracejado, marcadores) · projeção EPSG:3857 (a mesma da web) · **24/24 testes** no mobile · **VALIDAÇÃO WEB APROVADA (26/26)** · **aplicação web intacta (243/243)** · **`core/` sem uma linha alterada** |
| `updates/16-interface-planejamento/` | **interface de planejamento em quatro etapas** (para quem não conhece o roteamento): “Ponto de partida”, “Locais de visita” numerados, dois cartões de organização e “Calcular meu percurso” | terminologia falada (“1ª visita”, “Melhor percurso”, “Seguir minha ordem”) · coordenadas atrás das opções avançadas · menu de ações por cartão + arraste · legenda recolhível · **cálculo intocado** (mesma implementação da rodada 14) · 10 testes novos · **243/243 testes** · validação visual **APROVADA**, 0 erros de console |
| `versoes/r10-simulador/` | **cópia paralela** do projeto no estado da **rodada 10** (navegação ativa + **simulador de iniciar rota**), criada para trabalhar nessa versão sem perder nada do que veio depois | **motor atual preservado** (A\* corrigido, Held-Karp exato; os 4 arquivos de navegação são **byte-idênticos**) · camada web e OpenLayers vendorizado copiados · **218/218** testes · validação de navegação **15/15** no navegador real (simulação, desvio detectado e trajeto recalculado) · porta própria **8091** |
| `updates/20-visual-foto/` | **visual das duas versões igualado à imagem de referência**: aba ativa verde da marca, eixo não oficializado marrom, cartão do ponto com crachá + título em caixa alta + botões ⊘ ↑ ↓, coordenadas sempre visíveis, legenda com as linhas da foto, chips com ícone, e **mapa-base de tiles no aplicativo** | cores **medidas pixel a pixel** na foto · **motor intocado** (`core/` e `server/` com SHA-256 conferido) · **255/255** testes no projeto · **29/29** no mobile · validação visual da web **27/27** e do aplicativo **34/34**, 0 erros de console · percurso **6,54 km** nas duas |
| `updates/19-unified-visual/` | **reformulação visual unificada** da aplicação web e do aplicativo React Native, com a mesma identidade e a mesma organização (cabeçalho SIGA + abas **Dividido · Mapa · Painel**, mapa como herói, legenda sobreposta, painel **“Pontos do trajeto”**) — **tema claro preservado** | contrato de tokens (`docs/design-tokens.md`) com **teste** que compara web × RN · rede viária desenhada por baixo do traçado também no RN · “selecionar no mapa” e coordenadas no aplicativo · **motor intocado** (`core/` e `server/` com SHA-256 conferido) · **255/255** testes no projeto · **29/29** no mobile · validação visual da web **27/27** e do aplicativo **34/34**, 0 erros de console |
O código que roda continua morando na raiz do projeto — `updates/` é o
**histórico**, não uma segunda cópia da fonte. A pasta
`updates/10-navegacao-ativa/pacote/` traz uma cópia dos arquivos da
última rodada, para quem quiser guardar esse pacote.

## 15. Endereço Digital (CEP Digital) e rota com múltiplas paradas

### 15.1 O que é o Endereço Digital

O **CEP Digital** de Santo André é o formato *Open Location Code* (Plus Code)
usado pela Prefeitura: um código curto como **`8FP9+J6`** que identifica um
ponto com precisão de ~14 m. A lógica vem da classe C# **`CalculoGeometriaDAL`**
(namespace `PortalSiga.OracleDAL.AreaRestrita`), fornecida pela equipe do SIGA.

Como o protótipo roda em Node.js/navegador — sem runtime C# e sem Oracle — a
parte **autocontida** da classe (o CEP Digital) foi **portada linha a linha**
para `core/enderecoDigital.js`, com os **mesmos nomes públicos**
(`CoordenadaNaRegiao`, `CodificarCompleto`, `CodificarCurto`, `Completar`,
`NormalizarCepDigitalParaBanco`, `NormalizarCoordenadaParaBanco`) e as mesmas
constantes do município:

| Constante | Valor |
|---|---|
| alfabeto | `23456789CFGHJMPQRVWX` (OLC) |
| ponto de referência | −23,6635 / −46,5320 (centro de Santo André) |
| resoluções | 20°, 1°, 0,05°, 0,0025°, 0,000125° |
| recorte aceito | lat −24,1…−23,3 · lon −46,9…−46,2 |

Verificações da porta (500 pontos aleatórios de Santo André): o ciclo
**coordenadas → código curto → código completo → coordenadas** fecha em
**500/500**, com erro máximo de **7 m** na latitude e **6,4 m** na longitude
( metade da célula de 0,000125°).

> Detalhes da classe (métodos, assinaturas, formatos, tratamento de erro e as
> peculiaridades mantidas na porta) em
> `updates/05-endereco-digital-e-paradas/README.md`.

### 15.2 Estados distinguished pela interface

| Estado | Significado |
|---|---|
| `VAZIO` | nada foi digitado |
| `MALFORMADO` | a forma do código não é válida |
| `VALIDADO` | código válido, **ainda não convertido** em coordenadas |
| `CONVERTIDO` | coordenadas obtidas (o ponto vira um marcador no mapa) |
| `FORA_DA_AREA` | código válido, mas o ponto cai fora do recorte do município |
| `INDISPONIVEL` | o serviço corporativo do SIGA não está acessível |
| `FALHA` | erro na resolução |

**Nunca se inventa coordenada**: quando a conversão falha, o ponto continua
sem posição e a rota não é calculada.

### 15.3 Paradas múltiplas (A, B, C, D…)

A lista de pontos é gerenciada por `core/pontoTrajeto.js` (isomórfico, sem DOM,
coberto por testes). O **rótulo e o tipo derivam da posição**:

```
índice 0        → A  (origem, verde)
índices 1..n-2  → B, C, …  (paradas, azul)
índice n-1      → destino (vermelho)
```

Por isso **remover** ou **reordenar** pontos rotula tudo de novo
automaticamente. A origem e o destino permanecem nas extremidades; as paradas
intermediárias podem ser movidas com ↑/↓.

### 15.4 Cálculo na ordem do usuário

`core/rotaParadas.js` **não reimplementa** o roteamento: para cada par
consecutivo de pontos ele chama `routeOnGraph` (o mesmo A\* usado antes) e
concatena as geometrias na ordem pedida. O resultado traz:

* **distância de cada trecho** e a **distância total**;
* o **número de paradas** e a **sequência** (`A → B → C`);
* a **distância de acesso** de cada ponto até a rede viária (a "conexão de
  acesso" fica visível e medida — a geometria da rua não é alterada);
* os **erros por trecho**: se um trecho não tem caminho, a resposta traz
  `reason: 'TRECHO_SEM_CAMINHO'` e `falha: {de, para, message}` — **sem
  desenhar linha reta** para tapar a falha.

A ordem do usuário é respeitada: **não há** otimização automática da ordem de
visita (funcionalidade futura, separada).

### 15.5 Arquitetura para a futura integração com o SIGA

```
core/enderecoDigital.js          porta fiel da parte de CEP Digital (sem Oracle)
core/enderecoDigitalService.js   INTERFACE de serviço: local | siga
core/pontoTrajeto.js             lista de pontos (rótulos, ordem)
core/rotaParadas.js              orquestração dos trechos
server/index.js                  + /api/endereco-digital, + /api/rota-paradas
public/app.js                    apenas renderização — nenhuma regra de negócio
```

O **modo `siga`** (adaptador para o serviço corporativo) está isolado e, neste
ambiente, **não há** Oracle do SIGA, credenciais nem rede corporativa: ele
responde `INDISPONIVEL` com a explicação do que falta, **sem inventar
resultados**. Quando o serviço estiver disponível, basta injetar um
`conector` com a forma do Oracle — nenhuma outra linha muda. **Credenciais e
strings de conexão nunca são enviadas ao navegador.**

### 15.6 Verificação

```bash
npm test                # 88 testes (16 desta rodada)
npm run validar:paradas # validação visual no navegador (A → B → C)
```

Resultado no navegador (capturas em `updates/05-endereco-digital-e-paradas/imagens/`):
A = `8FP9+J6` → `588M8FP9+J6`, B = `8FQV+9X` → `588M8FQV+9X`, C por
coordenadas → rota de **7,47 km**, **1 parada**, **2 trechos**, sequência
**A → B → C**, acesso da parada B de **75,85 m** até a avenida.

---

---

## 16. Rota otimizada (menor rota) e arrastar os pontos no mapa

### 16.1 O pedido e a prioridade das duas opções

> *"preciso que a menor rota seja otimizada, e que o usuário possa arrastar os
> pontos de origem/destino e os pontos de parada para mudar a rota, e que tenha
> duas opções, a rota otimizada e a rota escolhida pelo usuário (prioridade
> definida a partir do escopo usado)"*.

A prioridade vem do escopo acumulado do projeto:

* a **rodada 2** fixou como requisito *"sempre escolher a melhor rota"*;
* a **rodada 5** pediu a ordem do usuário (e mandou **não** otimizar);
* a **rodada 6** volta a exigir a menor rota otimizada **e** as duas opções.

Logo: **"Menor rota" (otimizada) é o modo padrão**, e **"Ordem do usuário"**
continua disponível, explícita e respeitada integralmente. Nada é reordenado
sem o usuário saber — o painel mostra a *sequência informada* e a *sequência
percorrida*.

### 16.2 O motor de caminhos não mudou

O roteamento continua o mesmo motor validado: **A\*** sobre o grafo real do
WFS, com heurística admissível em metros, **0 divergências contra Dijkstra** em
1.500 pares. A rodada 6 acrescenta a camada de **ordem de visita** por cima
dele — o *problema do caixeiro viajante* sobre o **fecho métrico** da rede.

### 16.3 Como a ordem é escolhida

| Etapa | O que é feito |
|---|---|
| **Fecho métrico** | `matrizDistancias()` calcula, para cada par de pontos, a **distância de menor caminho viano** entre eles (não é distância em linha reta). A matriz é simétrica e satisfaz a desigualdade triangular — testado. |
| **Ordem** | Até **16 paradas intermediárias**: **Held-Karp** (programação dinâmica), que dá a ordem **ótima** — provadamente a melhor. Acima disso: **vizinho mais próximo + 2-opt** (heurística; o 2-opt nunca piora). |
| **Fixo** | A **origem** e o **destino** não mudam de lugar: só a ordem das paradas intermediárias é otimizada. |
| **Comparação** | A resposta traz o custo da ordem informada e da ordem escolhida → a **economia** em metros e em %. |

O método aplicado é sempre declarado (`otimizacao.metodo = "exato" |
"heuristico"`) e aparece no painel — **nunca se promete ótimo quando a
heurística foi usada**. Acima de 30 pontos a API recusa com
`LIMITE_DE_PONTOS`.

Se os pontos estiverem em **componentes desconexos** da rede (a camada tem 342
componentes), a resposta é `PONTOS_SEM_CONEXAO`, dizendo exatamente quais
pontos não se alcançam — e **nenhuma linha reta** é desenhada para tapar a
falha.

### 16.4 Arrastar a ordem dos pontos no painel lateral

Na lista **PONTOS DO TRAJETO**, cada parada tem uma **alça** (o pontilhado à
esquerda do rótulo). Arrastando **a alça** a parada **muda a ordem de visita**:
a linha arrastada troca de lugar com a linha sobre a qual ela é solta, e a rota
é **recalculada automaticamente**.

> A alça é a **única** parte arrastável do cartão — de propósito: arrastar o
> cartão inteiro atrapalharia a edição dos campos e a interação com o mapa
> (ver [seção 17](#17-rota-circular-a--b--c--d--a)). A área de clique da alça é
> ampliada e ela é focável pelo teclado; além disso, cada cartão tem os botões
> **↑ / ↓**, que fazem a mesma reordenação sem arraste.

Regras (em `core/pontoTrajeto.js`, isomórfico e testado):

| Regra | Porquê |
|---|---|
| a **origem** (1ª linha) e o **destino** (última linha) não são arrastáveis | definem o começo e o fim do trajeto |
| a parada só ocupa a faixa das paradas intermediárias | nunca vira origem nem destino |
| os **rótulos são posicionais** (A = origem, última = destino) | arrastar troca o **conteúdo** das linhas; a lista continua A → B → C → D com a nova ordem embaixo |
| a nova lista só é seguida como está no modo **"Ordem do usuário"** | no modo "Menor rota" a otimização reordena (comportamento pedido) — a interface mostra *sequência informada* × *sequência percorrida* |

Durante o arraste, a linha arrastada fica esmaecida e a linha alvo ganha um
contorno âmbar com a tarja **"SOLTAR AQUI"**.

### 16.5 Extra: arrastar os marcadores no mapa

O pedido original também falava em *"arrastar os pontos de origem/destino e os
pontos de parada para mudar a rota"*, então o arraste dos marcadores no mapa
foi mantido como **funcionalidade adicional**: ao soltar o marcador, a nova
coordenada vira a posição do ponto, o Endereço Digital anterior é **zerado**
(não vale mais para a nova posição — nada é inventado) e a rota é
**recalculada automaticamente**.

Detalhe importante do OpenLayers 10.6 (verificado no navegador, não na
documentação): o `Translate` **não tem `setFeatures`**, a opção `features`
exigiria uma `ol.Collection` e moveria o conjunto inteiro de uma vez. A
solução adotada restringe o arraste pela **camada**:
### 16.6 Como verificar

```bash
npm run validar:tsp        # otimização na rede real (6 pontos, várias ordens)
npm run validar:otimizacao # validação visual no navegador (arraste incluído)
npm test                   # 116 casos, incluindo os 15 da otimização e os 13 do circuito
```

Resultados medidos na rede real (Santo André, 4.545 eixos):

| Ordem informada | Distância do usuário | Rota otimizada | Economia |
|---|---|---|---|
| A→E→D→C→B→F | 47.743 m | 43.662 m | 4.081 m (8,5 %) |
| A→D→B→C→E→F | 51.460 m | 43.662 m | 7.797 m |
| A→D→E→B→C→F | 57.040 m | 43.662 m | 13.377 m |
| A→C→D→E→B→F | 60.613 m | 43.662 m | **16.950 m (28,0 %)** |

E na aplicação real (Chromium headless): A `8FWR+WP` → B → C → D dá
**23,32 km** na ordem do usuário e **15,32 km** na menor rota
(**8.004 m economizados, 34,3 %**, método exato em 27 ms).

**Arrastando a ordem no painel** (modo "Ordem do usuário"): antes → B =
−46,532930 / −23,698003 e C = −46,504766 / −23,645216, a **23,20 km**; depois
do arraste B e C trocaram de lugar e a rota foi recalculada para **15,12 km**.
Arrastar o marcador B **no mapa** também recalcula a rota (23,32 km →
23,20 km).

> Detalhes completos (arquivos, testes, pegadas do OpenLayers, capturas) em
> `updates/06-otimizacao-e-arrastar/README.md`.

## 17. Rota circular (A → B → C → D → A)

### 17.1 O que é

Uma rota **circular**, no estilo *linha de ônibus*: a caminhada sai de **A**,
passa pelas paradas B, C, D… e **volta para A**. A origem é fixa e o **retorno
à origem é automático** — não existe um segundo cartão de destino para
preencher.

Na interface:

```
TIPO DE TRAJETO
  (•) Ida e volta   — A → paradas → destino
  ( ) Circuito       — A → paradas → A (linha de ônibus)

ORDEM DO TRAJETO
  (•) Menor rota     — otimiza a ordem das paradas (TSP)
  ( ) Ordem do usuário — respeita a sequência A → B → C…
```

No modo circuito:

* o cartão de **destino some** e o primeiro cartão passa a ser
  **"A — Origem · início e fim"**;
* o botão **Inverter** fica desabilitado (no circuito a origem é fixa);
* a legenda troca "Destino" por **"Retorno à origem"** (amarelo tracejado);
* o mapa desenha **cada trecho separadamente** e o **trecho de retorno
  tracejado**, para ficar evidente onde o circuito fecha;
* o painel mostra **Tipo de trajeto**, **Sequência percorrida** e
  **Retorno à origem** (de → para · metros).

### 17.2 O retorno é um trecho de verdade

O fechamento **não** é um artefato de desenho: ele é calculado pelo mesmo
motor (A\* sobre o grafo do WFS), da última parada até a origem. Por isso:

* tem o **comprimento real** do caminho viário;
* tem **geometria vinda da rede** — nunca uma linha reta;
* é sinalizado (`retorno: true`) para ser desenhado tracejado e listado
  separadamente;
* se não houver caminho para voltar, o erro é explícito e diz que a falha é
  **no retorno**.

### 17.3 O TSP em ciclo

| | Ida e volta | **Circuito** |
|---|---|---|
| Origem | A | A (**fixa**) |
| Destino | último ponto, livre | **não existe** (é a própria origem) |
| Nº de trechos | N − 1 | **N** (o último é o fecho) |
| Otimização | Held-Karp **aberto** (origem e destino fixos) | Held-Karp **em ciclo** (`fim = 0`) — o custo inclui `D[última parada][origem]` |

O fecho métrico é o mesmo da rodada 6 (distância de menor caminho **viário**
entre cada par de pontos), então a solução exata continua válida. Acima de 16
paradas intermediárias o método passa a ser heurístico e a interface diz isso.

### 17.4 Como verificar

```bash
npm run validar:circular   # validação visual no navegador (circuito + arraste)
npm test                  # 116 casos, incluindo os 13 do circuito
```

Resultados medidos na rede real (Santo André, 4.545 eixos), com os mesmos
quatro pontos da rodada 6 (A = `8FWR+WP`):

| Trajeto | Ordem do usuário | Menor rota | Economia |
|---|---|---|---|
| Ida e volta | 23.323 m (A→B→C→D) | 15.320 m (A→C→B→D) | 8.004 m (34,3 %) |
| **Circuito** | 28.092 m (A→B→C→D→**A**) | 20.088 m (A→D→B→C→**A**) | 8.004 m (28,5 %) |

O trecho de retorno do circuito na ordem do usuário mede **4.768 m** e é
calculado na rede (não é a reta entre os pontos). Na aplicação real
(Chromium headless): modo otimizado **20,09 km**, modo usuário **28,09 km**,
o arrraste de um card no painel troca a ordem e recalcula a rota
(28,09 → 20,16 km), e o botão "Inverter" fica indisponível.

> Detalhes completos (arquivos, testes, modelo do TSP em ciclo, capturas) em
> `updates/07-rota-circular/README.md`.

---

## 18. Trechos coloridos, quantidade dinâmica de paradas e modos de roteamento

### 18.1 Uma cor por trecho

Cada trecho consecutivo da rota — A → B, B → C, C → D … e, no circuito, o
**retorno D → A** — é desenhado na **sua própria cor**:

```
A → B   azul      #1d4ed8
B → C   verde     #15803d
C → D   laranja   #ea580c
D → E   roxo      #7c3aed
E → A   carmim    #be123c   (no circuito: o retorno, tracejado)
```

A cor representa o **trecho entre duas paradas** — não a posição de uma
parada nem o modo de roteamento (a rota inteira não é azul no modo otimizado e
verde no modo do usuário). As regras, garantidas por teste:

* trechos **adjacentes** têm cores **diferentes**;
* quando a paleta (12 cores) se esgota, a reutilização é **organizada**
  (percurso em ciclo) e **nunca** repete a cor do trecho vizinho;
* a atribuição é **determinística** — servidor e navegador usam o mesmo módulo
  (`core/coresTrechos.js`) e concordam.

O traço no mapa manteve a cartografia de sempre (halo branco + contorno
escuro); só o **núcleo** assume a cor do trecho, o que preserva a legibilidade
sobre o mapa-base claro.

### 18.2 A legenda

A legenda ganhou a seção **TRECHOS DA ROTA**, com a correspondência entre cada
trecho, a sua origem, o seu destino e a sua cor:

```
TRECHOS DA ROTA
  ▬ A → D
  ▬ D → E
  ▬ E → B
  ▬ B → C
  ▬ C → A  retorno
```

Ela é **reconstruída a cada recálculo** — quando a otimização muda a
sequência, quando os cards são reordenados, quando um endereço é editado e a
rota recalculada ou quando uma parada é removida. O painel de resultado
mostra o mesmo chip de cor ao lado de cada linha de trecho.

### 18.3 Quantidade dinâmica de paradas

O botão **"+ Adicionar parada"** nunca teve limite: a lista de pontos é uma
lista pura, e cada card pode ser editado, removido e reordenado (arrastar no
painel ou botões ↑/↓). O único teto é do **servidor** (80 pontos por
requisição) — é uma proteção de tempo, porque a otimização custa um caminho
mínimo na rede por par de pontos; a mensagem de recusa diz isso e oferece o
modo "ordem do usuário", que não tem esse limite.

Remover uma parada agora **recalcula** a rota (ou limpa o desenho e a legenda,
se o trajeto deixou de ser calculável): nunca sobram geometrias antigas no
mapa.

### 18.4 Os dois modos

| Modo | O que faz |
|---|---|
| **Menor rota total** | minimiza a **distância total do circuito, incluindo o retorno à origem** (TSP em ciclo). Até 16 paradas intermediárias a solução é **exata** (Held-Karp); acima disso é heurística — e a interface **declara** ("heurístico (vizinho mais próximo + 2-opt)"), nunca prometendo o ótimo global |
| **Ordem do usuário** | respeita **exatamente** a ordem dos cards (alterada por drag-and-drop), calculando os caminhos entre paradas consecutivas **e o retorno à origem** |

O motor de roteamento, a geocodificação e o Endereço Digital não foram
alterados: o caminho mínimo continua sendo o mesmo A\* sobre o grafo real do
WFS (0 divergências contra Dijkstra em 1.500 pares).

### 18.5 Como verificar

```bash
npm run validar:trechos   # validação visual: cores, legenda, arraste, remoção
npm test                  # 123 casos, incluindo os 7 de cores
```

Medido na aplicação real (Chromium headless, 5 paradas no mesmo componente da
rede): *Menor rota total* **36,88 km** (A → D → E → B → C → A), *Ordem do
usuário* **47,46 km** (A → B → C → D → E → A); arrastar um card recalcula
(**36,95 km**) e a legenda acompanha; remover uma parada encolhe a
visualização (4 trechos, **30,89 km**).

> Detalhes completos (arquivos, testes, capturas) em
> `updates/08-trechos-coloridos/README.md`.

---

## 19. Trechos selecionáveis (ocultar as sobreposições)

### 19.1 O problema

Numa rota circular o trecho de **retorno à origem** quase sempre refaz parte
do caminho de ida (é a mesma rua). Com um traço por trecho, o de cima **cobre**
o de baixo: a legenda continua dizendo que os dois existem, mas o mapa não
deixa ler o de baixo.

Isso **não é um erro de cálculo** — as duas geometrias são as verdadeiras e a
sobreposição é um fato do trajeto. Desenhar um desvio falso para evitá-la
falsearia a rota, e isso não é feito.

### 19.2 A solução: o usuário escolhe o que ver

| Onde | Como |
|---|---|
| **Mapa** | clique em cima do trecho (o cursor vira "mão" sobre ele) |
| **Legenda** | clique na linha do trecho — ela é um botão de verdade (funciona com Enter/espaço) |
| **Painel** | clique na linha do trecho da lista "Trechos" (também focável pelo teclado) |

Clicar de novo mostra o trecho; o botão **"Mostrar todos"** (que aparece só
quando há trechos ocultos) restaura tudo.

O trecho ocultado **deixa de ser desenhado**; na legenda e no painel ele fica
esmaecido, com o swatch **vazado** e o rótulo **riscado**, e o título passa a
mostrar quantos trechos estão visíveis ("3/4 visíveis").

### 19.3 O que não muda

Ocultar um trecho é **puramente visual**: a distância total e por trecho, a
geometria gravada, a ordem das paradas, o resultado da otimização e o
enquadramento do mapa permanecem exatamente iguais. A interface diz isso no
status ("*Trecho ocultado: D → A. A rota e a distância não mudaram.*").

Um recálculo (ou um arraste) redesenha a rota e **todos os trechos voltam a
ficar visíveis** — as correspondências do novo trajeto são outras.

### 19.4 Como verificar

```bash
npm run validar:trechos   # etapas 6 e 7: ocultar pela legenda, pelo mapa e restaurar
```

Medido na aplicação real: com 4 trechos, ocultar um pela legenda deixa **3 de
4** visíveis e a distância segue **30,89 km** (30,89 km antes); clicar de novo
mostra; "Mostrar todos" restaura; e o **clique no mapa** sobre o retorno à
origem o oculta ("Trecho ocultado: D → A").

> Detalhes completos (arquivos, capturas, notas técnicas) em
> `updates/09-trechos-selecionaveis/README.md`.

---

---

## 20. Navegação ativa (GPS real + modo de teste)

A rota calculada deixa de ser só um desenho: ela passa a ser **um trajeto
que se acompanha**. A navegação **não recalcula a rota** — ela usa exatamente
a geometria que já foi desenhada (e, se precisar, pede um recálculo **pela
mesma API**, preservando a ordem das paradas).

### 20.1 O painel

Sobre o mapa, durante a navegação:

| Campo | De onde vem |
|---|---|
| **Instrução do momento** | logradouro realmente percorrido + manobra deduzida do **ângulo da geometria** |
| **Próxima parada** e distância | medida **sobre a geometria da rota** (nunca em linha reta) |
| **Progresso** | distância percorrida sobre a polilinha ÷ total da rota |
| **Posição** e **precisão** | última leitura do GPS (ou da simulação) |
| **Trecho** | em que perna (A → B, B → C…) o usuário está |

Botões: **Pausar/Continuar**, **Centralizar** (devolve o acompanhamento
automático) e **Encerrar** (libera o GPS e fecha o painel). Arrastar o mapa
a qualquer momento **assume o controle** da visão — o mapa não "puxa de
volta".

### 20.2 Um controlador, duas fontes

O controlador (`core/navegacao.js`) não sabe de onde vêm as posições: as duas
fontes entregam o mesmo formato e **as mesmas regras** valem para as duas.

| | GPS real (`core/fonteGPS.js`) | Modo de teste (`core/simulador.js`) |
|---|---|---|
| origem | `navigator.geolocation.watchPosition` | posição **interpolada sobre a geometria** |
| quando começa | **só após o clique** em "Começar trajeto" | idem |
| erros | permissão negada · sinal indisponível · tempo esgotado · contexto inseguro | cenários: desvio, perda de sinal, recuperação, coordenadas manuais, GPS impreciso |
| velocidade | a do caminhada | 1× · 2× · 5× · 10× · 25× · 50× |
| marca na tela | selo **GPS REAL**, marcador azul | selo **MODO DE TESTE**, faixa permanente, marcador roxo |

O simulador calcula o deslocamento pelo **tempo real decorrido** (1 s de
simulação vale o mesmo com 1 ou 10 atualizações) e nunca inventa caminho: a
posição é interpolada entre os vértices da geometria.

### 20.3 Chegada e desvio

| Regra | Valor |
|---|---|
| raio da parada | 25 m |
| precisão máxima para aceitar a chegada | 20 m |
| leituras consecutivas para confirmar a chegada | 3 |
| tolerância de desvio | `max(35 m, precisão × 2)` |
| leituras consecutivas fora da rota | 3 |

A chegada é reconhecida quando o **percurso** chega ao fim da perna
correspondente — e não quando a distância em linha reta até o ponto clicado
fica pequena (o ponto pode estar a dezenas de metros da rede, o "acesso à
rede").

O desvio confirmado pede um **recálculo pela mesma API**
(`POST /api/rota-paradas`, `modo: "usuario"`), com a posição atual e as
**paradas restantes na mesma ordem**. Se o cálculo falhar, o erro aparece na
tela e **nada é desenhado** — nunca uma linha reta.

### 20.4 Limites (o que ela não faz)

* **sem voz**, sem trânsito em tempo real, sem tempo estimado;
* **não é turn-by-turn de verdade**: a manobra vem do ângulo do traçado —
  não há cruzamentos nomeados, semáforos ou "continue por 300 m";
* a **precisão do GPS** manda: com GPS ruim as tolerâncias se ampliam e a
  navegação fica conservadora (é o comportamento correto);
* a rede tem **342 componentes**: se a posição atual cair num componente
  desconectado, o recálculo falha — e o erro é mostrado;
* a camada **não tem dados de nível nem de calçada**: o trajeto é sobre o
  eixo viário;
* a geolocalização exige **HTTPS ou localhost**.

### 20.5 Como verificar

```bash
npm test                    # 142 casos (19 novos em test/navegacao.test.js)
npm run validar:navegacao   # validação visual (Playwright) — 15/15
```

Medido na aplicação real (trajeto de 1,73 km no centro de Santo André):
instrução real ("Vire à esquerda em 55 m — RUA PREFEITO JUSTINO PAIXÃO"),
progresso sobre a geometria, chegada confirmada, desvio detectado e trajeto
**recalculado** a partir da posição atual (A → B passa de 402 m para 775 m,
com a ordem das paradas intacta) e, no modo GPS real, a **permissão negada
tratada** com mensagem clara.

> Detalhes completos (arquivos, algoritmos, capturas) em
> `updates/10-navegacao-ativa/README.md`.


---

## 21. Auditoria da rota otimizada e limpeza do painel

*(rodada 11 — revisão do modo **"Menor rota total (otimizada)"** sobre a rede
real e remoção de dois blocos do painel lateral)*

### 21.1 O que foi auditado

O modo otimizado foi auditado de ponta a ponta sobre a **rede real**
(4.545 eixos · 11.537 nós · 15.555 arestas · 342 componentes), com a ferramenta
permanente `tools/auditar-otimizacao.js` (`npm run auditar:otimizacao`):

1. a **matriz de custos** (`matrizDistancias` → caminho mínimo na rede para cada
   par): simetria, diagonal zero, pares sem caminho e a garantia de que
   **nenhum custo é menor que a linha reta**;
2. o **Held-Karp** comparado com a **enumeração de todas as permutações**
   (força bruta: 6 e 24 circuitos, sempre **com o retorno à origem**);
3. a **rota desenhada**: para cada trecho, `distância desenhada === célula da
   matriz`; `soma das pernas === distância total === custo do Held-Karp`;
   `sequência do painel === sequência desenhada no mapa`;
4. o **modo "ordem do usuário"** (não pode ser alterado) e o **método declarado**
   (`exato` × `heurístico`).

### 21.2 Resultado: o sintoma **não é defeito**

A rede é **apenas pedonal**, logo todas as arestas são **bidirecionais** e a
matriz é **simétrica**. Disso decorre que **o ciclo reverso tem exatamente o
mesmo custo do ciclo original**:

```
custo(A→B→C→D→A) = custo(A→D→C→B→A)     (simetria de D)
```

Ou seja: a ordem invertida **nunca é pior** — quando as duas empatam, o
Held-Karp devolve uma delas (critério determinístico: a de menor índice) e a
economia é **0 m**. Reproduzido na rede real com quatro pontos:

| sequência | total |
|---|---|
| **A→B→C→D→A** (ordem do usuário) | **3.440,9 m** |
| **A→D→C→B→A** (devolvida pelo Held-Karp) | **3.440,9 m** |
| A→C→B→D→A · A→D→B→C→A | 3.735,9 m |
| A→B→D→C→A · A→C→D→B→A | 3.823,5 m |

* Held-Karp == **força bruta** ✔ (o algoritmo acha o ótimo global)
* cada trecho desenhado == célula da matriz (Δ ≤ 2,3e−13 m) ✔
* `A→B` (990 m) < `A→D` (1.067 m) — a intuição do usuário se confirma no
  primeiro trecho, e ainda assim a ordem devolvida é a outra, porque **as duas
  custam o mesmo total**.
* Com mais uma parada (5 pontos, 24 permutações) a economia passa a ser real:
  **380 m (8,7 %)** (4.359,4 m → 3.978,4 m).

**Nada foi "corrigido" no motor**: `core/ordemParadas.js` e
`core/rotaParadas.js` **não tiveram uma linha alterada**. O que faltava era
**dizer isso ao usuário** — e o painel agora diz (ver §21.4).

> **Continuação (rodada 12):** esta auditoria provou que a **etapa 2**
> (Held-Karp) estava correta, mas ela **não conseguia enxergar um defeito na
> etapa 1**: o A\* e o Dijkstra comparados entre si usavam a *mesma*
> adjacência, e por isso "concordavam" com o mesmo custo falso. A etapa 1 foi
> auditada de novo contra uma **referência independente** e encontrou um
> defeito real — as arestas virtuais do acesso à rede recebiam como custo o
> **número de caracteres do identificador** em vez do comprimento métrico da
> peça. Ver **§22**.

### 21.3 Testes novos

`test/otimizacaoAuditoria.test.js` — 15 casos: Held-Karp × força bruta (caminho
aberto e circuito), o **retorno à origem** entrando no custo, a reconstrução da
sequência, uma matriz **assimétrica** (o Held-Karp não depende da simetria), o
caso em que **o trecho inicial mais curto não leva ao circuito mais curto**,
pares **sem caminho viável** (`Infinity`), o **empate** e, sobre a rede real, a
simetria da matriz, oHeld-Karp × força bruta, o empate do usuário e a
igualdade *trecho desenhado = célula da matriz*.

**Suíte completa: 157/157** (142 + 15).

### 21.4 Painel: dois blocos removidos

Removidos a pedido do usuário: o **bloco de estatísticas do resultado** (tabela
"Tipo de trajeto / Trechos / Sequência percorrida / …") e o **bloco "Rede
viária"** (estatísticas da rede + "Diagnóstico do grafo"). O diagnóstico do
grafo continua disponível em `window.__app.diagnostico` e em
`GET /api/diagnostics`.

Para não perder a garantia da rodada 8 — **o método de otimização é sempre
declarado** e a economia é sempre informada — a tabela foi substituída por **uma
linha compacta**:

```
Ordem otimizada · método exato (Held-Karp) · economia 380 m (8,7 %)
Ordem otimizada · método exato (Held-Karp) · economia 0 m (0,0 %) · empate: a ordem mudou, mas o custo total é o mesmo
Ordem do usuário · a sequência informada foi respeitada
```

A terceira linha é o caso do empate: o painel passa a **explicar** por que a
ordem mudou sem que o custo mude.

Arquivos do painel: `public/index.html` (blocos removidos + nota), `public/app.js`
(`atualizarNotaDoTrajeto()`, `els.stats`/`els.networkStats`/`els.diagnostics`
eliminados, `rows()` removida, diagnóstico exposto em `window.__app.diagnostico`,
rodapé de status com origem/verificação/avisos) e `public/styles.css` (estilo
`.route-note` e remoção das regras `.stats`, que ficaram sem uso).

### 21.5 Verificações

```
npm test                                  → 157/157
npm run auditar:otimizacao                → nenhuma inconsistência encontrada
npm run validar:mapa | validar:paradas | validar:otimizacao
npm run validar:circular | validar:trechos | validar:navegacao  → todas APROVADA
```

> Detalhes completos (tabelas de permutações, arquivos, capturas) em
> `updates/11-auditoria-otimizacao/README.md`.


---

## 22. Correção do menor caminho entre cada par (etapa 1 da otimização)

*(rodada 12 — auditoria e correção do **primeiro** passo do modo "Menor rota
total": o menor caminho viário entre cada par de pontos)*

### 22.1 O defeito

O modo otimizado tem duas etapas: **(1)** o menor caminho viário entre cada
par (a matriz de custos) e **(2)** a ordem de visita que minimiza a soma
dessa matriz, com o retorno à origem. A etapa 2 estava correta — mas a
etapa 1 **não entregava o menor caminho** em todos os casos.

A causa: ao ligar um ponto à rede, o motor **divide** a via atingida em
peças e cria arestas virtuais no "overlay" da busca. O custo dessas peças
era registrado como `edge.length`, sendo que `edge` ali é o **identificador**
da peça (uma **string** `"tmp:1234:0"`) — em JavaScript, o `.length` de uma
string é o **número de caracteres** (8 a 11), **nunca os metros da rua**:

```js
// ANTES — o custo da peça virava ~10 m, qualquer que fosse o seu tamanho
adj.get(from).push({ edge, to, length: edge.length });
// DEPOIS — o comprimento MÉTRICO da peça
adj.get(from).push({ edge: edgeId, to, length });   // length = seg.length
```

O A\* passava a subestimar o custo de tudo o que corria sobre uma via
dividida e podia devolver um caminho **mais longo** que o mínimo; e, como a
distorção dependia de *quais* vias eram divididas, **o mesmo par de pontos
custava valores diferentes conforme o sentido da rota**.

> Por que a validação cruzada anterior não pegou isso? O A\* e o Dijkstra
> usavam a **mesma** adjacência quebrada — compará-los entre si não podia
> revelar o erro. A auditoria desta rodada usa uma **referência
> independente** (Dijkstra próprio, overlay com o comprimento métrico
> correto).

### 22.2 O que muda em números (medido na rede real)

Amostra determinística de 600 pares + 200 pares de simetria:

| | antes | depois |
|---|---|---|
| custo do motor **acima** do menor caminho real | **11 pares (1,8 %)** | **0** |
| diferença máxima observada | **135,08 m** | **0,00 m** |
| pares **assimétricos** (d(X→Y) ≠ d(Y→X)) | **5 de 200** (Δ até 56,23 m) | **0 de 200** |
| custo ≠ comprimento da geometria desenhada | 0 | 0 |

O caso mais transparente (o mesmo par nos dois sentidos): **675,97 m ×
623,32 m** antes — o caminho de 623,32 m simplesmente não existia como
caminho mínimo.

### 22.3 O cenário do print, reproduzido

O print mostrava o circuito **A → C → B → A** com as pernas **903 / 279 /
625 m**. A impressão digital foi encontrada na rede real (**12 trios**).
Para `A(−46,514975, −23,704214) · B(−46,516961, −23,701514) ·
C(−46,518152, −23,700525)`:

| par | custo (m) | acesso origem | acesso destino | geometria desenhada | Δ |
|---|---|---|---|---|---|
| A → B | 628 | 0,02 m | 0,05 m | 628 m | 0,00 |
| A → C | 902 | 0,02 m | 0,05 m | 902 m | 0,00 |
| B → C | 274 | 0,05 m | 0,05 m | 274 m | 0,00 |
| B → A | 628 | 0,05 m | 0,02 m | 628 m | 0,00 |
| C → A | 902 | 0,05 m | 0,02 m | 902 m | 0,00 |
| C → B | 274 | 0,05 m | 0,05 m | 274 m | 0,00 |

| circuito (com o retorno) | total |
|---|---|
| **A → B → C → A** | **1.804,4 m** |
| **A → C → B → A** | **1.804,4 m** |
| Held-Karp devolve | A → C → B → A = 1.804,4 m |

**Os dois empatam — matematicamente.** Numa rede apenas pedonal a matriz é
simétrica e, com **duas** paradas intermediárias, as duas ordens possíveis
são **reversos uma da outra** ⇒ têm **sempre** o mesmo custo. A ordem
devolvida não é melhor nem pior: é um **desempate determinístico**, e a
economia aparece corretamente como **0 m (0,0 %)**. Escolher o "menor trecho
inicial" (A→B = 628 m contra A→C = 902 m) não muda nada, porque o que decide
é a **soma do circuito inteiro** — e as duas somas são iguais.

### 22.4 O que foi verificado (e não mexido)

* **Etapa 1**: o custo é a soma dos comprimentos (não o nº de segmentos); a
  heurística euclidiana do A\* é admissível e consistente; o acesso à rede é
  **medido** e **declarado** e **não** entra no custo (o trajeto desenhado
  começa na rede ⇒ custo e geometria coerentes, sem duplicação nem omissão);
  nenhum sentido de circulação ou restrição é inventado; nenhuma linha reta
  substitui a rua.
* **Etapa 2**: a matriz usa os menores caminhos; o Held-Karp soma o retorno
  à origem; cada parada é visitada uma vez; a implementação também resolve
  matrizes **assimétricas**; o objetivo é o **total do circuito**, não o
  primeiro trecho.
* **Etapa 4**: o trecho exibido é exatamente o custoado; o total exibido é a
  soma dos trechos percorridos (com o retorno); cores, marcadores e
  sequência preservados; modo "Ordem do usuário" **intacto**.
* **Etapa 5**: `test/caminhoMinimo.test.js` — **8 testes** (rede de custos
  conhecidos, simetria, A\* × Dijkstra × referência independente, geometria,
  acesso, nº de segmentos, rede real). Com o defeito reintroduzido, **3
  deles falham**; com a correção, **8/8 passam**. Suíte completa:
  **165/165**.

### 22.5 Arquivos

`core/router.js` (a correção, uma linha de registro + a passagem do
comprimento), `tools/auditar-caminho-minimo.js` (novo),
`test/caminhoMinimo.test.js` (novo), `package.json` (script
`auditar:caminho-minimo`), `README.md` (§22).

**Não alterados:** `core/graph.js`, `core/ordemParadas.js` (Held-Karp),
`core/rotaParadas.js`, `core/geo.js`, `core/wfs.js`, `server/*`, `public/*`,
o modo "Ordem do usuário", o Endereço Digital, a navegação e os trechos
coloridos. Nenhum limite fixo de paradas; nenhuma funcionalidade removida.

> Detalhes completos (evidências, tabelas, limitações) em
> `updates/12-caminho-minimo/README.md`.


---

## 23. Coleta de campo: persistência local e recuperação offline

*(rodada 13 — evolução do roteador para **mapeamento territorial
colaborativo**, a serviço de agentes de saúde que visitam residências em
Santo André)*

### 23.1 O que foi pedido e o que foi entregue

O objetivo é permitir que o agente **planeje uma rota, percorra o
território, registre o trajeto realmente feito e cadastre a localização de
residências**, mesmo sem conexão, sincronizando depois.

Esta rodada entregou **a FASE 1 (diagnóstico + plano) e a FASE 2
(persistência offline)** — e só elas:

| Entrega | Estado |
|---|---|
| Diagnóstico do projeto existente + plano de evolução em 7 fases | ✅ |
| Rota planejada salva no aparelho e recuperada | ✅ |
| Sessão de coleta GPS acumulando pontos sem rede | ✅ |
| Localização de residência com coordenadas, precisão e Plus Code | ✅ |
| Recuperação após recarregar / interromper o aplicativo | ✅ |
| Fila de sincronização com estados (pronta para a API) | ✅ (fila local) |
| **API de sincronização + autenticação** | ❌ fase 4 |
| **Revisão visual dos trajetos** | ❌ fase 5 |
| **Validação/publicação de novos caminhos** | ❌ fase 6 |
| **Integração dos caminhos aprovados ao roteador** | ❌ fase 7 |

### 23.2 Diagnóstico: o que já existia e o que não existia

**Reaproveitado sem alterar uma linha**: o motor de roteamento
(`core/router.js`, `core/graph.js`), a otimização da ordem
(`core/ordemParadas.js`, `core/rotaParadas.js`), a fonte de GPS
(`core/fonteGPS.js`), o Plus Code (`core/enderecoDigital.js`), as
distâncias (`core/geo.js`), a lista de pontos (`core/pontoTrajeto.js`), a
interface OpenLayers e a navegação ativa.

**Lacunas reais** (e por isso a API de sincronização **não** foi criada
agora):

* **não há banco de dados** nem camada de persistência de aplicação — o
  servidor só serve estáticos e três rotas de cálculo sobre o grafo em
  memória;
* **não há autenticação nem autorização** — nenhum endpoint exige
  credencial;
* **não há noção de agente/usuário**;
* **não há cliente de sincronização** nem fila no aparelho;
* **não há mapa offline** — o mapa-base é `ol.source.OSM()` (tiles da
  internet) e a rede viária vem do servidor.

### 23.3 O que foi implementado

**`core/armazenamentoLocal.js`** — persistência local em IndexedDB com
cinco lojas (`rotasPlanejadas`, `sessoes`, `pontos`, `residencias`,
`operacoes`), transações atômicas, estados `pendente → sincronizando →
sincronizado | erro`, ids gerados no aparelho (chave de idempotência) e a
regra de **não apagar nada antes de o servidor confirmar**. Adaptador em
memória para os testes e para o modo privado.

**`core/coleta.js`** — a sessão de coleta: iniciar/pausar/retomar/encerrar,
filtros explícitos de leitura (repetição, baixa precisão, salto de GPS,
perda de sinal), ponto de lacuna gravado como **`estimado`** (nunca como
medido), captura única de posição e cálculo **local** do Plus Code.

**`public/coletaUI.js`** — o painel "Coleta de campo": salvar a rota
planejada (com **versão**), iniciar a coleta e ver o trajeto real no mapa
(verde-azulado, distinto da rota planejada), recuperar e retomar uma coleta
interrompida, registrar a localização de uma residência (com aviso de
possível duplicidade), e o retrato do que está no aparelho aguardando
sincronização.

**Modo de teste (posição simulada)** — como na navegação ativa: a coleta
aceita **GPS real** ou **simulação** (o mesmo `core/simulador.js`, que
percorre a geometria da rota). A distinção é registrada em **três
lugares** — na sessão (`fonte`), em **cada ponto** (`fonte`/`simulado`) e
na interface (aviso permanente **“MODO DE TESTE”**). O simulador tem
pausar/retomar, reiniciar, avançar/retroceder 100 m e velocidade (1×–50×);
sem rota não há o que percorrer, e a interface diz isso em vez de simular
um caminho inventado.

**Marcar residência durante o trajeto** — o botão “Marcar residência aqui”
grava a posição atual (coordenadas, precisão e Plus Code) ligada à sessão
de coleta, com a classificação escolhida; sem posição, a ação é recusada
com a explicação (`SEM_POSICAO`).

**`public/sw.js` + `public/manifest.webmanifest`** — o aplicativo abre sem
conexão. O Service Worker guarda **apenas o esqueleto** do aplicativo;
`/api/*` **nunca** é cacheado.

### 23.4 O que continua funcionando sem conexão

| | |
|---|---|
| Abrir o aplicativo, salvar/recuperar a rota, coletar o GPS, registrar a residência | ✅ |
| **Calcular** uma rota nova | ❌ (o grafo está no servidor) |
| Sincronizar com o servidor | ❌ (fase 4) |
| Mapas de fundo | ⚠️ apenas se o tile já estiver no cache do navegador — não é garantido |

### 23.5 Privacidade (o que foi garantido já)

Nenhuma credencial no IndexedDB, **nenhum dado de paciente** gravado (só
geografia e metadados), id de agente **local e anônimo** até existir
autenticação, comparação de duplicidade **local**, Plus Code **calculado no
aparelho** (nenhum serviço externo de geocodificação recebe as
coordenadas) e `/api/*` fora do cache do navegador.

### 23.6 Testes executados

`npm test` → **202/202 PASSING** (165 anteriores + 13 de armazenamento + 24
de coleta) · `npm run validar:offline` → **VALIDAÇÃO OFFLINE APROVADA**
(32/32, com a **rede desligada** no meio do teste e 10 conferências do
modo de teste) · os seis validadores visuais e a auditoria da otimização
**sem regressão**.

> Detalhes completos (plano em 7 fases, riscos, filtros de GPS, o que não
> existe ainda) em `updates/13-campo-plano/README.md`.

### 23.7 Próxima etapa

**FASE 4 — API e sincronização**: decidir a identidade do agente (o
servidor não tem autenticação — é a lacuna que trava a etapa), definir onde
os registros coletados serão persistidos, criar o endpoint idempotente com
confirmação por registro e o cliente com retentativa progressiva, disparado
ao abrir o aplicativo e no evento `online`.

---

## 24. Auditoria da ordem de visita: o empate, a primeira perna e o modo “saída curta”

> Pedido: na tela, o otimizador escolheu **A→D→C→B→A** (673 + 214 + 291 +
> 542 = **1.720 m**) e o usuário esperava que a rota começasse pelo vizinho
> mais próximo de A (A→B). O pedido foi conferir as distâncias reais de
> todos os pares, enumerar todos os circuitos, auditar o algoritmo, corrigir
> **só** o que estivesse errado, adicionar testes, **não** mudar o objetivo
> de “Menor rota total” e apresentar separadamente a rota ótima global e a
> alternativa do vizinho mais próximo (m e %).

### 24.1 O resultado: não há defeito no cálculo

A rede é **bidirecional** (pedestres), logo `d(A,B) = d(B,A)`. Um circuito e
o seu **reverso** usam exatamente as mesmas quatro arestas ⇒ **têm sempre o
mesmo custo**. Com os números da própria tela:

| rota | pernas | total |
|---|---|---|
| A→D→C→B→A (a que a tela mostrou) | 673 + 214 + 291 + 542 | **1.720 m** |
| A→B→C→D→A (a que se esperava) | 542 + 291 + 214 + 673 | **1.720 m** |

Diferença: **0 m (0,0 %)** ⇒ a rota escolhida já era **ótima**; as duas
ordens **empacavam**. Escolher uma ou outra é um **desempate**, não um erro
de otimização.

### 24.2 Reprodução na rede real

O print não traz coordenadas, então o cenário foi reproduzido no snapshot
real (4.545 eixos · 11.537 nós · 15.555 arestas · 342 componentes):

* fingerprint exato (673/214/291/542 m, ±0,5 m) entre nós da rede: **0**
  (os pontos do usuário são pontos quaisquer sobre os eixos);
* fingerprint aproximado (±2 m): **46 candidatos**, **15** deles devolvem
  exatamente a sequência do print;
* o **mesmo padrão** (empate em que a saída mais curta não é usada) ocorre
  em **24.571 casos reais**;
* em **250 circuitos reais** sorteados, a rota ótima **não** começa pelo
  vizinho mais próximo de A em **48 %** dos casos ⇒ o sintoma é frequente e
  normal.

**Caso representativo** (o mais próximo do print), com a matriz real de
custos (metros, nos dois sentidos):

| | A | B | C | D |
|---|---|---|---|---|
| **A** | 0 | **540,185** | 757,506 | **673,150** |
| **B** | **540,185** | 0 | **291,350** | 228,207 |
| **C** | 757,506 | **291,350** | 0 | **215,700** |
| **D** | **673,150** | 228,207 | **215,700** | 0 |

Simetria: **SIM** · diagonal: **0** · acesso à rede: **0,000 m** (medido,
declarado e **fora** do custo).

**Todas as ordens do circuito** (o retorno a A entra na soma):

| sequência | total (m) | diferença |
|---|---|---|
| **A→B→C→D→A** | **1.720,385** | ← ótima |
| **A→D→C→B→A** | **1.720,385** | ← ótima |
| A→C→D→B→A | 1.741,598 | +21 m |
| A→B→D→C→A | 1.741,598 | +21 m |
| A→C→B→D→A | 1.950,213 | +230 m |
| A→D→B→C→A | 1.950,213 | +230 m |

* Held-Karp devolve **A→D→C→B→A = 1.720,385 m** (a ordem do print) e a
  **força bruta** dá o **mesmo** total;
* a melhor rota que começa pelo **vizinho mais próximo de A**
  (A→B→D→C→A) custa **1.741,598 m** ⇒ **+21,213 m (+1,2 %)** — ou seja,
  começar pela perna mais curta é *pior*, não melhor;
* as pernas desenhadas no mapa são **exatamente** as células da matriz
  (Δ 0,000 m nas quatro) e a soma das pernas = total da API.

### 24.3 Auditoria do algoritmo (tudo correto)

| item | resultado |
|---|---|
| matriz de custos (1 `routeOnGraph` por par, espelhada) | **correta** |
| indexação (origem 0 · intermediários 1..n−1 · `fim = 0` no circuito) | **correta** |
| transições do Held-Karp e final com `D[último][fim]` | **corretas** |
| reconstrução pela cadeia `pai` | **correta** |
| retorno à origem incluído no custo e no desenho | **sim** |
| trecho desenhado == célula da matriz | **sim** (250/250 amostras) |
| Held-Karp == força bruta | **sim** (250/250 amostras) |

**Nenhuma linha do cálculo foi alterada nesta rodada.**

### 24.4 O que foi entregue: um modo novo e separado

`core/ordemParadas.js` ganhou `heldKarpSaidaCurta()`: o **mesmo**
Held-Karp, com a comparação lexicográfica `(custo, comprimento da primeira
perna)`. O **total devolvido continua sendo o mínimo global** — o desempate
só atua entre ordens com o **mesmo** total (o que sempre acontece numa
matriz simétrica).

* novo botão de rádio **“Menor rota total (saída curta)”** no painel;
* `modo: 'saida_curta'` na API (`/api/rota-paradas`);
* a nota da tela passa a dizer *“Ordem otimizada (saída curta) · método
  exato (Held-Karp, desempate pela saída curta)”*;
* **intactos**: o objetivo de “Menor rota total”, a “Ordem do usuário” (a
  sequência dos cartões é respeitada exatamente), a quantidade dinâmica de
  paradas, o retorno obrigatório à origem, as cores por perna e a legenda.

### 24.5 Verificações executadas

| verificação | resultado |
|---|---|
| `npm test` | **218/218 PASSING** (202 + **16 novos**) |
| `npm run auditar:ordem` | **AUDITORIA CONCLUÍDA — nenhuma inconsistência encontrada** |
| `npm run auditar:otimizacao` | **AUDITORIA CONCLUÍDA — nenhuma inconsistência encontrada** |
| `npm run validar:saida-curta`¹ | **VALIDAÇÃO VISUAL APROVADA** (12/12, 0 erros de console) |
| `npm run validar:otimizacao` · `validar:circular` · `validar:trechos` · `validar:mapa` · `validar:paradas` · `validar:navegacao` · `validar:offline` | APROVADAS (32/32 na offline) |
| `node tools/validate-routes.js 300` | **VALIDACAO APROVADA** |

> Detalhes (tabelas completas, arquivos e limitações) em
> `updates/14-auditoria-ordem-paradas/README.md`.
>
> ¹ Na rodada 15 esse script virou `npm run validar:modos`, porque os rádios
> de ordem de visita saíram do painel (ver §25).

---

## 25. Interface de modos: “Rota otimizada” × “Ordem das paradas”

A rodada 15 é uma **refatoração incremental do painel lateral**: a escolha
do modo de roteamento deixou de ser um grupo de rádios e passou a ser
**dois botões**, com o modo **sempre um circuito** (origem → paradas → volta
à origem). Nenhum cálculo foi reescrito.

### 25.1 O que mudou na tela

| antes | agora |
|---|---|
| rádios “Ida e volta” × “Circuito” | **nenhum** rádio de tipo — o trajeto é sempre um circuito |
| rádios “Menor rota total” × “Menor rota total (saída curta)” × “Ordem do usuário” | **dois botões**: **“Rota otimizada”** e **“Ordem das paradas”** |
| botão “Inverter” (origem ↔ destino) | **removido** — não há destino |
| lista com origem + **destino** + paradas | lista com **origem (A) + paradas (B, C, …)** |
| legenda com “Origem (A)” e “Destino (B)” | legenda com “Origem (A)” e **“Retorno à origem”** |

O painel ficou na ordem **origem → paradas → modo → calcular**:

```
ORIGEM E PARADAS
┌─────────────────────────────────────────────┐
│ ⠿ (A) Origem · início e fim   Validar 🗺  ↑ ↓│
│   Endereço Digital (ex.: 8FP9+J6)            │
│   −46.501038, −23.686703                     │
├─────────────────────────────────────────────┤
│ ⠿ (B) Parada B                 Validar 🗺  ↑ ↓ ✕│
│   …                                         │
└─────────────────────────────────────────────┘
[ + Adicionar parada ]

┌─ ✓ Rota otimizada ──────────────────────────┐   ← selecionado
│ Calcula o menor circuito possível, já        │
│ contando o retorno à origem.                │
└─────────────────────────────────────────────┘
┌─ Ordem das paradas ─────────────────────────┐
│ Visita as paradas na ordem em que aparecem  │
│ nos cartões.                                 │
└─────────────────────────────────────────────┘

O trajeto é sempre um circuito: começa na origem (A),
visita as paradas e volta à origem.

[ Calcular rota ]
[ Limpar ]
```

* **um modo por vez**: o botão selecionado ganha borda destacada e o ✓;
  o estado é exposto com `aria-pressed` (não é só cor);
* **sem jargão**: cada botão explica, em uma frase, o que ele faz;
* **acessível**: `role="group"` + `aria-label="Modo de roteamento"` no
  grupo, `aria-pressed` em cada botão, foco visível;
* **a origem é o início e o fim**: o cartão da origem é rotulado
  “Origem · início e fim” e não tem botão de remoção.

### 25.2 Os dois modos (o cálculo não mudou)

| botão | modo na API | comportamento |
|---|---|---|
| **Rota otimizada** | `saida_curta` | **a mesma implementação validada na rodada 14**: menor total de circuito; havendo empate — o ciclo e o seu reverso custam o mesmo —, prefere a saída mais curta a partir da origem. O desempate **nunca** altera o total. |
| **Ordem das paradas** | `usuario` | visita exatamente a ordem dos cartões, sem reordenar, e volta à origem. |

O núcleo (`core/ordemParadas.js`, `core/rotaParadas.js`, `core/router.js`),
a API, a captura de GPS, a simulação, a sincronização e o armazenamento
local **não foram tocados**.

### 25.3 Verificações executadas

| verificação | resultado |
|---|---|
| `npm test` | **233/233 PASSING** (218 + **15 novos**) |
| `npm run validar:modos` | **VALIDAÇÃO VISUAL APROVADA** (0 erros de console) |
| `npm run validar:otimizacao` · `validar:circular` · `validar:trechos` · `validar:paradas` · `validar:mapa` · `validar:navegacao` · `validar:offline` | APROVADAS (32/32 na offline) |
| `npm run auditar:ordem` · `auditar:otimizacao` | nenhuma inconsistência encontrada |
| `node tools/validate-routes.js 300` | **VALIDACAO APROVADA** |

> Detalhes (arquivos, capturas e limitações) em
> `updates/15-interface-modos/README.md`.

## 26. Interface de planejamento de visitas (em quatro etapas)

A rodada 16 reorganizou a **tela principal** para quem não conhece o
vocabulário do roteamento — o caso de uso é o **agente de saúde** que
planeja visitas domiciliares. O trajeto continua sendo **sempre um circuito**
(sai do ponto de partida, visita todos os locais e volta), e **nenhum cálculo
foi reescrito**.

### 26.1 A tela

```
1 · PONTO DE PARTIDA
   O percurso começa e termina aqui.
   ┌───────────────────────────────────────────────────┐
   │ (A) Ponto de partida                🗺  ⌖        │
   │     Início e fim do percurso                       │
   │     [ Endereço Digital (ex.: 8FP9+J6) ]  Validar  │
   │     Localização informada manualmente.             │
   │     [Selecionar no mapa] [Usar minha localização] │
   │     ⌄ Coordenadas (opções avançadas)               │
   └───────────────────────────────────────────────────┘

2 · LOCAIS DE VISITA
   ┌───────────────────────────────────────────────────┐
   │ ⠿ (B) 1ª visita                             ⋯     │
   │ ⠿ (C) 2ª visita                             ⋯     │
   │ ⠿ (D) 3ª visita                             ⋯     │
   └───────────────────────────────────────────────────┘
   [ + Adicionar outro local ]

3 · COMO ORGANIZAR O PERCURSO
   ┌───────────────────────────────────────────────────┐
   │ Melhor percurso                        SELECIONADO │
   │ O sistema organiza as visitas para reduzir a      │
   │ distância total percorrida.                       │
   └───────────────────────────────────────────────────┘
   ┌───────────────────────────────────────────────────┐
   │ Seguir minha ordem                                 │
   │ O sistema visita os locais na sequência que       │
   │ organizei acima.                                   │
   └───────────────────────────────────────────────────┘

[ Calcular meu percurso ]
● Percurso calculado: 21,59 km.              Limpar tudo
```

### 26.2 O glossário da tela

| antes (rodada 15) | agora (rodada 16) |
|---|---|
| “Origem · início e fim” | **“Ponto de partida”** + “Início e fim do percurso” |
| “Parada B” | **“1ª visita”** (com o selo interno B ao lado) |
| coordenadas visíveis no cartão | **“Coordenadas (opções avançadas)”**, fechado por padrão |
| botões ↑ ↓ ✕ no cartão | menu **⋯** (ver no mapa, mover para cima, mover para baixo, remover local) |
| “+ Adicionar parada” | **“+ Adicionar outro local”** |
| “Rota otimizada” | **“Melhor percurso”** |
| “Ordem das paradas” | **“Seguir minha ordem”** |
| “Calcular rota” | **“Calcular meu percurso”** |
| legenda sempre aberta | **legenda recolhível** (`Legenda ▾`) |
| “Legenda: Retorno à origem” | **“Retorno ao ponto de partida”** |

### 26.3 O que a refatoração **não** tocou

* o **cálculo**: caminho mínimo por par, matriz de custos, Held-Karp, o
  desempate pela saída curta (`saida_curta`) e o modo “seguir a ordem”
  (`usuario`) continuam exatamente como validados na rodada 14;
* o **mapa**: camadas, marcadores, cores por trecho, ocultação de trechos e o
  arraste de marcadores;
* o **Endereço Digital** (validação e conversão) e a **seleção no mapa**;
* a **coleta de campo** (rodada 13/13.1), a **navegação** (rodada 10), a
  **API** e o **armazenamento local**;
* nenhuma dependência nova foi adicionada.

### 26.4 Verificações executadas

| verificação | resultado |
|---|---|
| `npm test` | **243/243 PASSING** (233 + **10 novos**) |
| `npm run validar:modos` | **VALIDAÇÃO VISUAL APROVADA** — 21,59 km (“Melhor percurso”, igual à API) × 30,86 km (“Seguir minha ordem”), arraste trocando a ordem **e** recalculando, remoção com renumeração, **0 erros de console** |
| `npm run validar:circular` | APROVADA — circuito fecha na origem nos dois modos · 20,09 km × 28,09 km |
| `npm run validar:otimizacao` · `validar:trechos` · `validar:navegacao` | APROVADAS |
| `npm run validar:paradas` · `validar:mapa` | concluídas |
| `npm run validar:offline` | **VALIDACAO OFFLINE APROVADA** (32/32) — a coleta de campo segue intacta |
| `npm run auditar:otimizacao` · `auditar:ordem` · `auditar:caminho-minimo` | nenhuma inconsistência |
| `node tools/validate-routes.js 300` | **VALIDACAO APROVADA** |

> Detalhes (inspeção, arquivos, capturas e limitações) em
> `updates/16-interface-planejamento/README.md`.

## 27. Migração para React Native (Android)

A rodada 17 começa uma migração **gradual** do frontend para **React Native +
TypeScript**, com foco em Android, para agentes de saúde em campo.

A regra que orientou tudo:

> O mecanismo de roteamento é uma funcionalidade **já validada**. Não alterar
> o Held-Karp, o caminho mínimo, as regras de montagem, o retorno à origem, os
> desempates ou a integração geográfica.

### 27.1 A decisão que evita reescrever o motor

A auditoria descobriu que **`core/` não tem dependência de Node nenhuma** — é
ESM puro, escrito para rodar no navegador e no servidor ao mesmo tempo. Por
isso o aplicativo mobile **executa os mesmos arquivos** do motor:

```
aplicação web  ─┐
                 ├──►  core/*.js  (o motor validado, sem alterações)
aplicativo RN ──┘
```

* `mobile/metro.config.js` resolve `@motor/*` → `../core/*`;
* `mobile/tsconfig.json` usa `paths` + `allowJs`: os **tipos são inferidos**
  do JavaScript existente (nada reescrito);
* **`core/` teve zero linhas alteradas.**

### 27.2 O que existe hoje dentro de `mobile/`

| peça | situação |
|---|---|
| **estrutura** | Expo SDK 58 (RN 0.88, React 19), TypeScript estrito, **expo-router** (navegação por arquivo), pastas por camada (`domain/`, `motor/`, `data/`, `estado/`, `ui/`, `screens/`) |
| **primeira tela** | `app/planejamento.tsx` — ponto de partida, locais de visita numerados, dois cartões de organização e "Calcular meu percurso", com a mesma linguagem da rodada 16 |
| **motor dentro do aparelho** | `src/motor/` — carrega `data/network.snapshot.json`, monta o grafo com `core/graph.js` e calcula o circuito com `core/rotaParadas.js` (`saida_curta` / `usuario`) |
| **porta para a API .NET** | `src/data/portaRoteamento.ts` — a interface está pronta; a implementação remota **não** foi escrita, porque a API ainda não existe |
| **teste de equivalência** | `src/motor/equivalencia.test.ts` — o caminho do aplicativo tem de devolver **exatamente** o que o motor devolve (distância, sequência, cores, pernas, retorno) |

### 27.3 O que foi verificado

| verificação | resultado |
|---|---|
| `cd mobile && npm test` | **13/13 PASSING** (7 de equivalência + 6 de domínio), contra a **rede real** |
| valores de referência | **21.590,12 m** ("Melhor percurso", A→C→B→D→A) e **30.863 m** ("Seguir minha ordem") — os mesmos das rodadas 14–16 |
| `npm run typecheck` | **0 erros** |
| `npm run bundle:android` | bundle Android gerado (5,0 MB) — o motor, a rede e as telas compilam |
| suíte da aplicação web | **243/243 PASSING** — o projeto web não foi afetado |

### 27.4 O mesmo aplicativo no navegador

O aplicativo roda no navegador **sem código separado**: é o mesmo React
Native, com `react-native-web`.

```bash
cd mobile
npm run web          # http://localhost:8081
npm run bundle:web && npm run serve:web   # build estático em :8090
```

`npm run verificar:web` confere a interface no Chromium — **18/18**:
as três etapas renderizam, o Endereço Digital resolve, o circuito é
calculado **dentro da página** (**6,54 km**, idêntico ao motor em Node), o
painel do resultado abre com as partes coloridas e **não há erro de
JavaScript**.

Essa verificação encontrou um defeito real que os testes unitários não
pegavam: **o texto digitado no Endereço Digital sumia do campo**, porque o
`useMemo` do estado da tela não dependia do contador de versão da lista de
pontos (`src/estado/usePlanejamento.ts`). Corrigido em uma dependência —
**`core/` continua intacto** — e o verificador web agora cobre o caso.

### 27.5 O que **não** existe ainda

O **mapa** (MapLibre Native, etapa 5), o **arrasto para reordenar**, a
**tela de acompanhamento**, o **GPS contínuo**, o **armazenamento offline** e a
**API .NET** (etapa 6). A rota `/mapa` é um marcador de posição que explica o
estado da etapa — não desenha nada, para não mostrar um resultado que o
aplicativo não produziu.

> Detalhes (auditoria, plano, arquivos e limitações) em
> `updates/17-react-native/README.md` e em `mobile/docs/`.

## 28. Identidade SIGA + a tela do mapa (rodada 18)

A rodada 18 aplica, no aplicativo mobile, a **identidade visual do SIGA
Santo André** — a mesma paleta, os mesmos raios e a mesma cartografia do
aplicativo web — e acrescenta o **ícone da marca** e a **tela do mapa**.

### 28.1 A identidade, copiada do projeto web

| token do aplicativo | valor | de onde vem |
|---|---|---|
| fundo / painel | `#0f1419` / `#161b22` | `--bg` / `--panel` |
| painel interno | `#1c232c` | `--panel-2` |
| texto / suave | `#e6edf3` / `#8b949e` | `--text` / `--muted` |
| borda | `#2a323d` | `--border` |
| ação | `#2f81f7` | `--accent` |
| origem / visita | `#2ea043` / `#1f6feb` | `--origin` / `--stop` |
| erro / aviso / ok | `#f85149` / `#d29922` / `#2ea043` | `--err` / `--warn` / `--ok` |
| raios | 6 / 8 / 8 / 12 px | `--radius: 8px` |

As **funcionalidades não mudaram**: os componentes têm a mesma estrutura e o
mesmo comportamento — só as cores, os raios e as sombras. Os alvos de toque
de 48 px e a escala de texto maior continuam, porque são do telefone.

### 28.2 O ícone

O arquivo enviado tem duas peças (a marca "SIGA APP" e o brasão) sobre fundo
branco opaco. Foram recortadas com o fundo transparente (só o branco ligado
à borda — o branco interno da coroa continua) e viraram:

* **ícone do aplicativo** (1024×1024, brasão sobre o verde `#005020` da
  marca);
* **ícone adaptativo** do Android (brasão transparente, fundo verde) e o
  **monocromático** (Android 13+);
* **splash** (brasão sobre o verde) e **favicon** da versão web;
* **marca no cabeçalho** da tela de planejamento.

### 28.3 A tela do mapa

O percurso é desenhado com o **caminho real** devolvido pelo motor — a
geometria de `core/rotaParadas.js` — na cartografia do projeto web: halo
claro, contorno escuro, núcleo na cor de cada parte, retorno à origem
**tracejado**, marcadores verde (partida) e azuis (visitas). A projeção é a
**mesma** da web (EPSG:3857), para os dois desenhos coincidirem. Há barra
de escala e controles de aproximar, afastar, centralizar e arrastar.

O **mapa-base de tiles** (MapLibre Native) é um módulo nativo: exige
*Development Build* e a decisão sobre a licença dos tiles. O desenho atual
não depende de servidor e funciona sem internet.

### 28.4 O que foi verificado

| verificação | resultado |
|---|---|
| `cd mobile && npm test` | **24/24 PASSING** (13 anteriores + 10 da projeção + 1 de geometria) |
| equivalência da geometria (nova) | o traçado que chega à tela é **exatamente** o do motor, e **nunca** uma reta entre dois pontos |
| `npm run typecheck` · `npx expo-doctor` | **0 erros** · **20/20** |
| `npm run bundle:android` | bundle gerado (motor, rede, telas e o SVG do mapa) |
| **verificação no navegador** | **VALIDAÇÃO WEB APROVADA — 26/26**, agora incluindo a tela do mapa |
| suíte da aplicação web | **243/243 PASSING** |
| integridade do `core/` | **11/11 idênticos** ao pacote mais recente — **0 diferenças** |

Quatro defeitos que **só** a verificação no navegador pegou foram
corrigidos: o botão de zoom não fazia nada, o marcador da visita ficava
escondido sob os botões, o símbolo de "centralizar" virava quadradinho e o
voltar do mapa duplicava a tela no histórico.

> Detalhes (arquivos, decisões e limitações) em
> `updates/18-identidade-siga-mapa/README.md`.

## 29. Reformulação visual unificada (web + React Native) — rodada 19

A rodada 19 reformulou o visual das **duas** versões da aplicação, tomando
uma imagem de referência como referência de **arranjo** e **preservando o
tema claro** da rodada 16. Nenhuma funcionalidade foi trocada: a rota
continua sendo a mesma, calculada pelo mesmo motor.

### 29.1 O que é igual nas duas telas

| | Web (`public/`) | Mobile (`mobile/`) |
|---|---|---|
| Cabeçalho | marca do SIGA + brasão + título + abas | marca do SIGA + brasão + abas |
| Visões | **Dividido · Mapa · Painel** (`body[data-vista]`) | **Dividido · Mapa · Painel** (`Cabecalho.tsx`) |
| Mapa | herói: à direita no desktop, em cima no celular | herói: no topo (42 % da tela) |
| Rede viária | camada OpenLayers sob a rota | eixos em SVG sob o traçado (`eixos.ts`) |
| Legenda | sobreposta, canto inferior esquerdo | sobreposta, canto inferior esquerdo |
| Botões no mapa | "Rede" e "Legenda" | "Rede" e "Legenda" |
| Painel | **Pontos do trajeto** | **Pontos do trajeto** |
| Cartões | origem (A) + paradas (B, C…) | origem (A) + paradas (B, C…) |
| Endereço Digital | campo + "Validar" | campo + "Validar" |
| Coordenadas | "opções avançadas" | "opções avançadas" |
| Escolher no mapa | botão + faixa no mapa | botão + faixa no mapa |
| Modos | "Melhor percurso" / "Seguir minha ordem" | os mesmos dois cartões |
| Ação principal | "Calcular meu percurso" (rodapé fixo) | "Calcular meu percurso" (rodapé fixo) |

### 29.2 O contrato visual (`docs/design-tokens.md`)

As duas plataformas **não compartilham componentes** (o React Native não
roda HTML): elas compartilham as **decisões**. A fonte única é
`docs/design-tokens.md`; as traduções são o `:root` de
`public/styles.css` e `mobile/src/ui/tema.ts`.

O teste `mobile/src/ui/tema.test.ts` **lê o CSS da web** e compara com o
`tema.ts` — se um lado mudar e o outro não, o teste avisa. O mesmo vale
para o raio (`--radius: 10 px`), os espaçamentos e as cores de estado.

### 29.3 O que foi verificado

| verificação | resultado |
|---|---|
| `npm test` (raiz) | **255/255 PASSING** (243 + 12 da identidade) |
| `cd mobile && npm test` | **29/29 PASSING** |
| `cd mobile && npm run typecheck` · `npx expo-doctor` | **0 erros** · **20/20** |
| `node tools/validar-visual.mjs` (web) | **VALIDAÇÃO VISUAL APROVADA — 27/27**, 0 erros de JavaScript |
| `cd mobile && npm run verificar:web` (aplicativo) | **VALIDAÇÃO WEB APROVADA — 34/34**, 0 erros de JavaScript |
| `node tools/verificar-integridade-motor.mjs` | **INTEGRIDADE DO MOTOR CONFIRMADA** |
| percurso calculado | **6,54 km** nas duas versões — o mesmo número de antes da rodada |

### 29.4 O motor não foi tocado

* `core/ordemParadas.js` (Held-Karp) e `core/rotaParadas.js` (montagem do
  percurso) são **byte a byte iguais** à cópia arquivada da rodada 14;
* o SHA-256 dos 17 arquivos de `core/` e dos 2 de `server/` é impresso por
  `tools/verificar-integridade-motor.mjs`;
* a comparação com o backup do começo da rodada mostra que só `public/` e
  `mobile/` mudaram;
* nenhuma chamada de rota foi alterada — a web continua chamando
  `POST /api/rota-paradas` e `GET /api/endereco-digital`, e o aplicativo
  continua chamando o motor local.

> Detalhes (arquivos, decisões e limitações) em
> `updates/19-unified-visual/README.md` e
> `updates/19-unified-visual/COMPARACAO-VISUAL.md`.

## 30. O visual das duas versões igualado à imagem de referência (rodada 20)

A rodada 20 igualou o visual da **aplicação web** e do **aplicativo React
Native** à imagem de referência (a tela do emulador Android): as cores foram
**medidas pixel a pixel** na foto, não copiadas de memória.

### 30.1 O que mudou

| | como está agora |
|---|---|
| Aba ativa | **bloco verde da marca** (`--marca` `#005020`) com texto branco; as outras no branco |
| Eixo não oficializado | **marrom** (`#a06f42`), como na foto (era laranja) |
| Cartão do ponto | branco com borda fina e **sem tarja lateral**: crachá circular com a letra, título em **caixa alta** e, à direita, *Validar* ⊘ ↑ ↓ e o menu *⋯* |
| Coordenadas | **sempre visíveis** no cartão, com o botão de escolher no mapa (saiu o "opções avançadas") |
| Arraste | o **crachá** é a alça de arraste (antes era um punhado de pontos); as setas ↑ ↓ também movem |
| Legenda | cartão branco no canto inferior esquerdo, com as linhas da foto: *Eixo viário oficial*, *Eixo não oficializado*, *Rota calculada*, *Retorno ao ponto de partida*, *Origem (A)*, *Parada intermediária* |
| Botões sobre o mapa | pílulas brancas com ícone e rótulo no verde da marca (*Rede*, *Legenda*) |
| Estado da rede | "**Rede pronta (4.545 eixos).**" nas duas versões |
| Ação principal | "Calcular meu percurso" no verde da marca |
| Mapa no aplicativo | **mapa-base de tiles** (OpenStreetMap, claro como na web) — antes só havia a rede viária sobre um fundo liso |

### 30.2 O que continua igual (de propósito)

* **A cor de cada parte do percurso vem do motor** (`core/coresTrechos.js`).
  A foto é de uma versão antiga, com o trajeto todo dourado; aqui cada parte
  tem a cor que o motor devolveu — a interface não escolhe a cor.
* **O percurso é sempre um circuito**: a foto tinha origem e destino; o
  aplicativo de hoje é ida e volta à origem. Os títulos continuam falados
  ("Ponto de partida", "1ª visita"), com o **visual** da foto.

### 30.3 O motor não foi tocado

`core/` e `server/` continuam **byte a byte iguais** à cópia arquivada da
rodada 14 — confirmado por `tools/verificar-integridade-motor.mjs` (SHA-256
dos 17 + 2 arquivos). O percurso calculado é o **mesmo**: **6,54 km** na web
e no aplicativo.

### 30.4 Verificação

| verificação | resultado |
|---|---|
| `npm test` (raiz) | **255/255 PASSING** |
| `cd mobile && npm test` | **29/29 PASSING** |
| `cd mobile && npx tsc --noEmit` · `npx expo-doctor` | **0 erros** · **20/20** |
| `node tools/validar-visual.mjs` (web) | **VALIDAÇÃO VISUAL APROVADA — 27/27** |
| `cd mobile && npm run verificar:web` | **VALIDAÇÃO WEB APROVADA — 34/34** |
| `node tools/verificar-integridade-motor.mjs` | **INTEGRIDADE DO MOTOR CONFIRMADA** |

> Detalhes (arquivos, medidas de cor e limitações) em
> `updates/20-visual-foto/README.md`.

## 31. Cópia paralela da rodada 10 (simulador de iniciar rota)

A pedido de *"voltar para a versão onde colocamos um simulador de iniciar rota
(como do Google Maps)"*, foi criada a pasta **`versoes/r10-simulador/`**: uma
cópia independente do projeto no estado da **rodada 10** — a rodada em que o
simulador de trajeto foi entregue. **O projeto principal não foi alterado.**

| item | situação |
|---|---|
| Simulador de trajeto | ✅ na cópia (`public/navegacaoUI.js` + `core/simulador.js`): velocidade 1×–50×, passo a passo, cenários de desvio/perda de sinal/recuperação/posição manual |
| Navegação | ✅ na cópia: painel sobre o mapa, progresso sobre a geometria, chegada, desvio e recálculo pela mesma API |
| `core/` e `server/` | ✅ **os mesmos do projeto principal** — a correção do A\* (rodada 12) e o Held-Karp exato (rodada 14) continuam valendo; **nenhum bug antigo foi reintroduzido** |
| Interface da rodada 20, abas, tiles, app mobile | ❌ não estão na cópia (ficaram no projeto principal) |

```bash
cd versoes/r10-simulador
npm start                 # http://localhost:8091  (porta própria)
npm test                  # 218/218
npm run validar:navegacao # 15/15 no navegador real
```

Detalhes em `versoes/r10-simulador/README.md`.

## 32. Cópia de trabalho fora do projeto (com o simulador de trajeto)

A pedido de *"queria uma versão posterior, onde colocamos a função de simular o
trajeto do usuário, com a localização real, e a localização simulada, assim
como as rotas com cores diferentes, numa pasta separada, fora de
`santo-andre-routing`"*, o projeto foi **copiado** para:

```
/home/user/siga-simulador
```

| item | situação |
|---|---|
| Conteúdo | **a versão mais recente** do projeto (mesma do que está aqui): simulador de trajeto com **GPS real** e **localização simulada**, pernas coloridas por perna, visual da foto, app mobile, motor e API |
| Motor (`core/`, `server/`) | **idêntico** ao deste projeto — nada do motor foi alterado |
| Porta | **8092** (própria) — `cd /home/user/siga-simulador && npm start` |
| Testes | **255/255**; validação da navegação **15/15** (simulação, desvio detectado e trajeto recalculado) |
| Este projeto | **inalterado** |

Detalhes em `/home/user/siga-simulador/README.md`.

## Referências

* GeoServer — WFS Reference: <https://docs.geoserver.org/main/en/user/services/wfs/reference/>
* OpenLayers 10: <https://openlayers.org/doc/>
* Snyder, *Map Projections — A Working Manual*, USGS Professional Paper 1395 (séries de
  Transversal de Mercator usadas em `core/geo.js`)

---

**Licença:** MIT.
