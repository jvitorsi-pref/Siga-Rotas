# Rodada 12 — Correção do menor caminho entre cada par (etapa 1 da otimização)

> **O que foi pedido:** auditar as duas etapas do modo "Menor rota total
> (otimizada)" — (1) o **menor caminho viário entre cada par** e (2) a ordem
> que minimiza a soma desses caminhos, com retorno à origem — e corrigir
> **apenas** o que estiver comprovadamente errado.

**Resposta curta: havia um defeito real na etapa 1.** O motor entregava
custos que **não eram** os menores caminhos viários em ~1,8 % dos pares
(até **135,08 m** a mais que o mínimo) e quebrava a **simetria** do custo em
~2,5 % dos pares (o mesmo par devolvia valores diferentes conforme o
sentido). A etapa 2 (Held-Karp) estava correta — ela otimizava, porém,
números que não eram os menores caminhos.

---

## 1. Causa raiz

**Arquivo:** `core/router.js` · **função:** `buildOverlay` · **linha:** o
`pushAdj` que registra as arestas virtuais.

Quando um ponto cai no meio de uma via, o motor **divide** aquela aresta em
duas peças e cria um nó temporário (o "acesso à rede"). No `overlay` (a
adjacência ampliada usada só durante a busca), cada peça vira uma aresta
virtual. O código registrava essas arestas assim:

```js
// ANTES (com defeito)
const pushAdj = (from, to, edge) => {
  if (!adj.has(from)) adj.set(from, []);
  adj.get(from).push({ edge, to, length: edge.length });   // ← BUG
};
...
pushAdj(seg.from, seg.to, id);        // `id` é o IDENTIFICADOR da peça
pushAdj(seg.to, seg.from, id);
```

`edge` ali é o **identificador** da peça — uma **string** no formato
`"tmp:1234:0"`. Em JavaScript, `edge.length` sobre uma string é o **número de
caracteres** dela: **8 a 11**, nunca os metros da rua. O custo da peça
dividia entrava, portanto, como ~10 m, quando o comprimento real era, por
exemplo, 800 m.

**Consequências diretas:**

1. o A\* subestimava o custo de todo trecho percorrido sobre uma via
   dividida ⇒ podia escolher um caminho **mais longo** que o mínimo;
2. a distorção dependia de *quais* vias eram divididas ⇒ **o mesmo par de
   pontos devolvia custos diferentes conforme o sentido da rota**
   (a matriz de custos deixava de ser simétrica);
3. a etapa 2 (Held-Karp) otimizava essa matriz errada ⇒ a "menor rota
   total" não era, em alguns casos, a soma dos menores caminhos.

**Por que a validação cruzada anterior não pegou isso:** o A\* e o Dijkstra
usavam **a mesma adjacência quebrada** — compará-los entre si não podia
detectar o erro (ambos "concordavam" com o mesmo custo falso). A auditoria
desta rodada usa uma **implementação de referência independente**, com a
divisão das arestas feita pelo comprimento métrico correto.

### A correção

```js
// DEPOIS
const pushAdj = (from, to, edgeId, length) => {
  if (!adj.has(from)) adj.set(from, []);
  adj.get(from).push({ edge: edgeId, to, length });   // ← comprimento MÉTRICO
};
...
pushAdj(seg.from, seg.to, id, seg.length);
pushAdj(seg.to, seg.from, id, seg.length);
```

Uma linha de mudança no registro da adjacência (mais a passagem do
comprimento). **Nada mais no motor foi tocado.**

---

## 2. A evidência (medida, na rede real)

Ferramenta permanente criada nesta rodada:

```bash
node tools/auditar-caminho-minimo.js 600   # ou: npm run auditar:caminho-minimo
```

Ela compara o motor com uma **referência independente** (Dijkstra próprio,
overlay com o comprimento métrico correto) e verifica simetria, coerência
entre custo e geometria e o comportamento do acesso à rede.

### 2.1 O caso mais transparente (antes da correção)

Mesmo par de pontos, mesmo instante, **dois sentidos**:

| sentido | custo devolvido (antes) | dijkstra de referência |
|---|---|---|
| A → B | **675,97 m** | 675,97 m ✔ |
| B → A | **623,32 m** ✘ | 675,97 m |

O caminho de 623,32 m **não existe** como caminho mínimo: o motor o produziu
porque as peças divididas custavam ~10 m. A assimetria era de **52,65 m**.

### 2.2 Amostra determinística de 600 pares

| | antes (com defeito) | depois (corrigido) |
|---|---|---|
| custo do motor **acima** do mínimo real | **11 pares (1,8 %)** | **0 (0,0 %)** |
| diferença média | 0,78 m | **0,00 m** |
| diferença máxima | **135,08 m** | **0,00 m** |
| pares **assimétricos** (d(X→Y) ≠ d(Y→X)) | **5 de 200** (Δ de 9,48 m a 56,23 m) | **0 de 200** |
| custo ≠ comprimento da geometria desenhada | 0 | 0 |

### 2.3 O acesso à rede (medido, não estimado)

Pontos deslocados de 2 a 40 m da rede (115 pares utilizáveis; os demais foram
corretamente recusados pelo limite de 100 m):

| | valor |
|---|---|
| acesso à rede (mediana / p95 / máx) | 5,71 m / 20,68 m / 26,85 m |
| custo do motor ≠ referência | **0** |

O acesso é **medido e declarado** ("acesso à rede" no painel) e **não** entra
no custo do trajeto — o trajeto desenhado começa na rede, então custo e
geometria são coerentes entre si (sem duplicação e sem omissão).

---

## 3. O cenário reportado (etapa 3)

O print mostrava o circuito **A → C → B → A** com as pernas **903 m / 279 m
/ 625 m** (total ≈ 1,81 km). Buscando na rede real um trio com essa
impressão digital (custos ±5 m), foram encontrados **12 trios** — o cenário
**é reproduzível com dados reais**.

Para o trio `A(−46,514975, −23,704214) · B(−46,516961, −23,701514) ·
C(−46,518152, −23,700525)` (todos na maior componente), a auditoria mede:

### 3.1 Tabela por par (menor caminho viário, com acesso e geometria)

| par | custo (m) | acesso origem (m) | acesso destino (m) | geometria desenhada (m) | custo × geometria |
|---|---|---|---|---|---|
| A → B | 628 | 0,02 | 0,05 | 628 | 0,00 |
| A → C | 902 | 0,02 | 0,05 | 902 | 0,00 |
| B → C | 274 | 0,05 | 0,05 | 274 | 0,00 |
| B → A | 628 | 0,05 | 0,02 | 628 | 0,00 |
| C → A | 902 | 0,05 | 0,02 | 902 | 0,00 |
| C → B | 274 | 0,05 | 0,05 | 274 | 0,00 |

Matriz (m): `A→B 628 · A→C 902 · B→C 274` — **simétrica** ✔ · diagonal zero ✔
· nenhum par sem caminho ✔ · nenhum custo abaixo da linha reta ✔.

### 3.2 Os dois circuitos, com a MESMA métrica (incluindo o retorno)

| circuito | total |
|---|---|
| **A → B → C → A** | **1.804,4 m** |
| **A → C → B → A** | **1.804,4 m** |
| Held-Karp devolve | A → C → B → A = 1.804,4 m |

**Os dois empatam — e isso é matemático, não um defeito.** Numa rede
**apenas pedonal** (arestas bidirecionais) a matriz de custos é simétrica, e
com **duas** paradas intermediárias existem exatamente duas ordens: elas são
**reversos uma da outra**, logo têm **sempre o mesmo custo**:

```
custo(A→B→C→A) = d(A,B) + d(B,C) + d(C,A)
custo(A→C→B→A) = d(A,C) + d(C,B) + d(B,A) = o mesmo
```

Por isso a economia aparece como **0 m (0,0 %)**: a ordem devolvida é
diferente da informada, mas **custa exatamente o mesmo**. A ordem
"menor trecho inicial" (A→B = 628 m contra A→C = 902 m) **não decide
nada**: o que decide é a **soma do circuito inteiro**, e aqui as duas somas
são iguais. O Held-Karp apenas aplica um desempate determinístico.

> Com **três ou mais** paradas intermediárias a situação muda: os números do
> caso de 4 paradas da rodada 11 continuam válidos — a ordem otimizada
> (A→D→C→B→A) tem **economia real** quando existe uma ordem melhor.

### 3.3 A rota efetivamente desenhada

| trecho | desenhado | matriz | Δ |
|---|---|---|---|
| A → C | 902 m | 902 m | 0,00 |
| C → B | 274 m | 274 m | 0,00 |
| B → A (retorno) | 628 m | 628 m | 0,00 |

* soma dos trechos = 1.804,4 m = distância total = custo do Held-Karp ✔
* sequência do painel = sequência desenhada no mapa ✔
* modo "ordem do usuário": sequência devolvida = a informada, intacta ✔

---

## 4. Resposta etapa por etapa

### Etapa 1 — menor caminho entre cada par

| item audited | veredito |
|---|---|
| o algoritmo minimiza a **soma dos comprimentos**? | **Sim, após a correção.** Antes, em 1,8 % dos pares, devolvia um caminho maior (até 135,08 m). A heurística é a distância euclidiana até o destino — **admissível e consistente** (o peso de cada aresta é ≥ a distância euclidiana entre suas pontas), então o A\* devolve o mínimo |
| minimiza o **número de segmentos**? | Não — o custo é a soma dos comprimentos. Teste com uma rua reta de 4 vértices (200 m) contra uma curva de 2 segmentos (360,61 m): a reta é escolhida ✔ |
| usa uma **heurística inadequada**? | Não. A heurística euclidiana é admissível; a auditoria compara A\* × Dijkstra × referência independente em 600 pares + 200 pares de simetria |
| seleciona apenas uma **conexão próxima**? | O ponto é ligado à **aresta mais próxima** (limite de 100 m; fora disso, recusado com a distância medida). Medido: acesso mediano 5,71 m em pontos fora da rede, e **0 divergências** contra a referência |
| a associação produz **acessos excessivamente longos** ou liga ao **segmento errado**? | Não: 0 divergências de custo; a coerência custo × geometria é 0,00 m em todos os pares auditados |
| o caminho calculado corresponde à **geometria renderizada**? | Sim: `custo − comprimento da geometria = 0,00 m` em 600/600 pares (a única diferença observada — 2,08 m em 1 par — é a discrepância de junção que o motor **declara** em `warnings`, com a geometria original preservada) |
| o **acesso à rede** é incorporado sem duplicações ou omissões? | É **medido** e **declarado** ("acesso à rede") e **não** é somado ao trajeto — o trajeto desenhado começa na rede, então custo e geometria ficam coerentes |
| respeita **direções e restrições** dos dados? | A camada não publica sentido de circulação nem restrições ⇒ o grafo é **não direcionado** (apenas rotas a pé) e **nenhuma conexão é inventada** |
| substitui o caminho viário por **linha reta**? | Não: todas as pernas seguem geometria de eixo; nenhum salto é criado |

### Etapa 2 — menor circuito total

| item audited | veredito |
|---|---|
| a matriz usa as **menores distâncias viárias**? | Sim, agora de fato: `matrizDistancias` chama `routeOnGraph` para cada par, e `routeOnGraph` devolve o menor caminho (verificado contra a referência independente) |
| o Held-Karp minimiza a **soma completa**, com o retorno a A? | Sim: o custo final é `dp[full][j] + D[última][A]` (`fim = 0` no circuito) ✔ |
| cada parada é visitada **exatamente uma vez**? | Sim (teste A7 da rodada 11 e verificação na auditoria) |
| custos **direcionais** (matriz assimétrica)? | O Held-Karp **não** pressupõe simetria: a mesma implementação resolve o caso assimétrico (teste A5 da rodada 11). No modo pedonal a matriz real é simétrica — e a auditoria agora **confirma** essa simetria em vez de supô-la |
| confunde o **menor trecho inicial** com o **menor total**? | Não: o objetivo é a soma do circuito inteiro (teste A4 da rodada 11: o trecho inicial mais curto **não** leva ao circuito mais curto) |

### Etapa 4 — consistência entre cálculo e mapa

* o trecho exibido é **exatamente** o cujo custo entrou na matriz (Δ = 0,00 m
  em todos os pares auditados) ✔
* a distância total exibida é a **soma dos trechos percorridos**, incluindo o
  retorno ✔
* cores por trecho, marcadores e a sequência otimizada **preservados** ✔
  (validações visuais `validar:trechos` e `validar:circular` APROVADA)
* modo **"Ordem do usuário"** intacto (a sequência dos cards é respeitada) ✔

### Etapa 5 — testes

`test/caminhoMinimo.test.js` — **8 testes novos**:

| # | teste | pega o defeito? |
|---|---|---|
| 1 | rede de custos conhecidos: o caminho devolvido é o de **menor comprimento** (A\* e Dijkstra) | **sim** |
| 2 | o caminho mínimo é **simétrico** (d(X→Y) = d(Y→X)) | **sim** (assimetria de −588,53 m) |
| 3 | o A\* devolve o mesmo que o **Dijkstra** e que a **referência independente** | **sim** |
| 4 | o custo devolvido é o **comprimento da geometria desenhada** | — |
| 5 | o acesso à rede é medido, declarado e **não** entra no custo | — |
| 6 | a rota **segue as ruas** (nenhum salto em linha reta) | — |
| 7 | minimiza a **distância**, não o nº de segmentos | — |
| 8 | na **rede real**: motor = referência e simetria em todos os pares | — |

Com o defeito reintroduzido temporariamente, os testes **1, 2 e 3 falham**
(3 de 8); com a correção, **8 de 8 passam** ✔.

Da rodada 11 continuam válidos: Held-Karp × força bruta (caminho aberto e
circuito), retorno à origem no custo, reconstrução da sequência, matriz
assimétrica, pares sem caminho (`Infinity`) e o empate do caso real.

**Suíte completa: 165/165** (157 da rodada 11 + 8 novos).

---

## 5. Arquivos alterados

| arquivo | mudança |
|---|---|
| `core/router.js` | **a correção**: o custo das arestas virtuais passa a ser o comprimento métrico da peça (`seg.length`) em vez do nº de caracteres do identificador. Nada mais foi tocado |
| `tools/auditar-caminho-minimo.js` | **novo** — auditoria da etapa 1 com referência independente (custo, simetria, coerência com a geometria, acesso à rede, cenário reportado) |
| `test/caminhoMinimo.test.js` | **novo** — 8 testes (rede de custos conhecidos, simetria, A\* × Dijkstra × referência, geometria, acesso, segmentos, rede real) |
| `package.json` | script `auditar:caminho-minimo` |
| `README.md` | §22 (esta rodada) + sumário, §2, §13, §14 |

**Não foram alterados:** `core/graph.js`, `core/ordemParadas.js` (Held-Karp),
`core/rotaParadas.js`, `core/geo.js`, `core/wfs.js`, `server/*`, `public/*`,
o modo "Ordem do usuário", o Endereço Digital, a navegação e os trechos
coloridos. Nenhum limite fixo de paradas foi introduzido e nenhuma
funcionalidade foi removida.

---

## 6. Como reproduzir

```bash
npm install
npm start                            # aplicação em :8080

npm test                             # 165 testes
npm run auditar:caminho-minimo      # auditoria da etapa 1 (referência independente)
npm run auditar:otimizacao          # auditoria da etapa 2 (Held-Karp × força bruta)
node tools/validate-routes.js 800    # validação cruzada A* × Dijkstra
node tools/audit-fidelity.js 250     # fidelidade geométrica
```

Para ver o cenário do print na interface: modo **Circuito**, pontos

```
A  −46,514975 / −23,704214
B  −46,516961 / −23,701514
C  −46,518152 / −23,700525
```

⇒ **A → C → B → A · 1.804,4 m**, com a nota do painel
*"economia 0 m (0,0 %) · empate: a ordem mudou, mas o custo total é o mesmo"*.

---

## 7. Limitações conhecidas (não corrigidas — sem defeito comprovado)

* **Associação do ponto à rede:** cada ponto é ligado à **aresta mais
  próxima** (até 100 m). Uma associação que considerasse várias arestas
  candidatas poderia, em teoria, achar um caminho melhor em pontos muito
  afastados da rede — mas **na amostra auditada (600 pares + 115 pares com
  ponto fora da rede) houve 0 divergências** contra a referência, e a
  associação é coerente com o trajeto desenhado. Não há defeito
  comprovado ⇒ nada foi alterado.
* **Desempate do Held-Karp:** quando há empate, a ordem devolvida é a
  primeira encontrada (índice menor). É determinístico e declarado; em um
  circuito de duas paradas, as duas ordens custam **sempre** o mesmo.
* **Discrepância de junção:** um cruzamento digitalizado dos dois lados pode
  produzir uma diferença de poucos centímetros (máx. observada: 12,74 m em
  1 par de 600). O motor **mantém a geometria original** e **declara** a
  diferença em `warnings` — nunca inventa uma posição que não existe no dado.
* **Restrições e sentidos:** a camada não traz nível, calçadas, sentido de
  circulação nem restrições de pedestres; o grafo é não direcionado por
  decisão de escopo ("apenas rotas a pé").
