import { testarCircuitos } from '../../test/cenariosCircuito.js';
import * as ui from '../src/utils/planejamentoCircuito.js';
import { calcularRotaComParadas } from '../src/core/rotaParadas.js';
testarCircuitos('APK',ui,calcularRotaComParadas);

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../App.js',import.meta.url),'utf8');
test('APK: botões apontam para ações explícitas e não há seletores de tipo/ordem ou inversão',()=>{
 assert.match(source,/onPress=\{\(\) => handleCalculate\('usuario'\)\}/);
 assert.match(source,/onPress=\{\(\) => handleCalculate\('otimizada'\)\}/);
 assert.match(source,/onSubmitCalculate=\{\(\) => handleCalculate\('usuario'\)\}/);
 assert.doesNotMatch(source,/Tipo de trajeto|Ordem do trajeto|handleSwap|modoOrdem/);
 assert.ok(source.indexOf("'Calcular rota'")<source.indexOf('>Calcular rota otimizada<'));
});
for(const modo of ['usuario','otimizada']) test(`APK: handler real envia ${modo} e sempre circular=true`,async()=>{
 const start=source.indexOf('  const handleCalculate = async ('),end=source.indexOf('  const pickingPoint',start);
 const pontos=[{rotulo:'A',latitude:-23.66,longitude:-46.54},{rotulo:'B',latitude:-23.661,longitude:-46.54}],payload=[],busy=[];
 const ctx={Keyboard:{dismiss(){}},lista:{pontos,circuito:true},podeCalcular:()=>({ok:true}),navigationRef:{current:{encerrar(){}}},calculoRef:{current:0},setCalculating:v=>busy.push(v),setStatus:()=>{},setRouteResult:()=>{},setRouteError:()=>{},setPartialGeometry:()=>{},opcoesCalculoCircuito:ui.opcoesCalculoCircuito,mobileNetworkService:{async calcularRotaParadas(p,op){payload.push({p,op});return {ok:true,distance:100};}},formatDistanceParts:()=>({v:100,u:'m'}),reasonTitle:()=>''};
 const run=new Function(...Object.keys(ctx),source.slice(start,end)+';return handleCalculate;')(...Object.values(ctx));
 await run(modo);assert.deepEqual(payload[0].op,{modo,circular:true});assert.deepEqual(payload[0].p,pontos.map(p=>({...p,enderecoDigital:null})));assert.deepEqual(busy,[true,false]);
});
