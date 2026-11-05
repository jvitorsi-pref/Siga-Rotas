import test from 'node:test';
import assert from 'node:assert/strict';
import { criarSincronizacaoMapa } from '../src/map/mapSync.js';
const geometry={type:'LineString',coordinates:[[-46.5,-23.7],[-46.49,-23.7]]};
const base=()=>({ready:true,session:1,visible:true,features:[{geometry}],markers:[],routeGeometry:geometry,routeSegments:[],navigationPosition:null});
function setup(){const sent=[],sync=criarSincronizacaoMapa(m=>sent.push(m));return {sent,sync};}
test('primeira sessão envia dados e enquadra rota uma vez, sem calcular nova geometria',()=>{
 const a=setup(),p=base();a.sync.atualizar(p);assert.equal(a.sent.filter(m=>m.type==='FIT_ROUTE').length,1);assert.strictEqual(a.sent.find(m=>m.type==='SET_ROUTE').geometry,geometry);assert.equal(a.sent.find(m=>m.type==='SET_NETWORK').fit,false);const n=a.sent.length;a.sync.atualizar(p);assert.equal(a.sent.length,n);
});
test('Painel → Dividido preserva câmera: apenas resize, sem reenviar rede/rota ou fit',()=>{
 const a=setup(),p=base();a.sync.atualizar(p);a.sent.length=0;a.sync.atualizar({...p,visible:false});a.sync.atualizar(p);assert.deepEqual(a.sent,[{type:'RESIZE_MAP'}]);
});
test('atualização WFS não reposiciona câmera já inicializada',()=>{
 const a=setup(),p=base();a.sync.atualizar(p);a.sent.length=0;a.sync.atualizar({...p,features:[{geometry:{...geometry}}]});assert.deepEqual(a.sent.map(m=>m.type),['SET_NETWORK']);assert.equal(a.sent[0].fit,false);
});
test('rota calculada enquanto oculto recebe fit apenas ao voltar; ocultar trecho não recebe fit',()=>{
 const a=setup(),p=base();a.sync.atualizar(p);a.sent.length=0;const next={...p,routeGeometry:{...geometry},visible:false};a.sync.atualizar(next);assert.equal(a.sent.some(m=>m.type==='FIT_ROUTE'),false);a.sync.atualizar({...next,visible:true});assert.equal(a.sent.filter(m=>m.type==='FIT_ROUTE').length,1);a.sent.length=0;a.sync.atualizar({...next,visible:true,routeSegments:[{geometry,visivel:false}]});assert.deepEqual(a.sent.map(m=>m.type),['SET_ROUTE']);assert.equal(a.sent[0].fit,false);
});
test('recálculo de navegação não enquadra nem ao voltar ao mapa',()=>{
 const a=setup(),p=base();a.sync.atualizar(p);a.sent.length=0;const next={...p,visible:false,suppressRouteFit:true,routeGeometry:{...geometry}};a.sync.atualizar(next);a.sync.atualizar({...next,visible:true});assert.equal(a.sent.some(m=>m.type.startsWith('FIT_')),false);
});
test('centralização explícita aguarda mapa pronto/visível e vence o fit automático',()=>{
 const a=setup(),p=base();a.sync.comando({type:'CENTER_POINT',lon:-46.5,lat:-23.7});a.sync.atualizar({...p,ready:false});assert.equal(a.sent.length,0);a.sync.atualizar({...p,visible:false});assert.equal(a.sent.some(m=>m.type==='CENTER_POINT'),false);a.sync.atualizar(p);assert.equal(a.sent.at(-1).type,'CENTER_POINT');assert.equal(a.sent.some(m=>m.type.startsWith('FIT_')),false);
});
test('comando de centralização por prop também é adiado e não é repetido em updates',()=>{
 const a=setup(),p={...base(),centerRequest:{longitude:-46.5,latitude:-23.7}};a.sync.atualizar({...p,visible:false});a.sync.atualizar(p);a.sync.atualizar({...p,navigationPosition:{latitude:0,longitude:0}});assert.equal(a.sent.filter(m=>m.type==='CENTER_POINT').length,1);
});
test('nova sessão da WebView restaura camadas e posição mesmo com os mesmos objetos',()=>{
 const a=setup(),p=base();a.sync.atualizar(p);a.sent.length=0;a.sync.atualizar({...p,session:2});for(const type of ['SET_NETWORK','SET_ROUTE','SET_MARKERS','SET_POSITION'])assert.ok(a.sent.some(m=>m.type===type));
});
test('limpar rota oculta cancela enquadramento pendente e rede vazia remove feições antigas',()=>{
 const a=setup(),p=base();a.sync.atualizar(p);a.sent.length=0;a.sync.atualizar({...p,visible:false,routeGeometry:{...geometry}});const next={...p,visible:false,features:[],routeGeometry:null};a.sync.atualizar(next);a.sync.atualizar({...next,visible:true});assert.equal(a.sent.some(m=>m.type.startsWith('FIT_')),false);assert.equal(a.sent.filter(m=>m.type==='SET_NETWORK').at(-1).features.length,0);
});

test('cancelar pedido de centralização oculto não recentraliza em posição antiga ao voltar',()=>{
 const a=setup(),p=base();a.sync.atualizar(p);a.sent.length=0;a.sync.atualizar({...p,visible:false,centerRequest:{longitude:-46.5,latitude:-23.7}});a.sync.atualizar({...p,visible:false,centerRequest:null});a.sync.atualizar(p);assert.equal(a.sent.some(m=>m.type==='CENTER_POINT'),false);
});
