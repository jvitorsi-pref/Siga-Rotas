/** Componente real com hooks/primitivas injetados; não é WebView Android. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { COLORS } from '../src/theme/colors.js';
import { MAP_HTML } from '../src/map/mapHtml.js';
import { criarSincronizacaoMapa } from '../src/map/mapSync.js';
import * as camadaBase from '../src/map/camadaBase.js';
const require=createRequire(new URL('../package.json',import.meta.url));
const code=require('@babel/core').transformSync(readFileSync(new URL('../src/components/RoadNetworkMap.js',import.meta.url),'utf8'),{babelrc:false,configFile:false,plugins:[require.resolve('@babel/plugin-transform-react-jsx'),require.resolve('@babel/plugin-transform-modules-commonjs')]}).code;
function setup(initial={}){
 const slots=[],effects=[],sent=[];let index=0,props={visible:true,basemapMode:'osm',features:[{geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}}],markers:[],routeGeometry:{type:'LineString',coordinates:[[0,0],[1,1]]},routeSegments:[],...initial};
 const ref={current:null};
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),forwardRef:fn=>fn,
 useRef:initial=>{const i=index++;return slots[i]??(slots[i]={current:initial});},useState:initial=>{const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],fn=>{slots[i]=typeof fn==='function'?fn(slots[i]):fn;}];},
 useEffect:(fn,deps)=>{const i=index++,last=slots[i];if(!last||deps.some((d,j)=>d!==last[j]))effects.push(fn);slots[i]=deps;},useImperativeHandle:(r,fn)=>{r.current=fn();}};
 const native=Object.fromEntries(['View','Text','TouchableOpacity','ActivityIndicator','ScrollView'].map(n=>[n,n]));native.StyleSheet={create:s=>s};
 const deps={react:React,'react-native':native,'react-native-webview':{WebView:'WebView'},'../theme/colors':{COLORS},'../map/mapHtml.js':{MAP_HTML},'../map/mapSync.js':{criarSincronizacaoMapa},'../map/camadaBase.js':camadaBase};
 const module={exports:{}};new Function('require','module','exports',code)(n=>{assert.ok(n in deps,n);return deps[n];},module,module.exports);
 function nodes(n,out=[]){if(Array.isArray(n)){for(const child of n)nodes(child,out);}else if(n&&typeof n==='object'){out.push(n);nodes(n.props?.children,out);}return out;}
 function text(n){if(Array.isArray(n))return n.map(text).join(' ');if(n==null||typeof n==='boolean')return '';return typeof n==='object'?text(n.props?.children):String(n);}
 function render(update={}){props={...props,...update};index=0;const tree=module.exports.RoadNetworkMap(props,ref);const web=nodes(tree).find(n=>n.type==='WebView');web.props.ref.current={injectJavaScript:s=>{const start=s.indexOf('window.__handleRNMessage(')+'window.__handleRNMessage('.length;sent.push(JSON.parse(s.slice(start,s.lastIndexOf('); true;'))));}};while(effects.length)effects.shift()();return {tree,web};}
 function ready(){let r=render();r.web.props.onMessage({nativeEvent:{data:JSON.stringify({type:'MAP_READY'})}});return render();}
 return {render,ready,nodes,text,sent,ref};
}
test('componente preserva WebView, fonte HTML e legenda retrátil (fecha no lugar do botão)',()=>{
 const c=setup(),first=c.ready();
 // Começa fechada: mostra o botão Legenda e oculta os itens da legenda
 assert.doesNotMatch(c.text(first.tree),/Eixo viário oficial/);
 const btnLegenda=c.nodes(first.tree).find(n=>n.type==='TouchableOpacity'&&c.text(n).includes('Legenda'));
 assert.ok(btnLegenda);
 // Ao tocar em Legenda, o botão some e a legenda abre no lugar
 btnLegenda.props.onPress();
 const openLegend=c.render();
 assert.match(c.text(openLegend.tree),/Eixo viário oficial/);
 assert.equal(c.nodes(openLegend.tree).some(n=>n.type==='TouchableOpacity'&&c.text(n).trim()==='Legenda'),false);
 // Preserva WebView e estado aberto ao alternar visibilidade do mapa
 c.sent.length=0;const hidden=c.render({visible:false});const restored=c.render({visible:true});assert.strictEqual(first.web.props.ref,hidden.web.props.ref);assert.strictEqual(first.web.props.source,restored.web.props.source);assert.match(c.text(restored.tree),/Eixo viário oficial/);assert.deepEqual(c.sent,[{type:'RESIZE_MAP'}]);
 // Ao clicar na caixa da legenda, ela fecha e o botão Legenda volta
 c.nodes(restored.tree).find(n=>n.type==='TouchableOpacity'&&c.text(n).includes('Eixo viário oficial')).props.onPress();
 const closedLegend=c.render();
 assert.doesNotMatch(c.text(closedLegend.tree),/Eixo viário oficial/);
 assert.ok(c.nodes(closedLegend.tree).find(n=>n.type==='TouchableOpacity'&&c.text(n).includes('Legenda')));
});
test('onLayout solicita resize sem reenquadrar e não envia comandos quando mapa está oculto',()=>{
 const c=setup(),r=c.ready();c.sent.length=0;r.tree.props.onLayout();assert.deepEqual(c.sent,[{type:'RESIZE_MAP'}]);c.render({visible:false});c.sent.length=0;c.render().tree.props.onLayout();assert.equal(c.sent.length,0);
});
test('novo MAP_READY repõe camadas após recarga da WebView sem reiniciar legenda',()=>{
 const c=setup(),r=c.ready();c.sent.length=0;r.web.props.onMessage({nativeEvent:{data:'{"type":"MAP_READY"}'}});c.render();assert.ok(c.sent.some(m=>m.type==='SET_NETWORK'));assert.ok(c.sent.some(m=>m.type==='SET_ROUTE'));
});
test('App mantém mapa montado, invisível e fora da acessibilidade quando exibe só painel',()=>{
 const app=readFileSync(new URL('../App.js',import.meta.url),'utf8');assert.doesNotMatch(app,/layoutMode !== 'panel' &&/);assert.match(app,/visible=\{layoutMode !== 'panel'\}/);assert.match(app,/no-hide-descendants/);assert.match(app,/mapAreaHidden: \{ position: 'absolute'[\s\S]*?opacity: 0/);
});
test('seletor Mapa padrão / Satélite alterna camada base sem recriar WebView e trata indisponibilidade',()=>{
 const escolhidos=[];
 const c=setup({onChangeBasemap:(m)=>escolhidos.push(m)});
 const first=c.ready();
 const radioOsm=c.nodes(first.tree).find(n=>n.type==='TouchableOpacity'&&c.text(n)==='Mapa padrão');
 const radioSat=c.nodes(first.tree).find(n=>n.type==='TouchableOpacity'&&c.text(n)==='Satélite');
 assert.equal(radioOsm.props.accessibilityState.selected,true);
 assert.equal(radioSat.props.accessibilityState.selected,false);

 radioSat.props.onPress();
 assert.deepEqual(escolhidos,['satelite']);

 c.sent.length=0;
 const satView=c.render({basemapMode:'satelite'});
 assert.strictEqual(first.web.props.ref,satView.web.props.ref);
 assert.deepEqual(c.sent,[{type:'SET_BASEMAP',mode:'satelite'}]);
 assert.equal(c.nodes(satView.tree).find(n=>n.type==='TouchableOpacity'&&c.text(n)==='Satélite').props.accessibilityState.selected,true);

 // Aviso não bloqueante aparece quando satélite falha/offline e oferece retorno rápido
 satView.web.props.onMessage({nativeEvent:{data:JSON.stringify({type:'BASEMAP_STATUS',mode:'satelite',status:'unavailable',message:'Satélite indisponível sem conexão.'})}});
 const comAviso=c.render();
 assert.match(c.text(comAviso.tree),/Satélite indisponível sem conexão/);
 const voltarBtn=c.nodes(comAviso.tree).find(n=>n.type==='TouchableOpacity'&&c.text(n)==='Usar mapa padrão');
 assert.ok(voltarBtn);
 voltarBtn.props.onPress();
 assert.deepEqual(escolhidos,['satelite','osm']);

 const voltaOsm=c.render({basemapMode:'osm'});
 assert.doesNotMatch(c.text(voltaOsm.tree),/Satélite indisponível sem conexão/);
});
test('toque no mapa: com seleção ativa define o ponto; sem seleção alterna o trecho', () => {
  const c = setup();
  const escolhidos = [], cliques = [];
  const comSelecao = c.render({ pickingPoint: { id: 'p1' }, onMapPickCoordinate: p => escolhidos.push(p), onMapClick: p => cliques.push(p) });
  comSelecao.web.props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'MAP_CLICK', lon: -46.5, lat: -23.7, zoom: 17 }) } });
  assert.deepEqual(escolhidos, [{ lon: -46.5, lat: -23.7 }]);
  assert.deepEqual(cliques, [], 'seleção de ponto não alterna trecho');
  const semSelecao = c.render({ pickingPoint: null });
  semSelecao.web.props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'MAP_CLICK', lon: -46.5, lat: -23.7, zoom: 17 }) } });
  assert.deepEqual(cliques, [{ lon: -46.5, lat: -23.7, zoom: 17 }]);
  assert.equal(escolhidos.length, 1);
});
test('botão unificado de ocorrências abre popover com Nova Ocorrência e Visualizar; centralizar substitui Rede', () => {
  let iniciou = 0, alternou = 0;
  const c = setup({
    showOccurrences: true,
    onStartPickOccurrence: () => { iniciou += 1; },
    onToggleOccurrences: () => { alternou += 1; },
  });
  const first = c.ready();
  assert.doesNotMatch(c.text(first.tree), /\bRede\b/);
  assert.doesNotMatch(c.text(first.tree), /Nova Ocorrência/);
  const btnCenter = c.nodes(first.tree).find(n => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Centralizar rede no mapa');
  assert.ok(btnCenter);
  c.sent.length = 0;
  btnCenter.props.onPress();
  assert.deepEqual(c.sent, [{ type: 'FIT_NETWORK' }]);

  const btnOcc = c.nodes(first.tree).find(n => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Ocorrências');
  assert.ok(btnOcc);
  btnOcc.props.onPress();
  const opened = c.render();
  assert.match(c.text(opened.tree), /Nova Ocorrência/);
  assert.match(c.text(opened.tree), /Visualizar/);

  const optVisualizar = c.nodes(opened.tree).find(n => n.type === 'TouchableOpacity' && c.text(n).includes('Visualizar'));
  optVisualizar.props.onPress();
  assert.equal(alternou, 1);

  const optNova = c.nodes(opened.tree).find(n => n.type === 'TouchableOpacity' && c.text(n).includes('Nova Ocorrência'));
  optNova.props.onPress();
  assert.equal(iniciou, 1);
  const afterNova = c.render();
  assert.doesNotMatch(c.text(afterNova.tree), /Nova Ocorrência/);
});
