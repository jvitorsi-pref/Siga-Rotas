# Rodada 14 — Auditoria da ordem de visita: “Menor rota total (otimizada)”

**Pedido:** na tela, o otimizador escolheu a ordem **A→D→C→B→A** (pernas
673 m · 214 m · 291 m · 542 m, total ≈ 1.720 m) e o usuário esperava que a
rota começasse pelo vizinho mais próximo de A (A→B). O pedido foi: conferir
as distâncias reais de todos os pares, enumerar todos os circuitos, auditar o
algoritmo (matriz, indexação, Held-Karp, reconstrução e retorno à origem),
corrigir **somente** o que estiver comprovadamente errado, adicionar testes
automáticos, **não** mudar o objetivo matemático de “Menor rota total” e
apresentar separadamente a rota ótima global e a alternativa que começa
pelo vizinho mais próximo (em metros e em %).

**Conclusão:** **não há defeito no cálculo.** A ordem exibida já era uma
rota **ótima**; existia apenas um **empate** que a interface resolvia de
uma forma diferente da preferência do usuário. A correção entregue é uma
**opção nova e separada** — “Menor rota total (saída curta)” — que mantém o
mesmo total mínimo e só desempata pela primeira perna mais curta.

---

## 1. A conta feita com os próprios números da tela

Os valores impressos são 673 · 214 · 291 · 542 m. A rota mostrada e a rota
que começa por B usam **as mesmas quatro pernas**, só em ordem inversa:

| rota | pernas | total |
|---|---|---|
| A→D→C→B→A (a que a tela mostrou) | 673 + 214 + 291 + 542 | **1.720 m** |
| A→B→C→D→A (a que o usuário esperava) | 542 + 291 + 214 + 673 | **1.720 m** |

Diferença: **0 m (0,0 %)**.

Isso não é coincidência: a rede é **bidirecional** (pedestres), logo
`d(A,B) = d(B,A)`. Como o circuito e o seu **reverso** usam exatamente as
mesmas arestas, **todo circuito tem o mesmo custo que o seu reverso**. Uma
matriz simétrica tem, por construção, optimalidades emparelhadas.

⇒ A rota que o algoritmo escolheu e a que o usuário esperava **empactam**.
Escolher uma ou outra é uma questão de **desempate**, não de otimização.

---

## 2. Reprodução na rede real

O print não traz as coordenadas, então o cenário foi **reproduzido** na rede
real do snapshot (4.545 eixos · 11.537 nós · 15.555 arestas · 342
componentes):

* **fingerprint exato** (673/214/291/542 m, ±0,5 m) entre **nós** da rede:
  **0 ocorrências** — os pontos do usuário são pontos quaisquer sobre os
  eixos, não vértices do grafo;
* **fingerprint aproximado** (±2 m): **46 candidatos**, dos quais
  **15 devolvem exatamente a sequência do print** (A→D→C→B→A);
* **o mesmo padrão** (o empate em que a saída mais curta de A não é usada)
  aparece em **24.571 casos reais**;
* numa **amostra aleatória de 250 circuitos reais**, a rota ótima **não**
  começa pelo vizinho mais próximo de A em **48 %** dos casos — o sintoma é
  frequente e **não** indica erro.

### Caso representativo (o mais próximo do print)

Coordenadas reais (medidas na rede):

```
A: -23,654198  -46,495365
B: -23,650668  -46,493911
C: -23,649230  -46,494057
D: -23,650059  -46,493004
```

**Matriz de custos** (metros — caminho mínimo na rede viária, os dois
sentidos):

| | A | B | C | D |
|---|---|---|---|---|
| **A** | 0 | **540,185** | 757,506 | **673,150** |
| **B** | **540,185** | 0 | **291,350** | 228,207 |
| **C** | 757,506 | **291,350** | 0 | **215,700** |
| **D** | **673,150** | 228,207 | **215,700** | 0 |

* simetria `D[i][j] == D[j][i]`: **SIM** · diagonal: **0**
* acesso à rede: **0,000 m** em todos os pontos (medido, declarado na
  resposta e **fora** do custo — o trajeto desenhado começa já na rede)

**Todas as ordens do circuito** (o retorno a A entra na soma):

| sequência | pernas (m) | total (m) | diferença |
|---|---|---|---|
| **A→B→C→D→A** | 540,185 + 291,350 + 215,700 + 673,150 | **1.720,385** | ← ótima |
| **A→D→C→B→A** | 673,150 + 215,700 + 291,350 + 540,185 | **1.720,385** | ← ótima |
| A→C→D→B→A | 757,506 + 215,700 + 228,207 + 540,185 | 1.741,598 | +21 m |
| A→B→D→C→A | 540,185 + 228,207 + 215,700 + 757,506 | 1.741,598 | +21 m |
| A→C→B→D→A | 757,506 + 291,350 + 228,207 + 673,150 | 1.950,213 | +230 m |
| A→D→B→C→A | 673,150 + 228,207 + 291,350 + 757,506 | 1.950,213 | +230 m |

* Held-Karp (modo atual) devolve **A→D→C→B→A = 1.720,385 m** — a ordem do
  print;
* a força bruta (6 permutações) dá o **mesmo** total ⇒ **Held-Karp == força
  bruta**;
* a rota que começa pelo vizinho mais próximo de A (**A→B→D→C→A**) custa
  **1.741,598 m** ⇒ **+21,213 m (+1,2 %)** — é *pior*, não melhor.

### O trecho desenhado é o custo usado

| perna | desenhado | matriz | Δ |
|---|---|---|---|
| A→D | 673,150 m | 673,150 m | 0,000 m |
| D→C | 215,700 m | 215,700 m | 0,000 m |
| C→B | 291,350 m | 291,350 m | 0,000 m |
| B→A (retorno) | 540,185 m | 540,185 m | 0,000 m |

soma das pernas = **1.720,385 m** = total devolvido pela API ⇒ **Δ 0,000 m**.

---

## 3. Auditoria do algoritmo

| item | verificado | resultado |
|---|---|---|
| matriz de custos | 1 `routeOnGraph` por par **não ordenado**, espelhado | **correta** (a rede é bidirecional ⇒ simetria é uma propriedade, não um atalho) |
| diagonal | `D[i][i]` | **0** |
| indexação | pontos = `[origem, paradas…]`, intermediários = índices 1..n−1 (circuito) | **correta** |
| Held-Karp | `dp[mask*m+j]`, transição `base + D[indices[j]][indices[k]]`, final `dp[full*m+j] + D[indices[j]][fim]` | **correto** (é o TSP exato) |
| reconstrução | cadeia `pai` + `unshift` | **correta** (cada parada uma vez) |
| retorno à origem | `fim = 0` no circuito ⇒ a última perna entra na soma | **correto** (confirmado: a perna de retorno aparece na rota e na legenda) |
| soma das pernas | == total da API == custo do Held-Karp | **igual** (Δ 0,000 m) |
| desenho × custo | perna desenhada == célula da matriz | **igual** em 250/250 amostras |
| Held-Karp × força bruta | 250/250 amostras reais | **igual** |

**Nenhum defeito foi encontrado no cálculo.** Nenhuma linha do código de
cálculo foi alterada nesta rodada.

---

## 4. O que foi mudado (apenas a apresentação do empate)

### 4.1 Novo modo **“Menor rota total (saída curta)”**

* `core/ordemParadas.js` — nova função `heldKarpSaidaCurta(D, indices, inicio, fim)`:
  é o **mesmo Held-Karp**, com uma única diferença: o estado da programação
  dinâmica guarda, além do custo, a **primeira perna** do caminho, e as
  comparações são lexicográficas `(custo, comprimento da primeira perna)`.
  A decomposição ótima do Held-Karp continua válida (um prefixo de custo
  maior nunca pode fazer parte de um caminho mínimo; um prefixo do mesmo
  custo com primeira perna mais curta produz um caminho igualmente mínimo e
  melhor no desempate).
  **O total devolvido é sempre o mínimo global** — o desempate só atua
  entre ordens com o **mesmo** total.
* `core/ordemParadas.js` — `otimizarOrdem()` aceita
  `desempateSaidaCurta: true` e declara o método como
  `exato (desempate: saída curta)`.
* `core/rotaParadas.js` — novo modo `MODOS_ORDEM.SAIDA_CURTA = 'saida_curta'`;
  a comparação com a ordem do usuário (economia) passa a ser calculada
  também para ele.
* `server/index.js` — a API aceita `modo: 'saida_curta'`.
* `public/index.html` — terceiro botão de rádio no painel, com o rótulo
  **“Menor rota total (saída curta)”** e a descrição
  “mesmo total mínimo; em caso de empate, prefere a primeira perna mais
  curta a partir da origem”.
* `public/app.js` — o modo é repassado ao servidor e a nota da tela passa a
  dizer *“Ordem otimizada (saída curta) · método exato (Held-Karp, desempate
  pela saída curta)”*.

**O que NÃO mudou:** o objetivo de “Menor rota total”, o modo “Ordem do
usuário” (a sequência dos cartões é respeitada exatamente), a quantidade
dinâmica de paradas, o retorno obrigatório à origem, as cores por perna, a
legenda e o resto da interface.

### 4.2 Ferramenta de auditoria

`tools/auditar-ordem-paradas.js` (`npm run auditar:ordem`) imprime, em uma
execução: a conta do print, a busca do fingerprint e do padrão na rede
real, a matriz com os dois sentidos, o acesso à rede, **todas** as ordens
com a diferença para a melhor, Held-Karp × força bruta, o trecho desenhado
× a célula da matriz, a rota ótima global × a alternativa do vizinho mais
próximo (m e %) e a amostragem ampla.

`tools/validar-saida-curta.mjs` (`npm run validar:saida-curta`) prova o
comportamento no navegador real, com o caso do print.

---

## 5. Testes executados

| verificação | resultado |
|---|---|
| `npm test` | **218/218 PASSING** (202 anteriores + **16 novos** em `test/ordemOtimizada.test.js`) |
| `npm run auditar:ordem` | **AUDITORIA CONCLUÍDA — nenhuma inconsistência encontrada** |
| `npm run auditar:otimizacao` | **AUDITORIA CONCLUÍDA — nenhuma inconsistência encontrada** |
| `npm run validar:saida-curta` | **VALIDAÇÃO VISUAL APROVADA** (12/12, 0 erros de console) |
| `npm run validar:otimizacao` | APROVADA |
| `npm run validar:circular` | APROVADA |
| `npm run validar:trechos` | APROVADA |
| `npm run validar:mapa` | APROVADA |
| `npm run validar:paradas` | APROVADA |
| `npm run validar:navegacao` | APROVADA |
| `npm run validar:offline` | **VALIDAÇÃO OFFLINE APROVADA** (32/32) |
| `node tools/validate-routes.js 300` | **VALIDACAO APROVADA** |

### O que os 16 testes novos provam

**A — semântica do objetivo e do desempate** (matrizes conhecidas):

* A1 o desempate **não altera o total** (300 matrizes aleatórias, simétricas
  e assimétricas);
* A2 no empate, escolhe a ordem de **primeira perna mais curta**;
* A3 a reconstrução é válida (cada parada uma vez, origem no início e no
  fim) e o custo devolvido é o custo da ordem reconstruída;
* A4 a primeira perna mais curta **não** garante o circuito mais curto
  (matriz assimétrica com 10 m × 160 m contra 40 m × 135 m);
* A5 o desempate nunca piora o custo em relação ao Held-Karp usual.

**B — o caso real do print** (rede do snapshot):

* B1 a matriz real é simétrica, com diagonal zero, e vale exatamente
  540,185 / 757,506 / 673,150 / 291,350 / 228,207 / 215,700 m;
* B2 a ordem devolvida é **A→D→C→B→A** com **1.720,385 m**;
* B3 **A→B→C→D→A tem exatamente o mesmo total** (diferença 0 m, 0,0 %);
* B4 a alternativa do vizinho mais próximo custa **21,213 m a mais (1,2 %)**;
* B5 o modo “saída curta” devolve o **mesmo total** com a primeira perna
  mais curta;
* B6 o trecho desenhado é a célula da matriz custada, a soma é o total e a
  última perna é o retorno à origem;
* B7 o modo “Ordem do usuário” continua intacto;
* B8 o método usado é declarado na resposta;
* B9 a quantidade de paradas é dinâmica (5 paradas continuam funcionando);
* B10 amostragem real: Held-Karp == força bruta, desenho == custado;
* B11 `otimizarOrdem` aceita o desempate e declara o método.

### Capturas

| arquivo | o que mostra |
|---|---|
| `imagens/app-saida-curta.png` | a aplicação real com o circuito do print no modo **“Menor rota total (saída curta)”**: as 4 pernas coloridas (A→B, B→C, C→D e o retorno D→A tracejado) e a legenda |
| `imagens/painel-saida-curta.png` | o painel com os **três** modos de ordem de visita e o novo botão selecionado |

---

## 6. Resposta direta ao pedido

| pergunta | resposta |
|---|---|
| a rota A→D→C→B→A é mesmo a mais curta? | **sim** — ela é ótima (1.720,385 m); A→B→C→D→A tem **o mesmo** total |
| por que não começou pelo vizinho mais próximo? | **empate**: as duas ordens custam 1.720 m; o algoritmo devolveu uma das duas |
| a rota que começa pelo vizinho mais próximo é melhor? | **não** — a melhor com essa primeira perna custa **1.741,598 m (+21,213 m, +1,2 %)** |
| houve erro de cálculo? | **não** — matriz, indexação, Held-Karp, reconstrução, retorno à origem e desenho foram auditados e estão corretos (250/250 amostras reais) |
| o que mudou? | um **modo novo e separado** (“saída curta”) que, **no empate**, prefere a primeira perna mais curta **sem alterar o total mínimo** |

### Limitações declaradas

* oHeld-Karp exato cobre até **16 paradas intermediárias**; acima disso o
  método é heurístico (vizinho mais próximo + 2-opt) e é declarado como tal
  na resposta;
* a rede tem **342 componentes**: os pontos precisam estar no mesmo
  componente para haver caminho;
* não há dado de nível, calçada, sentido de circulação ou restrição de
  pedestre — o cálculo é sobre a geometria da rede;
* o acesso de um ponto **fora da rede** (até 100 m) é **medido e declarado**,
  mas não entra no custo — o trajeto desenhado começa já na rede.
