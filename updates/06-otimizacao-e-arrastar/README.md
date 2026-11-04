# Rodada 6 — Rota otimizada + arrastar os pontos no mapa

> Pedido (na íntegra): *"preciso que a menor rota seja otimizada, e que o usuário
> possa arrastar os pontos de origem/destino e os pontos de parada para mudar a
> rota, e que tenha duas opções, a rota otimizada e a rota escolhida pelo usuário
> (prioridade definida a partir do escopo usado)"*.

---

## 1. O que foi entregue

| # | Entrega | Onde |
|---|---------|-------|
| 1 | **Otimização da ordem de visita** (TSP sobre o fecho métrico da rede) | `core/ordemParadas.js` |
| 2 | **Dois modos de rota**: *Menor rota* (otimizada) e *Ordem do usuário* | `core/rotaParadas.js`, `server/index.js`, `public/` |
| 3 | **Arrastar a ordem dos pontos no painel lateral**, com recálculo automático | `public/app.js` (HTML5 drag & drop), `core/pontoTrajeto.js` (`moverPontoPara`) |
| 3b | *Extra*: arrastar os marcadores no mapa também move o ponto | `public/app.js` (interação `ol.interaction.Translate`) |
| 4 | API `/api/rota-paradas` passa a aceitar `modo` | `server/index.js` |
| 5 | 10 testes automatizados novos | `test/ordemParadas.test.js` |
| 6 | Validação na rede real + validação visual no navegador | `tools/validar-otimizacao.js`, `tools/validar-otimizacao.mjs` |

A suíte completa ficou em **98/98 testes** (88 na rodada 5 + 10 nesta rodada).

---

## 2. Prioridade das duas opções — de onde ela vem

O escopo acumulado do projeto determina a prioridade:

* **Rodada 2** — *"a menor rota não foi a escolhida, melhore o critério para
  sempre escolher a melhor rota"*. O requisito de **menor rota** é, portanto,
  o escopo de referência do projeto.
* **Rodada 5** — o pedido foi **respeitar a ordem do usuário** (e não
  otimizar). Aquela instrução foi cumprida e continua válida: é exatamente a
  segunda opção.
* **Rodada 6** — o pedido volta a exigir a **menor rota otimizada** *e* as
  duas opções.

Decisão: **`Menor rota` (otimizada) é o modo padrão** da aplicação, porque o
requisito de "sempre escolher a melhor rota" é o escopo do projeto; a **Ordem do
usuário** fica disponível como alternativa explícita, com um clique, e é
respeitada integralmente quando selecionada. Nada é reordenado sem o usuário
saber: o painel mostra a *sequência informada* e a *sequência percorrida*.

---

## 3. Como a otimização funciona (e por que ela é honesta)

O roteamento **não** foi reescrito: o motor de caminhos mais curtos (A* sobre o
grafo real do WFS) continua sendo o mesmo, validado contra Dijkstra
(0 divergências em 1.500 pares). O que a rodada 6 acrescenta é a camada de
**ordem de visita** por cima dele.

### 3.1 Fecho métrico

Para cada par de pontos do trajeto é calculada a **distância de menor caminho
viano** entre eles (`matrizDistancias()`). Essa matriz é o **fecho métrico** do
problema: distâncias de verdade, medidas na rede, não distâncias em linha reta
nem distidades euclidianas entre pontos.

Propriedades garantidas por teste (`test/ordemParadas.test.js`, caso 4):

* simetria — `D[i][j] = D[j][i]`;
* desigualdade triangular — `D[a][c] ≤ D[a][b] + D[b][c]`;
* `D[i][i] = 0`.

Sem essas propriedades o problema de TSP não teria a solução exata que a
otimização exata assume.

### 3.2 Dois métodos

| Método | Quando | Garantia |
|--------|--------|----------|
| **Held-Karp** (programação dinâmica) | até **16 paradas intermediárias** (18 pontos no total) | **ÓTIMO** — melhor ordem possível, provado |
| **Vizinho mais próximo + 2-opt** | acima disso (limite total de 30 pontos) | heurística — boa ordem, **sem** garantia de ótimo; a interface diz "heurístico" |

* `heldKarp()` — Held-Karp clássico: `O(n²·2ⁿ)`, com o custo do último trecho
  até o destino fixado. O destino é fixo (último ponto) e a origem é fixa
  (primeiro ponto): a otimização acontece **no meio** do trajeto, como se
  espera de um trajeto de pedestres com origem e destino dados.
* `doisOpt()` — improvement 2-opt sobre vizinho mais próximo; por construção
  **nunca piora** a ordem (testado).

O método usado é sempre informado na resposta da API
(`otimizacao.metodo = "exato" | "heuristico"`) e mostrado no painel. **Nunca se
afirma exatidão quando a heurística foi usada.**

### 3.3 Erros explícitos

| Situação | Erro | Mensagem |
|----------|------|----------|
| Paradas em componentes desconexos | `PONTOS_SEM_CONEXAO` | quais pontos não se alcançam |
| Acima de 30 pontos | `LIMITE_DE_PONTOS` | o limite é declarado |
| Trecho sem caminho viável | `TRECHO_SEM_CAMINHO` | **qual** trecho falhou (ex.: "B → C") |

Em nenhum caso é desenhada uma linha reta para "tapar" a falha.

---

## 4. Os dois modos na interface

```
ORDEM DO TRAJETO
  (•) Menor rota       — otimiza a ordem das paradas (TSP)
  ( ) Ordem do usuário — respeita a sequência A → B → C…
```

No painel, ao calcular no modo otimizado, aparecem:

* **Sequência informada** — a ordem que o usuário digitou;
* **Sequência percorrida** — a ordem efetivamente usada;
* **Ordem alterada** — "sim (pela otimização)", quando houve mudança;
* **Economia da otimização** — em metros e em %;
* **Método de otimização** — "exato (Held-Karp)" ou
  "heurístico (vizinho mais próximo + 2-opt)".

No modo *Ordem do usuário* nada é reordenado: a sequência percorrida é
sempre a informada.

---

## 5. Arrastar a ordem dos pontos no painel lateral

> *"na hora de arrastar eu quis dizer arrastar a ordem das rotas no painel
> lateral"* — é esta a leitura adotada.

Na lista **PONTOS DO TRAJETO**, cada parada tem uma **alça** (o pontilhado à
esquerda do rótulo). O usuário arrasta a parada e a **ordem de visita** muda:
a linha arrastada troca de lugar com a linha sobre a qual ela é solta. A
rota é **recalculada automaticamente**.

Regras (todas em `core/pontoTrajeto.js`, isomórfico e testado):

* a **origem** (primeira linha) e o **destino** (última linha) **não** podem
  ser arrastados — eles definem o começo e o fim do trajeto;
* uma parada só pode ocupar a faixa das paradas intermediárias;
* os **rótulos são posicionais** (A = origem; a última linha = destino; as do
  meio são B, C, D… pela ordem): arrastar troca o **conteúdo** das linhas, e
  a lista continua se lendo A → B → C → D com a nova ordem embaixo;
* a rota recalculada segue a nova lista **no modo "Ordem do usuário"**.

> No modo "Menor rota" a otimização reordena as paradas de novo — é o
> comportamento pedido na rodada 6. A interface diz isso explicitamente na
> nota abaixo do seletor de modo, e mostra a *sequência informada* ao lado da
> *sequência percorrida*.

### 5.1 O que a interface mostra durante o arraste

* a linha arrastada fica esmaecida (`.point--arrastando`);
* a linha sobre a qual ela será solta ganha um contorno âmbar e a tarja
  **"SOLTAR AQUI"** (`.point--alvo`);
* ao soltar, o rodapé informa a nova ordem e a rota é recalculada.

### 5.2 Extra: arrastar os marcadores no mapa

Como o pedido original também falava em *"arrastar os pontos de origem/destino
e os pontos de parada para mudar a rota"*, o arraste dos marcadores no mapa
foi mantido como **funcionalidade adicional**: pega-se o marcador **A**,
**B**, **C**… e arrasta-se. Ao soltar:

1. a nova coordenada é lida do marcador (EPSG:3857 → EPSG:4326);
2. o ponto passa a ter aquela coordenada e o estado **CONVERTIDO**;
3. o Endereço Digital anterior é **zerado** (ele não vale mais para a nova
   posição — nada é inventado);
4. a rota é **recalculada automaticamente** (se o trajeto estiver completo).

### 5.3 Detalhes da API do OpenLayers 10.6 (verificados no navegador)

Esta parte custou tempo e vale registrar, porque a documentação doTranslate
não deixa claro:

* o `Translate` **não tem `setFeatures`** no OpenLayers 10.6.1 (existe no
  `Select`, não no `Translate`);
* a opção `features` do `Translate` exige uma **`ol.Collection`** (o código
  chama `features_.getArray()`), e **move o conjunto inteiro** de uma vez —
  ou seja, não serve para arrastar um marcador por vez;
* a solução usada: `new ol.interaction.Translate({ layers: [markerLayer],
  filter: (f) => f.get('rotulo') != null, hitTolerance: 8 })` — sem `features`,
  o Translate move **apenas o marcador agarrado**, e o `layers` restringe o
  agarramento à camada de marcadores (as ruas da rede **nunca** são movidas
  pelo usuário);
* o evento `translateend` entrega `features` como `Collection`;
* os marcadores são **reaproveitados** entre desenhos (a mesma `feature` é
  movida e reestilizada), para não quebrar a interação de arraste.

---

## 6. API

### `POST /api/rota-paradas`

```jsonc
{
  "modo": "usuario",          // "usuario" (padrão) | "otimizada"
  "pontos": [
    { "rotulo": "A", "latitude": -23.6526875, "longitude": -46.5081875 },
    { "rotulo": "B", "latitude": -23.6966277, "longitude": -46.5348612 }
  ]
}
```

Resposta (200) — campos novos em relação à rodada 5:

| Campo | Conteúdo |
|-------|----------|
| `modo` | modo usado |
| `sequencia` | ordem **percorrida** |
| `sequenciaUsuario` | ordem **informada** |
| `ordemAplicada` | idem `sequencia` |
| `otimizacao.metodo` | `exato` \| `heuristico` |
| `otimizacao.ms` | tempo da otimização |
| `otimizacao.custo` | custo (metros) da ordem escolhida |
| `comparacao.distanciaUsuario` | custo da ordem informada |
| `comparacao.distanciaOtimizada` | custo da ordem escolhida |
| `comparacao.economia` | metros economizados |
| `comparacao.economiaPercentual` | economia em % |

Erros: `PONTOS_INSUFICIENTES`, `COORDENADA_INVALIDA`, `PONTOS_SEM_CONEXAO`
(422), `LIMITE_DE_PONTOS` (422), `TRECHO_SEM_CAMINHO` (422).

---

## 7. Testes (`test/ordemParadas.test.js`)

| # | Teste | O que garante |
|---|-------|---------------|
| 1 | ordem otimizada nunca é pior | o custo otimizado ≤ o custo informado |
| 2 | Held-Karp = força bruta | o método exato confere com a enumeração de todas as permutações |
| 3 | 2-opt nunca piora | o improvement é monotônico |
| 4 | matriz simétrica e com desigualdade triangular | o fecho métrico é válido |
| 5 | soma dos trechos = distância total | a distância reportada é a soma real |
| 6 | modo "ordem do usuário" respeita a sequência | nada é reordenado sem pedido |
| 7 | geometria preservada na rota otimizada | os vértices originais das curvas continuam lá |
| 8 | pontos sem conexão são recusados | erro explícito, sem linha reta |
| 9 | mover um ponto muda a rota | o arraste no mapa tem efeito real (rede com ramificações) |
| 10 | limites declarados | `LIMITE_EXATO` (16) < `LIMITE_TOTAL` (30) |
| 11 | arrastar uma parada troca a ordem de visita | o conteúdo das linhas troca de lugar e os extremos ficam fixos |
| 12 | origem e destino não podem ser arrastados | o arraste é recusado nas extremidades |
| 13 | arrastar fora da faixa é limitado | a parada vira a primeira/última parada, nunca origem ou destino |
| 14 | a ordem arrastada define a rota | no modo "ordem do usuário" a distância muda (1.200 m → 1.600 m na malha de teste) |
| 15 | botões ↑/↓ seguem a mesma regra | a reordenação por botão é equivalente ao arraste |

> Caso 9 usa uma rede **com ramificações** de propósito: num anel, a ordem de
> visita não altera a distância total, e o teste passaria sem provar nada.

---

## 8. Validação na rede real

`npm run validar:tsp` (6 pontos reais do maior componente conexo da rede):

```
modo "usuario"    : 47.743 m   A → E → D → C → B → F
modo "otimizada"  : 43.662 m   A → E → D → B → C → F   (método exato, 27 ms)
economia          : 4.081 m (8,5 %)

A→D→B→C→E→F   usuário 51.460 m | otimizada 43.662 m | economia  7.797 m
A→D→E→B→C→F   usuário 57.040 m | otimizada 43.662 m | economia 13.377 m
A→C→D→E→B→F   usuário 60.613 m | otimizada 43.662 m | economia 16.950 m (28,0 %)
A→B→C→D→E→F   usuário 56.118 m | otimizada 43.662 m | economia 12.455 m

✓ em todas as ordens testadas a otimização foi melhor ou igual
```

Nenhuma linha reta: todos os trechos têm geometria vinda da rede.

## 9. Validação visual no navegador

`npm run validar:otimizacao` (Chromium headless, aplicação real):

```
A: "8FWR+WP" → Convertido: -23.652687, -46.508187 (588M8FWR+WP)
modo otimizada : 15,32 km   sequência A → C → B → D
                 economia 8.004 m (34,3 %) — método exato (Held-Karp)
modo usuário   : 23,32 km   sequência A → B → C → D
arraste do B   : -46.534861, -23.696628 → -46.532930, -23.698003
                 status "Ponto B movido. Recalculando a rota…"
                 distância 23,32 km → 23,20 km

arraste da ORDEM no painel (modo "ordem do usuário"):
   antes  → B: -46.532930, -23.698003 | C: -46.504766, -23.645216 | 23,20 km
   depois → B: -46.504766, -23.645216 | C: -46.532930, -23.698003 | 15,12 km
   ⇒ a ordem trocou e a rota foi recalculada
```

Capturas em `imagens/`:

| Arquivo | Conteúdo |
|---------|----------|
| `app-otimizada.png` | modo *Menor rota*: seletor de modo, sequência A → C → B → D, rota âmbar, dica de arraste |
| `app-usuario.png` | modo *Ordem do usuário*: a sequência informada é respeitada |
| `app-ordem-indicador.png` | arraste da ordem no painel: a linha alvo realçada com a tarja "SOLTAR AQUI" |
| `app-ordem-arrastada.png` | depois do arraste no painel: B e C trocaram de lugar e a rota foi recalculada (23,20 km → 15,12 km) |
| `app-arrastar.png` | ponto B arrastado **no mapa**: o painel mostra "Movido no mapa" e a rota foi recalculada |

---

## 10. Limitações conhecidas

1. **A otimização só existe se os pontos estiverem no mesmo componente
   conexo.** A rede tem 342 componentes; pontos em componentes diferentes não
   têm caminho entre si e a API diz exatamente isso (`PONTOS_SEM_CONEXAO`).
2. **Acima de 16 paradas intermediárias** a otimização é heurística e a
   interface diz isso (não se promete ótimo).
3. **O custo é a distância viária**, não o tempo: a camada não traz tempo de
   travessia, faixa de pedestre, condição de calçada nem inclinação. A
   otimização minimiza a **distância**, que é a única proxy disponível no
   WFS; um trajeto mais curto pode, em tese, exigir travessia mais difícil —
   isso não é mensurável com os dados atuais.
4. **O arrraste no mapa não cria ruas**: um ponto arrastado para fora da rede
   gera "sem caminho" ou "a N m da rede viária" — a aplicação **não** inventa
   conexões.
5. **No modo "Menor rota"**, arrastar no painel muda a *ordem informada*, mas a
   ordem percorrida é a otimizada (é o comportamento pedido). Para que a
   ordem arrastada seja respeitada, escolha **"Ordem do usuário"**.
6. A origem e o destino **não** mudam de lugar na otimização (é um trajeto com
   origem e destino dados); só a ordem das paradas intermediárias é otimizada.
