# Rodada 5 — Endereço Digital (CEP Digital) e rota com múltiplas paradas

**Pedido:** permitir informar origem, destino e paradas intermediárias pelo
**Endereço Digital de Santo André** (Plus Code / CEP Digital), adicionar
vários pontos identificados como A, B, C, D… e calcular a rota **na ordem
definida pelo usuário**, mantendo o roteamento sobre os eixos viários reais e
preparando a integração futura com o SIGA corporativo.

**Resposta da rodada:** o Endereço Digital é resolvido pela **porta fiel** da
classe C# fornecida; a rota multi-ponto é calculada pela rede do GeoServer,
trecho a trecho, na ordem do usuário.

---

## 1. Diagnóstico da classe fornecida (`CalculoGeometriaDAL.cs`)

| Item | Constatação |
|---|---|
| **Classe** | `CalculoGeometriaDAL` |
| **Linguagem** | C# (.NET) — `namespace PortalSiga.OracleDAL.AreaRestrita` |
| **Dependências** | `Oracle.ManagedDataAccess.Client`, helper `OracleDataAccess`, pacotes `GEOSIGA.PKG_*` |
| **Natureza** | DAL do Portal SIGA: metade é **autocontida** (CEP Digital / Plus Code), metade **depende de Oracle** |

### 1.1 Métodos públicos

| Assinatura (C#) | Depende de Oracle | O que faz |
|---|---|---|
| `static bool CoordenadaNaRegiao(string latitude, string longitude)` | não | Diz se as coordenadas caem no recorte do município (lat −24,1…−23,3; lon −46,9…−46,2) |
| `static object NormalizarCoordenadaParaBanco(string valor)` | não | Normaliza coordenada para o banco ("23.5" → "23,5"); `DBNull.Value` quando vazia/não numérica |
| `static object NormalizarCepDigitalParaBanco(string valor)` | não | Padroniza o CEP Digital (trim + maiúsculas) para gravação |
| `static OracleParameter CriarParametroCepDigital(string valor)` | **sim** | Monta o parâmetro `P_DSC_CEP_DIGITAL` (VARCHAR2(20)) |
| `static string ObterCepDigital(string pCodigo)` | **sim** | Lê `DSC_CEP_DIGITAL` gravado (cursor de `PKG_ASO_BANCO_ALIMENTOS.SP_SELECT`) |
| `static string CodificarCurto(string latitude, string longitude)` | não | **Coordenadas → CEP Digital curto** |
| `static string CodificarCompleto(string latitude, string longitude)` | não | **Coordenadas → CEP Digital completo** (11 caracteres) |
| `static string Completar(string codigoCurtoOuCompleto)` | não | **CEP Digital (curto ou completo) → CEP Digital completo validado**; `""` quando inválido ou fora da região |
| `string ObterEnderecoProximoTexto(string pLatitude, string pLongitude)` | **sim** | Endereço mais próximo (texto) via `PKG_GEOCODIFICACAO_REVERSA.FN_ENDERECO_PROXIMO` |
| `DataTable ObterEnderecoPorPonto(string pLatitude, string pLongitude)` | **sim** | Detalhes do endereço mais próximo (`SP_ENDERECO_PROXIMO_DETALHE`) |
| `DataTable RetornaSetorFiscal(string latitude, string longitude)` | **sim** | Setor fiscal (`PKG_CALCULO_GEOMETRIA.SP_RETORN_SETOR_FISCAL`) |
| `EnderecoProximoResult ObterEnderecoProximo(string pLatitude, string pLongitude)` | **sim** | Objeto com nome do logradouro, número aproximado, bairro, distância, código do logradouro e bairro, endereço formatado |

### 1.2 Constantes do CEP Digital (o "município" da classe)

```csharp
private const string AlfabetoCepDigital = "23456789CFGHJMPQRVWX";   // alfabeto OLC
private const double LatitudeReferenciaCepDigital  = -23.6635;       // centro de Santo André
private const double LongitudeReferenciaCepDigital = -46.5320;
private static readonly double[] ResolucaoCepDigital = { 20d, 1d, 0.05d, 0.0025d, 0.000125d };
```

### 1.3 Como o Plus Code é normalizado, encurtado, expandido e convertido

* **Normalizar** — `Completar()`: `Trim()` → `ToUpperInvariant()` → remove
  espaços. O `'+'` tem de estar em posição **par**, entre 2 e 8; todos os
  caracteres precisam estar no alfabeto OLC.
* **Encurtar** — `CodificarCurto()`: gera o código completo e **remove os 4
  primeiros caracteres** quando o ponto está a menos de
  `Resolução[1] × 0,3` (= 0,3°, ~33 km) da referência do município — ou seja,
  **praticamente sempre** em Santo André. O `'+'` do código curto fica na
  posição 4 (par) ✓.
* **Expandir** — `Completar()`: para um código curto, recompõe o prefixo a
  partir do ponto de referência do município (`prefixoAusente = 8 − posição do
  '+'`), decodifica o centro, **ajusta o centro na direção da referência** uma
  resolução (conforme o número de dígitos dados) e devolve o código completo
  canônico.
* **Converter em coordenadas** — **não existe método público na classe**: a
  conversão é feita internamente por `DecodificarCentro(digitos)` (privado),
  que decodifica os 10 dígitos e devolve o **centro da célula**. O protótipo
  expõe exatamente essa etapa (`DecodificarCepDigital`).

### 1.4 Formatos de entrada e saída

| Operação | Entrada | Saída |
|---|---|---|
| `CodificarCompleto/Curto` | `"−23.6635"` / `"−23,6635"` (string) | `"588M8FP9+J6"` (11 chars) ou `""` |
| `Completar` | `"8FP9+J6"` ou `"588M8FP9+J6"` | `"588M8FP9+J6"` ou `""` |
| `CoordenadaNaRegiao` | duas strings numéricas | `bool` |
| `Normalizar*ParaBanco` | string | string normalizada ou `DBNull.Value` |

### 1.5 Tratamento de erro (observado na implementação)

* entrada vazia/nula → `""` (ou `DBNull.Value`);
* coordenada não numérica ou terminada em `.` → `false` / `DBNull.Value`;
* código malformado → `""` **sem exceção**;
* código válido **fora do recorte** → `""` (a distinção entre "malformado" e
  "fora da área" não existia na classe; foi reconstruída na porta, aplicando
  as **mesmas** regras estruturais antes do teste de região);
* falha de Oracle → `catch` → `""` / `DataTable` vazio / `null`.

### 1.6 Peculiaridades mantidas na porta (fidelidade)

1. **Preenchimento com `'0'`**: um código completo com menos de 10 dígitos é
   completado com `'0'`, que **não pertence ao alfabeto OLC**. Na classe,
   `ValorCaracterCepDigital('0')` vale **−1**, e o centro sai deslocado uma
   resolução. A porta reproduz isso exatamente (e o teste `4b` documenta).
2. **Ajuste pela referência**: na expansão de códigos curtos, o deslocamento
   usa `floor(prefixoAusente / 2) − 1` como índice de resolução.
3. **Região assimétrica**: o recorte (−24,1…−23,3 / −46,9…−46,2) é maior que
   o município — é o recorte herdado do `BancoAlimentosDALAS`.

---

## 2. Decisão de arquitetura: porta local + interface de serviço

O navegador não pode executar C# nem Oracle, e **credenciais do SIGA não
podem ir para o front-end**. A solução:

```
core/enderecoDigital.js          PORTA fiel da parte de CEP Digital (sem Oracle)
core/enderecoDigitalService.js   INTERFACE de serviço: local | siga
core/pontoTrajeto.js             lista de pontos (rótulos A/B/C/D, ordem)
core/rotaParadas.js              orquestração dos trechos (reusa routeOnGraph)
```

* **modo `local`** (padrão do protótipo): usa a porta fiel — resultado
  **verificado** contra a classe.
* **modo `siga`**: adaptador para o serviço corporativo. No protótipo **não há**
  servidor Oracle, credenciais nem rede até o banco do SIGA → o adaptador
  responde `INDISPONIVEL` com a explicação do que falta. **Nunca inventa
  coordenadas.** Para a integração futura basta injetar um `conector` com a
  forma do Oracle (`{latitude, longitude}` → resultado), executado **no
  servidor**.

---

## 3. O que foi implementado

### 3.1 `core/enderecoDigital.js` (novo)

Porta literal da parte de CEP Digital da classe, com os **mesmos nomes
públicos**: `CoordenadaNaRegiao`, `NormalizarCoordenadaParaBanco`,
`NormalizarCepDigitalParaBanco`, `CodificarCompleto`, `CodificarCurto`,
`Completar`, `DecodificarCentro`. Acrescenta (marcadas como tal):
`NormalizarCepDigital`, `ValidarSintaxeCepDigital`, `DecodificarCepDigital`,
`ResolverEnderecoDigital`.

**Estados devolvidos** (distinguíveis na interface):

| Estado | Significado |
|---|---|
| `VAZIO` | nada foi digitado |
| `MALFORMADO` | a forma do código não é válida |
| `VALIDADO` | código válido, **ainda não convertido** em coordenadas |
| `CONVERTIDO` | coordenadas obtidas |
| `FORA_DA_AREA` | código válido, mas fora do recorte do município |
| `INDISPONIVEL` | serviço corporativo indisponível |
| `FALHA` | erro na resolução |

### 3.2 `core/enderecoDigitalService.js` (novo)

Interface de serviço com `validar(codigo)` e `resolver(codigo)`, em duas
implementações (`local`, `siga`). É o **único** ponto a trocar quando o SIGA
corporativo estiver disponível.

### 3.3 `core/pontoTrajeto.js` (novo)

Lista de pontos do trajeto, isomórfica e sem DOM: `criarListaPontos`,
`adicionarPonto`, `removerPonto`, `atualizarPonto`, `moverPonto`,
`rotularPontos`, `podeCalcular`, `contarParadas`, `sequenciaRotulos`.

O **rótulo e o tipo derivam da posição**: índice 0 → A (origem), índices
intermediários → B, C, … (paradas), último → destino. Por isso remover ou
reordenar pontos **rotula tudo de novo** automaticamente.

### 3.4 `core/rotaParadas.js` (novo)

Calcula um trecho por par consecutivo chamando `routeOnGraph` (o motor já
existente — **nada foi reimplementado**) e concatena as geometrias na ordem
do usuário. Devolve, por trecho: distância, eixos percorridos, avisos,
distância de acesso à rede; e no conjunto: distância total, paradas,
sequência, Warnings.

Quando um trecho não tem caminho: `ok: false`,
`reason: 'TRECHO_SEM_CAMINHO'` e `falha: {de, para, reason, message}` — **sem
desenhar nenhuma linha reta** para tapar a falha.

### 3.5 `server/index.js`

* `GET|POST /api/endereco-digital?codigo=…` — resolve o Endereço Digital
  (devolve status, código normalizado, código completo, lat/lon, `naRegiao`).
* `GET|POST /api/rota-paradas` — rota com múltiplos pontos (`{pontos:[…]}`).
* `GET /core/*.js` — o servidor passa a servir os módulos de `core/`, para que
  o navegador importe `core/pontoTrajeto.js` (isomórfico) em vez de duplicar a
  lógica.
* O endpoint antigo `/api/route` continua intacto (compatibilidade).

### 3.6 Interface (`public/index.html`, `public/app.js`, `public/styles.css`)

* Lista dinâmica de pontos: **A (origem)**, **B, C… (paradas)** e **destino**,
  com distintivo colorido (verde / azul / vermelho) no mapa e no painel.
* Cada ponto tem: campo de **Endereço Digital**, botão **Validar**, linha de
  **estado da validação**, campo de coordenadas (alternativa), botão de
  seleção no mapa (🗺), botão de **localizar no mapa** (🎯), **subir/descer**
  na ordem e **remover** (só nas paradas).
* Botão **“+ Adicionar parada”**; **Inverter** troca origem/destino.
* Resultado: distância total, **paradas**, **trechos**, **sequência A → B → C**,
  distância de cada trecho, **distância de acesso de cada ponto à rede** e a
  lista de logradouros percorridos.
* A rota é desenhada como **um único traço**, com todas as paradas
  identificáveis.

---

## 4. Testes (`test/enderecoDigital.test.js` — 16 casos)

| # | Cenário obrigatório | Teste |
|---|---|---|
| 1 | Plus Code completo válido | normalização, validação e conversão; `validar` **não** devolve coordenadas |
| 2 | Plus Code encurtado | `8FP9+J6` → `588M8FP9+J6` (expansão com a referência do município) |
| 3 | Código inválido | 8 formatos recusados; modo SIGA sem conexão → `INDISPONIVEL` |
| 4 | Endereço fora da área | recusado sem converter (sem coordenada inventada) |
| 4b | Código truncado | comportamento fiel da classe (preenchimento com `'0'`) |
| 4c | Falha × vazio | estados distintos; contrato de normalização para o banco |
| 5 | Coordenada próxima de um eixo | liga-se à rede; **distância de acesso** medida |
| 6 | Ponto distante da rede | `FORA_DA_REDE` com a distância medida |
| 7 | Rota origem → destino | usa a rede viária |
| 8 | Rota com duas ou mais paradas | 3 trechos, ordem A→B→C→D, total = soma dos trechos |
| 9 | Adição, edição e remoção | rótulos recalculados; origem/destino protegidos |
| 10 | Reordenação | paradas trocam de lugar; extremos fixos |
| 11 | Trecho sem conexão | erro explícito; **nenhuma linha reta** no lugar |
| 12 | Endereço alterado depois do cálculo | o ponto volta a “sem coordenada” e o cálculo é recusado |
| 13 | Curvas preservadas | vértices originais presentes em **todos** os trechos |
| + | Integração com a rede real | código do centro de Santo André → rota sobre a malha real |

**Suíte completa: `node --test test/` → 88 testes, 88 passando** (72 da rodada
anterior + 16 novos).

---

## 5. Resultado na aplicação real

Capturas em `imagens/` (geradas por `npm run validar:paradas`):

* `app-paradas.png` — A e B resolvidos por **Endereço Digital**
  (`8FP9+J6` → `588M8FP9+J6` e `8FQV+9X` → `588M8FQV+9X`), C por
  coordenadas; rota de **7,47 km**, 1 parada, 2 trechos, sequência **A → B → C**
  e marcadores A/B/C no mapa.
* `app-paradas-zoom.png` — detalhe da parada B e do trecho de acesso até a
  avenida (**75,85 m** de acesso, declarados no painel).
* `app-estado-erro.png` — Endereço Digital **malformado** no ponto A: a
  mensagem aparece em vermelho, as coordenadas do ponto são **descartadas**
  (nenhuma coordenada é inventada) e o marcador correspondente some do mapa.

Comportamentos verificados na interface real: **remoção** de uma parada
(recalcula os rótulos: `A B C D` → `A B C`), **inversão** do trajeto,
**adição** de paradas e recálculo — todos com o mesmo motor e a mesma rede
viária do GeoServer.

---

## 6. Limitações conhecidas

* O modo **`siga`** não funciona neste ambiente: não há Oracle do SIGA,
  credenciais nem rede corporativa. O adaptador existe, está isolado e
  responde `INDISPONIVEL` — sem inventar resultados.
* O recorte aceito pelo CEP Digital é o da classe (maior que o município):
  um código de fora de Santo André é recusado com `FORA_DA_AREA` **quando o
  ponto decodificado cai fora da região** — códigos curtos são expandidos a
  partir da referência, portanto nunca saem do município.
* A **ordem das paradas é a do usuário**: não há otimização de ordem de
  visita (prevista como funcionalidade separada).
* O acesso de um ponto até a rede pode chegar a ~100 m (limite padrão);
  quando ultrapassa, a resposta é `FORA_DA_REDE` com a distância medida.
* O **preenchimento com `'0'`** dos códigos truncados é fiel à classe, mas
  significa que o ponto resolve para o **centro da célula** do prefixo
  (célula de 0,0025° ≈ 280 m), não para o centro do código completo.

---

## 7. Arquivos desta rodada

```
core/enderecoDigital.js            porta fiel da parte de CEP Digital
core/enderecoDigitalService.js     interface de serviço (local | siga)
core/pontoTrajeto.js               lista de pontos (rótulos, ordem)
core/rotaParadas.js                cálculo dos trechos na ordem do usuário
server/index.js                    + /api/endereco-digital, + /api/rota-paradas, + /core/*.js
public/index.html                  painel de pontos do trajeto
public/app.js                      lista dinâmica, marcadores A/B/C/D, resultado por trecho
public/styles.css                  estilos dos pontos e dos trechos
test/enderecoDigital.test.js       16 testes da rodada
tools/validar-paradas.mjs          validação visual no navegador
updates/05-endereco-digital-e-paradas/
├── README.md                      este documento
├── imagens/
│   ├── app-paradas.png            rota A → B → C (7,47 km)
│   ├── app-paradas-zoom.png       detalhe da parada e do acesso à rede
│   └── app-estado-erro.png        Endereço Digital malformado
└── pacote/                        cópia dos arquivos alterados
```
