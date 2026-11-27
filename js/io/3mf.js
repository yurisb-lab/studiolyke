// Leitor de 3MF: geometria, objetos, partes, filamentos, placas e a pintura do Bambu
// (guardada como veio; a decodificação da pintura é a etapa 1.3).
//
// Lê os bytes do XML diretamente (os Workers não têm DOMParser e um XML de
// centenas de MB não pode virar uma string inteira no PC de 4 GB).
// Entende os dois jeitos do Bambu Studio: tudo em 3D/3dmodel.model, ou
// 3D/3dmodel.model com <components> que apontam para 3D/Objects/object_N.model
// (extensão "production" do 3MF).

import { ArrayCrescente, criarMalha } from '../core/malha.js';
import { IDENTIDADE, garantirEstrutura } from '../core/projeto.js';
import { lerNumero, lerInteiro, ehEspaco, textoDe, desfazerEntidades, codigos } from './texto.js';
import { lerXml, filhos } from './xml-simples.js';

const ESCALA_UNIDADE = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

// Arquivos que o app refaz na exportação (ou que ficam velhos depois de mexer no modelo).
// O resto (configurações do projeto, miniaturas, anexos…) é guardado como veio.
const REFEITOS = [
  /^\[Content_Types\]\.xml$/i,
  /^_rels\/\.rels$/i,
  /^3D\//i,
  /^Metadata\/model_settings\.config$/i,
  /^Metadata\/slice_info\.config$/i,
  /^Metadata\/cut_information\.xml$/i,
  /\.gcode(\.md5)?$/i,
  /^Metadata\/plate_\d+\.json$/i,
  /^Metadata\/(top|pick)_\d+\.png$/i,
];

/**
 * @param {ArrayBuffer|Uint8Array|Blob} arquivo  o .3mf inteiro
 * @param {*} JSZip  a classe JSZip (injetada, para rodar no worker e nos testes)
 * @param {(fracao:number)=>void} [aoProgresso]
 */
export async function ler3mf(arquivo, JSZip, aoProgresso) {
  const zip = await JSZip.loadAsync(arquivo);
  const avisos = [];
  const { principal, relacoes } = await acharModeloPrincipal(zip);
  const modelos = new Map(); // caminho -> modelo lido
  let totalBytes = 0;
  zip.forEach((caminho, entrada) => {
    if (/\.model$/i.test(caminho)) totalBytes += (entrada._data && entrada._data.uncompressedSize) || 0;
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

  const config = await lerConfigBambu(zip);
  const filamentos = await lerFilamentos(zip);

  // Cada item da placa vira um objeto; cada malha dentro dele vira uma parte.
  const instancias = []; // { obj (malha), matriz (completa), parte }
  const objetos = [];
  let totalVert = 0, totalTri = 0, pintados = 0, comExtras = 0;
  const contagemItem = new Map();

  async function resolver(caminho, id, matrizRel, profundidade, partes) {
    if (profundidade > 32) throw new Error('O 3MF tem componentes dentro de componentes demais (ciclo?).');
    const modelo = await carregar(caminho);
    const obj = modelo.objetos.get(id);
    if (!obj) throw new Error(`O 3MF usa o objeto ${id}, que não existe em ${caminho}.`);
    if (obj.posicoes) partes.push({ obj, matrizRel });
    for (const comp of obj.componentes) {
      await resolver(comp.caminho || caminho, comp.id, multiplicar(comp.matriz, matrizRel), profundidade + 1, partes);
    }
  }

  for (const item of raiz.itens) {
    const caminho = item.caminho || principal;
    const modelo = await carregar(caminho);
    const objRaiz = modelo.objetos.get(item.id);
    const chave = `${caminho}#${item.id}`;
    const instancia = contagemItem.get(chave) || 0;
    contagemItem.set(chave, instancia + 1);

    const cfg = config.objetos.get(item.id);
    const encontradas = [];
    await resolver(caminho, item.id, IDENTIDADE, 0, encontradas);
    if (!encontradas.length) continue;

    const nome = (cfg && cfg.nome) || (objRaiz && objRaiz.nome) || `Objeto ${item.id}`;
    const objeto = {
      nome,
      idOriginal: item.id,
      instancia,
      primeiroTriangulo: totalTri,
      numTriangulos: 0,
      matriz: item.matriz,
      imprimivel: item.imprimivel,
      extrusora: cfg && cfg.extrusora != null ? cfg.extrusora : 1,
      config: cfg ? cfg.meta : [],
      montagem: config.montagem.get(`${item.id}:${instancia}`) || null,
      partes: [],
    };
    for (const { obj, matrizRel } of encontradas) {
      const cfgParte = cfg && cfg.partes.get(obj.id);
      const nv = obj.posicoes.length / 3;
      const nt = obj.indices.length / 3;
      const parte = {
        nome: (cfgParte && cfgParte.nome) || obj.nome || nome,
        subtipo: (cfgParte && cfgParte.subtipo) || (obj.tipo === 'support' ? 'support_blocker' : 'normal_part'),
        primeiroTriangulo: totalTri,
        numTriangulos: nt,
        primeiroVertice: totalVert,
        numVertices: nv,
        matriz: matrizRel,
        // sem filamento próprio (comum em modificadores) = usa o do objeto; fica vazio para voltar igual
        extrusora: cfgParte ? cfgParte.extrusora : null,
        config: cfgParte ? cfgParte.meta : [],
      };
      objeto.partes.push(parte);
      instancias.push({ obj, matriz: multiplicar(matrizRel, item.matriz) });
      totalVert += nv;
      totalTri += nt;
      pintados += obj.pintados;
      if (obj.extrasIni) comExtras++;
    }
    objeto.numTriangulos = totalTri - objeto.primeiroTriangulo;
    objetos.push(objeto);
  }

  // Monta a malha única (posições já na placa, em mm).
  // Precisão dupla: objetos longe da origem (placas 2, 3…) perderiam casas decimais
  // em precisão simples, e a exportação não voltaria exatamente igual ao original.
  const posicoes = new Float64Array(totalVert * 3);
  const indices = new Uint32Array(totalTri * 3);
  let pintura = null;
  if (comExtras) {
    let bytesExtras = 0;
    for (const { obj } of instancias) if (obj.extras) bytesExtras += obj.extras.length;
    pintura = { atributos: new Uint8Array(bytesExtras), inicio: new Uint32Array(totalTri + 1) };
  }
  let pv = 0, pt = 0, tri = 0, pe = 0;
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
      // Espelhado: inverte a ordem para a normal continuar para fora.
      // (Na exportação a ordem original é restaurada, por causa da pintura.)
      if (espelhado) { const tmp = b; b = c; c = tmp; }
      indices[pt++] = a + pv;
      indices[pt++] = b + pv;
      indices[pt++] = c + pv;
    }
    if (pintura) {
      const nt = t.length / 3;
      if (obj.extrasIni) {
        pintura.atributos.set(obj.extras, pe);
        for (let k = 0; k < nt; k++) pintura.inicio[tri + k] = obj.extrasIni[k] + pe;
        pe += obj.extras.length;
      } else {
        pintura.inicio.fill(pe, tri, tri + nt);
      }
      tri += nt;
    }
    pv += nv;
  }
  if (pintura) pintura.inicio[totalTri] = pe;

  if (invalidos) avisos.push(`${invalidos} triângulo(s) apontavam para vértices que não existem e foram anulados.`);
  if (pintados) {
    avisos.push(`Pintura do Bambu encontrada em ${pintados.toLocaleString('pt-BR')} triângulo(s). Ela ainda não aparece na tela (chega na etapa 1.3), mas fica guardada e volta igual ao exportar.`);
  }

  // Placas: cada <model_instance> aponta para um objeto e uma instância.
  const porChave = new Map(objetos.map((o, i) => [`${o.idOriginal}:${o.instancia}`, i]));
  const placas = config.placas.map((pl) => ({
    id: pl.id,
    nome: pl.nome,
    bloqueada: pl.bloqueada,
    config: pl.meta,
    objetos: pl.instancias.map((k) => porChave.get(k)).filter((i) => i !== undefined),
  }));

  const extras = await guardarArquivosExtras(zip);
  const ordemPreservada = objetos.every((o) => o.instancia === 0);
  const malha = criarMalha({
    posicoes,
    indices,
    objetos,
    avisos,
    extras: {
      trianguloPintados: pintados,
      filamentos,
      placas,
      pintura,
      arquivo3mf: {
        aplicacao: raiz.metadados.find(([n]) => n === 'Application')?.[1] || '',
        metadados: raiz.metadados,
        extras,
        ordemPreservada,
        relacoes,
        bambu: config.existe,
      },
    },
  });
  return garantirEstrutura(malha);
}

// --- configuração do Bambu (Metadata/*.config) ----------------------------------

/** Lê Metadata/model_settings.config: nomes, filamento por objeto/parte, placas. */
export async function lerConfigBambu(zip) {
  const r = { existe: false, objetos: new Map(), placas: [], montagem: new Map() };
  const entrada = zip.file('Metadata/model_settings.config') || acharSemCaixa(zip, 'Metadata/model_settings.config');
  if (!entrada) return r;
  r.existe = true;
  const doc = lerXml(await entrada.async('string'));
  const raiz = filhos(doc, 'config')[0];
  if (!raiz) return r;
  const metas = (no) => filhos(no, 'metadata').filter((m) => m.atr.key != null).map((m) => [m.atr.key, m.atr.value ?? '']);
  const separar = (pares) => {
    const resto = [];
    let nome = '', extrusora = null;
    for (const [k, v] of pares) {
      if (k === 'name') nome = v;
      else if (k === 'extruder') extrusora = parseInt(v, 10);
      else if (k === 'matrix') { /* refeito a partir da transformação da parte */ } else resto.push([k, v]);
    }
    return { nome, extrusora: Number.isFinite(extrusora) ? extrusora : null, meta: resto };
  };
  for (const o of filhos(raiz, 'object')) {
    const obj = separar(metas(o));
    obj.partes = new Map();
    for (const p of filhos(o, 'part')) {
      const parte = separar(metas(p));
      parte.subtipo = p.atr.subtype || 'normal_part';
      obj.partes.set(p.atr.id, parte);
    }
    r.objetos.set(o.atr.id, obj);
  }
  for (const pl of filhos(raiz, 'plate')) {
    const pares = metas(pl);
    const valor = (k) => pares.find(([kk]) => kk === k)?.[1];
    r.placas.push({
      id: parseInt(valor('plater_id'), 10) || r.placas.length + 1,
      nome: valor('plater_name') || '',
      bloqueada: valor('locked') === 'true',
      meta: pares.filter(([k]) => !['plater_id', 'plater_name', 'locked'].includes(k)),
      instancias: filhos(pl, 'model_instance').map((mi) => {
        const m = metas(mi);
        const v = (k) => m.find(([kk]) => kk === k)?.[1];
        return `${v('object_id')}:${v('instance_id') || 0}`;
      }),
    });
  }
  for (const a of filhos(filhos(raiz, 'assemble')[0], 'assemble_item')) {
    r.montagem.set(`${a.atr.object_id}:${a.atr.instance_id || 0}`, { transform: a.atr.transform || '', offset: a.atr.offset || '0 0 0' });
  }
  return r;
}

/** Filamentos do projeto (Metadata/project_settings.config, em JSON). */
export async function lerFilamentos(zip) {
  const entrada = zip.file('Metadata/project_settings.config') || acharSemCaixa(zip, 'Metadata/project_settings.config');
  if (!entrada) return [];
  try {
    const cfg = JSON.parse(await entrada.async('string'));
    const lista = (k) => (Array.isArray(cfg[k]) ? cfg[k] : []);
    const cores = lista('filament_colour');
    const n = Math.max(cores.length, lista('filament_settings_id').length);
    const r = [];
    for (let i = 0; i < n; i++) {
      r.push({
        cor: String(cores[i] || '#FFFFFF'),
        tipo: String(lista('filament_type')[i] || ''),
        perfil: String(lista('filament_settings_id')[i] || ''),
        marca: String(lista('filament_vendor')[i] || ''),
      });
    }
    return r;
  } catch {
    return [];
  }
}

async function guardarArquivosExtras(zip) {
  const lista = [];
  const entradas = [];
  zip.forEach((caminho, entrada) => {
    if (entrada.dir) return;
    if (REFEITOS.some((re) => re.test(caminho))) return;
    entradas.push([caminho, entrada]);
  });
  for (const [caminho, entrada] of entradas) {
    lista.push({ caminho, bytes: await entrada.async('uint8array') });
  }
  return lista;
}

/** Acha o modelo principal pelo _rels/.rels e guarda as outras relações (miniaturas…). */
async function acharModeloPrincipal(zip) {
  const rels = zip.file('_rels/.rels');
  let principal = null;
  const relacoes = [];
  if (rels) {
    const doc = lerXml(await rels.async('string'));
    for (const r of filhos(filhos(doc, 'Relationships')[0], 'Relationship')) {
      const alvo = r.atr.Target || '';
      const tipo = r.atr.Type || '';
      if (!alvo) continue;
      relacoes.push({ alvo, tipo });
      if (!principal && /3dmodel/i.test(tipo)) principal = normalizarCaminho(alvo);
    }
  }
  return { principal: principal || '3D/3dmodel.model', relacoes };
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

export function determinante(m) {
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
  const metadados = [];
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
    } else if (nome === 'metadata' && !obj && atr.name && bytes[i - 2] !== 47) {
      // <metadata name="Application">BambuStudio-…</metadata> do modelo
      const fimTexto = pularAte(bytes, i, 60);
      metadados.push([atr.name, desfazerEntidades(textoDe(bytes, i, fimTexto))]);
      i = fimTexto;
    } else if (nome === 'object') {
      if (obj) finalizarObjeto(obj);
      obj = {
        id: atr.id,
        nome: atr.name ? desfazerEntidades(atr.name) : '',
        tipo: atr.type || 'model',
        _pos: null,
        _idx: null,
        _ext: null,
        _extIni: null,
        posicoes: null,
        indices: null,
        extras: null,
        extrasIni: null,
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
      itens.push({
        id: atr.objectid,
        caminho: atr.path ? normalizarCaminho(atr.path) : null,
        matriz: lerMatriz(atr.transform, escala),
        imprimivel: atr.printable !== '0',
      });
    }
    if (aoProgresso && i >= proximo) {
      aoProgresso(i / n);
      proximo += passo;
    }
  }
  if (obj) finalizarObjeto(obj);
  if (aoProgresso) aoProgresso(1);
  return { caminho, objetos, itens, escala, metadados };
}

function finalizarObjeto(obj) {
  if (obj._pos) {
    obj.posicoes = obj._pos.final();
    obj.indices = obj._idx.final();
    if (obj._extIni) {
      obj._extIni.push1(obj._ext.tamanho);
      obj.extrasIni = obj._extIni.final();
      obj.extras = obj._ext.final();
    }
  }
  obj._pos = obj._idx = obj._ext = obj._extIni = null;
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

// Atributos de triângulo guardados como vieram (pintura de cor, suporte e costura).
// Os do PrusaSlicer ganham o nome do Bambu (o conteúdo usa o mesmo formato).
const ATRIBUTOS_GUARDADOS = new Map([
  ['paint_color', 'paint_color'],
  ['paint_supports', 'paint_supports'],
  ['paint_seam', 'paint_seam'],
  ['mmu_segmentation', 'paint_color'],
  ['custom_supports', 'paint_supports'],
  ['custom_seam', 'paint_seam'],
]);
const BYTES_ATRIBUTO = new Map([...new Set(ATRIBUTOS_GUARDADOS.values())].map((n) => [n, Uint8Array.from(codigos(` ${n}="`))]));
// Atributos de triângulo que o app não guarda: vértices e cores/materiais do 3MF padrão.
const IGNORADOS = new Set(['v1', 'v2', 'v3', 'pid', 'p1', 'p2', 'p3']);

/** <triangle v1=".." v2=".." v3=".." [paint_color=".."]/> sem criar objetos. */
function lerTriangulo(bytes, i, fim, obj) {
  const n = bytes.length;
  let a = 0, b = 0, c3 = 0;
  let pintado = false;
  const temMalha = obj && obj._idx;
  let registrado = false;
  for (;;) {
    while (i < n && ehEspaco(bytes[i])) i++;
    const c = bytes[i];
    if (i >= n || c === 62) { i++; break; }
    if (c === 47) { i++; continue; }
    let ini = i;
    while (i < n && bytes[i] !== 61 && !ehEspaco(bytes[i]) && bytes[i] !== 62) {
      if (bytes[i] === 58 /* : */) ini = i + 1;
      i++;
    }
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
    } else if (temMalha && bytes[i] !== aspas) {
      const vIni = i;
      while (i < n && bytes[i] !== aspas) i++;
      const nomeAtr = textoDe(bytes, ini, ini + len);
      const alvo = ATRIBUTOS_GUARDADOS.get(nomeAtr);
      if (alvo) {
        if (!registrado) { registrarExtras(obj); registrado = true; }
        const ext = obj._ext;
        const cab = BYTES_ATRIBUTO.get(alvo);
        ext.garantir(ext.tamanho + cab.length + (i - vIni) + 1);
        ext.dados.set(cab, ext.tamanho);
        ext.dados.set(bytes.subarray(vIni, i), ext.tamanho + cab.length);
        ext.tamanho += cab.length + (i - vIni);
        ext.dados[ext.tamanho++] = 34; // "
        if (alvo === 'paint_color') pintado = true;
      } else if (!IGNORADOS.has(nomeAtr)) {
        // atributo desconhecido: ignorado (não sabemos se o Bambu entenderia)
      }
    }
    while (i < n && bytes[i] !== aspas) i++;
    i++;
  }
  if (temMalha) {
    if (obj._extIni && !registrado) obj._extIni.push1(obj._ext.tamanho);
    obj._idx.push3(a, b, c3);
    if (pintado) obj.pintados++;
  }
  return i;
}

/**
 * Marca onde começam os atributos guardados deste triângulo. Na primeira vez
 * cria a lista (os triângulos anteriores ficam sem nada).
 */
function registrarExtras(obj) {
  if (!obj._extIni) {
    const tri = obj._idx.tamanho / 3;
    obj._ext = new ArrayCrescente(Uint8Array, 1 << 16);
    obj._extIni = new ArrayCrescente(Uint32Array, Math.max(1024, tri * 2));
    obj._extIni.garantir(tri);
    obj._extIni.dados.fill(0, 0, tri);
    obj._extIni.tamanho = tri;
  }
  obj._extIni.push1(obj._ext.tamanho);
}
