import test from 'node:test';
import assert from 'node:assert/strict';
export function testarResumo(plataforma, {rotuloModo,resumoRota}) {
 const base=()=>({modo:'otimizada',otimizacao:{metodo:'exato'},comparacao:{economia:25,economiaPercentual:12.5},sequenciaUsuario:['A','B','C','A'],sequencia:['A','C','B'],sequenciaCompleta:['A','C','B','A']});
 test(`${plataforma}: manual e saída curta têm rótulos distintos, modo desconhecido não vira manual`,()=>{
  assert.match(resumoRota({modo:'usuario'}),/sequência informada foi respeitada/);assert.equal(rotuloModo('saida_curta'),'Ordem otimizada (saída curta)');assert.equal(rotuloModo('outro'),'Modo não informado');
 });
 test(`${plataforma}: método e economia vêm do resultado sem modificar dados`,()=>{
  const r=base(),before=structuredClone(r),text=resumoRota(r);assert.match(text,/método exato \(Held-Karp\)/);assert.match(text,/economia 25 m \(12,5 %\)/);assert.deepEqual(r,before);
 });
 test(`${plataforma}: heurística não promete ótimo global; desconhecido e trivial não viram Held-Karp`,()=>{
  for(const [metodo,regex] of [['heuristico',/sem garantia de ótimo global/],['trivial',/sem busca de permutações/],['outro',/não informado/]]) assert.match(resumoRota({...base(),otimizacao:{metodo}}),regex);
  assert.match(resumoRota({...base(),modo:'saida_curta',otimizacao:{metodo:'exato (desempate: saída curta)'}}),/desempate pela saída curta/);
 });
 test(`${plataforma}: fechamento A duplicado não gera empate com ordem falsamente alterada`,()=>{
  const r=base();r.comparacao={economia:0,economiaPercentual:-0};r.sequencia=['A','B','C'];r.sequenciaCompleta=['A','B','C','A'];assert.doesNotMatch(resumoRota(r),/ordem mudou/);assert.doesNotMatch(resumoRota(r),/-0/);
  r.sequenciaCompleta=['A','C','B','A'];assert.match(resumoRota(r),/empate: a ordem mudou/);
 });
 test(`${plataforma}: arredondamento não transforma pequena economia em empate e perda não é ganho`,()=>{
  assert.doesNotMatch(resumoRota({...base(),comparacao:{economia:0.4,economiaPercentual:0.1}}),/empate/);
  assert.match(resumoRota({...base(),comparacao:{economia:-5,economiaPercentual:-2}}),/distância 5 m \(2,0 %\) maior/);
 });
 test(`${plataforma}: comparação incompleta não inventa zero nem quebra a interface`,()=>{
  for(const comparacao of [null,{}, {economia:25},{economia:Infinity,economiaPercentual:NaN}])assert.match(resumoRota({...base(),comparacao}),/comparação.*indisponível/);
 });
}
