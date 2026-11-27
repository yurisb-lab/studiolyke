// Painéis responsivos.
//   Computador (>= 1100 px): ferramentas à esquerda, propriedades à direita, sempre visíveis.
//   Tablet (700 a 1099 px): os painéis viram gavetas laterais.
//   Celular (< 700 px): peça em tela cheia, barra embaixo e folha deslizante.
// O CSS decide a aparência; aqui só abrimos e fechamos.

const consultaGaveta = window.matchMedia('(max-width: 1099px)');

export function modoGaveta() {
  return consultaGaveta.matches;
}

export function iniciarPaineis() {
  const fundo = document.getElementById('fundo-gaveta');
  const paineis = [...document.querySelectorAll('.painel')];

  const fechar = () => {
    for (const p of paineis) p.classList.remove('aberto');
    fundo.classList.remove('visivel');
    document.querySelectorAll('[data-abre]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  };

  const abrir = (id) => {
    const p = document.getElementById(id);
    if (!p || !modoGaveta()) return;
    const jaAberto = p.classList.contains('aberto');
    fechar();
    if (jaAberto) return;
    p.classList.add('aberto');
    fundo.classList.add('visivel');
    document.querySelectorAll(`[data-abre="${id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'true'));
  };

  document.querySelectorAll('[data-abre]').forEach((b) => {
    b.addEventListener('click', () => abrir(b.dataset.abre));
  });
  fundo.addEventListener('click', fechar);
  consultaGaveta.addEventListener('change', fechar);

  // Arrastar a alça da folha para baixo fecha (celular).
  for (const p of paineis) {
    const alca = p.querySelector('.alca');
    if (!alca) continue;
    let y0 = null;
    alca.addEventListener('pointerdown', (e) => {
      y0 = e.clientY;
      alca.setPointerCapture(e.pointerId);
      p.style.transition = 'none';
    });
    alca.addEventListener('pointermove', (e) => {
      if (y0 === null) return;
      const dy = Math.max(0, e.clientY - y0);
      p.style.transform = `translateY(${dy}px)`;
    });
    const fim = (e) => {
      if (y0 === null) return;
      const dy = e.clientY - y0;
      y0 = null;
      p.style.transition = '';
      p.style.transform = '';
      if (dy > 70 || (e.type === 'pointerup' && Math.abs(dy) < 6)) fechar();
    };
    alca.addEventListener('pointerup', fim);
    alca.addEventListener('pointercancel', fim);
  }

  return { abrir, fechar };
}

/** Menu de contexto (segurar o dedo, ou clique longo do mouse). */
export function criarMenuContexto(itens) {
  const menu = document.getElementById('menu-contexto');
  const fechar = () => {
    menu.hidden = true;
  };
  const abrir = (x, y) => {
    menu.innerHTML = '';
    for (const item of itens()) {
      if (item === '-') {
        menu.appendChild(Object.assign(document.createElement('hr'), {}));
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.textContent = item.texto;
      b.addEventListener('click', () => {
        fechar();
        item.acao();
      });
      menu.appendChild(b);
    }
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    const margem = 8;
    const px = Math.min(Math.max(margem, x), window.innerWidth - r.width - margem);
    const py = Math.min(Math.max(margem, y), window.innerHeight - r.height - margem);
    menu.style.left = `${px}px`;
    menu.style.top = `${py}px`;
    const primeiro = menu.querySelector('button');
    if (primeiro) primeiro.focus({ preventScroll: true });
  };
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) fechar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fechar();
  });
  return { abrir, fechar, aberto: () => !menu.hidden };
}

/** Mensagem rápida no rodapé. tipo: 'info' | 'aviso' | 'erro' */
export function avisar(texto, tipo = 'info', duracao = 4500) {
  const caixa = document.getElementById('avisos');
  // No máximo 3 avisos na tela; os mais antigos saem.
  const atuais = caixa.querySelectorAll('.aviso-rapido');
  for (let k = 0; k <= atuais.length - 3; k++) atuais[k].remove();
  const el = document.createElement('div');
  el.className = `aviso-rapido ${tipo}`;
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  el.textContent = texto;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'fechar-aviso';
  x.setAttribute('aria-label', 'Fechar aviso');
  x.textContent = '×';
  x.addEventListener('click', () => el.remove());
  el.appendChild(x);
  caixa.appendChild(el);
  if (duracao) setTimeout(() => el.remove(), duracao);
  return el;
}
