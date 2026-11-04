# Notas da restauração — Rodada 14 (auditoria da ordem de visitas)

Esta pasta é uma **cópia independente** do projeto SIGA no estado da **rodada 14**
("auditoria da ordem de visitas"). O projeto principal
(`/home/user/santo-andre-routing`) **não foi alterado** por nada daqui.

* Roda na **porta 8094**: `npm start`
* Suíte própria: **218/218 PASSING** (202 da rodada 13 + 16 desta rodada)

## O que a rodada 14 entregou

* **Auditoria da ordem de visitas** (`tools/auditar-ordem-paradas.js`): compara
  o Held-Karp com a **força bruta** e com o **trajeto desenhado**, em amostras
  reais da rede, e verifica que:
  * a sequência devolvida é realmente ótima;
  * o retorno à **origem** é obrigatório (circuito);
  * o trecho desenhado é **igual** à célula da matriz em todas as pernas
    (a geometria é a geometria custada);
  * **minimizar o total ≠ minimizar a primeira perna** — em 52,8 % das amostras
    a primeira perna da rota ótima **não** é a mais curta a partir de A (o
    exemplo da rodada: rota ótima 1.720,385 m contra 1.741,598 m da "vizinho
    mais próximo", 21,21 m de diferença).
* **Variante "saída curta"**: mesmo total, desempate pela primeira perna —
  declarada na interface, sem mudar o objetivo em silêncio.
* **`core/ordemParadas.js` e `core/rotaParadas.js`** corrigidos/expandidos, e
  **`server/index.js`** passa a aceitar o modo `saida_curta`.
* Testes: `test/ordemOtimizada.test.js`; ferramentas:
  `tools/auditar-ordem-paradas.js`, `tools/validar-saida-curta.mjs`.

## Como esta cópia foi montada (e o que é fiel)

| parte | origem | fidelidade |
|---|---|---|
| `core/ordemParadas.js`, `core/rotaParadas.js`, `public/app.js`, `public/index.html`, `server/index.js`, `test/ordemOtimizada.test.js`, `tools/auditar-ordem-paradas.js`, `tools/validar-saida-curta.mjs`, `package.json` | pacote da rodada 14 | **idêntico** |
| `core/armazenamentoLocal.js`, `core/coleta.js`, `public/coletaUI.js`, `public/manifest.webmanifest`, `public/styles.css`, `public/sw.js`, `test/armazenamentoLocal.test.js`, `test/coleta.test.js`, `tools/validar-offline.mjs` | pacote da rodada 13 (a 14 não tocou neles) | **idêntico** |
| `core/router.js`, `test/caminhoMinimo.test.js`, `tools/auditar-caminho-minimo.js` | pacote da rodada 12 | **idêntico** |
| `test/otimizacaoAuditoria.test.js`, `tools/auditar-otimizacao.js`, `validar-circular.mjs`, `validar-mapa.mjs`, `validar-otimizacao.mjs`, `validar-paradas.mjs` | pacote da rodada 11 | **idêntico** |
| `core/pontoTrajeto.js` | pacote da rodada 7 (última antes da rodada 15 mexer nele) | **idêntico** |
| demais arquivos de `core/`, `public/navegacaoUI.js`, `public/vendor/`, `data/` | projeto atual (não mudaram entre as rodadas 9 e 14) | **idêntico** |
| arquivos criados depois (modos, interface em etapas, app mobile, tokens, identidade SIGA) | **removidos** | — |

### A prova de que o estado é o da rodada 14

```bash
node tools/auditar-ordem-paradas.js
```

devolve, na rede real:

```
soma dos trechos desenhados : 1720,385 m
total devolvido pela API     : 1720,385 m
diferença                   : 0,000 m
melhor rota global (Held-Karp): A→D→C→B→A = 1720,385 m
variante "saída curta" (mesmo total): A→B→C→D→A = 1720,385 m
amostras auditadas: 250 · ok: 250 · falhas: 0
AUDITORIA CONCLUÍDA — nenhuma inconsistência encontrada
```

## Como usar

```bash
npm install          # só na primeira vez
npm start            # http://localhost:8094
npm test             # 218/218
node tools/auditar-ordem-paradas.js       # a auditoria da própria rodada 14
node tools/validar-saida-curta.mjs        # conferência visual do modo "saída curta"
```

## Limitações

1. Não há app mobile nem identidade visual SIGA nesta rodada.
2. A rede é a mesma de hoje (4.545 eixos, 11.537 nós, 342 componentes).
3. A auditoria usa amostras aleatórias na maior componente (9.686 nós) — é
   evidência estatística forte, não prova exaustiva.
