// Gravação de 3MF no formato do Bambu Studio (projeto multipartes).
//
// O que sai:
//   3D/3dmodel.model                 malhas (uma por parte) + objetos com componentes + placa
//   Metadata/model_settings.config   nomes, filamento por objeto e por parte, ajustes, placas
//   Metadata/project_settings.config e miniaturas: copiados como vieram do arquivo aberto
//
// É o mesmo arranjo dos 3MF que já abrem no Bambu Studio do Yuri (02.08.02.61).
// Modo leve: o XML é escrito e comprimido aos pedaços, uma parte por vez; o arquivo
// descompactado nunca fica inteiro na memória.

import { BAMBU_APLICACAO, IMPRESSORA } from '../config.js';
import { IDENTIDADE } from '../core/projeto.js';
import { EscritorBytes } from './texto.js';
import { escaparXml } from './xml-simples.js';
import { GravadorZip } from './zip-gravar.js';
import { multiplicar, determinante } from './3mf.js';

const NS_3MF = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const NS_BAMBU = 'http://schemas.bambulab.com/package/2021';
const TIPO_MODELO = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const TIPO_MINIATURA = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail';

const TIPOS_CONTEUDO = {
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
  model: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  config: 'text/xml',
  xml: 'text/xml',
  json: 'application/json',
  txt: 'text/plain',
};

/**
 * Grava a malha (com objetos, partes, filamentos e placas) como 3MF do Bambu.
 * @param {object} malha
 * @param {{ miniatura?: Uint8Array, aoProgresso?: (fase:string, fracao:number)=>void }} [opcoes]
 * @returns {Promise<{ pedacos: Uint8Array[], info: object }>}  pedaços do ZIP, em ordem
 */
export async function gravar3mf(malha, { miniatura = null, aoProgresso = null } = {}) {
  const origem = malha.arquivo3mf || null;
  const plano = planejar(malha);

  // Arquivos guardados do original (configuração do projeto, miniaturas…).
  const guardados = new Map();
  for (const e of (origem && origem.extras) || []) {
    if (!origem.ordemPreservada && /layer_config_ranges\.xml$/i.test(e.caminho)) continue;
    guardados.set(e.caminho, e.bytes);
  }
  if (miniatura && !guardados.has('Metadata/plate_1.png')) guardados.set('Metadata/plate_1.png', miniatura);

  const zip = new GravadorZip();
  const nomesArquivos = ['3D/3dmodel.model', 'Metadata/model_settings.config', ...guardados.keys()];
  await zip.adicionar('[Content_Types].xml', tiposDeConteudo(nomesArquivos));
  await zip.adicionar('_rels/.rels', relacoes(origem, guardados));

  const totalTri = malha.indices.length / 3 || 1;
  let feitos = 0;
  const modelo = gerarModelo(malha, plano, origem, (n) => {
    feitos += n;
    if (aoProgresso) aoProgresso('Gravando o 3MF…', Math.min(1, feitos / totalTri));
  });
  const { tamanho: bytesModelo } = await zip.adicionar('3D/3dmodel.model', modelo);
  await zip.adicionar('Metadata/model_settings.config', configuracao(malha, plano, guardados));
  for (const [caminho, bytes] of guardados) {
    await zip.adicionar(caminho, bytes, { comprimir: !/\.(png|jpe?g)$/i.test(caminho) });
  }
  const pedacos = zip.finalizar();
  return {
    pedacos,
    info: {
      objetos: plano.objetos.length,
      partes: plano.objetos.reduce((s, o) => s + o.partes.length, 0),
      bytesModelo,
      bytes: pedacos.reduce((s, p) => s + p.length, 0),
    },
  };
}

// --- plano: ids e posições --------------------------------------------------------

function planejar(malha) {
  let id = 1;
  const semPosicao = malha.objetos.map((o, i) => (o.matriz ? -1 : i)).filter((i) => i >= 0);
  const colocacao = colocarNaPlaca(malha, semPosicao);
  const objetos = malha.objetos.map((o, io) => {
    const partes = o.partes.map((p) => ({ parte: p, id: id++ }));
    let matriz = o.matriz;
    let deslocamento = [0, 0, 0];
    if (!matriz) {
      const c = colocacao.get(io);
      matriz = [1, 0, 0, 0, 1, 0, 0, 0, 1, c.destino[0], c.destino[1], c.destino[2]];
      deslocamento = c.deslocamento;
    }
    return { objeto: o, indice: io, id: id++, matriz, deslocamento, partes };
  });
  return { objetos };
}

/**
 * Objetos sem posição de placa (vindos de STL/OBJ): o conjunto vai para o centro
 * da placa 1, apoiado na mesa, e a origem de cada objeto fica no centro dele.
 */
function colocarNaPlaca(malha, lista) {
  const r = new Map();
  if (!lista.length) return r;
  const p = malha.posicoes, idx = malha.indices;
  const caixas = new Map();
  const geral = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const io of lista) {
    const o = malha.objetos[io];
    const c = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const fim = (o.primeiroTriangulo + o.numTriangulos) * 3;
    for (let k = o.primeiroTriangulo * 3; k < fim; k++) {
      const v = idx[k] * 3;
      for (let e = 0; e < 3; e++) {
        const x = p[v + e];
        if (x < c[e]) c[e] = x;
        if (x > c[e + 3]) c[e + 3] = x;
      }
    }
    if (!Number.isFinite(c[0])) c.fill(0);
    caixas.set(io, c);
    for (let e = 0; e < 3; e++) {
      geral[e] = Math.min(geral[e], c[e]);
      geral[e + 3] = Math.max(geral[e + 3], c[e + 3]);
    }
  }
  const desloca = [
    IMPRESSORA.mesaX / 2 - (geral[0] + geral[3]) / 2,
    IMPRESSORA.mesaY / 2 - (geral[1] + geral[4]) / 2,
    -geral[2],
  ];
  for (const io of lista) {
    const c = caixas.get(io);
    const origem = [(c[0] + c[3]) / 2, (c[1] + c[4]) / 2, c[2]];
    r.set(io, {
      destino: [origem[0] + desloca[0], origem[1] + desloca[1], origem[2] + desloca[2]],
      deslocamento: desloca,
    });
  }
  return r;
}

/** Inversa de uma transformação 3MF (vetor linha): devolve 12 números. */
export function inverter(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = determinante(m);
  if (!det || !Number.isFinite(det)) throw new Error('Uma peça tem transformação inválida (escala zero).');
  const k = 1 / det;
  const r = [
    (e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k,
    (f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k,
    (d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k,
    0, 0, 0,
  ];
  const [tx, ty, tz] = [m[9], m[10], m[11]];
  r[9] = -(tx * r[0] + ty * r[3] + tz * r[6]);
  r[10] = -(tx * r[1] + ty * r[4] + tz * r[7]);
  r[11] = -(tx * r[2] + ty * r[5] + tz * r[8]);
  return r;
}

// --- 3D/3dmodel.model ---------------------------------------------------------------

function* gerarModelo(malha, plano, origem, aoTriangulos) {
  const fila = [];
  const w = new EscritorBytes((pedaco) => fila.push(pedaco));
  const pos = malha.posicoes, idx = malha.indices;
  const pintura = malha.pintura;
  let mapa = null; // vértice da malha -> vértice da parte (só quando a parte não tem faixa própria)

  w.texto(`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="${NS_3MF}" xmlns:BambuStudio="${NS_BAMBU}">\n`);
  const aplicacao = origem && /^BambuStudio-/.test(origem.aplicacao) ? origem.aplicacao : BAMBU_APLICACAO;
  w.texto(` <metadata name="Application">${escaparXml(aplicacao)}</metadata>\n`);
  w.texto(' <metadata name="BambuStudio:3mfVersion">1</metadata>\n');
  for (const [nome, valor] of (origem && origem.metadados) || []) {
    if (nome === 'Application' || nome === 'BambuStudio:3mfVersion') continue;
    if (nome.includes(':') && !nome.startsWith('BambuStudio:')) continue; // namespace que não declaramos
    w.texto(` <metadata name="${escaparXml(nome)}">${escaparXml(valor)}</metadata>\n`);
  }
  w.texto(' <resources>\n');
  yield* fila.splice(0);

  for (const ob of plano.objetos) {
    for (const { parte, id } of ob.partes) {
      const total = multiplicar(parte.matriz || IDENTIDADE, ob.matriz);
      const inv = inverter(total);
      const espelhado = determinante(total) < 0;
      const [dx, dy, dz] = ob.deslocamento;
      const t0 = parte.primeiroTriangulo * 3, t1 = (parte.primeiroTriangulo + parte.numTriangulos) * 3;

      // Faixa de vértices da parte: mantém a mesma ordem do arquivo original.
      let usarFaixa = parte.numVertices > 0;
      const v0 = parte.primeiroVertice | 0, v1 = v0 + (parte.numVertices | 0);
      if (usarFaixa) {
        for (let k = t0; k < t1; k++) if (idx[k] < v0 || idx[k] >= v1) { usarFaixa = false; break; }
      }
      let lista; // vértices da malha usados por esta parte, em ordem
      if (usarFaixa) {
        lista = null;
      } else {
        if (!mapa) mapa = new Int32Array(pos.length / 3).fill(-1);
        const usados = [];
        for (let k = t0; k < t1; k++) {
          const v = idx[k];
          if (mapa[v] === -1) { mapa[v] = usados.length; usados.push(v); }
        }
        lista = usados;
      }

      w.texto(`  <object id="${id}" type="model">\n   <mesh>\n    <vertices>\n`);
      const nVert = lista ? lista.length : v1 - v0;
      for (let k = 0; k < nVert; k++) {
        const v = (lista ? lista[k] : v0 + k) * 3;
        const x = pos[v] + dx, y = pos[v + 1] + dy, z = pos[v + 2] + dz;
        w.espaco(96);
        w.texto('     <vertex x="');
        w.coordenada(x * inv[0] + y * inv[3] + z * inv[6] + inv[9]);
        w.texto('" y="');
        w.coordenada(x * inv[1] + y * inv[4] + z * inv[7] + inv[10]);
        w.texto('" z="');
        w.coordenada(x * inv[2] + y * inv[5] + z * inv[8] + inv[11]);
        w.texto('"/>\n');
        if (fila.length) yield* fila.splice(0);
      }
      w.texto('    </vertices>\n    <triangles>\n');
      const base = usarFaixa ? v0 : 0;
      let contados = 0;
      for (let k = t0; k < t1; k += 3) {
        let a = idx[k], b = idx[k + 1], c = idx[k + 2];
        if (lista) { a = mapa[a]; b = mapa[b]; c = mapa[c]; } else { a -= base; b -= base; c -= base; }
        // a leitura inverteu a ordem das peças espelhadas; aqui volta ao original
        if (espelhado) { const tmp = b; b = c; c = tmp; }
        w.texto('     <triangle v1="');
        w.inteiro(a);
        w.texto('" v2="');
        w.inteiro(b);
        w.texto('" v3="');
        w.inteiro(c);
        w.texto('"');
        if (pintura) {
          const t = k / 3;
          const i0 = pintura.inicio[t], i1 = pintura.inicio[t + 1];
          if (i1 > i0) w.bytes(pintura.atributos.subarray(i0, i1));
        }
        w.texto('/>\n');
        if (++contados === 65536) { aoTriangulos(contados); contados = 0; }
        if (fila.length) yield* fila.splice(0);
      }
      aoTriangulos(contados);
      w.texto('    </triangles>\n   </mesh>\n  </object>\n');
      if (lista) for (const v of lista) mapa[v] = -1;
      lista = null;
    }
    // O objeto: junta as partes como componentes.
    w.texto(`  <object id="${ob.id}" type="model"${ob.objeto.nome ? ` name="${escaparXml(ob.objeto.nome)}"` : ''}>\n   <components>\n`);
    for (const { parte, id } of ob.partes) {
      w.texto(`    <component objectid="${id}" transform="${textoMatriz(parte.matriz || IDENTIDADE)}"/>\n`);
    }
    w.texto('   </components>\n  </object>\n');
    yield* fila.splice(0);
  }

  w.texto(' </resources>\n <build>\n');
  for (const ob of plano.objetos) {
    w.texto(`  <item objectid="${ob.id}" transform="${textoMatriz(ob.matriz)}" printable="${ob.objeto.imprimivel === false ? 0 : 1}"/>\n`);
  }
  w.texto(' </build>\n</model>\n');
  w.fechar();
  yield* fila.splice(0);
}

/** 12 números da transformação 3MF, com até 6 casas. */
export function textoMatriz(m) {
  return m.map(numeroCurto).join(' ');
}

function numeroCurto(v) {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * Matriz da parte no model_settings.config: 4×4 por linhas, coluna de translação
 * à direita (o jeito do Bambu Studio), a partir da transformação 3MF (vetor linha).
 */
export function matriz4x4(m) {
  const v = [m[0], m[3], m[6], m[9], m[1], m[4], m[7], m[10], m[2], m[5], m[8], m[11], 0, 0, 0, 1];
  return v.map(numeroCurto).join(' ');
}

// --- Metadata/model_settings.config ----------------------------------------------------

function configuracao(malha, plano, guardados) {
  const linhas = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>'];
  const meta = (k, v, recuo) => `${recuo}<metadata key="${escaparXml(k)}" value="${escaparXml(v)}"/>`;
  for (const ob of plano.objetos) {
    const o = ob.objeto;
    linhas.push(`  <object id="${ob.id}">`);
    linhas.push(meta('name', o.nome || `Objeto ${ob.indice + 1}`, '    '));
    linhas.push(meta('extruder', String(o.extrusora > 0 ? o.extrusora : 1), '    '));
    for (const [k, v] of o.config || []) linhas.push(meta(k, v, '    '));
    for (const { parte, id } of ob.partes) {
      linhas.push(`    <part id="${id}" subtype="${escaparXml(parte.subtipo || 'normal_part')}">`);
      linhas.push(meta('name', parte.nome || o.nome || 'Parte', '      '));
      linhas.push(meta('matrix', matriz4x4(parte.matriz || IDENTIDADE), '      '));
      if (parte.extrusora != null) linhas.push(meta('extruder', String(parte.extrusora), '      '));
      for (const [k, v] of parte.config || []) linhas.push(meta(k, v, '      '));
      linhas.push('    </part>');
    }
    linhas.push('  </object>');
  }
  const novoId = new Map(plano.objetos.map((ob) => [ob.indice, ob.id]));
  let identificador = 100;
  (malha.placas || []).forEach((pl, ip) => {
    linhas.push('  <plate>');
    linhas.push(meta('plater_id', String(pl.id || ip + 1), '    '));
    linhas.push(meta('plater_name', pl.nome || '', '    '));
    linhas.push(meta('locked', pl.bloqueada ? 'true' : 'false', '    '));
    let temMiniatura = false;
    for (const [k, v] of pl.config || []) {
      // Ajustes que apontam para arquivos que não foram junto (G-code, prévias) ficam de fora.
      if (/^Metadata\//.test(v) && !guardados.has(v)) continue;
      if (k === 'thumbnail_file') temMiniatura = true;
      linhas.push(meta(k, v, '    '));
    }
    const mini = `Metadata/plate_${pl.id || ip + 1}.png`;
    if (!temMiniatura && guardados.has(mini)) linhas.push(meta('thumbnail_file', mini, '    '));
    for (const io of pl.objetos) {
      if (!novoId.has(io)) continue;
      linhas.push('    <model_instance>');
      linhas.push(meta('object_id', String(novoId.get(io)), '      '));
      linhas.push(meta('instance_id', '0', '      '));
      linhas.push(meta('identify_id', String(identificador++), '      '));
      linhas.push('    </model_instance>');
    }
    linhas.push('  </plate>');
  });
  linhas.push('  <assemble>');
  for (const ob of plano.objetos) {
    const montagem = ob.objeto.montagem;
    const desloc = montagem && montagem.offset ? montagem.offset : '0 0 0';
    linhas.push(`   <assemble_item object_id="${ob.id}" instance_id="0" transform="${textoMatriz(ob.matriz)}" offset="${escaparXml(desloc)}"/>`);
  }
  linhas.push('  </assemble>');
  linhas.push('</config>');
  return linhas.join('\n') + '\n';
}

// --- pacote (tipos de conteúdo e relações) -------------------------------------------

function tiposDeConteudo(caminhos) {
  const exts = new Set(['rels', 'model']);
  for (const c of caminhos) {
    const m = /\.([a-z0-9]+)$/i.exec(c);
    if (m) exts.add(m[1].toLowerCase());
  }
  const linhas = [...exts].map((e) => `<Default Extension="${e}" ContentType="${TIPOS_CONTEUDO[e] || 'application/octet-stream'}"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${linhas.join('')}</Types>\n`;
}

function relacoes(origem, guardados) {
  const rels = [{ alvo: '/3D/3dmodel.model', tipo: TIPO_MODELO }];
  for (const r of (origem && origem.relacoes) || []) {
    if (r.tipo === TIPO_MODELO) continue;
    if (guardados.has(r.alvo.replace(/^\/+/, ''))) rels.push(r);
  }
  if (guardados.has('Metadata/plate_1.png') && !rels.some((r) => r.tipo === TIPO_MINIATURA)) {
    rels.push({ alvo: '/Metadata/plate_1.png', tipo: TIPO_MINIATURA });
  }
  const linhas = rels.map((r, i) => `<Relationship Target="${escaparXml(r.alvo)}" Id="rel-${i + 1}" Type="${escaparXml(r.tipo)}"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${linhas.join('')}</Relationships>\n`;
}
