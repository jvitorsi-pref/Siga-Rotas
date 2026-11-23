/**
 * public/gpx.js
 * ---------------------------------------------------------------------------
 * Gerador puro e isomórfico de arquivos GPX 1.1 (rota calculada e rota
 * percorrida por GPS) e empacotador ZIP para os cenários A, B e C.
 * Compartilhado entre Web e APK; não altera o cálculo de rotas.
 */

import { criarZip } from './zip.js';

export const NOME_ARQUIVO_ROTA_CALCULADA = 'rota_calculada.gpx';
export const NOME_ARQUIVO_ROTA_PERCORRIDA = 'rota_percorrida.gpx';
export const NOME_ARQUIVO_EXPORTACAO_ZIP = 'exportacao_rotas.zip';

function escapeXml(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function coordValida(lon, lat) {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

function fmtCoord(valor) {
  const n = Number(valor);
  const limpo = Object.is(n, -0) || Math.abs(n) < 5e-8 ? 0 : n;
  return limpo.toFixed(7);
}

function fmtDistancia(metros) {
  if (!Number.isFinite(metros)) return '';
  if (metros < 1000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toFixed(2)} km`;
}

function haversineMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function normalizarLinhaComDiagnostico(coords) {
  if (!Array.isArray(coords)) return { pontos: [], invalidas: 0 };
  const pontos = [];
  let invalidas = 0;
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) {
      if (c != null) invalidas += 1;
      continue;
    }
    const lon = Number(c[0]);
    const lat = Number(c[1]);
    if (!coordValida(lon, lat)) {
      invalidas += 1;
      continue;
    }
    pontos.push([lon, lat]);
  }
  return { pontos, invalidas };
}

function extrairLinhasGeometria(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return { linhas: [], invalidas: 0 };
  }
  if (geometry.type === 'MultiLineString') {
    let invalidas = 0;
    const linhas = [];
    for (const parte of geometry.coordinates) {
      const res = normalizarLinhaComDiagnostico(parte);
      invalidas += res.invalidas;
      if (res.pontos.length >= 2) linhas.push(res.pontos);
    }
    return { linhas, invalidas };
  }
  const res = normalizarLinhaComDiagnostico(geometry.coordinates);
  return {
    linhas: res.pontos.length >= 2 ? [res.pontos] : [],
    invalidas: res.invalidas,
  };
}

function normalizarEntradaRotaCalculada(route) {
  if (!route || typeof route !== 'object') return route;
  if (route.tipoRota === 'GPS') return route;
  if (Array.isArray(route.legs) && route.legs.length > 0) return route;
  if (Array.isArray(route.legsJson) && route.legsJson.length > 0) {
    return {
      ...route,
      ok: route.ok !== false,
      distance: route.distance ?? route.distanciaMetros ?? 0,
      modo: route.modo || route.modoCalculo || 'usuario',
      circular: route.circular !== false,
      pontos: Array.isArray(route.pontos) && route.pontos.length ? route.pontos : (route.pontosJson || []),
      legs: route.legsJson.map((leg) => ({
        de: leg?.de || '',
        para: leg?.para || '',
        retorno: !!leg?.retorno,
        distance: Number(leg?.distance || 0),
        geometry: leg?.geometry || null,
      })),
    };
  }
  if (route.geometry && (route.pontosJson || route.distanciaMetros != null)) {
    return {
      ...route,
      ok: route.ok !== false,
      distance: route.distance ?? route.distanciaMetros ?? 0,
      modo: route.modo || route.modoCalculo || 'usuario',
      circular: route.circular !== false,
      pontos: Array.isArray(route.pontos) && route.pontos.length ? route.pontos : (route.pontosJson || []),
    };
  }
  return route;
}

function extrairSegmentos(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  const segmentos = [];
  let totalInvalidas = 0;

  for (const leg of legs) {
    const { linhas, invalidas } = extrairLinhasGeometria(leg?.geometry);
    totalInvalidas += invalidas;
    for (const pontos of linhas) {
      segmentos.push({
        de: leg.de || '',
        para: leg.para || '',
        retorno: leg.retorno === true,
        pontos,
      });
    }
  }

  // Garante inclusão do trecho de retorno quando enviado separado de legs
  if (route?.circular === true && !segmentos.some((s) => s.retorno) && route?.retorno?.geometry) {
    const { linhas, invalidas } = extrairLinhasGeometria(route.retorno.geometry);
    totalInvalidas += invalidas;
    for (const pontos of linhas) {
      segmentos.push({
        de: route.retorno.de || '',
        para: route.retorno.para || '',
        retorno: true,
        pontos,
      });
    }
  }

  if (segmentos.length === 0 && route?.geometry) {
    const { linhas, invalidas } = extrairLinhasGeometria(route.geometry);
    totalInvalidas += invalidas;
    for (const pontos of linhas) {
      segmentos.push({ de: '', para: '', retorno: false, pontos });
    }
  }

  return { segmentos, totalInvalidas };
}

function ordenarWaypoints(route, pontosLista) {
  let base = Array.isArray(route?.pontos) && route.pontos.length
    ? route.pontos
    : Array.isArray(route?.pontosJson) && route.pontosJson.length
      ? route.pontosJson
      : Array.isArray(pontosLista)
        ? pontosLista
        : [];

  if (base.length === 0 && route?.origin?.input && route?.destination?.input) {
    base = [
      {
        rotulo: 'A',
        latitude: route.origin.input.lat,
        longitude: route.origin.input.lon,
        ordem: 1,
      },
      {
        rotulo: 'B',
        latitude: route.destination.input.lat,
        longitude: route.destination.input.lon,
        ordem: 2,
      },
    ];
  }

  // Enriquecer pontos da rota com enderecoDigital da lista quando necessário.
  const porRotulo = new Map();
  if (Array.isArray(pontosLista)) {
    for (const p of pontosLista) {
      if (p?.rotulo) porRotulo.set(p.rotulo, p);
    }
  }

  const ordemPorSequencia = new Map();
  const seqLista = Array.isArray(route?.sequencia) && route.sequencia.length
    ? route.sequencia
    : Array.isArray(route?.sequenciaCompleta) && route.sequenciaCompleta.length
      ? route.sequenciaCompleta
      : [];
  seqLista.forEach((rot, idx) => {
    if (rot && !ordemPorSequencia.has(rot)) ordemPorSequencia.set(rot, idx + 1);
  });

  const comDados = base
    .map((p, i) => {
      const rotulo = p?.rotulo || String.fromCharCode(65 + i);
      const extra = porRotulo.get(rotulo) || null;
      const ordemSeq = ordemPorSequencia.get(rotulo);
      const latRaw = p?.latitude ?? extra?.latitude;
      const lonRaw = p?.longitude ?? extra?.longitude;
      if (latRaw == null || lonRaw == null || latRaw === '' || lonRaw === '') return null;
      const lat = Number(latRaw);
      const lon = Number(lonRaw);
      if (!coordValida(lon, lat)) return null;
      return {
        rotulo,
        latitude: lat,
        longitude: lon,
        enderecoDigital: p?.enderecoDigital || extra?.enderecoDigital || '',
        ordem: Number.isFinite(p?.ordem) ? p.ordem : (ordemSeq ?? i + 1),
        indiceOriginal: i,
      };
    })
    .filter(Boolean);

  comDados.sort((a, b) => a.ordem - b.ordem || a.indiceOriginal - b.indiceOriginal);
  return comDados;
}

function formatarWaypointsXml(waypoints, { circular = false } = {}) {
  const linhas = [];
  waypoints.forEach((w, idx) => {
    const papel = idx === 0
      ? (circular ? 'Origem e destino (circuito)' : 'Origem')
      : (!circular && idx === waypoints.length - 1 ? 'Destino' : `Parada ${w.rotulo}`);
    const nomeWpt = w.enderecoDigital ? `${w.rotulo} (${w.enderecoDigital})` : `Ponto ${w.rotulo}`;
    const descWpt = [papel, w.enderecoDigital ? `Plus Code: ${w.enderecoDigital}` : '']
      .filter(Boolean)
      .join(' · ');
    const simbolo = idx === 0 ? 'Flag, Green' : 'Flag, Blue';
    linhas.push(
      `  <wpt lat="${fmtCoord(w.latitude)}" lon="${fmtCoord(w.longitude)}">`,
      `    <name>${escapeXml(nomeWpt)}</name>`,
      `    <cmt>${escapeXml(papel)}</cmt>`,
      `    <desc>${escapeXml(descWpt)}</desc>`,
      `    <sym>${escapeXml(simbolo)}</sym>`,
      '  </wpt>',
    );
  });
  return linhas;
}

function validarXmlGpxNaoVazio(xml, contexto = 'GPX') {
  if (typeof xml !== 'string' || !xml.trim() || !xml.includes('<trkpt ') || !xml.includes('</gpx>')) {
    throw new Error(`Arquivo ${contexto} gerado está vazio ou sem pontos de trilha válidos.`);
  }
}

/**
 * Sugere um nome de arquivo `.gpx` seguro a partir da rota calculada.
 */
export function nomeArquivoGpx(route, data = new Date()) {
  const seq = Array.isArray(route?.sequenciaCompleta) && route.sequenciaCompleta.length
    ? route.sequenciaCompleta
    : Array.isArray(route?.sequencia) && route.sequencia.length
      ? route.sequencia
      : ['rota'];
  const seqLimpa = seq
    .map((r) => String(r).replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean)
    .slice(0, 8)
    .join('-') || 'rota';
  const d = data instanceof Date && !Number.isNaN(data.getTime()) ? data : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const carimbo =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}`;
  return `siga-rota-${seqLimpa}-${carimbo}.gpx`.replace(/[\\/:*?"<>|]+/g, '-');
}

/**
 * Gera um documento GPX 1.1 válido a partir de uma rota calculada completa
 * (`<wpt>` das paradas + `<trk>/<trkseg>/<trkpt>` com toda a geometria).
 */
export function gerarGpxRota(route, opcoes = {}) {
  if (!route || route.ok === false || route.parcial) {
    throw new Error('Calcule uma rota completa antes de exportar em GPX.');
  }
  if (route.tipoRota === 'GPS') {
    throw new Error('Uma trilha GPS não pode ser exportada como rota calculada.');
  }

  const rotaNorm = normalizarEntradaRotaCalculada(route);
  const { segmentos, totalInvalidas } = extrairSegmentos(rotaNorm);
  if (segmentos.length === 0) {
    if (totalInvalidas > 0) {
      throw new Error('A rota calculada não possui geometria válida (coordenadas WGS84 inválidas).');
    }
    throw new Error('A rota calculada não possui geometria válida para exportação GPX.');
  }

  const waypoints = ordenarWaypoints(rotaNorm, opcoes.pontos);
  const seq = (
    Array.isArray(rotaNorm.sequenciaCompleta) && rotaNorm.sequenciaCompleta.length
      ? rotaNorm.sequenciaCompleta
      : Array.isArray(rotaNorm.sequencia) && rotaNorm.sequencia.length
        ? rotaNorm.sequencia
        : waypoints.map((w) => w.rotulo)
  ).join(' → ');

  const modoTexto =
    rotaNorm.modo === 'otimizada'
      ? 'Otimizada (menor distância total)'
      : rotaNorm.modo === 'saida_curta'
        ? 'Otimizada (saída curta)'
        : 'Ordem do usuário';
  const distTexto = fmtDistancia(rotaNorm.distance);
  const nomeRota = seq ? `Rota Calculada SIGA-Rotas (${seq})` : 'Rota Calculada SIGA-Rotas';
  const descParts = [
    rotaNorm.circular ? 'Planejamento original (circuito a pé em Santo André)' : 'Planejamento original (rota a pé em Santo André)',
    seq ? `Sequência: ${seq}` : '',
    distTexto ? `Distância planejada: ${distTexto}` : '',
    `Modo: ${modoTexto}`,
  ].filter(Boolean);
  const descRota = descParts.join(' · ');

  const agora = opcoes.agora instanceof Date && !Number.isNaN(opcoes.agora.getTime())
    ? opcoes.agora
    : new Date();
  const timestamp = agora.toISOString();

  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;

  const atualizarLimites = (lon, lat) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  };

  for (const w of waypoints) atualizarLimites(w.longitude, w.latitude);
  for (const seg of segmentos) {
    for (const [lon, lat] of seg.pontos) atualizarLimites(lon, lat);
  }

  const linhas = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="SIGA-Rotas Santo André" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    '  <metadata>',
    `    <name>${escapeXml(nomeRota)}</name>`,
    `    <desc>${escapeXml(descRota)}</desc>`,
    `    <time>${escapeXml(timestamp)}</time>`,
    `    <bounds minlat="${fmtCoord(minLat)}" minlon="${fmtCoord(minLon)}" maxlat="${fmtCoord(maxLat)}" maxlon="${fmtCoord(maxLon)}"/>`,
    '  </metadata>',
    ...formatarWaypointsXml(waypoints, { circular: rotaNorm.circular !== false }),
    '  <trk>',
    `    <name>${escapeXml(nomeRota)}</name>`,
    `    <desc>${escapeXml(descRota)}</desc>`,
    '    <type>Caminhada</type>',
  ];

  for (const seg of segmentos) {
    linhas.push('    <trkseg>');
    for (const [lon, lat] of seg.pontos) {
      linhas.push(`      <trkpt lat="${fmtCoord(lat)}" lon="${fmtCoord(lon)}"/>`);
    }
    linhas.push('    </trkseg>');
  }

  linhas.push('  </trk>', '</gpx>', '');
  const xml = linhas.join('\n');
  validarXmlGpxNaoVazio(xml, NOME_ARQUIVO_ROTA_CALCULADA);
  return xml;
}

export const gerarGpxRotaCalculada = gerarGpxRota;

function parseTimestampIso(pt) {
  if (!pt || typeof pt !== 'object') return null;
  const raw = pt.timestampMs ?? pt.timestamp ?? null;
  if (raw != null && Number.isFinite(Number(raw)) && Number(raw) > 0) {
    const d = new Date(Number(raw));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const isoRaw = pt.criadoEm || pt.dataHora || pt.time || null;
  if (typeof isoRaw === 'string' && isoRaw.trim()) {
    const ms = Date.parse(isoRaw);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

/**
 * Extrai e normaliza exclusivamente os pontos reais coletados por GPS
 * em segmentos ordenados (respeitando pausas/retomadas via `segmentoIndice`).
 */
export function extrairSegmentosGpsReais({ pontosGps = [], rotaPercorrida = null } = {}) {
  if (rotaPercorrida?.simulado === true) {
    return {
      segmentos: [],
      totalPontosValidos: 0,
      invalidos: 0,
      distanciaMetros: 0,
      duracaoSegundos: 0,
      temTimestamps: false,
      motivoBloqueio: 'SIMULACAO_NAO_EXPORTAVEL',
    };
  }

  const listaBruta = Array.isArray(pontosGps) ? pontosGps : [];
  let invalidos = 0;
  const pontosValidos = [];

  for (let i = 0; i < listaBruta.length; i += 1) {
    const p = listaBruta[i];
    if (!p || typeof p !== 'object') {
      if (p != null) invalidos += 1;
      continue;
    }
    if (p.simulado === true) continue;

    const latRaw = p.latitude ?? p.lat;
    const lonRaw = p.longitude ?? p.lon ?? p.lng;
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (latRaw == null || lonRaw == null || !coordValida(lon, lat)) {
      invalidos += 1;
      continue;
    }

    const tsNum = Number(p.timestampMs ?? p.timestamp);
    const tsFallback = Number.isFinite(tsNum) ? tsNum : Date.parse(p.criadoEm || p.time || '');
    const segmentoIndice = Number.isFinite(Number(p.segmentoIndice)) ? Number(p.segmentoIndice) : 0;
    const ordem = Number.isFinite(Number(p.ordem)) ? Number(p.ordem) : i + 1;

    pontosValidos.push({
      latitude: lat,
      longitude: lon,
      segmentoIndice,
      ordem,
      timestampMs: Number.isFinite(tsFallback) ? tsFallback : null,
      timeIso: parseTimestampIso(p),
    });
  }

  if (pontosValidos.length > 0) {
    pontosValidos.sort((a, b) => {
      if (a.segmentoIndice !== b.segmentoIndice) return a.segmentoIndice - b.segmentoIndice;
      if (a.ordem !== b.ordem) return a.ordem - b.ordem;
      return (a.timestampMs || 0) - (b.timestampMs || 0);
    });

    const grupos = new Map();
    for (const pt of pontosValidos) {
      if (!grupos.has(pt.segmentoIndice)) grupos.set(pt.segmentoIndice, []);
      const lista = grupos.get(pt.segmentoIndice);
      const prev = lista[lista.length - 1];
      const mesmoPonto =
        prev &&
        Math.abs(prev.longitude - pt.longitude) <= 1e-8 &&
        Math.abs(prev.latitude - pt.latitude) <= 1e-8 &&
        prev.timeIso === pt.timeIso;
      if (!mesmoPonto) lista.push(pt);
    }

    const segmentos = Array.from(grupos.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, pts]) => pts)
      .filter((pts) => pts.length >= 1);

    const totalPontosValidos = segmentos.reduce((acc, s) => acc + s.length, 0);
    let distanciaMetros = 0;
    for (const seg of segmentos) {
      for (let i = 1; i < seg.length; i += 1) {
        distanciaMetros += haversineMetros(
          seg[i - 1].latitude,
          seg[i - 1].longitude,
          seg[i].latitude,
          seg[i].longitude,
        );
      }
    }

    const comTs = pontosValidos.filter((p) => Number.isFinite(p.timestampMs) && p.timestampMs > 0);
    const duracaoSegundos =
      comTs.length >= 2
        ? Math.max(0, Math.round((comTs[comTs.length - 1].timestampMs - comTs[0].timestampMs) / 1000))
        : Number(rotaPercorrida?.duracaoSegundos || 0);

    return {
      segmentos,
      totalPontosValidos,
      invalidos,
      distanciaMetros: Math.round(distanciaMetros * 100) / 100,
      duracaoSegundos,
      temTimestamps: comTs.length > 0,
      motivoBloqueio: null,
    };
  }

  // Fallback exclusivo para o próprio registro GPS (`tipoRota === 'GPS'`) caso já
  // possua geometria consolidada sem lista detalhada de `pontos_gps` (ex.: sync).
  if (rotaPercorrida && (!rotaPercorrida.tipoRota || rotaPercorrida.tipoRota === 'GPS') && rotaPercorrida.geometry) {
    const { linhas, invalidas: invalidasGeom } = extrairLinhasGeometria(rotaPercorrida.geometry);
    invalidos += invalidasGeom;
    const segmentos = linhas.map((coords) =>
      coords.map(([lon, lat]) => ({
        latitude: lat,
        longitude: lon,
        segmentoIndice: 0,
        ordem: 0,
        timestampMs: null,
        timeIso: null,
      })),
    );
    const totalPontosValidos = segmentos.reduce((acc, s) => acc + s.length, 0);
    let distanciaMetros = 0;
    for (const seg of segmentos) {
      for (let i = 1; i < seg.length; i += 1) {
        distanciaMetros += haversineMetros(
          seg[i - 1].latitude,
          seg[i - 1].longitude,
          seg[i].latitude,
          seg[i].longitude,
        );
      }
    }
    return {
      segmentos,
      totalPontosValidos,
      invalidos,
      distanciaMetros: Math.round((distanciaMetros || Number(rotaPercorrida.distanciaMetros || 0)) * 100) / 100,
      duracaoSegundos: Number(rotaPercorrida.duracaoSegundos || 0),
      temTimestamps: false,
      motivoBloqueio: null,
    };
  }

  return {
    segmentos: [],
    totalPontosValidos: 0,
    invalidos,
    distanciaMetros: 0,
    duracaoSegundos: 0,
    temTimestamps: false,
    motivoBloqueio: null,
  };
}

/**
 * Gera um documento GPX 1.1 válido representando exclusivamente o percurso
 * coletado pelo GPS real (`<trk>/<trkseg>/<trkpt>` com `<time>` quando disponível)
 * e preservando os pontos de parada (`<wpt>`) quando existentes.
 */
export function gerarGpxRotaPercorrida({
  pontosGps = [],
  rotaPercorrida = null,
  pontos = [],
  rotaOrigem = null,
  agora = new Date(),
} = {}) {
  if (rotaPercorrida?.simulado === true) {
    throw new Error('Execuções simuladas não representam percurso real de GPS.');
  }

  const extraido = extrairSegmentosGpsReais({ pontosGps, rotaPercorrida });
  if (extraido.totalPontosValidos < 2 || extraido.segmentos.length === 0) {
    if (extraido.invalidos > 0) {
      throw new Error('Os registros GPS contêm coordenadas inválidas (WGS84 fora da faixa).');
    }
    throw new Error('Não há registros GPS reais suficientes para gerar a rota percorrida.');
  }

  const waypoints = ordenarWaypoints(
    rotaOrigem || (Array.isArray(pontos) && pontos.length ? { pontos } : rotaPercorrida),
    pontos,
  );

  const agoraDate = agora instanceof Date && !Number.isNaN(agora.getTime()) ? agora : new Date();
  const timestamp = agoraDate.toISOString();
  const titulo =
    (rotaPercorrida?.titulo && String(rotaPercorrida.titulo).trim()) ||
    'Rota Percorrida SIGA-Rotas (GPS real)';
  const distTexto = fmtDistancia(extraido.distanciaMetros);
  const descParts = [
    'Percurso real coletado por GPS em Santo André',
    distTexto ? `Distância percorrida: ${distTexto}` : '',
    extraido.segmentos.length > 1 ? `${extraido.segmentos.length} trechos registrados (pausas/retomadas)` : '',
    extraido.duracaoSegundos > 0 ? `Duração: ${extraido.duracaoSegundos} s` : '',
  ].filter(Boolean);
  const descRota = descParts.join(' · ');

  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  const atualizarLimites = (lon, lat) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  };

  for (const w of waypoints) atualizarLimites(w.longitude, w.latitude);
  for (const seg of extraido.segmentos) {
    for (const pt of seg) atualizarLimites(pt.longitude, pt.latitude);
  }

  const linhas = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="SIGA-Rotas Santo André" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    '  <metadata>',
    `    <name>${escapeXml(titulo)}</name>`,
    `    <desc>${escapeXml(descRota)}</desc>`,
    `    <time>${escapeXml(timestamp)}</time>`,
    `    <bounds minlat="${fmtCoord(minLat)}" minlon="${fmtCoord(minLon)}" maxlat="${fmtCoord(maxLat)}" maxlon="${fmtCoord(maxLon)}"/>`,
    '  </metadata>',
    ...formatarWaypointsXml(waypoints, { circular: rotaOrigem?.circular !== false }),
    '  <trk>',
    `    <name>${escapeXml(titulo)}</name>`,
    `    <desc>${escapeXml(descRota)}</desc>`,
    '    <type>Caminhada GPS</type>',
  ];

  for (const seg of extraido.segmentos) {
    linhas.push('    <trkseg>');
    for (const pt of seg) {
      if (pt.timeIso) {
        linhas.push(
          `      <trkpt lat="${fmtCoord(pt.latitude)}" lon="${fmtCoord(pt.longitude)}">`,
          `        <time>${escapeXml(pt.timeIso)}</time>`,
          '      </trkpt>',
        );
      } else {
        linhas.push(`      <trkpt lat="${fmtCoord(pt.latitude)}" lon="${fmtCoord(pt.longitude)}"/>`);
      }
    }
    linhas.push('    </trkseg>');
  }

  linhas.push('  </trk>', '</gpx>', '');
  const xml = linhas.join('\n');
  validarXmlGpxNaoVazio(xml, NOME_ARQUIVO_ROTA_PERCORRIDA);
  return xml;
}

function escolherRotaCalculadaCandidata(rotaCalculadaOriginal, rotaCalculada) {
  const ehCalcValida = (r) =>
    r && typeof r === 'object' && r.tipoRota !== 'GPS' && r.ok !== false && !r.parcial;

  if (ehCalcValida(rotaCalculadaOriginal)) {
    const { segmentos } = extrairSegmentos(normalizarEntradaRotaCalculada(rotaCalculadaOriginal));
    if (segmentos.length > 0) return rotaCalculadaOriginal;
  }
  if (ehCalcValida(rotaCalculada)) return rotaCalculada;
  if (rotaCalculadaOriginal && rotaCalculadaOriginal.tipoRota !== 'GPS') return rotaCalculadaOriginal;
  if (rotaCalculada && rotaCalculada.tipoRota !== 'GPS') return rotaCalculada;
  return null;
}

/**
 * Orquestra automaticamente os cenários A (somente calculada), B (calculada +
 * percorrida em `exportacao_rotas.zip`) e C (somente percorrida), aplicando todas
 * as validações de segurança, coordenadas e navegação em andamento.
 */
export function prepararPacoteExportacaoGpx({
  rotaCalculada = null,
  rotaCalculadaOriginal = null,
  rotaPercorrida = null,
  pontos = [],
  pontosGps = [],
  navegacaoEmAndamento = false,
  criarZipFn = criarZip,
  agora = new Date(),
} = {}) {
  if (navegacaoEmAndamento) {
    return {
      ok: false,
      motivo: 'NAVEGACAO_EM_ANDAMENTO',
      mensagem:
        'Encerre ou finalize a navegação em andamento antes de exportar o GPX. Os dados da navegação permanecem preservados.',
    };
  }

  const rotaCalcCandidata = escolherRotaCalculadaCandidata(rotaCalculadaOriginal, rotaCalculada);
  let xmlCalculada = null;
  let erroCalculada = null;

  if (rotaCalcCandidata) {
    try {
      xmlCalculada = gerarGpxRota(rotaCalcCandidata, { pontos, agora });
    } catch (err) {
      erroCalculada = err;
    }
  }

  // Verifica existência de dados GPS reais (simulação nunca conta como rota percorrida)
  const gpsNaoSimulado = rotaPercorrida?.simulado === true ? null : rotaPercorrida;
  const pontosReais = Array.isArray(pontosGps) ? pontosGps.filter((p) => p?.simulado !== true) : [];
  const diagnosticoGps = extrairSegmentosGpsReais({
    pontosGps: pontosReais,
    rotaPercorrida: gpsNaoSimulado,
  });

  let xmlPercorrida = null;
  let erroGps = null;
  if (diagnosticoGps.totalPontosValidos >= 2) {
    try {
      xmlPercorrida = gerarGpxRotaPercorrida({
        pontosGps: pontosReais,
        rotaPercorrida: gpsNaoSimulado,
        pontos,
        rotaOrigem: rotaCalcCandidata,
        agora,
      });
    } catch (err) {
      erroGps = err;
    }
  } else if (diagnosticoGps.invalidos > 0) {
    erroGps = new Error('Os registros GPS contêm coordenadas inválidas (WGS84 fora da faixa).');
  }

  // Cenário B: rota calculada + rota percorrida → exportacao_rotas.zip
  if (xmlCalculada && xmlPercorrida) {
    try {
      const zipBytes = criarZipFn(
        [
          { nome: NOME_ARQUIVO_ROTA_CALCULADA, conteudo: xmlCalculada },
          { nome: NOME_ARQUIVO_ROTA_PERCORRIDA, conteudo: xmlPercorrida },
        ],
        { agora },
      );
      if (!(zipBytes instanceof Uint8Array) || zipBytes.byteLength < 22) {
        throw new Error('Pacote ZIP vazio ou inválido.');
      }
      return {
        ok: true,
        cenario: 'AMBAS',
        tipoArquivo: 'zip',
        nomeArquivo: NOME_ARQUIVO_EXPORTACAO_ZIP,
        mimeType: 'application/zip',
        zipBytes,
        arquivos: [
          { nome: NOME_ARQUIVO_ROTA_CALCULADA, conteudo: xmlCalculada },
          { nome: NOME_ARQUIVO_ROTA_PERCORRIDA, conteudo: xmlPercorrida },
        ],
      };
    } catch (err) {
      return {
        ok: false,
        motivo: 'ERRO_ZIP',
        mensagem: `Não foi possível gerar o pacote ZIP para exportação: ${err?.message || String(err)}`,
      };
    }
  }

  // Cenário A: somente rota calculada → rota_calculada.gpx
  if (xmlCalculada) {
    return {
      ok: true,
      cenario: 'CALCULADA',
      tipoArquivo: 'gpx',
      nomeArquivo: NOME_ARQUIVO_ROTA_CALCULADA,
      mimeType: 'application/gpx+xml',
      gpxXml: xmlCalculada,
      arquivos: [{ nome: NOME_ARQUIVO_ROTA_CALCULADA, conteudo: xmlCalculada }],
    };
  }

  // Cenário C: somente rota percorrida → rota_percorrida.gpx
  if (xmlPercorrida) {
    return {
      ok: true,
      cenario: 'PERCORRIDA',
      tipoArquivo: 'gpx',
      nomeArquivo: NOME_ARQUIVO_ROTA_PERCORRIDA,
      mimeType: 'application/gpx+xml',
      gpxXml: xmlPercorrida,
      arquivos: [{ nome: NOME_ARQUIVO_ROTA_PERCORRIDA, conteudo: xmlPercorrida }],
    };
  }

  if (erroGps && !rotaCalcCandidata) {
    return {
      ok: false,
      motivo: 'COORDENADAS_INVALIDAS',
      mensagem: erroGps.message,
    };
  }

  if (!rotaCalcCandidata && !xmlCalculada && !xmlPercorrida) {
    if (
      rotaPercorrida?.simulado === true ||
      (Array.isArray(pontosGps) && pontosGps.length > 0 && pontosReais.length === 0)
    ) {
      return {
        ok: false,
        motivo: 'SIMULACAO_NAO_EXPORTAVEL',
        mensagem: 'Execuções simuladas não representam percurso real de GPS.',
      };
    }
    if (gpsNaoSimulado || pontosReais.length > 0) {
      return {
        ok: false,
        motivo: 'SEM_GPS',
        mensagem: 'Não há registros GPS reais suficientes para gerar a rota percorrida (mínimo de 2 pontos válidos).',
      };
    }
  }

  if (erroCalculada) {
    const msg = erroCalculada.message || 'Calcule uma rota completa antes de exportar em GPX.';
    return {
      ok: false,
      motivo: /coordenadas|geometria/i.test(msg) ? 'GEOMETRIA_INVALIDA' : 'SEM_ROTA',
      mensagem: msg,
    };
  }

  if (erroGps) {
    return {
      ok: false,
      motivo: 'SEM_GPS',
      mensagem: erroGps.message,
    };
  }

  return {
    ok: false,
    motivo: 'SEM_ROTA',
    mensagem: 'Calcule uma rota completa ou registre um percurso GPS real antes de exportar em GPX.',
  };
}
