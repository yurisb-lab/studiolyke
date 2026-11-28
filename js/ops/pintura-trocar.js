// Operação: trocar uma cor da pintura do Bambu por outra (ou apagar a pintura).
// Receita: { de, para, parteIndice, nome }
//   de = 1…18 ou 'todas' (apaga toda a pintura do trecho); para = 0 tira a pintura dessa cor;
//   parteIndice = índice em todasAsPartes(), ou null = o modelo todo; nome só para o rótulo.
// Juntar duas cores não tem volta pela receita; por isso o desfazer rápido usa os
// códigos antigos SÓ dos triângulos que mudaram (com limite de memória no histórico).
// Sem eles, o histórico reabre o original e refaz as receitas.

import { trocarCorDaPintura, restaurarPintura, bytesDaVolta, trocarCorNaTela } from '../core/pintura.js';

export const pinturaTrocar = {
  tipo: 'pintura-trocar',
  editavel: true,

  rotulo(p) {
    const onde = p.parteIndice == null ? 'no modelo todo' : `em ${p.nome || 'uma parte'}`;
    if (p.de === 'todas') return `Pintura apagada ${onde}`;
    return `Cor ${p.de} da pintura → ${p.para === 0 ? 'sem pintura' : p.para} ${onde}`;
  },

  aplicar(malha, p, { guardarVolta = false } = {}) {
    const coletor = guardarVolta ? {} : null;
    const mudaram = trocarCorDaPintura(malha, { de: p.de, para: p.para, parteIndice: p.parteIndice ?? null }, coletor);
    const volta = coletor && coletor.volta;
    return { volta: volta || null, voltaBytes: bytesDaVolta(volta), mudaram, tela: 'pintura' };
  },

  desfazer(malha, p, volta) {
    restaurarPintura(malha, volta);
    return { tela: 'pintura' };
  },

  /** A tela já montada acompanha a troca sem ser refeita. */
  naTela(tela, p) {
    trocarCorNaTela(tela, { de: p.de, para: p.para, parteIndice: p.parteIndice ?? null });
  },
};
