import { gerarGpxRota, nomeArquivoGpx } from '../utils/gpx.js';

export function descreverPastaSaf(directoryUri) {
  if (!directoryUri) return 'pasta selecionada';
  try {
    const decodificada = decodeURIComponent(String(directoryUri));
    const treeMarker = decodificada.indexOf('/tree/');
    const bruto = treeMarker >= 0 ? decodificada.slice(treeMarker + 6) : decodificada;
    const colon = bruto.indexOf(':');
    const limpo = colon >= 0 ? bruto.slice(colon + 1) : bruto;
    return limpo || 'Armazenamento interno';
  } catch {
    return 'pasta selecionada';
  }
}

/**
 * Núcleo testável da exportação GPX 1.1 via Android Storage Access Framework (SAF).
 * Recebe `opcoes.fileSystem` (expo-file-system no app nativo; mock em testes).
 */
export async function exportarRotaGpxMobileCore(route, opcoes = {}) {
  const fs = opcoes.fileSystem;
  const saf = fs?.StorageAccessFramework;

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

  if (!saf?.requestDirectoryPermissionsAsync || !saf?.createFileAsync || !fs?.writeAsStringAsync) {
    return {
      ok: false,
      motivo: 'INDISPONIVEL',
      mensagem: 'Seletor nativo de pastas (SAF) indisponível neste dispositivo.',
    };
  }

  let perm;
  try {
    perm = await saf.requestDirectoryPermissionsAsync(opcoes.initialFileUrl ?? null);
  } catch (err) {
    return {
      ok: false,
      motivo: 'ERRO_PERMISSAO',
      mensagem: `Não foi possível abrir o seletor de pastas: ${err.message}`,
    };
  }

  if (!perm?.granted || !perm?.directoryUri) {
    return {
      ok: false,
      cancelado: true,
      motivo: 'CANCELADO',
      mensagem: 'Exportação GPX cancelada: nenhuma pasta selecionada.',
    };
  }

  let fileUri = null;
  try {
    try {
      fileUri = await saf.createFileAsync(perm.directoryUri, nomeArquivo, 'application/gpx+xml');
    } catch {
      // Alguns provedores SAF Android rejeitam MIME customizado e aceitam octet-stream mantendo a extensão .gpx.
      fileUri = await saf.createFileAsync(perm.directoryUri, nomeArquivo, 'application/octet-stream');
    }

    const encoding = fs.EncodingType?.UTF8 ?? 'utf8';
    await fs.writeAsStringAsync(fileUri, gpxXml, { encoding });

    const pasta = descreverPastaSaf(perm.directoryUri);
    return {
      ok: true,
      modo: 'saf',
      pasta,
      arquivo: nomeArquivo,
      fileUri,
      mensagem: `GPX salvo em "${pasta}" como ${nomeArquivo}.`,
    };
  } catch (err) {
    if (fileUri && typeof fs.deleteAsync === 'function') {
      try {
        await fs.deleteAsync(fileUri, { idempotent: true });
      } catch {
        /* ignora erro ao remover arquivo incompleto */
      }
    }
    const permMsg = /permiss|denied|security/i.test(err?.message || '');
    return {
      ok: false,
      motivo: permMsg ? 'PERMISSAO_NEGADA' : 'ERRO_GRAVACAO',
      mensagem: permMsg
        ? 'Permissão negada para gravar o arquivo GPX na pasta selecionada.'
        : `Não foi possível gravar o arquivo GPX na pasta selecionada: ${err.message}`,
    };
  }
}
