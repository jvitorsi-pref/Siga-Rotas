/** Rótulos factuais: fonte carregada distingue servidor Node (WFS/snapshot), WFS direto e cache offline. */
export function apresentarRede(meta) {
  const backendSource = meta?.backendSource || meta?.remoteApi?.backendSource;
  const fonteApiNode =
    backendSource === 'wfs'
      ? 'Servidor Node.js (WFS)'
      : backendSource === 'snapshot'
        ? 'Servidor Node.js (snapshot)'
        : 'Servidor Node.js';

  const fontes = {
    'api-node': fonteApiNode,
    wfs: 'WFS — carregado nesta sessão',
    'wfs-cache': 'Cache local do WFS',
    snapshot: 'Snapshot incluído no APK',
  };
  const estados = {
    persisted: 'Salvo para a próxima abertura',
    saving: 'Gravando no dispositivo…',
    'memory-only': 'Atualização apenas em memória',
    unavailable: 'Cache indisponível; usada alternativa local',
  };

  let calculo = 'Local no aparelho';
  if (meta?.remoteApi?.supported !== false) {
    if (meta?.remoteApi?.execution === 'remote') {
      calculo =
        backendSource === 'wfs'
          ? 'Via servidor Node.js (WFS)'
          : backendSource === 'snapshot'
            ? 'Via servidor Node.js (snapshot)'
            : 'Via servidor Node.js';
    } else if (meta?.remoteApi?.execution === 'local-fallback') {
      calculo = 'Local no aparelho (contingência offline)';
    }
  }

  let transporte = 'Modo local (sem servidor configurado)';
  if (meta?.remoteApi?.configured) {
    transporte =
      meta.remoteApi.transport === 'ashx'
        ? 'Proxy WebForms (ApiProxy.ashx)'
        : 'API Node.js direta (/api/*)';
  }

  const avisosBase = Array.isArray(meta?.warnings) ? meta.warnings.map(String) : [];
  const avisosExtra = [];
  if (meta?.cache?.error) avisosExtra.push(String(meta.cache.error));
  if (meta?.remoteApi?.configured && meta.remoteApi.supported === false) {
    avisosExtra.push('Delegação remota não implementada; o cálculo permanece local.');
  } else if (
    meta?.remoteApi?.configured &&
    meta?.remoteApi?.execution === 'local-fallback' &&
    meta?.remoteApi?.lastError &&
    !avisosBase.some((w) => w.includes(String(meta.remoteApi.lastError)))
  ) {
    avisosExtra.push(`Servidor Node.js indisponível (${meta.remoteApi.lastError}); operando offline.`);
  }

  return {
    fonte: fontes[meta?.source] || 'Fonte não informada',
    cache:
      estados[meta?.cache?.status] ||
      (meta?.source === 'snapshot' ? 'Snapshot incluído no APK' : 'Persistência não informada'),
    calculo,
    transporte,
    servidor: meta?.remoteApi?.configured ? meta.remoteApi.url || null : null,
    avisos: [...avisosBase, ...avisosExtra],
    erros: (meta?.update?.recentErrors || []).map((e) => String(e.message || e)).slice(-5),
  };
}
