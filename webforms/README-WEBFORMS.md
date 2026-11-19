# Integração do Siga-Rotas em ASP.NET WebForms (`<iframe>`), IIS e APK

O Siga-Rotas pode ser incorporado na página `.aspx` usando o `<iframe>`:

```html
<iframe src="../../SigaApp/SigaRotas/public/index.html"
    allow="geolocation"
    style="border:none;width:100%; min-height:700px; display: block;">
</iframe>
```

---

## Arquitetura unificada em produção (WebForms + APK → `ApiProxy.ashx` → Node.js)

```text
  Navegador (WebForms iframe) ──► ../ApiProxy.ashx?endpoint=/api/... ──┐
                                                                        ├──► Node.js (127.0.0.1:8094)
  App Android (APK) ────────────► https://<portal>/.../ApiProxy.ashx ───┘       ├── WFS GeoServer + snapshot
     (ou proxy reverso /api/*; fallback offline automático no aparelho)          └── data/ocorrencias.json
```

Tanto a **Web** quanto o **APK** podem compartilhar exatamente o mesmo servidor Node.js centralizado (`server/index.js`) em `127.0.0.1:8094` usando o próprio `ApiProxy.ashx` — **sem abrir porta pública adicional e sem precisar de ARR / URL Rewrite no IIS**:

1. **Web (`public/index.html`)**: sonda `../ApiProxy.ashx?endpoint=%2Fapi%2Fhealth` na mesma origem do portal e delega rede, rotas, Endereço Digital e ocorrências colaborativas ao Node.js.
2. **APK (`APK/`)**: detecta automaticamente o formato da URL configurada:
   - se terminar em `.ashx` (ex.: `https://portal.exemplo.sp.gov.br/SigaApp/SigaRotas/ApiProxy.ashx`), traduz todas as chamadas (`/api/health`, `/api/network`, `/api/rota-paradas`, `/api/ocorrencias*`, `/api/endereco-digital`) para `?endpoint=%2Fapi%2F...`;
   - se for URL direta / proxy reverso (ex.: `https://portal.exemplo.sp.gov.br/SigaApp/SigaRotas`), chama `${url}/api/...` diretamente.
3. **Fallback automático online ↔ local no APK**: com uma URL configurada, o APK sempre tenta o servidor Node.js primeiro; se estiver sem internet ou o Node.js estiver fora, calcula localmente no aparelho com o grafo/ocorrências em cache e enfileira ocorrências/votos pendentes para sincronizar automaticamente quando a conexão voltar.

---

## Checklist para colocar em produção

### 1. Arquivos no servidor IIS
Copie o projeto para `~/SigaApp/SigaRotas/` (incluindo `server/`, `core/`, `ocorrencias/`, `public/`, `data/`, `scripts/`, `web.config` e `webforms/ApiProxy.ashx` em `~/SigaApp/SigaRotas/ApiProxy.ashx`).

> **Zero dependências em runtime:** o servidor Node.js (`node >= 20`) usa apenas módulos nativos; **não** é necessário rodar `npm install` nem copiar `node_modules` para produção.

### 2. Manter o backend Node.js ativo em loopback (`127.0.0.1:8094`)
Inicie o processo Node.js em loopback (sem expor porta pública extra):
```cmd
scripts\siga-node.cmd ensure
```
- **Sem privilégio administrativo (recomendado):** agende `scripts\siga-node.cmd ensure` no **Agendador de Tarefas do Windows** (no logon/inicialização da conta de serviço ou verificação periódica a cada 5 min — o script é idempotente e não duplica o processo se `/api/health` já responder).
- **Alternativa IIS:** caso o administrador tenha habilitado `HttpPlatformHandler` no IIS, é possível apontá-lo para `node.exe server\index.js`.
- *Nota técnica:* evite iniciar `node.exe` como processo filho de dentro de código `.ashx` (`w3wp.exe`), pois reciclagens do Application Pool no IIS encerram processos filhos por Job Object.

### 3. Configuração opcional no `Web.config` do portal
Caso o Node.js use outra porta interna ou token opcional, ajuste `<appSettings>` no `Web.config` raiz do portal:
```xml
<appSettings>
  <add key="SigaRotas.NodeApiBase" value="http://127.0.0.1:8094" />
  <!-- Opcional: se SIGA_API_TOKEN estiver configurado no Node.js -->
  <add key="SigaRotas.NodeApiToken" value="" />
</appSettings>
```
> Quando `SigaRotas.NodeApiToken` é preenchido no `Web.config`, o `ApiProxy.ashx` injeta o cabeçalho `X-Siga-Token` apenas do lado do servidor ao falar com `127.0.0.1:8094`, sem expor segredos no navegador nem no APK.

### 4. Acesso do APK no IIS (ponto importante se o portal tiver login)
- **Acesso anônimo ao proxy/API:** se o portal WebForms usar *Forms Authentication* ou *Windows Authentication*, chamadas externas do APK para `ApiProxy.ashx` serão redirecionadas para a página HTML de login (o APK detecta HTML e entra em fallback offline local). Libere acesso anônimo especificamente ao caminho `ApiProxy.ashx` (ou à rota de proxy reverso `/api/*`) no IIS / `web.config` caso o APK público não carregue cookies de sessão do portal:
  ```xml
  <location path="SigaApp/SigaRotas/ApiProxy.ashx">
    <system.web>
      <authorization>
        <allow users="*" />
      </authorization>
    </system.web>
  </location>
  ```
- **Alternativa com ARR / URL Rewrite:** se preferir expor `/SigaApp/SigaRotas/api/*` diretamente pelo IIS para `http://127.0.0.1:8094/api/*`, também funciona nativamente.

### 5. Apontar o APK para produção (em build ou direto no aplicativo)
Escolha **uma** das duas formas (ou combine as duas):

- **Na compilação do APK (recomendado para distribuição):** defina a variável antes do build Gradle/EAS:
  ```bash
  # Via ApiProxy.ashx do WebForms (sem ARR/porta extra):
  EXPO_PUBLIC_SIGA_API_URL=https://seu-portal.santoandre.sp.gov.br/SigaApp/SigaRotas/ApiProxy.ashx

  # Ou via proxy reverso /api/* direto:
  # EXPO_PUBLIC_SIGA_API_URL=https://seu-portal.santoandre.sp.gov.br/SigaApp/SigaRotas
  ```
- **Sem recompilar o APK (direto no aparelho):** abra o painel **Rede viária → ▸ Configurar servidor backend**, informe a URL de produção (`.../ApiProxy.ashx` ou URL direta) e toque em **Conectar e sincronizar**. A URL fica salva no `AsyncStorage` do aparelho e passa a ser usada automaticamente em todas as aberturas seguintes.

### 6. Persistência de ocorrências e permissão de escrita
- As ocorrências colaborativas são salvas em `~/SigaApp/SigaRotas/data/ocorrencias.json` (criado automaticamente no primeiro registro/interação).
- Garanta permissão de leitura e escrita na pasta `data/` para a conta do Windows que executa `node.exe` e inclua `data/ocorrencias.json` na rotina de backup.

---

## Opções adicionais e contingência

- **API Node.js direta ou atrás de proxy reverso na Web:** informe `?apiBase=https://...` no `src` do `<iframe>` ou ajuste `apiBase` em `public/config.js`.
- **Contingência local no navegador (desativada por padrão):** o cálculo local no navegador via `data/network.snapshot.json` / `public/network.snapshot.js` fica desabilitado no fluxo padrão para garantir regra de negócio única no servidor Node.js. Se precisar ativá-lo temporariamente em emergência estática, passe `?modo=cliente` ou `?fallback=local` (e opcionalmente `?wfsProxy=../WfsProxy.ashx`).
- **Permissões e cabeçalhos no portal pai:**
  - Mantenha `X-Frame-Options: SAMEORIGIN` (ou ausente) no `Web.config` raiz do ASP.NET; `DENY` bloquearia o `<iframe>`.
  - Inclua `allow="geolocation"` no `<iframe>` para o GPS na navegação.
  - Não use `sandbox` restritivo sem `allow-downloads allow-scripts allow-same-origin`, preservando a exportação GPX.
