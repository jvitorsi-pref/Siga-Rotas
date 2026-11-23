import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { COLORS } from '../src/theme/colors.js';
import { resumoRota } from '../src/utils/resumoRota.js';
import { formatDistanceParts, formatStreetLength } from '../src/utils/formatters.js';
const require=createRequire(new URL('../package.json',import.meta.url));
const code=require('@babel/core').transformSync(readFileSync(new URL('../src/components/RouteResultPanel.js',import.meta.url),'utf8'),{babelrc:false,configFile:false,plugins:[require.resolve('@babel/plugin-transform-react-jsx'),require.resolve('@babel/plugin-transform-modules-commonjs')]}).code;
function render(props){
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:v=>[v,()=>{}]};
 const deps={react:React,'react-native':{View:'View',Text:'Text',TouchableOpacity:'TouchableOpacity',StyleSheet:{create:s=>s}},'../theme/colors':{COLORS},'../utils/resumoRota.js':{resumoRota},'../utils/formatters.js':{formatDistanceParts,formatStreetLength}};
 const module={exports:{}};new Function('require','module','exports',code)(n=>{assert.ok(n in deps,n);return deps[n];},module,module.exports);
 function text(n){if(Array.isArray(n))return n.map(text).join(' ');if(n==null||typeof n==='boolean')return '';if(typeof n!=='object')return String(n);return text(typeof n.type==='function'?n.type(n.props):n.props.children);}
 return text(module.exports.RouteResultPanel(props));
}
test('APK: JSX real apresenta método/economia e preserva distância, sequência e trechos',()=>{
 const routeResult={modo:'otimizada',distance:100,sequenciaCompleta:['A','B','A'],legs:[{de:'A',para:'B',distance:50},{de:'B',para:'A',retorno:true,distance:50}],otimizacao:{metodo:'exato'},comparacao:{economia:25,economiaPercentual:20}};
 const before=structuredClone(routeResult),text=render({routeResult});assert.ok(text.includes(resumoRota(routeResult)));assert.match(text,/Held-Karp/);assert.match(text,/economia 25 m/);assert.match(text,/Retorno à origem/);assert.deepEqual(routeResult,before);
});
test('APK: JSX real não promete ótimo global nem inventa economia quando ela está ausente',()=>{
 const text=render({routeResult:{modo:'otimizada',distance:10,otimizacao:{metodo:'heuristico'}}});assert.match(text,/sem garantia de ótimo global/);assert.match(text,/comparação.*indisponível/);assert.doesNotMatch(text,/economia 0/);
});
test('APK: erro de rota não recebe resumo de otimização bem-sucedida',()=>{
 const text=render({routeResult:{modo:'otimizada',distance:10},routeError:{title:'Sem caminho',message:'Trecho indisponível'}});assert.match(text,/Trecho indisponível/);assert.doesNotMatch(text,/Ordem otimizada/);
});
test('APK: botão Exportar GPX aparece para rota completa, dispara callback e exibe feedback',()=>{
 let cliques=0;
 const routeResult={ok:true,parcial:false,modo:'usuario',distance:100,sequenciaCompleta:['A','B','A'],legs:[{de:'A',para:'B',distance:50},{de:'B',para:'A',retorno:true,distance:50}]};
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:v=>[v,()=>{}]};
 const deps={react:React,'react-native':{View:'View',Text:'Text',TouchableOpacity:'TouchableOpacity',StyleSheet:{create:s=>s}},'../theme/colors':{COLORS},'../utils/resumoRota.js':{resumoRota},'../utils/formatters.js':{formatDistanceParts,formatStreetLength}};
 const module={exports:{}};new Function('require','module','exports',code)(n=>deps[n],module,module.exports);
 const tree=module.exports.RouteResultPanel({routeResult,onExportGpx:()=>cliques++,gpxFeedback:{kind:'ok',text:'GPX salvo em Download'}});
 const nodes=(n,out=[])=>{if(Array.isArray(n)){for(const c of n)nodes(c,out);}else if(n&&typeof n==='object'){out.push(n);nodes(typeof n.type==='function'?n.type(n.props):n.props?.children,out);}return out;};
 const btn=nodes(tree).find(n=>n.type==='TouchableOpacity'&&JSON.stringify(n.props.children).includes('Exportar GPX'));
 assert.ok(btn);btn.props.onPress();assert.equal(cliques,1);
 assert.match(render({routeResult,onExportGpx:()=>{},gpxFeedback:{kind:'ok',text:'GPX salvo em Download'}}),/GPX salvo em Download/);
 assert.doesNotMatch(render({routeResult:{...routeResult,parcial:true},onExportGpx:()=>{}}),/Exportar GPX/);
});
test('APK: Cenário C (somente GPS real sem rota calculada) renderiza card GPS com Exportar GPX',()=>{
 const text=render({routeResult:null,routeError:null,gpsRouteInfo:{distanciaMetros:432},onExportGpx:()=>{}});
 assert.match(text,/Resultado \(GPS Real\)/);
 assert.match(text,/432/);
 assert.match(text,/Trajeto GPS real registrado/);
 assert.match(text,/Exportar GPX/);
 assert.equal(render({routeResult:null,routeError:null,gpsRouteInfo:null}),'');
});
