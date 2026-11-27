/**
 * planejamento/xlsxCodec.js
 * ---------------------------------------------------------------------------
 * Leitor e gerador puro-JS de planilhas Excel (.xlsx / OOXML) compatível com
 * Node.js, navegador e React Native (Hermes), utilizando `fflate` (MIT).
 *
 * Recursos suportados na leitura:
 *  - Arquivos .xlsx comprimidos com DEFLATE ou STORE;
 *  - Múltiplas abas (`xl/workbook.xml` + `xl/_rels/workbook.xml.rels`);
 *  - `xl/sharedStrings.xml` (textos simples `<t>` e rich-text `<r><t>`);
 *  - Inline strings (`t="inlineStr"`), strings calculadas (`t="str"`),
 *    booleanos (`t="b"`), erros (`t="e"`), números e datas seriais Excel;
 *  - Referências esparsas (`A1`, `C12`, `AA4`, etc.) e cabeçalhos após
 *    linhas em branco iniciais.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from './vendor/fflate.mjs';
import { formatarDataIsoDia } from './modeloVisitas.js';

function normalizarBytes(entrada) {
  if (!entrada) return null;
  if (entrada instanceof Uint8Array) return entrada;
  if (entrada instanceof ArrayBuffer) return new Uint8Array(entrada);
  if (ArrayBuffer.isView(entrada)) {
    return new Uint8Array(entrada.buffer, entrada.byteOffset, entrada.byteLength);
  }
  return null;
}

function decodificarEntidadesXml(texto) {
  if (!texto) return '';
  return String(texto).replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
    (_, ent) => {
      if (ent === 'amp') return '&';
      if (ent === 'lt') return '<';
      if (ent === 'gt') return '>';
      if (ent === 'quot') return '"';
      if (ent === 'apos') return "'";
      if (ent.startsWith('#x') || ent.startsWith('#X')) {
        const cp = Number.parseInt(ent.slice(2), 16);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
      }
      if (ent.startsWith('#')) {
        const cp = Number.parseInt(ent.slice(1), 10);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
      }
      return '';
    },
  );
}

function escaparXml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseAtributos(tagAttrs) {
  const out = {};
  if (!tagAttrs) return out;
  const rx = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = rx.exec(tagAttrs)) !== null) {
    out[m[1]] = decodificarEntidadesXml(m[2] ?? m[3] ?? '');
  }
  return out;
}

function colunaParaIndice(letras) {
  let idx = 0;
  const s = String(letras || '').toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      idx = idx * 26 + (code - 64);
    }
  }
  return idx > 0 ? idx - 1 : 0;
}

function indiceParaColuna(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function buscarArquivoZip(arquivos, alvo) {
  const normAlvo = String(alvo || '').replace(/^\/+/, '').replace(/\\/g, '/');
  if (arquivos[normAlvo]) return arquivos[normAlvo];
  const lower = normAlvo.toLowerCase();
  for (const chave of Object.keys(arquivos)) {
    if (chave.toLowerCase() === lower) return arquivos[chave];
  }
  return null;
}

function resolverCaminhoRelativo(baseDir, target) {
  const t = String(target || '').replace(/\\/g, '/');
  if (t.startsWith('/')) return t.slice(1);
  const base = baseDir ? `${baseDir.replace(/\/+$/, '')}/` : '';
  const partes = `${base}${t}`.split('/');
  const stack = [];
  for (const p of partes) {
    if (!p || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

function extrairSharedStrings(xml) {
  if (!xml) return [];
  const lista = [];
  const siRx = /<(?:[A-Za-z0-9_]+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?si>/g;
  let m;
  while ((m = siRx.exec(xml)) !== null) {
    const bloco = m[1];
    const partes = [];
    const tRx = /<(?:[A-Za-z0-9_]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/g;
    let tm;
    while ((tm = tRx.exec(bloco)) !== null) {
      partes.push(decodificarEntidadesXml(tm[1]));
    }
    lista.push(partes.join(''));
  }
  return lista;
}

function ehNumFmtData(numFmtId, customCode) {
  const id = Number(numFmtId);
  if (
    (id >= 14 && id <= 22) ||
    (id >= 27 && id <= 36) ||
    (id >= 45 && id <= 47) ||
    (id >= 50 && id <= 58)
  ) {
    return true;
  }
  if (!customCode) return false;
  const limpo = String(customCode)
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .toLowerCase();
  return /(yy|dd|mm)/.test(limpo) && !/(red|green|blue|black)/.test(limpo);
}

function extrairEstilosData(xml) {
  const dateStyleIndexes = new Set();
  if (!xml) return dateStyleIndexes;
  const customFmts = new Map();
  const numFmtRx = /<(?:[A-Za-z0-9_]+:)?numFmt\s+([^/>]+)\/?\s*>/g;
  let nm;
  while ((nm = numFmtRx.exec(xml)) !== null) {
    const attrs = parseAtributos(nm[1]);
    if (attrs.numFmtId != null) {
      customFmts.set(Number(attrs.numFmtId), attrs.formatCode || '');
    }
  }
  const cellXfsMatch = xml.match(
    /<(?:[A-Za-z0-9_]+:)?cellXfs(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?cellXfs>/,
  );
  if (!cellXfsMatch) return dateStyleIndexes;
  const xfRx = /<(?:[A-Za-z0-9_]+:)?xf\s+([^/>]+?)(?:\/>|>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?xf>)/g;
  let idx = 0;
  let xm;
  while ((xm = xfRx.exec(cellXfsMatch[1])) !== null) {
    const attrs = parseAtributos(xm[1]);
    const numFmtId = Number(attrs.numFmtId);
    const applyNumFmt = attrs.applyNumberFormat !== '0';
    if (applyNumFmt && ehNumFmtData(numFmtId, customFmts.get(numFmtId))) {
      dateStyleIndexes.add(idx);
    }
    idx++;
  }
  return dateStyleIndexes;
}

function parsePlanilhaXml(xml, sharedStrings, dateStyleIndexes) {
  const matriz = [];
  const rowRx = /<(?:[A-Za-z0-9_]+:)?row\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?row>/g;
  let rm;
  let linhaSeq = 0;
  while ((rm = rowRx.exec(xml)) !== null) {
    const rowAttrs = parseAtributos(rm[1]);
    const rowIdx = rowAttrs.r ? Math.max(0, Number(rowAttrs.r) - 1) : linhaSeq;
    linhaSeq = rowIdx + 1;
    const linha = [];

    const cellRx =
      /<(?:[A-Za-z0-9_]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?c>)/g;
    let cm;
    let colSeq = 0;
    while ((cm = cellRx.exec(rm[2])) !== null) {
      const attrs = parseAtributos(cm[1]);
      let colIdx = colSeq;
      if (attrs.r) {
        const refM = attrs.r.match(/^([A-Za-z]+)(\d+)$/);
        if (refM) colIdx = colunaParaIndice(refM[1]);
      }
      colSeq = colIdx + 1;
      const corpo = cm[2] || '';
      const tipo = attrs.t || '';
      let valor = '';

      if (tipo === 'inlineStr') {
        const partes = [];
        const tRx = /<(?:[A-Za-z0-9_]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/g;
        let tm;
        while ((tm = tRx.exec(corpo)) !== null) {
          partes.push(decodificarEntidadesXml(tm[1]));
        }
        valor = partes.join('');
      } else {
        const vMatch = corpo.match(
          /<(?:[A-Za-z0-9_]+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?v>/,
        );
        const bruto = vMatch ? decodificarEntidadesXml(vMatch[1]) : '';
        if (tipo === 's') {
          const sIdx = Number.parseInt(bruto, 10);
          valor = Number.isFinite(sIdx) && sIdx >= 0 && sIdx < sharedStrings.length
            ? sharedStrings[sIdx]
            : '';
        } else if (tipo === 'b') {
          valor = bruto === '1' || bruto.toLowerCase() === 'true' ? 'SIM' : 'NAO';
        } else if (tipo === 'str' || tipo === 'e') {
          valor = bruto;
        } else if (bruto !== '') {
          const styleIdx = attrs.s != null ? Number(attrs.s) : -1;
          const num = Number(bruto);
          if (
            Number.isFinite(num) &&
            dateStyleIndexes.has(styleIdx) &&
            num > 20000 &&
            num < 90000
          ) {
            const utcMs = Math.round((num - 25569) * 86400 * 1000);
            valor = formatarDataIsoDia(new Date(utcMs)) || bruto;
          } else {
            valor = Number.isFinite(num) ? num : bruto;
          }
        }
      }

      if (valor !== '' && valor != null) {
        linha[colIdx] = typeof valor === 'string' ? valor.trim() : valor;
      }
    }

    if (linha.some((c) => c !== undefined && c !== null && String(c).trim() !== '')) {
      matriz.push({ rowNumber: rowIdx + 1, cells: linha });
    }
  }
  return matriz;
}

export function parseXlsxBuffer(input) {
  const bytes = normalizarBytes(input);
  if (!bytes || bytes.length < 30) {
    return {
      ok: false,
      reason: 'ARQUIVO_VAZIO',
      message: 'O arquivo selecionado está vazio ou incompleto.',
    };
  }

  // Detecta formato legado .xls (Compound File Binary) para informar erro claro
  if (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    return {
      ok: false,
      reason: 'FORMATO_XLS_LEGADO',
      message:
        'O arquivo está no formato antigo .xls. Salve ou exporte a planilha como .xlsx (Excel moderno) antes de importar.',
    };
  }

  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return {
      ok: false,
      reason: 'ARQUIVO_NAO_XLSX',
      message:
        'O arquivo selecionado não é uma planilha .xlsx válida (assinatura ZIP ausente).',
    };
  }

  let arquivos;
  try {
    arquivos = unzipSync(bytes);
  } catch (err) {
    return {
      ok: false,
      reason: 'XLSX_CORROMPIDO',
      message: `Não foi possível ler o arquivo .xlsx: ${err?.message || 'arquivo corrompido'}.`,
    };
  }

  const workbookBytes = buscarArquivoZip(arquivos, 'xl/workbook.xml');
  if (!workbookBytes) {
    return {
      ok: false,
      reason: 'WORKBOOK_AUSENTE',
      message:
        'Este arquivo ZIP não contém uma estrutura Excel válida (xl/workbook.xml ausente).',
    };
  }

  const workbookXml = strFromU8(workbookBytes);
  const relsBytes = buscarArquivoZip(arquivos, 'xl/_rels/workbook.xml.rels');
  const relsXml = relsBytes ? strFromU8(relsBytes) : '';
  const sharedBytes = buscarArquivoZip(arquivos, 'xl/sharedStrings.xml');
  const sharedStrings = sharedBytes ? extrairSharedStrings(strFromU8(sharedBytes)) : [];
  const stylesBytes = buscarArquivoZip(arquivos, 'xl/styles.xml');
  const dateStyleIndexes = stylesBytes
    ? extrairEstilosData(strFromU8(stylesBytes))
    : new Set();

  const relMap = new Map();
  const relRx = /<(?:[A-Za-z0-9_]+:)?Relationship\s+([^/>]+)\/?\s*>/g;
  let rlm;
  while ((rlm = relRx.exec(relsXml)) !== null) {
    const attrs = parseAtributos(rlm[1]);
    if (attrs.Id && attrs.Target) {
      relMap.set(attrs.Id, resolverCaminhoRelativo('xl', attrs.Target));
    }
  }

  const sheetDefs = [];
  const sheetRx = /<(?:[A-Za-z0-9_]+:)?sheet\s+([^/>]+)\/?\s*>/g;
  let sm;
  let seq = 1;
  while ((sm = sheetRx.exec(workbookXml)) !== null) {
    const attrs = parseAtributos(sm[1]);
    const rId = attrs['r:id'] || attrs.id;
    const caminho = (rId && relMap.get(rId)) || `xl/worksheets/sheet${seq}.xml`;
    sheetDefs.push({
      name: attrs.name || `Planilha ${seq}`,
      path: caminho,
    });
    seq++;
  }

  if (!sheetDefs.length) {
    return {
      ok: false,
      reason: 'SEM_ABAS',
      message: 'Nenhuma aba encontrada na planilha .xlsx.',
    };
  }

  const sheets = [];
  for (const def of sheetDefs) {
    const sheetBytes = buscarArquivoZip(arquivos, def.path);
    if (!sheetBytes) continue;
    const matriz = parsePlanilhaXml(
      strFromU8(sheetBytes),
      sharedStrings,
      dateStyleIndexes,
    );
    if (!matriz.length) {
      sheets.push({ name: def.name, headers: [], rows: [], totalRows: 0 });
      continue;
    }

    const headerRow = matriz[0];
    const maxCols = Math.max(
      headerRow.cells.length,
      ...matriz.slice(1).map((r) => r.cells.length),
    );
    const headers = [];
    for (let c = 0; c < maxCols; c++) {
      const h = headerRow.cells[c];
      headers.push(h != null && String(h).trim() !== '' ? String(h).trim() : `col_${c + 1}`);
    }

    const rows = [];
    for (let r = 1; r < matriz.length; r++) {
      const entrada = matriz[r];
      const obj = {};
      let temValor = false;
      for (let c = 0; c < headers.length; c++) {
        const val = entrada.cells[c];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          temValor = true;
          obj[headers[c]] = val;
        }
      }
      if (temValor) {
        rows.push({ rowNumber: entrada.rowNumber, values: obj });
      }
    }

    sheets.push({
      name: def.name,
      headers,
      rows,
      totalRows: rows.length,
    });
  }

  if (!sheets.length) {
    return {
      ok: false,
      reason: 'PLANILHA_VAZIA',
      message: 'A planilha .xlsx não possui conteúdo legível.',
    };
  }

  return { ok: true, sheets };
}

function gerarSheetXml(linhas) {
  const rowsXml = linhas
    .map((cells, rIdx) => {
      const rowNum = rIdx + 1;
      const cellsXml = cells
        .map((val, cIdx) => {
          if (val === undefined || val === null || val === '') return '';
          const ref = `${indiceParaColuna(cIdx)}${rowNum}`;
          if (typeof val === 'number' && Number.isFinite(val)) {
            return `<c r="${ref}"><v>${val}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(val)}</t></is></c>`;
        })
        .filter(Boolean)
        .join('');
      return `<row r="${rowNum}">${cellsXml}</row>`;
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowsXml}</sheetData>` +
    '</worksheet>'
  );
}

/**
 * Gera uma planilha .xlsx de modelo pronta para preenchimento pelo ACS,
 * sem inventar dados reais de pacientes.
 */
export function gerarModeloXlsxBuffer() {
  const cabecalho = [
    'id_paciente',
    'nome_paciente',
    'endereco_digital',
    'latitude',
    'longitude',
    'endereco',
    'microarea',
    'data_prevista',
    'ultima_visita',
    'prioridade',
    'planejada',
    'status_visita',
    'observacoes',
  ];

  const abaCronograma = [cabecalho];
  const abaInstrucoes = [
    ['Coluna', 'Obrigatória?', 'Formato / Descrição', 'Exemplo fictício (não importar como paciente real)'],
    ['id_paciente', 'Recomendada', 'Código ou prontuário do paciente para evitar duplicidades', 'EXEMPLO-SUBSTITUIR'],
    ['nome_paciente', 'Sim', 'Nome de identificação da pessoa/domicílio', 'Paciente Exemplo (Substituir)'],
    ['endereco_digital', 'Sim (ou lat/lon)', 'Plus Code / CEP Digital de Santo André (ex.: 8FP9+J6 ou 588M8FP9+J6)', '8FP9+J6'],
    ['latitude / longitude', 'Opcional se houver Plus Code', 'Coordenadas decimais WGS84 (ex.: -23.6639 e -46.5318)', '-23.6639 / -46.5318'],
    ['endereco', 'Opcional', 'Logradouro, número e referência visual para o ACS', 'Rua de Exemplo, 100'],
    ['microarea', 'Opcional', 'Microárea ou equipe de referência', 'MA-01'],
    ['data_prevista', 'Opcional', 'Data planejada da visita (DD/MM/AAAA ou AAAA-MM-DD)', '25/11/2026'],
    ['ultima_visita', 'Opcional', 'Data da última visita realizada (para medir dias sem visita)', '10/10/2026'],
    ['prioridade', 'Opcional', 'Prioridade do cronograma: alta, media ou baixa', 'alta'],
    ['planejada', 'Opcional', 'SIM para visita do cronograma; NAO para base territorial próxima (sugestões oportunísticas)', 'SIM'],
    ['status_visita', 'Opcional', 'planejada, realizada ou nao_realizada', 'planejada'],
    ['observacoes', 'Opcional', 'Observações livres da agenda (sem regras clínicas automáticas)', 'Horário preferencial manhã'],
  ];

  const arquivos = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' +
        '<sheet name="Cronograma" sheetId="1" r:id="rId1"/>' +
        '<sheet name="Instrucoes" sheetId="2" r:id="rId2"/>' +
        '</sheets>' +
        '</workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
        '</Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(gerarSheetXml(abaCronograma)),
    'xl/worksheets/sheet2.xml': strToU8(gerarSheetXml(abaInstrucoes)),
  };

  return zipSync(arquivos);
}

export function gerarModeloPlanilhaVisitasXlsx() {
  return gerarModeloXlsxBuffer();
}

