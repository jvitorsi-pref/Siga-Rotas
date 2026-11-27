/**
 * planejamento/importadorExcel.js
 * ---------------------------------------------------------------------------
 * Importação flexível de cronogramas e cadastro territorial de visitas ACS
 * a partir de planilhas Excel (.xlsx), integrada ao módulo existente de CEP
 * Digital / coordenadas (`core/enderecoDigital.js`).
 */

import {
  CodificarCompleto,
  CodificarCurto,
  CoordenadaNaRegiao,
  ResolverEnderecoDigital,
} from '../core/enderecoDigital.js';
import {
  STATUS_VISITA,
  chaveDeduplicacaoPaciente,
  criarPeriodoPlanejamento,
  criarPlanoVisitasVazio,
  normalizarPrioridadeCronograma,
  normalizarStatusVisita,
  normalizarTextoChave,
  parseDataFlexivel,
} from './modeloVisitas.js';
import { parseXlsxBuffer } from './xlsxCodec.js';

export const DICIONARIO_COLUNAS_PLANILHA = Object.freeze({
  idPaciente: [
    'id_paciente',
    'id',
    'codigo_paciente',
    'prontuario',
    'cns',
    'cartao_sus',
    'codigo',
    'identificador',
    'paciente_id',
  ],
  nome: [
    'nome_paciente',
    'nome',
    'paciente',
    'cidadao',
    'nome_completo',
    'usuario',
  ],
  enderecoDigital: [
    'endereco_digital',
    'cep_digital',
    'plus_code',
    'pluscode',
    'codigo_plus',
    'plus',
  ],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lon', 'lng', 'long'],
  coordenadas: ['coordenadas', 'coord', 'lat_lon', 'posicao'],
  enderecoTexto: [
    'endereco',
    'logradouro',
    'rua',
    'endereco_completo',
    'referencia',
    'ponto_referencia',
  ],
  microarea: ['microarea', 'micro_area', 'equipe', 'area', 'territorio'],
  dataPrevista: [
    'data_prevista',
    'data_visita',
    'data',
    'data_agendada',
    'data_planejada',
    'agenda',
  ],
  ultimaVisitaEm: [
    'ultima_visita',
    'data_ultima_visita',
    'ultimo_atendimento',
    'ultima_data',
  ],
  diasSemVisita: ['dias_sem_visita', 'dias_ultima_visita'],
  prioridadeCronograma: [
    'prioridade',
    'prioridade_cronograma',
    'ordem_prioridade',
    'urgencia_agenda',
  ],
  planejada: [
    'planejada',
    'no_cronograma',
    'cronograma',
    'selecionada',
    'tipo_visita',
  ],
  status: ['status_visita', 'status', 'situacao'],
  observacoes: [
    'observacoes',
    'observacao',
    'notas',
    'obs',
    'acompanhamento',
    'condicao_informada',
    'grupo',
  ],
});

function chaveCabecalho(header) {
  return String(header || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function mapearCabecalhosPlanilha(headers = []) {
  const mapa = {};
  const colunasOriginais = {};
  for (const h of headers) {
    const norm = chaveCabecalho(h);
    if (!norm) continue;
    for (const [campo, aliases] of Object.entries(DICIONARIO_COLUNAS_PLANILHA)) {
      if (mapa[campo]) continue;
      if (aliases.includes(norm)) {
        mapa[campo] = h;
        colunasOriginais[campo] = h;
      }
    }
  }
  return { mapa, colunasOriginais };
}

function parseNumeroCoord(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const txt = String(raw).trim().replace(',', '.');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(txt)) return null;
  const n = Number(txt);
  return Number.isFinite(n) ? n : null;
}

function parseParCoordenadas(raw) {
  if (!raw) return null;
  const parts = String(raw)
    .trim()
    .split(/[;|\s/]+/)
    .map((p) => p.replace(/,$/, ''))
    .filter(Boolean);
  let valores = parts;
  if (parts.length === 1 && String(raw).includes(',')) {
    valores = String(raw).split(',').map((p) => p.trim());
  }
  if (valores.length !== 2) return null;
  const a = parseNumeroCoord(valores[0]);
  const b = parseNumeroCoord(valores[1]);
  if (a == null || b == null) return null;
  if (CoordenadaNaRegiao(a, b)) return { latitude: a, longitude: b };
  if (CoordenadaNaRegiao(b, a)) return { latitude: b, longitude: a };
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { latitude: a, longitude: b };
  return null;
}

function parseBooleanoPlanejada(raw) {
  if (raw == null || String(raw).trim() === '') return true;
  const txt = normalizarTextoChave(raw);
  if (
    txt === 'nao' ||
    txt === 'n' ||
    txt === 'false' ||
    txt === '0' ||
    txt === 'base' ||
    txt === 'cadastro' ||
    txt === 'territorial' ||
    txt === 'opcional' ||
    txt === 'complementar'
  ) {
    return false;
  }
  return true;
}

function resolverLocalizacaoLinha({ enderecoDigitalRaw, latRaw, lonRaw, coordsRaw }) {
  const avisos = [];
  const plusTxt = String(enderecoDigitalRaw || '').trim();
  let lat = parseNumeroCoord(latRaw);
  let lon = parseNumeroCoord(lonRaw);
  if ((lat == null || lon == null) && coordsRaw) {
    const par = parseParCoordenadas(coordsRaw);
    if (par) {
      lat = par.latitude;
      lon = par.longitude;
    }
  }

  let plusRes = null;
  if (plusTxt) {
    plusRes = ResolverEnderecoDigital(plusTxt);
    if (!plusRes.ok) {
      if (lat == null || lon == null) {
        return {
          ok: false,
          erro: plusRes.mensagem || `Endereço Digital inválido ("${plusTxt}").`,
        };
      }
      avisos.push(`Endereço Digital "${plusTxt}" inválido; usadas as coordenadas da linha.`);
    }
  }

  const temCoords = lat != null && lon != null;
  if (temCoords && !CoordenadaNaRegiao(lat, lon)) {
    if (!plusRes?.ok) {
      return {
        ok: false,
        erro: `Coordenadas (${lat}, ${lon}) estão fora do recorte de atendimento em Santo André.`,
      };
    }
    avisos.push('Coordenadas da linha estão fora da área; usado o Endereço Digital válido.');
    lat = null;
    lon = null;
  }

  if (plusRes?.ok) {
    if (temCoords && CoordenadaNaRegiao(lat, lon)) {
      const dLat = Math.abs(lat - plusRes.latitude);
      const dLon = Math.abs(lon - plusRes.longitude);
      if (dLat > 0.005 || dLon > 0.005) {
        avisos.push('Coordenadas e Endereço Digital divergem > 500 m; mantido o Endereço Digital.');
      }
    }
    return {
      ok: true,
      latitude: plusRes.latitude,
      longitude: plusRes.longitude,
      enderecoDigital: plusRes.codigoNormalizado,
      codigoCompleto: plusRes.codigoCompleto,
      origemLocalizacao: 'endereco_digital',
      avisos,
    };
  }

  if (lat != null && lon != null && CoordenadaNaRegiao(lat, lon)) {
    let curto = '';
    let completo = '';
    try {
      curto = CodificarCurto(lat, lon);
      completo = CodificarCompleto(lat, lon);
    } catch {
      curto = '';
      completo = '';
    }
    return {
      ok: true,
      latitude: lat,
      longitude: lon,
      enderecoDigital: curto,
      codigoCompleto: completo,
      origemLocalizacao: 'coordenadas',
      avisos,
    };
  }

  return {
    ok: false,
    erro: 'Informe um Endereço Digital (Plus Code) válido ou latitude/longitude em Santo André.',
  };
}

function escolherAbaPreferida(sheets, sheetName) {
  if (!Array.isArray(sheets) || !sheets.length) return null;
  if (sheetName) {
    const achada = sheets.find(
      (s) => normalizarTextoChave(s.name) === normalizarTextoChave(sheetName),
    );
    if (achada) return achada;
  }
  const porNome = sheets.find(
    (s) =>
      /cronograma|visitas|pacientes|agenda/i.test(s.name) && s.rows.length > 0,
  );
  return porNome || sheets.find((s) => s.rows.length > 0) || sheets[0];
}

/**
 * Lê um arquivo .xlsx, valida colunas/linhas, detecta duplicidades e devolve
 * uma pré-visualização estruturada antes de o ACS confirmar a importação.
 */
export function prepararImportacaoPlanilha({
  buffer = null,
  bytes = null,
  sheetName = null,
  pacientesExistentes = [],
  visitasExistentes = [],
  periodo = null,
  agora = Date.now(),
} = {}) {
  const parsed = parseXlsxBuffer(bytes || buffer);
  if (!parsed.ok) {
    return parsed;
  }

  const aba = escolherAbaPreferida(parsed.sheets, sheetName);
  if (!aba || !aba.headers.length) {
    return {
      ok: false,
      reason: 'ABA_VAZIA',
      message: 'A aba selecionada da planilha está vazia.',
    };
  }

  const { mapa, colunasOriginais } = mapearCabecalhosPlanilha(aba.headers);
  const errosEstruturais = [];
  if (!mapa.nome && !mapa.idPaciente) {
    errosEstruturais.push(
      'Coluna obrigatória ausente: inclua "nome_paciente" (ou "nome") e/ou "id_paciente".',
    );
  }
  if (!mapa.enderecoDigital && !(mapa.latitude && mapa.longitude) && !mapa.coordenadas) {
    errosEstruturais.push(
      'Coluna de localização ausente: inclua "endereco_digital" (Plus Code) ou "latitude" + "longitude".',
    );
  }
  if (errosEstruturais.length) {
    return {
      ok: false,
      reason: 'COLUNAS_OBRIGATORIAS_AUSENTES',
      message: errosEstruturais.join(' '),
      colunasEncontradas: aba.headers,
    };
  }

  if (!aba.rows.length) {
    return {
      ok: false,
      reason: 'SEM_LINHAS_DADOS',
      message: 'A planilha possui cabeçalho, mas não há linhas com dados de pacientes/visitas.',
    };
  }

  const existentesPorChave = new Map();
  for (const p of pacientesExistentes || []) {
    existentesPorChave.set(p.chaveDeduplicacao || chaveDeduplicacaoPaciente(p), p);
  }
  const visitasPorChave = new Map();
  for (const v of visitasExistentes || []) {
    if (v.chaveDeduplicacao) visitasPorChave.set(v.chaveDeduplicacao, v);
  }

  const periodoNorm = criarPeriodoPlanejamento(periodo || {}, agora);
  const vistosNaPlanilha = new Map();
  const itensValidados = [];
  const erros = [];
  const avisos = [];
  let duplicadasNaPlanilha = 0;
  let atualizacoesExistentes = 0;
  let novosPacientes = 0;
  let visitasPlanejadas = 0;
  let baseTerritorial = 0;

  for (const row of aba.rows) {
    const v = row.values || {};
    const idPacRaw = mapa.idPaciente ? String(v[mapa.idPaciente] ?? '').trim() : '';
    const nomeRaw = mapa.nome ? String(v[mapa.nome] ?? '').trim() : '';

    if (
      idPacRaw.toUpperCase() === 'EXEMPLO-SUBSTITUIR' ||
      /paciente exemplo/i.test(nomeRaw)
    ) {
      avisos.push(`Linha ${row.rowNumber}: linha de exemplo ignorada automaticamente.`);
      continue;
    }

    const nome = nomeRaw || (idPacRaw ? `Paciente ${idPacRaw}` : '');
    if (!nome) {
      erros.push({
        rowNumber: row.rowNumber,
        nome: '',
        mensagem: `Linha ${row.rowNumber}: informe o nome ou identificador do paciente.`,
      });
      continue;
    }

    const loc = resolverLocalizacaoLinha({
      enderecoDigitalRaw: mapa.enderecoDigital ? v[mapa.enderecoDigital] : '',
      latRaw: mapa.latitude ? v[mapa.latitude] : null,
      lonRaw: mapa.longitude ? v[mapa.longitude] : null,
      coordsRaw: mapa.coordenadas ? v[mapa.coordenadas] : null,
    });
    if (!loc.ok) {
      erros.push({
        rowNumber: row.rowNumber,
        nome,
        mensagem: `Linha ${row.rowNumber} (${nome}): ${loc.erro}`,
      });
      continue;
    }

    const dataPrevistaRaw = mapa.dataPrevista ? v[mapa.dataPrevista] : null;
    const dataPrevista = parseDataFlexivel(dataPrevistaRaw);
    if (dataPrevistaRaw != null && String(dataPrevistaRaw).trim() !== '' && !dataPrevista) {
      erros.push({
        rowNumber: row.rowNumber,
        nome,
        mensagem: `Linha ${row.rowNumber} (${nome}): data_prevista inválida ("${dataPrevistaRaw}"). Use DD/MM/AAAA ou AAAA-MM-DD.`,
      });
      continue;
    }

    const ultimaVisitaRaw = mapa.ultimaVisitaEm ? v[mapa.ultimaVisitaEm] : null;
    let ultimaVisitaEm = parseDataFlexivel(ultimaVisitaRaw);
    if (ultimaVisitaRaw != null && String(ultimaVisitaRaw).trim() !== '' && !ultimaVisitaEm) {
      avisos.push(
        `Linha ${row.rowNumber} (${nome}): ultima_visita "${ultimaVisitaRaw}" não reconhecida e mantida em aberto.`,
      );
    }
    if (!ultimaVisitaEm && mapa.diasSemVisita && v[mapa.diasSemVisita] != null) {
      const diasNum = Number(String(v[mapa.diasSemVisita]).replace(',', '.'));
      if (Number.isFinite(diasNum) && diasNum >= 0 && diasNum <= 3650) {
        const dt = new Date(agora - Math.round(diasNum) * 86400000);
        ultimaVisitaEm = dt.toISOString().slice(0, 10);
      }
    }

    const planejada = parseBooleanoPlanejada(
      mapa.planejada ? v[mapa.planejada] : null,
      Boolean(dataPrevista),
    );
    const status = normalizarStatusVisita(
      mapa.status ? v[mapa.status] : '',
      { planejada },
    );
    const prioridadeCronograma = normalizarPrioridadeCronograma(
      mapa.prioridadeCronograma ? v[mapa.prioridadeCronograma] : '',
    );

    const pacienteTemp = {
      idPaciente: idPacRaw || null,
      nome,
      enderecoDigital: loc.enderecoDigital,
      codigoCompleto: loc.codigoCompleto,
      latitude: loc.latitude,
      longitude: loc.longitude,
    };
    const chaveDedup = chaveDeduplicacaoPaciente(pacienteTemp);

    if (vistosNaPlanilha.has(chaveDedup)) {
      duplicadasNaPlanilha++;
      const anterior = vistosNaPlanilha.get(chaveDedup);
      avisos.push(
        `Linha ${row.rowNumber} (${nome}): registro duplicado na planilha (mesma chave da linha ${anterior.rowNumber}); mesclado na pré-visualização.`,
      );
      if (planejada && !anterior.planejada) anterior.planejada = true;
      if (dataPrevista && !anterior.dataPrevista) anterior.dataPrevista = dataPrevista;
      if (ultimaVisitaEm && !anterior.ultimaVisitaEm) anterior.ultimaVisitaEm = ultimaVisitaEm;
      continue;
    }

    const jaExiste = existentesPorChave.has(chaveDedup) || visitasPorChave.has(chaveDedup);
    if (jaExiste) atualizacoesExistentes++;
    else novosPacientes++;

    if (planejada) visitasPlanejadas++;
    else baseTerritorial++;

    const item = {
      rowNumber: row.rowNumber,
      chaveDeduplicacao: chaveDedup,
      idPaciente: idPacRaw || null,
      nome,
      enderecoDigital: loc.enderecoDigital,
      codigoCompleto: loc.codigoCompleto,
      latitude: loc.latitude,
      longitude: loc.longitude,
      origemLocalizacao: loc.origemLocalizacao,
      enderecoTexto: mapa.enderecoTexto ? String(v[mapa.enderecoTexto] ?? '').trim() : '',
      microarea: mapa.microarea ? String(v[mapa.microarea] ?? '').trim() : '',
      dataPrevista: dataPrevista || null,
      ultimaVisitaEm: ultimaVisitaEm || null,
      prioridadeCronograma,
      planejada,
      status,
      observacoes: mapa.observacoes ? String(v[mapa.observacoes] ?? '').trim() : '',
      acaoNaConfirmacao: jaExiste ? 'atualizar' : 'criar',
      avisos: loc.avisos,
    };
    vistosNaPlanilha.set(chaveDedup, item);
    itensValidados.push(item);
    for (const av of loc.avisos) {
      avisos.push(`Linha ${row.rowNumber} (${nome}): ${av}`);
    }
  }

  return {
    ok: itensValidados.length > 0,
    reason: itensValidados.length > 0 ? null : 'NENHUMA_LINHA_VALIDA',
    message:
      itensValidados.length > 0
        ? `Pré-visualização pronta: ${itensValidados.length} registro(s) válido(s)${erros.length ? ` e ${erros.length} com erro` : ''}.`
        : 'Nenhuma linha válida encontrada na planilha. Revise os erros apontados.',
    sheetName: aba.name,
    sheetsDisponiveis: parsed.sheets.map((s) => s.name),
    colunasReconhecidas: colunasOriginais,
    periodo: periodoNorm,
    resumo: {
      totalLinhasLidas: aba.rows.length,
      validas: itensValidados.length,
      comErro: erros.length,
      duplicadasNaPlanilha,
      atualizacoesExistentes,
      novosPacientes,
      visitasPlanejadas,
      baseTerritorial,
    },
    itensValidados,
    erros,
    avisos,
  };
}

/**
 * Efetiva a importação previamente validada para o plano de visitas do ACS,
 * evitando duplicidades e preservando histórico de visitas já concluídas.
 */
export function confirmarImportacaoPlanilha(
  preview,
  {
    planoExistente = null,
    substituirCronograma = false,
    periodo = null,
    agora = Date.now(),
  } = {},
) {
  if (!preview || !preview.ok || !Array.isArray(preview.itensValidados) || !preview.itensValidados.length) {
    return {
      ok: false,
      reason: 'PREVIEW_INVALIDO',
      message: 'Nenhuma linha válida para importar.',
    };
  }

  const base = planoExistente
    ? {
        ...planoExistente,
        pacientes: Array.isArray(planoExistente.pacientes)
          ? planoExistente.pacientes.map((p) => ({ ...p }))
          : [],
        visitas: Array.isArray(planoExistente.visitas)
          ? planoExistente.visitas.map((v) => ({ ...v }))
          : [],
      }
    : criarPlanoVisitasVazio(periodo || preview.periodo, agora);

  if (periodo) {
    base.periodo = criarPeriodoPlanejamento(periodo, agora);
  } else if (preview.periodo) {
    base.periodo = criarPeriodoPlanejamento(preview.periodo, agora);
  }

  const agoraIso = new Date(agora).toISOString();
  const pacientesMap = new Map(
    (substituirCronograma ? [] : base.pacientes).map((p) => [
      p.chaveDeduplicacao || chaveDeduplicacaoPaciente(p),
      p,
    ]),
  );
  const visitasMap = new Map(
    (substituirCronograma ? [] : base.visitas).map((v) => [v.chaveDeduplicacao, v]),
  );

  let criados = 0;
  let atualizados = 0;

  for (let i = 0; i < preview.itensValidados.length; i++) {
    const item = preview.itensValidados[i];
    const chave = item.chaveDeduplicacao;
    const pacAnt = pacientesMap.get(chave);
    const pacienteId = pacAnt?.id || `pac_${chave.replace(/[^a-z0-9]/gi, '_').slice(0, 24)}_${(i + 1).toString(36)}`;

    const pacienteObj = {
      id: pacienteId,
      chaveDeduplicacao: chave,
      idPaciente: item.idPaciente || pacAnt?.idPaciente || null,
      nome: item.nome,
      enderecoDigital: item.enderecoDigital || pacAnt?.enderecoDigital || '',
      codigoCompleto: item.codigoCompleto || pacAnt?.codigoCompleto || '',
      latitude: item.latitude,
      longitude: item.longitude,
      enderecoTexto: item.enderecoTexto || pacAnt?.enderecoTexto || '',
      microarea: item.microarea || pacAnt?.microarea || '',
      ultimaVisitaEm: item.ultimaVisitaEm || pacAnt?.ultimaVisitaEm || null,
      observacoes: item.observacoes || pacAnt?.observacoes || '',
      atualizadoEm: agoraIso,
    };
    pacientesMap.set(chave, pacienteObj);

    const visAnt = visitasMap.get(chave);
    const preservarConcluida =
      !substituirCronograma &&
      visAnt &&
      (visAnt.status === STATUS_VISITA.REALIZADA || visAnt.status === STATUS_VISITA.NAO_REALIZADA) &&
      item.status === STATUS_VISITA.PLANEJADA;

    const visitaObj = {
      id: visAnt?.id || `vis_${agora.toString(36)}_${(i + 1).toString(36)}`,
      pacienteId,
      chaveDeduplicacao: chave,
      idPaciente: pacienteObj.idPaciente,
      nome: pacienteObj.nome,
      enderecoDigital: pacienteObj.enderecoDigital,
      codigoCompleto: pacienteObj.codigoCompleto,
      latitude: pacienteObj.latitude,
      longitude: pacienteObj.longitude,
      enderecoTexto: pacienteObj.enderecoTexto,
      microarea: pacienteObj.microarea,
      dataPrevista: item.dataPrevista ?? visAnt?.dataPrevista ?? null,
      ultimaVisitaEm: pacienteObj.ultimaVisitaEm,
      prioridadeCronograma: item.prioridadeCronograma,
      planejada: item.planejada,
      status: preservarConcluida ? visAnt.status : item.status,
      observacoes: item.observacoes || visAnt?.observacoes || '',
      origem: visAnt?.origem || 'excel',
      atualizadoEm: agoraIso,
      concluidaEm: preservarConcluida ? visAnt.concluidaEm : null,
    };
    visitasMap.set(chave, visitaObj);

    if (visAnt) atualizados++;
    else criados++;
  }

  base.pacientes = Array.from(pacientesMap.values());
  base.visitas = Array.from(visitasMap.values());
  base.atualizadoEm = agoraIso;
  base.ultimaImportacao = {
    importadoEm: agoraIso,
    arquivoAba: preview.sheetName,
    criados,
    atualizados,
    errosIgnorados: preview.resumo?.comErro || 0,
  };

  return {
    ok: true,
    plano: base,
    criados,
    atualizados,
    totalPacientes: base.pacientes.length,
    totalVisitas: base.visitas.length,
  };
}

export function importarPlanilhaVisitas(bytes, opcoes = {}) {
  const prep = prepararImportacaoPlanilha({
    bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []),
    ...opcoes,
  });
  const itens = Array.isArray(prep.itensValidados) ? prep.itensValidados : [];
  const rotuloPrio = (p) => (p === 'alta' ? 'Alta' : p === 'baixa' ? 'Baixa' : 'Média');
  const registros = itens.map((item, idx) => ({
    ...item,
    id: item.idPaciente || item.chaveDeduplicacao || `pac-${idx + 1}`,
    prioridadeLabel: rotuloPrio(item.prioridadeCronograma),
    frequenciaAlvo: item.planejada ? 'No cronograma' : 'Base territorial',
    condicao: item.observacoes || '',
  }));
  const avisos = Array.isArray(prep.avisos)
    ? prep.avisos.map((a) => (typeof a === 'string' ? { linha: '-', mensagem: a } : { linha: a.linha ?? '-', mensagem: a.mensagem || String(a) }))
    : [];
  const erros = Array.isArray(prep.erros)
    ? prep.erros.map((e) => (typeof e === 'string' ? { linha: '-', mensagem: e } : { linha: e.linha ?? '-', mensagem: e.mensagem || String(e) }))
    : [];
  if (!prep.ok && prep.message && erros.length === 0) {
    erros.push({ linha: 1, mensagem: prep.message });
  }
  const dupCount = Number(prep.resumo?.duplicadasNaPlanilha || 0);
  const duplicadosIgnorados = avisos.filter((a) => /duplicad/i.test(a.mensagem));
  while (duplicadosIgnorados.length < dupCount) {
    duplicadosIgnorados.push({ linha: '-', mensagem: 'Linha duplicada ignorada.' });
  }
  return {
    ...prep,
    arquivo: opcoes.origemArquivo || prep.sheetName || 'planilha.xlsx',
    registros,
    duplicadosIgnorados,
    erros,
    avisos,
  };
}

