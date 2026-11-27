// Testes dos leitores de STL, OBJ e 3MF e da estimativa pelo índice do ZIP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { lerStl, ehStlBinario } from '../../js/io/stl.js';
import { lerObj } from '../../js/io/obj.js';
import { ler3mf, multiplicar } from '../../js/io/3mf.js';
import { listarZip } from '../../js/io/zip-indice.js';
import { caixaDaMalha, numVertices, numTriangulos } from '../../js/core/malha.js';
import { lerNumero } from '../../js/io/texto.js';
import { esfera, cubo, stlBinario, stlTexto, objCubos, bambu3mf } from '../gerar-modelos.mjs';

const perto = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('números lidos dos bytes', () => {
  const casos = ['0', '-1.5', '3.14159', '1e3', '-2.5E-2', '+7', '0.000123', '123456789.125', '.5'];
  for (const c of casos) {
    const b = new TextEncoder().encode(c + ' ');
    const fim = { i: 0 };
    perto(lerNumero(b, 0, fim), Number(c), Math.abs(Number(c)) * 1e-12 + 1e-12);
    assert.equal(fim.i, c.length);
  }
});

test('STL binário: esfera soldada e fechada', () => {
  const e = esfera(20, 16, 32);
  const m = lerStl(stlBinario(e));
  assert.equal(numTriangulos(m), e.indices.length / 3);
  assert.equal(numVertices(m), e.posicoes.length / 3, 'vértices repetidos devem ser soldados');
  const c = caixaDaMalha(m);
  perto(c.tamanho[2], 40);
  perto(c.min[2], 0);
  // malha fechada: toda aresta aparece exatamente 2 vezes
  const arestas = new Map();
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = m.indices[t + k], b = m.indices[t + ((k + 1) % 3)];
      const chave = a < b ? `${a}-${b}` : `${b}-${a}`;
      arestas.set(chave, (arestas.get(chave) || 0) + 1);
    }
  }
  for (const v of arestas.values()) assert.equal(v, 2);
});

test('STL em texto: cubo de 10 mm', () => {
  const texto = new TextEncoder().encode(stlTexto(cubo(10), 'meu cubo'));
  assert.equal(ehStlBinario(texto), false);
  const m = lerStl(texto);
  assert.equal(numTriangulos(m), 12);
  assert.equal(numVertices(m), 8);
  assert.equal(m.objetos[0].nome, 'meu cubo');
  assert.deepEqual(caixaDaMalha(m).tamanho, [10, 10, 10]);
});

test('STL binário com cabeçalho "solid" continua binário', () => {
  const b = stlBinario(cubo(10));
  b.write('solid enganador', 0);
  assert.equal(ehStlBinario(new Uint8Array(b)), true);
  assert.equal(numTriangulos(lerStl(b)), 12);
});

test('OBJ: quadriláteros, objetos e índices negativos', () => {
  const m = lerObj(new TextEncoder().encode(objCubos()));
  assert.equal(numTriangulos(m), 24);
  assert.equal(numVertices(m), 16);
  assert.deepEqual(m.objetos.map((o) => [o.nome, o.numTriangulos]), [['Cubo grande', 12], ['Cubo pequeno', 12]]);
  const c = caixaDaMalha(m);
  assert.deepEqual(c.tamanho, [25, 10, 10]);
  assert.deepEqual(m.avisos, []);
});

test('3MF estilo Bambu: componentes, transformações, espelho, nomes e pintura', async () => {
  const buf = await bambu3mf();
  const m = await ler3mf(buf, JSZip);
  const olho = esfera(3, 8, 12, [0, 0, 0]);
  const triOlho = olho.indices.length / 3;
  assert.equal(numTriangulos(m), 12 + triOlho + 1);
  assert.equal(m.objetos.length, 2);
  assert.equal(m.objetos[0].nome, 'Boneco & olho');
  assert.equal(m.objetos[0].numTriangulos, 12 + triOlho);
  assert.equal(m.objetos[1].nome, 'Peça espelhada');
  assert.equal(m.trianguloPintados, 6);
  assert.ok(m.avisos.some((a) => a.includes('1.3')));
  // o cubo foi para (128,128) na placa
  const corpo = m.indices.subarray(0, 36);
  let minX = Infinity;
  for (const v of corpo) minX = Math.min(minX, m.posicoes[v * 3]);
  perto(minX, 128);
  // o olho subiu 10 mm e andou 5 mm em X além da placa
  let maxZOlho = -Infinity;
  for (const v of m.indices.subarray(36, 36 + triOlho * 3)) maxZOlho = Math.max(maxZOlho, m.posicoes[v * 3 + 2]);
  perto(maxZOlho, 13);
  // a peça espelhada inverteu a ordem do triângulo para a normal continuar para fora
  const ult = m.indices.subarray(m.indices.length - 3);
  const p = (v) => [m.posicoes[v * 3], m.posicoes[v * 3 + 1], m.posicoes[v * 3 + 2]];
  const [a, b, c] = ult.map ? Array.from(ult).map(p) : [];
  const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  assert.ok(nz > 0, 'normal do triângulo espelhado deve apontar para +Z');
});

test('3MF: unidade em centímetros vira mm', async () => {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', '<?xml version="1.0"?><model unit="centimeter"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="2" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 1 0 0"/></build></model>');
  const m = await ler3mf(await zip.generateAsync({ type: 'uint8array' }), JSZip);
  const c = caixaDaMalha(m);
  assert.deepEqual(c.tamanho, [10, 20, 0]);
  assert.deepEqual(c.min, [10, 0, 0]);
});

test('transformações 3MF compõem na ordem certa', () => {
  const desloca = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0];
  const gira90 = [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0]; // x -> y
  const m = multiplicar(desloca, gira90); // primeiro desloca, depois gira
  // ponto (0,0,0) -> (10,0,0) -> (0,10,0)
  assert.deepEqual([m[9], m[10], m[11]].map((v) => Math.round(v)), [0, 10, 0]);
});

test('índice do ZIP dá o tamanho descompactado do modelo', async () => {
  const buf = await bambu3mf();
  const lista = await listarZip(new Blob([buf]));
  const nomes = lista.map((e) => e.nome);
  assert.ok(nomes.includes('3D/3dmodel.model'));
  assert.ok(nomes.includes('3D/Objects/object_1.model'));
  const obj = lista.find((e) => e.nome === '3D/Objects/object_1.model');
  assert.ok(obj.tamanho > obj.comprimido);
});
