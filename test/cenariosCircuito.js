/** Mesmos cenários de interface/roteamento executados pelas duas suítes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { adicionarPonto, moverPonto, removerPonto, podeCalcular } from '../core/pontoTrajeto.js';
import { buildGraph } from '../core/graph.js';
import { project, unproject } from '../core/geo.js';
import { feature, official } from './helpers.js';
export function testarCircuitos(plataforma, ui, calcular) {
  const [x,y]=project(-46.545,-23.66);
  const coord=(dx,dy)=>unproject(x+dx,y+dy);
  const graph=buildGraph([
    feature(official(1,'Principal'),[coord(0,0),coord(400,0)]),
    feature(official(2,'Ramal B'),[coord(100,0),coord(100,200)]),
    feature(official(3,'Ramal C'),[coord(300,0),coord(300,200)]),
  ]);
  function lista(){
    const l=ui.criarListaCircuito();
    for(let i=0;i<3;i++) adicionarPonto(l,{});
    [[0,0],[300,200],[100,200],[400,0]].forEach(([dx,dy],i)=>{
      const [longitude,latitude]=coord(dx,dy);Object.assign(l.pontos[i],{longitude,latitude});
    });return l;
  }
  test(`${plataforma}: começa e limpa com apenas A, origem e destino`,()=>{
    for(let i=0;i<2;i++){
      const l=ui.criarListaCircuito();assert.equal(l.circuito,true);assert.equal(l.pontos.length,1);assert.equal(l.pontos[0].rotulo,'A');assert.equal(ui.papelPontoCircuito(l.pontos[0]),'Origem e destino');assert.equal(podeCalcular(l).ok,false);
    }
  });
  test(`${plataforma}: adicionar, excluir e reordenar mantém A fixo e último card como parada`,()=>{
    const l=lista(),origem=l.pontos[0].id,last=l.pontos.at(-1).id;
    moverPonto(l,last,-1);removerPonto(l,l.pontos[1].id);adicionarPonto(l,{});
    assert.equal(l.pontos[0].id,origem);assert.ok(l.pontos.slice(1).every(p=>p.tipo==='parada'));assert.equal(ui.papelPontoCircuito(l.pontos.at(-1)),`Parada ${l.pontos.at(-1).rotulo}`);
  });
  test(`${plataforma}: as duas ações enviam circular=true e o padrão respeita a ordem`,()=>{
    assert.deepEqual(ui.opcoesCalculoCircuito(),{modo:'usuario',circular:true});assert.deepEqual(ui.opcoesCalculoCircuito('otimizada'),{modo:'otimizada',circular:true});assert.throws(()=>ui.opcoesCalculoCircuito('saida_curta'));
  });
  for(const modo of ['usuario','otimizada']) test(`${plataforma}: ${modo} retorna a A pela rede, preserva cards e inclui o custo do retorno`,()=>{
    const l=lista(),before=structuredClone(l);const r=calcular(graph,l.pontos,ui.opcoesCalculoCircuito(modo));
    assert.equal(r.ok,true);assert.equal(r.circular,true);assert.equal(r.sequenciaCompleta[0],'A');assert.equal(r.sequenciaCompleta.at(-1),'A');assert.equal(r.legs.length,l.pontos.length);assert.equal(r.legs.at(-1).retorno,true);assert.deepEqual(l,before);
    assert.ok(Math.abs(r.distance-r.legs.reduce((sum,leg)=>sum+leg.distance,0))<1e-6);
    assert.ok(r.legs.every(leg=>leg.geometry.type==='LineString'&&leg.geometry.coordinates.length>=2));
    if(modo==='usuario') assert.deepEqual(r.sequenciaCompleta,['A','B','C','D','A']);
    else assert.ok(r.distance<=calcular(graph,l.pontos,ui.opcoesCalculoCircuito('usuario')).distance+1e-6);
  });
}
