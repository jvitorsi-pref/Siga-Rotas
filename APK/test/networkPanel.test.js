import test from 'node:test';
import assert from 'node:assert/strict';
import { criarPainelRede } from '../src/services/networkPanelService.js';
import { apresentarRede } from '../src/utils/networkPresentation.js';
function setup(extra={}) {
 const calls=[],listeners=new Set(),changes=[];
 const service={state:null,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},getNetworkMeta(){return this.state?{source:'snapshot',features:this.state.features.length,cache:{status:'unknown'},update:{}}:null;},getDiagnostics(){return this.state?{nodes:10,edges:20}:null;},async ensureReady(){calls.push('load');this.state={features:[{id:1}]};return this.state;},async checkForChanges(opts){calls.push(['check',opts]);return {deep:true,changed:false,reason:'nenhuma alteração detectada'};},async refreshFromWfs(){calls.push('refresh');return this.state;},startAutoUpdate(){calls.push('startAuto');},stopAutoUpdate(){calls.push('stopAuto');},...extra};
 const panel=criarPainelRede({service,aoMudar:s=>changes.push(s)});
 return {panel,service,calls,listeners,changes,emit:()=>{for(const l of listeners)l();}};
}
test('painel carrega rede, publica metadados/diagnóstico e inicia atualização automática',async()=>{
 const c=setup();await c.panel.abrir();assert.deepEqual(c.calls,['load','startAuto']);assert.equal(c.listeners.size,1);const s=c.changes.at(-1);assert.equal(s.meta.features,1);assert.equal(s.diagnostics.nodes,10);assert.equal(s.operacao,null);assert.equal(s.feedback.kind,'ok');c.panel.descartar();
});
test('verificação usa conteúdo completo; download manual usa o mesmo serviço',async()=>{
 const c=setup();await c.panel.abrir();await c.panel.executar('verificar');await c.panel.executar('baixar');assert.deepEqual(c.calls.slice(-2),[['check',{deep:true}],'refresh']);assert.equal(c.changes.at(-1).feedback.text,'Atualização da rede concluída.');c.panel.descartar();
});
test('dois toques enquanto há operação pendente não duplicam chamadas',async()=>{
 let resolve;const c=setup({checkForChanges:()=>new Promise(r=>resolve=r)});await c.panel.abrir();const p=c.panel.executar('verificar');assert.equal(c.changes.at(-1).operacao,'verificar');assert.equal((await c.panel.executar('baixar')).ocupado,true);resolve({changed:false});await p;assert.equal(c.calls.includes('refresh'),false);assert.equal(c.changes.at(-1).operacao,null);c.panel.descartar();
});
test('falha de carregamento aparece e uma nova tentativa pode recuperar a rede',async()=>{
 const c=setup({async ensureReady(){throw new Error('snapshot indisponível');}});assert.equal((await c.panel.abrir()).ok,false);assert.equal(c.changes.at(-1).meta,null);assert.match(c.changes.at(-1).feedback.text,/snapshot indisponível/);assert.equal(c.changes.at(-1).operacao,null);
 c.service.ensureReady=async()=>{c.service.state={features:[{}]};return c.service.state;};assert.equal((await c.panel.executar('carregar')).ok,true);assert.equal(c.changes.at(-1).meta.features,1);c.panel.descartar();
});
test('falha de atualização preserva a rede e libera o próximo comando',async()=>{
 const c=setup({async refreshFromWfs(){throw new Error('offline');}});await c.panel.abrir();assert.equal((await c.panel.executar('baixar')).ok,false);assert.equal(c.changes.at(-1).meta.features,1);assert.match(c.changes.at(-1).feedback.text,/offline/);assert.equal((await c.panel.executar('verificar')).ok,true);c.panel.descartar();
});
for(const failed of [false,true])test(`descarte durante carregamento ignora conclusão tardia (erro=${failed})`,async()=>{
 let resolve,reject;const c=setup({ensureReady:()=>new Promise((a,b)=>{resolve=a;reject=b;})});const p=c.panel.abrir();c.panel.descartar();const n=c.changes.length;
 if(failed)reject(new Error('tardio'));else{c.service.state={features:[{}]};resolve(c.service.state);}assert.equal((await p).cancelado,true);assert.equal(c.changes.length,n);assert.equal(c.calls.includes('startAuto'),false);assert.equal(c.listeners.size,0);assert.equal((await c.panel.executar('baixar')).cancelado,true);
});
test('descarte durante verificação libera listener/timers e não chama UI depois',async()=>{
 let resolve;const c=setup({checkForChanges:()=>new Promise(r=>resolve=r)});await c.panel.abrir();const p=c.panel.executar('verificar');c.panel.descartar();c.panel.descartar();const n=c.changes.length;resolve({changed:true});await p;c.emit();assert.equal(c.changes.length,n);assert.equal(c.calls.filter(x=>x==='stopAuto').length,1);
});
test('atualização automática renova o painel sem substituir o feedback da última ação',async()=>{
 const c=setup();await c.panel.abrir();const feedback=c.changes.at(-1).feedback;c.service.state={features:[{},{}]};c.emit();assert.equal(c.changes.at(-1).meta.features,2);assert.strictEqual(c.changes.at(-1).feedback,feedback);c.panel.descartar();
});
test('abrir duas vezes não cria duas assinaturas e ação inválida não acessa rede',async()=>{
 const c=setup();await c.panel.abrir();await c.panel.abrir();assert.equal(c.listeners.size,1);const n=c.calls.length;assert.equal((await c.panel.executar('inventada')).codigo,'ACAO_INVALIDA');assert.equal(c.calls.length,n);c.panel.descartar();
});
test('rótulos distinguem snapshot, cache e WFS carregado sem declarar conectividade',()=>{
 assert.equal(apresentarRede({source:'snapshot'}).fonte,'Snapshot incluído no APK');assert.equal(apresentarRede({source:'wfs-cache'}).fonte,'Cache local do WFS');assert.equal(apresentarRede({source:'wfs'}).fonte,'WFS — carregado nesta sessão');
 assert.equal(apresentarRede({source:'snapshot',cache:{status:'persisted'}}).cache,'Salvo para a próxima abertura');assert.match(apresentarRede({cache:{status:'memory-only'}}).cache,/apenas em memória/);
});
test('apresentação inclui quota, limite remoto e últimos cinco erros sem apagar avisos WFS',()=>{
 const p=apresentarRede({warnings:['originais'],cache:{status:'memory-only',error:'quota'},remoteApi:{configured:true,supported:false},update:{recentErrors:Array.from({length:8},(_,i)=>({message:String(i)}))}});
 assert.deepEqual(p.avisos,['originais','quota','Delegação remota não implementada; o cálculo permanece local.']);assert.deepEqual(p.erros,['3','4','5','6','7']);
});

test('integração: painel mostra grafo/cache reais, quota e recuperação offline após nova gravação',async()=>{
 const { MobileNetworkServiceCore }=await import('../src/services/mobileNetworkServiceCore.js');
 const feature=id=>({type:'Feature',properties:{ID:id,COD_LOG:1},geometry:{type:'LineString',coordinates:[[-46.54,-23.66],[-46.541,-23.66]]}});
 const values=new Map();let quota=true;const storage={async getItem(k){return values.get(k)||null;},async setItem(k,v){if(quota)throw new Error('quota');values.set(k,v);}};
 const options={storage,embeddedSnapshot:{features:[feature(1)],serverTotal:1},autoUpdate:{enabled:false},wfs:{fetchNetwork:async()=>({features:[feature(2)],serverTotal:1,strategy:'single'})}};
 const changes=[],service=new MobileNetworkServiceCore(options),panel=criarPainelRede({service,aoMudar:s=>changes.push(s)});
 await panel.abrir();assert.equal(changes.at(-1).meta.update.enabled,false);assert.ok(changes.at(-1).diagnostics.nodes>0);
 await panel.executar('verificar');assert.equal(changes.at(-1).meta.cache.status,'memory-only');assert.match(apresentarRede(changes.at(-1).meta).avisos[0],/apenas em memória/);
 quota=false;await panel.executar('verificar');assert.equal(changes.at(-1).meta.cache.status,'persisted');panel.descartar();
 const restarted=new MobileNetworkServiceCore({...options,allowWfs:false});const recovered=[],next=criarPainelRede({service:restarted,aoMudar:s=>recovered.push(s)});await next.abrir();assert.equal(recovered.at(-1).meta.source,'wfs-cache');assert.equal(recovered.at(-1).meta.update.enabled,false);assert.equal(recovered.at(-1).features[0].properties.ID,2);next.descartar();
});
