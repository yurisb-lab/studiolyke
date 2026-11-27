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
