// Fonte literal para a WebView. Não usar Function.toString(): Hermes pode
// devolver apenas a indicação de bytecode em builds de produção.
export const ESTILO_TRECHO_JS = `function estiloTrecho(trecho) {
  const atual = trecho.situacao === 'atual';
  const percorrido = trecho.situacao === 'percorrido';
  const cor = trecho.cor || '#ffc233';
  let nucleoCor = cor;
  if (percorrido && /^#[0-9a-f]{6}$/i.test(cor)) {
    const n = parseInt(cor.slice(1), 16);
    nucleoCor = 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',0.32)';
  }
  return {
    visivel: trecho.visivel !== false,
    cor,
    haloCor: percorrido ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.95)',
    contornoCor: atual ? 'rgba(23,32,48,0.95)' : 'rgba(23,32,48,0.85)',
    nucleoCor,
    halo: atual ? 12 : 9,
    contorno: atual ? 7.6 : 6.4,
    nucleo: atual ? 4.8 : 3.6,
    dash: trecho.retorno ? [12, 7] : [],
  };
}`;
