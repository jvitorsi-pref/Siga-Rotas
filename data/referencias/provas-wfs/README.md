# Provas do comportamento do WFS (rodada 1)

Respostas cruas do GeoServer da Prefeitura, guardadas como evidência das
conclusões descritas na seção 4 do `README.md` ("Estratégia de paginação e
carregamento do WFS").

| Arquivo | Requisição | O que prova |
|---|---|---|
| `bbox1.json` | `GetFeature` com `bbox=` (GeoJSON) | o filtro espacial por `bbox` **não funciona** nesta camada (0 feições) |
| `bbox2.json` | `GetFeature` com `bbox=` (XML) | o mesmo pedido em XML devolve `ServiceException` |
| `cql1.json` | `GetFeature` com `CQL_FILTER=ID>=1 AND ID<1001` | o **CQL por faixa de ID funciona** — é a base da paginação adotada (995 feições) |
| `p_0.json`, `p_1000.json`, `p_2000.json`, `p_3000.json`, `p_4000.json` | cinco janelas de ID por CQL | a union das cinco janelas é **idêntica** ao download único (`all-4119-eixos-2026-10-20.json`), provando que a paginação não perde nem duplica eixos |

Regenerável a qualquer momento:

```bash
node tools/fetch-network.js          # baixa a rede completa
node tools/inspect-layer.js          # inspeciona a camada
node tools/validate-routes.js 2000   # valida as rotas
```
