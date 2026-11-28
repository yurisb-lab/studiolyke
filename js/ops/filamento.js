// Operação: trocar o filamento de uma parte.
// Receita: { objeto, parte, filamento, de, nome }  (de e nome só servem para o rótulo)
// Tem volta exata (o filamento antigo), então o desfazer é na hora.

import { trocarFilamento } from '../core/projeto.js';

export const filamento = {
  tipo: 'filamento',
  editavel: true,

  rotulo(p) {
    return `Filamento de ${p.nome || 'parte'}: ${p.de ?? '?'} → ${p.filamento}`;
  },

  aplicar(malha, p) {
    const o = malha.objetos[p.objeto];
    if (!o || !o.partes[p.parte]) throw new Error('A parte deste passo não existe mais.');
    const volta = { parte: o.partes[p.parte].extrusora, objeto: o.extrusora };
    trocarFilamento(malha, p.objeto, p.parte, p.filamento);
    return { volta, voltaBytes: 32, tela: 'recolorir' };
  },

  desfazer(malha, p, volta) {
    const o = malha.objetos[p.objeto];
    o.partes[p.parte].extrusora = volta.parte;
    o.extrusora = volta.objeto;
    return { tela: 'recolorir' };
  },
};
