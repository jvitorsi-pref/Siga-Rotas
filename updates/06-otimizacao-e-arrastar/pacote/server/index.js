/**
 * SERVIDOR HTTP DO MOTOR DE ROTEAMENTO VIÁRIO DE SANTO ANDRÉ
 * ===========================================================
 *
 * Serve a aplicação (OpenLayers) e a API JSON. Sem dependências externas:
 * apenas módulos nativos do Node (http, fs, url).
 *
 * Endpoints
 * ---------
 *  GET  /api/health          estado do cache e do grafo
 *  GET  /api/network         FeatureCollection GeoJSON da rede + diagnóstico
 *  GET  /api/route           ?origin=lon,lat&destination=lon,lat
 *  GET  /api/diagnostics     diagnóstico detalhado da construção do grafo
 *  GET  /api/layer-schema    DescribeFeatureType (atributos publicados)
 *  POST /api/refresh         força a reconstrução do grafo a partir do WFS
 *  GET  /api/endereco-digital ?codigo=...   resolve Endereço Digital (CEP Digital)
 *  GET  /api/rota-paradas ?pontos=json      rota com múltiplas paradas (A→B→C→D)
 *                                           ?modo=usuario|otimizada
 *
 * Uso:  node server/index.js [--port 8080] [--host 0.0.0.0]
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NetworkService } from './networkService.js';
import { routeOnGraph } from '../core/router.js';
import { calcularRotaComParadas } from '../core/rotaParadas.js';
import { criarServicoEnderecoDigital, MODOS } from '../core/enderecoDigitalService.js';
import { UPDATE_DEFAULTS } from '../core/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CORE_DIR = path.join(ROOT, 'core');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * Formata um intervalo em milissegundos de forma legível (minutos ou horas).
 */
function formatarIntervalo(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'desativada';
  if (ms % 3600000 === 0) return `${ms / 3600000} h`;
  if (ms % 60000 === 0) return `${ms / 60000} min`;
  return `${Math.round(ms / 1000)} s`;
}

function parseArgs(argv) {
  const args = {
    port: 8080,
    host: '0.0.0.0',
    noAutoUpdate: false,
    checkIntervalMs: UPDATE_DEFAULTS.checkIntervalMs,
    deepCheckIntervalMs: UPDATE_DEFAULTS.deepCheckIntervalMs,
  };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--port' || argv[i] === '-p') && argv[i + 1]) args.port = Number(argv[++i]);
    else if ((argv[i] === '--host' || argv[i] === '-h') && argv[i + 1]) args.host = argv[++i];
    else if (argv[i] === '--no-auto-update') args.noAutoUpdate = true;
    // os dois intervalos são expressos em MINUTOS (mesma unidade das
    // variáveis de ambiente CHECK_INTERVAL_MIN / DEEP_CHECK_INTERVAL_MIN)
    else if (argv[i] === '--check-interval' && argv[i + 1]) args.checkIntervalMs = Number(argv[++i]) * 60000;
    else if (argv[i] === '--deep-check-interval' && argv[i + 1]) args.deepCheckIntervalMs = Number(argv[++i]) * 60000;
  }
  if (Number.isFinite(Number(process.env.PORT))) args.port = Number(process.env.PORT);
  if (process.env.HOST) args.host = process.env.HOST;
  if (process.env.NO_AUTO_UPDATE === '1') args.noAutoUpdate = true;
  if (process.env.CHECK_INTERVAL_MIN) args.checkIntervalMs = Number(process.env.CHECK_INTERVAL_MIN) * 60000;
  if (process.env.DEEP_CHECK_INTERVAL_MIN) args.deepCheckIntervalMs = Number(process.env.DEEP_CHECK_INTERVAL_MIN) * 60000;
  return args;
}

/**
 * Converte "lon,lat" (ou JSON) em {lon, lat}.
 * @returns {null|{lon:number, lat:number}}
 */
export function parsePoint(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      const lon = Number(obj.lon ?? obj.longitude ?? obj.lng);
      const lat = Number(obj.lat ?? obj.latitude);
      if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
    } catch {
      return null;
    }
    return null;
  }
  const parts = text.split(/[;,\s]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

/** Envia uma resposta JSON. */
function sendJson(res, status, payload, compact) {
  // O payload da rede tem megabytes: sem indentacao, a resposta cai de
  // ~5,9 MB para ~2,7 MB.
  const body = compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

/**
 * Serve um arquivo estático com proteção contra path traversal.
 * `/core/*.js` também é servido: o módulo de pontos do trajeto é isomórfico e
 * o navegador o importa direto (o servidor é a única origem confiável).
 */
async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = decodeURIComponent(rel);
  const baseDir = rel.startsWith('/core/') ? CORE_DIR : PUBLIC_DIR;
  const filePath = path.join(baseDir, rel.startsWith('/core/') ? rel.slice('/core'.length) : rel);
  if (!filePath.startsWith(baseDir)) {
    sendJson(res, 403, { error: 'Acesso negado' });
    return;
  }
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const data = await readFile(filePath);

    // Os arquivos da aplicação são revalidados a cada visita (ETag), para
    // que uma correção no front-end apareça sem precisar limpar o cache do
    // navegador. As bibliotecas de terceiros (vendor/) podem ficar em cache
    // por uma hora: elas não mudam.
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const vendor = rel.startsWith('/vendor/');
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': vendor ? 'public, max-age=3600' : 'no-cache' });
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': vendor ? 'public, max-age=3600' : 'no-cache',
      ETag: etag,
    });
    res.end(data);
  } catch (err) {
    sendJson(res, 500, { error: `Falha ao ler o arquivo: ${err.message}` });
  }
}

/**
 * Cria o servidor HTTP (exportado para testes).
 * @param {object} [options]
 */
export function createServer(options = {}) {
  const service = options.service || new NetworkService(options.networkOptions);
  // Liga a verificação periódica de mudanças na camada. Só é possível
  // desligá-la com `autoUpdate: { enabled: false }` ou com o acesso ao WFS
  // desabilitado (caso dos testes).
  if (service.options.autoUpdate?.enabled) {
    service.startAutoUpdate();
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    try {
      // corpo JSON opcional (POST)
      let corpo = null;
      if (req.method === 'POST') {
        const bruto = await new Promise((resolve) => {
          let buf = '';
          req.on('data', (c) => {
            buf += c;
            if (buf.length > 1e6) req.destroy();
          });
          req.on('end', () => resolve(buf));
        });
        if (bruto && bruto.trim()) {
          try {
            corpo = JSON.parse(bruto);
          } catch {
            sendJson(res, 400, {
              ok: false,
              reason: 'JSON_INVALIDO',
              message: 'O corpo da requisição não é um JSON válido.',
            });
            return;
          }
        }
      }

      if (pathname === '/api/health') {
        sendJson(res, 200, service.status());
        return;
      }

      if (pathname === '/api/network') {
        const state = await service.ensureReady();
        sendJson(res, 200, {
          type: 'FeatureCollection',
          features: state.features,
          meta: {
            source: state.source,
            strategy: state.strategy,
            builtAt: new Date(state.builtAt).toISOString(),
            features: state.features.length,
            attributes: state.attributes,
            warnings: state.warnings,
            update: service.updateStatus(),
          },
        }, true);
        return;
      }

      if (pathname === '/api/route') {
        const origin = parsePoint(url.searchParams.get('origin'));
        const destination = parsePoint(url.searchParams.get('destination'));
        if (!origin || !destination) {
          sendJson(res, 400, {
            ok: false,
            reason: 'PARAMETROS_INVALIDOS',
            message:
              'Informe origem e destino no formato "longitude,latitude" ' +
              '(ex.: -46.5450,-23.6600).',
          });
          return;
        }
        const state = await service.ensureReady();
        const result = routeOnGraph(state.graph, origin, destination, {
          maxSnapDistance: options.maxSnapDistance ?? 100,
        });
        sendJson(res, result.ok ? 200 : 422, result);
        return;
      }

      // ------------------------------------------------------------------
      // Endereço Digital (CEP Digital) — normalização, validação e conversão
      // ------------------------------------------------------------------
      if (pathname === '/api/endereco-digital') {
        const codigo = corpo?.codigo ?? url.searchParams.get('codigo') ?? '';
        const modo = corpo?.modo ?? url.searchParams.get('modo') ?? MODOS.LOCAL;
        const servico = criarServicoEnderecoDigital({ modo });
        const resultado = await servico.resolver(codigo);
        sendJson(res, resultado.ok ? 200 : 422, {
          ok: resultado.ok,
          status: resultado.status,
          servico: servico.id,
          servicoDisponivel: servico.disponivel,
          codigoNormalizado: resultado.codigoNormalizado,
          codigoCompleto: resultado.codigoCompleto,
          latitude: resultado.latitude,
          longitude: resultado.longitude,
          naRegiao: resultado.naRegiao,
          mensagem: resultado.mensagem,
        });
        return;
      }

      // ------------------------------------------------------------------
      // Rota com múltiplas paradas (A → B → C → D), na ordem do usuário
      // ------------------------------------------------------------------
      if (pathname === '/api/rota-paradas') {
        let pontos = corpo?.pontos;
        if (!pontos && url.searchParams.get('pontos')) {
          try {
            pontos = JSON.parse(url.searchParams.get('pontos'));
          } catch {
            pontos = null;
          }
        }
        if (!Array.isArray(pontos) || pontos.length < 2) {
          sendJson(res, 400, {
            ok: false,
            reason: 'PARAMETROS_INVALIDOS',
            message:
              'Informe ao menos dois pontos no formato ' +
              '[{"rotulo":"A","latitude":-23.66,"longitude":-46.53}, ...].',
          });
          return;
        }
        const state = await service.ensureReady();
        const modo = (corpo?.modo ?? url.searchParams.get('modo') ?? 'usuario').toString();
        const resultado = calcularRotaComParadas(state.graph, pontos, {
          maxSnapDistance: options.maxSnapDistance ?? 100,
          modo: modo === 'otimizada' ? 'otimizada' : 'usuario',
        });
        sendJson(res, resultado.ok ? 200 : 422, resultado);
        return;
      }

      if (pathname === '/api/diagnostics') {
        const state = await service.ensureReady();
        sendJson(res, 200, {
          ...state.diagnostics,
          source: state.source,
          strategy: state.strategy,
          builtAt: new Date(state.builtAt).toISOString(),
          buildMs: state.elapsedMs,
          serverTotal: state.serverTotal,
          attributes: state.attributes,
        });
        return;
      }

      if (pathname === '/api/updates') {
        // força uma verificação imediata e devolve o resultado
        const result = await service._checkForChanges({ deep: true });
        sendJson(res, 200, { ok: true, ...result, status: service.updateStatus() });
        return;
      }

      if (pathname === '/api/layer-schema') {
        const schema = await service.schema();
        sendJson(res, 200, {
          attributes: schema.attributes,
          knownAttributes: schema.known,
          layer: service.options.layerName,
        });
        return;
      }

      if (pathname === '/api/refresh' && req.method === 'POST') {
        const state = await service.refresh();
        sendJson(res, 200, {
          ok: true,
          source: state.source,
          strategy: state.strategy,
          features: state.features.length,
          nodes: state.diagnostics.nodes,
          edges: state.diagnostics.edges,
          elapsedMs: state.elapsedMs,
        });
        return;
      }

      if (pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'Endpoint desconhecido' });
        return;
      }

      await serveStatic(req, res, pathname);
    } catch (err) {
      console.error('[servidor]', err);
      sendJson(res, 500, {
        ok: false,
        reason: 'ERRO_INTERNO',
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      });
    }
  });

  server.networkService = service;
  return server;
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const server = createServer({
    networkOptions: {
      autoUpdate: {
        enabled: !args.noAutoUpdate,
        checkIntervalMs: args.checkIntervalMs,
        deepCheckIntervalMs: args.deepCheckIntervalMs,
      },
    },
  });
  server.listen(args.port, args.host, () => {
    const shown = args.host === '0.0.0.0' ? 'localhost' : args.host;
    console.log(`\n  Motor de roteamento viário de Santo André`);
    console.log(`  ------------------------------------------------`);
    console.log(`  Aplicação : http://${shown}:${args.port}/`);
    console.log(`  API       : http://${shown}:${args.port}/api/health`);
    console.log(`  Rede      : carregando sob demanda (primeira rota ou /api/network)`);
    console.log(
      `  Atualização: ${
        args.noAutoUpdate
          ? 'desligada (--no-auto-update)'
          : `automática (verificação a cada ${formatarIntervalo(args.checkIntervalMs)}, ` +
            `completa a cada ${formatarIntervalo(args.deepCheckIntervalMs)})`
      }\n`
    );
  });
}
