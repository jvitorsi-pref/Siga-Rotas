import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { COLORS } from '../theme/colors.js';
import { formatDistanceParts } from '../utils/formatters.js';
const metros = n => { const d = formatDistanceParts(n); return `${d.v} ${d.u}`; };
function Botao({ children, onPress, disabled }) {
  return <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.botao, disabled && { opacity: 0.5 }]}><Text style={styles.botaoTexto}>{children}</Text></TouchableOpacity>;
}
export function NavigationPanel({ estado, controller, podeIniciar, onCenter, onStart }) {
  const [manual, setManual] = useState('');
  const [erro, setErro] = useState('');
  const [modo, setModo] = useState('gps');
  const [solicitando, setSolicitando] = useState(false);
  if (!estado) return (
    <View style={styles.block}>
      <Text style={styles.titulo}>Navegação</Text>
      <Text style={styles.texto}>GPS real usa a localização do aparelho somente enquanto o aplicativo está aberto. Simulação usa posições fictícias sobre a rota.</Text>
      <View style={styles.row}>
        <Botao disabled={solicitando} onPress={() => setModo('gps')}>{modo === 'gps' ? '● ' : '○ '}GPS real</Botao>
        <Botao disabled={solicitando} onPress={() => setModo('simulacao')}>{modo === 'simulacao' ? '● ' : '○ '}Simulação</Botao>
      </View>
      <Botao disabled={!podeIniciar || solicitando} onPress={async () => {
        setErro(''); setSolicitando(true);
        try { const r = await onStart(modo); if (!r?.ok && !r?.cancelado) setErro(r?.message || 'Não foi possível iniciar.'); }
        catch (e) { setErro(e.message); }
        finally { setSolicitando(false); }
      }}>{solicitando ? 'Iniciando…' : modo === 'gps' ? 'Iniciar GPS real' : 'Iniciar simulação'}</Botao>
      {!!erro && <Text style={styles.erro}>{erro}</Text>}
    </View>
  );
  const ativa = estado.execucao === 'ativo', pausada = estado.execucao === 'pausado', simulado = estado.modo === 'simulacao';
  return (
    <View style={styles.block}>
      <Text style={styles.titulo}>Navegação · {simulado ? 'MODO DE TESTE' : 'GPS real'}</Text>
      <View style={styles.aviso}><Text style={styles.verde}>{simulado ? 'POSIÇÃO SIMULADA — não é GPS real' : 'GPS REAL — pausa ao sair do aplicativo'}</Text></View>
      <Text style={styles.texto}>{estado.instrucao?.principal}</Text>
      <Text style={styles.texto}>{estado.instrucao?.secundario}</Text>
      <Text style={styles.texto}>{estado.execucao} · {Math.round(estado.progresso * 100)}% · faltam {metros(estado.distanciaRestante)}</Text>
      <View style={styles.barra}><View style={[styles.progresso, { width: `${Math.round(estado.progresso * 100)}%` }]} /></View>
      <Text style={styles.texto}>Percorrido: {metros(estado.percorrido)} · precisão: {estado.precisao == null ? '—' : `${estado.precisao} m`}</Text>
      <Text style={styles.texto}>Concluídas: {estado.paradasConcluidas.join(' → ') || 'nenhuma'}</Text>
      <Text style={styles.texto}>{estado.iniciando ? 'Aguardando permissão e ativação do GPS…' : estado.recalculando ? 'Recalculando…' : estado.aviso}</Text>
      <View style={styles.row}>
        <Botao disabled={!ativa && !pausada} onPress={() => ativa ? controller.pausar() : controller.retomar()}>{pausada ? 'Retomar' : 'Pausar'}</Botao>
        <Botao onPress={() => controller.reiniciar()}>Reiniciar</Botao>
        <Botao onPress={() => controller.encerrar()}>Encerrar</Botao>
        <Botao disabled={!estado.posicao} onPress={onCenter}>Centralizar</Botao>
      </View>
      {simulado && <>
      <View style={styles.row}>
        <Botao disabled={!ativa} onPress={() => controller.avancar(-100)}>◀ 100 m</Botao>
        <Botao disabled={!ativa} onPress={() => controller.avancar(100)}>100 m ▶</Botao>
      </View>
      <Text style={styles.titulo}>Velocidade da simulação</Text>
      <View style={styles.row}>{[1, 2, 5, 10, 25, 50].map(v => <Botao key={v} onPress={() => controller.definirVelocidade(v)}>{estado.velocidadeSim === v ? '● ' : ''}{v}x</Botao>)}</View>
      <Text style={styles.titulo}>Posição inicial por trecho</Text>
      <View style={styles.row}>{estado.inicios.map((p, i) => <Botao disabled={!ativa} key={i} onPress={() => controller.iniciarEm(p.metros)}>{p.titulo}</Botao>)}</View>
      <Text style={styles.titulo}>Cenários de teste</Text>
      <View style={styles.row}>
        <Botao disabled={!ativa} onPress={() => controller.aplicarDesvio()}>Desvio</Botao>
        <Botao disabled={!ativa} onPress={() => controller.limparDesvio()}>Voltar à rota</Botao>
        <Botao disabled={!ativa} onPress={() => estado.sinal ? controller.perderSinal() : controller.recuperarSinal()}>{estado.sinal ? 'Perder sinal' : 'Recuperar sinal'}</Botao>
      </View>
      <TextInput style={styles.input} accessibilityLabel="Posição simulada manual, latitude e longitude" placeholder="Latitude; longitude" placeholderTextColor={COLORS.muted} value={manual} onChangeText={setManual} />
      <Botao disabled={!ativa} onPress={() => {
        const partes = manual.split(';').map(n => Number(n.trim().replace(',', '.')));
        const ok = partes.length === 2 && manual.split(';').every(n => n.trim()) && controller.posicaoManual(partes[0], partes[1]).ok;
        setErro(ok ? '' : 'Informe latitude; longitude válidas.');
      }}>Aplicar posição simulada</Botao>
      </>}
      {!!erro && <Text style={styles.erro}>{erro}</Text>}
    </View>
  );
}
const styles = StyleSheet.create({
  block: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 7 },
  titulo: { color: COLORS.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 6 },
  texto: { color: COLORS.textSecondary, fontSize: 12 },
  verde: { color: COLORS.accent, fontSize: 12, fontWeight: '700' },
  aviso: { backgroundColor: COLORS.panel2, borderWidth: 1, borderColor: COLORS.accent, borderRadius: 7, padding: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  botao: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 10, marginTop: 6 },
  botaoTexto: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 7, color: COLORS.text, paddingHorizontal: 9, paddingVertical: 6, fontSize: 12.5 },
  barra: { height: 6, borderRadius: 3, backgroundColor: COLORS.panel2, overflow: 'hidden' },
  progresso: { height: 6, backgroundColor: COLORS.accent },
  erro: { color: COLORS.err, fontSize: 12 },
});
