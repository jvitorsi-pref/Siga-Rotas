/** Apresenta somente valores devolvidos pelo motor; não calcula rotas/custos. */
export function rotuloModo(modo) {
  switch (modo) {
    case 'usuario': return 'Ordem do usuário';
    case 'otimizada': return 'Ordem otimizada';
    case 'saida_curta': return 'Ordem otimizada (saída curta)';
    default: return 'Modo não informado';
  }
}
function sequenciaAberta(seq) {
  if (!Array.isArray(seq)) return null;
  return seq.length > 1 && seq[0] === seq.at(-1) ? seq.slice(0, -1) : seq;
}
export function resumoRota(data = {}) {
  const partes = [rotuloModo(data.modo)];
  if (data.modo === 'usuario') partes.push('a sequência informada foi respeitada');
  if (['otimizada', 'saida_curta'].includes(data.modo)) {
    const metodo = data.otimizacao?.metodo;
    const metodos = {
      exato: 'método exato (Held-Karp)',
      'exato (desempate: saída curta)': 'método exato (Held-Karp, desempate pela saída curta)',
      heuristico: 'método heurístico (vizinho mais próximo + 2-opt; sem garantia de ótimo global)',
      trivial: 'ordem trivial, sem busca de permutações',
    };
    partes.push(Object.prototype.hasOwnProperty.call(metodos, metodo) ? metodos[metodo] : 'método de otimização não informado');
    const c = data.comparacao;
    if (Number.isFinite(c?.economia) && Number.isFinite(c?.economiaPercentual)) {
      const e = Math.abs(c.economia), p = Math.abs(c.economiaPercentual);
      const metros = e > 0 && e < 1 ? (Number(e.toFixed(1)) || 0).toFixed(1).replace('.', ',') : String(Math.round(e));
      const pct = (Number(p.toFixed(1)) || 0).toFixed(1).replace('.', ',');
      partes.push(c.economia < -1e-6 ? `distância ${metros} m (${pct} %) maior que a ordem do usuário` : `economia ${metros} m (${pct} %)`);
      const usuario = sequenciaAberta(data.sequenciaUsuario);
      const aplicada = sequenciaAberta(data.sequenciaCompleta?.length ? data.sequenciaCompleta : data.sequencia);
      if (Math.abs(c.economia) <= 1e-6 && usuario?.length && aplicada?.length && usuario.join('|') !== aplicada.join('|')) {
        partes.push('empate: a ordem mudou, mas o custo total é o mesmo');
      }
    } else partes.push('comparação com a ordem do usuário indisponível');
  }
  return partes.join(' · ');
}
