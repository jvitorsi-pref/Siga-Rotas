import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { COLORS } from '../src/theme/colors.js';
import * as layout from '../src/components/bottomSheetLayout.js';

const require = createRequire(new URL('../package.json', import.meta.url));
const code = require('@babel/core').transformSync(
  readFileSync(new URL('../src/components/BottomSheetPanel.js', import.meta.url), 'utf8'),
  {
    babelrc: false,
    configFile: false,
    plugins: [
      require.resolve('@babel/plugin-transform-react-jsx'),
      require.resolve('@babel/plugin-transform-modules-commonjs'),
    ],
  },
).code;

function renderBottomSheet(props) {
  const slots = [];
  let idx = 0;
  class AnimVal {
    constructor(v) { this.val = v; }
    setValue(v) { this.val = v; }
    stopAnimation(cb) { cb?.(this.val); }
  }
  const Animated = {
    Value: AnimVal,
    View: 'Animated.View',
    spring: (anim, cfg) => ({ start: () => anim.setValue(cfg.toValue) }),
  };
  const React = {
    createElement: (type, p, ...children) => ({ type, props: { ...p, children } }),
    useRef: (init) => { const i = idx++; return slots[i] ?? (slots[i] = { current: init }); },
    useMemo: (fn) => fn(),
    useEffect: () => {},
  };
  const native = {
    Animated,
    PanResponder: { create: (cfg) => ({ panHandlers: { onMoveShouldSetPanResponder: cfg.onMoveShouldSetPanResponder } }) },
    ScrollView: 'ScrollView',
    StyleSheet: { create: (s) => s },
    Text: 'Text',
    TouchableOpacity: 'TouchableOpacity',
    View: 'View',
  };
  const mod = { exports: {} };
  const deps = { react: React, 'react-native': native, '../theme/colors': { COLORS }, './bottomSheetLayout.js': layout };
  new Function('require', 'module', 'exports', code)((n) => deps[n], mod, mod.exports);
  const tree = mod.exports.BottomSheetPanel(props);
  function nodes(n, out = []) {
    if (Array.isArray(n)) n.forEach((c) => nodes(c, out));
    else if (n && typeof n === 'object') { out.push(n); nodes(n.props?.children, out); }
    return out;
  }
  function text(n) {
    if (Array.isArray(n)) return n.map(text).join(' ');
    if (n == null || typeof n === 'boolean') return '';
    return typeof n === 'object' ? text(n.props?.children) : String(n);
  }
  return { tree, nodes: nodes(tree), text: text(tree) };
}

test('calcularAlturasSheet garante ordem estrita collapsed < mid < expanded', () => {
  for (const h of [520, 720, 920]) {
    const a = layout.calcularAlturasSheet(h);
    assert.ok(a.collapsed >= 70 && a.collapsed < a.mid);
    assert.ok(a.mid < a.expanded && a.expanded < h);
  }
});

test('resolverProximoEstadoSheet respeita direção de arraste, flick e encaixe mais próximo', () => {
  const alturas = layout.calcularAlturasSheet(720);
  assert.equal(
    layout.resolverProximoEstadoSheet({ estadoAtual: 'collapsed', dy: -90, vy: -0.6, alturas }),
    'mid',
  );
  assert.equal(
    layout.resolverProximoEstadoSheet({ estadoAtual: 'mid', dy: -120, vy: -0.7, alturas }),
    'expanded',
  );
  assert.equal(
    layout.resolverProximoEstadoSheet({ estadoAtual: 'expanded', dy: 120, vy: 0.7, alturas }),
    'mid',
  );
  assert.equal(
    layout.resolverProximoEstadoSheet({ estadoAtual: 'expanded', dy: 500, vy: 1.4, alturas }),
    'collapsed',
  );
  assert.equal(
    layout.resolverProximoEstadoSheet({ estadoAtual: 'mid', alturaAtual: alturas.mid + 12, dy: -12, vy: 0, alturas }),
    'mid',
  );
  assert.ok(layout.calcularInsetMapaParaSheet('collapsed', alturas) === alturas.collapsed);
  assert.ok(layout.calcularInsetMapaParaSheet('mid', alturas) === alturas.mid);
});

test('BottomSheetPanel renderiza resumo, botões rápidos e alterna conteúdo conforme estado', () => {
  const mudancas = [];
  const collapsed = renderBottomSheet({
    sheetState: 'collapsed',
    onChangeSheetState: (s) => mudancas.push(s),
    summaryTitle: 'Rota · 1,20 km',
    summaryBadge: '3 ponto(s)',
    children: { type: 'ConteudoFilho', props: { children: 'CONTEUDO_PAINEL' } },
  });
  assert.match(collapsed.text, /Rota · 1,20 km/);
  assert.match(collapsed.text, /3 ponto\(s\)/);
  assert.doesNotMatch(collapsed.text, /CONTEUDO_PAINEL/);

  const mid = renderBottomSheet({
    sheetState: 'mid',
    onChangeSheetState: (s) => mudancas.push(s),
    summaryTitle: 'Planejamento · 4 visita(s)',
    children: { type: 'ConteudoFilho', props: { children: 'CONTEUDO_PAINEL' } },
  });
  assert.match(mid.text, /CONTEUDO_PAINEL/);
  const btnMapa = mid.nodes.find((n) => n.type === 'TouchableOpacity' && n.props?.accessibilityLabel?.includes('Minimizar'));
  assert.ok(btnMapa);
  btnMapa.props.onPress();
  assert.deepEqual(mudancas, ['collapsed']);
});
