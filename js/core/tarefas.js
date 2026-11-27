// Conversa com os Web Workers. Cada tarefa abre um worker e o encerra no fim,
// devolvendo a memória de trabalho. Os dados grandes vão e voltam transferidos.

let proximoId = 1;

/**
 * @param {string} tipo  'abrir' | 'tela'
 * @param {object} dados
 * @param {Transferable[]} transferir
 * @param {(fase:string, fracao:number)=>void} [aoProgresso]
 */
export function executar(tipo, dados, transferir = [], aoProgresso) {
  const id = proximoId++;
  const worker = new Worker(new URL('../workers/carregar.js', import.meta.url), { type: 'module' });
  return new Promise((resolver, rejeitar) => {
    const terminar = () => worker.terminate();
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.tipo === 'progresso') {
        if (aoProgresso) aoProgresso(m.fase, m.fracao);
      } else if (m.tipo === 'pronto') {
        terminar();
        resolver(m);
      } else if (m.tipo === 'erro') {
        terminar();
        rejeitar(new Error(m.mensagem));
      }
    };
    worker.onerror = (e) => {
      terminar();
      rejeitar(new Error(e.message || 'Falha no processamento (worker).'));
    };
    worker.postMessage({ id, tipo, dados }, transferir);
  });
}
