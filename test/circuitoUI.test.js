import { testarCircuitos } from './cenariosCircuito.js';
import * as ui from '../public/planejamentoCircuito.js';
import { calcularRotaComParadas } from '../core/rotaParadas.js';
testarCircuitos('Web',ui,calcularRotaComParadas);

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assinaturaPlanejador } from '../public/planoPersistido.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('Web: botões separados e Enter apontam para ações explícitas sem seletores antigos',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(source,/els\.calc\.addEventListener\('click', \(\) => calculate\('usuario'\)\)/);
 assert.match(source,/els\.calcOptimized\.addEventListener\('click', \(\) => calculate\('otimizada'\)\)/);
 assert.ok(html.indexOf('id="calc"')<html.indexOf('id="calc-optimized"'));
 assert.doesNotMatch(html,/id="(?:tipos|modes|swap)"/);assert.match(html,/Calcular rota otimizada/);
});
for(const modo of ['usuario','otimizada']) test(`Web: handler real de cálculo envia ${modo} com retorno obrigatório`,async()=>{
 const start=source.indexOf('  async function calculate('),end=source.indexOf('  function reasonTitle',start);
 const pontos=[{rotulo:'A',latitude:-23.66,longitude:-46.54},{rotulo:'B',latitude:-23.661,longitude:-46.54}];
 const state={lista:{pontos,circuito:false},modo:'usuario',circuito:false},els={calc:{},calcOptimized:{}},payload=[];
 const ctx={state,els,opcoesCalculoCircuito:ui.opcoesCalculoCircuito,assinaturaPlanejador,podeCalcular:()=>({ok:true}),setStatus:()=>{},routeSource:{clear(){}},fetch:async(_url,req)=>{payload.push(JSON.parse(req.body));return {json:async()=>({ok:true,distance:100})};},showRoute:()=>{},formatDistance:()=>({v:100,u:'m'}),showError:()=>assert.fail('não deveria falhar')};
 const run=new Function(...Object.keys(ctx),'let revisaoCalculo=0;'+source.slice(start,end)+';return calculate;')(...Object.values(ctx));
 await run(modo);assert.equal(payload[0].modo,modo);assert.equal(payload[0].circular,true);assert.deepEqual(payload[0].pontos,pontos.map(p=>({...p,enderecoDigital:null})));assert.equal(els.calc.disabled,false);assert.equal(els.calcOptimized.disabled,false);
});
