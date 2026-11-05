/** Cancela logicamente respostas antigas sem alterar o serviço de endereços. */
export function criarRevisoesEndereco() {
  const atuais = new Map();
  return {
    iniciar(id) { const token = { id }; atuais.set(id, token); return token; },
    atual(token) { return atuais.get(token.id) === token; },
    invalidar(id) { atuais.delete(id); },
    limpar() { atuais.clear(); },
  };
}
