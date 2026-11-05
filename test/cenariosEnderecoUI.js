/** Executa os mesmos cenários sobre os handlers reais das duas interfaces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { criarListaCircuito } from '../public/planejamentoCircuito.js';
import { atualizarPonto, rotularPontos, STATUS } from '../core/pontoTrajeto.js';
import { parseCoords, TEXTO_ESTADO } from '../APK/src/utils/formatters.js';
export function testarEnderecos(plataforma, criarRevisoesEndereco, path) {
 const source=readFileSync(path,'utf8'),native=plataforma==='APK';
 function setup(){
  const state={lista:criarListaCircuito()},pending=[],statuses=[],centers=[],tokens=criarRevisoesEndereco();
  Object.assign(state.lista.pontos[0],{enderecoDigital:'8FP9+J6'});const id=state.lista.pontos[0].id;
  const cloneLista=l=>rotularPontos({...l,pontos:l.pontos.map(p=>({...p}))});
  function request(){return new Promise((resolve,reject)=>pending.push({resolve:d=>resolve(native?d:{json:async()=>d}),reject}));}
  const ctx=()=>({state,lista:state.lista,revisoesEndereco:native?{current:tokens}:tokens,Keyboard:{dismiss(){}},setLista:fn=>{state.lista=typeof fn==='function'?fn(state.lista):fn;},cloneLista,atualizarPonto,STATUS,TEXTO_ESTADO,parseCoords,setStatus:(...s)=>statuses.push(s),renderizarPontos:()=>{},atualizarMarcadores:()=>{},mobileNetworkService:{resolverEnderecoDigital:request},fetch:request,pickingId:null,setPickingId:()=>{},mapRef:{current:{centerPoint:(...p)=>centers.push(p)}}});
  function begin(){
   const start=source.indexOf(native?'  const handleValidateCodigo = async':'  async function validarEnderecoDigital');
   const end=source.indexOf(native?'\n  };':'\n  }',start)+(native?5:4),c=ctx();
   const fn=new Function(...Object.keys(c),source.slice(start,end)+`;return ${native?'handleValidateCodigo':'validarEnderecoDigital'};`)(...Object.values(c));
   return fn(id);
  }
  function input(kind,value){
   if(native){
    const name=kind==='codigo'?'handleChangeCodigo':'handleChangeCoordText';const start=source.indexOf(`  const ${name} =`),end=source.indexOf('\n  };',start)+5,c=ctx();
    new Function(...Object.keys(c),source.slice(start,end)+`;return ${name};`)(...Object.values(c))(id,value);
   }else{
    const marker="  els.points.addEventListener('input', (ev) => {",start=source.indexOf(marker)+marker.length,end=source.indexOf('\n  });',start),c=ctx();
    const linha={dataset:{id},querySelector:()=>null};
    new Function(...Object.keys(c),'ev',source.slice(start,end))(...Object.values(c),{target:{value,closest:()=>linha,classList:{contains:k=>k===`point__${kind}`}}});
   }
  }
  return {state,pending,statuses,centers,tokens,id,begin,input};
 }
 const converted=(lat=-23.66)=>({status:STATUS.CONVERTIDO,mensagem:'ok',latitude:lat,longitude:-46.54,codigoNormalizado:'8FP9+J6',codigoCompleto:'588C8FP9+J6'});
 test(`${plataforma}: resposta atual converte o código normalmente`,async()=>{
  const c=setup(),p=c.begin();c.pending[0].resolve(converted());await p;assert.equal(c.state.lista.pontos[0].latitude,-23.66);assert.equal(c.state.lista.pontos[0].origem,'codigo');
 });
 test(`${plataforma}: editar código invalida resultado mesmo se texto voltar ao anterior`,async()=>{
  const c=setup(),p=c.begin();c.input('codigo','outro');c.input('codigo','8FP9+J6');const before=structuredClone(c.state.lista),status=c.statuses.length;
  c.pending[0].resolve(converted());await p;assert.deepEqual(c.state.lista,before);assert.equal(c.statuses.length,status);assert.equal(c.centers.length,0);
 });
 test(`${plataforma}: coordenada manual não é sobrescrita por validação pendente`,async()=>{
  const c=setup(),p=c.begin();c.input('coord','-46.53, -23.65');const before=structuredClone(c.state.lista);
  c.pending[0].resolve(converted());await p;assert.deepEqual(c.state.lista,before);assert.equal(c.state.lista.pontos[0].origem,'coordenada');
 });
 test(`${plataforma}: segunda validação do mesmo código vence resposta fora de ordem`,async()=>{
  const c=setup(),old=c.begin(),latest=c.begin();c.pending[1].resolve(converted(-23.67));await latest;c.pending[0].resolve(converted(-23.68));await old;assert.equal(c.state.lista.pontos[0].latitude,-23.67);
 });
 test(`${plataforma}: erro antigo não limpa resultado da validação mais recente`,async()=>{
  const c=setup(),old=c.begin(),latest=c.begin();c.pending[1].resolve(converted());await latest;const before=structuredClone(c.state.lista),status=c.statuses.length;
  c.pending[0].reject(new Error('erro antigo'));await old;assert.deepEqual(c.state.lista,before);assert.equal(c.statuses.length,status);
 });
 for(const reason of ['mapa','removido','limpeza','desmontagem']) test(`${plataforma}: cancelamento por ${reason} descarta sucesso e erro tardios`,async()=>{
  for(const failed of [false,true]){
   const c=setup(),p=c.begin();if(['limpeza','desmontagem'].includes(reason))c.tokens.limpar();else c.tokens.invalidar(c.id);
   if(reason==='removido')c.state.lista.pontos=[];if(reason==='mapa')Object.assign(c.state.lista.pontos[0],{latitude:-23.7,longitude:-46.5,origem:'mapa'});
   const before=structuredClone(c.state.lista),status=c.statuses.length;
   if(failed)c.pending[0].reject(new Error('erro antigo'));else c.pending[0].resolve(converted());await p;
   assert.deepEqual(c.state.lista,before);assert.equal(c.statuses.length,status);assert.equal(c.centers.length,0);
  }
 });
 test(`${plataforma}: erro atual continua visível e não inventa coordenadas`,async()=>{
  const c=setup(),p=c.begin();c.pending[0].reject(new Error('indisponível'));await p;assert.equal(c.state.lista.pontos[0].status,STATUS.FALHA);assert.equal(c.state.lista.pontos[0].latitude,null);assert.match(c.statuses.at(-1)[0],/Falha/);
 });
}
