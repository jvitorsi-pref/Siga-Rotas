#!/usr/bin/env node
/**
 * Diagnóstico: MEDE a distância de cada EXTREMIDADE de eixo até o eixo mais
 * próximo (interior ou extremidade), para descobrir quantas junções estão
 * sendo deixadas de fora pela tolerância de 5 cm.
 *
 * A medição anterior (usada para justificar a tolerância) considerava apenas
 * pares extremidade x extremidade.  ABP-EXTREMIDADE x INTERIOR-DE-EIXO é o
 * caso que realmente importa: uma rua que termina 30 cm antes de cruzar
 * outra NÃO fica conectada, e o roteamento é obrigado a dar uma volta.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { project } from '../core/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const raw = JSON.parse(readFileSync(path.join(ROOT, 'data', 'network.snapshot.json'), 'utf8'));
const features = Array.isArray(raw) ? raw : raw.features;

/* ---- coleta as partes em coordenadas metricas ---- */
const parts = [];
for (const f of features) {
  const g = f.geometry;
  const rings = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    if (ring.length < 2) continue;
    const pts = ring.map(([lon, lat]) => project(lon, lat));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]);
    if (len < 0.01) continue;
    parts.push({ id: f.properties.ID, part: r, pts, feat: f.properties });
  }
}
console.log(`partes metricas: ${parts.length}`);

/* ---- segmentos de todas as partes (para busca de proximidade) ---- */
const segs = [];
for (let p = 0; p < parts.length; p++) {
  const pts = parts[p].pts;
  for (let i = 1; i < pts.length; i++) {
    segs.push({ p, i: i - 1, a: pts[i-1], b: pts[i] });
  }
}
console.log(`segmentos: ${segs.length}`);

/* ---- grade uniforme para acelerar ---- */
const CELL = 12; // metros
const grid = new Map();
const key = (ix, iy) => `${ix},${iy}`;
for (const s of segs) {
  const minx = Math.min(s.a[0], s.b[0]), maxx = Math.max(s.a[0], s.b[0]);
  const miny = Math.min(s.a[1], s.b[1]), maxy = Math.max(s.a[1], s.b[1]);
  for (let x = Math.floor(minx / CELL); x <= Math.floor(maxx / CELL); x++) {
    for (let y = Math.floor(miny / CELL); y <= Math.floor(maxy / CELL); y++) {
      const k = key(x, y);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(s);
    }
  }
}

/** distância de um ponto ao segmento */
function distToSeg(px, py, s) {
  const vx = s.b[0] - s.a[0], vy = s.b[1] - s.a[1];
  const wx = px - s.a[0], wy = py - s.a[1];
  const L2 = vx * vx + vy * vy;
  let t = L2 > 0 ? (wx * vx + wy * vy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = s.a[0] + t * vx, cy = s.a[1] + t * vy;
  return { d: Math.hypot(px - cx, py - cy), t };
}

/** distância do ponto ao eixo `p` (excluindo o próprio eixo) */
function nearestOther(px, py, p) {
  let best = Infinity;
  let bestSeg = null;
  const r = Math.ceil(Math.max(best, 60) / CELL) + 2;
  const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
  for (let ring = 0; ring <= r; ring++) {
    const found = [];
    for (let x = cx - ring; x <= cx + ring; x++) {
      for (let y = cy - ring; y <= cy + ring; y++) {
        if (ring > 0 && Math.abs(x - cx) !== ring && Math.abs(y - cy) !== ring) continue;
        const arr = grid.get(key(x, y));
        if (arr) found.push(...arr);
      }
    }
    for (const s of found) {
      if (s.p === p) continue;         // ignora o proprio eixo
      const { d } = distToSeg(px, py, s);
      if (d < best) { best = d; bestSeg = s; }
    }
    if (best < ring * CELL - CELL) break;
  }
  return { d: best, seg: bestSeg };
}

/* ---- mede as extremidades ---- */
const dists = [];
const porFaixa = new Map();
let total = 0;

for (let p = 0; p < parts.length; p++) {
  const pts = parts[p].pts;
  const extremos = [[pts[0], 0], [pts[pts.length - 1], pts.length - 1]];
  for (const [pt, vi] of extremos) {
    total++;
    const { d, seg } = nearestOther(pt[0], pt[1], p);
    dists.push({ d, p, vi, other: seg ? seg.p : -1 });
    const faixa =
      d < 0.01 ? '0 cm' :
      d < 0.05 ? '< 5 cm' :
      d < 0.10 ? '5-10 cm' :
      d < 0.25 ? '10-25 cm' :
      d < 0.50 ? '25-50 cm' :
      d < 1.0 ? '50 cm-1 m' :
      d < 2.0 ? '1-2 m' :
      d < 5.0 ? '2-5 m' :
      d < 10 ? '5-10 m' :
      d < 25 ? '10-25 m' :
      d < 50 ? '25-50 m' :
      d < 100 ? '50-100 m' : '> 100 m';
    porFaixa.set(faixa, (porFaixa.get(faixa) || 0) + 1);
  }
}

console.log(`\nDISTANCIA DE CADA EXTREMIDADE AO EIXO MAIS PROXIMO (${total} extremidades)`);
console.log('--------------------------------------------------------------------');
const ordem = ['0 cm','< 5 cm','5-10 cm','10-25 cm','25-50 cm','50 cm-1 m','1-2 m','2-5 m','5-10 m','10-25 m','25-50 m','50-100 m','> 100 m'];
for (const k of ordem) {
  const v = porFaixa.get(k);
  if (v) console.log(`  ${k.padEnd(12)} ${String(v).padStart(6)}`);
}

/* ---- casos que ficam SEM CONEXAO com a tolerancia de 5 cm ---- */
const semConexao = dists.filter((x) => x.d >= 0.05 && x.d < 25).sort((a, b) => a.d - b.d);
console.log(`\nEXTREMIDADES NAO CONECTADAS (5 cm <= d < 25 m): ${semConexao.length}`);
const limites = [0.10, 0.25, 0.50, 1, 2, 5, 10, 15, 25];
for (const b of limites) {
  console.log(`  com tolerancia de ${String(b).padStart(5)} m -> ${semConexao.filter((x) => x.d < b).length} conexoes novas`);
}

/* ---- amostra dos piores casos ---- */
console.log('\nAMOSTRA DAS MAIORES FALTAS (10-25 m):');
const piores = semConexao.filter((x) => x.d >= 10).slice(0, 15);
for (const x of piores) {
  const a = parts[x.p];
  const b = x.other >= 0 ? parts[x.other] : null;
  console.log(
    `  ${x.d.toFixed(2).padStart(6)} m  ${a.feat.DSC_LOGRADOURO || a.feat.NOM_LOGRADOURO} (ID ${a.id})` +
    `  ->  ${b ? (b.feat.DSC_LOGRADOURO || b.feat.NOM_LOGRADOURO) + ' (ID ' + b.id + ')' : '?'}`
  );
}
console.log();
