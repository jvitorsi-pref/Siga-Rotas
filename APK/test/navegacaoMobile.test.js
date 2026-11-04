import test from 'node:test';
import assert from 'node:assert/strict';
import { criarNavegacaoMobile } from '../src/services/mobileNavigationService.js';
import { criarNavegacao, planoDeNavegacao } from '../../core/navegacao.js';
import { instrucaoAtual } from '../../core/instrucoes.js';
import { buildGraph } from '../../core/graph.js';
import { calcularRotaComParadas } from '../../core/rotaParadas.js';
import { project, unproject } from '../../core/geo.js';
const [x,y] = project(-46.5,-23.7);
const coord = (dx,dy) => unproject(x+dx,y+dy);
const ponto = (dx,dy) => { const [longitude,latitude] = coord(dx,dy); return {longitude,latitude}; };
const pos = (dx,dy,extra={}) => ({ ...ponto(dx,dy), precisao: 5, simulado: true, timestamp: 1700000000000, ...extra });
const features = [ [[0,0],[300,0]], [[300,0],[300,400]], [[300,400],[0,400]], [[0,400],[0,0]] ].map((ends,i)=>({
  type:'Feature', properties:{ ID:i+1, COD_LOG: i+1, NOM_LOGRADOURO:`RUA ${i+1}` }, geometry: {type:'LineString',coordinates:ends.map(([a,b])=>coord(a,b))}
}));
const graph = buildGraph(features);
const pontos = [[0,0],[300,0],[300,400]].map(([a,b],i)=>({...ponto(a,b),rotulo:String.fromCharCode(65+i)}));
const rota = (circular=false) => calcularRotaComParadas(graph,pontos,{modo:'usuario',circular});
function setup(calcular, real = false) {
  const fontes=[], eventos=[], rotas=[];
  const factory = (options) => {
    const f = { options, starts:0,stops:0,pauses:0,sinal:true,
      iniciar(){this.starts++;}, parar(){this.stops++;}, pausar(){this.pauses++;}, retomar(){this.starts++;},
      definirPlano(plano){this.plano=plano;}, limparDesvio(){}, definirVelocidade(v){this.velocidade=v;},
      perderSinal(){this.sinal=false;}, recuperarSinal(){this.sinal=true;},
      avancar(m){this.avanco=m;}, iniciarEm(m){this.inicio=m;}, aplicarDesvio(m){this.desvio=m;},
      definirPosicaoManual(latitude,longitude){options.aoAtualizar({latitude,longitude,precisao:5,simulado:true});},
      emitir(p){options.aoAtualizar(p);},
    }; fontes.push(f); return f;
  };
  const nav = criarNavegacaoMobile({ calcularRotaParadas: calcular || ((ps,op)=>Promise.resolve(calcularRotaComParadas(graph,ps,op))), aoMudar:e=>eventos.push(e), aoRecalcular:r=>rotas.push(r), ...(real ? {} : {criarFonte:factory}) });
  return {nav,fontes,eventos,rotas};
}
const turn = () => new Promise(resolve=>setImmediate(resolve));

test('mobile simulado usa o mesmo estado e instruções do controlador Web', () => {
  const {nav,fontes} = setup(); const r=rota(); nav.iniciar(r);
  const web = criarNavegacao(planoDeNavegacao(r)); web.iniciar();
  for(const p of [pos(0,0),pos(140,0),pos(300,0),pos(300,0),pos(300,0),pos(300,160)]){
    fontes[0].emitir(p); web.atualizarPosicao(p);
    for(const key of ['percorrido','progresso','trechoAtual','distanciaRestante']) assert.equal(nav.estado[key],web.estado[key]);
    assert.deepEqual(nav.estado.instrucao,instrucaoAtual(web.plano,web.estado));
    assert.deepEqual(nav.estado.paradasConcluidas,web.estado.paradasConcluidas);
  }
  assert.equal(nav.estado.modo,'simulacao'); nav.descartar();
});
test('chegada requer três leituras; conclusão libera fonte e mantém identificação simulada', () => {
  const {nav,fontes}=setup();nav.iniciar(rota());
  for(let n=0;n<2;n++)fontes[0].emitir(pos(300,0));
  assert.equal(nav.estado.proximaParada.rotulo,'B');
  fontes[0].emitir(pos(300,0));
  for(let n=0;n<3;n++)fontes[0].emitir(pos(300,400));
  assert.equal(nav.estado.concluida,true);assert.equal(nav.estado.execucao,'encerrado');
  assert.ok(fontes[0].stops>=1);assert.equal(nav.estado.posicao.simulado,true);nav.descartar();
});
test('pausa/retomada e reinício liberam fonte e não reaproveitam leituras antigas', () => {
  const {nav,fontes}=setup();nav.iniciar(rota());fontes[0].emitir(pos(120,0));const before=nav.estado.percorrido;
  nav.pausar();fontes[0].emitir(pos(200,0));assert.equal(nav.estado.percorrido,before);
  nav.retomar();fontes[0].emitir(pos(200,0));assert.ok(nav.estado.percorrido>before);
  nav.reiniciar();assert.equal(fontes[0].stops,1);fontes[0].emitir(pos(300,400));assert.equal(nav.estado.posicao,null);
  assert.equal(fontes.length,2);nav.descartar();
});
test('circuito: recálculo usa motor local, ordem restante e retorno original explícito', async () => {
  let request;
  const {nav,fontes,rotas}=setup(async(ps,op)=>{request={ps,op};return calcularRotaComParadas(graph,ps,op);});
  nav.iniciar(rota(true));for(let n=0;n<3;n++)fontes[0].emitir(pos(100,60));await turn();
  assert.deepEqual(request.op,{modo:'usuario',circular:false});
  assert.deepEqual(request.ps.map(p=>p.rotulo),['A','B','C','A']);
  assert.equal(rotas.length,1);assert.equal(rotas[0].ok,true);assert.equal(nav.estado.recalculando,false);nav.descartar();
});
test('falha no recálculo não instala geometria parcial como rota completa', async () => {
  const {nav,fontes,rotas}=setup(async()=>({ok:false,message:'Sem conexão viária',geometry:rota().geometry}));
  nav.iniciar(rota());for(let n=0;n<3;n++)fontes[0].emitir(pos(100,60));await turn();
  assert.equal(rotas.length,0);assert.match(nav.estado.aviso,/Sem conexão viária/);assert.equal(nav.estado.recalculando,false);nav.descartar();
});
for (const acao of ['encerrar','reiniciar','pausa-retoma','descartar']) {
  test(`resposta atrasada de desvio é ignorada após ${acao}`, async () => {
    let resolver;
    const {nav,fontes,rotas}=setup(()=>new Promise(resolve=>{resolver=resolve;}));
    nav.iniciar(rota());for(let n=0;n<3;n++)fontes[0].emitir(pos(100,60));
    assert.equal(nav.estado.recalculando,true);
    if(acao==='pausa-retoma'){nav.pausar();nav.retomar();} else nav[acao]();
    resolver(rota());await turn();assert.equal(rotas.length,0);nav.descartar();
  });
}
test('cenários de sinal e comandos não acessam GPS real; fonte real é recusada', () => {
  const {nav,fontes}=setup();nav.iniciar(rota());nav.definirVelocidade(25);nav.avancar(100);nav.iniciarEm(200);nav.aplicarDesvio();
  assert.equal(fontes[0].velocidade,25);assert.equal(fontes[0].avanco,100);assert.equal(fontes[0].inicio,200);assert.equal(fontes[0].desvio,120);
  nav.perderSinal();assert.equal(nav.estado.sinalPerdido,true);nav.recuperarSinal();assert.equal(nav.estado.sinalPerdido,false);
  fontes[0].emitir(pos(10,0,{simulado:false}));assert.equal(nav.estado.posicao,null);
  assert.equal(nav.posicaoManual(999,-46).ok,false);assert.equal(nav.posicaoManual(-23.7,-46.5).ok,true);nav.descartar();
});
test('integração com simulador original emite posição fictícia e descarta temporizador', () => {
  const {nav}=setup(undefined,true);nav.iniciar(rota());assert.equal(nav.estado.posicao.simulado,true);
  nav.avancar(100);assert.ok(nav.estado.percorrido>90);nav.descartar();assert.equal(nav.estado,null);
});
test('não aceita rota parcial como plano de navegação', () => {
  const {nav}=setup();assert.equal(nav.iniciar({...rota(),ok:false}).ok,false);assert.equal(nav.estado,null);nav.descartar();
});

test('GPS real usa controlador Web e não aceita comandos/leituras de simulação', async () => {
  let handlers, stopped=0, manual=0;
  const nav=criarNavegacaoMobile({criarFonteGPS:opts=>{handlers=opts;return {
    async iniciar(){return {ok:true};},pausar(){},async retomar(){return {ok:true};},parar(){stopped++;},definirPosicaoManual(){manual++;}
  };}});
  const r=rota();assert.equal((await nav.iniciar(r,'gps')).ok,true);
  const web=criarNavegacao(planoDeNavegacao(r));web.iniciar();
  for(const p of [pos(0,0,{simulado:false}),pos(100,0,{simulado:false})]){
    handlers.aoAtualizar(p);web.atualizarPosicao(p);
    assert.equal(nav.estado.percorrido,web.estado.percorrido);assert.deepEqual(nav.estado.instrucao,instrucaoAtual(web.plano,web.estado));
  }
  handlers.aoAtualizar(pos(200,0));assert.equal(nav.estado.posicao.simulado,false);
  assert.equal(nav.posicaoManual(-23.7,-46.5).ok,false);assert.equal(manual,0);nav.avancar(100);nav.aplicarDesvio();nav.perderSinal();
  assert.equal(nav.estado.modo,'gps');nav.encerrar();assert.ok(stopped>0);assert.equal(nav.estado,null);
});
test('GPS: negação na abertura deixa navegação pausada e não inicia simulador de reserva', async () => {
 let sim=0;
 const nav=criarNavegacaoMobile({criarFonte:()=>{sim++;},criarFonteGPS:()=>({async iniciar(){return {ok:false,message:'Permissão negada'};},parar(){}})});
 assert.equal((await nav.iniciar(rota(),'gps')).ok,false);assert.equal(nav.estado.execucao,'pausado');assert.equal(nav.estado.iniciando,false);
 assert.match(nav.estado.aviso,/Permissão negada/);assert.equal(sim,0);nav.descartar();
});
test('GPS: resultado atrasado da permissão não pausa a sessão retomada', async () => {
 let resolver;
 const nav=criarNavegacaoMobile({criarFonteGPS:()=>({iniciar:()=>new Promise(r=>{resolver=r;}),pausar(){},retomar:async()=>({ok:true}),parar(){}})});
 const opening=nav.iniciar(rota(),'gps');assert.equal(nav.estado.iniciando,true);nav.pausar();await nav.retomar();
 resolver({ok:false,message:'negação antiga'});assert.equal((await opening).cancelado,true);assert.equal(nav.estado.execucao,'ativo');nav.descartar();
});
test('GPS: erro de sinal mantém última posição e background pausa sem retomar sozinho',async()=>{
 let handlers;
 const nav=criarNavegacaoMobile({criarFonteGPS:opts=>{handlers=opts;return {iniciar:async()=>({ok:true}),retomar:async()=>({ok:true}),pausar(){},parar(){}};}});
 await nav.iniciar(rota(),'gps');handlers.aoAtualizar(pos(100,0,{simulado:false}));
 handlers.aoErro({codigo:'TIMEOUT',mensagem:'Sinal perdido'});assert.equal(nav.estado.sinalPerdido,true);assert.ok(nav.estado.posicao);
 handlers.aoInterromper('Aplicativo em segundo plano');assert.equal(nav.estado.execucao,'pausado');
 await nav.retomar();handlers.aoAtualizar(pos(120,0,{simulado:false}));assert.equal(nav.estado.sinalPerdido,false);nav.descartar();
});
test('GPS: sem adaptador nativo não cai silenciosamente para a simulação',()=>{
 const {nav}=setup();assert.equal(nav.iniciar(rota(),'gps').ok,false);assert.equal(nav.estado,null);nav.descartar();
});
