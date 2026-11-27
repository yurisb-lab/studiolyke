// Leitura de texto direto dos bytes (sem criar strings gigantes).
// Usado pelos leitores de STL em texto, OBJ e 3MF: arquivos de centenas de MB
// viram números em typed arrays sem passar por uma string inteira na memória.

const POT10 = new Float64Array(23);
POT10[0] = 1;
for (let i = 1; i < POT10.length; i++) POT10[i] = POT10[i - 1] * 10;

export const ESPACO = 32, TAB = 9, NL = 10, CR = 13;

export function ehEspaco(c) {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

/**
 * Lê um número começando em bytes[i]. Devolve o valor e guarda em fim.i onde parou.
 * Devolve NaN se não houver número ali.
 */
export function lerNumero(bytes, i, fim) {
  const n = bytes.length;
  let neg = false;
  let c = bytes[i];
  if (c === 45) { neg = true; i++; } else if (c === 43) i++;
  let mant = 0, exp = 0, dig = 0, tem = false;
  while (i < n) {
    const d = bytes[i] - 48;
    if (d < 0 || d > 9) break;
    tem = true;
    if (dig < 15) {
      mant = mant * 10 + d;
      if (mant !== 0) dig++;
    } else exp++;
    i++;
  }
  if (bytes[i] === 46) {
    i++;
    while (i < n) {
      const d = bytes[i] - 48;
      if (d < 0 || d > 9) break;
      tem = true;
      if (dig < 15) {
        mant = mant * 10 + d;
        if (mant !== 0) dig++;
        exp--;
      }
      i++;
    }
  }
  if (!tem) {
    fim.i = i;
    return NaN;
  }
  c = bytes[i];
  if (c === 101 || c === 69) {
    let j = i + 1, en = false, e = 0, temE = false;
    if (bytes[j] === 45) { en = true; j++; } else if (bytes[j] === 43) j++;
    while (j < n) {
      const d = bytes[j] - 48;
      if (d < 0 || d > 9) break;
      e = e * 10 + d;
      temE = true;
      j++;
    }
    if (temE) {
      exp += en ? -e : e;
      i = j;
    }
  }
  fim.i = i;
  let v;
  if (exp === 0) v = mant;
  else if (exp > 0) v = exp < 23 ? mant * POT10[exp] : mant * Math.pow(10, exp);
  else v = -exp < 23 ? mant / POT10[-exp] : mant / Math.pow(10, -exp);
  return neg ? -v : v;
}

/** Inteiro sem sinal; NaN se não houver. */
export function lerInteiro(bytes, i, fim) {
  const n = bytes.length;
  let neg = false;
  if (bytes[i] === 45) { neg = true; i++; } else if (bytes[i] === 43) i++;
  let v = 0, tem = false;
  while (i < n) {
    const d = bytes[i] - 48;
    if (d < 0 || d > 9) break;
    v = v * 10 + d;
    tem = true;
    i++;
  }
  fim.i = i;
  if (!tem) return NaN;
  return neg ? -v : v;
}

/** Confere se a palavra (já em códigos) começa em bytes[i]. */
export function comecaCom(bytes, i, codigos) {
  if (i + codigos.length > bytes.length) return false;
  for (let k = 0; k < codigos.length; k++) {
    if (bytes[i + k] !== codigos[k]) return false;
  }
  return true;
}

export function codigos(texto) {
  return Array.from(texto, (c) => c.charCodeAt(0));
}

const decodificador = new TextDecoder('utf-8');

export function textoDe(bytes, ini, fim) {
  return decodificador.decode(bytes.subarray(ini, fim));
}

/** Troca as entidades básicas do XML (&amp; &lt; ...). */
export function desfazerEntidades(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    if (e[1] === 'x') return String.fromCodePoint(parseInt(e.slice(2), 16));
    return String.fromCodePoint(parseInt(e.slice(1), 10));
  });
}

// --- escrita ------------------------------------------------------------------

const codificador = new TextEncoder();

/**
 * Escreve texto direto em bytes, em pedaços de tamanho fixo. Quando um pedaço
 * enche, ele é entregue (aoEncher) e um novo começa: o arquivo inteiro nunca
 * fica junto na memória.
 */
export class EscritorBytes {
  constructor(aoEncher, tamanho = 1 << 20) {
    this.aoEncher = aoEncher;
    this.tamanho = tamanho;
    this.buf = new Uint8Array(tamanho);
    this.p = 0;
    this.total = 0;
  }

  /** Garante espaço para n bytes no pedaço atual. */
  espaco(n) {
    if (this.p + n <= this.buf.length) return;
    this.esvaziar();
    if (n > this.buf.length) this.buf = new Uint8Array(n);
  }

  esvaziar() {
    if (this.p === 0) return;
    const pedaco = this.buf.subarray(0, this.p);
    this.total += this.p;
    this.aoEncher(pedaco);
    this.buf = new Uint8Array(Math.max(this.tamanho, this.buf.length));
    this.p = 0;
  }

  /** Texto qualquer (UTF-8). */
  texto(s) {
    let ascii = true;
    for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) > 127) { ascii = false; break; }
    if (!ascii) {
      this.bytes(codificador.encode(s));
      return;
    }
    this.espaco(s.length);
    const b = this.buf;
    let p = this.p;
    for (let k = 0; k < s.length; k++) b[p++] = s.charCodeAt(k);
    this.p = p;
  }

  bytes(u8) {
    this.espaco(u8.length);
    this.buf.set(u8, this.p);
    this.p += u8.length;
  }

  /** Inteiro sem sinal (índices de vértice). */
  inteiro(v) {
    this.espaco(12);
    const b = this.buf;
    if (v === 0) { b[this.p++] = 48; return; }
    let p = this.p;
    let ini = p;
    while (v > 0) {
      const q = Math.floor(v / 10);
      b[p++] = 48 + (v - q * 10);
      v = q;
    }
    this.p = p;
    // os dígitos saíram ao contrário
    for (let fimD = p - 1; ini < fimD; ini++, fimD--) { const t = b[ini]; b[ini] = b[fimD]; b[fimD] = t; }
  }

  /**
   * Coordenada de vértice: o número mais curto que o Bambu Studio lê como o MESMO
   * valor em precisão simples (é assim que ele guarda a malha). Assim a malha
   * exportada fica idêntica à original lá dentro, sem casas sobrando.
   */
  coordenada(v) {
    if (!Number.isFinite(v)) v = 0;
    const alvo = Math.fround(v);
    for (let casas = 0; casas <= 9; casas++) {
      const f = POT10[casas];
      const r = Math.round(v * f);
      if (Math.fround(r / f) === alvo) {
        this._fixo(r, casas);
        return;
      }
    }
    this.texto(String(alvo));
  }

  /** Escreve r / 10^casas sem zeros sobrando. */
  _fixo(r, casas) {
    this.espaco(32);
    if (r === 0) { this.buf[this.p++] = 48; return; }
    if (r < 0) { this.buf[this.p++] = 45; r = -r; }
    while (casas > 0 && r % 10 === 0) { r /= 10; casas--; }
    const f = POT10[casas];
    const inteira = Math.floor(r / f);
    let frac = r - inteira * f;
    this.inteiro(inteira);
    if (casas > 0) {
      const b = this.buf;
      b[this.p++] = 46;
      const ini = this.p;
      for (let k = casas - 1; k >= 0; k--) {
        b[ini + k] = 48 + (frac % 10);
        frac = Math.floor(frac / 10);
      }
      this.p = ini + casas;
    }
  }

  /** Termina: entrega o último pedaço. */
  fechar() {
    this.esvaziar();
    return this.total;
  }
}
