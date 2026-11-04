# Rodada 8 — Trechos coloridos, quantidade dinâmica de paradas e modos de roteamento

> Pedido (resumo fiel): **quantidade de paradas variável** (sem limite fixo na
> interface), **dois modos de roteamento** (menor rota total, incluindo o
> retorno à origem; e ordem do usuário, exatamente a dos cards), e
> **visualização colorida por trecho** — cada trecho consecutivo com a sua cor
> (incluindo o retorno à origem), com a correspondência trecho↔cor exibida na
> legenda. Tudo isso **no projeto existente**, preservando o mecanismo de
> roteamento, a geocodificação e o Endereço Digital.

---

## 1. O que foi entregue

| # | Entrega | Onde |
|---|---------|-------|
| 1 | **Paleta de cores por trecho** (módulo isomórfico, testado) | `core/coresTrechos.js` (novo) |
| 2 | A API devolve a **cor de cada trecho** (`legs[].cor`), inclusive do retorno | `core/rotaParadas.js` |
| 3 | **Quantidade de paradas dinâmica**: a interface não fixa número de pontos; o limite de segurança do servidor foi ampliado e declarado | `core/ordemParadas.js` (`LIMITE_TOTAL` 30 → **80**) |
| 4 | **Mapa**: cada trecho é uma geometria própria, desenhada na sua cor | `public/app.js` (`desenharRota`, estilo da camada) |
| 5 | **Legenda dinâmica** "Trechos da rota": trecho, origem, destino e cor | `public/index.html`, `public/app.js` (`atualizarLegenda`) |
| 6 | **Painel**: chip com a cor do trecho ao lado de cada linha de trecho | `public/app.js` (`showRoute`) |
| 7 | Rótulo do modo → **"Menor rota total"** | `public/index.html`, `public/app.js` |
| 8 | Remover uma parada **recalcula** (ou limpa o desenho): nunca sobram geometrias antigas | `public/app.js` (`reaplicarOrdem`) |
| 9 | **7 testes** automatizados novos | `test/coresTrechos.test.js` (novo) |
| 10 | Validação visual no navegador (cores, legenda, arraste, remoção) | `tools/validar-trechos-coloridos.mjs` (`npm run validar:trechos`) |

A suíte completa ficou em **123/123 testes** (116 na rodada 7 + 7 nesta rodada).

**Dependências:** nenhuma nova. `playwright` continua sendo a única
dependência de *desenvolvimento*, usada só pelos validadores visuais.

---

## 2. Quantidade dinâmica de paradas

O que já existia e foi preservado:

* o botão **"+ Adicionar parada"** nunca teve limite — a lista de pontos
  (`core/pontoTrajeto.js`) é uma lista pura, sem teto de itens;
* os cards podem ser **editados, removidos e reordenados** (arrastar no painel
  ou botões ↑/↓), e os rótulos (A, B, C…) são **posicionais** — quem se move é
  o conteúdo, não o nome.

O que mudou nesta rodada:

| Antes | Agora |
|---|---|
| `LIMITE_TOTAL = 30` no otimizador (recusa da API) | `LIMITE_TOTAL = 80` — **proteção do servidor**, não da interface, e a mensagem diz isso explicitamente |
| Remover uma parada deixava a rota antiga no mapa | Remover recalcula (ou limpa o desenho e a legenda se o trajeto deixou de ser calculável) |

> O limite de 80 pontos existe porque cada par de pontos da otimização exige um
> **caminho mínimo na rede** (a matriz de distâncias é O(n²) rotas). Acima de
> **16 paradas intermediárias** o método deixa de ser exato e passa a ser
> heurístico — e a interface **declara** isso ("heurístico (vizinho mais
> próximo + 2-opt)"), nunca se prometendo o ótimo global.

---

## 3. Os dois modos de roteamento

| Modo | O que faz |
|---|---|
| **Menor rota total** | otimiza a ordem de visita para **minimizar a distância total do circuito, incluindo o retorno à origem** (TSP em ciclo: `fim = 0`) — até 16 paradas intermediárias a solução é **exata** (Held-Karp); acima disso, heurística declarada |
| **Ordem do usuário** | respeita **exatamente** a ordem dos cards (que o usuário arrasta), calculando o caminho entre paradas consecutivas **e o retorno à origem** |

Nada mudou no motor: o caminho mínimo continua sendo o mesmo A\* sobre o
grafo real do WFS, com 0 divergências contra Dijkstra (1.500 pares) e com a
geometria original dos eixos preservada.

---

## 4. A visualização colorida por trecho

### 4.1 A regra

A cor representa o **trecho entre duas paradas** — nunca a "posição" de uma
parada nem o "modo de roteamento" (a rota inteira não é azul no modo
otimizado e verde no modo do usuário). A sequência é a do percurso:

```
A → B   azul      #1d4ed8
B → C   verde     #15803d
C → D   laranja   #ea580c
D → E   roxo      #7c3aed
E → A   carmim    #be123c   (no circuito: o retorno, desenhado tracejado)
```

Regras garantidas por teste (`test/coresTrechos.test.js`):

* **trechos adjacentes têm cores diferentes**;
* quando a **paleta se esgota** (12 cores), a reutilização é **organizada** —
  a paleta é percorrida em ciclo — e **nunca** repete a cor do trecho
  imediatamente anterior;
* a atribuição é **determinística**: a mesma sequência de trechos produz sempre
  as mesmas cores, e o servidor e o navegador (que usam o **mesmo módulo**)
  concordam.

### 4.2 O desenho no mapa

Cada trecho passa a ser uma **feature própria** da camada da rota (antes só o
circuito já desenhava trecho a trecho; agora também o trajeto de ida e volta).
O traço continua com a mesma cartografia de sempre — **halo branco** e
**contorno escuro** iguais para todos — e só o **núcleo** assume a cor do
trecho: é o que garante a legibilidade sobre o mapa-base claro sem perder a
separação entre a rota e a rede viária.

O trecho de **retorno à origem** mantém o traço **tracejado**, agora na cor
que lhe cabe (a última da sequência).

### 4.3 A legenda

A legenda ganhou uma seção **"TRECHOS DA ROTA"**, montada a partir dos
trechos da rota calculada:

```
TRECHOS DA ROTA
  ▬ A → D
  ▬ D → E
  ▬ E → B
  ▬ B → C
  ▬ C → A  retorno
```

Ela é **reconstruída** a cada recálculo: quando a otimização muda a sequência,
quando o usuário reordena os cards, quando edita um endereço e recalcula ou
quando remove uma parada. No erro, a seção é esvaziada (não fica mostrando a
correspondência de uma rota que deixou de existir).

O painel de resultado também mostra o **chip com a cor** de cada trecho, ao
lado de "A → B", para que a leitura não dependa só do mapa.

### 4.4 Sem geometrias antigas

`routeSource.clear()` é chamado no início de cada desenho; o erro limpa o
desenho e a legenda; e a remoção de uma parada passou a **recalcular** (ou
limpar) em vez de deixar a rota anterior no mapa.

---

## 5. Testes (`test/coresTrechos.test.js` — 7 casos)

| # | Teste | O que garante |
|---|-------|---------------|
| 1 | a paleta tem cores distintas e bem formadas | 12 cores únicas em `#rrggbb` |
| 2 | trechos adjacentes têm cores diferentes | verificado de 2 a 100 trechos |
| 3 | paleta esgotada: reutilização organizada | a paleta é percorrida em ciclo e a cor vizinha nunca se repete |
| 4 | atribuição determinística e independente do modo | a mesma sequência ⇒ as mesmas cores, nos dois modos |
| 5 | a cor representa o trecho, não a posição da parada | o trecho carrega `de`, `para`, `indice` e `cor` |
| 6 | o retorno à origem tem cor própria e a rota é contínua | 4 trechos, 4 cores distintas; a geometria concatenada termina onde o trecho de retorno termina |
| 7 | quantidade de paradas dinâmica | 8 pontos ⇒ 8 trechos (com o retorno) e 7 paradas intermediárias |

Suíte completa: **123/123**.

---

## 6. Validação visual no navegador

`npm run validar:trechos` (Chromium headless, aplicação real, 5 paradas):

```
1) modo Circuito com 5 paradas (quantidade dinâmica)
   cards: A B C D E
2) modo "Menor rota total"
   distância: 36,88 km
   cores no mapa : #1d4ed8 #15803d #ea580c #7c3aed #be123c
   legenda       : A → D / D → E / E → B / B → C / C → A retorno
3) modo "Ordem do usuário": 47,46 km — cores e legenda reconstruídas
4) arrasta um card: 36,95 km — cores e legenda acompanham a nova ordem
5) remove uma parada: 30,89 km — a visualização encolhe (4 trechos)

um tom por trecho (cores vizinhas diferentes): SIM
cores bem formadas no mapa:                 SIM
legenda bate com as cores do mapa:            SIM (5 linhas)
chips do painel batem com o mapa:             SIM (5 trechos)
trecho de retorno com cor própria:           SIM
modo "ordem do usuário" reconstrói a legenda: SIM
arraste atualiza cores e legenda:             SIM
remoção encolhe a visualização:               SIM
quantidade de paradas é dinâmica:            4 cards (era 5)

VALIDAÇÃO VISUAL APROVADA
```

Capturas em `imagens/`:

| Arquivo | Conteúdo |
|---------|----------|
| `app-trechos-coloridos.png` | modo *Menor rota total*: 5 trechos coloridos no mapa + legenda com a correspondência |
| `app-trechos-ordem-usuario.png` | modo *Ordem do usuário*: 47,46 km, cores e legenda reconstruídas |
| `app-trechos-arrastado.png` | depois do arraste no painel: a visualização inteira acompanha a nova ordem |

---

## 7. Arquivos alterados nesta rodada

| Arquivo | O que mudou |
|---------|-------------|
| `core/coresTrechos.js` | **novo** — paleta, `coresDosTrechos()`, `colorirTrechos()` |
| `core/rotaParadas.js` | cada trecho passa a ter `cor`; o objeto `retorno` também |
| `core/ordemParadas.js` | `LIMITE_TOTAL` 30 → 80 (proteção do servidor, declarada); mensagem do limite mais clara |
| `public/app.js` | desenho por trecho com cor; legenda dinâmica dos trechos; chip de cor no painel; rótulo "Menor rota total"; remoção de parada recalcula; `reaplicarOrdem` limpa o desenho quando o trajeto ficou incompleto |
| `public/index.html` | seção "Trechos da rota" na legenda; rótulo "Menor rota total" e nota do seletor; cache-buster |
| `public/styles.css` | `.swatch--trecho`, `.legend__trechos`, `.legend__titulo`, `.legend__retorno`, `.leg__cor`; swatch da rota virou degradê (um tom por trecho) |
| `test/coresTrechos.test.js` | **novo** — 7 testes |
| `tools/validar-trechos-coloridos.mjs` | **novo** — validação visual |
| `package.json` | script `validar:trechos` |

---

## 8. Limitações conhecidas desta rodada

1. **A paleta tem 12 cores.** A partir do 13º trecho as cores se repetem — de
   forma organizada (ciclo) e nunca em trechos vizinhos. A distinção visual
   passa a depender do **rótulo** (A → B) e não só da cor.
2. **A cor acompanha a posição do trecho na sequência**, não a identidade do
   par de paradas: se a sequência muda (otimização ou arrasto), as cores são
   reatribuídas e a legenda é refeita — é o que o pedido pede ("atualizar os
   trechos, as cores, os rótulos e a legenda de acordo com a nova sequência").
3. **A otimização continua limitada a 16 paradas intermediárias para ser
   exata.** Acima disso o método é heurístico e a interface diz.
4. **A quantidade de paradas é dinâmica na interface**, mas a API recusa
   pedidos com mais de 80 pontos (proteção de tempo: a matriz de distâncias
   custa um caminho mínimo por par). A mensagem de recusa explica isso e
   oferece o modo "ordem do usuário", que não tem esse limite.
5. **A cor é só visual**: não muda nenhum cálculo, nenhuma distância e
   nenhuma ordem — a rota é exatamente a que o motor de roteamento devolveu.
