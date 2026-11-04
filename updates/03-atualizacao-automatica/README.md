# Rodada 3 — Atualização automática da view

**Pedido:** *"do jeito que está, se for feita alguma atualização na view que te
passei, ele atualiza sozinho?"*

**Resposta da rodada:** antes **não**; agora **sim**.

---

## 1. O estado antes da rodada

| Onde | O que acontecia |
|---|---|
| `NetworkService.state` | a rede em memória era cacheada **para sempre** |
| TTL do snapshot (6 h) | só era conferido **no arranque** |
| `POST /api/refresh` | existia, mas era **manual** |

Ou seja: se a Prefeitura acrescentasse uma rua na view, o servidor continuaria
servindo o grafo antigo até alguém reiniciar o processo ou chamar o
`/api/refresh`.

## 2. O que foi implementado

### 2.1 Dois níveis de verificação

| Nível | Padrão | O que faz | Custo real medido |
|---|---|---|---|
| **Leve** | a cada **5 min** | `GetFeature` com `maxFeatures=1`; compara o `totalFeatures` do servidor com o total em uso | ~600 B, ~1 s |
| **Completo** | a cada **6 h** | baixa a camada inteira e compara a **impressão digital** (SHA-256) | ~2,7 MB, ~3 s |

A leve cobre o caso comum (eixo acrescentado ou removido). A completa é a
única forma de detectar a **correção de um eixo já existente** — rua
renomeada ou traçado redesenhado —, porque nesses casos o total não muda.

**Impressão digital** (`fingerprintOf`): SHA-256 sobre as feições **ordenadas
por `ID`** e com **coordenadas arredondadas**, para que a mesma rede produza
sempre a mesma impressão e qualquer alteração real de geometria produza outra.

### 2.2 Troca atômica do grafo

```
detecta a mudança
   ↓
baixa a rede nova e CONSTRÓI o grafo inteiro (nós, arestas, conectores, índices)
   ↓
this.state = novoEstado        ← uma única atribuição
   ↓
grava o snapshot em disco para o próximo arranque
```

As requisições em andamento terminam usando o grafo antigo; a próxima já usa o
novo. **Nunca** existe um grafo pela metade em uso.

### 2.3 Resiliência (o GeoServer da Prefeitura não tem SLA)

* a verificação leve **falha rápido** (timeout 20 s, 1 tentativa) — um WFS
  lento não trava o processo;
* a falha fica registrada em `update.errors` e **não** derruba o servidor nem
  o estado em uso;
* se o WFS cair **no arranque**, o servidor usa o **snapshot local** (mesmo
  vencido) e avisa na interface;
* quando o WFS volta, a próxima verificação bem-sucedida recompõe a rede.

### 2.4 Observabilidade

* `GET /api/health` → bloco `update` com `lastCheckedAt`, `lastChangeAt`,
  `lastResult`, `errors`;
* `GET /api/network` → o mesmo bloco em `meta.update`;
* `POST /api/updates` → força uma verificação **completa** e devolve o
  resultado;
* **interface**: painel “Rede viária” com *Atualização automática*, *Última
  verificação* e *Rede atualizada em*.

### 2.5 Configuração

```bash
node server/index.js --check-interval 5 --deep-check-interval 360   # minutos
node server/index.js --no-auto-update                                # desliga
```

Variáveis de ambiente equivalentes: `CHECK_INTERVAL_MIN`,
`DEEP_CHECK_INTERVAL_MIN`, `NO_AUTO_UPDATE`.

## 3. Prova ao vivo (contra o GeoServer real)

A view da Prefeitura foi **editada durante os testes**. O log do servidor:

```
[rede] rede atualizada: 4154 eixos, 10560 nós, 14246 arestas (1131 ms).
[rede] rede atualizada: 4160 eixos, 10570 nós, 14260 arestas (788 ms).
```

O total da camada saiu de **4.119 → 4.137 → 4.138 → 4.146 → 4.160** em cerca
de 15 minutos. O servidor detectou sozinho
(`total de feições alterado (4153 -> 4154)`), reconstruiu o grafo e passou a
servir a rede nova **sem reiniciar**.

`/api/health` durante o processo:

```json
{
  "enabled": true,
  "checkIntervalMs": 300000,
  "deepCheckIntervalMs": 21600000,
  "checkTimeoutMs": 20000,
  "lastCheckedAt": "2026-10-21T21:30:08.009Z",
  "lastChangeAt": "2026-10-21T21:30:07.938Z",
  "lastResult": {
    "deep": false, "changed": true,
    "reason": "total de feições alterado (4153 -> 4154)",
    "serverTotal": 4154, "knownTotal": 4153, "elapsedMs": 4802
  },
  "errors": []
}
```

## 4. Testes

`test/update.test.js` — **13 casos** com um **GeoServer simulado** (mesmo
comportamento do real: `propertyName=ID`, `CQL_FILTER` por faixa de ID,
`totalFeatures` na resposta):

1. verificação leve sem mudança → não recarrega;
2. eixos acrescentados → recarrega;
3. eixos removidos → recarrega;
4. **correção de um eixo existente** → detectada pela verificação completa;
5. verificação completa sem mudança → não recarrega;
6. impressão digital estável (e muda com qualquer alteração);
7. **troca atômica** (o estado novo só entra completo);
8. falha do WFS → o servidor continua de pé e o estado é preservado;
9. verificações concorrentes compartilham uma execução;
10. temporizador ligado e desligado;
11. sem rede em uso, a verificação leve carrega a rede e vira a linha de base;
12. **WFS fora do ar ⇒ o snapshot antigo ainda permite servir rotas**;
13. `status()` expõe a situação da atualização automática.

Suíte completa: **64/64 passando** (`npm test`).

## 5. Arquivos tocados nesta rodada

| Arquivo | O que mudou |
|---|---|
| `core/config.js` | `UPDATE_DEFAULTS` (intervalos, timeout da verificação leve) |
| `server/networkService.js` | `startAutoUpdate`/`stopAutoUpdate`, `_checkForChanges`/`_doCheck`/`_reloadFromWfs`/`_applyFeatures`, `fingerprintOf`, rastreador `update`, `updateStatus()`, **fallback de snapshot**, opção `baseUrl` |
| `server/index.js` | flags `--no-auto-update`, `--check-interval`, `--deep-check-interval` (+ env), `POST /api/updates`, bloco `update` em `/api/health` e `/api/network`, banner do arranque |
| `public/app.js` | linhas “Atualização automática / Última verificação / Rede atualizada em” |
| `public/index.html` | favicon embutido (elimina o 404 do console) e *versionamento* dos assets (`?v=20261021`) |
| `test/update.test.js` | 13 testes novos |

### Correções adicionais encontradas no caminho

* **Coordenadas com vírgula decimal** (“-46,5450 , -23,6600”) eram rejeitadas
  pela interface → o interpretador foi refeito (`public/app.js`), aceitando
  vírgula decimal, ponto decimal e os dois;
* **cache do navegador**: os arquivos da aplicação passaram a revalidar por
  `ETag` + `Cache-Control: no-cache` (antes ficavam 1 h em cache); `vendor/`
  continua em cache de 1 h (`server/index.js`).

## 6. Como validar esta rodada

```bash
npm test                                   # 64 casos
npm start                                  # sobe com a atualização automática
curl -s localhost:8080/api/health | jq .update
curl -s -X POST localhost:8080/api/updates | jq '{changed, reason, serverTotal}'
```

Para ver a detecção na prática: altere a view no SIGA e espere o intervalo
leve (5 min por padrão) — o log mostra `[rede] rede atualizada: …` e o painel
da interface passa a mostrar *Rede atualizada em*.

## 7. Imagens

`imagens/` — `painel-atualizacao.png` (painel “Rede viária” com as linhas de
atualização) e `atualizacao-auto.png` (rota calculada com a rede já
reconstruída).

## 8. Pacote

`pacote/` contém **cópia idêntica** dos arquivos que esta rodada tocou
(`core_config.js`, `core_graph.js`, `core_router.js`, `core_geo.js`,
`server_networkService.js`, `server_index.js`, `public_app.js`,
`public_index.html`, `public_styles.css`, `test_graph.test.js`,
`test_update.test.js`). É o mesmo conteúdo da raiz do projeto — serve para
guardar esta versão do código sem depender do estado atual do projeto.
