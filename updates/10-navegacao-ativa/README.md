# Rodada 10 — Navegação ativa (GPS real + modo de teste)

## 1. O pedido

> Ativar a navegação sobre a rota já calculada: iniciar/encerrar a navegação,
> mostrar a posição atual, a próxima instrução, a próxima parada, a distância
> restante e o progresso do trajeto; tratar a permissão e os erros de
> geolocalização; seguir a posição no mapa com override manual; detectar a
> chegada nas paradas; detectar o desvio e **recalcular** mantendo a ordem das
> paradas restantes; e criar um **modo de teste (simulação)** com cenários
> (desvio, perda de sinal, recuperação, coordenadas manuais), velocidades e
> passo a passo — com um controlador único para as duas fontes, indicação
> visível de "modo de teste" e, principalmente, **limites declarados**.

Restrições herdadas: **não alterar o cálculo de rota existente**, não usar
API externa de roteamento, não inventar recursos (voz, trânsito, manobra
real) e não misturar coordenadas simuladas com o GPS real.

---

## 2. O que foi inspecionado antes de codificar

 conforme pedido, a estrutura existente foi lida **antes** de qualquer
alteração:

| Arquivo | O que foi aproveitado |
|---|---|
| `core/geo.js` | `project`/`unproject` (UTM 23S), `dist`, `cross`, `projectPointOnSegment`, `distancePointToSegment`, `polylineLength`, `formatDistance` |
| `core/router.js` | `routeOnGraph` (A\*), `findNearestEdge`, `isValidLonLat`, `validatePathContinuity` — **o cálculo de rota não foi tocado** |
| `server/index.js` | rotas `/api/*` (POST `/api/rota-paradas` aceita `modo` e `circular`) e `/core/*.js` servidos como ESM |
| `public/index.html` | `#result-block`, `#legs`, `#streets`, `#status` |
| `public/app.js` | IIFE com `window.__app = { map, state, axisSource, axisCasingSource, routeSource, markerSource }`, desenho por trecho com cor própria, legenda dinâmica, `state.trechos` (visibilidade) |

**Decisão de arquitetura:** a navegação **não** mexe no backend. Ela consome
a resposta que o backend já devolve (`POST /api/rota-paradas`) e, quando
precisa recalcular, **chama a mesma API** — com `modo: 'usuario'`, para que a
ordem das paradas restantes seja preservada.

### Plano apresentado antes de codificar

| Arquivo | Responsabilidade |
|---|---|
| `core/navegacao.js` | controlador: plano, projeção, progresso, chegada, desvio, replanejamento |
| `core/fonteGPS.js` | fonte de posição **real** (Geolocation API): permissão, erros, contexto seguro |
| `core/simulador.js` | fonte de posição **simulada**: tempo real, interpolação sobre a geometria, cenários |
| `core/instrucoes.js` | instrução do momento, deduzida da geometria e do logradouro percorrido |
| `public/navegacaoUI.js` | interface: painel, marcador, acompanhamento do mapa, recálculo |
| `test/navegacao.test.js` | testes unitários do controlador, das fontes e das instruções |

---

## 3. O que foi entregue

### 3.1 Um controlador único para as duas fontes

`core/navegacao.js` não sabe de onde vêm as posições. Ele recebe
`{latitude, longitude, precisao, rumo, velocidade, timestamp}` e responde:

* em que **trecho** (A → B, B → C…) o usuário está;
* qual é a **próxima parada** e quanto falta (medido **sobre a geometria**);
* quanto **progresso** já foi feito — também sobre a geometria;
* quando chegou a uma parada;
* quando saiu da rota.

As duas fontes (GPS real e simulador) implementam a **mesma interface**
(`iniciar()`, `parar()`, entrega de posições), de modo que o cálculo de
progresso, a detecção de chegada e a lógica de desvio são **exatamente os
mesmos** nos dois modos.

### 3.2 Progresso e chegada medidos sobre a geometria viária

A posição do usuário é projetada sobre a **polilinha da rota** (em coordenadas
métricas), e o progresso é a distância acumulada até essa projeção:

```
progresso = (metros já percorridos + distância na polilinha) / total da rota
```

Não existe linha reta em lugar nenhum: a distância até a próxima parada é
`distânciaNaRota(parada) − percorrido`, e a chegada é reconhecida quando o
**percurso** chega ao fim da perna correspondente.

Isso resolve um caso real: o ponto informado pelo usuário pode estar a
dezenas de metros da rede viária (o "acesso à rede", 8–27 m nos exemplos
validados). A chegada é reconhecida quando o percurso *chega ao fim da
perna*, e não quando a distância em linha reta até o clique fica pequena.

### 3.3 Chegada com precisão e estabilidade

| Regra | Valor | Porquê |
|---|---|---|
| raio da parada | **25 m** | tolerância de rua |
| precisão máxima aceita | **20 m** | GPS ruim não pode declarar chegada |
| leituras consecutivas | **3** | uma leitura isolada não conclui nada |

Uma leitura com precisão de 120 m **não** declara a parada concluída (teste
automatizado).

### 3.4 Desvio com tolerância, persistência e recálculo

| Regra | Valor |
|---|---|
| tolerância base | **35 m** da rota |
| tolerância final | `max(35 m, precisão do GPS × 2)` |
| leituras consecutivas fora da rota | **3** |

O recálculo usa a **mesma API** do planejamento:

```json
POST /api/rota-paradas
{ "pontos": [ {posição atual}, ...paradas restantes], "modo": "usuario" }
```

* a **ordem das paradas restantes é preservada** (modo `usuario`);
* o novo trajeto é desenhado no mapa e o painel é atualizado;
* **se o cálculo falhar, o erro aparece e nada é desenhado** — nunca uma
  linha reta.

### 3.5 GPS real (`core/fonteGPS.js`)

* `watchPosition` com `enableHighAccuracy: true`, `timeout: 15 s`,
  `maximumAge: 2 s`;
* a localização só é pedida **depois do clique** em "Começar trajeto";
* erros traduzidos: **permissão negada**, **sinal indisponível**, **tempo
  esgotado**;
* fora de **contexto seguro** (sem HTTPS/localhost) o erro é informado
  **antes** de qualquer chamada à API;
* o watcher é **sempre liberado** ao encerrar a navegação.

### 3.6 Modo de teste — simulador (`core/simulador.js`)

* deslocamento calculado pelo **tempo real decorrido** (`dt`), e não pelo
  número de atualizações: 1 s de simulação vale o mesmo com 1 ou 10 tiques
  (teste automatizado com relógio falso);
* posição **interpolada sobre a geometria da rota** (entre dois vértices, em
  coordenadas métricas) — o simulador não inventa caminho;
* velocidades **1× / 2× / 5× / 10× / 25× / 50×**;
* controles: iniciar, pausar, reiniciar, **◀ 100 m**, **100 m ▶**, ponto de
  início (por trecho);
* cenários: **desvio**, **perda de sinal**, **recuperação do sinal**,
  **coordenadas manuais**, **GPS impreciso**;
* a posição simulada é marcada (`simulado: true`) e desenhada em **roxo** (o
  GPS real, em azul) — as duas fontes nunca se misturam.

### 3.7 Interface (`public/navegacaoUI.js` + HTML/CSS)

Painel sobre o mapa com: posição atual, precisão, próxima parada, trecho em
curso, **instrução do momento**, distância restante e **barra de progresso**;
botões de **pausar/continuar**, **centralizar** e **encerrar**; marcador da
posição (com cone de rumo); acompanhamento automático do mapa, que o usuário
pode assumir a qualquer momento arrastando o mapa (o botão "Centralizar"
devolve o acompanhamento).

A faixa **"MODO DE TESTE — a posição exibida é SIMULADA"** fica visível
enquanto a posição for fictícia, e o selo do painel diz **MODO DE TESTE** ou
**GPS REAL**.

### 3.8 Instruções honestas

`core/instrucoes.js` só diz o que os dados permitem:

* a **rua** é o logradouro que a rota **realmente** percorre (vem da
  resposta da API);
* a **manobra** é deduzida do **ângulo da própria geometria** no vértice
  (acima de 25°) — é uma leitura do trajeto, não uma suposição;
* a **distância** vem da geometria métrica;
* **não existe** voz, trânsito em tempo real, nomes de esquina, sinalização
  nem navegação "curva a curva" com faixas deConversionão.

---

## 4. Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `core/navegacao.js` | **novo** — controlador de navegação (plano, projeção, progresso, chegada, desvio, replanejamento) |
| `core/fonteGPS.js` | **novo** — fonte GPS real (permissão, erros, contexto seguro) |
| `core/simulador.js` | **novo** — fonte simulada (tempo real, interpolação, cenários) |
| `core/instrucoes.js` | **novo** — instrução do momento (rua + manobra deduzidas) |
| `public/navegacaoUI.js` | **novo** — painel, marcador, acompanhamento, recálculo, controles do simulador |
| `public/index.html` | seletor da fonte da posição, botão "Começar trajeto", painel de navegação, faixa e painel de simulação |
| `public/app.js` | `state.rotaAtual`, ganchos (`showRoute`, `desenharRota`, `atualizarLegenda`, `definirEstadoTrechos`), destaque do trecho atual/percorrido, aviso quando a rota muda durante a navegação |
| `public/styles.css` | estilos do painel de navegação, do simulador, da faixa de modo de teste e do botão "Começar trajeto" |
| `test/navegacao.test.js` | **novo** — 19 testes do controlador, das fontes e das instruções |
| `tools/validar-navegacao.mjs` | **novo** — validação visual no navegador (Playwright) |

O cálculo de rota (`core/router.js`, `core/rotaParadas.js`, `core/ordemParadas.js`,
`core/graph.js`, `core/wfs.js`, `server/`) **não foi alterado**.

---

## 5. Testes executados

### 5.1 Suíte unitária

```bash
npm test
```

**142/142** verdes (123 da rodada 9 + **19** novos em `test/navegacao.test.js`):

| # | Teste | O que garante |
|---|---|---|
| 1 | plano montado a partir da resposta da API | pernas, paradas, total |
| 2 | progresso **sobre a geometria** | 150 m de 1.400 m ⇒ 10,7 % (não a distância em linha reta) |
| 3 | trecho atual e próxima parada | B → C ⇒ trecho B → C, próxima parada B |
| 4 | chegada exige leituras estáveis | 1ª e 2ª leituras não confirmam; a 3ª confirma |
| 4b | leitura imprecisa não conclui | precisão 120 m ⇒ nenhuma chegada |
| 4c | circuito termina na origem | A → B → C → D → A ⇒ navegação encerrada |
| 4d | rota que fecha no mesmo ponto | a projeção segue o progresso (não volta ao início) |
| 5 | desvio exige persistência | 3 leituras fora da rota ⇒ desvio confirmado |
| 5b | precisão amplia a tolerância | precisão 100 m ⇒ 80 m fora **não** é desvio |
| 6 | recálculo mantém a ordem | B (alcançada) some; C, D, A continuam em ordem |
| 7 | simulador × tempo decorrido | 1 s vale o mesmo com 1 ou 10 atualizações |
| 7b | simulador interpola sobre a geometria | posição no meio da perna ⇒ projeção em 150 m |
| 7c | pausar/reiniciar/avançar/retroceder | controles do simulador |
| 7d | cenários | desvio, perda de sinal (nada é emitido), recuperação, posição manual |
| 7e | multiplicador de velocidade | 25× e 10× são realmente aplicados |
| 7f | desvio realmente afasta da rota | > 100 m da rota |
| 8 | erros da Geolocation API | permissão negada / sinal indisponível / timeout traduzidos; watcher liberado |
| 8b | contexto inseguro | a API **não** é chamada; o erro é informado antes |
| 9 | instrução | usa o logradouro percorrido e o ângulo da geometria |

### 5.2 Validação visual (aplicação real, Chromium headless)

```bash
npm start            # em outro terminal
npm run validar:navegacao
```

**VALIDAÇÃO VISUAL APROVADA** — 15/15 conferências:

| Conferência | Resultado |
|---|---|
| botão "Começar trajeto" aparece depois da rota | OK |
| painel de navegação abre | OK |
| faixa "MODO DE TESTE" visível na simulação | OK |
| selo "MODO DE TESTE" no painel | OK |
| progresso avança sobre a geometria | OK |
| instrução preenchida | OK |
| posição preenchida | OK |
| painel do simulador visível | OK |
| trajeto concluído (a volta à origem encerra a navegação) | OK |
| desvio detectado (persistência + tolerância) | OK |
| trajeto recalculado pela API | OK |
| nenhuma linha reta: os trechos continuam desenhados | OK |
| GPS real: painel abre | OK |
| GPS real: sem faixa de modo de teste | OK |
| GPS real: erro de permissão tratado | OK |

O trajeto usado na validação é real (Santo André, centro): **1,73 km**
(402 m + 608 m + 719 m). Capturas em `imagens/`:

| Arquivo | O que mostra |
|---|---|
| `app-navegacao-simulacao.png` | navegação em modo de teste: instrução real ("Vire à esquerda em 55 m — RUA PREFEITO JUSTINO PAIXÃO"), progresso, marcador com cone de rumo, faixa de modo de teste |
| `app-navegacao-concluida.png` | trajeto concluído (a volta à origem encerra a navegação) |
| `app-navegacao-desvio.png` | desvio detectado e trajeto **recalculado** a partir da posição atual (A → B passa a 775 m, a partir de onde o usuário estava), com a ordem das paradas intacta |
| `app-navegacao-gps.png` | modo GPS real: permissão negada tratada com mensagem clara, sem faixa de modo de teste |

---

## 6. Limitações (o que a navegação **não** faz)

1. **Não há voz** nem áudio de manobra. A instrução é texto.
2. **Não há trânsito em tempo real**, nem tempo estimado de chegada, nem
  sem considerar "faixas de conversão" — a camada WFS não traz esses dados.
3. **Não é um turn-by-turn de verdade**: a manobra é deduzida do ângulo do
   traçado; não há cruzamentos nomeados, semáforos, sinalização ou
   "continue por 300 m na Rua X".
4. **A precisão do GPS manda**: com precisão ruim (o navegador nem sempre
   reporta), a tolerância de chegada e de desvio se amplia e a navegação
   fica lenta ou conservative — é o comportamento correto, não um defeito.
5. **A camada não tem dados de nível nem de calçada**: a rota é sobre o eixo
   viário, e não sobre o passeio.
6. **O recálculo pode não ser possível**: se a posição atual cair num
   componente desconectado da rede (a rede tem 342 componentes), a API
   responde com erro — e a interface **mostra o erro**, sem desenhar linha
   reta.
7. **O simulador é um teste, não um GPS**: a posição é interpolada sobre a
   geometria e não tem ruído, o que o torna **mais estável** que um GPS
   real. Por isso os cenários do simulador não substituem um teste de
   campo.
8. A geolocalização exige **HTTPS ou localhost**; publicada em HTTP simples,
   o navegador bloqueia a API e a interface avisa isso.

---

## 7. Como usar

1. Calcule a rota como sempre (A → B → C…);
2. Escolha a **fonte da posição**: **GPS real** ou **Simulação**;
3. Clique em **▶ Começar trajeto**;
4. No modo de teste, use o painel **Simulador**: velocidade, passo a passo
   (◀ 100 m / 100 m ▶), ponto de início e cenários;
5. **Pausar** congela a navegação (e o simulador); **Encerrar** libera o GPS
   e fecha o painel.

Se a rota for recalculada enquanto a navegação está ativa, a navegação é
encerrada com aviso — o trajeto planejado mudou e a navegação antiga não
valeria mais.

---

## 8. Pacote da rodada

`pacote/` traz cópia dos arquivos tocados nesta rodada (para guardar o
estado da entrega):

```
pacote/
├── core/
│   ├── navegacao.js
│   ├── fonteGPS.js
│   ├── simulador.js
│   └── instrucoes.js
├── public/
│   ├── navegacaoUI.js
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── test/
│   └── navegacao.test.js
├── tools/
│   └── validar-navegacao.mjs
├── package.json
└── README.md
```
