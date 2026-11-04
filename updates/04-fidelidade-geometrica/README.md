# Rodada 4 — Fidelidade geométrica da rota

**Pedido:** *a rota calculada precisa seguir fielmente a geometria desenhada do
eixo viário — curvas, mudanças de direção, trechos consecutivos — sem atalhos
artificiais e sem conexões inventadas.*

**Resposta da rodada:** antes a rota **cortava curvas** e atravessava áreas
abertas; agora ela **segue o eixo desenhado**, vértice a vértice.

---

## 1. Diagnóstico: onde a geometria era perdida

A análise do código (antes de qualquer alteração) encontrou **quatro** causas
independentes. Todas estão em `core/router.js` e `core/graph.js`.

### 1.1 O overlay cortava a rua num segmento de reta  ← causa principal

Em `buildOverlay()`, cada aresta percorrida era dividida nos pontos de
interseção. A divisão era feita assim:

```js
// ANTES (core/router.js)
const coord = interpolateAlongEdge(base, s.pos);
segments.push({
  from: prevNode,
  to: s.nodeId,
  coords: [base.coords[0], coord],   // ← só dois pontos!
  length: s.pos - prevPos,
});
```

Cada pedaço da rota carregava **apenas o primeiro e o último vértice** da
aresta. Uma rua desenhada com 11 vértices (uma praça, uma rotatória, uma
curva) virava um **segmento de reta entre os extremos** — a reta é a *corda*
da curva, e a rota passava por dentro dela.

O efeito é exatamente o da imagem reportada: a rota entrava na rotatória e
**cortava o meio do canteiro**.

### 1.2 A geometria original era trocada pela geometria do nó

No final da montagem, a última coordenada de uma perna era substituída pela
**posição do nó** (a média de todos os cortes que ali chegaram). Em
interseções assimétricas, o nó pode estar até **0,71 m** fora do eixo: a rota
não seguia mais a rua desenhada, e o traçado "corrigido" inventa um
deslocamento que não existe na fonte.

### 1.3 Eixos fechados (praças em anel) desapareciam do grafo

Em `core/graph.js`, uma parte cujo início e fim se fundem no **mesmo nó** e
que não tem cruzamento interior era tratada como "sem nenhuma aresta" e
descartada. Resultado: **44 anéis fechados** existiam na camada, **7 deles
ficavam sem nenhuma aresta** — praças inteiras sumiam do mapa de rotas
(PRAÇA ALICANTE, PRAÇA FÁBIO CASTRAVELLI, PRAÇA IVES OTA, PRAÇA LEONOR
RODRIGUES COSTA, PRAÇA SÃO MARCOS + 2).

### 1.4 Eixos que se encontram ponta a ponta não eram ligados

`classifySegmentPair()` devolvia `null` quando dois segmentos **colineares**
compartilhavam exatamente um ponto. Duas ruas que se encontram **ponta a
ponta** (o fim de uma é o começo da outra) nunca eram unidas, mesmo sendo o
mesmo logradouro contínuo.

### 1.5 (menor) Vértices duplicados consecutivos

Um corte que coincide exatamente com um vértice já existente da rua produzia o
**mesmo ponto duas vezes** na cadeia métrica. São **3.602 arestas** assim
(3.603 no grafo antigo) — geometria de comprimento zero, inofensiva para o
peso, mas que poluía a geometria devolvida.

---

## 2. O que mudou (arquivos e funções)

### 2.1 `core/router.js`

| Função | Mudança |
|---|---|
| `sliceAlongEdge(edge, posA, posB)` | **nova** — recorta a cadeia de coordenadas **original** da aresta entre duas posições métricas, **mantendo todos os vértices intermediários** e sem duplicar o ponto de corte. |
| `buildOverlay()` | passou a usar `sliceAlongEdge()` no lugar de `[início, fim]`. Cada pedaço da rota carrega agora a **geometria real** daquele pedaço. |
| `acrescentar()` | **nova** — concatena coordenadas removendo **apenas** as repetições consecutivas (≤ 1e-6 m). Nada mais é descartado: nenhum vértice some. |
| montagem das pernas | cada aresta é percorrida no sentido em que o grafo a devolve; quando o sentido é **invertido**, a cadeia **inteira** é revertida (`reverse()`), não só os extremos. |
| unificação de junção | **removida**. A coordenada de cada aresta é a **dela própria**; a geometria original não é mais movida por tolerância. |
| `JUNCTION_TOLERANCE` → `JUNCTION_REPORT` | o valor deixou de ser uma tolerância que *modifica* a rota e passou a ser o **limiar de aviso**: a discrepância entre o fim de uma perna e o começo da próxima é apenas **medida e reportada** em `result.warnings` quando > 1 cm. |
| pernas | agora expõem `connector` (a perna é um conector de junção?) e `segments` (quais arestas a compõem). |

### 2.2 `core/graph.js`

| Função | Mudança |
|---|---|
| `extractRings` / montagem de arestas | eixo **fechado** (início e fim no mesmo nó, sem cruzamento interior) passa a gerar uma **aresta de laço** (`loop: true`) com a geometria **completa** do anel e o vértice final duplicado removido. |
| `classifySegmentPair()` | no caso **colinear com um único ponto em comum**, passa a devolver `{type:'touch'}` quando o ponto é extremidade de A — eixos que se encontram **ponta a ponta** são ligados. |

### 2.3 `test/fidelity.test.js` (novo)

8 testes **obrigatórios** da rodada (seção 4).

### 2.4 `tools/audit-fidelity.js` (novo)

Mede, para centenas de rotas, o quanto o traçado se afasta da malha original e
se a geometria devolvida contém todos os vértices das pernas percorridas.

---

## 3. O que **não** mudou (decisão explícita)

* **Nenhuma** stylistic foi alterada para "esconder" o problema: a rota continua
  sendo desenhada sobre a camada de eixos, sem linha reta origem→destino, sem
  suavização e sem espessura especial.
* **Nenhuma** tolerância foi aumentada. `snapTolerance` continua 5 cm e
  `junctionTolerance` continua 1 m.
* **Nenhuma** conexão foi inventada. Onde a fonte não confirma a passagem, o
  problema continua **registrado** (conectores de até 1 m, com o comprimento
  real da lacuna, e aviso no relatório).
* A arquitetura foi preservada: `core/` isomórfico, grafo único em memória,
  A* com heurística admissível, backend obrigatório por causa do CORS.

---

## 4. Os 8 testes obrigatórios (`test/fidelity.test.js`)

| # | Cenário | O que verifica |
|---|---|---|
| 1 | rota com **muitas curvas** | a geometria devolvida é a concatenação das geometrias originais |
| 2 | **eixos consecutivos** (vários logradouros) | a ordem das pernas e das arestas é preservada |
| 3 | **aresta percorrida em sentido inverso** | a cadeia inteira é revertida, não só os extremos |
| 4 | rota **através de uma interseção** | o trajeto passa pelo nó, sem salto e sem atalho |
| 5 | rota que **mistura eixos oficiais e não oficializados** | todas as arestas entram na geometria |
| 6 | **continuidade** entre todas as arestas | o fim de cada perna coincide com o começo da próxima (≤ 2 cm) e **todos os vértices** das pernas aparecem na geometria, na ordem |
| 7 | **concatenação das geometrias originais** | cada vértice da rota está a ≤ 5 cm de algum eixo da camada |
| 8 | **regressão do círculo** | uma praça em anel vira **1 nó / 1 aresta** e o comprimento é a **metade da circunferência** (π·r), não o dobro da corda |

Resultado: **72 testes / 72 passando** (`node --test test/`).

---

## 5. Resultados medidos

### 5.1 Fidelidade geométrica (`node tools/audit-fidelity.js 250`)

| Métrica | Antes | **Depois** |
|---|---|---|
| desvio máximo até a malha original | **35,52 m** | **0,44 m** |
| desvio p95 | 5,87 m | 0,32 m |
| desvio médio por rota | 1,53 m | 0,078 m |
| rotas com soma de trechos errada | — | **0** |
| rotas com geometria perdida | — | **0** |

Os **0,44 m** restantes não são erro de traçado: são as **lacunas reais da
base** (até 1 m entre dois eixos que não se tocam), cobertas pelos
**conectores** — arestas honestas, com o comprimento da lacuna e geometries
originais preservadas. São **102 arestas de conector** (de 113 lacunas
candidatas; as 11 rejeitadas eram perpendiculares ou longas demais), com
lacuna máxima de **0,967 m** e mediana de **0,245 m**.

Medição contra a **rede completa** (incluindo os conectores):

| Métrica | Valor |
|---|---|
| desvio máximo | **0,011 m** |
| desvio p95 | **0,001 m** |
| rotas que usam conector | 63 de 250 |
| parcela da rota em conector | ≤ **0,04 %** do comprimento |

Ou seja: **99,96 %** do traçado está literalmente sobre o eixo desenhado.

### 5.2 Grafo

| | Antes | Depois |
|---|---|---|
| eixos | 4.287 | 4.287 |
| nós | 10.874 | 10.874 |
| arestas | 14.610 | **14.617** (+7 anéis fechados recuperados) |
| componentes | 321 | 321 |

### 5.3 Validação cruzada (`node tools/validate-routes.js 2000`)

```
pares testados                 : 2000
com rota                       : 2000
A* x Dijkstra divergentes      : 0
problemas de continuidade       : 0
problemas de soma              : 0
problemas de geometria         : 0
razao rota/linha reta (mediana): 1.33x
razao rota/linha reta (max.)   : 6.05x
VALIDACAO APROVADA
```

A razão máxima caiu de 9,48× para **6,05×**: antes, o traçado "encurtava"
cruzando curvas e a distância ficava subestimada em relação ao desenho.

---

## 6. Prova no mapa (obrigatória)

### 6.1 Comparativo antes/depois — a rotatória

`imagens/comparativo-antes-depois.png`

* **vermelho tracejado** — rota pelo código antigo: **entra na praça e corta o
  canteiro** (desvio de **1,10 m**);
* **âmbar** — rota pelo código novo: **contorna o anel exatamente**;
* o ponto vermelho marca o trecho onde o desvio máximo acontecia.

### 6.2 Aplicação real (OpenLayers, servidor em execução)

`imagens/app-rotatoria.png` e `imagens/app-rotatoria-zoom.png`
— rota de **6,57 km**, 36 trechos, 80 nós. No zoom, a rota **desenha o
contorno da praça**, sem atravessar o canteiro.

`imagens/app-avenida-valentim.png` e `imagens/app-avenida-valentim-zoom.png`
— rota de **1,46 km** na **Avenida Valentim Magalhães** (a área da imagem
reportada): a rota acompanha a curva da avenida e a lista de logradouros mostra
os trechos na ordem correta.

Reprodução: `npm run validar:mapa` (requer `npx playwright install chromium`).

---

## 7. Limitações que continuam valendo

* **Não há dado de nível (ponte/viadute)** na camada: em 27 cruzamentos com
  vias arteriais a conexão é assumida em nível — a limitação está registrada
  (`excludeRoadCrossings` desliga esses cruzamentos).
* **141 eixos não oficializados** entram por padrão; podem ser desligados.
* A camada cobre **só a área urbana central** de Santo André; fora dela o
  motor responde `FORA_DA_REDE`.
* **321 componentes** disconnected: a rede da Prefeitura não é conexa.
* As **lacunas de até 1 m** entre eixos são cobertas por conectores que
  preservam a geometria original das duas pontas — o preenchimento é
  declarado, nunca disfarçado.

---

## 8. Arquivos desta rodada

```
updates/04-fidelidade-geometrica/
├── README.md                         este documento
├── imagens/
│   ├── comparativo-antes-depois.png  antes × depois (rotatória)
│   ├── app-rotatoria.png             aplicação, visão geral
│   ├── app-rotatoria-zoom.png        aplicação, detalhe da praça
│   ├── app-avenida-valentim.png      aplicação, Av. Valentim
│   └── app-avenida-valentim-zoom.png aplicação, detalhe da avenida
└── pacote/
    ├── core_graph.js
    ├── core_router.js
    ├── test_fidelity.test.js
    └── tools_audit-fidelity.js
```
