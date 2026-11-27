// Gravador de ZIP aos pedaços (o 3MF é um ZIP).
// Cada arquivo é comprimido enquanto é escrito, com o compressor do próprio
// navegador (CompressionStream, "deflate-raw"). Só o resultado comprimido fica
// na memória: o XML de dezenas de MB nunca existe inteiro de uma vez.

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(dados, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const codificador = new TextEncoder();

function dataDos(d) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dia = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, dia };
}

export class GravadorZip {
  constructor() {
    this.partes = []; // pedaços do arquivo final, em ordem
    this.central = []; // entradas do diretório central
    this.posicao = 0;
    this.data = dataDos(new Date());
  }

  /**
   * Acrescenta um arquivo.
   * @param {string} caminho  ex.: "3D/3dmodel.model"
   * @param {Uint8Array|string|AsyncIterable<Uint8Array>|Iterable<Uint8Array>} conteudo
   * @param {{comprimir?: boolean}} [opcoes]  PNG já vem comprimido: guardar sem comprimir
   */
  async adicionar(caminho, conteudo, { comprimir = true } = {}) {
    if (typeof conteudo === 'string') conteudo = codificador.encode(conteudo);
    const fonte = conteudo instanceof Uint8Array ? [conteudo] : conteudo;
    let crc = 0, tamanho = 0, comprimido = 0;
    const saida = [];
    if (comprimir) {
      const cs = new CompressionStream('deflate-raw');
      const escritor = cs.writable.getWriter();
      const leitor = cs.readable.getReader();
      const lendo = (async () => {
        for (;;) {
          const { value, done } = await leitor.read();
          if (done) break;
          saida.push(value);
          comprimido += value.length;
        }
      })();
      try {
        for await (const pedaco of fonte) {
          if (!pedaco.length) continue;
          crc = crc32(pedaco, crc);
          tamanho += pedaco.length;
          await escritor.write(pedaco);
        }
        await escritor.close();
      } catch (e) {
        escritor.abort(e).catch(() => {});
        throw e;
      }
      await lendo;
    } else {
      for await (const pedaco of fonte) {
        crc = crc32(pedaco, crc);
        tamanho += pedaco.length;
        comprimido += pedaco.length;
        saida.push(pedaco);
      }
    }
    if (tamanho >= 0xffffffff || this.posicao + comprimido >= 0xffffffff) {
      throw new Error('O arquivo ficou grande demais para um 3MF (mais de 4 GB).');
    }
    const nome = codificador.encode(caminho);
    const metodo = comprimir ? 8 : 0;
    const local = new Uint8Array(30 + nome.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true); // versão necessária
    dv.setUint16(6, 0x0800, true); // nomes em UTF-8
    dv.setUint16(8, metodo, true);
    dv.setUint16(10, this.data.hora, true);
    dv.setUint16(12, this.data.dia, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, comprimido, true);
    dv.setUint32(22, tamanho, true);
    dv.setUint16(26, nome.length, true);
    local.set(nome, 30);
    this.central.push({ nome, metodo, crc, comprimido, tamanho, posicao: this.posicao });
    this.partes.push(local, ...saida);
    this.posicao += local.length + comprimido;
    return { tamanho, comprimido };
  }

  /** Fecha o ZIP. Devolve a lista de pedaços (vira um Blob com new Blob(pedacos)). */
  finalizar() {
    const inicioCentral = this.posicao;
    let tamCentral = 0;
    for (const e of this.central) {
      const c = new Uint8Array(46 + e.nome.length);
      const dv = new DataView(c.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, e.metodo, true);
      dv.setUint16(12, this.data.hora, true);
      dv.setUint16(14, this.data.dia, true);
      dv.setUint32(16, e.crc, true);
      dv.setUint32(20, e.comprimido, true);
      dv.setUint32(24, e.tamanho, true);
      dv.setUint16(28, e.nome.length, true);
      dv.setUint32(42, e.posicao, true);
      c.set(e.nome, 46);
      this.partes.push(c);
      tamCentral += c.length;
    }
    const fim = new Uint8Array(22);
    const dv = new DataView(fim.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(8, this.central.length, true);
    dv.setUint16(10, this.central.length, true);
    dv.setUint32(12, tamCentral, true);
    dv.setUint32(16, inicioCentral, true);
    this.partes.push(fim);
    const pedacos = this.partes;
    this.partes = [];
    return pedacos;
  }
}
