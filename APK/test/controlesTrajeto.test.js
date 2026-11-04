import test from 'node:test';
import assert from 'node:assert/strict';
import { criarListaPontos, adicionarPonto, moverPonto } from '../src/core/pontoTrajeto.js';
import { podeDescerParada, inverterTrajeto } from '../src/utils/controlesTrajeto.js';
function lista(circuito) {
  const l = criarListaPontos(); l.circuito = circuito;
  for (let i = 0; i < 4; i++) adicionarPonto(l, { latitude: -23.7, longitude: -46.5 });
  return l;
}
for (const circuito of [false, true]) {
  test(`botão descer respeita os limites do núcleo (circuito=${circuito})`, () => {
    const l = lista(circuito);
    for (const p of l.pontos) {
      const copia = { ...l, pontos: l.pontos.map(p => ({ ...p })) };
      const antes = copia.pontos.map(p => p.id);
      moverPonto(copia, p.id, 1);
      assert.equal(podeDescerParada(p, l.pontos.length, circuito), antes.join() !== copia.pontos.map(p => p.id).join());
    }
  });
}
test('inverter circuito não muda origem ou ordem, nem muta a lista', () => {
  const l = lista(true); const before = structuredClone(l);
  assert.strictEqual(inverterTrajeto(l), l); assert.deepEqual(l, before);
});
test('inverter trajeto aberto mantém a lista original e relabela os pontos', () => {
  const l = lista(false); const ids = l.pontos.map(p => p.id);
  const inversa = inverterTrajeto(l);
  assert.deepEqual(l.pontos.map(p => p.id), ids);
  assert.deepEqual(inversa.pontos.map(p => p.id), ids.slice().reverse());
  assert.equal(inversa.pontos[0].tipo, 'origem');
  assert.equal(inversa.pontos.at(-1).tipo, 'destino');
});
