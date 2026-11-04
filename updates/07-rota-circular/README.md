# Rodada 7 — Rota circular (A → B → C → D → A)

> Pedido (resumo fiel): implementar uma **rota circular** no estilo *linha de
> ônibus* — A → B → C → D → **A** — com **duas estratégias** (menor rota total
> = TSP em ciclo; ordem definida pelo usuário), origem fixa, paradas
> editáveis/arrastáveis, **todos os trechos calculados na rede real** (nada de
> linha reta), erros explícitos, desenho de todos os trechos na ordem
> calculada, com o **trecho de retorno** identificado, preservação do
> painel/estilo/botões e acessibilidade por alternativa ao arraste.

---

## 1. O que foi entregue

| # | Entrega | Onde |
|---|---------|-------|
| 1 | **Tipo de trajeto "Circuito"** na interface (Ida e volta × Circuito) | `public/index.html` (`#tipos`), `public/app.js` |
| 2 | **Fechamento automático** na origem (trecho de retorno próprio, `retorno: true`) | `core/rotaParadas.js` |
| 3 | **TSP em ciclo** (origem fixa no início e no fim; custo inclui o fechamento) | `core/ordemParadas.js` (`circular: true`) |
| 4 | **Lista de pontos em modo circuito** (sem card de destino, origem fixa, arraste com limite correto) | `core/pontoTrajeto.js` |
| 5 | **API** aceita `circular` (boolean ou `"true"`) | `server/index.js` |
| 6 | **Mapa**: cada trecho como feature própria; o de retorno **tracejado**; legenda "Retorno à origem" | `public/app.js`, `public/styles.css`, `public/index.html` |
| 7 | **Painel**: "Tipo de trajeto", "Sequência percorrida", "Retorno à origem"; "Inverter" desabilitado | `public/app.js` |
| 8 | **13 testes automatizados** novos | `test/circular.test.js` |
| 9 | Validação na rede real (API) + validação visual no navegador | `tools/validar-circular.mjs` (`npm run validar:circular`) |

A suíte completa ficou em **116/116 testes** (103 na rodada 6 + 13 nesta rodada).

**Dependências adicionadas:** nenhuma em *runtime*. A única dependência nova do
projeto continua sendo `playwright` (devDependency), usada **apenas** pelos
scripts de validação visual no navegador — o mesmo arranjo das rodadas 5 e 6.

---

## 2. Como o circuito é modelado

### 2.1 O trajeto em duas dimensões

Antes eram duas coisas: *onde começa/termina* (destino livre) e *em que ordem
as paradas são visitadas* (TSP aberto). O circuito acrescenta uma terceira
dimensão: **o fecho**.

| | Ida e volta (rodada 5/6) | **Circuito (rodada 7)** |
|---|---|---|
| Origem | A (1º ponto) | A (1º ponto, **fixa**) |
| Destino | último ponto, livre | **não existe** — o destino é a própria origem |
| Nº de trechos | N − 1 | **N** (o último é o **fechamento**) |
| TSP | caminho hamiltoniano **aberto** (origem e destino fixos) | **ciclo** (origem fixa, custo inclui o retorno) |
| Ordem | otimizada ou do usuário | otimizada (menor ciclo) ou do usuário |

### 2.2 O trecho de retorno é um trecho de verdade

O fechamento **não** é um artefato de desenho: é uma chamada a
`routeOnGraph()` como qualquer outro, com origem = última parada e destino =
origem. Por isso ele:

* tem o **comprimento real** do caminho viário (4.768 m no ponto de teste);
* tem **geometria vinda da rede** (nunca uma reta);
* é sinalizado com `retorno: true` no objeto do trecho — é o que permite
  desenhá-lo tracejado e listá-lo separadamente;
* se não houver caminho para voltar, o erro é explícito e diz que o problema é
  **no retorno** (`TRECHO_SEM_CAMINHO`, com `falha.retorno = true`).

### 2.3 O TSP em ciclo

`otimizarOrdem(graph, pontos, { circular: true })`:

* `inicio = 0` (a origem) e `fim = 0` (**a mesma origem**) — o custo da ordem
  inclui `D[última parada][origem]`;
* todas as posições depois da origem são **paradas reordenáveis**;
* a ordem devolvida é `[origem, ...paradas]` — a origem **não** é repetida no
  fim da lista de visita; o fechamento é implícito e vira um trecho próprio
  quando a rota é montada;
* o Held-Karp é o mesmo código da rodada 6, com `fim = 0` — a exatidão é a
  mesma (o fecho métrico continua válida: `D[i][j] ≤ D[i][k] + D[k][j]`).

> Detalhe honesto: a ordem ótima de um **ciclo** é ambígua na rotação (A→B→C→D→A
> e B→C→D→A→B são o mesmo ciclo). O algoritmo devolve sempre a ordem que
> **começa na origem A**, porque é a origem que o usuário fixou — a
> combinação `A→D→B→C→A` e `A→C→B→D→A` são o mesmo circuito percorrido ao
> contrário, com o mesmo custo.

---

## 3. A interface

```
TIPO DE TRAJETO
  (•) Ida e volta   — A → paradas → destino
  ( ) Circuito       — A → paradas → A (linha de ônibus)

ORDEM DO TRAJETO
  (•) Menor rota     — otimiza a ordem das paradas (TSP)
  ( ) Ordem do usuário — respeita a sequência A → B → C…
```

No **circuito**:

* o card de **destino desaparece** (não há segundo ponto editável): o painel
  passa a mostrar **A (Origem · início e fim)**, B, C, D…;
* o botão **Inverter** fica **desabilitado** (com título explicando: no circuito
  a origem é fixa) — inverter não faria sentido;
* a **legenda** troca "Destino" por "**Retorno à origem**" (amarelo tracejado);
* o **mapa** desenha cada trecho separadamente e o de retorno **tracejado**, de
  modo que fica visível onde o circuito fecha;
* o painel de resultado ganha **"Tipo de trajeto: Circuito (A → … → A)"**,
  **"Sequência percorrida: A → C → B → D → A"** e
  **"Retorno à origem: D → A · 4768 m"**.

O **arraste no painel** (rodada 6b) continua funcionando e, no circuito, a
parada arrastada pode ocupar **qualquer** posição depois da origem — inclusive
a última (que é onde o trecho de retorno vai nascer). Foi preciso ajustar o
limite de inserção (`moverPontoPara`) para o modo circuito: soltar uma parada
sobre o **último** card a coloca **depois** dele, e não no lugar dele.

### 3.1 A alça é a única parte arrastável

O arraste do cartão começa **na alça** (o pontilhado à esquerda do rótulo) — e
não no cartão inteiro. Isso é deliberado: arrastar o cartão inteiro
interferiria nos campos de edição e na interação com o mapa (exigência do
pedido). A alça tem área de clique ampliada (12 × 18 px desenhados, com
*padding* maior) para continuar confortável de segurar.

### 3.2 Acessibilidade

* o arraste não é a única forma de reordenar: cada card tem os botões
  **↑ / ↓**, com `aria-label` descritivo, que aplicam exatamente a mesma
  regra;
* a alça de arraste tem `role="button"`, `tabindex="0"` e `aria-label`
  ("Reordenar parada B") — é focável pelo teclado;
* o estado do circuito é anunciado no painel: tipo de trajeto, sequência
  percorrida e trecho de retorno.

---

## 4. A API

### `POST /api/rota-paradas`

```jsonc
{
  "modo": "otimizada",        // "usuario" (padrão) | "otimizada"
  "circular": true,           // false (padrão) | true
  "pontos": [
    { "rotulo": "A", "latitude": -23.6526875, "longitude": -46.5081875 },
    { "rotulo": "B", "latitude": -23.6966277, "longitude": -46.5348612 }
  ]
}
```

`circular` aceita `true`, `"true"` ou `?circular=true` na query string.

Campos novos da resposta (só no circuito):

| Campo | Conteúdo |
|-------|----------|
| `circular` | `true` |
| `sequencia` | ordem **percorrida** (sem a repetição da origem): `["A","C","B","D"]` |
| `sequenciaCompleta` | ordem percorrida **fechada**: `["A","C","B","D","A"]` |
| `sequenciaUsuario` | ordem informada, fechada: `["A","B","C","D","A"]` |
| `retorno` | objeto do trecho de fechamento (`de`, `para`, `distance`, `distanceMeters`, `distanceKm`, `geometry`) |
| `paradas` | nº de paradas intermediárias (N − 1, em vez de N − 2) |
| `legs[].retorno` | `true` **apenas** no último trecho (o fechamento) |
| `comparacao` | economia calculada **incluindo** o fechamento |

Erros: `PONTOS_INSUFICIENTES` (circuito com menos de 2 pontos),
`COORDENADA_INVALIDA`, `PONTOS_SEM_CONEXAO`, `LIMITE_DE_PONTOS`,
`TRECHO_SEM_CAMINHO` (com `falha.de`, `falha.para` e `falha.retorno`).

---

## 5. Testes (`test/circular.test.js` — 13 casos)

| # | Teste | O que garante |
|---|-------|---------------|
| 1 | o circuito termina obrigatoriamente na origem | `sequenciaCompleta` começa e termina em A |
| 2 | o trecho de fechamento **não** é uma linha reta | a geometria do retorno tem o mesmo número de vértices da rede |
| 3 | o modo otimizado encontra o **menor ciclo** | conferido contra a força bruta (permutações) |
| 4 | no modo do usuário a sequência dos cards é a percorrida | nada é reordenado sem pedido |
| 5 | arrastar um card muda a ordem usada no cálculo | o arraste tem efeito real (A→C→B→D = 2.000 m) |
| 6 | circuito com **uma única** parada | A→B→A = 600 m ( ida + volta ) |
| 7 | somente a origem | `PONTOS_INSUFICIENTES`, com mensagem própria |
| 8 | endereço/coordenada inválida | `COORDENADA_INVALIDA` (inclusive `null`/`""`) |
| 9 | pontos coincidentes | não quebra o cálculo (comprimento zero tolerado) |
| 10 | ausência de caminho (inclusive **no retorno**) | `TRECHO_SEM_CAMINHO` nomeando o trecho que falhou |
| 11 | modo otimizado com pontos desconectados | `PONTOS_SEM_CONEXAO` recusado, sem linha reta |
| 12 | a lista em modo circuito **não tem card de destino** | a UI e a lista do core |
| 13 | Held-Karp em ciclo | o custo do Held-Karp inclui o fechamento |

Malha de teste usada: A→B 300 m, B→C 600 m, C→D 300 m, D→A 400 m ⇒
circuito A→B→C→D→A = **1.600 m**; depois do arraste (A→C→B→D→A) = **2.000 m**.

Suíte completa: **116/116**.

---

## 6. Validação na rede real (API, 4 pontos do mesmo componente)

```
modo "usuario"   ida e volta : 23.323 m   A → B → C → D
modo "usuario"   CIRCUITO    : 28.092 m   A → B → C → D → A
                                 retorno D → A = 4.768 m
modo "otimizada" ida e volta : 15.320 m   A → C → B → D      economia 8.004 m (34,3 %)
modo "otimizada" CIRCUITO    : 20.088 m   A → D → B → C → A  economia 8.004 m (28,5 %)
                                 método: exato (Held-Karp)
```

Os quatro pontos (A = `8FWR+WP` → −23,6526875 / −46,5081875) são os mesmos
usados na rodada 6 — estão no maior componente conexo da rede (342 componentes
no total), por isso todos os pares têm caminho.

---

## 7. Validação visual no navegador

`npm run validar:circular` (Chromium headless, aplicação real):

```
circuito fecha em A (menor rota):   SIM
circuito fecha em A (ordem do usuário): SIM
trecho de retorno desenhado:        SIM
menor rota é mais curta:              SIM (20,09 km × 28,09 km)
arraste mudou a rota:                 SIM (28,09 km → 20,16 km)
inverter indisponível no circuito:   SIM

VALIDAÇÃO VISUAL APROVADA
```

Capturas em `imagens/`:

| Arquivo | Conteúdo |
|---------|----------|
| `app-circuito-otimizado.png` | modo *Menor rota*: **A → C → B → D → A**, 20,09 km, retorno tracejado, legenda "Retorno à origem" |
| `app-circuito-usuario.png` | modo *Ordem do usuário*: **A → B → C → D → A**, 28,09 km |
| `app-circuito-arrastado.png` | depois do arraste no painel: os cards trocaram de lugar e a rota foi recalculada (28,09 → 20,16 km) |

Nas capturas dá para ver: o card **A** com o rótulo "ORIGEM · INÍCIO E FIM", o
botão **Inverter** desabilitado, a legenda com "Retorno à origem" (amarelo
tracejado), o **trecho de retorno desenhado tracejado** no mapa e o painel de
resultado com "Tipo de trajeto: Circuito (A → … → A)" e "Retorno à origem:
D → A · 4768 m".

---

## 8. Arquivos alterados nesta rodada

| Arquivo | O que mudou |
|---------|-------------|
| `core/rotaParadas.js` | opção `circular`: trecho de fechamento próprio (`retorno`), `sequenciaCompleta`, `retorno`, `comparacao` com o fecho, validação de coordenada nula |
| `core/ordemParadas.js` | `circular: true` → TSP **em ciclo** (`fim = 0`), todas as posições intermediárias reordenáveis |
| `core/pontoTrajeto.js` | modo circuito da lista: sem card de destino, origem fixa, `moverPontoPara` com limite compatível com o fecho |
| `server/index.js` | `/api/rota-paradas` aceita `circular` (bool ou `"true"`) |
| `public/index.html` | campo `#tipos` (Ida e volta × Circuito); legenda com "Retorno à origem"; correção do HTML da legenda (o `id` foi para a linha, não para o *swatch*) |
| `public/app.js` | `state.circuito`, desenho por trecho, retorno tracejado, `ajustarEnquadramento()` do circuito, estatísticas do circuito, "Inverter" desabilitado, `atualizarLegenda()` |
| `public/styles.css` | `--route-return`, `.swatch--route-return`, `.leg--retorno`, ajuste da legenda (linhas com `min-height` e `[hidden]` funcionando) |
| `test/circular.test.js` | **novo** — 13 testes |
| `tools/validar-circular.mjs` | **novo** — validação visual no navegador |
| `package.json` | script `validar:circular` |

---

## 9. Limitações conhecidas desta rodada

1. **O circuito exige que todos os pontos se alcancem** — se uma parada estiver
   em outro componente da rede, a resposta é `PONTOS_SEM_CONEXAO` e a otimização
   é recusada (o modo "Ordem do usuário" ainda devolve o trecho que falhou,
   nomeado).
2. **A otimização minimiza distância, não tempo** — a camada do WFS não traz
   tempo de travessia, faixa de pedestre, calçada ou inclinação (limitação já
   registrada nas rodadas anteriores e mantida aqui).
3. **Acima de 16 paradas intermediárias** a ordem do circuito passa a ser
   heurística (vizinho mais próximo + 2-opt) e a interface declara isso. O
   fecho continua incluído no custo.
4. **O retorno é desenhado tracejado, mas percorre a rede** — a diferença é
   apenas visual; o comprimento e a geometria são os de um trecho normal.
5. **Não há "horário de ida e volta"**: o circuito não modela sentido de
   circulação (a camada não tem esse atributo) — a rota é a pé e as arestas são
   bidirecionais, como nas demais rodadas.
6. **O cartão de destino continua sendo removido no circuito**: o app volta ao
   modo "Ida e volta" com um destino vazio se o usuário trocar o tipo de
   trajeto — nenhuma coordenada é inventada.
