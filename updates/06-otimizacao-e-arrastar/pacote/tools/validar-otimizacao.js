/**
 * tools/validar-otimizacao.js
 * ---------------------------------------------------------------------------
 * Valida a OTIMIZAÇÃO DA ORDEM DE VISITA sobre a rede REAL de Santo André.
 *
 * O que este script faz:
 *   1. monta o grafo real (a partir do snapshot WFS em disco);
 *   2. escolhe N pontos reais **dentro do maior componente conexo** (é
 *      obrigatório: a rede tem 342 componentes e pontos em componentes
 *      diferentes não têm caminho entre si);
 *   3. chama a API `/api/rota-paradas` nos dois modos:
 *        · `usuario`   — respeita a ordem informada;
 *        · `otimizada` — escolhe a ordem de menor caminho total;
 *   4. compara: a rota otimizada nunca pode ser mais longa, e a economia
 *      é reportada.
 *
 * Uso:  node tools/validar-otimizacao.js [numeroDePontos]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildGraph } from '../core/graph.js';
import { unproject } from '../core/geo.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.API_BASE || 'http://127.0.0.1:8080';

const N_PONTOS = Number(process.argv[2] || 5);

const snapshot = JSON.parse(readFileSync(join(RAIZ, 'data/network.snapshot.json'), 'utf8'));
const features = snapshot.features || snapshot;

console.log('='.repeat(72));
console.log('VALIDAÇÃO DA OTIMIZAÇÃO DE PARADAS — rede real de Santo André');
console.log('='.repeat(72));
console.log(`feições do snapshot : ${features.length}`);

const graph = buildGraph(features, {});
console.log(
  `grafo               : ${graph.diagnostics.nodes} nós, ${graph.diagnostics.edges} arestas, ` +
    `${graph.diagnostics.components} componentes (maior = ${graph.diagnostics.largestComponent})`,
);

// ── pontos no maior componente ─────────────────────────────────────────────
const compSizes = new Map();
for (let i = 0; i < graph.nodes.length; i++) {
  const c = graph.componentOf[i];
  compSizes.set(c, (compSizes.get(c) || 0) + 1);
}
const maiorComp = [...compSizes.entries()].sort((a, b) => b[1] - a[1])[0][0];
const nosDoMaior = [];
for (let i = 0; i < graph.nodes.length; i++) {
  if (graph.componentOf[i] === maiorComp) nosDoMaior.push(i);
}
console.log(`maior componente    : ${nosDoMaior.length} nós`);

// amostragem "farthest point": pontos bem espalhados dentro do componente
function pontoDoNo(i) {
  const n = graph.nodes[i];
  const [lon, lat] = unproject(n.x, n.y);
  return { longitude: lon, latitude: lat };
}
const escolhidos = [nosDoMaior[Math.floor(nosDoMaior.length * 0.5)]];
while (escolhidos.length < N_PONTOS) {
  let melhor = -1;
  let melhorDist = -1;
  for (const cand of nosDoMaior) {
    const c = graph.nodes[cand];
    let dMin = Infinity;
    for (const e of escolhidos) {
      const s = graph.nodes[e];
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d < dMin) dMin = d;
    }
    if (dMin > melhorDist) {
      melhorDist = dMin;
      melhor = cand;
    }
  }
  escolhidos.push(melhor);
}
const pontos = escolhidos.map((i, k) => ({
  rotulo: String.fromCharCode(65 + k),
  ...pontoDoNo(i),
}));
console.log('pontos escolhidos   :');
for (const p of pontos) {
  console.log(`  ${p.rotulo}  ${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`);
}

// ── ordens de referência: várias permutações das paradas do meio ──────────
// (A e D são fixos: origem e destino não mudam de lugar)
const meio = pontos.slice(1, -1);

function permutacoesDeterministicas(lista, quantas) {
  // permutações fixas (sem aleatoriedade real) para que a validação seja
  // reproduzível: reversão, ordenações geográficas e embaralhamentos com
  // um gerador congruencial de semente fixa.
  const porLon = [...lista].sort((a, b) => a.longitude - b.longitude);
  const porLat = [...lista].sort((a, b) => a.latitude - b.latitude);
  const base = [
    [...lista].reverse(),
    porLon,
    porLat,
    [...lista].sort((a, b) => a.longitude + a.latitude - (b.longitude + b.latitude)),
  ];
  let semente = 20261027;
  const rnd = () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  };
  while (base.length < quantas) {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    base.push(copia);
  }
  const saida = [];
  for (const p of base) {
    const chave = p.map((x) => x.rotulo).join();
    if (!saida.some((s) => s.map((x) => x.rotulo).join() === chave)) saida.push(p);
  }
  return saida;
}

const ordens = permutacoesDeterministicas(meio, 6);
const pontosDesordenados = [pontos[0], ...ordens[0], pontos[pontos.length - 1]];
console.log(
  'ordem informada     : ' + pontosDesordenados.map((p) => p.rotulo).join(' → '),
);
console.log(`ordens testadas    : ${ordens.length} (A e D fixos)`);

// ── chamadas à API ─────────────────────────────────────────────────────────
async function chamar(modo, lista) {
  const res = await fetch(`${API}/api/rota-paradas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pontos: lista, modo }),
  });
  return { status: res.status, corpo: await res.json() };
}

const t0 = Date.now();
const usuario = await chamar('usuario', pontosDesordenados);
const t1 = Date.now();
const otimizada = await chamar('otimizada', pontosDesordenados);
const t2 = Date.now();
const resumoOrdens = [];

console.log('');
console.log(`modo "usuario"    : HTTP ${usuario.status} — ${usuario.corpo.ok ? 'OK' : 'ERRO'} (${t1 - t0} ms)`);
if (!usuario.corpo.ok) {
  console.log('  motivo:', usuario.corpo.reason, '—', usuario.corpo.message);
}
if (usuario.corpo.ok) {
  console.log(
    `  sequência: ${usuario.corpo.sequencia.join(' → ')}  |  ` +
      `${usuario.corpo.distanceMeters} m (${usuario.corpo.distanceKm.toFixed(2)} km) | ` +
      `${usuario.corpo.legs.length} trechos`,
  );
}
console.log(`modo "otimizada"  : HTTP ${otimizada.status} — ${otimizada.corpo.ok ? 'OK' : 'ERRO'} (${t2 - t1} ms)`);
if (!otimizada.corpo.ok) {
  console.log('  motivo:', otimizada.corpo.reason, '—', otimizada.corpo.message);
}
if (otimizada.corpo.ok) {
  console.log(
    `  sequência: ${otimizada.corpo.sequencia.join(' → ')}  |  ` +
      `${otimizada.corpo.distanceMeters} m (${otimizada.corpo.distanceKm.toFixed(2)} km) | ` +
      `${otimizada.corpo.legs.length} trechos`,
  );
  console.log(
    `  método   : ${otimizada.corpo.otimizacao.metodo}` +
      (otimizada.corpo.otimizacao.ms != null ? ` (${otimizada.corpo.otimizacao.ms} ms)` : ''),
  );
  if (otimizada.corpo.comparacao) {
    const c = otimizada.corpo.comparacao;
    console.log(
      `  economia : ${c.economia.toFixed(1)} m (${c.economiaPercentual.toFixed(1)} %) ` +
        `— de ${c.distanciaUsuario.toFixed(1)} m para ${c.distanciaOtimizada.toFixed(1)} m`,
    );
  }
  console.log(
    `  vértices : ${otimizada.corpo.geometry.coordinates.length} na geometria concatenada`,
  );
}

// ── outras ordens do usuário: a otimização deve vencer (ou empatar) ──────
console.log('');
console.log('comparação com outras ordens informadas:');
for (const ordem of ordens) {
  const lista = [pontos[0], ...ordem, pontos[pontos.length - 1]];
  const u = await chamar('usuario', lista);
  const o = await chamar('otimizada', lista);
  const linha = {
    informada: lista.map((p) => p.rotulo).join('→'),
    usuario: u.corpo.ok ? u.corpo.distance : null,
    otimizada: o.corpo.ok ? o.corpo.distance : null,
    metodo: o.corpo.ok ? o.corpo.otimizacao?.metodo : null,
  };
  linha.economia =
    linha.usuario != null && linha.otimizada != null ? linha.usuario - linha.otimizada : null;
  resumoOrdens.push(linha);
  console.log(
    `  ${linha.informada.padEnd(16)} usuário ${String(Math.round(linha.usuario ?? NaN)).padStart(7)} m | ` +
      `otimizada ${String(Math.round(linha.otimizada ?? NaN)).padStart(7)} m | ` +
      `economia ${linha.economia == null ? '—' : Math.round(linha.economia) + ' m'} | ${linha.metodo ?? '—'}`,
  );
}

// ── veredito ───────────────────────────────────────────────────────────────
console.log('');
let ok = true;
if (!otimizada.corpo.ok) {
  console.log('✗ a otimização falhou na rede real');
  ok = false;
} else {
  const custoUsuario = usuario.corpo.ok ? usuario.corpo.distance : null;
  if (custoUsuario != null && otimizada.corpo.distance > custoUsuario + 1e-6) {
    console.log(`✗ a rota otimizada é MAIOR que a do usuário (${otimizada.corpo.distance} > ${custoUsuario})`);
    ok = false;
  } else if (custoUsuario != null) {
    console.log(
      `✓ a rota otimizada não é pior: ${custoUsuario.toFixed(1)} m → ${otimizada.corpo.distance.toFixed(1)} m`,
    );
  }
  const soma = otimizada.corpo.legs.reduce((s, l) => s + l.distance, 0);
  if (Math.abs(soma - otimizada.corpo.distance) > 1e-6) {
    console.log('✗ a soma dos trechos não bate com a distância total');
    ok = false;
  } else {
    console.log('✓ a soma dos trechos bate com a distância total');
  }
  if (otimizada.corpo.legs.some((l) => !l.geometry || l.geometry.coordinates.length < 2)) {
    console.log('✗ algum trecho veio sem geometria');
    ok = false;
  } else {
    console.log('✓ todos os trechos têm geometria (nenhuma linha reta)');
  }
  const pior = Math.min(...resumoOrdens.filter((r) => r.economia != null).map((r) => r.economia));
  if (pior < -1e-6) {
    console.log(`✗ em alguma ordem a otimização ficou PIOR (${pior} m)`);
    ok = false;
  } else {
    console.log(`✓ em todas as ordens testadas a otimização foi melhor ou igual (pior economia ${Math.round(pior)} m)`);
  }
  const comEconomia = resumoOrdens.filter((r) => r.economia > 0);
  if (comEconomia.length) {
    const melhor = comEconomia.reduce((a, b) => (a.economia > b.economia ? a : b));
    console.log(
      `✓ melhor economia: ${Math.round(melhor.economia)} m na ordem ${melhor.informada} ` +
        `(${((melhor.economia / melhor.usuario) * 100).toFixed(1)} %)`,
    );
  }
}
console.log('');
console.log(ok ? 'VALIDAÇÃO APROVADA' : 'VALIDAÇÃO REPROVADA');
process.exit(ok ? 0 : 1);
