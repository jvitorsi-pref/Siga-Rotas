export const ESTADOS_SHEET = {
  COLLAPSED: 'collapsed',
  MID: 'mid',
  EXPANDED: 'expanded',
};

export function normalizarEstadoSheet(estado) {
  if (estado === ESTADOS_SHEET.COLLAPSED || estado === ESTADOS_SHEET.EXPANDED) {
    return estado;
  }
  return ESTADOS_SHEET.MID;
}

export function calcularAlturasSheet(containerHeight = 720) {
  const h = Math.max(360, Number(containerHeight) || 720);
  const collapsed = Math.round(Math.min(92, Math.max(74, h * 0.12)));
  const expanded = Math.round(Math.max(collapsed + 220, Math.min(h - 62, h * 0.9)));
  const midBruto = Math.round(h * 0.48);
  const mid = Math.round(Math.min(expanded - 60, Math.max(collapsed + 140, midBruto)));
  return {
    collapsed,
    mid,
    expanded,
  };
}

export function alturaDoEstadoSheet(estado, alturas) {
  const norm = normalizarEstadoSheet(estado);
  return alturas[norm] ?? alturas.mid;
}

export function proximoEstadoPorToque(estadoAtual) {
  const norm = normalizarEstadoSheet(estadoAtual);
  if (norm === ESTADOS_SHEET.COLLAPSED) return ESTADOS_SHEET.MID;
  if (norm === ESTADOS_SHEET.MID) return ESTADOS_SHEET.EXPANDED;
  return ESTADOS_SHEET.MID;
}

export function resolverProximoEstadoSheet({
  estadoAtual = ESTADOS_SHEET.MID,
  alturaAtual = null,
  dy = 0,
  vy = 0,
  alturas = calcularAlturasSheet(720),
} = {}) {
  const atual = normalizarEstadoSheet(estadoAtual);
  const ordem = [ESTADOS_SHEET.COLLAPSED, ESTADOS_SHEET.MID, ESTADOS_SHEET.EXPANDED];
  const idx = ordem.indexOf(atual);
  const baseAltura = alturaDoEstadoSheet(atual, alturas);
  const alturaFinal = Number.isFinite(alturaAtual)
    ? alturaAtual
    : Math.max(alturas.collapsed, Math.min(alturas.expanded, baseAltura - dy));

  // Gesto rápido (flick vertical) ou arraste firme muda de estágio na direção do gesto
  if (vy <= -0.45 || dy <= -64) {
    if (vy <= -1.15 || dy <= -(alturas.expanded - alturas.collapsed) * 0.6) {
      return ESTADOS_SHEET.EXPANDED;
    }
    return ordem[Math.min(ordem.length - 1, idx + 1)];
  }
  if (vy >= 0.45 || dy >= 64) {
    if (vy >= 1.15 || dy >= (alturas.expanded - alturas.collapsed) * 0.6) {
      return ESTADOS_SHEET.COLLAPSED;
    }
    return ordem[Math.max(0, idx - 1)];
  }

  // Sem velocidade forte: encaixa no estágio mais próximo pela altura final
  let melhorEstado = atual;
  let menorDist = Infinity;
  for (const cand of ordem) {
    const d = Math.abs(alturas[cand] - alturaFinal);
    if (d < menorDist) {
      menorDist = d;
      melhorEstado = cand;
    }
  }
  return melhorEstado;
}

export function calcularInsetMapaParaSheet(estado, alturas) {
  const norm = normalizarEstadoSheet(estado);
  if (norm === ESTADOS_SHEET.COLLAPSED) return alturas.collapsed;
  if (norm === ESTADOS_SHEET.MID) return alturas.mid;
  // Quando expandido, preserva o enquadramento do mapa para a faixa visível superior (ou mid)
  return Math.min(alturas.mid, Math.round(alturas.expanded * 0.55));
}
