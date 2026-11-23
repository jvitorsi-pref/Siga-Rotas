/**
 * public/zip.js
 * ---------------------------------------------------------------------------
 * Gerador puro e isomórfico de arquivos ZIP (PKWARE STORE + CRC-32 IEEE 802.3).
 * Sem dependências externas: funciona no navegador, no React Native (Hermes) e
 * no Node.js para empacotar `rota_calculada.gpx` e `rota_percorrida.gpx` em
 * `exportacao_rotas.zip`.
 */

const CRC32_TABELA = (() => {
  const tabela = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tabela[i] = c >>> 0;
  }
  return tabela;
})();

const BASE64_ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function codificarUtf8(texto) {
  const str = String(texto ?? '');
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
        out.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
      } else {
        out.push(0xef, 0xbf, 0xbd);
      }
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

export function decodificarUtf8(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(arr);
  }
  let out = '';
  for (let i = 0; i < arr.length;) {
    const b0 = arr[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0 && i + 1 < arr.length) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (arr[i + 1] & 0x3f));
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0 && i + 2 < arr.length) {
      out += String.fromCharCode(
        ((b0 & 0x0f) << 12) | ((arr[i + 1] & 0x3f) << 6) | (arr[i + 2] & 0x3f),
      );
      i += 3;
    } else if ((b0 & 0xf8) === 0xf0 && i + 3 < arr.length) {
      const cp =
        ((b0 & 0x07) << 18) |
        ((arr[i + 1] & 0x3f) << 12) |
        ((arr[i + 2] & 0x3f) << 6) |
        (arr[i + 3] & 0x3f);
      const u = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
      i += 4;
    } else {
      out += '\ufffd';
      i += 1;
    }
  }
  return out;
}

export function calcularCrc32(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let crc = 0xffffffff;
  for (let i = 0; i < arr.length; i += 1) {
    crc = CRC32_TABELA[(crc ^ arr[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function bytesParaBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let out = '';
  for (let i = 0; i < arr.length; i += 3) {
    const b0 = arr[i];
    const hasB1 = i + 1 < arr.length;
    const hasB2 = i + 2 < arr.length;
    const b1 = hasB1 ? arr[i + 1] : 0;
    const b2 = hasB2 ? arr[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_ALFABETO[(triplet >> 18) & 0x3f];
    out += BASE64_ALFABETO[(triplet >> 12) & 0x3f];
    out += hasB1 ? BASE64_ALFABETO[(triplet >> 6) & 0x3f] : '=';
    out += hasB2 ? BASE64_ALFABETO[triplet & 0x3f] : '=';
  }
  return out;
}

function dosDataHora(data) {
  const d = data instanceof Date && !Number.isNaN(data.getTime()) ? data : new Date();
  const ano = Math.max(1980, d.getFullYear());
  const dosTime = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  const dosDate = (((ano - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function sanitizarNomeEntradaZip(nome) {
  const limpo = String(nome ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!limpo || limpo.includes('..') || limpo.endsWith('/')) {
    throw new Error(`Nome de arquivo inválido para o pacote ZIP: "${nome}".`);
  }
  return limpo;
}

/**
 * Empacota uma lista de entradas `{ nome, conteudo }` em um `Uint8Array` ZIP válido.
 */
export function criarZip(entradas, opcoes = {}) {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new Error('Falha ao gerar arquivo ZIP: nenhuma entrada informada.');
  }

  const { dosTime, dosDate } = dosDataHora(opcoes.agora);
  const nomesUsados = new Set();
  const itensPreparados = entradas.map((entrada) => {
    if (!entrada || typeof entrada !== 'object') {
      throw new Error('Falha ao gerar arquivo ZIP: entrada inválida.');
    }
    const nome = sanitizarNomeEntradaZip(entrada.nome);
    if (nomesUsados.has(nome)) {
      throw new Error(`Falha ao gerar arquivo ZIP: arquivo duplicado "${nome}".`);
    }
    nomesUsados.add(nome);

    const dados =
      entrada.conteudo instanceof Uint8Array
        ? entrada.conteudo
        : typeof entrada.conteudo === 'string'
          ? codificarUtf8(entrada.conteudo)
          : null;

    if (!dados || dados.byteLength === 0) {
      throw new Error(`Falha ao gerar arquivo ZIP: o arquivo "${nome}" está vazio.`);
    }

    const nomeBytes = codificarUtf8(nome);
    const crc = calcularCrc32(dados);
    return { nome, nomeBytes, dados, crc };
  });

  let tamanhoLocais = 0;
  let tamanhoCentral = 0;
  for (const item of itensPreparados) {
    tamanhoLocais += 30 + item.nomeBytes.length + item.dados.length;
    tamanhoCentral += 46 + item.nomeBytes.length;
  }

  const tamanhoTotal = tamanhoLocais + tamanhoCentral + 22;
  const buffer = new ArrayBuffer(tamanhoTotal);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  let offset = 0;
  const offsetsLocais = [];

  for (const item of itensPreparados) {
    offsetsLocais.push(offset);
    // Local file header (PK\x03\x04)
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true); // version needed to extract (2.0)
    view.setUint16(offset + 6, 0x0800, true); // bit 11: UTF-8 filename
    view.setUint16(offset + 8, 0, true); // method 0: STORE
    view.setUint16(offset + 10, dosTime, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, item.crc, true);
    view.setUint32(offset + 18, item.dados.length, true);
    view.setUint32(offset + 22, item.dados.length, true);
    view.setUint16(offset + 26, item.nomeBytes.length, true);
    view.setUint16(offset + 28, 0, true); // extra field length
    bytes.set(item.nomeBytes, offset + 30);
    offset += 30 + item.nomeBytes.length;

    bytes.set(item.dados, offset);
    offset += item.dados.length;
  }

  const centralOffset = offset;
  for (let i = 0; i < itensPreparados.length; i += 1) {
    const item = itensPreparados[i];
    const localOffset = offsetsLocais[i];
    // Central directory file header (PK\x01\x02)
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true); // version made by
    view.setUint16(offset + 6, 20, true); // version needed
    view.setUint16(offset + 8, 0x0800, true); // UTF-8
    view.setUint16(offset + 10, 0, true); // STORE
    view.setUint16(offset + 12, dosTime, true);
    view.setUint16(offset + 14, dosDate, true);
    view.setUint32(offset + 16, item.crc, true);
    view.setUint32(offset + 20, item.dados.length, true);
    view.setUint32(offset + 24, item.dados.length, true);
    view.setUint16(offset + 28, item.nomeBytes.length, true);
    view.setUint16(offset + 30, 0, true); // extra length
    view.setUint16(offset + 32, 0, true); // comment length
    view.setUint16(offset + 34, 0, true); // disk number
    view.setUint16(offset + 36, 0, true); // internal attrs
    view.setUint32(offset + 38, 0, true); // external attrs
    view.setUint32(offset + 42, localOffset, true);
    bytes.set(item.nomeBytes, offset + 46);
    offset += 46 + item.nomeBytes.length;
  }

  const centralSize = offset - centralOffset;
  // End of central directory record (PK\x05\x06)
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true); // disk number
  view.setUint16(offset + 6, 0, true); // central dir disk
  view.setUint16(offset + 8, itensPreparados.length, true);
  view.setUint16(offset + 10, itensPreparados.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralOffset, true);
  view.setUint16(offset + 20, 0, true); // comment length

  return bytes;
}

/**
 * Lê um buffer ZIP gerado com método STORE (0) e valida seus CRC-32,
 * retornando um mapa `{ [nome]: Uint8Array }` (útil para auditoria/testes).
 */
export function lerZipStore(zipBytes) {
  const bytes = zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes || []);
  if (bytes.length < 22) {
    throw new Error('Arquivo ZIP corrompido ou vazio.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Cabeçalho EOCD ausente no arquivo ZIP.');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let ptr = view.getUint32(eocdOffset + 16, true);
  const saida = {};

  for (let i = 0; i < totalEntries; i += 1) {
    if (view.getUint32(ptr, true) !== 0x02014b50) {
      throw new Error('Entrada inválida no diretório central do ZIP.');
    }
    const method = view.getUint16(ptr + 10, true);
    const crcEsperado = view.getUint32(ptr + 16, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const nome = decodificarUtf8(bytes.slice(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (method !== 0) {
      throw new Error(`Método ZIP não suportado (${method}) para ${nome}.`);
    }
    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Cabeçalho local inválido para ${nome}.`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.slice(dataStart, dataStart + compSize);
    if (calcularCrc32(data) !== crcEsperado) {
      throw new Error(`CRC-32 divergente para ${nome}.`);
    }
    saida[nome] = data;
  }

  return saida;
}
