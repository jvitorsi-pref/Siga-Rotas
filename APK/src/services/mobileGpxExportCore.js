import { prepararPacoteExportacaoGpx } from '../utils/gpx.js';
import { bytesParaBase64 } from '../utils/zip.js';

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
 * Núcleo testável da exportação GPX 1.1 / ZIP via Android Storage Access Framework (SAF).
 * Recebe `opcoes.fileSystem` (expo-file-system no app nativo; mock em testes).
 */
export async function exportarRotaGpxMobileCore(route, opcoes = {}) {
  const fs = opcoes.fileSystem;
  const saf = fs?.StorageAccessFramework;

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
  const ehZip = pacote.tipoArquivo === 'zip';
  const mimePrincipal = ehZip ? 'application/zip' : 'application/gpx+xml';

  try {
    try {
      fileUri = await saf.createFileAsync(perm.directoryUri, pacote.nomeArquivo, mimePrincipal);
    } catch {
      // Alguns provedores SAF Android rejeitam MIME customizado e aceitam octet-stream mantendo a extensão.
      fileUri = await saf.createFileAsync(
        perm.directoryUri,
        pacote.nomeArquivo,
        'application/octet-stream',
      );
    }

    if (ehZip) {
      const base64 = bytesParaBase64(pacote.zipBytes);
      const encoding = fs.EncodingType?.Base64 ?? 'base64';
      await fs.writeAsStringAsync(fileUri, base64, { encoding });
    } else {
      const encoding = fs.EncodingType?.UTF8 ?? 'utf8';
      await fs.writeAsStringAsync(fileUri, pacote.gpxXml, { encoding });
    }

    const pasta = descreverPastaSaf(perm.directoryUri);
    const nomesInternos = pacote.arquivos.map((a) => a.nome);
    const mensagem = ehZip
      ? `Pacote ${pacote.nomeArquivo} salvo em "${pasta}" (${nomesInternos.join(' e ')}).`
      : `GPX salvo em "${pasta}" como ${pacote.nomeArquivo}.`;

    return {
      ok: true,
      modo: 'saf',
      cenario: pacote.cenario,
      tipoArquivo: pacote.tipoArquivo,
      pasta,
      arquivo: pacote.nomeArquivo,
      arquivosInternos: nomesInternos,
      fileUri,
      mensagem,
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
        ? 'Permissão negada para gravar o arquivo na pasta selecionada.'
        : `Não foi possível gravar o arquivo na pasta selecionada: ${err.message}`,
    };
  }
}
