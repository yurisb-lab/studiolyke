// Histórico de operações (desfazer, refazer, editar um passo antigo).
//
// Regra do modo leve: o histórico guarda RECEITAS (tipo + parâmetros), não cópias
// do modelo. Para voltar no tempo há dois caminhos:
//   - rápido: o passo guardou uma "volta" pequena (o filamento antigo, os códigos
//     antigos só dos triângulos que mudaram…) e é desfeito na hora;
//   - reabrir: o app reabre o arquivo original (ou o ponto de restauração mais
//     próximo, gravado no IndexedDB) e aplica as receitas até o passo desejado.
// As voltas têm um limite de memória: acima dele, as mais antigas são soltas e
// aqueles passos passam a ser desfeitos pelo caminho "reabrir".
//
// Passos de seleção também entram na lista (como no Photoshop). Eles guardam a
// seleção já pronta, compacta (ver js/core/selecao.js), e não mexem no modelo.
//
// Formato de um passo:
//   { id, tipo, params, rotulo, quando, erro,
//     volta, voltaBytes,                 (só na memória; nunca vai para o projeto salvo)
//     selecao, selecaoBytes }            (só nos passos do tipo 'selecao')

import { operacao } from '../ops/index.js';

const MB = 1048576;
let contador = 0;

export function novoId() {
  contador = (contador + 1) % 1e6;
  return `${Date.now().toString(36)}-${contador.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export const ehModelo = (passo) => passo.tipo !== 'selecao';

export class Historico {
  /**
   * @param {{orcamentoVolta?:number, orcamentoSelecao?:number, maxSelecoes?:number}} opcoes
   *   orcamentoVolta: bytes para as voltas rápidas; orcamentoSelecao: bytes para as
   *   seleções guardadas nos passos; maxSelecoes: quantos passos de seleção no máximo.
   */
  constructor({ orcamentoVolta = 24 * MB, orcamentoSelecao = 24 * MB, maxSelecoes = 60 } = {}) {
    this.orcamentoVolta = orcamentoVolta;
    this.orcamentoSelecao = orcamentoSelecao;
    this.maxSelecoes = maxSelecoes;
    this.limpar();
  }

  /** Começa do zero (modelo recém-aberto). */
  limpar() {
    this.passos = [];
    this.posicao = 0; // quantos passos estão aplicados (os de depois são o "refazer")
    this.pontos = new Map(); // id do passo -> chave do ponto de restauração (modelo logo depois dele)
    this.versao = (this.versao || 0) + 1; // muda a cada alteração (para o salvamento automático)
  }

  get podeDesfazer() { return this.posicao > 0; }

  get podeRefazer() { return this.posicao < this.passos.length; }

  get numModelo() { return this.passos.filter(ehModelo).length; }

  /**
   * Aplica uma operação nova no modelo e guarda o passo (corta o "refazer").
   * Se a operação falhar, nada é guardado e o erro sobe.
   */
  aplicarNovo(malha, tipo, params) {
    const op = operacao(tipo);
    const r = op.aplicar(malha, params, { guardarVolta: true });
    const passo = {
      id: novoId(),
      tipo,
      params,
      rotulo: op.rotulo(params),
      quando: Date.now(),
      erro: null,
      volta: r.volta || null,
      voltaBytes: r.volta ? r.voltaBytes || 0 : 0,
    };
    this._acrescentar(passo);
    return { passo, resultado: r };
  }

  /** Guarda um passo de seleção (a seleção já pronta, compacta; null = sem seleção). */
  registrarSelecao(selecao, rotulo) {
    const passo = {
      id: novoId(),
      tipo: 'selecao',
      params: null,
      rotulo,
      quando: Date.now(),
      erro: null,
      selecao,
      selecaoBytes: bytesDe(selecao),
    };
    this._acrescentar(passo);
    return passo;
  }

  _acrescentar(passo) {
    const cortados = this.passos.splice(this.posicao);
    for (const p of cortados) this.pontos.delete(p.id);
    this.passos.push(passo);
    this.posicao = this.passos.length;
    this._caber();
    this.versao++;
  }

  /** Respeita os limites de memória das voltas e das seleções guardadas. */
  _caber() {
    let soma = 0;
    for (const p of this.passos) soma += p.voltaBytes || 0;
    for (const p of this.passos) {
      if (soma <= this.orcamentoVolta) break;
      if (p.volta) {
        soma -= p.voltaBytes || 0;
        p.volta = null;
        p.voltaBytes = 0;
      }
    }
    // Seleções antigas saem (o modelo não depende delas); a seleção em vigor fica.
    const emVigor = this._indiceSelecaoEm(this.posicao);
    const contar = () => {
      let bytes = 0, n = 0;
      for (const p of this.passos) if (p.tipo === 'selecao') { bytes += p.selecaoBytes || 0; n++; }
      return { bytes, n };
    };
    let { bytes, n } = contar();
    for (let i = 0; i < this.passos.length && (bytes > this.orcamentoSelecao || n > this.maxSelecoes);) {
      const p = this.passos[i];
      if (p.tipo !== 'selecao' || i >= emVigor) { i++; continue; }
      this.passos.splice(i, 1);
      if (i < this.posicao) this.posicao--;
      bytes -= p.selecaoBytes || 0;
      n--;
    }
  }

  _indiceSelecaoEm(pos) {
    for (let i = Math.min(pos, this.passos.length) - 1; i >= 0; i--) if (this.passos[i].tipo === 'selecao') return i;
    return -1;
  }

  /** A seleção em vigor numa posição do histórico (null = nenhuma). */
  selecaoEm(pos = this.posicao) {
    const i = this._indiceSelecaoEm(pos);
    return i < 0 ? null : this.passos[i].selecao;
  }

  /**
   * Como ir da posição atual até "alvo":
   *   { passos: [{ passo, acao: 'desfazer' | 'aplicar' }] }  caminho rápido, em ordem
   *   { reabrir: true }                                       precisa reabrir o original
   */
  plano(alvo) {
    alvo = Math.max(0, Math.min(this.passos.length, alvo));
    const lista = [];
    if (alvo < this.posicao) {
      for (let i = this.posicao - 1; i >= alvo; i--) {
        const p = this.passos[i];
        if (!ehModelo(p) || p.erro) continue;
        if (!p.volta) return { reabrir: true, alvo };
        lista.push({ passo: p, acao: 'desfazer' });
      }
    } else {
      for (let i = this.posicao; i < alvo; i++) {
        const p = this.passos[i];
        if (ehModelo(p)) lista.push({ passo: p, acao: 'aplicar' });
      }
    }
    return { passos: lista, alvo };
  }

  /**
   * O que reaplicar para chegar em "alvo" a partir do original (ou do ponto de
   * restauração mais próximo): { ponto, receitas, passos }.
   * passos[i] é o passo de cada receita (para marcar falhas e guardar voltas).
   */
  receitasAte(alvo = this.posicao) {
    const modelo = this.passos.slice(0, alvo).filter(ehModelo);
    let inicio = 0, ponto = null;
    for (let k = modelo.length - 1; k >= 0; k--) {
      const chave = this.pontos.get(modelo[k].id);
      if (chave) { ponto = chave; inicio = k + 1; break; }
    }
    const passos = modelo.slice(inicio);
    return { ponto, receitas: passos.map((p) => ({ tipo: p.tipo, params: p.params })), passos };
  }

  /** Depois de reaplicar: guarda as voltas que vieram e marca as receitas que falharam. */
  depoisDeReabrir(passos, { falhas = [], voltas = [] } = {}) {
    passos.forEach((p, i) => {
      const v = voltas[i];
      p.volta = v && v.volta ? v.volta : null;
      p.voltaBytes = p.volta ? v.voltaBytes || 0 : 0;
      p.erro = null;
    });
    for (const f of falhas) if (passos[f.indice]) passos[f.indice].erro = f.mensagem;
    this._caber();
  }

  /** Muda a posição (depois de o app ter feito o plano). */
  irPara(alvo) {
    this.posicao = Math.max(0, Math.min(this.passos.length, alvo));
    this.versao++;
  }

  /**
   * Troca os parâmetros de um passo antigo. Os passos de modelo dali em diante
   * perdem a volta (o modelo vai ser refeito pelas receitas).
   * Devolve as chaves dos pontos de restauração que deixaram de valer.
   */
  editar(indice, params) {
    const p = this.passos[indice];
    if (!p || !ehModelo(p)) throw new Error('Este passo não pode ser editado.');
    const op = operacao(p.tipo);
    p.params = { ...p.params, ...params };
    p.rotulo = op.rotulo(p.params);
    p.quando = Date.now();
    this.versao++;
    return this._invalidarDesde(indice);
  }

  /** Tira um passo da lista. Devolve { modelo, pontos } (modelo = precisa refazer o modelo). */
  apagar(indice) {
    const p = this.passos[indice];
    if (!p) return { modelo: false, pontos: [] };
    const pontos = ehModelo(p) ? this._invalidarDesde(indice) : [];
    this.passos.splice(indice, 1);
    if (indice < this.posicao) this.posicao--;
    this.pontos.delete(p.id);
    this.versao++;
    return { modelo: ehModelo(p), pontos };
  }

  _invalidarDesde(indice) {
    const removidos = [];
    for (let i = indice; i < this.passos.length; i++) {
      const p = this.passos[i];
      if (ehModelo(p)) {
        p.volta = null;
        p.voltaBytes = 0;
        p.erro = null;
      }
      const chave = this.pontos.get(p.id);
      if (chave) {
        removidos.push(chave);
        this.pontos.delete(p.id);
      }
    }
    return removidos;
  }

  /** Para o projeto salvo: só as receitas do modelo (as voltas e seleções do histórico ficam de fora). */
  paraSalvar() {
    let posicao = 0;
    const passos = [];
    this.passos.forEach((p, i) => {
      if (!ehModelo(p)) return;
      passos.push({ id: p.id, tipo: p.tipo, params: p.params, rotulo: p.rotulo, quando: p.quando });
      if (i < this.posicao) posicao++;
    });
    return { passos, posicao };
  }

  /** Lê de volta o que paraSalvar() gravou. */
  carregar({ passos = [], posicao = 0 } = {}) {
    this.limpar();
    this.passos = passos.map((p) => {
      let rotulo = p.rotulo;
      try { rotulo = operacao(p.tipo).rotulo(p.params); } catch { /* operação de uma versão mais nova */ }
      return { id: p.id || novoId(), tipo: p.tipo, params: p.params, rotulo, quando: p.quando || Date.now(), erro: null, volta: null, voltaBytes: 0 };
    });
    this.posicao = Math.max(0, Math.min(this.passos.length, posicao));
  }

  /** Memória usada pelas voltas e seleções guardadas (bytes). */
  bytes() {
    let b = 0;
    for (const p of this.passos) b += (p.voltaBytes || 0) + (p.selecaoBytes || 0);
    return b;
  }
}

function bytesDe(obj) {
  if (!obj) return 0;
  let b = 64;
  for (const v of Object.values(obj)) if (v && v.byteLength) b += v.byteLength;
  return b;
}
