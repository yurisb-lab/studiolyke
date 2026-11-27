// Gestos na área 3D (Pointer Events: mouse, dedo e caneta).
// Girar, zoom e arrastar ficam com os controles do three.js:
//   um dedo gira, pinça dá zoom, dois dedos arrastam.
// Aqui ficam os gestos do app:
//   toque rápido -> aoToque  (vai ser a varinha na etapa 1.5)
//   segurar      -> aoSegurar (abre o menu)

const TEMPO_TOQUE = 300; // ms
const TEMPO_SEGURAR = 550; // ms
const FOLGA_MOVIMENTO = 10; // px

export function ligarGestos(elemento, { aoToque, aoSegurar } = {}) {
  const ativos = new Map();
  let inicio = null;
  let timer = 0;

  const cancelarSegurar = () => {
    clearTimeout(timer);
    timer = 0;
  };

  elemento.addEventListener('pointerdown', (e) => {
    ativos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ativos.size > 1 || e.button !== 0) {
      inicio = null;
      cancelarSegurar();
      return;
    }
    inicio = { x: e.clientX, y: e.clientY, t: performance.now(), tipo: e.pointerType, segurou: false };
    cancelarSegurar();
    timer = setTimeout(() => {
      if (!inicio) return;
      inicio.segurou = true;
      if (aoSegurar) aoSegurar({ x: inicio.x, y: inicio.y, tipo: inicio.tipo });
    }, TEMPO_SEGURAR);
  });

  elemento.addEventListener('pointermove', (e) => {
    if (!ativos.has(e.pointerId)) return;
    if (inicio && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > FOLGA_MOVIMENTO) {
      inicio = null;
      cancelarSegurar();
    }
  });

  const soltar = (e) => {
    const eraUnico = ativos.size === 1;
    ativos.delete(e.pointerId);
    cancelarSegurar();
    if (e.type === 'pointerup' && eraUnico && inicio && !inicio.segurou) {
      if (performance.now() - inicio.t <= TEMPO_TOQUE && aoToque) {
        aoToque({ x: e.clientX, y: e.clientY, tipo: e.pointerType });
      }
    }
    if (ativos.size === 0) inicio = null;
  };
  elemento.addEventListener('pointerup', soltar);
  elemento.addEventListener('pointercancel', soltar);

  // O menu do navegador (botão direito / segurar) não aparece em cima da peça.
  elemento.addEventListener('contextmenu', (e) => e.preventDefault());
}
