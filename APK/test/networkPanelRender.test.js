/** JSX real, com primitivas RN/hooks substituídos; não é rasterização Android. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { COLORS } from '../src/theme/colors.js';
import { apresentarRede } from '../src/utils/networkPresentation.js';
const require=createRequire(new URL('../package.json',import.meta.url));
const source=readFileSync(new URL('../src/components/NetworkDiagnosticsPanel.js',import.meta.url),'utf8');
const code=require('@babel/core').transformSync(source,{babelrc:false,configFile:false,plugins:[require.resolve('@babel/plugin-transform-react-jsx'),require.resolve('@babel/plugin-transform-modules-commonjs')]}).code;
function setup(props){
 let open=false;
 const React={Fragment:'Fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:()=>[open,fn=>{open=typeof fn==='function'?fn(open):fn;}]};
 const module={exports:{}};
 const deps={react:React,'react-native':{StyleSheet:{create:s=>s},View:'View',Text:'Text',TouchableOpacity:'TouchableOpacity',ActivityIndicator:'ActivityIndicator'},'../theme/colors.js':{COLORS},'../utils/networkPresentation.js':{apresentarRede}};
 new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);
 const render=()=>module.exports.NetworkDiagnosticsPanel(props);
 function nodes(node,out=[]){if(Array.isArray(node)){for(const c of node)nodes(c,out);}else if(node&&typeof node==='object'){out.push(node);nodes(typeof node.type==='function'?node.type(node.props):node.props?.children,out);}return out;}
 function text(node){if(Array.isArray(node))return node.map(text).join(' ');if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return text(typeof node.type==='function'?node.type(node.props):node.props?.children);}
 return {render,nodes,text};
}
const meta={source:'snapshot',features:4545,builtAt:'2026-11-04T12:00:00Z',cache:{status:'unknown'},update:{enabled:false}};
test('painel renderiza carregamento antes de haver metadados',()=>{
 const c=setup({meta:null,syncing:true});assert.ok(c.nodes(c.render()).some(n=>n.type==='ActivityIndicator'));assert.match(c.text(c.render()),/Construindo grafo/);
});
test('falha inicial deixa alerta e botão de nova tentativa, sem spinner infinito',()=>{
 let count=0;const retry=()=>count++,c=setup({meta:null,feedback:{kind:'err',text:'Sem rede local'},onRetry:retry});const ns=c.nodes(c.render());assert.equal(ns.some(n=>n.type==='ActivityIndicator'),false);assert.match(c.text(c.render()),/Sem rede local/);ns.find(n=>n.type==='TouchableOpacity'&&n.props.onPress===retry).props.onPress();assert.equal(count,1);
});
test('cache e erro de quota são apresentados sem declarar conexão ativa ou sincronização de coleta',()=>{
 const c=setup({meta:{...meta,source:'wfs-cache',cache:{status:'memory-only',error:'Não salvo: quota'},remoteApi:{configured:true,supported:false}},feedback:{kind:'err',text:'Servidor indisponível'}}),text=c.text(c.render());assert.match(text,/Cache local do WFS/);assert.match(text,/apenas em memória/);assert.match(text,/quota/);assert.match(text,/Local no aparelho/);assert.match(text,/Servidor indisponível/);assert.match(text,/Delegação remota não implementada/);assert.doesNotMatch(text,/WFS ao vivo/);
});
test('botões de rede ficam desativados durante operação e mantêm seus callbacks',()=>{
 const check=()=>{},refresh=()=>{},c=setup({meta,syncing:true,operacao:'verificar',onCheckUpdates:check,onRefreshWfs:refresh});const ns=c.nodes(c.render());for(const fn of [check,refresh]){const button=ns.find(n=>n.type==='TouchableOpacity'&&n.props.onPress===fn);assert.equal(button.props.disabled,true);assert.equal(button.props.accessibilityState.busy,true);}assert.match(c.text(c.render()),/Verificando WFS/);assert.match(c.text(c.render()),/Desativada/);
});
test('diagnóstico pode expandir e mostra os contadores do grafo fornecido',()=>{
 const c=setup({meta,diagnostics:{nodes:123,edges:456,crossings:7,buildMs:89}});assert.doesNotMatch(c.text(c.render()),/Nós/);c.nodes(c.render()).find(n=>n.type==='TouchableOpacity'&&c.text(n).includes('Diagnóstico do grafo')).props.onPress();const text=c.text(c.render());assert.match(text,/Nós/);assert.match(text,/123/);assert.match(text,/456/);assert.match(text,/Cruzamentos/);assert.match(text,/89 ms/);
});
test('App monta o painel no ScrollView e conecta os três comandos e descarte',()=>{
 const app=readFileSync(new URL('../App.js',import.meta.url),'utf8');assert.match(app,/<NetworkDiagnosticsPanel[\s\S]*?<\/ScrollView>/);for(const name of ['carregar','verificar','baixar'])assert.ok(app.includes(`networkPanelRef.current?.executar('${name}')`));assert.match(app,/painel\.descartar\(\)/);
});
