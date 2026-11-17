/** Componente real com hooks/primitivas injetados; não é WebView Android. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { COLORS } from '../src/theme/colors.js';
import { MAP_HTML } from '../src/map/mapHtml.js';
import { criarSincronizacaoMapa } from '../src/map/mapSync.js';
const require=createRequire(new URL('../package.json',import.meta.url));
const code=require('@babel/core').transformSync(readFileSync(new URL('../src/components/RoadNetworkMap.js',import.meta.url),'utf8'),{babelrc:false,configFile:false,plugins:[require.resolve('@babel/plugin-transform-react-jsx'),require.resolve('@babel/plugin-transform-modules-commonjs')]}).code;
function setup(){
 const slots=[],effects=[],sent=[];let index=0,props={visible:true,features:[{geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}}],markers:[],routeGeometry:{type:'LineString',coordinates:[[0,0],[1,1]]},routeSegments:[]};
 const ref={current:null};
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),forwardRef:fn=>fn,
 useRef:initial=>{const i=index++;return slots[i]??(slots[i]={current:initial});},useState:initial=>{const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],fn=>{slots[i]=typeof fn==='function'?fn(slots[i]):fn;}];},
 useEffect:(fn,deps)=>{const i=index++,last=slots[i];if(!last||deps.some((d,j)=>d!==last[j]))effects.push(fn);slots[i]=deps;},useImperativeHandle:(r,fn)=>{r.current=fn();}};
 const native=Object.fromEntries(['View','Text','TouchableOpacity','ActivityIndicator','ScrollView'].map(n=>[n,n]));native.StyleSheet={create:s=>s};
 const deps={react:React,'react-native':native,'react-native-webview':{WebView:'WebView'},'../theme/colors':{COLORS},'../map/mapHtml.js':{MAP_HTML},'../map/mapSync.js':{criarSincronizacaoMapa}};
 const module={exports:{}};new Function('require','module','exports',code)(n=>{assert.ok(n in deps,n);return deps[n];},module,module.exports);
 function nodes(n,out=[]){if(Array.isArray(n)){for(const child of n)nodes(child,out);}else if(n&&typeof n==='object'){out.push(n);nodes(n.props?.children,out);}return out;}
 function text(n){if(Array.isArray(n))return n.map(text).join(' ');if(n==null||typeof n==='boolean')return '';return typeof n==='object'?text(n.props?.children):String(n);}
 function render(update={}){props={...props,...update};index=0;const tree=module.exports.RoadNetworkMap(props,ref);const web=nodes(tree).find(n=>n.type==='WebView');web.props.ref.current={injectJavaScript:s=>{const start=s.indexOf('window.__handleRNMessage(')+'window.__handleRNMessage('.length;sent.push(JSON.parse(s.slice(start,s.lastIndexOf('); true;'))));}};while(effects.length)effects.shift()();return {tree,web};}
 function ready(){let r=render();r.web.props.onMessage({nativeEvent:{data:JSON.stringify({type:'MAP_READY'})}});return render();}
 return {render,ready,nodes,text,sent,ref};
}
test('componente preserva WebView, fonte HTML e legenda ao alternar visibilidade',()=>{
 const c=setup(),first=c.ready();c.nodes(first.tree).find(n=>n.type==='TouchableOpacity'&&c.text(n).includes('Legenda')).props.onPress();const hiddenLegend=c.render();assert.doesNotMatch(c.text(hiddenLegend.tree),/Eixo viário oficial/);
 c.sent.length=0;const hidden=c.render({visible:false});const restored=c.render({visible:true});assert.strictEqual(first.web.props.ref,hidden.web.props.ref);assert.strictEqual(first.web.props.source,restored.web.props.source);assert.doesNotMatch(c.text(restored.tree),/Eixo viário oficial/);assert.deepEqual(c.sent,[{type:'RESIZE_MAP'}]);
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
