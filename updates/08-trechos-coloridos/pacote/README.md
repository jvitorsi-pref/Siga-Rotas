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
| `npm test` | Executa a suíte de testes (123 casos) |
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
* **Origem e destino** — marcadores circulares com halo branco e letra
  (A / B).

### Como usar

1. Preencha **Origem** e **Destino** com `longitude, latitude` em decimal
   (ex.: `-46.545000, -23.660000`), **ou** clique no botão 🗺 e depois no mapa;
2. *(opcional)* clique em **+ Adicionar parada** para criar os pontos B, C, D…
   — cada um pode ser informado por **Endereço Digital** (CEP Digital) ou por
   coordenadas;
3. Escolha a **ordem do trajeto**:
   * **Menor rota** (padrão) — a ordem das paradas é otimizada (TSP sobre o
     fecho métrico da rede);
   * **Ordem do usuário** — a sequência A → B → C… é respeitada como digitada;
4. Clique em **Calcular rota**;
5. A rota aparece em amarelo, com a distância total, o ajuste de cada extremidade
   até a rede e a lista ordenada dos logradouros percorridos;
6. **Arraste** a alça de uma parada (B, C…) no painel para **mudar a ordem da
   rota**: a linha troca de lugar e a rota é recalculada sozinha;
7. *(extra)* **arraste** um marcador no mapa para mudar a posição do ponto —
   a rota também é recalculada.

> A entrada em formato `latitude, longitude` também é aceita: quando o primeiro
> número tem módulo ≤ 90 e o segundo > 90, a ordem é invertida automaticamente.

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
npm test        # 123 casos
```

Saída verificada nesta entrega:

```
# tests 123
# pass 123
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

A interface mostra as mesmas informações no painel **"Rede viária"**
(*Atualização automática*, *Última verificação*, *Rede atualizada em*).

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
│   ├── coresTrechos.js       paleta de cores por trecho da rota
│   ├── enderecoDigital.js    CEP Digital: porta fiel de CalculoGeometriaDAL
│   ├── enderecoDigitalService.js  interface de serviço (local | SIGA)
│   ├── geo.js                projeção UTM 23S (ida e volta), geometria planar
│   ├── ordemParadas.js       otimização da ordem de visita (fecho métrico,
│   │                         Held-Karp e 2-opt)
│   ├── pontoTrajeto.js       lista de pontos do trajeto (rótulos A, B, C…)
│   ├── rotaParadas.js        trechos na ordem escolhida (reusa o A*)
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
│   └── 08-trechos-coloridos/     uma cor por trecho + paradas dinâmicas
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
│   └── validar-trechos-coloridos.mjs  validação visual dos trechos coloridos
│
├── test/                     123 testes (node:test)
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
│   └── coresTrechos.test.js cores por trecho (rodada 8)
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
O código que roda continua morando na raiz do projeto — `updates/` é o
**histórico**, não uma segunda cópia da fonte. A pasta
`updates/08-trechos-coloridos/pacote/` traz uma cópia dos arquivos da última
rodada, para quem quiser guardar esse pacote.

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

---

## Referências

* GeoServer — WFS Reference: <https://docs.geoserver.org/main/en/user/services/wfs/reference/>
* OpenLayers 10: <https://openlayers.org/doc/>
* Snyder, *Map Projections — A Working Manual*, USGS Professional Paper 1395 (séries de
  Transversal de Mercator usadas em `core/geo.js`)

---

**Licença:** MIT.
