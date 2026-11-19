import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileNetworkServiceCore, STORAGE_KEY_SNAPSHOT, fingerprintOf } from '../src/services/mobileNetworkServiceCore.js';
import { readFileSync } from 'node:fs';
import { buildGraph } from '../src/core/graph.js';
import { WFS_DEFAULTS, UPDATE_DEFAULTS, LAYER_NAME } from '../src/core/config.js';
import { project, unproject } from '../src/core/geo.js';
const [x,y]=project(-46.545,-23.66);
const coord=dx=>unproject(x+dx,y);
const feature=(id,end=100)=>({type:'Feature',properties:{ID:id,NOM_LOGRADOURO:'Rua teste',COD_LOG:1},geometry:{type:'LineString',coordinates:[coord(0),coord(end)]}});
const result=(id=1,end=100)=>({features:[feature(id,end)],serverTotal:1,strategy:'single',attributes:['ID'],warnings:[]});
function setup(extra={}){
 const values=new Map(),writes=[],storage={async getItem(k){return values.get(k)||null;},async setItem(k,v){writes.push(JSON.parse(v));values.set(k,v);}},calls=[];
 const opts={storage,embeddedSnapshot:{...result(),savedAt:1000},wfs:{async fetchNetwork(){calls.push('fetch');return result(2,200);},async checkForUpdates(){return {changed:true,serverTotal:2};}},...extra};
 let Service=MobileNetworkServiceCore;
 if(process.env.SIGA_MOBILE_NETWORK_SOURCE){
  const source=readFileSync(process.env.SIGA_MOBILE_NETWORK_SOURCE,'utf8').replace(/^import .*;\n/gm,'').replace(/^export const mobileNetworkService.*$/m,'').replace(/\bexport /g,'');
  Service=new Function('AsyncStorage','embeddedSnapshot','buildGraph','fetchNetwork','checkForUpdates','describeLayer','WFS_DEFAULTS','UPDATE_DEFAULTS','LAYER_NAME',source+';return MobileNetworkService;')(opts.storage,opts.embeddedSnapshot,buildGraph,opts.wfs.fetchNetwork,opts.wfs.checkForUpdates,()=>{},WFS_DEFAULTS,UPDATE_DEFAULTS,LAYER_NAME);
 }
 return {service:new Service(opts),storage,values,writes,calls,opts};
}
const turn=()=>new Promise(r=>setImmediate(r));
test('inicia pelo snapshot sem consultar WFS; cache ausente não é falha',async()=>{
 const c=setup();const s=await c.service.ensureReady();assert.equal(s.source,'snapshot');assert.equal(c.calls.length,0);assert.equal(s.features[0].properties.ID,1);assert.equal(c.service.getNetworkMeta().cache.error,null);
});
test('verificação profunda persiste rede completa e reinício offline recupera a atualização',async()=>{
 const c=setup();await c.service.ensureReady();assert.equal((await c.service.checkForChanges({deep:true})).changed,true);
 assert.equal(c.writes.length,1);assert.equal(c.writes[0].features[0].properties.ID,2);
 const restarted=new MobileNetworkServiceCore({...c.opts,allowWfs:false});const s=await restarted.ensureReady();
 assert.equal(s.source,'wfs-cache');assert.equal(s.features[0].properties.ID,2);assert.equal(restarted.getNetworkMeta().cache.status,'persisted');assert.equal(c.calls.length,1);
 const route=await restarted.calcularRotaParadas([coord(0),coord(200)].map(([longitude,latitude],i)=>({rotulo:i?'B':'A',longitude,latitude})),{modo:'usuario',circular:true});
 assert.equal(route.ok,true);assert.equal(route.sequenciaCompleta.at(-1),'A');assert.ok(route.distance>390&&route.distance<410);
});
test('refresh explícito e verificação leve também usam a mesma persistência',async()=>{
 const c=setup();await c.service.refreshFromWfs();assert.equal(c.writes.length,1);
 c.service.wfs.fetchNetwork=async()=>result(3,300);await c.service.checkForChanges();assert.equal(c.writes.length,2);assert.equal(c.writes[1].features[0].properties.ID,3);
});
test('quota mantém rede em memória, cache anterior intacto e aviso explícito; nova verificação retenta a escrita',async()=>{
 const c=setup();await c.service.refreshFromWfs();const old=c.values.get(STORAGE_KEY_SNAPSHOT);
 c.storage.setItem=async()=>{throw new Error('quota');};c.service.wfs.fetchNetwork=async()=>result(3,300);
 await c.service.checkForChanges({deep:true});assert.equal(c.service.state.features[0].properties.ID,3);assert.equal(c.values.get(STORAGE_KEY_SNAPSHOT),old);assert.equal(c.service.getNetworkMeta().cache.status,'memory-only');assert.match(c.service.getNetworkMeta().cache.error,/apenas em memória/);
 c.storage.setItem=async(k,v)=>c.values.set(k,v);await c.service.checkForChanges({deep:true});assert.equal(c.service.getNetworkMeta().cache.status,'persisted');assert.equal(JSON.parse(c.values.get(STORAGE_KEY_SNAPSHOT)).features[0].properties.ID,3);
});
for(const cached of ['{inválido',JSON.stringify({...result(),features:[]}),JSON.stringify({...result(),serverTotal:2}),JSON.stringify({...result(),features:[{type:'Feature',properties:{ID:1},geometry:null}]})]) test('cache inválido/incompleto não substitui o snapshot embutido: '+cached.slice(0,20),async()=>{
 const c=setup();c.values.set(STORAGE_KEY_SNAPSHOT,cached);const s=await c.service.ensureReady();assert.equal(s.source,'snapshot');assert.equal(s.features[0].properties.ID,1);assert.equal(c.values.get(STORAGE_KEY_SNAPSHOT),cached);assert.equal(c.service.getNetworkMeta().cache.status,'unavailable');
});
test('resultado WFS incompleto ou sem arestas não destrói a última rede e cache válidos',async()=>{
 const c=setup();await c.service.refreshFromWfs();const old=c.service.state,cache=c.values.get(STORAGE_KEY_SNAPSHOT),fp=c.service.update.fingerprint;
 for(const invalid of [{...result(),serverTotal:2},{...result(),features:[]},{...result(),features:[{geometry:null}]}]){
  c.service.wfs.fetchNetwork=async()=>invalid;await assert.rejects(()=>c.service.checkForChanges({deep:true}),/Snapshot/);assert.strictEqual(c.service.state,old);assert.equal(c.values.get(STORAGE_KEY_SNAPSHOT),cache);assert.equal(c.service.update.fingerprint,fp);
 }
});
test('resposta antiga de atualização não substitui rede/cache de pedido mais recente',async()=>{
 const c=setup();await c.service.ensureReady();const pending=[];c.service.wfs.fetchNetwork=()=>new Promise(resolve=>pending.push(resolve));
 const old=c.service.refreshFromWfs();await turn();const latest=c.service.refreshFromWfs();await turn();pending[1](result(3,300));await latest;pending[0](result(2,200));await old;
 assert.equal(c.service.state.features[0].properties.ID,3);assert.equal(c.writes.length,1);assert.equal(c.writes[0].features[0].properties.ID,3);
});
test('escritas em andamento são serializadas: memória e disco terminam na mesma atualização',async()=>{
 const c=setup();await c.service.ensureReady();let release,started;const began=new Promise(r=>started=r);let n=0;
 c.storage.setItem=async(k,v)=>{if(++n===1){started();await new Promise(r=>release=r);}c.values.set(k,v);};
 const first=c.service.refreshFromWfs();await began;c.service.wfs.fetchNetwork=async()=>result(3,300);const second=c.service.refreshFromWfs();await turn();assert.equal(n,1);release();await Promise.all([first,second]);assert.equal(n,2);assert.equal(c.service.state.features[0].properties.ID,3);assert.equal(JSON.parse(c.values.get(STORAGE_KEY_SNAPSHOT)).features[0].properties.ID,3);
});
test('falha WFS libera nova tentativa e consultas desativadas não acessam a rede',async()=>{
 const c=setup();await c.service.ensureReady();c.service.wfs.fetchNetwork=async()=>{throw new Error('offline');};await assert.rejects(()=>c.service.checkForChanges({deep:true}),/offline/);c.service.wfs.fetchNetwork=async()=>result(4);assert.equal((await c.service.checkForChanges({deep:true})).changed,true);
 const off=setup({allowWfs:false});await off.service.ensureReady();await assert.rejects(()=>off.service.refreshFromWfs(),/desativada/);await assert.rejects(()=>off.service.checkForChanges({deep:true}),/desativada/);assert.equal(off.calls.length,0);
});
test('sem snapshot local válido, fallback WFS é persistido; offline explícito falha sem inventar rede',async()=>{
 const c=setup({embeddedSnapshot:null});assert.equal((await c.service.ensureReady()).source,'wfs');assert.equal(c.writes.length,1);
 const off=setup({embeddedSnapshot:null,allowWfs:false});await assert.rejects(()=>off.service.ensureReady(),/desativada/);assert.equal(off.calls.length,0);
});
test('fingerprint não depende da ordem das feições e integração com servidor Node.js delega rotas, cai para offline e sincroniza na reconexão',async()=>{
 const a=[feature(1),feature(2,200)];assert.equal(fingerprintOf(a),fingerprintOf([...a].reverse()));

 const valores=new Map();
 const storage={
  async getItem(k){return valores.get(k)||null;},
  async setItem(k,v){valores.set(k,v);},
 };

 let servidorOnline=true;
 let chamadasApi=[];
 let featuresServidor=[feature(10,300),feature(11,150)];
 let origemServidor='wfs';

 const fetchMock=async(url,init)=>{
  chamadasApi.push({url:String(url),method:init?.method||'GET'});
  if(!servidorOnline) throw new Error('Network request failed');
  const u=new URL(url);
  if(u.pathname==='/api/health'){
   return new Response(JSON.stringify({ready:true,source:origemServidor,originMode:origemServidor,features:featuresServidor.length,builtAt:'2026-11-16T01:00:00.000Z'}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if(u.pathname==='/api/network'){
   return new Response(JSON.stringify({type:'FeatureCollection',features:featuresServidor,meta:{source:origemServidor,originMode:origemServidor,strategy:origemServidor==='wfs'?'single':'snapshot',builtAt:'2026-11-16T01:00:00.000Z',serverTotal:featuresServidor.length,attributes:['ID'],warnings:[]}}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if(u.pathname==='/api/rota-paradas'){
   return new Response(JSON.stringify({ok:true,distance:321.5,circular:true,sequencia:['A','B'],sequenciaCompleta:['A','B','A'],legs:[{de:'A',para:'B',distance:160.75,cor:'#1b7f3a',geometry:{type:'LineString',coordinates:[coord(0),coord(150)]}},{de:'B',para:'A',distance:160.75,retorno:true,cor:'#6a1b9a',geometry:{type:'LineString',coordinates:[coord(150),coord(0)]}}],geometry:{type:'LineString',coordinates:[coord(0),coord(150),coord(0)]},streets:['Rua teste']}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if(u.pathname==='/api/endereco-digital'){
   return new Response(JSON.stringify({ok:true,status:'CONVERTIDO',latitude:-23.66,longitude:-46.54,codigoNormalizado:'8FP9+J6',codigoCompleto:'587P8FP9+J6'}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  return new Response('{}',{status:404});
 };

 const srv=new MobileNetworkServiceCore({
  storage,
  embeddedSnapshot:{...result(1,100),savedAt:1000},
  remoteApiUrl:'https://node.siga.local/',
  fetchImpl:fetchMock,
  allowWfs:false,
  autoUpdate:{enabled:false},
 });

 // 1) Online: carrega do servidor Node.js e delega cálculo + Endereço Digital
 const st=await srv.ensureReady();
 assert.equal(st.source,'api-node');
 assert.equal(st.features[0].properties.ID,10);
 assert.equal(srv.getNetworkMeta().remoteApi.supported,true);
 assert.equal(srv.getNetworkMeta().remoteApi.execution,'remote');
 assert.equal(srv.getNetworkMeta().remoteApi.backendSource,'wfs');

 const rotaOnline=await srv.calcularRotaParadas([{rotulo:'A',longitude:coord(0)[0],latitude:coord(0)[1]},{rotulo:'B',longitude:coord(150)[0],latitude:coord(150)[1]}],{modo:'usuario',circular:true});
 assert.equal(rotaOnline.distance,321.5);
 const endOnline=await srv.resolverEnderecoDigital('8FP9+J6');
 assert.equal(endOnline.status,'CONVERTIDO');

 // 2) Perda de conexão com Node.js: calcula offline com cache local e enfileira pendência de sincronização
 servidorOnline=false;
 const ptsOffline=[{rotulo:'A',longitude:coord(0)[0],latitude:coord(0)[1]},{rotulo:'B',longitude:coord(300)[0],latitude:coord(300)[1]}];
 const rotaOffline=await srv.calcularRotaParadas(ptsOffline,{modo:'usuario',circular:true});
 assert.equal(rotaOffline.ok,true);
 assert.ok(rotaOffline.distance>590&&rotaOffline.distance<610);
 assert.equal(srv.getNetworkMeta().remoteApi.execution,'local-fallback');
 assert.equal(srv.getNetworkMeta().remoteApi.online,false);
 assert.equal(srv.getNetworkMeta().remoteApi.pendingSyncCount,1);

 // 3) Retorno de conexão (agora servidor em modo snapshot): sincroniza pendências e atualiza rede
 servidorOnline=true;
 origemServidor='snapshot';
 featuresServidor=[feature(20,400)];
 const sync=await srv.syncWithServer();
 assert.equal(sync.synced,true);
 assert.equal(sync.changed,true);
 assert.equal(sync.pendingFlushed,1);
 assert.equal(srv.state.features[0].properties.ID,20);
 assert.equal(srv.getNetworkMeta().remoteApi.execution,'remote');
 assert.equal(srv.getNetworkMeta().remoteApi.online,true);
 assert.equal(srv.getNetworkMeta().remoteApi.backendSource,'snapshot');
 assert.equal(srv.getNetworkMeta().remoteApi.pendingSyncCount,0);
});
