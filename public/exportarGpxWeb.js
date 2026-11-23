import { prepararPacoteExportacaoGpx } from './gpx.js';

function downloadBlob(conteudo, nomeArquivo, mimeType, env) {
  const doc = env.document;
  const BlobCtor = env.Blob;
  const UrlApi = env.URL;
  const agendar = typeof env.setTimeout === 'function' ? env.setTimeout : setTimeout;

  if (!doc?.createElement || !BlobCtor || !UrlApi?.createObjectURL) {
    throw new Error('O navegador não disponibilizou os recursos de download de arquivo.');
  }

  const blob = new BlobCtor([conteudo], { type: mimeType });
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
}

/**
 * Exporta a rota calculada e/ou percorrida em GPX 1.1 (ou ZIP com ambos os GPX
 * no Cenário B) iniciando imediatamente o download convencional do navegador.
 */
export async function exportarRotaGpxWeb(route, opcoes = {}) {
  const env = opcoes.env || globalThis;
  const pacote = prepararPacoteExportacaoGpx({
    rotaCalculada: route,
    rotaCalculadaOriginal: opcoes.rotaCalculadaOriginal ?? null,
    rotaPercorrida: opcoes.rotaPercorrida ?? null,
    pontos: opcoes.pontos ?? [],
    pontosGps: opcoes.pontosGps ?? [],
    navegacaoEmAndamento: opcoes.navegacaoEmAndamento === true,
    criarZipFn: opcoes.criarZipFn,
    agora: opcoes.agora,
  });

  if (!pacote.ok) {
    return {
      ok: false,
      motivo: pacote.motivo,
      mensagem: pacote.mensagem,
    };
  }

  try {
    const conteudo = pacote.tipoArquivo === 'zip' ? pacote.zipBytes : pacote.gpxXml;
    const mimeType =
      pacote.tipoArquivo === 'zip' ? 'application/zip' : 'application/gpx+xml;charset=utf-8';
    downloadBlob(conteudo, pacote.nomeArquivo, mimeType, env);

    const nomesInternos = pacote.arquivos.map((a) => a.nome);
    const mensagem =
      pacote.cenario === 'AMBAS'
        ? `Pacote ${pacote.nomeArquivo} enviado para download (${nomesInternos.join(' e ')}).`
        : `Arquivo GPX gerado e enviado para download (${pacote.nomeArquivo}).`;

    return {
      ok: true,
      modo: 'download',
      cenario: pacote.cenario,
      tipoArquivo: pacote.tipoArquivo,
      arquivo: pacote.nomeArquivo,
      arquivosInternos: nomesInternos,
      mensagem,
    };
  } catch (err) {
    return {
      ok: false,
      motivo: 'ERRO_DOWNLOAD',
      mensagem: err.message || 'Não foi possível gerar e baixar o arquivo GPX neste navegador.',
    };
  }
}
