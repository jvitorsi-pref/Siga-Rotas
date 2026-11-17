/**
 * public/gpx.js
 * ---------------------------------------------------------------------------
 * Gerador puro e isomórfico de arquivos GPX 1.1 para rotas calculadas.
 * Compartilhado entre Web e APK; não altera o cálculo de rotas.
 */

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

function normalizarLinha(coords) {
  if (!Array.isArray(coords)) return [];
  const pontos = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const lon = Number(c[0]);
    const lat = Number(c[1]);
    if (!coordValida(lon, lat)) continue;
    pontos.push([lon, lat]);
  }
  return pontos;
}

function extrairLinhasGeometria(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.map(normalizarLinha).filter((pts) => pts.length >= 2);
  }
  const linha = normalizarLinha(geometry.coordinates);
  return linha.length >= 2 ? [linha] : [];
}

function extrairSegmentos(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  const segmentos = [];

  for (const leg of legs) {
    const linhas = extrairLinhasGeometria(leg?.geometry);
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
    const linhasRetorno = extrairLinhasGeometria(route.retorno.geometry);
    for (const pontos of linhasRetorno) {
      segmentos.push({
        de: route.retorno.de || '',
        para: route.retorno.para || '',
        retorno: true,
        pontos,
      });
    }
  }

  if (segmentos.length === 0 && route?.geometry) {
    for (const pontos of extrairLinhasGeometria(route.geometry)) {
      segmentos.push({ de: '', para: '', retorno: false, pontos });
    }
  }

  return segmentos;
}

function ordenarWaypoints(route, pontosLista) {
  let base = Array.isArray(route?.pontos) && route.pontos.length
    ? route.pontos
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
  if (Array.isArray(route?.sequencia)) {
    route.sequencia.forEach((rot, idx) => {
      if (rot && !ordemPorSequencia.has(rot)) ordemPorSequencia.set(rot, idx + 1);
    });
  }

  const comDados = base.map((p, i) => {
    const rotulo = p?.rotulo || String.fromCharCode(65 + i);
    const extra = porRotulo.get(rotulo) || null;
    const ordemSeq = ordemPorSequencia.get(rotulo);
    return {
      rotulo,
      latitude: Number(p?.latitude ?? extra?.latitude),
      longitude: Number(p?.longitude ?? extra?.longitude),
      enderecoDigital: p?.enderecoDigital || extra?.enderecoDigital || '',
      ordem: Number.isFinite(p?.ordem) ? p.ordem : (ordemSeq ?? i + 1),
      indiceOriginal: i,
    };
  }).filter((p) => coordValida(p.longitude, p.latitude));

  comDados.sort((a, b) => a.ordem - b.ordem || a.indiceOriginal - b.indiceOriginal);
  return comDados;
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
 * Gera um documento GPX 1.1 válido a partir de uma rota calculada completa.
 */
export function gerarGpxRota(route, opcoes = {}) {
  if (!route || route.ok === false || route.parcial) {
    throw new Error('Calcule uma rota completa antes de exportar em GPX.');
  }

  const segmentos = extrairSegmentos(route);
  if (segmentos.length === 0) {
    throw new Error('A rota calculada não possui geometria válida para exportação GPX.');
  }

  const waypoints = ordenarWaypoints(route, opcoes.pontos);
  const seq = (
    Array.isArray(route.sequenciaCompleta) && route.sequenciaCompleta.length
      ? route.sequenciaCompleta
      : Array.isArray(route.sequencia) && route.sequencia.length
        ? route.sequencia
        : waypoints.map((w) => w.rotulo)
  ).join(' → ');

  const modoTexto =
    route.modo === 'otimizada'
      ? 'Otimizada (menor distância total)'
      : route.modo === 'saida_curta'
        ? 'Otimizada (saída curta)'
        : 'Ordem do usuário';
  const distTexto = fmtDistancia(route.distance);
  const nomeRota = seq ? `Rota SIGA-Rotas (${seq})` : 'Rota SIGA-Rotas';
  const descParts = [
    route.circular ? 'Circuito a pé em Santo André' : 'Rota a pé em Santo André',
    seq ? `Sequência: ${seq}` : '',
    distTexto ? `Distância total: ${distTexto}` : '',
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
  ];

  waypoints.forEach((w, idx) => {
    const papel = idx === 0
      ? (route.circular ? 'Origem e destino (circuito)' : 'Origem')
      : (!route.circular && idx === waypoints.length - 1 ? 'Destino' : `Parada ${w.rotulo}`);
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

  linhas.push(
    '  <trk>',
    `    <name>${escapeXml(nomeRota)}</name>`,
    `    <desc>${escapeXml(descRota)}</desc>`,
    '    <type>Caminhada</type>',
  );

  for (const seg of segmentos) {
    linhas.push('    <trkseg>');
    for (const [lon, lat] of seg.pontos) {
      linhas.push(`      <trkpt lat="${fmtCoord(lat)}" lon="${fmtCoord(lon)}"/>`);
    }
    linhas.push('    </trkseg>');
  }

  linhas.push('  </trk>', '</gpx>', '');
  return linhas.join('\n');
}
