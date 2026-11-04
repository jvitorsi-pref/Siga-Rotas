import test from 'node:test';
import assert from 'node:assert/strict';
import { criarFonteGPSNativa } from '../src/services/nativeGPS.js';
function setup(extra = {}) {
  const readings=[], errors=[], interruptions=[], watchers=[], timers=[], calls=[];
  let time=1700000000000, listener=null;
  const location={ Accuracy:{ High:4 },
    async getForegroundPermissionsAsync(){calls.push('get');return {status:'granted'};},
    async requestForegroundPermissionsAsync(){calls.push('request');return {status:'granted'};},
    async hasServicesEnabledAsync(){return true;},
    async watchPositionAsync(options,ok,fail){const w={options,ok,fail,removed:0,remove(){this.removed++;}};watchers.push(w);return w;},
    ...extra,
  };
  const appState={currentState:'active',addEventListener(_event,fn){listener=fn;return {remove(){listener=null;}};}};
  const source=criarFonteGPSNativa({location,appState,agora:()=>time,agendar:f=>{timers.push(f);return f;},cancelar:f=>{const i=timers.indexOf(f);if(i>=0)timers.splice(i,1);},
    aoAtualizar:p=>readings.push(p),aoErro:e=>errors.push(e),aoInterromper:e=>interruptions.push(e)});
  return {source,location,readings,errors,watchers,timers,calls,interruptions,setTime:t=>time=t,background(){appState.currentState='background';listener?.('background');},active(){appState.currentState='active';}};
}
const amostra=(extra={})=>({coords:{latitude:-23.7,longitude:-46.5,accuracy:8,heading:-1,speed:-1},timestamp:1700000000000,...extra});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('GPS não pede permissão nem abre watcher antes de iniciar por ação do usuário',async()=>{
 const a=setup();assert.deepEqual(a.calls,[]);assert.equal(a.watchers.length,0);
 await a.source.iniciar();assert.equal(a.watchers.length,1);assert.equal(a.calls.includes('request'),false);a.source.parar();
});
test('tradução preserva coordenadas/precisão e identifica GPS sem inventar rumo/velocidade',async()=>{
 const a=setup();await a.source.iniciar();a.watchers[0].ok(amostra());
 assert.deepEqual(a.readings[0],{latitude:-23.7,longitude:-46.5,precisao:8,rumo:null,velocidade:null,timestamp:1700000000000,simulado:false,fonte:'gps',mockado:false});
 assert.equal(a.watchers[0].options.accuracy,4);a.source.parar();
});
test('permissão negada não abre GPS e pode ser tentada novamente',async()=>{
 const a=setup({async getForegroundPermissionsAsync(){return {status:'undetermined',canAskAgain:true};},async requestForegroundPermissionsAsync(){return {status:'denied'};}});
 assert.equal((await a.source.iniciar()).codigo,'PERMISSION_DENIED');assert.equal(a.watchers.length,0);
 a.location.getForegroundPermissionsAsync=async()=>({status:'granted'});assert.equal((await a.source.iniciar()).ok,true);a.source.parar();
});
test('negação permanente não repete prompt; serviço desativado não abre watcher',async()=>{
 const a=setup({async getForegroundPermissionsAsync(){return {status:'denied',canAskAgain:false};}});
 await a.source.iniciar();assert.equal(a.calls.includes('request'),false);assert.equal(a.watchers.length,0);
 const b=setup({async hasServicesEnabledAsync(){return false;}});assert.equal((await b.source.iniciar()).codigo,'LOCATION_DISABLED');assert.equal(b.watchers.length,0);
});
test('parar durante pedido de permissão cancela abertura tardia',async()=>{
 let resolve;const a=setup({getForegroundPermissionsAsync:()=>new Promise(r=>{resolve=r;})});
 const start=a.source.iniciar();a.source.parar();resolve({status:'granted'});
 assert.equal((await start).cancelado,true);assert.equal(a.watchers.length,0);
});
test('watcher resolvido depois de parar é removido imediatamente',async()=>{
 let resolve;const sub={removed:0,remove(){this.removed++;}};
 const a=setup({watchPositionAsync:()=>new Promise(r=>{resolve=r;})});
 const start=a.source.iniciar();await turn();a.source.parar();resolve(sub);
 assert.equal((await start).cancelado,true);assert.equal(sub.removed,1);assert.equal(a.timers.length,0);
});
test('pausa/retomada abre só um watcher e rejeita callbacks da assinatura antiga',async()=>{
 const a=setup();await Promise.all([a.source.iniciar(),a.source.iniciar()]);assert.equal(a.watchers.length,1);
 a.source.pausar();assert.equal(a.watchers[0].removed,1);a.watchers[0].ok(amostra());assert.equal(a.readings.length,0);
 await a.source.retomar();a.watchers[1].ok(amostra());assert.equal(a.readings.length,1);a.source.parar();assert.equal(a.timers.length,0);
});
test('background libera watcher, solicita pausa e não retoma automaticamente',async()=>{
 const a=setup();await a.source.iniciar();a.background();assert.equal(a.watchers[0].removed,1);assert.equal(a.interruptions.length,1);
 assert.equal((await a.source.iniciar()).codigo,'APP_BACKGROUND');a.active();assert.equal(a.watchers.length,1);
 await a.source.retomar();assert.equal(a.watchers.length,2);a.source.parar();
});
test('amostras antigas/inválidas/mockadas não confirmam posição real',async()=>{
 const a=setup();await a.source.iniciar();a.watchers[0].ok(amostra({timestamp:1}));a.watchers[0].ok(amostra({mocked:true}));
 a.watchers[0].ok(amostra({coords:{latitude:999,longitude:-46.5}}));assert.equal(a.readings.length,0);
 assert.ok(a.errors.some(e=>e.codigo==='MOCK_LOCATION'));assert.ok(a.errors.some(e=>e.codigo==='POSITION_UNAVAILABLE'));a.source.parar();
});
test('silêncio e erro GPS são explícitos; nova leitura permite detectar nova lacuna',async()=>{
 const a=setup();await a.source.iniciar();a.setTime(1700000031000);a.timers[0]();a.timers[0]();
 assert.equal(a.errors.filter(e=>e.codigo==='TIMEOUT').length,1);
 a.watchers[0].ok(amostra({timestamp:1700000031000}));a.setTime(1700000062000);a.timers[0]();assert.equal(a.errors.filter(e=>e.codigo==='TIMEOUT').length,2);
 a.watchers[0].fail('sensor');assert.equal(a.errors.at(-1).codigo,'POSITION_UNAVAILABLE');a.source.parar();
});
test('erro nativo na abertura não deixa fonte ativa e pode ser informado',async()=>{
 const a=setup({async watchPositionAsync(){throw new Error('módulo indisponível');}});
 assert.equal((await a.source.iniciar()).codigo,'GPS_ERROR');assert.equal(a.source.ativo,false);assert.equal(a.timers.length,0);
});

test('leituras duplicadas ou fora de ordem não contam como novas posições estáveis',async()=>{
 const a=setup();await a.source.iniciar();a.watchers[0].ok(amostra());a.watchers[0].ok(amostra());
 a.watchers[0].ok(amostra({timestamp:1699999999999}));assert.equal(a.readings.length,1);
 a.setTime(1700000001000);a.watchers[0].ok(amostra({timestamp:1700000001000}));assert.equal(a.readings.length,2);
 assert.equal(a.watchers[0].options.distanceInterval,0,'permite leituras novas com aparelho parado para confirmar chegada');a.source.parar();
});
