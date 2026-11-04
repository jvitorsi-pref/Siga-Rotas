import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { criarArmazenamento, criarAdaptadorMemoria } from '../core/armazenamentoLocal.js';
import { snapshotPlano, persistirPlanoAtivo, prepararPlanoSalvo, assinaturaPlanejador } from '../public/planoPersistido.js';
import { prepararRetomadaSimulada } from '../core/recuperacaoColeta.js';
import { podeCalcular, criarPonto, rotularPontos } from '../core/pontoTrajeto.js';
const coords=[[-46.5,-23.7],[-46.5,-23.698]];
const rota=()=>({ok:true,modo:'usuario',circular:false,pontos:[{rotulo:'A',longitude:-46.5,latitude:-23.7},{rotulo:'B',longitude:-46.5,latitude:-23.698}],sequencia:['A','B'],sequenciaCompleta:['A','B'],distance:222,geometry:{type:'LineString',coordinates:coords},legs:[{de:'A',para:'B',distance:222,geometry:{type:'LineString',coordinates:coords}}]});
const repo=()=>criarArmazenamento({adaptador:criarAdaptadorMemoria()});
test('hidratação recupera pontos válidos, circuito, modo e rota ativa sem recalcular',()=>{
 const r={...rota(),circular:true,modo:'saida_curta',sequenciaCompleta:['A','B','A']};
 const plano=prepararPlanoSalvo({...snapshotPlano(r),id:'r1',versao:3});
 assert.equal(plano.lista.circuito,true);assert.equal(plano.circuito,true);assert.equal(plano.modo,'saida_curta');
 assert.equal(plano.lista.pontos[1].tipo,'parada');assert.equal(podeCalcular(plano.lista).ok,true);
 assert.equal(plano.lista.pontos[0].status,'CONVERTIDO');assert.equal(plano.rota.ok,true);assert.deepEqual(plano.rota.legs,r.legs);
 assert.deepEqual(plano.rota.geometry,r.geometry);assert.equal(plano.rota.circular,true);
});
test('hidratação recusa plano parcial, coordenadas inválidas e ausência de trechos',()=>{
 for(const r of [{...rota(),parcial:true},{...rota(),legs:[]},{...rota(),pontos:[{latitude:NaN,longitude:0}]},{...rota(),modo:'desconhecido'}]) assert.throws(()=>prepararPlanoSalvo(r));
});
test('mesma distância e sequência não identificam planos de geometria diferente',async()=>{
 const r=repo(),a=rota(),b=rota();b.legs[0].geometry={type:'LineString',coordinates:[coords[0],[-46.499,-23.699],coords[1]]};
 const antigo=await persistirPlanoAtivo(r,a);const novo=await persistirPlanoAtivo(r,b);
 assert.notEqual(antigo.id,novo.id);assert.deepEqual((await r.obterRota(antigo.id)).legs,a.legs);assert.equal((await r.obterRota(antigo.id)).versao,1);
});
test('plano exato é reutilizado, não o último plano salvo; regravação não invalida a versão de sessão anterior',async()=>{
 const r=repo(),a=rota(),b={...rota(),modo:'otimizada'};
 const original=await persistirPlanoAtivo(r,a);const outro=await persistirPlanoAtivo(r,b);
 assert.notEqual(original.id,outro.id);
 const ativo=await persistirPlanoAtivo(r,a);assert.equal(ativo.id,original.id);assert.equal(ativo.versao,original.versao);
 assert.equal((await prepararRetomadaSimulada(r,{rotaId:original.id,versaoRota:original.versao,sessaoId:'s1',distancia:0})).ok,true);
});
test('snapshot é independente de mutações e normaliza GeoJSON para esquema existente',()=>{
 const a=rota(),snapshot=snapshotPlano(a);a.pontos[0].latitude=0;a.legs[0].de='X';
 assert.equal(snapshot.pontos[0].latitude,-23.7);assert.equal(snapshot.legs[0].de,'A');assert.deepEqual(snapshot.geometry,coords);
});
test('assinatura detecta edição, reordenação, circuito e modo mas ignora mensagens transitórias',()=>{
 const state={lista:{pontos:rota().pontos},circuito:false,modo:'usuario'},key=assinaturaPlanejador(state);
 state.lista.pontos[0].mensagem='carregando';assert.equal(assinaturaPlanejador(state),key);
 for(const change of [s=>s.lista.pontos.reverse(),s=>s.lista.pontos[0].latitude=0,s=>s.circuito=true,s=>s.modo='otimizada']){
 const copia=structuredClone(state);change(copia);assert.notEqual(assinaturaPlanejador(copia),key);
 }
});
// Executa a função real da UI com ganchos injetados, sem simular o motor/IndexedDB.
const ui=readFileSync(process.env.SIGA_COLETA_UI_SOURCE || new URL('../public/coletaUI.js',import.meta.url),'utf8');
function iniciarUI(ctx){
 const start=ui.indexOf('  async function iniciarColeta()');const end=ui.indexOf('\n  }',start)+4;
 assert.ok(start>=0 && end>start,'função real de início encontrada');
 return new Function(...Object.keys(ctx),'let planoSimulacaoAtual=null;'+ui.slice(start,end)+';return iniciarColeta;')(...Object.values(ctx));
}
function contexto(armazenamento,app){const calls=[],avisos=[];return {calls,avisos,ctx:{app,armazenamento,assinaturaPlanejador,persistirPlanoAtivo,FONTE:{SIMULACAO:'simulacao'},modoColeta:()=> 'gps',coleta:{async iniciar(opcoes){calls.push(opcoes);return {ok:true};}},idAgente:()=> 'agente',idDispositivo:()=> 'disp',mostrarAviso:t=>avisos.push(t),status:()=>{},atualizarSimulador:()=>{}}};}
test('iniciar coleta na UI vincula ID/versão do plano ativo, não do último salvo',async()=>{
 const r=repo(),a=rota();const original=await persistirPlanoAtivo(r,a);await persistirPlanoAtivo(r,{...rota(),modo:'otimizada'});
 const app={rotaAtual:a,state:{lista:{pontos:a.pontos},modo:'usuario',circuito:false}};
 const c=contexto(r,app);await iniciarUI(c.ctx)();assert.equal(c.calls[0].rota.id,original.id);assert.equal(c.calls[0].rota.versao,1);
});
test('início da coleta persiste plano ainda não salvo e permite recuperar simulação depois',async()=>{
 const r=repo(),a=rota(),app={rotaAtual:a,state:{lista:{pontos:a.pontos},modo:'usuario',circuito:false}};
 const c=contexto(r,app);await iniciarUI(c.ctx)();const plano=c.calls[0].rota;assert.ok(plano.id);
 assert.equal((await prepararRetomadaSimulada(r,{rotaId:plano.id,versaoRota:plano.versao,sessaoId:'s1',distancia:0})).ok,true);
});
test('plano alterado durante persistência não inicia sessão com vínculo obsoleto',async()=>{
 const r=repo(),a=rota(),app={rotaAtual:a,state:{lista:{pontos:a.pontos},modo:'usuario',circuito:false}};
 const list=r.listarRotas;r.listarRotas=async()=>{app.state.modo='otimizada';return list();};
 const c=contexto(r,app);await iniciarUI(c.ctx)();assert.equal(c.calls.length,0);assert.match(c.avisos[0],/planejamento mudou/);
});
test('coleta GPS sem plano permanece livre e não adota plano salvo por acaso',async()=>{
 const r=repo();await persistirPlanoAtivo(r,rota());const app={rotaAtual:null,state:{lista:{pontos:[]},modo:'usuario',circuito:false}};
 const c=contexto(r,app);await iniciarUI(c.ctx)();assert.equal(c.calls[0].rota,null);
});

const appSource=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function hookAbrir(ctx){
 const start=appSource.indexOf('    abrirPlanoSalvo(registro) {');const end=appSource.indexOf('    ajustarEnquadramento,',start);
 const text=appSource.slice(start,end).trim().replace(/^abrirPlanoSalvo/, 'function abrirPlanoSalvo').replace(/,$/,'');
 return new Function(...Object.keys(ctx),'let revisaoCalculo=0;'+text+';return abrirPlanoSalvo;')(...Object.values(ctx));
}
test('gancho real de abertura sincroniza radios, inversão, painel e navegação com o estado',()=>{
 const state={lista:{pontos:[]},circuito:false,modo:'usuario'},els={calc:{disabled:true},swap:{}},calls=[];
 const tipo=[{value:'ida',checked:true},{value:'circuito',checked:false}],modo=['usuario','otimizada','saida_curta'].map(value=>({value}));
 const abrir=hookAbrir({state,els,prepararPlanoSalvo,document:{querySelectorAll:s=>s.includes('tipo')?tipo:modo},stopPicking:()=>calls.push('stop'),renderizarPontos:()=>calls.push('render'),showRoute:r=>{state.rotaAtual=r;calls.push('show');}});
 abrir({...rota(),circular:true,modo:'saida_curta'});
 assert.equal(state.circuito,true);assert.equal(state.lista.circuito,true);assert.equal(state.modo,'saida_curta');assert.equal(state.rotaAtual.ok,true);
 assert.equal(els.swap.disabled,true);assert.equal(tipo[0].checked,false);assert.equal(tipo[1].checked,true);assert.equal(modo[2].checked,true);assert.deepEqual(calls,['stop','render','show']);
 abrir(rota());assert.equal(els.swap.disabled,false);assert.equal(tipo[0].checked,true);assert.equal(state.lista.pontos.at(-1).tipo,'destino');
 const before=state.lista;assert.throws(()=>abrir({...rota(),legs:[]}));assert.equal(state.lista,before);
});
function calculo(ctx){
 const start=appSource.indexOf('  async function calculate()');const end=appSource.indexOf('  function reasonTitle',start);
 return new Function(...Object.keys(ctx),'let revisaoCalculo=0;'+appSource.slice(start,end)+';return calculate;')(...Object.values(ctx));
}
function contextoCalculo(){
 const state={lista:{pontos:rota().pontos},modo:'usuario',circuito:false},pending=[],shown=[],errors=[],els={calc:{disabled:false}};
 const run=calculo({state,els,assinaturaPlanejador,podeCalcular:()=>({ok:true}),setStatus:()=>{},routeSource:{clear(){}},fetch:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),showRoute:r=>shown.push(r),showError:(...e)=>errors.push(e),desenharRota:()=>{},atualizarLegenda:()=>{},formatDistance:n=>({v:n,u:'m'}),reasonTitle:()=> 'erro'});
 return {state,pending,shown,errors,els,run};
}
test('respostas de cálculos concorrentes fora de ordem não substituem a mais recente',async()=>{
 const c=contextoCalculo(),first=c.run(),second=c.run();
 c.pending[1].resolve({json:async()=>({...rota(),distance:333})});await second;
 c.pending[0].resolve({json:async()=>rota()});await first;
 assert.equal(c.shown.length,1);assert.equal(c.shown[0].distance,333);assert.equal(c.els.calc.disabled,false);
});
test('edição durante cálculo descarta resposta e erros antigos não sobrescrevem um resultado novo',async()=>{
 const c=contextoCalculo(),first=c.run();c.state.modo='otimizada';c.pending[0].resolve({json:async()=>rota()});await first;assert.equal(c.shown.length,0);
 const old=c.run(),fresh=c.run();c.pending[2].resolve({json:async()=>rota()});await fresh;
 c.pending[1].reject(new Error('falha antiga'));await old;assert.equal(c.errors.length,0);assert.equal(c.shown.length,1);
});

test('simulação não seleciona silenciosamente a última rota salva sem plano ativo',async()=>{
 const r=repo();await persistirPlanoAtivo(r,rota());const app={rotaAtual:null,state:{lista:{pontos:[]},modo:'usuario',circuito:false}};
 const c=contexto(r,app);c.ctx.modoColeta=()=> 'simulacao';await iniciarUI(c.ctx)();assert.equal(c.calls.length,0);assert.match(c.avisos[0],/precisa de uma rota/);
});
function abrirUI(ctx){
 const start=ui.indexOf('  async function abrirRota(id)');const end=ui.indexOf('\n  }',start)+4;
 return new Function(...Object.keys(ctx),'let revisaoAbertura=0;'+ui.slice(start,end)+';return abrirRota;')(...Object.values(ctx));
}
test('abrirRota real aplica o plano ao estado completo em vez de apenas desenhar a geometria',async()=>{
 const r=repo();const registro=await persistirPlanoAtivo(r,{...rota(),modo:'saida_curta',circular:true});
 const state={lista:{pontos:[]},circuito:false,modo:'usuario'},els={calc:{},swap:{}};
 const app={state,rotaAtual:null};
 app.abrirPlanoSalvo=hookAbrir({state,els,prepararPlanoSalvo,document:{querySelectorAll:()=>[]},stopPicking:()=>{},renderizarPontos:()=>{},showRoute:r=>{state.rotaAtual=r;app.rotaAtual=r;}});
 const abrir=abrirUI({app,armazenamento:r,assinaturaPlanejador,criarPonto,rotularPontos,mostrarAviso:()=>{},desenharPlanoSalvo:()=>{},planoSource:{getFeatures:()=>[]},status:()=>{}});
 await abrir(registro.id);assert.equal(state.circuito,true);assert.equal(state.modo,'saida_curta');assert.equal(app.rotaAtual.ok,true);assert.equal(state.lista.circuito,true);
});
test('aberturas concorrentes fora de ordem ou com edições posteriores não substituem o plano atual',async()=>{
 const pending=[],opened=[],avisos=[],app={state:{lista:{pontos:rota().pontos},circuito:false,modo:'usuario'},rotaAtual:null,abrirPlanoSalvo:r=>opened.push(r.id)};
 const abrir=abrirUI({app,armazenamento:{obterRota:id=>new Promise(resolve=>pending.push({id,resolve}))},assinaturaPlanejador,mostrarAviso:t=>avisos.push(t),desenharPlanoSalvo:()=>{},planoSource:{getFeatures:()=>[]},status:()=>{}});
 const a=abrir('a'),b=abrir('b');pending[1].resolve({...rota(),id:'b'});await b;pending[0].resolve({...rota(),id:'a'});await a;assert.deepEqual(opened,['b']);
 const c=abrir('c');app.state.modo='otimizada';pending[2].resolve({...rota(),id:'c'});await c;assert.deepEqual(opened,['b']);assert.match(avisos.at(-1),/planejamento mudou/);
});
test('operações de campo não duplicam início durante escrita pendente e desbloqueiam após erro',async()=>{
 const start=ui.indexOf('  async function executarAcao(acao)');const end=ui.indexOf('\n  }',start)+4;
 const avisos=[];const run=new Function('mostrarAviso','renderizarEstadoColeta','let acaoEmAndamento=false;'+ui.slice(start,end)+';return executarAcao;')(t=>avisos.push(t),()=>{});
 let resolve,count=0;const first=run(()=>new Promise(r=>{resolve=r;}));await run(async()=>{count++;});assert.equal(count,0);resolve();await first;
 await run(async()=>{throw new Error('disco cheio');});await run(async()=>{count++;});assert.equal(count,1);assert.ok(avisos.some(t=>t.includes('disco cheio')));
});

test('abrir um ID explícito preserva esse ID/versão mesmo com outro plano de conteúdo idêntico',async()=>{
 const r=repo();const primeiro=await persistirPlanoAtivo(r,rota());
 const escolhido=await r.salvarRota({...snapshotPlano(rota()),id:'plano-escolhido',versao:4});
 const aberto=prepararPlanoSalvo(escolhido).rota;const vinculo=await persistirPlanoAtivo(r,aberto);
 assert.notEqual(primeiro.id,vinculo.id);assert.equal(vinculo.id,'plano-escolhido');assert.equal(vinculo.versao,4);
 await r.salvarRota({...escolhido,versao:5});await assert.rejects(()=>persistirPlanoAtivo(r,aberto),/selecionado mudou/);
});

test('planejamento editado com rota visível obsoleta não inicia coleta silenciosamente sem vínculo',async()=>{
 const r=repo(),app={rotaAtual:null,state:{rotaAtual:rota(),lista:{pontos:rota().pontos},modo:'otimizada',circuito:false}};
 const c=contexto(r,app);await iniciarUI(c.ctx)();assert.equal(c.calls.length,0);assert.match(c.avisos[0],/planejamento foi alterado/);
});
