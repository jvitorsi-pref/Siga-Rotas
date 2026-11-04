# Rodada 11 — Auditoria do modo "Menor rota total (otimizada)" e limpeza do painel

> **O que foi pedido**
> 1. auditar o modo otimizado **sem reescrever** o motor: corrigir apenas o que
>    estiver **comprovadamente errado**, e não concluir que há defeito só porque
>    "A→B é mais curto que A→D" (a decisão depende do custo **total** do ciclo);
> 2. não dar o algoritmo por correto sem conferir a **matriz**, a **implementação**
>    e os **testes**;
> 3. separar **medido / calculado / hipotético**;
> 4. se os dados reais não puderem ser reproduzidos, dizer o que faltou — sem
>    inventar valores;
> 5. **remover do painel** os blocos enviados por imagem.

---

## 1. O que foi auditado (e como)

Ferramenta permanente criada nesta rodada:

```bash
node tools/auditar-otimizacao.js      # ou: npm run auditar:otimizacao
```

Ela percorre o caminho **completo** do cálculo sobre a **rede real** (o mesmo
snapshot `data/network.snapshot.json` que o servidor usa) e imprime, para cada
caso:

| # | Verificação | Como é feita |
|---|---|---|
| 1 | **Matriz de custos** | `matrizDistancias` → `routeOnGraph` para cada par (caminho mínimo na rede) |
| 1 | **Simetria** | `D[i][j] === D[j][i]` para todos os pares |
| 1 | **Diagonal zerada** | `D[i][i] === 0` |
| 1 | **Pares sem caminho** | `Infinity` + lista `semCaminho` |
| 1 | **Nenhum "teleporte"** | todo custo ≥ distância em linha reta (haversine) |
| 2 | **Força bruta** | enumeração de **todas** as permutações do circuito (6 e 24), com o **retorno à origem incluído** |
| 2 | **Held-Karp × força bruta** | igualdade de custo e de optimum |
| 2 | **Cobertura** | cada parada visitada exatamente uma vez |
| 3 | **Rota desenhada** | para cada trecho: `distância do trecho === célula da matriz` |
| 3 | **Soma × total × Held-Karp** | `Σ pernas === distance === otimizacao.custo` |
| 3 | **Sequência painel × mapa** | `sequenciaCompleta` × a ordem dos trechos desenhados |
| 4 | **Modo "ordem do usuário"** | a sequência devolvida é **exatamente** a informada |
| 5 | **Método declarado** | `exato` (Held-Karp) ou `heurístico` (vizinho mais próximo + 2-opt) |

O script termina com **"AUDITORIA CONCLUÍDA — nenhuma inconsistência encontrada"**
e devolve **código de saída 1** se qualquer verificação falhar (portanto serve
também como gate).

---

## 2. Resultado da auditoria: o sintoma **não é defeito**

### 2.1 A estrutura (calculado)

A rede é **apenas pedonal**: todas as arestas são **bidirecionais**. Consequência
direta: a matriz de custos é **simétrica** (`D[i][j] = D[j][i]`), e o custo de um
ciclo **reverso** é **sempre** igual ao do ciclo original:

```
custo(A→B→C→D→A) = D[A][B] + D[B][C] + D[C][D] + D[D][A]
custo(A→D→C→B→A) = D[A][D] + D[D][C] + D[C][B] + D[B][A]
                  = D[D][A] + D[C][D] + D[B][C] + D[A][B]   (simetria)
                  = custo(A→B→C→D→A)
```

Ou seja: **o ciclo reverso é sempre uma solução ótima**. A intuition "A→B é mais
curto que A→D" é verdadeira para o **primeiro trecho**, mas não decide nada: o
que decide é a **soma do circuito inteiro** (incluindo o retorno à origem).

Quando duas ordagens empatam, o Held-Karp precisa escolher uma. O critério
implementado é determinístico (`custo < melhor` — vence a **primeira** sequência
encontrada, isto é, a de menor índice). O resultado é uma **ordem diferente da
informada com economia 0 m** — exatamente o que aparece na imagem reportada
(505 + 287 + 300 + 681 = 1.773 = 681 + 300 + 287 + 505).

**Isso é um empate matemático, não uma falha de otimização.** Um defeito real
seria o Held-Karp devolver um custo **maior** que a força bruta — e isso foi
conferido item a item nos 6 e 24 circuitos abaixo.

### 2.2 Reprodução na rede real (medido)

Rede: **4.545 eixos · 11.537 nós · 15.555 arestas · 342 componentes**.

Quatro pontos reais, todos na maior componente:

```
A  −23,627891 / −46,516183      B  −23,621109 / −46,516798
C  −23,624177 / −46,512398      D  −23,628655 / −46,509507
```

**Matriz de custos (m)** — caminho mínimo na rede, nunca linha reta:

|   | A | B | C | D |
|---|---|---|---|---|
| **A** | 0 | 990,0 | 675,1 | 1.066,8 |
| **B** | 990,0 | 0 | 609,9 | 1.384,1 |
| **C** | 675,1 | 609,9 | 0 | 774,3 |
| **D** | 1.066,8 | 1.384,1 | 774,3 | 0 |

Simetria: **SIM** · diagonal zerada: **SIM** · pares sem caminho: **nenhum** ·
nenhum custo abaixo da linha reta: **SIM**.

**As 6 permutações do circuito (com o retorno a A):**

| sequência | pernas (m) | total (m) |
|---|---|---|
| **A→B→C→D→A** | B→C=610 · C→D=774 · D→A=1.067 | **3.440,9** ← ótima |
| **A→D→C→B→A** | D→C=774 · C→B=610 · B→A=990 | **3.440,9** ← ótima |
| A→C→B→D→A | C→B=610 · B→D=1.384 · D→A=1.067 | 3.735,9 |
| A→D→B→C→A | D→B=1.384 · B→C=610 · C→A=675 | 3.735,9 |
| A→B→D→C→A | B→D=1.384 · D→C=774 · C→A=675 | 3.823,5 |
| A→C→D→B→A | C→D=774 · D→B=1.384 · B→A=990 | 3.823,5 |

* **Held-Karp devolve `A→D→C→B→A` = 3.440,9 m** — que é **exatamente** o
  optimum da força bruta (empate com a ordem do usuário).
* Ordem do usuário **A→B→C→D→A** = **3.440,9 m** ⇒ **economia 0 m (0,0 %)**.
* Note que **A→B (990 m) < A→D (1.067 m)**: a intuição do usuário se confirma
  no primeiro trecho — e ainda assim a ordem otimizada é a outra, porque as duas
  custam **o mesmo total**. É o empate, não um erro de escolha.

**Rota efetivamente desenhada** (mesmo caminho da API,
`POST /api/rota-paradas` → `calcularRotaComParadas`):

| trecho | desenhado | matriz | Δ |
|---|---|---|---|
| A → D | 1.067 m | 1.067 m | 0,0 |
| D → C | 774 m | 774 m | 1,1e−13 m |
| C → B | 610 m | 610 m | 0,0 |
| B → A (retorno) | 990 m | 990 m | 2,3e−13 m |

* soma dos trechos = 3.440,9 m = distância total = custo do Held-Karp ✔
* sequência do painel = sequência desenhada no mapa ✔ (`A → D → C → B → A`)
* modo "ordem do usuário": sequência devolvida = `A → B → C → D` ✔ (inalterada)

### 2.3 Segundo caso real, com 4 paradas (24 permutações)

| sequência | total (m) |
|---|---|
| **A→B→C→E→D→A** | **3.978,4** ← ótima |
| **A→D→E→C→B→A** | **3.978,4** ← ótima |
| A→C→B→E→D→A · A→D→E→B→C→A | 4.273,4 |
| A→B→E→C→D→A · A→D→C→E→B→A | 4.343,9 |
| A→B→C→D→E→A · A→E→D→C→B→A | 4.359,4 (ordem do usuário) |
| … (as demais 16) | 4.361 … 5.019 |

Held-Karp = `A→D→E→C→B→A` = **3.978,4 m** = força bruta ✔
Economia sobre a ordem do usuário: **380 m (8,7 %)** (usuário 4.359,4 m).

Ou seja: **quando existe uma ordem melhor, a economia é real e medida**; quando
não existe (empate), a economia é 0 m — e a aplicação passa a **dizer isso de
forma explícita** (ver §4).

---

## 3. Medido / calculado / hipotético

| | conteúdo |
|---|---|
| **MEDIDO** (executado nesta rodada, sobre o snapshot real) | a matriz de custos acima; as 6 e 24 permutações; Held-Karp = força bruta; cada trecho desenhado = célula da matriz (Δ ≤ 2,3e−13 m); soma dos trechos = total = custo do Held-Karp; sequência painel = sequência do mapa; modo "usuário" inalterado; método declarado `exato`; a reprodução do empate (economia 0 m) e de um caso com economia real (380 m / 8,7 %); a ausência dos dois blocos no painel (verificação no DOM); 157/157 testes; as validações visuais (ver §6) |
| **CALCULADO** (consequência lógica do modelo de dados, verificada nos exemplos acima) | numa rede pedonal **bidirecional**, `D[i][j] = D[j][i]` ⇒ o ciclo reverso tem **sempre** o mesmo custo ⇒ a ordem invertida nunca é pior ⇒ empate é resultado esperado e determinístico; o critério de desempate do Held-Karp (`c < melhor`) devolve a sequência de menor índice; os resíduos de ~1e−13 m são erro de ponto flutuante (soma de comprimentos em metros), não divergência de algoritmo |
| **HIPOTÉTICO** (o que **não** foi medido — e por quê) | os **valores exatos da imagem do usuário** (seus pontos não são conhecidos por esta aplicação): reproduziu-se o **sintoma** com dados reais, não os seus números; se a rede tivesse **sentido único** (contrary to the pedestrian rule), a matriz deixaria de ser simétrica e o empate não ocorreria — não é o caso desta aplicação; se houvesse mais de 16 paradas, o método passa a ser heurístico e a economia pode ser **menor** que a ótima (e a interface declara "método heurístico") |

---

## 4. O que foi **corrigido** (e o que **não** foi)

### 4.1 Não foi alterado

* `core/ordemParadas.js` — **nenhuma linha alterada**. A matriz, o Held-Karp, o
  2-opt e a vizinho-mais-próximo estão corretos: foi o que a auditoria
  demonstrou, célula a célula e permutação a permutação.
* `core/rotaParadas.js`, `core/router.js`, `core/graph.js` — **inalterados**.
* Modo "ordem do usuário", Endereço Digital, navegação, trechos coloridos —
  **inalterados**.

### 4.2 Correções de interface (o que a auditoria tornava visível)

| arquivo | mudança |
|---|---|
| `public/index.html` | **removido** o bloco de estatísticas do resultado (tabela "Tipo de trajeto / Trechos / Sequência percorrida / …") e **removido** o bloco **"Rede viária"** (estatísticas da rede + "Diagnóstico do grafo") |
| `public/app.js` | `els.stats`, `els.networkStats` e `els.diagnostics` removidos (o código que os preenchia também); `rows()` (que só existia para essas tabelas) removido; `loadDiagnostics()` deixou de escrever no painel e passa a expor o diagnóstico em `window.__app.diagnostico`; **nova nota compacta** `atualizarNotaDoTrajeto()`; rodapé de status passou a mostrar origem dos dados, hora da última verificação e avisos |
| `public/styles.css` | estilo `.route-note` (nota compacta) e remoção das regras `.stats`, que ficaram sem uso |

**Por que a nota compacta não foi removida junto com a tabela:** a garantia da
rodada 8 é que o método de otimização **sempre** seja declarado (exato ×
heurístico) e que a economia seja informada. Sem nenhum elemento no painel, essa
informação desapareceria. A nota substitui a tabela por **uma linha**:

```
Ordem otimizada · método exato (Held-Karp) · economia 380 m (8,7 %)
Ordem otimizada · método exato (Held-Karp) · economia 0 m (0,0 %) · empate: a ordem mudou, mas o custo total é o mesmo
Ordem do usuário · a sequência informada foi respeitada
```

A terceira linha é o caso do empate — **o painel passa a dizer explicitamente
que a ordem mudou sem mudar o custo**, que era exatamente a dúvida reportada.

> As duas imagens enviadas foram interpretadas assim: a **imagem 2** é o bloco de
> estatísticas do resultado (removido) e a **imagem 3** é o bloco "Rede viária"
> (removido). A **imagem 1** é uma forma de onda de áudio, sem qualquer
> correspondência na interface — **nada foi removido por causa dela**.

### 4.3 Manutenção (fora do escopo do pedido, mas necessário para o gate)

* `tools/validar-mapa.mjs` estava **quebrado desde a rodada 5** (usava os
  inputs `#origin`/`#destination`, que não existem mais na interface de cards):
  corrigido para preencher os cards A e B → `npm run validar:mapa` volta a
  rodar (2 rotas, capturas geradas).
* `tools/validar-{circular,otimizacao,mapa,paradas}.mjs` liam a tabela de
  estatísticas removida: passaram a ler a **sequência do estado da rota**
  (`window.__app.state.rotaAtual.sequenciaCompleta`) e a nova nota.

---

## 5. Testes automatizados (15 novos)

`test/otimizacaoAuditoria.test.js` — **A** (unidade, matrizes conhecidas) e
**B** (rede real):

| id | teste |
|---|---|
| A1 | `custoDaOrdem` — custo com origem e destino fixos, com e sem fechamento |
| A2 | **Held-Karp == força bruta** (todas as permutações) — caminho aberto |
| A2b | **Held-Karp == força bruta** — circuito com retorno à origem |
| A3 | o custo do circuito **inclui** o retorno (e a soma das pernas reconstrói o custo) |
| A4 | **o trecho inicial mais curto NÃO leva ao circuito mais curto** (armadilha clássica do TSP, matriz assimétrica) |
| A5 | **matriz assimétrica** — o Held-Karp não depende da simetria (e o reverso custa 80 × 50) |
| A6 | par **sem caminho viável** (`Infinity`) é evitado; sem nenhuma ordem viável → custo `Infinity` e ordem vazia |
| A7 | **reconstrução**: a ordem devolvida visita cada parada uma vez e seu custo é o custo do Held-Karp |
| A8 | **empate** numa matriz simétrica: o reverso custa o mesmo (economia 0 m) |
| B1 | matriz real **simétrica**, diagonal zero, nenhum custo abaixo da linha reta |
| B2 | Held-Karp == força bruta no caso real (6 permutações) |
| B3 | no caso real a ordem do usuário **empata** com a otimizada (economia 0 m) |
| B4/B5/B6 | rota otimizada: **trecho desenhado = célula da matriz**, **soma dos trechos = total = custo do Held-Karp**, sequência **começa e termina na origem** com o trecho de retorno presente |
| B7 | modo "ordem do usuário" preserva **exatamente** a sequência informada |
| B8 | `otimizarOrdem` declara o método e devolve a origem em primeiro lugar, sem repetir paradas |

**Suíte completa: 157/157** (142 anteriores + 15 novos).

---

## 6. Verificações executadas

```
npm test                                  → 157/157
node tools/auditar-otimizacao.js          → AUDITORIA CONCLUÍDA — nenhuma inconsistência encontrada
npm run validar:mapa                      → 2 rotas, capturas geradas
npm run validar:paradas                   → Validação visual concluída
npm run validar:otimizacao                → VALIDAÇÃO VISUAL APROVADA
npm run validar:circular                  → VALIDAÇÃO VISUAL APROVADA
npm run validar:trechos                   → VALIDAÇÃO VISUAL APROVADA (12/12)
npm run validar:navegacao                 → VALIDAÇÃO VISUAL APROVADA (15/15)
```

Verificação no navegador do painel (DOM): `#stats` **ausente**, `#network-stats`
**ausente**, `#diagnostics` **ausente**, `#route-note` **presente e visível**,
**nenhum erro de console**.

Capturas: `imagens/painel-sem-blocos.png` (painel com os dois blocos removidos e
a nota compacta) e `imagens/app-otimizada.png` (aplicação completa).

---

## 7. Arquivos desta rodada

| arquivo | situação |
|---|---|
| `tools/auditar-otimizacao.js` | **novo** — auditoria de ponta a ponta do modo otimizado |
| `test/otimizacaoAuditoria.test.js` | **novo** — 15 testes (matriz, Held-Karp, ciclo, retorno, reconstrução, assimetria, sem caminho, empate, rede real) |
| `public/index.html` | os dois blocos removidos; nota compacta adicionada |
| `public/app.js` | referências aos blocos removidos eliminadas; `atualizarNotaDoTrajeto()` nova; `rows()` removida; diagnóstico exposto em `window.__app.diagnostico` |
| `public/styles.css` | estilo `.route-note` |
| `tools/validar-mapa.mjs` | corrigido (usava campos que não existem mais) |
| `tools/validar-{circular,otimizacao,mapa,paradas}.mjs` | leem a nova nota / o estado da rota |
| `package.json` | script `auditar:otimizacao` |
| `README.md` | §21 (esta rodada) + TOC, §2, §13, §14 |

**Nada mais foi alterado**: o motor de roteamento, o grafo, o cliente WFS, o
geocodificador e a navegação continuam exatamente como estavam.

---

## 8. Como reproduzir

```bash
npm install                     # só para os testes de navegador (Playwright)
npm start                       # sobe a aplicação em :8080

npm test                        # 157 testes
node tools/auditar-otimizacao.js  # auditoria numérica na rede real
npm run auditar:otimizacao         # idem (atalho)
```

Para ver o caso do empate na interface: modo **Circuito**, pontos

```
A  −46,516183 / −23,627891
B  −46,516798 / −23,621109
C  −46,512398 / −23,624177
D  −46,509507 / −23,628655
```

A rota sai `A → D → C → B → A` com **3,44 km** e a nota do painel informa
*"economia 0 m (0,0 %) · empate: a ordem mudou, mas o custo total é o mesmo"*.

---

## 9. Limitações desta rodada

* A auditoria usa o **snapshot** da rede (`data/network.snapshot.json`); se o
  GeoServer publicar uma versão nova, os números mudam — **as relações**
  (simetria, Held-Karp = força bruta, trecho = matriz) continuam válidas e são
  reconferidas a cada execução.
* A reprodução do sintoma usa **pontos reais escolhidos por busca** na rede; os
  pontos exatos da imagem do usuário **não são conhecidos** por esta aplicação
  (a imagem não traz coordenadas legíveis) — o que se reproduziu foi o
  **comportamento**, com dados reais.
* A auditoria cobre **circuitos de 3 e 4 paradas** (6 e 24 permutações) — a
  comparação com a força bruta é exponencial e não é viável acima disso; acima
  de 16 paradas o método já é heurístico por decisão de projeto (§3).
* Nenhuma conclusão sobre **direção de tráfego**, **calçadas** ou **nível** foi
  feita: a camada não traz esses atributos (limitações conhecidas, §11 do
  README principal).
