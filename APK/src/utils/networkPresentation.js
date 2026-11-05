/** Rótulos factuais: fonte carregada não é prova de conexão atual. */
export function apresentarRede(meta) {
  const fontes = { wfs: 'WFS — carregado nesta sessão', 'wfs-cache': 'Cache local do WFS', snapshot: 'Snapshot incluído no APK' };
  const estados = { persisted: 'Salvo para a próxima abertura', saving: 'Gravando no dispositivo…', 'memory-only': 'Atualização apenas em memória', unavailable: 'Cache indisponível; usada alternativa local' };
  return {
    fonte: fontes[meta?.source] || 'Fonte não informada',
    cache: estados[meta?.cache?.status] || (meta?.source === 'snapshot' ? 'Snapshot incluído no APK' : 'Persistência não informada'),
    avisos: [...(Array.isArray(meta?.warnings) ? meta.warnings.map(String) : []),
      ...(meta?.cache?.error ? [String(meta.cache.error)] : []),
      ...(meta?.remoteApi?.configured && !meta.remoteApi.supported ? ['Delegação remota não implementada; o cálculo permanece local.'] : [])],
    erros: (meta?.update?.recentErrors || []).map(e => String(e.message || e)).slice(-5),
  };
}
