// Leitor de 3MF — nesta etapa (1.1) só a geometria, para mostrar na tela.
// Objetos, partes e filamentos completos entram na etapa 1.2; a pintura do Bambu na 1.3.
//
// Lê os bytes do XML diretamente (os Workers não têm DOMParser e um XML de
// centenas de MB não pode virar uma string inteira no PC de 4 GB).
// Entende o formato do Bambu Studio: 3D/3dmodel.model com <components> que apontam
// para 3D/Objects/object_N.model (extensão "production" do 3MF).

import { ArrayCrescente, criarMalha } from '../core/malha.js';
import { lerNumero, lerInteiro, ehEspaco, textoDe, desfazerEntidades } from './texto.js';

const ESCALA_UNIDADE = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

const IDENTIDADE = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/**
 * @param {ArrayBuffer|Uint8Array|Blob} arquivo  o .3mf inteiro
 * @param {*} JSZip  a classe JSZip (injetada, para rodar no worker e nos testes)
 * @param {(fracao:number)=>void} [aoProgresso]
 */
export async function ler3mf(arquivo, JSZip, aoProgresso) {
  const zip = await JSZip.loadAsync(arquivo);
  const avisos = [];
  const principal = await acharModeloPrincipal(zip);
  const modelos = new Map(); // caminho -> modelo lido
  const tamanhos = {};
  let totalBytes = 0;
  zip.forEach((caminho, entrada) => {
    if (/\.model$/i.test(caminho)) {
      const t = entrada._data && entrada._data.uncompressedSize;
      tamanhos[normalizarCaminho(caminho)] = t || 0;
      totalBytes += t || 0;
    }
  });
  let lidos = 0;

  async function carregar(caminho) {
    caminho = normalizarCaminho(caminho);
    if (modelos.has(caminho)) return modelos.get(caminho);
    const entrada = zip.file(caminho) || acharSemCaixa(zip, caminho);
    if (!entrada) throw new Error(`O 3MF aponta para "${caminho}", que não existe dentro do arquivo.`);
    let bytes = await entrada.async('uint8array');
    const base = lidos;
    const modelo = lerModeloXml(bytes, caminho, (f) => {
      if (aoProgresso && totalBytes) aoProgresso(Math.min(1, (base + f * bytes.length) / totalBytes));
    });
    lidos += bytes.length;
    bytes = null;
    modelos.set(caminho, modelo);
    return modelo;
  }

  const raiz = await carregar(principal);
  if (!raiz.itens.length) throw new Error('O 3MF não tem nenhum objeto na placa (build vazio).');

  // Junta todas as instâncias (malha + transformação) antes de montar, para alocar o tamanho exato.
  const instancias = [];
  const objetos = [];
  let totalVert = 0, totalTri = 0;
  let pintados = 0;

  async function resolver(caminho, id, matriz, profundidade, nomeRaiz) {
    if (profundidade > 32) throw new Error('O 3MF tem componentes dentro de componentes demais (ciclo?).');
    const modelo = await carregar(caminho);
    const obj = modelo.objetos.get(id);
    if (!obj) throw new Error(`O 3MF usa o objeto ${id}, que não existe em ${caminho}.`);
    if (obj.posicoes) {
      instancias.push({ obj, matriz });
      totalVert += obj.posicoes.length / 3;
      totalTri += obj.indices.length / 3;
      pintados += obj.pintados;
    }
    for (const comp of obj.componentes) {
      await resolver(comp.caminho || caminho, comp.id, multiplicar(comp.matriz, matriz), profundidade + 1, nomeRaiz);
    }
  }

  for (const item of raiz.itens) {
    const antes = totalTri;
    const caminho = item.caminho || principal;
    const modelo = await carregar(caminho);
    const obj = modelo.objetos.get(item.id);
    const nome = (obj && obj.nome) || `Objeto ${item.id}`;
    await resolver(caminho, item.id, item.matriz, 0, nome);
    if (totalTri > antes) objetos.push({ nome, primeiroTriangulo: antes, numTriangulos: totalTri - antes });
  }

  const posicoes = new Float32Array(totalVert * 3);
  const indices = new Uint32Array(totalTri * 3);
  let pv = 0, pt = 0;
  let invalidos = 0;
  for (const { obj, matriz: m } of instancias) {
    const p = obj.posicoes;
    const nv = p.length / 3;
    for (let k = 0; k < p.length; k += 3) {
      const x = p[k], y = p[k + 1], z = p[k + 2];
      posicoes[pv * 3 + k] = x * m[0] + y * m[3] + z * m[6] + m[9];
      posicoes[pv * 3 + k + 1] = x * m[1] + y * m[4] + z * m[7] + m[10];
      posicoes[pv * 3 + k + 2] = x * m[2] + y * m[5] + z * m[8] + m[11];
    }
    const espelhado = determinante(m) < 0;
    const t = obj.indices;
    for (let k = 0; k < t.length; k += 3) {
      let a = t[k], b = t[k + 1], c = t[k + 2];
      if (a >= nv || b >= nv || c >= nv) {
        invalidos++;
        a = b = c = 0;
      }
      if (espelhado) { const tmp = b; b = c; c = tmp; }
      indices[pt++] = a + pv;
      indices[pt++] = b + pv;
      indices[pt++] = c + pv;
    }
    pv += nv;
  }
  if (invalidos) avisos.push(`${invalidos} triângulo(s) apontavam para vértices que não existem e foram anulados.`);
  if (pintados) {
    avisos.push(`Pintura do Bambu encontrada em ${pintados.toLocaleString('pt-BR')} triângulo(s). Nesta versão ela ainda não aparece; a leitura da pintura chega na etapa 1.3.`);
  }
  return criarMalha({
    posicoes,
    indices,
    objetos,
    avisos,
    extras: { trianguloPintados: pintados },
  });
}

async function acharModeloPrincipal(zip) {
  const rels = zip.file('_rels/.rels');
  if (rels) {
    const xml = await rels.async('string');
    const re = /<Relationship\b[^>]*>/g;
    let m;
    while ((m = re.exec(xml))) {
      const tag = m[0];
      if (/3dmodel/i.test(tag)) {
        const alvo = /Target\s*=\s*["']([^"']+)["']/.exec(tag);
        if (alvo) return normalizarCaminho(alvo[1]);
      }
    }
  }
  return '3D/3dmodel.model';
}

function normalizarCaminho(c) {
  return decodeURIComponent(c).replace(/^\/+/, '');
}

function acharSemCaixa(zip, caminho) {
  const alvo = caminho.toLowerCase();
  let achado = null;
  zip.forEach((c, entrada) => {
    if (!achado && c.toLowerCase() === alvo) achado = entrada;
  });
  return achado;
}

/** Composição de transformações 3MF (vetor linha): primeiro a, depois b. */
export function multiplicar(a, b) {
  const c = new Array(12);
  for (let r = 0; r < 4; r++) {
    for (let col = 0; col < 3; col++) {
      c[r * 3 + col] = a[r * 3] * b[col] + a[r * 3 + 1] * b[3 + col] + a[r * 3 + 2] * b[6 + col] + (r === 3 ? b[9 + col] : 0);
    }
  }
  return c;
}

function determinante(m) {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

function lerMatriz(texto, escala) {
  if (!texto) return IDENTIDADE;
  const v = texto.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some((x) => !Number.isFinite(x))) return IDENTIDADE;
  v[9] *= escala;
  v[10] *= escala;
  v[11] *= escala;
  return v;
}

// --- leitura do XML de um arquivo .model -------------------------------------

/**
 * Percorre o XML em bytes. Os elementos <vertex> e <triangle> (milhões deles)
 * são lidos sem criar objetos; os demais (poucos) viram atributos em texto.
 */
export function lerModeloXml(bytes, caminho, aoProgresso) {
  const n = bytes.length;
  const fim = { i: 0 };
  const objetos = new Map();
  const itens = [];
  let escala = 1;
  let obj = null;
  let dentroBuild = false;
  const passo = 1 << 21;
  let proximo = passo;
  let i = 0;

  while (i < n) {
    // acha o próximo '<'
    while (i < n && bytes[i] !== 60) i++;
    if (i >= n) break;
    i++;
    const c = bytes[i];
    if (c === 33 /* ! */) { i = pularEspecial(bytes, i); continue; }
    if (c === 63 /* ? */) { i = pularAte(bytes, i, 62) + 1; continue; }
    const fecha = c === 47; /* / */
    if (fecha) i++;
    // nome da tag (sem prefixo de namespace)
    let ini = i;
    while (i < n && !ehEspaco(bytes[i]) && bytes[i] !== 62 && bytes[i] !== 47) {
      if (bytes[i] === 58 /* : */) ini = i + 1;
      i++;
    }
    const len = i - ini;
    const b0 = bytes[ini];

    if (!fecha && len === 6 && b0 === 118 && bytes[ini + 1] === 101 /* vertex */) {
      i = lerVertice(bytes, i, fim, obj, escala);
      continue;
    }
    if (!fecha && len === 8 && b0 === 116 && bytes[ini + 1] === 114 /* triangle */) {
      i = lerTriangulo(bytes, i, fim, obj);
      continue;
    }

    const nome = textoDe(bytes, ini, ini + len);
    if (fecha) {
      if (nome === 'object') {
        if (obj) finalizarObjeto(obj);
        obj = null;
      } else if (nome === 'build') dentroBuild = false;
      i = pularAte(bytes, i, 62) + 1;
      continue;
    }
    const atr = {};
    i = lerAtributos(bytes, i, atr);
    if (nome === 'model') {
      const u = (atr.unit || 'millimeter').toLowerCase();
      escala = ESCALA_UNIDADE[u] || 1;
    } else if (nome === 'object') {
      if (obj) finalizarObjeto(obj);
      obj = {
        id: atr.id,
        nome: atr.name ? desfazerEntidades(atr.name) : '',
        tipo: atr.type || 'model',
        _pos: null,
        _idx: null,
        posicoes: null,
        indices: null,
        componentes: [],
        pintados: 0,
      };
      objetos.set(atr.id, obj);
    } else if (nome === 'mesh' && obj) {
      obj._pos = new ArrayCrescente(Float32Array, 4096);
      obj._idx = new ArrayCrescente(Uint32Array, 8192);
    } else if (nome === 'component' && obj) {
      obj.componentes.push({
        id: atr.objectid,
        caminho: atr.path ? normalizarCaminho(atr.path) : null,
        matriz: lerMatriz(atr.transform, escala),
      });
    } else if (nome === 'build') {
      dentroBuild = true;
    } else if (nome === 'item' && dentroBuild) {
      if (atr.printable !== '0') {
        itens.push({
          id: atr.objectid,
          caminho: atr.path ? normalizarCaminho(atr.path) : null,
          matriz: lerMatriz(atr.transform, escala),
        });
      }
    }
    if (aoProgresso && i >= proximo) {
      aoProgresso(i / n);
      proximo += passo;
    }
  }
  if (obj) finalizarObjeto(obj);
  if (aoProgresso) aoProgresso(1);
  return { caminho, objetos, itens, escala };
}

function finalizarObjeto(obj) {
  if (obj._pos) {
    obj.posicoes = obj._pos.final();
    obj.indices = obj._idx.final();
  }
  obj._pos = obj._idx = null;
}

function pularAte(bytes, i, codigo) {
  while (i < bytes.length && bytes[i] !== codigo) i++;
  return i;
}

function pularEspecial(bytes, i) {
  // <!-- comentário --> ou <![CDATA[ ... ]]> ou <!DOCTYPE ...>
  if (bytes[i + 1] === 45 && bytes[i + 2] === 45) {
    i += 3;
    while (i < bytes.length && !(bytes[i] === 45 && bytes[i + 1] === 45 && bytes[i + 2] === 62)) i++;
    return i + 3;
  }
  if (bytes[i + 1] === 91) {
    while (i < bytes.length && !(bytes[i] === 93 && bytes[i + 1] === 93 && bytes[i + 2] === 62)) i++;
    return i + 3;
  }
  return pularAte(bytes, i, 62) + 1;
}

/** Lê atributos genéricos até o '>' (nome local, sem prefixo, como chave). */
function lerAtributos(bytes, i, atr) {
  const n = bytes.length;
  for (;;) {
    while (i < n && ehEspaco(bytes[i])) i++;
    const c = bytes[i];
    if (i >= n || c === 62) return i + 1;
    if (c === 47) { i++; continue; }
    let ini = i;
    while (i < n && bytes[i] !== 61 && !ehEspaco(bytes[i]) && bytes[i] !== 62) {
      if (bytes[i] === 58) ini = i + 1;
      i++;
    }
    const nome = textoDe(bytes, ini, i);
    while (i < n && bytes[i] !== 61 && bytes[i] !== 62) i++;
    if (bytes[i] !== 61) continue;
    i++;
    while (i < n && ehEspaco(bytes[i])) i++;
    const aspas = bytes[i];
    if (aspas !== 34 && aspas !== 39) continue;
    i++;
    const vIni = i;
    while (i < n && bytes[i] !== aspas) i++;
    atr[nome] = textoDe(bytes, vIni, i);
    i++;
  }
}

/** <vertex x=".." y=".." z=".."/> sem criar objetos. */
function lerVertice(bytes, i, fim, obj, escala) {
  const n = bytes.length;
  let x = 0, y = 0, z = 0;
  for (;;) {
    while (i < n && ehEspaco(bytes[i])) i++;
    const c = bytes[i];
    if (i >= n || c === 62) { i++; break; }
    if (c === 47) { i++; continue; }
    const letra = c;
    const nomeCurto = bytes[i + 1] === 61 || ehEspaco(bytes[i + 1]);
    while (i < n && bytes[i] !== 34 && bytes[i] !== 39 && bytes[i] !== 62) i++;
    if (bytes[i] === 62) { i++; break; }
    const aspas = bytes[i];
    i++;
    if (nomeCurto && (letra === 120 || letra === 121 || letra === 122)) {
      while (ehEspaco(bytes[i])) i++;
      const v = lerNumero(bytes, i, fim) * escala;
      if (letra === 120) x = v; else if (letra === 121) y = v; else z = v;
      i = fim.i;
    }
    while (i < n && bytes[i] !== aspas) i++;
    i++;
  }
  if (obj && obj._pos) obj._pos.push3(x, y, z);
  return i;
}

/** <triangle v1=".." v2=".." v3=".." [paint_color=".."]/> sem criar objetos. */
function lerTriangulo(bytes, i, fim, obj) {
  const n = bytes.length;
  let a = 0, b = 0, c3 = 0;
  let pintado = false;
  for (;;) {
    while (i < n && ehEspaco(bytes[i])) i++;
    const c = bytes[i];
    if (i >= n || c === 62) { i++; break; }
    if (c === 47) { i++; continue; }
    const ini = i;
    while (i < n && bytes[i] !== 61 && !ehEspaco(bytes[i]) && bytes[i] !== 62) i++;
    const len = i - ini;
    while (i < n && bytes[i] !== 34 && bytes[i] !== 39 && bytes[i] !== 62) i++;
    if (bytes[i] === 62) { i++; break; }
    const aspas = bytes[i];
    i++;
    if (len === 2 && bytes[ini] === 118 /* v */) {
      const v = lerInteiro(bytes, i, fim);
      const d = bytes[ini + 1];
      if (d === 49) a = v; else if (d === 50) b = v; else if (d === 51) c3 = v;
      i = fim.i;
    } else if (len > 5 && bytes[i] !== aspas) {
      // paint_color (Bambu) ou mmu_segmentation (Prusa) com conteúdo = triângulo pintado
      const p = bytes[ini];
      if (p === 112 /* paint_color */ || bytes[ini + len - 1] === 110 /* ..._segmentation */) pintado = true;
    }
    while (i < n && bytes[i] !== aspas) i++;
    i++;
  }
  if (obj && obj._idx) {
    obj._idx.push3(a, b, c3);
    if (pintado) obj.pintados++;
  }
  return i;
}
