import { testarResumo } from './cenariosResumoRota.js';
import * as resumo from '../public/resumoRota.js';
testarResumo('Web',resumo);

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
function nota(data){
 const source=readFileSync(process.env.SIGA_RESUMO_WEB_SOURCE || new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('  function atualizarNotaDoTrajeto(data)'),end=source.indexOf('  function showRoute',start),els={routeNote:{hidden:true,textContent:''}};
 new Function('els','resumoRota',source.slice(start,end)+';return atualizarNotaDoTrajeto;')(els,resumo.resumoRota)(data);return els.routeNote;
}
test('Web: hook real não declara ordem alterada só pelo fechamento do circuito',()=>{
 const data={modo:'otimizada',otimizacao:{metodo:'exato'},comparacao:{economia:0,economiaPercentual:0},sequenciaUsuario:['A','B','C','A'],sequencia:['A','B','C'],sequenciaCompleta:['A','B','C','A']};
 const rendered=nota(data);assert.equal(rendered.hidden,false);assert.doesNotMatch(rendered.textContent,/ordem mudou/);assert.equal(rendered.textContent,resumo.resumoRota(data));
});
test('Web: hook real exibe resultado heurístico incompleto sem inventar comparação',()=>{
 const data={modo:'otimizada',otimizacao:{metodo:'heuristico'}};assert.equal(nota(data).textContent,resumo.resumoRota(data));assert.match(nota(data).textContent,/sem garantia de ótimo global/);
});
