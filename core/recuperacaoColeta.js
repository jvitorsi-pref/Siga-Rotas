/** Preparação da fonte simulada após reinício, sem depender de DOM/GPS. */
import { planoDeNavegacao, projetarNoPlano } from './navegacao.js';

export async function prepararRetomadaSimulada(armazenamento, estado) {
  const rota = estado.rotaId ? await armazenamento.obterRota(estado.rotaId) : null;
  if (!rota || (rota.versao || 1) !== estado.versaoRota) {
    return { ok: false, message: 'O plano original desta coleta simulada não está disponível na mesma versão. A coleta permanece pausada; nenhum GPS real será iniciado.' };
  }
  const legs = rota.legs || [];
  if (!legs.length || legs.some(l => l.geometry?.type !== 'LineString' || l.geometry.coordinates?.length < 2)) {
    return { ok: false, message: 'O plano salvo não contém os trechos necessários para retomar a simulação. A coleta permanece pausada.' };
  }
  const plano = planoDeNavegacao(rota);
  if (!Number.isFinite(plano.total) || plano.total <= 0 || plano.xy.some(n => !Number.isFinite(n))) {
    return { ok: false, message: 'O plano salvo é inválido para simulação. A coleta permanece pausada.' };
  }
  const pontos = await armazenamento.listarPontos(estado.sessaoId);
  const ultimo = pontos.at(-1);
  const distancia = ultimo
    ? projetarNoPlano(plano, ultimo.longitude, ultimo.latitude, estado.distancia).percorrido
    : 0;
  return { ok: true, plano, distancia };
}
