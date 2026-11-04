# Rodada 1 — Conectores de junção e rotas que não se perdem

**Pedido:** refinar o cálculo das rotas para que o caminho mais curto seja
sempre encontrado e para que as ruas que se cruzam de verdade estén conectadas
no grafo.

**Situação:** concluída e verificada (a rodada 2 e a 3 construíram em cima
desta).

---

## 1. O problema

A primeira versão do motor produzia rotas ruins por três motivos
independentes, todos medidos:

| Sintoma | Causa raiz | Números |
|---|---|---|
| Rotas absurdamente longas / sem saída | o grafo fragmentava: ruas que se cruzavam não eram conectadas | 338 componentes conexas |
| "A menor rota não foi a escolhida" | pesos e heurística do A\* incorretos + arestas de sobreposição **direcionadas** | sobreposição sem aresta de volta |
| Descontinuidade de 5,94 m no trajeto | o conector era criado com `t = 0` (posição errada) e descartado como duplicado | 1 aresta com desvio > 0,5 m |

Além disso, o emparelhamento de segmentos gerava **42.545 sobreposições
fantasma**, porque cada segmento era comparado com ele mesmo.

## 2. As decisões

### 2.1 Tolerância de junção de 1 m, com *conector* (não com snapping)

Sub-tolerâncias que movem a geometria destroem a precisão do dado. A solução
adotada não move nada: quando dois eixos terminam a menos de 1 m um do outro,
cria-se uma **aresta de conector** entre os dois nós, com o comprimento real
da lacuna.

```
  Rua A ══════●                    ●══════ Rua B
               └───── conector ─────┘     (1,0 m, comprimento real)
```

* `snapTolerance = 0,05 m` — o único valor que **move** geometria (ajuste de
  vértice), e só quando o erro é sub-centimétrico.
* `junctionTolerance = 1,0 m` — cria conector, **preserva a geometria
  original**.

A faixa de 5 cm a 1 m contém exatamente **103** extremidades. A partir de 2 m
aparecem separações genuínas (não são Errors de digitação), por isso o limite
de 1 m.

### 2.2 Chave canônica de par de segmentos

A chave de identificação de um par passa a ser **independente da ordem**
(`min/max` dos ids), eliminando as 42.545 comparações fantasma.

### 2.3 A aresta de conector nasce com o `t` verdadeiro

O bug de 5,94 m vinha dos eventos de contato não carregarem `segB/tB`: o corte
na rua B era criado em `t = 0` (na origem do eixo), descartado como duplicado
e o conector nascia 6 m longe do contato real. Passando a carregar `segB`/`tB`
e desenhando o conector a partir das coordenadas **autoritativas** dos cortes
(`cutA`, `cutB`), a descontinuidade sumiu.

## 3. Resultado medido

| Métrica | Antes | Depois |
|---|---|---|
| Nós | 10.413 | **10.491** |
| Arestas | 13.993 | **14.163** |
| Componentes conexas | 338 | **317** (maior: 8.712) |
| Conectores criados | 0 | **103** |
| Junções perdidas | — | **0** |
| Duplicidades removidas | 426 | **443** |

**Teste A/B com 1.500 pares aleatórios:**

| Efeito | Resultado |
|---|---|
| Rotas que antes eram impossíveis | **81 passaram a existir** |
| Rotas encurtadas | **683** (total **169,69 km**, maior ganho 1.204 m) |
| Rotas alongadas | **0** |
| Componentes | 426 → 317 |
| Maior componente | 8.367 → 8.712 nós |

**Validação cruzada** (`npm run validate`): 2.000/2.000 rotas, **0 divergências
entre A\* e Dijkstra**, 0 problemas de continuidade/soma/geometria, razão
rota/linha-reta mediana 1,33× e máxima 9,48×.

## 4. Arquivos tocados nesta rodada

| Arquivo | O que mudou |
|---|---|
| `core/graph.js` | modelo de conector (`connector:true`, `partId:-1`), chave canônica de par, intervalo de sobreposição sem recorte, fusão de duplicidades, evento de contato com `segB/tB` |
| `core/router.js` | A\* sobre o grafo real (armazena **ids** de aresta, não objetos), arestas de sobreposição nos dois sentidos, montagem do trajeto |
| `core/geo.js` | correção da projeção inversa (unidades: radianos × graus) — ida e volta com erro < 0,1 mm |
| `core/spatialIndex.js` | índice de grade uniforme para segmentos (sem isso o emparelhamento seria quadrático) |
| `core/config.js` | `snapTolerance = 0,05`, `junctionTolerance = 1,0` |
| `test/graph.test.js` | 2 testes de regressão do conector + helpers `mLon/mLat` |

## 5. Como validar esta rodada

```bash
npm test                                  # suíte completa
node tools/report-network.js              # nós, arestas, componentes, conectores
node tools/validate-routes.js 2000        # validação cruzada A* × Dijkstra
node tools/diagnose-connections.js        # distribuição das lacunas de junção
```

## 6. Imagens

`imagens/` — capturas da entrega desta rodada:
`entrega-final.png`, `rota-area.png`, `rota-santo-andre.png`, `final-rota.png`.
