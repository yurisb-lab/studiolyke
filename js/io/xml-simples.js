// Leitor de XML pequeno (arquivos de configuração do 3MF: model_settings.config,
// .rels…). Os Web Workers não têm DOMParser, por isso este leitor simples.
// NÃO use para o 3dmodel.model (centenas de MB): esse é lido direto dos bytes em 3mf.js.

import { desfazerEntidades } from './texto.js';

/**
 * Transforma o texto num nó raiz { nome, atr, filhos, texto }.
 * Nomes sem prefixo de namespace ("p:path" vira "path"), mas o nome completo
 * fica em atrCompleto para quem precisar.
 */
export function lerXml(texto) {
  const raiz = { nome: '#documento', atr: {}, filhos: [], texto: '' };
  const pilha = [raiz];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(texto))) {
    const topo = pilha[pilha.length - 1];
    if (m[1] !== undefined) {
      topo.texto += m[1];
    } else if (m[2]) {
      const nome = semPrefixo(m[2]);
      // fecha até achar a tag certa (tolera XML um pouco torto)
      for (let k = pilha.length - 1; k > 0; k--) {
        if (pilha[k].nome === nome) { pilha.length = k; break; }
      }
    } else if (m[3]) {
      const no = { nome: semPrefixo(m[3]), atr: {}, filhos: [], texto: '' };
      const reAtr = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = reAtr.exec(m[4] || ''))) {
        no.atr[semPrefixo(a[1])] = desfazerEntidades(a[2] !== undefined ? a[2] : a[3]);
      }
      topo.filhos.push(no);
      if (!m[5]) pilha.push(no);
    } else if (m[6] && pilha.length > 1) {
      topo.texto += desfazerEntidades(m[6]);
    }
  }
  return raiz;
}

function semPrefixo(nome) {
  const i = nome.indexOf(':');
  return i >= 0 ? nome.slice(i + 1) : nome;
}

/** Filhos diretos com esse nome. */
export function filhos(no, nome) {
  return no ? no.filhos.filter((f) => f.nome === nome) : [];
}

export function filho(no, nome) {
  return no ? no.filhos.find((f) => f.nome === nome) || null : null;
}

/** Escapa texto para dentro de um atributo XML. */
export function escaparXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
