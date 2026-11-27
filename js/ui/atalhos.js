// Atalhos de teclado (computador). Os da seleção (W, L, B, G...) entram na etapa 1.5.

export function ligarAtalhos(acoes) {
  document.addEventListener('keydown', (e) => {
    const alvo = e.target;
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      acoes.abrir();
      return;
    }
    if (ctrl || e.altKey) return;
    const mapa = {
      f: () => acoes.enquadrar(),
      1: () => acoes.vista('frente'),
      3: () => acoes.vista('lado'),
      7: () => acoes.vista('cima'),
      0: () => acoes.vista('iso'),
    };
    const fazer = mapa[e.key.toLowerCase()];
    if (fazer) {
      e.preventDefault();
      fazer();
    }
  });
}
