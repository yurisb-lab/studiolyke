// Lista das operações que mudam o modelo (uma por arquivo nesta pasta).
// Cada operação tem:
//   tipo, editavel, rotulo(receita)
//   aplicar(malha, receita, { guardarVolta }) -> { volta, voltaBytes, tela, ... }
//   desfazer(malha, receita, volta)            (quando há volta guardada)
//   naTela(tela, receita)                      (opcional: atualiza a tela sem refazer)
//   pesada                                     (opcional: grava ponto de restauração)
// O histórico guarda só a receita { tipo, params }; refazer = aplicar as receitas de novo.

import { filamento } from './filamento.js';
import { pinturaTrocar } from './pintura-trocar.js';

export const OPERACOES = {
  [filamento.tipo]: filamento,
  [pinturaTrocar.tipo]: pinturaTrocar,
};

export function operacao(tipo) {
  const op = OPERACOES[tipo];
  if (!op) throw new Error(`Operação desconhecida: ${tipo}`);
  return op;
}

/**
 * Aplica receitas em ordem (ao reabrir um projeto ou refazer o histórico).
 * Uma receita que falha é pulada. Devolve { falhas: [{ indice, mensagem }], voltas }.
 * Com guardarVolta, voltas[i] = { volta, voltaBytes } de cada receita (para o desfazer rápido).
 * @param {{tipo:string, params:object}[]} receitas
 */
export function aplicarReceitas(malha, receitas, { guardarVolta = false, aoProgresso = null } = {}) {
  const falhas = [];
  const voltas = [];
  receitas.forEach((r, i) => {
    if (aoProgresso) aoProgresso(i / Math.max(1, receitas.length));
    try {
      const res = operacao(r.tipo).aplicar(malha, r.params, { guardarVolta });
      voltas.push(guardarVolta && res.volta ? { volta: res.volta, voltaBytes: res.voltaBytes || 0 } : null);
    } catch (erro) {
      voltas.push(null);
      falhas.push({ indice: i, mensagem: erro && erro.message ? erro.message : String(erro) });
    }
  });
  return { falhas, voltas };
}

/** Buffers das voltas (para devolver do worker sem copiar). */
export function transferiveisDasVoltas(voltas) {
  const lista = [];
  for (const v of voltas) {
    if (!v || !v.volta) continue;
    for (const a of Object.values(v.volta)) if (a && a.buffer && a.buffer.byteLength && !lista.includes(a.buffer)) lista.push(a.buffer);
  }
  return lista;
}
