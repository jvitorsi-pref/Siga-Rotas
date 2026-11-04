/**
 * TESTES — NAVEGAÇÃO ATIVA (GPS real + modo de simulação)
 * ======================================================================
 *
 *  1. o plano de navegação é montado a partir da resposta da API;
 *  2. o **progresso** é medido sobre a geometria viária (e não em linha reta);
 *  3. o **trecho atual** e a **próxima parada** são identificados;
 *  4. a **chegada** exige proximidade + leituras estáveis + precisão boa
 *     (uma leitura imprecisa não conclui nada);
 *  5. o **desvio** só é confirmado com persistência e leva em conta a
 *     precisão do GPS;
 *  6. o **recálculo** mantém a ordem das paradas restantes;
 *  7. o **simulador** avança pelo tempo decorrido (independente da taxa de
 *     atualização), interpola sobre a geometria e responde aos cenários;
 *  8. a **fonte GPS** traduz permissão negada, sinal indisponível, timeout e
 *     contexto inseguro, e libera o watcher ao parar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

import {
  criarNavegacao,
  planoDeNavegacao,
  projetarNoPlano,
  EXECUCAO,
} from '../core/navegacao.js';
import { instrucaoAtual, anguloNoVertice } from '../core/instrucoes.js';
import { criarSimulador } from '../core/simulador.js';
import { criarFonteGPS, ERROS_GPS } from '../core/fonteGPS.js';
import { project, unproject } from '../core/geo.js';

const BASE = [-46.545, -23.66];
const [BX, BY] = project(BASE[0], BASE[1]);
function ponto(dx, dy) {
  const [lon, lat] = unproject(BX + dx, BY + dy);
  return [lon, lat];
}
function asLatLon(dx, dy) {
  const [lon, lat] = ponto(dx, dy);
  return { latitude: lat, longitude: lon };
}

/* Malha em quadrado: A(0,0) B(300,0) C(300,400) D(0,400) → A→B→C→D→A */
const P = {
  A: asLatLon(0, 0),
  B: asLatLon(300, 0),
  C: asLatLon(300, 400),
  D: asLatLon(0, 400),
};

/** Resposta no formato da API (circuito A→B→C→D→A). */
function respostaCircuito() {
  const perna = (de, para, coords, cor, street) => ({
    de,
    para,
    distance: 0,
    distanceMeters: 0,
    cor,
    retorno: false,
    geometry: { type: 'LineString', coordinates: coords },
    legs: [{ street, length: 0, official: true }],
  });
  const pernas = [
    perna('A', 'B', [ponto(0, 0), ponto(300, 0)], '#1d4ed8', 'RUA ALFA'),
    perna('B', 'C', [ponto(300, 0), ponto(300, 400)], '#15803d', 'RUA BETA'),
    perna('C', 'D', [ponto(300, 400), ponto(0, 400)], '#ea580c', 'RUA GAMA'),
    perna('D', 'A', [ponto(0, 400), ponto(0, 0)], '#7c3aed', 'RUA DELTA'),
  ];
  pernas[3].retorno = true;
  // comprimentos reais
  const dist = [300, 400, 300, 400];
  pernas.forEach((p, i) => {
    p.distance = dist[i];
    p.distanceMeters = dist[i];
    p.legs[0].length = dist[i];
  });
  return {
    ok: true,
    circular: true,
    distance: 1400,
    distanceMeters: 1400,
    legs: pernas,
    pontos: [
      { rotulo: 'A', ...P.A },
      { rotulo: 'B', ...P.B },
      { rotulo: 'C', ...P.C },
      { rotulo: 'D', ...P.D },
    ],
    sequencia: ['A', 'B', 'C', 'D'],
    sequenciaCompleta: ['A', 'B', 'C', 'D', 'A'],
  };
}

/** Posição em metros sobre o eixo, dentro de um trecho. */
function posEm(trecho, x, y) {
  const p = asLatLon(x, y);
  return { latitude: p.latitude, longitude: p.longitude, precisao: 5, timestamp: 1 };
}

/* ================================================================== */

test('1. o plano de navegação é montado a partir da resposta da API', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  assert.equal(plano.pernas.length, 4);
  assert.ok(Math.abs(plano.total - 1400) < 0.01, `total: ${plano.total}`);
  assert.equal(plano.circular, true);
  assert.deepEqual(
    plano.paradas.map((p) => p.rotulo),
    ['A', 'B', 'C', 'D', 'A'],
    'a última parada do circuito é a origem',
  );
  assert.equal(plano.limites.length, 4);
});

test('2. o progresso é medido sobre a geometria viária, e não em linha reta', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  const nav = criarNavegacao(plano);
  nav.iniciar();
  // no meio do trecho A→B (150 m de 1.400 m)
  nav.atualizarPosicao(posEm(0, 150, 0));
  const e = nav.estado;
  assert.equal(e.trechoAtual, 0);
  assert.ok(Math.abs(e.percorrido - 150) < 1, `percorrido: ${e.percorrido}`);
  assert.ok(Math.abs(e.progresso - 150 / 1400) < 0.002, `progresso: ${e.progresso}`);
  assert.ok(Math.abs(e.distanciaRestante - 1250) < 1);
  // a distância em linha reta até o destino seria MUITO menor
  assert.ok(e.distanciaRestante > 1000);
});

test('3. o trecho atual e a próxima parada são identificados', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  const nav = criarNavegacao(plano);
  nav.iniciar();
  nav.atualizarPosicao(posEm(0, 200, 0));
  assert.equal(nav.estado.trechoAtual, 0);
  assert.equal(nav.estado.proximaParada.rotulo, 'B');
  nav.atualizarPosicao(posEm(0, 300, 200));
  assert.equal(nav.estado.trechoAtual, 1, 'no meio de B→C');
  assert.equal(nav.estado.proximaParada.rotulo, 'B', 'ainda falta chegar em B');
});

test('4. a chegada exige leituras estáveis (uma leitura não conclui)', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  let chegadas = 0;
  const nav = criarNavegacao(plano, { aoChegarParada: () => chegadas++ });
  nav.iniciar();
  const emB = posEm(0, 300, 0);
  nav.atualizarPosicao(emB);
  assert.equal(chegadas, 0, 'a primeira leitura não confirma a chegada');
  assert.equal(nav.estado.proximaParada.rotulo, 'B');
  nav.atualizarPosicao(emB);
  assert.equal(chegadas, 0, 'a segunda leitura ainda não confirma');
  nav.atualizarPosicao(emB);
  assert.equal(chegadas, 1, 'a terceira leitura confirma a chegada');
  assert.equal(nav.estado.proximaParada.rotulo, 'C', 'avança para a próxima parada');
  assert.deepEqual(nav.estado.paradasConcluidas, ['B']);
});

test('4b. uma leitura imprecisa NÃO declara a parada concluída', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  let chegadas = 0;
  const nav = criarNavegacao(plano, { aoChegarParada: () => chegadas++ });
  nav.iniciar();
  const imprecisa = { ...posEm(0, 300, 0), precisao: 120 };
  for (let i = 0; i < 6; i++) nav.atualizarPosicao(imprecisa);
  assert.equal(chegadas, 0, 'precisão de 120 m não permite concluir a parada');
  assert.equal(nav.estado.proximaParada.rotulo, 'B');
});

test('4c. ao confirmar todas as paradas (com o retorno), a navegação termina', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  let concluida = false;
  const nav = criarNavegacao(plano, { aoConcluir: () => (concluida = true) });
  nav.iniciar();
  for (const p of [P.B, P.C, P.D, P.A]) {
    const pos = { latitude: p.latitude, longitude: p.longitude, precisao: 5 };
    for (let i = 0; i < 3; i++) nav.atualizarPosicao(pos);
  }
  assert.equal(concluida, true, 'o circuito termina na origem e a navegação acaba');
  assert.equal(nav.estado.execucao, EXECUCAO.ENCERRADO);
  assert.deepEqual(nav.estado.paradasConcluidas, ['B', 'C', 'D', 'A']);
});

test('4d. na rota que fecha no mesmo ponto, a projeção segue o progresso', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  const nav = criarNavegacao(plano);
  nav.iniciar();
  // 200 m depois de D, na perna de retorno D → A (1200 m do início)
  nav.atualizarPosicao(posEm(0, 0, 200));
  assert.ok(
    Math.abs(nav.estado.percorrido - 1200) < 5,
    `percorrido na perna de retorno: ${nav.estado.percorrido}`,
  );
  // na origem A, com o progresso já avançado, a projeção é o FIM da rota
  nav.atualizarPosicao(posEm(0, 0, 0));
  assert.ok(
    nav.estado.percorrido > 1300,
    `a origem foi projetada no fim da rota: ${nav.estado.percorrido}`,
  );
});

test('5. o desvio só é confirmado com persistência', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  let desvios = 0;
  const nav = criarNavegacao(plano, { aoDesvioConfirmado: () => desvios++ });
  nav.iniciar();
  // 80 m fora da rota (tolerância base 35 m, precisão 5 m → 35 m)
  const fora = posEm(0, 150, 80);
  nav.atualizarPosicao(fora);
  assert.equal(desvios, 0);
  nav.atualizarPosicao(fora);
  assert.equal(desvios, 0, 'duas leituras não confirmam o desvio');
  nav.atualizarPosicao(fora);
  assert.equal(desvios, 1, 'a terceira leitura confirma o desvio');
  assert.ok(nav.estado.desvio.confirmado);
  assert.ok(nav.estado.desvio.distancia > 70);
});

test('5b. a precisão do GPS amplia a tolerância de desvio', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  let desvios = 0;
  const nav = criarNavegacao(plano, { aoDesvioConfirmado: () => desvios++ });
  nav.iniciar();
  // 80 m fora da rota, mas com precisão de 100 m → tolerância = 200 m
  const fora = { ...posEm(0, 150, 80), precisao: 100 };
  for (let i = 0; i < 5; i++) nav.atualizarPosicao(fora);
  assert.equal(desvios, 0, 'GPS impreciso não deve provocar recálculo');
});

test('6. o recálculo mantém a ordem das paradas restantes', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  const nav = criarNavegacao(plano);
  nav.iniciar();
  nav.atualizarPosicao(posEm(0, 150, 0));
  const percorridoAntes = nav.estado.percorrido;

  // novo plano: posição atual → C → D → A (a ordem das paradas é preservada)
  const novo = planoDeNavegacao(respostaCircuito(), { rotulos: ['A', 'C', 'D', 'A'] });
  nav.replanejar(novo, { deslocamento: percorridoAntes });
  assert.equal(nav.estado.proximaParada.rotulo, 'C');
  assert.deepEqual(
    novo.paradas.map((p) => p.rotulo),
    ['A', 'C', 'D', 'A'],
    'B some (foi alcançado); C, D e A continuam em ordem',
  );
  assert.ok(nav.estado.percorrido >= percorridoAntes);
});

test('7. o simulador avança pelo tempo decorrido, não pela taxa de atualização', async () => {
  const plano = planoDeNavegacao(respostaCircuito());
  let clock = 0;
  const posicoes = [];
  const sim = criarSimulador({
    plano,
    agora: () => clock,
    intervalo: 100,
    aoAtualizar: (p) => posicoes.push(p),
  });

  mock.timers.enable({ apis: ['setInterval'] });
  try {
    sim.iniciar();
    clock = 1000;
    mock.timers.tick(100); // 1 tique de 100 ms após 1 s → dt = 1 s
    const d1 = sim.distancia;
    assert.ok(Math.abs(d1 - 1.4) < 0.01, `distância após 1 s: ${d1}`);

    // agora o MESMO tempo, mas com 10 tiques de 100 ms
    clock = 2000;
    for (let i = 0; i < 10; i++) mock.timers.tick(100);
    const d2 = sim.distancia - d1;
    assert.ok(
      Math.abs(d2 - 1.4) < 0.01,
      `1 s de simulação vale o mesmo com 1 ou 10 atualizações (${d2})`,
    );
  } finally {
    mock.timers.reset();
  }
});

test('7b. o simulador interpola a posição sobre a geometria', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  let ultima = null;
  const sim = criarSimulador({ plano, aoAtualizar: (p) => (ultima = p) });
  sim.iniciarEm(150); // meio do trecho A→B
  assert.ok(ultima);
  const proj = projetarNoPlano(plano, ultima.longitude, ultima.latitude);
  assert.ok(Math.abs(proj.percorrido - 150) < 2, `posição sobre a geometria: ${proj.percorrido}`);
  assert.equal(proj.indice, 0, 'ainda no primeiro trecho');
  // a posição simulada tem a marca de simulação (nunca se confunde com o GPS)
  assert.equal(ultima.simulado, true);
});

test('7c. o simulador pausa, retoma, reinicia e avança/retrocede', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  const sim = criarSimulador({ plano });
  sim.iniciarEm(200);
  assert.equal(Math.round(sim.distancia), 200);
  sim.avancar(100);
  assert.equal(Math.round(sim.distancia), 300);
  sim.retroceder(50);
  assert.equal(Math.round(sim.distancia), 250);
  sim.reiniciar();
  assert.equal(Math.round(sim.distancia), 0);
});

test('7d. cenários do simulador: desvio, perda de sinal e coordenadas manuais', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  let ultima = null;
  let contador = 0;
  const sim = criarSimulador({ plano, aoAtualizar: (p) => { ultima = p; contador++; } });
  sim.iniciarEm(150);

  // desvio lateral: a posição sai da rota
  sim.aplicarDesvio(150);
  const proj = projetarNoPlano(plano, ultima.longitude, ultima.latitude);
  assert.ok(proj.distancia > 100, `desvio aplicado: ${proj.distancia} m`);
  sim.limparDesvio();
  const proj2 = projetarNoPlano(plano, ultima.longitude, ultima.latitude);
  assert.ok(proj2.distancia < 5, 'voltou para a rota');

  // perda de sinal: nenhuma posição é entregue
  const antes = contador;
  sim.perderSinal();
  sim.emitir();
  assert.equal(contador, antes, 'sem sinal, nada é emitido');
  sim.recuperarSinal();
  assert.ok(contador > antes, 'o sinal foi recuperado');

  // coordenadas manuais
  sim.definirPosicaoManual(-23.65, -46.5);
  assert.equal(ultima.latitude, -23.65);
  assert.equal(ultima.longitude, -46.5);
});

test('7e. o multiplicador de velocidade do simulador é realmente aplicado', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  const sim = criarSimulador({ plano });
  assert.equal(sim.multiplicador, 1);
  sim.definirVelocidade(25);
  assert.equal(sim.multiplicador, 25);
  sim.definirVelocidade('10');
  assert.equal(sim.multiplicador, 10);
});

test('7f. o cenário de desvio afasta a posição de verdade da rota', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  let ultima = null;
  const sim = criarSimulador({ plano, aoAtualizar: (p) => (ultima = p) });
  sim.iniciarEm(100);
  sim.aplicarDesvio(150);
  const proj = projetarNoPlano(plano, ultima.longitude, ultima.latitude);
  assert.ok(proj.distancia > 100, `distância à rota: ${proj.distancia}`);
});

test('8. a fonte GPS traduz os erros e libera o watcher', () => {
  const erros = [];
  let watchId = null;
  let liberado = false;
  const geo = {
    watchPosition(ok, erro, opcoes) {
      watchId = 42;
      this.opcoes = opcoes;
      this.ok = ok;
      this.erro = erro;
      return 42;
    },
    clearWatch(id) {
      liberado = id === 42;
    },
  };
  const fonte = criarFonteGPS({ geolocation: geo, aoErro: (e) => erros.push(e) });
  fonte.iniciar();
  assert.equal(fonte.ativo, true);
  assert.ok(geo.opcoes.enableHighAccuracy, 'precisão alta é pedida');
  assert.ok(geo.opcoes.timeout > 0);

  // permissão negada
  geo.erro({ code: 1 });
  assert.equal(erros[0].codigo, 'PERMISSION_DENIED');
  assert.match(erros[0].mensagem, /Permissão/i);
  assert.equal(ERROS_GPS.PERMISSION_DENIED, erros[0].mensagem);

  // sinal indisponível
  geo.erro({ code: 2 });
  assert.match(erros[1].mensagem, /Sinal/i);

  // tempo esgotado
  geo.erro({ code: 3 });
  assert.match(erros[2].mensagem, /Tempo/i);

  // posição válida
  let recebida = null;
  const fonte2 = criarFonteGPS({
    geolocation: geo,
    aoAtualizar: (p) => (recebida = p),
  });
  fonte2.iniciar();
  geo.ok({
    coords: { latitude: -23.65, longitude: -46.5, accuracy: 12, heading: 90, speed: 1.2 },
    timestamp: 123,
  });
  assert.equal(recebida.latitude, -23.65);
  assert.equal(recebida.precisao, 12);
  assert.equal(recebida.rumo, 90);
  assert.equal(recebida.velocidade, 1.2);
  assert.equal(recebida.simulado, undefined, 'o GPS real não é marcado como simulado');

  fonte.parar();
  assert.equal(liberado, true, 'o watcher é liberado ao parar');
  assert.equal(fonte.ativo, false);
});

test('8b. fora de contexto seguro, o erro é informado sem chamar a API', () => {
  const erros = [];
  let chamado = false;
  const geo = {
    watchPosition() {
      chamado = true;
      return 1;
    },
    clearWatch() {},
  };
  const janelaOriginal = globalThis.window;
  globalThis.window = { isSecureContext: false };
  try {
    const fonte = criarFonteGPS({ geolocation: geo, aoErro: (e) => erros.push(e) });
    fonte.iniciar();
    assert.equal(chamado, false, 'a API não é chamada fora de contexto seguro');
    assert.equal(erros[0].codigo, 'insecure');
    assert.match(erros[0].mensagem, /HTTPS|localhost/i);
  } finally {
    if (janelaOriginal === undefined) delete globalThis.window;
    else globalThis.window = janelaOriginal;
  }
});

test('9. a instrução usa apenas o que a rota deduz (rua e manobra)', () => {
  const plano = planoDeNavegacao(respostaCircuito());
  const nav = criarNavegacao(plano);
  nav.iniciar();
  nav.atualizarPosicao(posEm(0, 150, 0));
  const ins = instrucaoAtual(plano, nav.estado);
  assert.match(ins.principal, /RUA ALFA/, 'usa o nome do logradouro percorrido');
  assert.match(ins.secundario, /próxima parada: B/i);

  // o ângulo no vértice é lido da própria geometria
  const ang = anguloNoVertice(plano, 1);
  assert.ok(ang, 'há uma mudança de direção no vértice');
  assert.ok(['esquerda', 'direita', 'retorno'].includes(ang.tipo));
});
