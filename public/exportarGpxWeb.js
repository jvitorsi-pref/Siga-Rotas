import { gerarGpxRota, nomeArquivoGpx } from './gpx.js';

function downloadBlob(gpxXml, nomeArquivo, env) {
  const doc = env.document;
  const BlobCtor = env.Blob;
  const UrlApi = env.URL;
  const agendar = typeof env.setTimeout === 'function' ? env.setTimeout : setTimeout;

  if (!doc?.createElement || !BlobCtor || !UrlApi?.createObjectURL) {
    throw new Error('O navegador não disponibilizou os recursos de download de arquivo.');
  }

  const blob = new BlobCtor([gpxXml], { type: 'application/gpx+xml;charset=utf-8' });
  const url = UrlApi.createObjectURL(blob);
  try {
    const link = doc.createElement('a');
    link.href = url;
    link.download = nomeArquivo;
    link.rel = 'noopener';
    link.style.display = 'none';
    doc.body?.appendChild?.(link);
    link.click();
    if (typeof link.remove === 'function') {
      link.remove();
    } else {
      doc.body?.removeChild?.(link);
    }
  } finally {
    const timer = agendar(() => UrlApi.revokeObjectURL?.(url), 1000);
    timer?.unref?.();
  }

  return {
    ok: true,
    modo: 'download',
    arquivo: nomeArquivo,
    mensagem: `Arquivo GPX gerado e enviado para download (${nomeArquivo}).`,
  };
}

/**
 * Exporta a rota calculada em GPX 1.1 iniciando imediatamente o download
 * convencional do navegador para a pasta de downloads padrão.
 */
export async function exportarRotaGpxWeb(route, opcoes = {}) {
  const env = opcoes.env || globalThis;
  let gpxXml;
  let nomeArquivo;
  try {
    gpxXml = gerarGpxRota(route, { pontos: opcoes.pontos, agora: opcoes.agora });
    nomeArquivo = nomeArquivoGpx(route, opcoes.agora);
  } catch (err) {
    return {
      ok: false,
      motivo: 'SEM_ROTA',
      mensagem: err.message || 'Calcule uma rota completa antes de exportar em GPX.',
    };
  }

  try {
    return downloadBlob(gpxXml, nomeArquivo, env);
  } catch (err) {
    return {
      ok: false,
      motivo: 'ERRO_DOWNLOAD',
      mensagem: err.message || 'Não foi possível gerar e baixar o arquivo GPX neste navegador.',
    };
  }
}
