# Rodada 9 — Trechos selecionáveis (ocultar as sobreposições)

> Pedido (na íntegra, do usuário, com a imagem de referência): *"algumas
> partes da rota que usam o mesmo caminho ficaram sobrepostas, conforme a
> imagem. Segundo a legenda, dá para perceber que a rota está ali, porém,
> existe essa sobreposição. Acho que seria bom talvez colocar a opção para o
> usuário escolher (talvez pela legenda, ou se tiver alguma sugestão melhor) as
> rotas que estarão visíveis clicando nelas"*.

---

## 1. O que foi entregue

| # | Entrega | Onde |
|---|---------|-------|
| 1 | **Clicar em um trecho o oculta** (e clicar de novo o mostra) — no **mapa**, na **legenda** e no **painel** | `public/app.js` |
| 2 | A **legenda** virou interativa: cada linha é um botão, com estado visível/oculto (swatch vazado e rótulo riscado) | `public/index.html`, `public/app.js`, `public/styles.css` |
| 3 | Contador **"3/4 visíveis"** na legenda + botão **"Mostrar todos"** | `public/index.html`, `public/app.js` |
| 4 | O **painel** (lista de trechos) também permite ocultar, pelo mouse ou pelo teclado | `public/app.js`, `public/styles.css` |
| 5 | Cursor de "clique" quando o ponteiro está sobre um trecho | `public/app.js` |
| 6 | Validação visual do comportamento | `tools/validar-trechos-coloridos.mjs` (etapas 6 e 7) |

**Nada muda no cálculo**: ocultar um trecho é **puramente visual** — a rota,
a distância, a ordem das paradas e a estatística do painel continuam exatamente
as mesmas (o status da interface diz isso explicitamente).

A suíte completa continua em **123/123** — a mudança é de interface, não de
motor.

---

## 2. O problema observado

Numa rota circular, o trecho de **retorno à origem** costuma refazer parte do
caminho de ida (a rua é a mesma nos dois sentidos). Com um traço por trecho,
o de cima **cobre** o de baixo: vê-se a linha colorida por cima e a de baixo
desaparece — a legenda continua dizendo que os dois trechos existem, mas o
mapa não deixa ler o de baixo.

Isso **não é um erro de cálculo**: as duas geometrias são as verdadeiras, o
motor de roteamento é o mesmo e a sobreposição é um fato do trajeto (a rua é
compartilhada). Não se "desenha" uma linha reta ou se inventa um desvio para
evitar isso — isso falsearia a rota. A resposta é deixar o **usuário
escolher** o que quer ver.

---

## 3. A solução

### 3.1 Três lugares para ocultar um trecho

| Onde | Como |
|---|---|
| **Mapa** | clique em cima do trecho (o cursor vira "mão" quando o ponteiro está sobre ele) |
| **Legenda** | clique na linha do trecho (ela é um botão de verdade: funciona com Enter/espaço) |
| **Painel** | clique na linha do trecho da lista "Trechos" (também focável pelo teclado) |

Clicar de novo no mesmo trecho o **mostra** de novo. O botão **"Mostrar
todos"** (aparece só quando há trechos ocultos) restaura tudo de uma vez.

### 3.2 O que o usuário vê

* o trecho ocultado **deixa de ser desenhado** (a feature recebe
  `visivel = 0` e o estilo devolve `null`);
* na **legenda**, a linha fica esmaecida, com o swatch **vazado** e o rótulo
  **riscado** — e o título passa a mostrar quantos trechos estão visíveis
  ("3/4 visíveis");
* no **painel**, a linha do trecho fica esmaecida e riscada;
* o **status** informa a ação: *"Trecho ocultado: D → A. A rota e a distância
  não mudaram."*

### 3.3 O que **não** muda

* a **distância** total e por trecho;
* a **geometria** gravada e os vértices originais dos eixos;
* a **ordem** das paradas e o resultado da otimização;
* o **enquadramento** do mapa (a rota não "pula" quando um trecho some).

---

## 4. Validação visual (`npm run validar:trechos`)

```
6) oculta um trecho pela legenda (resolve as sobreposições)
   trechos desenhados (visíveis): 3 de 4
   legenda: A → B [oculto] | B → C | C → D | D → A retorno
   distância inalterada: 30,89 (antes: 30,89)
   botão "mostrar todos" visível: true
   após clicar de novo → visíveis: 4
   após "mostrar todos" → visíveis: 4 de 4
7) clica no MAPA, sobre um trecho (o retorno à origem)
   visíveis antes do clique no mapa: 4
   visíveis depois: 3 de 4
   status: Trecho ocultado: D → A. A rota e a distância não mudaram.

clicar oculta o trecho (sem mudar a rota):     SIM
clicar de novo mostra o trecho:                SIM
"mostrar todos" restaura a visualização:       SIM
clicar no mapa oculta o trecho:                SIM

VALIDAÇÃO VISUAL APROVADA
```

Capturas: `updates/08-trechos-coloridos/imagens/app-trecho-oculto.png` (oculto
pela legenda) e `app-trecho-oculto-no-mapa.png` (oculto pelo clique no mapa).

> Nota técnica: o pixel do OpenLayers é relativo ao *viewport* do mapa; para
> virar coordenada de mouse é preciso somar a posição do mapa na página — o
> mesmo cuidado que o arraste dos marcadores exigiu na rodada 6.

---

## 5. Arquivos alterados

| Arquivo | O que mudou |
|---------|-------------|
| `public/app.js` | `state.trechos`; `alternarVisibilidadeTrecho()`; `atualizarEstadoTrechos()`; `mostrarTodosTrechos()`; feature com `legIndex`/`visivel`; estilo da rota devolve `null` para trecho oculto; clique no mapa; clique/teclado na legenda e no painel; cursor de ponteiro |
| `public/index.html` | contador de trechos visíveis, botão "Mostrar todos", dica na legenda |
| `public/styles.css` | `.legend__leg` (botão), estado `.is-oculto`, `.legend__restaurar`, `.legend__dica`, `.leg--oculto` |
| `tools/validar-trechos-coloridos.mjs` | etapas 6 e 7 (ocultar pela legenda, pelo mapa e restaurar) |

---

## 6. Limitações conhecidas

1. **Quando dois trechos passam pelo mesmo caminho, o de cima continua
   "ganhando"** — o clique acerta o trecho que está por cima. Para ver o de
   baixo, o usuário oculta o de cima (e vice-versa).
2. **A ocultação vale até o próximo recálculo**: recalcular a rota (ou
   reordenar os cards) redesenha tudo e **todos os trechos voltam a ficar
   visíveis** — as correspondências do novo trajeto são outras.
3. **O clique no mapa só funciona sobre o traço** (tolerância de 5 px): fora
   dele, o clique não faz nada.
4. Ocultar um trecho **não altera** o cálculo — é uma ferramenta de leitura,
   não de rota.
