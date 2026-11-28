// Etapa 1.2 — 3MF ida e volta: ler objetos, partes, filamentos, placas e pintura,
// gravar no formato do Bambu Studio e reler sem perder nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { ler3mf } from '../../js/io/3mf.js';
import { gravar3mf, inverter, matriz4x4 } from '../../js/io/3mf-gravar.js';
import { GravadorZip, crc32 } from '../../js/io/zip-gravar.js';
import { EscritorBytes } from '../../js/io/texto.js';
import { lerXml, filhos } from '../../js/io/xml-simples.js';
import { lerStl } from '../../js/io/stl.js';
import { trocarFilamento, todasAsPartes, filamentoDaParte, aparenciaDasPartes } from '../../js/core/projeto.js';
import { caixaDaMalha } from '../../js/core/malha.js';
import { multiplicar } from '../../js/io/3mf.js';
import { nibblesParaTexto } from '../../js/io/pintura-bambu.js';
import { bambuProjeto3mf, PINTURAS_EXEMPLO, stlBinario, esfera } from '../gerar-modelos.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELOS = join(RAIZ, 'testes', 'modelos');

/** Grava e devolve o .3mf inteiro (Buffer). */
async function gravar(malha, opcoes) {
  const r = await gravar3mf(malha, opcoes);
  return { buffer: Buffer.concat(r.pedacos.map((p) => Buffer.from(p.buffer, p.byteOffset, p.length))), info: r.info };
}

/** Resumo comparável do projeto (sem a geometria). */
function resumo(m) {
  return {
    objetos: m.objetos.map((o) => ({
      nome: o.nome,
      extrusora: o.extrusora,
      imprimivel: o.imprimivel,
      config: o.config,
      numTriangulos: o.numTriangulos,
      partes: o.partes.map((p) => ({ nome: p.nome, subtipo: p.subtipo, extrusora: p.extrusora, config: p.config, numTriangulos: p.numTriangulos })),
    })),
    filamentos: m.filamentos,
    placas: m.placas.map((p) => ({ id: p.id, nome: p.nome, bloqueada: p.bloqueada, objetos: p.objetos.map((i) => m.objetos[i].nome) })),
  };
}

function mesmaGeometria(a, b) {
  assert.equal(a.posicoes.length, b.posicoes.length, 'mesmo número de vértices');
  assert.equal(a.indices.length, b.indices.length, 'mesmo número de triângulos');
  let pior = 0;
  for (let i = 0; i < a.posicoes.length; i++) pior = Math.max(pior, Math.abs(a.posicoes[i] - b.posicoes[i]));
  assert.ok(pior < 1e-9, `posições iguais (diferença ${pior} mm)`);
  assert.ok(a.indices.every((v, i) => v === b.indices[i]), 'triângulos iguais, na mesma ordem');
}

function mesmaPintura(a, b) {
  for (const [campo, dados] of [['pinturaOutros', 'atributos'], ['pinturaCor', 'codigos']]) {
    assert.equal(!!a[campo], !!b[campo], campo);
    if (!a[campo]) continue;
    assert.equal(Buffer.compare(Buffer.from(a[campo][dados]), Buffer.from(b[campo][dados])), 0, `${campo} idêntica`);
    assert.ok(a[campo].inicio.every((v, i) => v === b[campo].inicio[i]), `${campo} no mesmo triângulo`);
  }
}

/** Toda aresta aparece exatamente 2 vezes em cada parte (malha fechada). */
function arestasAbertas(m, parte) {
  const cont = new Map();
  for (let t = parte.primeiroTriangulo * 3; t < (parte.primeiroTriangulo + parte.numTriangulos) * 3; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = m.indices[t + k], b = m.indices[t + ((k + 1) % 3)];
      const ch = a < b ? `${a}-${b}` : `${b}-${a}`;
      cont.set(ch, (cont.get(ch) || 0) + 1);
    }
  }
  let abertas = 0;
  for (const v of cont.values()) if (v !== 2) abertas++;
  return abertas;
}

test('lê o projeto do Bambu: objetos, partes, filamentos, placas e pintura', async () => {
  const m = await ler3mf(await bambuProjeto3mf(), JSZip);
  const r = resumo(m);
  assert.deepEqual(r.objetos.map((o) => o.nome), ['Boneco & olho', 'Peça espelhada', 'Peça espelhada', 'Etiqueta']);
  assert.deepEqual(r.objetos[0].partes.map((p) => [p.nome, p.subtipo, p.extrusora]), [
    ['Corpo', 'normal_part', 1], ['Olho', 'normal_part', 3], ['Reforço', 'modifier_part', null],
  ]);
  assert.deepEqual(r.objetos[0].config, [['brim_type', 'outer_only']]);
  assert.deepEqual(r.objetos[0].partes[2].config, [['wall_loops', '4']]);
  assert.equal(filamentoDaParte(m.objetos[0].partes[2], m.objetos[0]), 1, 'modificador sem filamento usa o do objeto');
  assert.equal(m.objetos[1].extrusora, 2);
  assert.equal(m.objetos[3].imprimivel, false, 'item com printable="0"');
  assert.deepEqual(m.filamentos.map((f) => [f.cor, f.tipo]), [['#1A1A1A', 'PLA'], ['#1B2A6B', 'PLA'], ['#D9C49A', 'PETG'], ['#FFFFFF', 'PLA']]);
  assert.deepEqual(r.placas, [
    { id: 1, nome: 'Frente', bloqueada: false, objetos: ['Boneco & olho', 'Etiqueta'] },
    { id: 2, nome: '', bloqueada: true, objetos: ['Peça espelhada', 'Peça espelhada'] },
  ]);
  // pintura: 7 dos 12 triângulos do corpo + 6 da peça espelhada (×2 instâncias)
  assert.equal(PINTURAS_EXEMPLO.length, 5);
  assert.equal(m.trianguloPintados, 7 + 6 * 2);
  const t1 = m.objetos[0].partes[0].primeiroTriangulo + 1;
  const cor = (t) => nibblesParaTexto(m.pinturaCor.codigos, m.pinturaCor.inicio[t], m.pinturaCor.inicio[t + 1]);
  const outros = (t) => Buffer.from(m.pinturaOutros.atributos.subarray(m.pinturaOutros.inicio[t], m.pinturaOutros.inicio[t + 1])).toString();
  assert.equal(cor(t1), '4');
  assert.equal(cor(t1 + 1), '0C');
  assert.equal(outros(t1 + 1), ' paint_supports="8"');
  assert.equal(cor(t1 + 2), '40C03C3');
  assert.equal(cor(t1 - 1), '');
  assert.equal(outros(t1 - 1), '');
  // arquivos guardados e descartados
  const extras = m.arquivo3mf.extras.map((e) => e.caminho).sort();
  assert.deepEqual(extras, ['Metadata/custom_gcode_per_layer.xml', 'Metadata/layer_config_ranges.xml', 'Metadata/plate_1.png', 'Metadata/project_settings.config']);
  assert.equal(m.arquivo3mf.ordemPreservada, false, 'há instâncias repetidas');
  // o olho subiu 10 mm (componente) e o boneco está em (128, 128)
  const olho = m.objetos[0].partes[1];
  let zMax = -Infinity;
  for (let t = olho.primeiroTriangulo * 3; t < (olho.primeiroTriangulo + olho.numTriangulos) * 3; t++) zMax = Math.max(zMax, m.posicoes[m.indices[t] * 3 + 2]);
  assert.ok(Math.abs(zMax - 13) < 1e-6);
});

test('ida e volta do projeto: tudo igual depois de gravar e reler', async () => {
  const original = await ler3mf(await bambuProjeto3mf(), JSZip);
  const { buffer } = await gravar(original);
  const volta = await ler3mf(buffer, JSZip);
  assert.deepEqual(resumo(volta), resumo(original));
  mesmaGeometria(original, volta);
  mesmaPintura(original, volta);
  for (const { parte } of todasAsPartes(volta)) assert.equal(arestasAbertas(volta, parte), 0, `${parte.nome} fechada`);

  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const nomes = Object.keys(zip.files).sort();
  assert.deepEqual(nomes, [
    '3D/3dmodel.model',
    'Metadata/custom_gcode_per_layer.xml',
    'Metadata/model_settings.config',
    'Metadata/plate_1.png',
    'Metadata/project_settings.config',
    '[Content_Types].xml',
    '_rels/.rels',
  ], 'G-code, slice_info e layer_config_ranges (ordem mudou) ficam de fora');
  const ler = (c) => zip.file(c).async('nodebuffer');
  const zipOriginal = await JSZip.loadAsync(await bambuProjeto3mf());
  for (const c of ['Metadata/project_settings.config', 'Metadata/plate_1.png', 'Metadata/custom_gcode_per_layer.xml']) {
    assert.equal(Buffer.compare(await ler(c), await zipOriginal.file(c).async('nodebuffer')), 0, `${c} igual ao original`);
  }

  // model_settings.config: ids batem com o 3dmodel.model; ajustes da placa sem o G-code
  const cfg = lerXml(await zip.file('Metadata/model_settings.config').async('string'));
  const raiz = filhos(cfg, 'config')[0];
  const modelo = await zip.file('3D/3dmodel.model').async('string');
  assert.match(modelo, /<metadata name="Application">BambuStudio-02\.08\.02\.61<\/metadata>/);
  assert.match(modelo, /<metadata name="Title">Projeto de teste<\/metadata>/);
  for (const o of filhos(raiz, 'object')) {
    assert.match(modelo, new RegExp(`<object id="${o.atr.id}" type="model"[^>]*>\\s*<components>`), `objeto ${o.atr.id} no modelo`);
    for (const p of filhos(o, 'part')) assert.match(modelo, new RegExp(`<object id="${p.atr.id}" type="model">\\s*<mesh>`), `parte ${p.atr.id} no modelo`);
  }
  const placa1 = filhos(raiz, 'plate')[0];
  const chaves = filhos(placa1, 'metadata').map((x) => x.atr.key);
  assert.ok(chaves.includes('first_layer_print_sequence'));
  assert.ok(chaves.includes('thumbnail_file'));
  assert.ok(!chaves.includes('gcode_file'), 'o G-code velho não vai junto');
  const olho = filhos(filhos(raiz, 'object')[0], 'part')[1];
  assert.equal(filhos(olho, 'metadata').find((x) => x.atr.key === 'matrix').atr.value, '1 0 0 5 0 1 0 0 0 0 1 10 0 0 0 1');
  const reforco = filhos(filhos(raiz, 'object')[0], 'part')[2];
  assert.ok(!filhos(reforco, 'metadata').some((x) => x.atr.key === 'extruder'), 'modificador continua sem filamento próprio');
  assert.match(modelo, /transform="0 -1 0 -1 0 0 0 0 1 435\.25 120\.125 0" printable="1"/);
  assert.match(modelo, /printable="0"/);
  const rels = await zip.file('_rels/.rels').async('string');
  assert.match(rels, /Target="\/Metadata\/plate_1\.png"/);

  // gravar de novo o que foi relido dá o mesmo arquivo (estável)
  const { buffer: denovo } = await gravar(volta);
  const z2 = await JSZip.loadAsync(denovo);
  assert.equal(await z2.file('3D/3dmodel.model').async('string'), modelo);
});

test('peça espelhada volta com a ordem original dos triângulos (por causa da pintura)', async () => {
  const original = await ler3mf(await bambuProjeto3mf(), JSZip);
  const { buffer } = await gravar(original);
  const modelo = await (await JSZip.loadAsync(buffer)).file('3D/3dmodel.model').async('string');
  const fonte = await (await JSZip.loadAsync(await bambuProjeto3mf())).file('3D/Objects/object_1.model').async('string');
  const triangulos = (xml, n) => {
    const objetos = xml.split('<object id=').slice(1);
    return [...objetos[n].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((x) => x.slice(1).join(' '));
  };
  // na fonte a peça espelhada é o 4º objeto; na saída, depois das 3 partes + objeto do boneco
  assert.deepEqual(triangulos(modelo, 4), triangulos(fonte, 3));
  // e a normal na malha do app aponta para fora (ordem invertida na leitura)
  const p = original.objetos[1].partes[0];
  const c = caixaDaMalha(original);
  assert.ok(c.tamanho[0] > 0);
  assert.ok(p.numTriangulos === 12);
});

test('trocar o filamento de uma parte vai para o arquivo', async () => {
  const m = await ler3mf(await bambuProjeto3mf(), JSZip);
  trocarFilamento(m, 0, 1, 4); // olho do boneco: 3 -> 4
  trocarFilamento(m, 1, 0, 3); // peça espelhada (uma parte só): o objeto acompanha
  assert.equal(m.objetos[1].extrusora, 3);
  assert.equal(m.objetos[0].extrusora, 1, 'objeto com várias partes não muda');
  assert.throws(() => trocarFilamento(m, 0, 0, 0));
  assert.equal(aparenciaDasPartes(m)[1].cor, '#FFFFFF');
  assert.equal(aparenciaDasPartes(m)[2].fantasma, true, 'modificador aparece transparente');
  const volta = await ler3mf((await gravar(m)).buffer, JSZip);
  assert.equal(volta.objetos[0].partes[1].extrusora, 4);
  assert.equal(filamentoDaParte(volta.objetos[1].partes[0], volta.objetos[1]), 3);
  assert.equal(volta.objetos[1].extrusora, 3);
  assert.equal(volta.objetos[2].extrusora, 2, 'a outra instância não mudou');
});

test('STL exportado: um objeto no centro da placa da A1, apoiado na mesa, com miniatura', async () => {
  const e = esfera(15, 24, 48, [-40, 300, 7]); // longe da placa e afundada
  const m = lerStl(stlBinario(e));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const { buffer } = await gravar(m, { miniatura: png });
  const volta = await ler3mf(buffer, JSZip);
  assert.equal(volta.objetos.length, 1);
  assert.equal(volta.objetos[0].partes[0].extrusora, 1);
  assert.equal(volta.placas.length, 1);
  assert.deepEqual(volta.placas[0].objetos, [0]);
  const c = caixaDaMalha(volta);
  assert.ok(Math.abs(c.centro[0] - 128) < 1e-4 && Math.abs(c.centro[1] - 128) < 1e-4, `centro ${c.centro}`);
  assert.ok(Math.abs(c.min[2]) < 1e-4, 'apoiada na mesa');
  // forma igual: mesmos tamanhos e mesma topologia
  const c0 = caixaDaMalha(m);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(c.tamanho[k] - c0.tamanho[k]) < 1e-4);
  assert.ok(volta.indices.every((v, i) => v === m.indices[i]));
  const zip = await JSZip.loadAsync(buffer);
  assert.deepEqual([...(await zip.file('Metadata/plate_1.png').async('uint8array'))], [...png]);
  assert.ok(!zip.file('Metadata/project_settings.config'), 'sem configurações inventadas: o Bambu usa as dele');
  // a origem do objeto fica no centro dele (o Bambu gira e escala em volta da origem)
  const modelo = await zip.file('3D/3dmodel.model').async('string');
  assert.match(modelo, /<item objectid="2" transform="1 0 0 0 1 0 0 0 1 128 128 0" printable="1"\/>/);
});

test('coordenadas: o Bambu lê exatamente o mesmo número (precisão simples) e sem casas sobrando', () => {
  const pedacos = [];
  const w = new EscritorBytes((p) => pedacos.push(Buffer.from(p)), 64);
  const valores = [0, -0, 12.11, -30.34945, 94.5127, 1e-7, -2.5e-5, 255.99999, 1234567.89, 0.1 + 0.2, Math.PI, -470.3899 + 1e-12];
  for (const v of valores) { w.coordenada(v); w.texto(' '); }
  w.fechar();
  const saida = Buffer.concat(pedacos).toString().trim().split(' ');
  assert.equal(saida[0], '0');
  assert.equal(saida[1], '0');
  assert.equal(saida[2], '12.11');
  assert.equal(saida[3], '-30.34945');
  assert.equal(saida[4], '94.5127');
  assert.equal(saida[9], '0.3');
  assert.equal(saida[11], '-470.3899');
  valores.forEach((v, i) => assert.ok(Math.fround(Number(saida[i])) === Math.fround(v), `${v} -> ${saida[i]}`));
  // aleatórios
  let semente = 7;
  const aleatorio = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
  const lista = Array.from({ length: 5000 }, () => (aleatorio() - 0.5) * 10 ** Math.floor(aleatorio() * 7 - 2));
  const p2 = [];
  const w2 = new EscritorBytes((p) => p2.push(Buffer.from(p)), 256);
  for (const v of lista) { w2.coordenada(v); w2.texto(' '); }
  w2.fechar();
  Buffer.concat(p2).toString().trim().split(' ').forEach((s, i) => assert.ok(Math.fround(Number(s)) === Math.fround(lista[i]), s));
});

test('inteiros e texto acentuado no escritor de bytes', () => {
  const pedacos = [];
  const w = new EscritorBytes((p) => pedacos.push(Buffer.from(p)), 16);
  for (const n of [0, 7, 10, 4294967295, 1234567]) { w.inteiro(n); w.texto(','); }
  w.texto('Tênis & ção');
  w.fechar();
  assert.equal(Buffer.concat(pedacos).toString(), '0,7,10,4294967295,1234567,Tênis & ção');
});

test('ZIP gravado aos pedaços abre no JSZip com CRC conferido', async () => {
  const z = new GravadorZip();
  const grande = new Uint8Array(3 << 20).map((_, i) => (i * 7) % 251);
  async function* pedacos() {
    for (let i = 0; i < grande.length; i += 100000) yield grande.subarray(i, i + 100000);
  }
  await z.adicionar('3D/grande.bin', pedacos());
  await z.adicionar('pasta/ção.txt', 'acentuação OK');
  await z.adicionar('img.png', new Uint8Array([1, 2, 3, 4]), { comprimir: false });
  await z.adicionar('vazio.txt', '');
  const buf = Buffer.concat(z.finalizar());
  const zip = await JSZip.loadAsync(buf, { checkCRC32: true });
  assert.deepEqual(Buffer.compare(await zip.file('3D/grande.bin').async('nodebuffer'), Buffer.from(grande)), 0);
  assert.equal(await zip.file('pasta/ção.txt').async('string'), 'acentuação OK');
  assert.deepEqual([...(await zip.file('img.png').async('uint8array'))], [1, 2, 3, 4]);
  assert.equal(await zip.file('vazio.txt').async('string'), '');
  assert.ok(buf.length < grande.length / 2, 'comprimido');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('matrizes: inversa e formato 4×4 do Bambu', () => {
  const m = [0, -1, 0, 2, 0, 0, 0, 0, 0.5, 10, 20, 30];
  const id = multiplicar(m, inverter(m));
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0].forEach((v, i) => assert.ok(Math.abs(id[i] - v) < 1e-12));
  assert.equal(matriz4x4([1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 0, 10]), '1 0 0 5 0 1 0 0 0 0 1 10 0 0 0 1');
});

// ---- modelos de referência do Yuri (se estiverem em testes/modelos/) ----

for (const [arquivo, esperado] of [
  ['boneco_smile_conectores.3mf', { objetos: 16, placas: [2, 2, 12], pintados: 147643, triangulos: 552964 }],
  ['arco_rendilhado_A.3mf', { objetos: 14, placas: null, pintados: 0, triangulos: 1106162 }],
]) {
  const caminho = join(MODELOS, arquivo);
  test(`referência ${arquivo}: vai e volta igual`, { skip: !existsSync(caminho) && 'arquivo não está em testes/modelos/' }, async () => {
    const original = await ler3mf(readFileSync(caminho), JSZip);
    assert.equal(original.objetos.length, esperado.objetos);
    assert.equal(original.indices.length / 3, esperado.triangulos);
    assert.equal(original.trianguloPintados, esperado.pintados);
    assert.equal(original.filamentos.length, 4);
    if (esperado.placas) assert.deepEqual(original.placas.map((p) => p.objetos.length), esperado.placas);
    const t0 = Date.now();
    const { buffer, info } = await gravar(original);
    const ms = Date.now() - t0;
    console.log(`      ${arquivo}: gravado em ${ms} ms, ${(info.bytes / 1048576).toFixed(1)} MB (modelo ${(info.bytesModelo / 1048576).toFixed(0)} MB descompactado)`);
    const volta = await ler3mf(buffer, JSZip);
    assert.deepEqual(resumo(volta), resumo(original));
    mesmaGeometria(original, volta);
    mesmaPintura(original, volta);
    // malha tão fechada quanto a original, parte por parte
    const partesO = todasAsPartes(original), partesV = todasAsPartes(volta);
    partesO.forEach(({ parte }, k) => assert.equal(arestasAbertas(volta, partesV[k].parte), arestasAbertas(original, parte), parte.nome));
    // as configurações do projeto voltam byte a byte
    const zo = await JSZip.loadAsync(readFileSync(caminho));
    const zv = await JSZip.loadAsync(buffer);
    for (const c of ['Metadata/project_settings.config', 'Metadata/plate_1.png']) {
      assert.equal(Buffer.compare(await zo.file(c).async('nodebuffer'), await zv.file(c).async('nodebuffer')), 0, c);
    }
    // o Bambu lê as coordenadas em precisão simples: todas iguais às do original
    const vert = (xml) => xml.match(/<vertex [^>]+>/g).map((v) => [...v.matchAll(/"([^"]+)"/g)].map((x) => Math.fround(Number(x[1]))));
    const a = vert(await zo.file('3D/3dmodel.model').async('string'));
    const b = vert(await zv.file('3D/3dmodel.model').async('string'));
    assert.equal(a.length, b.length);
    let diferentes = 0;
    for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1] || a[i][2] !== b[i][2]) diferentes++;
    assert.equal(diferentes, 0, 'coordenadas iguais às do original');
  });
}
