/* ==========================================================================
   public/config.js — Configuração declarativa da integração Web / WebForms
   --------------------------------------------------------------------------
   Não armazene segredos neste arquivo. Em produção atrás do IIS/WebForms,
   `proxyPath` aponta para o handler ASP.NET de mesma origem (`ApiProxy.ashx`),
   que encaminha `/api/*` ao servidor Node.js em loopback sem exigir ARR ou
   URL Rewrite e sem expor porta adicional na rede.
   ========================================================================== */
(function () {
  var atual = window.__SIGA_CONFIG__ && typeof window.__SIGA_CONFIG__ === 'object'
    ? window.__SIGA_CONFIG__
    : {};
  window.__SIGA_CONFIG__ = Object.assign(
    {
      apiBase: '',
      proxyPath: '../ApiProxy.ashx',
      campoProxyPath: '../SigaRotasCampo.ashx',
      allowLocalFallback: false,
    },
    atual,
  );
})();
