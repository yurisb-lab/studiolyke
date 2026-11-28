// Atalhos de teclado (computador).
//   Ctrl+O abrir · Ctrl+E exportar 3MF · Ctrl+S salvar projeto
//   Ctrl+Z desfazer · Ctrl+Y ou Ctrl+Shift+Z refazer
//   F enquadrar · 0/1/3/7 vistas · P mostrar/esconder a pintura

export function ligarAtalhos(acoes) {
  document.addEventListener('keydown', (e) => {
    const alvo = e.target;
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      acoes.abrir();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      acoes.exportar();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (acoes.salvar) acoes.salvar();
      return;
    }
    if (ctrl && !e.altKey && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault();
      if (acoes.refazer) acoes.refazer();
      return;
    }
    if (ctrl && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (acoes.desfazer) acoes.desfazer();
      return;
    }
    if (ctrl || e.altKey) return;
    const mapa = {
      f: () => acoes.enquadrar(),
      p: () => acoes.pintura && acoes.pintura(),
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
