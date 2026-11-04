# Rodada 2 — Sempre a melhor rota + estilo claro com ruas em destaque

**Pedido (duas coisas):**

1. *"conforme a imagem, a menor rota não foi a escolhida, melhore o critério
   para sempre escolher a melhor rota"*;
2. *"clarear a base, usar alguma outra formatação para a camada das ruas para
   destacar as ruas"*.

**Situação:** concluída e verificada (a rodada 3 mantendo o resultado).

---

## 1. Parte 1 — o critério de "melhor rota"

### O que estava errado

O motor já usava A\* com peso = comprimento métrico real, mas **três defeitos
faziam a rota mais curta não ser escolhida**:

1. o A\* guardava **objetos de aresta** onde o montador de trajeto esperava
   **ids** → o caminho montado saía vazio ou distorcido;
2. as arestas de sobreposição entre eixos paralelos eram criadas **só em um
   sentido** (a "ida" existia, a "volta" não) → o grafo ficava enviesado;
3. as **conexões temporárias** (origem/destino fora da malha) eram somadas à
   distância sem clareza para o usuário.

### O que foi feito

| Correção | Arquivo | Efeito |
|---|---|---|
| A\* passa a storear **ids** de aresta | `core/router.js` | distância correta (antes retornava 0) |
| Arestas de sobreposição ganham a **aresta reversa** | `core/graph.js` | o grafo deixa de ser dirigido por acidente |
| Peso = comprimento métrico real do eixo; heurística = distância euclidiana em metros | `core/router.js` | heurística **admissível e consistente** ⇒ A\* é **ótimo** |
| Caminho de "fora da rede" sinalizado como `FORA_DA_REDE` | `core/router.js` | o usuário sabe que o trajeto começa a 18 m da rua |

Por que a heurística é ótima: com pesos = distância real e heurística =
distância euclidiana (que nunca supera a distância viária), o A\* de um modelo
consistente devolve **o mesmo resultado do Dijkstra**. Isso não é uma
heurística de "boa aproximação": é a prova de que a rota mais curta está
sempre escolhida.

### A prova

`node tools/validate-routes.js 2000` (2.000 pares aleatórios, cada par
calculado **duas vezes** — A\* e Dijkstra):

```
pares testados                 : 2000
com rota                       : 2000
A* x Dijkstra divergentes      : 0        ← nunca há divergência
problemas de continuidade       : 0
problemas de soma              : 0
razao rota/linha reta (mediana): 1.35x    ← o trajeto é viário, não uma reta
VALIDACAO APROVADA
```

Exemplo real (RUA BARBÁRA HELIODORA): **1.464,8 m, 7 trechos, sem retorno em
U**.

## 2. Parte 2 — estilo: base clara e ruas em destaque

### Antes

Base OSM com cores saturadas e a camada de eixos desenhada com a mesma
linguagem visual da base: as ruas **se perdiam** no desenho.

### Depois

| Camada | Antes | Depois |
|---|---|---|
| Base (OSM) | cores normais | filtro CSS `grayscale(0.82) brightness(1.19) contrast(0.8) saturate(0.45)`, opacidade `0.95` — **base clara e dessaturada** |
| Eixo oficial | traço único | **halo branco 3,6 px** por baixo + núcleo azul-cinza `#4d5f73` de 1,8 px |
| Eixo não oficializado | indistinto | laranja `#c2620d`, **tracejado**, no mesmo par halo+núcleo |
| Rota | traço único | halo branco 9 px + núcleo escuro 6,4 px + **âmbar `#ffc233`** 3,6 px por cima |
| Legenda | bloco único | separado em *Eixo viário oficial* / *Eixo não oficializado* / *Rota calculada* |

O desenho final fica em três camadas com `zIndex` explícito
(casing → eixo → rota), então a rota nunca é escondida pela malha.

**Arquivos:** `public/app.js` (nova `axisCasingSource` + função de estilo da
camada de eixos e da rota), `public/styles.css` (variáveis `--axis`,
`--axis-unofficial`, `--route`, classe `.basemap`), `public/index.html`
(legenda em duas entradas).

## 3. Arquivos tocados nesta rodada

| Arquivo | O que mudou |
|---|---|
| `core/router.js` | A\* com ids de aresta; arestas reversas; `FORA_DA_REDE` |
| `core/graph.js` | aresta reversa nas sobreposições |
| `public/app.js` | camada de eixos com halo + estilo por `COD_LOG`; rota em 3 estilos |
| `public/styles.css` | base clareada; variáveis de cor da cartografia |
| `public/index.html` | legenda reorganizada |
| `test/router.test.js` | casos de A\* × Dijkstra e de rota em “U” |

## 4. Como validar esta rodada

```bash
npm test                          # inclui A* × Dijkstra
node tools/validate-routes.js 2000
# e abrir a interface: a base deve estar clara e as ruas destacadas
npm start
```

## 5. Imagens

`imagens/` — evolução do estilo e da entrega:

| Arquivo | Conteúdo |
|---|---|
| `01-problema-rotas-nao-otimas.png` | a captura enviada pelo usuário (rota não ótima) |
| `estilo-v1.png`, `estilo-v2.png`, `estilo-v3.png` | as três iterações do balanceamento base/ruas |
| `entrega-v2.png` | a entrega final desta rodada |
| `rota-v2.png`, `rota-v3.png`, `rota-v4.png` | rotas calculadas com o novo estilo |
