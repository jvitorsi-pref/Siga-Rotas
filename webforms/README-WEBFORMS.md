# Integração do Siga-Rotas em ASP.NET WebForms (`<iframe>`) e IIS

O Siga-Rotas pode ser incorporado na página `.aspx` usando o `<iframe>`:

```html
<iframe src="../../SigaApp/SigaRotas/public/index.html"
    allow="geolocation"
    style="border:none;width:100%; min-height:700px; display: block;">
</iframe>
```

## Arquitetura centralizada recomendada (WebForms → `ApiProxy.ashx` → Node.js)

A versão Web **não executa** cálculo de rotas nem leitura de snapshot local como fluxo principal: ela consulta os endpoints `/api/*` do backend Node.js (`server/index.js`), que prioriza o GeoServer WFS e recorre ao `data/network.snapshot.json` apenas em contingência.

1. Copie o projeto para `~/SigaApp/SigaRotas/` (incluindo `server/`, `core/`, `public/`, `data/`, `scripts/`, `web.config` e `webforms/ApiProxy.ashx` em `~/SigaApp/SigaRotas/ApiProxy.ashx`).
2. Como o servidor Node.js usa **zero dependências externas de runtime** (`node >= 20`), **não é necessário rodar `npm install` nem ter `node_modules`** em produção.
3. Inicie o processo Node.js em loopback (`127.0.0.1:8094`, sem expor porta pública extra):
   ```cmd
   scripts\siga-node.cmd ensure
   ```
   - **Sem privilégio administrativo (recomendado):** agende `scripts\siga-node.cmd ensure` no **Agendador de Tarefas do Windows** (no logon/inicialização da conta de serviço ou verificação periódica a cada 5 min — o script é idempotente e não duplica o processo se `/api/health` já responder).
   - **Alternativa IIS:** caso o administrador tenha habilitado `HttpPlatformHandler` no IIS, é possível apontá-lo para `node.exe server\index.js`.
   - *Nota técnica:* evite iniciar `node.exe` como processo filho de dentro de código `.ashx` (`w3wp.exe`), pois reciclagens do Application Pool no IIS encerram processos filhos por Job Object.
4. Ao abrir `../../SigaApp/SigaRotas/public/index.html`:
   - `public/config.js` e `public/clienteRede.js` sondam `../ApiProxy.ashx?endpoint=%2Fapi%2Fhealth` na mesma origem HTTPS do portal (sem exigir ARR nem URL Rewrite no IIS).
   - Todas as chamadas (`/api/network`, `/api/rota-paradas`, `/api/route`, `/api/endereco-digital`, `/api/diagnostics`) passam pelo `ApiProxy.ashx` rumo ao Node.js em `127.0.0.1:8094`.
   - Caso o servidor Node.js use outra porta/URL interna ou token opcional, configure no `Web.config` raiz do portal:
     ```xml
     <appSettings>
       <add key="SigaRotas.NodeApiBase" value="http://127.0.0.1:8094" />
       <!-- Opcional: se SIGA_API_TOKEN estiver configurado no Node.js -->
       <add key="SigaRotas.NodeApiToken" value="" />
     </appSettings>
     ```

## Opções adicionais e contingência

- **API Node.js direta ou atrás de proxy reverso:** informe `?apiBase=https://...` no `src` do `<iframe>` ou ajuste `apiBase` em `public/config.js`.
- **Contingência local no navegador (desativada por padrão):** o cálculo local no navegador via `data/network.snapshot.json` / `public/network.snapshot.js` fica desabilitado no fluxo padrão para garantir regra de negócio única no servidor Node.js. Se precisar ativá-lo temporariamente em emergência estática, passe `?modo=cliente` ou `?fallback=local` (e opcionalmente `?wfsProxy=../WfsProxy.ashx`).
- **Permissões e cabeçalhos no portal pai:**
  - Mantenha `X-Frame-Options: SAMEORIGIN` (ou ausente) no `Web.config` raiz do ASP.NET; `DENY` bloquearia o `<iframe>`.
  - Inclua `allow="geolocation"` no `<iframe>` para o GPS na navegação.
  - Não use `sandbox` restritivo sem `allow-downloads allow-scripts allow-same-origin`, preservando a exportação GPX.
