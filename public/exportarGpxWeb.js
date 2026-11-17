import { gerarGpxRota, nomeArquivoGpx } from './gpx.js';

function erroCancelado(err) {
  return err?.name === 'AbortError' || /abort|cancel/i.test(err?.message || '');
}

function erroPermissao(err) {
  return err?.name === 'NotAllowedError' || /permiss|denied/i.test(err?.message || '');
}

function downloadBlob(gpxXml, nomeArquivo, env) {
  const doc = env.document;
  const BlobCtor = env.Blob;
  const UrlApi = env.URL;
  if (!doc || !BlobCtor || !UrlApi?.createObjectURL) {
    throw new Error('O navegador não disponibilizou API de salvamento nem de download de arquivo.');
  }
  const blob = new BlobCtor([gpxXml], { type: 'application/gpx+xml;charset=utf-8' });
  const url = UrlApi.createObjectURL(blob);
  try {
    const link = doc.createElement('a');
    link.href = url;
    link.download = nomeArquivo;
    link.style.display = 'none';
    doc.body?.appendChild?.(link);
    link.click();
    link.remove?.();
  } finally {
    setTimeout(() => UrlApi.revokeObjectURL?.(url), 1000);
  }
  return {
    ok: true,
    modo: 'download',
    arquivo: nomeArquivo,
    mensagem: `Este navegador não permite escolher a pasta diretamente; arquivo GPX enviado para download (${nomeArquivo}).`,
  };
}

async function gravarHandle(fileHandle, gpxXml) {
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(gpxXml);
    await writable.close();
  } catch (err) {
    try {
      await writable.abort?.();
    } catch {
      /* ignora erro ao abortar escrita */
    }
    throw err;
  }
}

/**
 * Exporta a rota calculada em GPX 1.1 permitindo escolher a pasta de destino
 * (via File System Access API quando suportada, com fallback seguro e explícito).
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

  // 1) Escolha explícita de pasta via showDirectoryPicker (Chrome/Edge/Chromium)
  if (typeof env.showDirectoryPicker === 'function') {
    let dirHandle;
    try {
      dirHandle = await env.showDirectoryPicker({
        id: 'siga-rotas-gpx',
        mode: 'readwrite',
      });
    } catch (err) {
      if (erroCancelado(err)) {
        return {
          ok: false,
          cancelado: true,
          motivo: 'CANCELADO',
          mensagem: 'Exportação GPX cancelada pelo usuário.',
        };
      }
      if (erroPermissao(err)) {
        return {
          ok: false,
          motivo: 'PERMISSAO_NEGADA',
          mensagem: 'Permissão negada para acessar a pasta selecionada.',
        };
      }
      // SecurityError em contexto restrito (ex.: iframe/HTTP sem HTTPS): segue
      // para showSaveFilePicker ou download padrão, sem simular salvamento em pasta.
      dirHandle = null;
    }

    if (dirHandle) {
      try {
        if (typeof dirHandle.queryPermission === 'function') {
          let estado = await dirHandle.queryPermission({ mode: 'readwrite' });
          if (estado !== 'granted' && typeof dirHandle.requestPermission === 'function') {
            estado = await dirHandle.requestPermission({ mode: 'readwrite' });
          }
          if (estado && estado !== 'granted') {
            return {
              ok: false,
              motivo: 'PERMISSAO_NEGADA',
              mensagem: 'Permissão de escrita negada para a pasta escolhida.',
            };
          }
        }
        const fileHandle = await dirHandle.getFileHandle(nomeArquivo, { create: true });
        await gravarHandle(fileHandle, gpxXml);
        const pasta = dirHandle.name || 'pasta selecionada';
        return {
          ok: true,
          modo: 'diretorio',
          pasta,
          arquivo: nomeArquivo,
          mensagem: `GPX salvo na pasta "${pasta}" como ${nomeArquivo}.`,
        };
      } catch (err) {
        if (erroPermissao(err)) {
          return {
            ok: false,
            motivo: 'PERMISSAO_NEGADA',
            mensagem: 'Permissão negada ao gravar o arquivo GPX na pasta escolhida.',
          };
        }
        return {
          ok: false,
          motivo: 'ERRO_GRAVACAO',
          mensagem: `Não foi possível gravar o arquivo GPX na pasta escolhida: ${err.message}`,
        };
      }
    }
  }

  // 2) Diálogo nativo de salvamento (permite escolher pasta e arquivo)
  if (typeof env.showSaveFilePicker === 'function') {
    try {
      const fileHandle = await env.showSaveFilePicker({
        suggestedName: nomeArquivo,
        types: [{ description: 'Arquivo GPX (GPS Exchange Format)', accept: { 'application/gpx+xml': ['.gpx'] } }],
      });
      await gravarHandle(fileHandle, gpxXml);
      const nomeSalvo = fileHandle.name || nomeArquivo;
      return {
        ok: true,
        modo: 'arquivo',
        arquivo: nomeSalvo,
        mensagem: `GPX salvo como ${nomeSalvo}.`,
      };
    } catch (err) {
      if (erroCancelado(err)) {
        return {
          ok: false,
          cancelado: true,
          motivo: 'CANCELADO',
          mensagem: 'Exportação GPX cancelada pelo usuário.',
        };
      }
      if (erroPermissao(err)) {
        return {
          ok: false,
          motivo: 'PERMISSAO_NEGADA',
          mensagem: 'Permissão negada para salvar o arquivo GPX.',
        };
      }
      if (err?.name !== 'SecurityError') {
        return {
          ok: false,
          motivo: 'ERRO_GRAVACAO',
          mensagem: `Não foi possível salvar o arquivo GPX: ${err.message}`,
        };
      }
    }
  }

  // 3) Fallback seguro quando seleção de pasta/arquivo não é suportada pelo navegador
  try {
    return downloadBlob(gpxXml, nomeArquivo, env);
  } catch (err) {
    return {
      ok: false,
      motivo: 'INDISPONIVEL',
      mensagem: err.message || 'Não foi possível exportar o arquivo GPX neste navegador.',
    };
  }
}
