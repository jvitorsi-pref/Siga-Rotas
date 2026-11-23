/**
 * campo/modeloCampo.js — Modelos de domínio offline-first e conversores espaciais
 * -------------------------------------------------------------------------------
 * Módulo isomórfico puro (Node, Browser ESM e React Native Hermes).
 * Define entidades alinhadas ao modelo relacional/espacial Oracle 11g (SRID NULL):
 *   • SIGA_ROTA (`CALCULADA` vs `GPS` com `ID_ROTA_ORIGEM`)
 *   • SIGA_ROTA_OBSERVACAO (obrigatoriamente vinculada a uma rota)
 *   • SIGA_ROTA_EVENTO (histórico de interações)
 *   • Fila de sincronização (`PENDING`, `SYNCING`, `SYNCED`, `ERROR`)
 */

export const SYNC_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SYNCING: 'SYNCING',
  SYNCED: 'SYNCED',
  ERROR: 'ERROR',
});

export const SYNC_UI_LABEL = Object.freeze({
  SALVO_DISPOSITIVO: 'Salvo no dispositivo',
  AGUARDANDO: 'Aguardando sincronização',
  SINCRONIZANDO: 'Sincronizando',
  SINCRONIZADO: 'Sincronizado',
  FALHA: 'Falha na sincronização',
});

export const TIPO_ROTA = Object.freeze({
  CALCULADA: 'CALCULADA',
  GPS: 'GPS',
});

export const STATUS_ROTA = Object.freeze({
  PLANEJADA: 'PLANEJADA',
  SALVA: 'SALVA',
  EM_EXECUCAO: 'EM_EXECUCAO',
  CONCLUIDA: 'CONCLUIDA',
  INTERROMPIDA: 'INTERROMPIDA',
  CANCELADA: 'CANCELADA',
});

export const STATUS_OBSERVACAO = Object.freeze({
  ABERTA: 'ABERTA',
  CONCLUIDA: 'CONCLUIDA',
  REABERTA: 'REABERTA',
});

export const TIPO_EVENTO = Object.freeze({
  CRIACAO: 'CRIACAO',
  EDICAO: 'EDICAO',
  CONCLUSAO: 'CONCLUSAO',
  REABERTURA: 'REABERTURA',
  ALTERACAO_STATUS: 'ALTERACAO_STATUS',
});

export const ENTIDADE_SYNC = Object.freeze({
  ROTA: 'ROTA',
  OBSERVACAO: 'OBSERVACAO',
  EVENTO: 'EVENTO',
});

export const TIPO_OBSERVACAO_CATALOGO = Object.freeze([
  { id: 'VISITA_REALIZADA', rotulo: 'Visita realizada' },
  { id: 'IMOVEL_FECHADO', rotulo: 'Imóvel fechado / ausente' },
  { id: 'RECUSA_ATENDIMENTO', rotulo: 'Recusa / retorno necessário' },
  { id: 'ACESSO_DIFICIL', rotulo: 'Acesso difícil / barreira física' },
  { id: 'ENDERECO_DIVERGENTE', rotulo: 'Numeração ou endereço divergente' },
  { id: 'PENDENCIA_CAMPO', rotulo: 'Pendência de campo' },
  { id: 'OUTRO', rotulo: 'Outra observação' },
]);

const TIPOS_OBSERVACAO_SET = new Set(TIPO_OBSERVACAO_CATALOGO.map((t) => t.id));
const STATUS_OBSERVACAO_SET = new Set(Object.values(STATUS_OBSERVACAO));
const STATUS_ROTA_SET = new Set(Object.values(STATUS_ROTA));

export function gerarUuid() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID().toLowerCase();
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function ehUuidValido(valor) {
  return (
    typeof valor === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor.trim())
  );
}

export function coordenadaValida(lon, lat) {
  return (
    typeof lon === 'number' &&
    typeof lat === 'number' &&
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

export function normalizarIso(valor, agoraFn = Date.now) {
  if (typeof valor === 'string' && valor.trim()) {
    const ms = Date.parse(valor);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return new Date(valor).toISOString();
  }
  return new Date(agoraFn()).toISOString();
}

function limparCoordenadasLinha(coords) {
  if (!Array.isArray(coords)) return [];
  const limpas = [];
  for (const pt of coords) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const lon = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!coordenadaValida(lon, lat)) continue;
    const prev = limpas[limpas.length - 1];
    if (prev && Math.abs(prev[0] - lon) < 1e-9 && Math.abs(prev[1] - lat) < 1e-9) {
      continue;
    }
    limpas.push([Number(lon.toFixed(7)), Number(lat.toFixed(7))]);
  }
  return limpas;
}

/**
 * Extrai a geometria consolidada (GeoJSON `LineString` ou `MultiLineString`)
 * de uma rota calculada pelo roteador sem alterar seu cálculo.
 */
export function extrairGeometriaRotaCalculada(rota) {
  if (!rota || typeof rota !== 'object') return null;

  if (rota.geometry?.type === 'LineString') {
    const coords = limparCoordenadasLinha(rota.geometry.coordinates);
    if (coords.length >= 2) return { type: 'LineString', coordinates: coords };
  }
  if (rota.geometry?.type === 'MultiLineString' && Array.isArray(rota.geometry.coordinates)) {
    const parts = rota.geometry.coordinates
      .map(limparCoordenadasLinha)
      .filter((p) => p.length >= 2);
    if (parts.length === 1) return { type: 'LineString', coordinates: parts[0] };
    if (parts.length > 1) return { type: 'MultiLineString', coordinates: parts };
  }

  const legs = Array.isArray(rota.legs) ? rota.legs : [];
  const combinado = [];
  for (const leg of legs) {
    const coords = limparCoordenadasLinha(leg?.geometry?.coordinates);
    if (coords.length < 2) continue;
    for (const c of coords) {
      const prev = combinado[combinado.length - 1];
      if (!prev || Math.abs(prev[0] - c[0]) >= 1e-8 || Math.abs(prev[1] - c[1]) >= 1e-8) {
        combinado.push(c);
      }
    }
  }
  if (combinado.length >= 2) {
    return { type: 'LineString', coordinates: combinado };
  }
  return null;
}

export function normalizarGeometriaRota(geom) {
  if (!geom || typeof geom !== 'object') return null;
  if (geom.type === 'LineString') {
    const coords = limparCoordenadasLinha(geom.coordinates);
    return coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null;
  }
  if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
    const parts = geom.coordinates.map(limparCoordenadasLinha).filter((p) => p.length >= 2);
    if (parts.length === 1) return { type: 'LineString', coordinates: parts[0] };
    return parts.length > 1 ? { type: 'MultiLineString', coordinates: parts } : null;
  }
  return null;
}

export function geojsonParaWkt(geom) {
  if (!geom || typeof geom !== 'object') return null;
  if (geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
    const [lon, lat] = geom.coordinates.map(Number);
    if (!coordenadaValida(lon, lat)) return null;
    return `POINT (${lon} ${lat})`;
  }
  if (geom.type === 'LineString') {
    const coords = limparCoordenadasLinha(geom.coordinates);
    if (coords.length < 2) return null;
    return `LINESTRING (${coords.map(([lon, lat]) => `${lon} ${lat}`).join(', ')})`;
  }
  if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
    const parts = geom.coordinates.map(limparCoordenadasLinha).filter((p) => p.length >= 2);
    if (!parts.length) return null;
    if (parts.length === 1) {
      return `LINESTRING (${parts[0].map(([lon, lat]) => `${lon} ${lat}`).join(', ')})`;
    }
    const inner = parts.map((p) => `(${p.map(([lon, lat]) => `${lon} ${lat}`).join(', ')})`).join(', ');
    return `MULTILINESTRING (${inner})`;
  }
  return null;
}

function parseParWkt(raw) {
  const parts = String(raw || '').trim().split(/\s+/);
  if (parts.length < 2) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  return coordenadaValida(lon, lat) ? [lon, lat] : null;
}

export function wktParaGeojson(wkt) {
  if (typeof wkt !== 'string') return null;
  const texto = wkt.trim();
  if (!texto) return null;

  const mPoint = /^POINT\s*\(([^)]+)\)$/i.exec(texto);
  if (mPoint) {
    const pt = parseParWkt(mPoint[1]);
    return pt ? { type: 'Point', coordinates: pt } : null;
  }

  const mLine = /^LINESTRING\s*\((.+)\)$/i.exec(texto);
  if (mLine) {
    const coords = mLine[1].split(',').map(parseParWkt).filter(Boolean);
    return coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null;
  }

  const mMulti = /^MULTILINESTRING\s*\(\((.+)\)\)$/i.exec(texto);
  if (mMulti) {
    const blocos = mMulti[1].split(/\)\s*,\s*\(/);
    const parts = blocos
      .map((b) => b.split(',').map(parseParWkt).filter(Boolean))
      .filter((c) => c.length >= 2);
    if (parts.length === 1) return { type: 'LineString', coordinates: parts[0] };
    return parts.length > 1 ? { type: 'MultiLineString', coordinates: parts } : null;
  }

  return null;
}

export function formatarDistanciaCurtaCampo(metros) {
  const n = Number(metros);
  if (!Number.isFinite(n) || n < 0) return '0 m';
  if (n < 1000) return `${Math.round(n)} m`;
  return `${(n / 1000).toFixed(2).replace('.', ',')} km`;
}

export function construirTituloRota(pontos = [], rota = {}) {
  const rotulos = (Array.isArray(pontos) ? pontos : [])
    .map((p) => (p?.rotulo ? String(p.rotulo).trim() : ''))
    .filter(Boolean);
  const seq = rotulos.length ? rotulos.join(' → ') + (rota?.circular !== false ? ' → A' : '') : 'Rota';
  const dist = Number(rota?.distance ?? rota?.distanceMeters ?? 0);
  return dist > 0 ? `${seq} (${formatarDistanciaCurtaCampo(dist)})` : seq;
}

export function calcularAssinaturaRota(rota, pontos = []) {
  const geom = extrairGeometriaRotaCalculada(rota);
  const pts = (Array.isArray(pontos) ? pontos : []).map((p) => ({
    r: p?.rotulo || '',
    lat: Number.isFinite(Number(p?.latitude)) ? Number(p.latitude).toFixed(6) : '',
    lon: Number.isFinite(Number(p?.longitude)) ? Number(p.longitude).toFixed(6) : '',
    cod: p?.enderecoDigital || '',
  }));
  const dist = Math.round(Number(rota?.distance ?? rota?.distanceMeters ?? 0));
  const coords =
    geom?.type === 'LineString'
      ? geom.coordinates
      : geom?.type === 'MultiLineString'
        ? geom.coordinates.flat()
        : [];
  const first = coords[0] ? `${coords[0][0].toFixed(5)},${coords[0][1].toFixed(5)}` : '';
  const last = coords.length ? `${coords[coords.length - 1][0].toFixed(5)},${coords[coords.length - 1][1].toFixed(5)}` : '';
  return JSON.stringify({ pts, dist, n: coords.length, first, last, modo: rota?.modo || 'usuario' });
}

export function sanitizarPontosRota(pontos = []) {
  return (Array.isArray(pontos) ? pontos : []).map((p, idx) => ({
    rotulo: String(p?.rotulo || String.fromCharCode(65 + idx)),
    latitude: Number.isFinite(Number(p?.latitude)) ? Number(p.latitude) : null,
    longitude: Number.isFinite(Number(p?.longitude)) ? Number(p.longitude) : null,
    enderecoDigital: p?.enderecoDigital ? String(p.enderecoDigital).trim() : null,
    codigoCompleto: p?.codigoCompleto ? String(p.codigoCompleto).trim() : null,
  }));
}

export function resumirLegsParaPersistencia(legs = []) {
  if (!Array.isArray(legs)) return [];
  return legs.map((leg, i) => ({
    indice: i,
    de: leg?.de || '',
    para: leg?.para || '',
    distance: Math.round((Number(leg?.distance) || 0) * 100) / 100,
    retorno: !!leg?.retorno,
    geometry: normalizarGeometriaRota(leg?.geometry),
    streets: Array.isArray(leg?.legs)
      ? leg.legs.slice(0, 80).map((s) => ({
          street: s?.street || 'Eixo sem nome',
          length: Math.round((Number(s?.length) || 0) * 100) / 100,
          official: !!s?.official,
        }))
      : [],
  }));
}

export function reconstruirRespostaRotaDeRegistro(registro) {
  if (!registro) return null;
  const geometry = normalizarGeometriaRota(registro.geometry);
  const legs = Array.isArray(registro.legsJson) && registro.legsJson.length
    ? registro.legsJson.map((leg) => ({
        de: leg.de,
        para: leg.para,
        distance: Number(leg.distance || 0),
        retorno: !!leg.retorno,
        geometry: normalizarGeometriaRota(leg.geometry) || geometry,
        legs: Array.isArray(leg.streets) ? leg.streets : [],
      }))
    : geometry
      ? [{
          de: 'A',
          para: 'B',
          distance: Number(registro.distanciaMetros || 0),
          retorno: false,
          geometry: geometry.type === 'LineString'
            ? geometry
            : { type: 'LineString', coordinates: geometry.coordinates[0] || [] },
          legs: [],
        }]
      : [];
  const dist = Number(registro.distanciaMetros || 0);
  return {
    ok: true,
    idCliente: registro.idCliente,
    idServidor: registro.idServidor ?? null,
    offlineRestaurada: true,
    distance: dist,
    distanceMeters: dist,
    distanceKm: Math.round((dist / 1000) * 1000) / 1000,
    modo: registro.modoCalculo || 'usuario',
    circular: registro.circular !== false,
    paradas: Math.max(0, (registro.pontosJson?.length || legs.length) - 1),
    pontos: Array.isArray(registro.pontosJson) ? registro.pontosJson : [],
    legs,
    geometry,
    ocorrenciasNoTrajeto: [],
    ocorrenciasEvitadas: [],
  };
}

export function criarRegistroRotaCalculada({
  idCliente = gerarUuid(),
  rota,
  pontos = [],
  modo = 'usuario',
  circular = true,
  origemSalvamento = 'auto',
  titulo = null,
  status = STATUS_ROTA.SALVA,
  idUsuario = 'agente-local',
  agora = Date.now,
} = {}) {
  const geometry = extrairGeometriaRotaCalculada(rota);
  if (!geometry) {
    throw new Error('Rota calculada sem geometria LineString/MultiLineString válida.');
  }
  const dataCriacao = normalizarIso(null, agora);
  const distanciaMetros = Math.round(Number(rota?.distance ?? rota?.distanceMeters ?? 0) * 100) / 100;
  const pontosLimpos = sanitizarPontosRota(pontos);
  const legsLimpos = resumirLegsParaPersistencia(rota?.legs);

  return {
    idCliente,
    idServidor: null,
    idRotaOrigemCliente: null,
    idRotaOrigemServidor: null,
    tipoRota: TIPO_ROTA.CALCULADA,
    geometry,
    distanciaMetros,
    duracaoSegundos: Math.max(0, Math.round(Number(rota?.duracaoSegundos || 0))),
    titulo: (titulo && String(titulo).trim()) || construirTituloRota(pontosLimpos, { ...rota, circular }),
    modoCalculo: String(modo || rota?.modo || 'usuario'),
    circular: circular !== false,
    pontosJson: pontosLimpos,
    legsJson: legsLimpos,
    assinatura: calcularAssinaturaRota(rota, pontosLimpos),
    origemSalvamento: origemSalvamento === 'manual' ? 'manual' : 'auto',
    simulado: false,
    dataCriacao,
    dataInicio: null,
    dataFim: null,
    dataAtualizacao: dataCriacao,
    versaoLocal: 1,
    versaoServidor: null,
    status: STATUS_ROTA_SET.has(status) ? status : STATUS_ROTA.SALVA,
    idUsuario: String(idUsuario || 'agente-local'),
    syncStatus: SYNC_STATUS.PENDING,
    syncErro: null,
  };
}

export function criarRegistroExecucaoGps({
  idCliente = gerarUuid(),
  idRotaOrigemCliente = null,
  idRotaOrigemServidor = null,
  titulo = null,
  simulado = false,
  idUsuario = 'agente-local',
  agora = Date.now,
} = {}) {
  const dataInicio = normalizarIso(null, agora);
  return {
    idCliente,
    idServidor: null,
    idRotaOrigemCliente: idRotaOrigemCliente || null,
    idRotaOrigemServidor: idRotaOrigemServidor ?? null,
    tipoRota: TIPO_ROTA.GPS,
    geometry: null,
    distanciaMetros: 0,
    duracaoSegundos: 0,
    titulo: (titulo && String(titulo).trim()) || 'Execução GPS em campo',
    modoCalculo: simulado ? 'simulacao' : 'gps',
    circular: false,
    pontosJson: [],
    legsJson: [],
    assinatura: null,
    origemSalvamento: 'gps',
    simulado: !!simulado,
    dataCriacao: dataInicio,
    dataInicio,
    dataFim: null,
    dataAtualizacao: dataInicio,
    versaoLocal: 1,
    versaoServidor: null,
    status: STATUS_ROTA.EM_EXECUCAO,
    idUsuario: String(idUsuario || 'agente-local'),
    syncStatus: simulado ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING,
    syncErro: null,
  };
}

export function validarDadosObservacao({
  idRotaCliente,
  latitude,
  longitude,
  tipoObservacao,
  descricao,
} = {}) {
  if (!idRotaCliente || !String(idRotaCliente).trim()) {
    return { ok: false, motivo: 'ROTA_OBRIGATORIA', mensagem: 'Toda observação deve estar vinculada a uma rota.' };
  }
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!coordenadaValida(lon, lat)) {
    return { ok: false, motivo: 'COORDENADA_INVALIDA', mensagem: 'Coordenadas geográficas inválidas para a observação.' };
  }
  const tipo = String(tipoObservacao || '').trim().toUpperCase();
  if (!TIPOS_OBSERVACAO_SET.has(tipo)) {
    return { ok: false, motivo: 'TIPO_INVALIDO', mensagem: 'Tipo de observação inválido.' };
  }
  const desc = String(descricao || '').trim();
  if (!desc || desc.length < 3) {
    return { ok: false, motivo: 'DESCRICAO_OBRIGATORIA', mensagem: 'Informe uma descrição com pelo menos 3 caracteres.' };
  }
  if (desc.length > 1000) {
    return { ok: false, motivo: 'DESCRICAO_LONGA', mensagem: 'Descrição excede 1000 caracteres.' };
  }
  return { ok: true, tipo, desc, lat, lon };
}

export function criarRegistroObservacao({
  idCliente = gerarUuid(),
  idRotaCliente,
  idRotaServidor = null,
  latitude,
  longitude,
  tipoObservacao = 'VISITA_REALIZADA',
  descricao,
  simulado = false,
  idUsuario = 'agente-local',
  agora = Date.now,
} = {}) {
  const validacao = validarDadosObservacao({
    idRotaCliente,
    latitude,
    longitude,
    tipoObservacao,
    descricao,
  });
  if (!validacao.ok) {
    throw new Error(validacao.mensagem);
  }
  const agoraIso = normalizarIso(null, agora);
  const obs = {
    idCliente,
    idServidor: null,
    idRotaCliente: String(idRotaCliente).trim(),
    idRotaServidor: idRotaServidor ?? null,
    geometry: { type: 'Point', coordinates: [Number(validacao.lon.toFixed(7)), Number(validacao.lat.toFixed(7))] },
    latitude: Number(validacao.lat.toFixed(7)),
    longitude: Number(validacao.lon.toFixed(7)),
    descricao: validacao.desc,
    tipoObservacao: validacao.tipo,
    dataCriacao: agoraIso,
    dataAtualizacao: agoraIso,
    versaoLocal: 1,
    versaoServidor: null,
    idUsuario: String(idUsuario || 'agente-local'),
    status: STATUS_OBSERVACAO.ABERTA,
    simulado: !!simulado,
    syncStatus: simulado ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING,
    syncErro: null,
  };
  const evento = {
    idCliente: gerarUuid(),
    idServidor: null,
    idObservacaoCliente: obs.idCliente,
    idObservacaoServidor: null,
    tipoEvento: TIPO_EVENTO.CRIACAO,
    dadosEvento: {
      tipoObservacao: obs.tipoObservacao,
      descricao: obs.descricao,
      status: obs.status,
      latitude: obs.latitude,
      longitude: obs.longitude,
    },
    dataEvento: agoraIso,
    idUsuario: obs.idUsuario,
    simulado: !!simulado,
    syncStatus: simulado ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING,
    syncErro: null,
  };
  return { observacao: obs, evento };
}

export function aplicarEdicaoObservacao(obsAtual, { descricao, tipoObservacao, idUsuario, agora = Date.now } = {}) {
  if (!obsAtual) throw new Error('Observação inexistente.');
  const desc = String(descricao ?? obsAtual.descricao).trim();
  const tipo = String(tipoObservacao ?? obsAtual.tipoObservacao).trim().toUpperCase();
  const validacao = validarDadosObservacao({
    idRotaCliente: obsAtual.idRotaCliente,
    latitude: obsAtual.latitude,
    longitude: obsAtual.longitude,
    tipoObservacao: tipo,
    descricao: desc,
  });
  if (!validacao.ok) throw new Error(validacao.mensagem);

  const agoraIso = normalizarIso(null, agora);
  const autor = String(idUsuario || obsAtual.idUsuario || 'agente-local');
  const observacao = {
    ...obsAtual,
    descricao: validacao.desc,
    tipoObservacao: validacao.tipo,
    dataAtualizacao: agoraIso,
    versaoLocal: Number(obsAtual.versaoLocal || 1) + 1,
    syncStatus: obsAtual.simulado ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING,
    syncErro: null,
  };
  const evento = {
    idCliente: gerarUuid(),
    idServidor: null,
    idObservacaoCliente: obsAtual.idCliente,
    idObservacaoServidor: obsAtual.idServidor ?? null,
    tipoEvento: TIPO_EVENTO.EDICAO,
    dadosEvento: {
      antes: { tipoObservacao: obsAtual.tipoObservacao, descricao: obsAtual.descricao },
      depois: { tipoObservacao: observacao.tipoObservacao, descricao: observacao.descricao },
      versaoLocal: observacao.versaoLocal,
    },
    dataEvento: agoraIso,
    idUsuario: autor,
    simulado: !!obsAtual.simulado,
    syncStatus: obsAtual.simulado ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING,
    syncErro: null,
  };
  return { observacao, evento };
}

export function aplicarStatusObservacao(obsAtual, { novoStatus, idUsuario, motivo = null, agora = Date.now } = {}) {
  if (!obsAtual) throw new Error('Observação inexistente.');
  const status = String(novoStatus || '').trim().toUpperCase();
  if (!STATUS_OBSERVACAO_SET.has(status)) {
    throw new Error('Status de observação inválido.');
  }
  const agoraIso = normalizarIso(null, agora);
  const autor = String(idUsuario || obsAtual.idUsuario || 'agente-local');
  const tipoEvento =
    status === STATUS_OBSERVACAO.CONCLUIDA
      ? TIPO_EVENTO.CONCLUSAO
      : status === STATUS_OBSERVACAO.REABERTA
        ? TIPO_EVENTO.REABERTURA
        : TIPO_EVENTO.ALTERACAO_STATUS;

  const observacao = {
    ...obsAtual,
    status,
    dataAtualizacao: agoraIso,
    versaoLocal: Number(obsAtual.versaoLocal || 1) + 1,
    syncStatus: obsAtual.simulado ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING,
    syncErro: null,
  };
  const evento = {
    idCliente: gerarUuid(),
    idServidor: null,
    idObservacaoCliente: obsAtual.idCliente,
    idObservacaoServidor: obsAtual.idServidor ?? null,
    tipoEvento,
    dadosEvento: {
      statusAnterior: obsAtual.status,
      statusNovo: status,
      motivo: motivo ? String(motivo).trim() : null,
      versaoLocal: observacao.versaoLocal,
    },
    dataEvento: agoraIso,
    idUsuario: autor,
    simulado: !!obsAtual.simulado,
    syncStatus: obsAtual.simulado ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING,
    syncErro: null,
  };
  return { observacao, evento };
}

export function rotuloTipoObservacao(tipo) {
  const encontrado = TIPO_OBSERVACAO_CATALOGO.find((t) => t.id === tipo);
  return encontrado ? encontrado.rotulo : String(tipo || 'Observação');
}

export function rotuloStatusObservacaoCampo(status) {
  if (status === STATUS_OBSERVACAO.CONCLUIDA) return 'Concluída';
  if (status === STATUS_OBSERVACAO.REABERTA) return 'Reaberta';
  return 'Aberta';
}

export function rotuloSyncStatus(status) {
  if (status === SYNC_STATUS.SYNCING) return SYNC_UI_LABEL.SINCRONIZANDO;
  if (status === SYNC_STATUS.SYNCED) return SYNC_UI_LABEL.SINCRONIZADO;
  if (status === SYNC_STATUS.ERROR) return SYNC_UI_LABEL.FALHA;
  if (status === SYNC_STATUS.PENDING) return SYNC_UI_LABEL.AGUARDANDO;
  return SYNC_UI_LABEL.SALVO_DISPOSITIVO;
}

export function rotuloIndicadorSync(resumo = {}) {
  const sincronizando = Number(resumo.sincronizando || 0);
  const erros = Number(resumo.erros || 0);
  const pendentes = Number(resumo.pendentes || 0);
  const sincronizados = Number(resumo.sincronizados || 0);
  const online = resumo.online !== false;

  if (sincronizando > 0) return { texto: SYNC_UI_LABEL.SINCRONIZANDO, estado: SYNC_STATUS.SYNCING, podeTentarManual: false };
  if (erros > 0) return { texto: SYNC_UI_LABEL.FALHA, estado: SYNC_STATUS.ERROR, podeTentarManual: true };
  if (pendentes > 0) {
    return {
      texto: online ? SYNC_UI_LABEL.AGUARDANDO : SYNC_UI_LABEL.SALVO_DISPOSITIVO,
      estado: SYNC_STATUS.PENDING,
      podeTentarManual: false,
    };
  }
  if (sincronizados > 0) return { texto: SYNC_UI_LABEL.SINCRONIZADO, estado: SYNC_STATUS.SYNCED, podeTentarManual: false };
  return { texto: SYNC_UI_LABEL.SALVO_DISPOSITIVO, estado: 'IDLE', podeTentarManual: false };
}
