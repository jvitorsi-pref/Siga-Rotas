/** Contratos de integração do plano salvo. Não calcula ou altera rotas. */
import { criarListaPontos, criarPonto, rotularPontos, STATUS } from '../core/pontoTrajeto.js';
const pontosDoPlano = pontos => (pontos || []).map(p => ({
  rotulo: p.rotulo, latitude: p.latitude, longitude: p.longitude, enderecoDigital: p.enderecoDigital || null,
}));
export function assinaturaPlanejador(state) {
  return JSON.stringify({ modo: state.modo, circular: state.circuito === true, pontos: pontosDoPlano(state.lista.pontos) });
}
export function snapshotPlano(rota, pontos = rota?.pontos) {
  if (!rota || rota.ok === false || rota.parcial) throw new Error('Plano completo indisponível');
  const snapshot = {
    modo: rota.modo || 'usuario', circular: rota.circular === true, pontos: pontosDoPlano(pontos),
    sequencia: rota.sequencia || [], sequenciaCompleta: rota.sequenciaCompleta || [],
    legs: rota.legs || [], geometry: Array.isArray(rota.geometry) ? rota.geometry : rota.geometry?.coordinates || [],
    streets: rota.streets || [], distance: rota.distance,
  };
  const coord = c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
  if (!['usuario', 'otimizada', 'saida_curta'].includes(snapshot.modo) || snapshot.pontos.length < 2 ||
      snapshot.pontos.some(p => !coord([p.longitude, p.latitude])) || !Number.isFinite(snapshot.distance) || snapshot.distance < 0 ||
      !snapshot.legs.length || snapshot.legs.some(l => l.geometry?.type !== 'LineString' || !Array.isArray(l.geometry.coordinates) || l.geometry.coordinates.length < 2 || l.geometry.coordinates.some(c => !coord(c)))) {
    throw new Error('Plano salvo inválido ou sem trechos viários completos');
  }
  // Copia antes de qualquer await: edições posteriores não mudam o que é salvo.
  return JSON.parse(JSON.stringify(snapshot));
}
const canonical = valor => JSON.stringify(valor, function (_chave, v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v;
});
export async function persistirPlanoAtivo(armazenamento, rota, pontos, metadados = {}) {
  const snapshot = snapshotPlano(rota, pontos);
  const chave = canonical(snapshot);
  if (rota.id) {
    const original = await armazenamento.obterRota(rota.id);
    if (!original || (original.versao || 1) !== (rota.versao || 1) || canonical(snapshotPlano(original)) !== chave) {
      throw new Error('O plano salvo selecionado mudou ou não está mais disponível. Abra novamente o plano antes de iniciar');
    }
    return original;
  }
  const salvas = await armazenamento.listarRotas();
  const mesma = salvas.find(r => {
    try { return canonical(snapshotPlano(r)) === chave; } catch { return false; }
  });
  if (mesma) return mesma;
  // Nunca sobrescreve o plano de uma sessão anterior. Planos diferentes têm IDs diferentes.
  return armazenamento.salvarRota({ agenteId: metadados.agenteId, dispositivoId: metadados.dispositivoId, ...snapshot, versao: 1 });
}
export function prepararPlanoSalvo(registro) {
  const snapshot = snapshotPlano(registro);
  const lista = criarListaPontos();
  lista.circuito = snapshot.circular;
  lista.pontos = snapshot.pontos.map(p => criarPonto({ ...p, enderecoDigital: p.enderecoDigital || '', status: STATUS.CONVERTIDO, origem: 'salvo', mensagem: 'Coordenadas recuperadas do plano salvo.' }));
  rotularPontos(lista);
  return { lista, circuito: snapshot.circular, modo: snapshot.modo,
    rota: { ...snapshot, id: registro.id, versao: registro.versao || 1, ok: true, parcial: false, geometry: { type: 'LineString', coordinates: snapshot.geometry } } };
}
