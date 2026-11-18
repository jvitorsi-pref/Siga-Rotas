# Integração do Siga-Rotas em ASP.NET WebForms (`<iframe>`)

O Siga-Rotas pode ser incorporado diretamente na página `.aspx` usando o `<iframe>` indicado:

```html
<iframe src="../../SigaApp/SigaRotas/public/index.html"
    allow="geolocation"
    style="border:none;width:100%; min-height:700px; display: block;">
</iframe>
```

## Como funciona sem Node.js no servidor IIS

1. Copie o projeto para `~/SigaApp/SigaRotas/` (especialmente `public/`, `core/`, e opcionalmente `data/` e `web.config`).
2. Ao abrir `../../SigaApp/SigaRotas/public/index.html`:
   - `public/clienteRede.js` detecta automaticamente a execução em pasta estática (`/public/`).
   - Primeiro tenta carregar `../data/network.snapshot.json`; caso `.json` seja bloqueado, não tenha sido publicado ou o ASP.NET redirecione/devolva uma página HTML (`<!DOCTYPE ...>`), ele cai automaticamente para `public/network.snapshot.js` (servido pelo mesmo pipeline de módulos `.js` de `app.js`).
   - O cálculo de rotas (A*, TSP/otimização, circuito com retorno à origem), Plus Code local (`core/enderecoDigitalService.js`), navegação com simulação/GPS e exportação GPX executam integralmente no navegador com os módulos puros de `core/`.
   - O registro do Service Worker (`/sw.js`) é omitido automaticamente dentro de `<iframe>` / subpasta `/public/`, evitando requisições 404 na raiz do portal WebForms.

## Opções adicionais

- **Atualização ao vivo via WFS pelo IIS (opcional, sem Node.js):**
  Copie `webforms/WfsProxy.ashx` para `~/SigaApp/SigaRotas/WfsProxy.ashx` e informe `?wfsProxy=../WfsProxy.ashx` no `src` do `<iframe>` (com fallback automático para `../data/network.snapshot.json` caso o GeoServer esteja inacessível).
- **Backend Node.js dedicado (opcional):**
  Se houver uma instância `node server/index.js` rodando em proxy reverso no mesmo subcaminho (ex.: `../../SigaApp/SigaRotas/`), ou em outra URL informada via `?apiBase=https://...`, `clienteRede.js` usa o backend normalmente.
- **Permissões e cabeçalhos no portal pai:**
  - Mantenha `X-Frame-Options: SAMEORIGIN` (ou ausente) no `Web.config` raiz do ASP.NET; `DENY` bloquearia o `<iframe>`.
  - Inclua `allow="geolocation"` no `<iframe>` para que "Usar minha localização" e o GPS na navegação funcionem em todos os navegadores.
  - Não adicione atributo `sandbox` restritivo sem `allow-downloads allow-scripts allow-same-origin`, para preservar o download automático de GPX.
