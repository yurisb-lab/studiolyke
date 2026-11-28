// Testes da malha leve (simplificação com o meshoptimizer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { malhaDaTela, simplificarMalha } from '../../js/core/simplificar.js';
import { criarMalha, caixaDaMalha, caixasDosObjetos, transferiveis, compactar } from '../../js/core/malha.js';
import { esfera } from '../gerar-modelos.mjs';

await MeshoptSimplifier.ready;

test('malha da tela fica no limite e mantém o tamanho da peça', () => {
  const e = esfera(30, 200, 400); // ~160 mil triângulos
  const m = criarMalha(e);
  const tela = malhaDaTela(MeshoptSimplifier, m, 20000);
  const tri = tela.indices.length / 3;
  assert.ok(tri <= 20000 * 1.15 && tri > 5000, `triângulos na tela: ${tri}`);
  const a = caixaDaMalha(m), b = caixaDaMalha(tela);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(a.tamanho[k] - b.tamanho[k]) < 0.6, `eixo ${k}`);
  // a malha completa não foi alterada
  assert.equal(m.indices.length / 3, e.indices.length / 3);
});

test('malha pequena não é simplificada', () => {
  const m = criarMalha(esfera(10, 8, 16));
  const tela = malhaDaTela(MeshoptSimplifier, m, 1000);
  assert.equal(tela.indices.length, m.indices.length);
});

test('simplificar ao abrir mantém os objetos separados', () => {
  const a = esfera(10, 60, 120, [0, 0, 10]);
  const b = esfera(10, 60, 120, [40, 0, 10]);
  const pos = new Float32Array(a.posicoes.length + b.posicoes.length);
  pos.set(a.posicoes); pos.set(b.posicoes, a.posicoes.length);
  const idx = new Uint32Array(a.indices.length + b.indices.length);
  idx.set(a.indices);
  const nv = a.posicoes.length / 3;
  for (let i = 0; i < b.indices.length; i++) idx[a.indices.length + i] = b.indices[i] + nv;
  const ta = a.indices.length / 3;
  const m = criarMalha({ posicoes: pos, indices: idx, objetos: [
    { nome: 'A', primeiroTriangulo: 0, numTriangulos: ta },
    { nome: 'B', primeiroTriangulo: ta, numTriangulos: ta },
  ] });
  const s = simplificarMalha(MeshoptSimplifier, m, 2000);
  assert.equal(s.objetos.length, 2);
  assert.equal(s.objetos[0].numTriangulos + s.objetos[1].numTriangulos, s.indices.length / 3);
  assert.ok(s.indices.length / 3 <= 2400);
  // B continua à direita de A
  let minXB = Infinity;
  for (const v of s.indices.subarray(s.objetos[1].primeiroTriangulo * 3)) minXB = Math.min(minXB, s.posicoes[v * 3]);
  assert.ok(minXB > 25);
});

test('transferíveis lista cada buffer uma vez', () => {
  const m = criarMalha(esfera(10, 8, 16));
  assert.equal(transferiveis(m, m).length, 2);
});

test('compactar remove vértices não usados', () => {
  const pos = new Float32Array([0, 0, 0, 9, 9, 9, 1, 0, 0, 0, 1, 0]);
  const c = compactar(pos, new Uint32Array([0, 2, 3]));
  assert.equal(c.posicoes.length, 9);
  assert.deepEqual(Array.from(c.indices), [0, 1, 2]);
});

test('medidas de cada objeto', () => {
  const a = esfera(10, 8, 16, [0, 0, 10]);
  const m = criarMalha({ posicoes: a.posicoes, indices: a.indices, objetos: [
    { nome: 'A', primeiroTriangulo: 0, numTriangulos: a.indices.length / 3 },
  ] });
  const [t] = caixasDosObjetos(m);
  for (const v of t) assert.ok(Math.abs(v - 20) < 0.5);
});

test('malha da tela separa as partes (cada uma na cor do seu filamento)', async () => {
  const JSZip = (await import('jszip')).default;
  const { ler3mf } = await import('../../js/io/3mf.js');
  const { bambuProjeto3mf } = await import('../gerar-modelos.mjs');
  const { faixasDasPartes } = await import('../../js/core/projeto.js');
  const m = await ler3mf(await bambuProjeto3mf(), JSZip);
  const tela = malhaDaTela(MeshoptSimplifier, m, 40);
  const faixas = faixasDasPartes(m);
  assert.equal(tela.faixas.length, faixas.length);
  let soma = 0;
  tela.faixas.forEach((f) => { assert.equal(f.primeiroTriangulo, soma); soma += f.numTriangulos; });
  assert.equal(soma, tela.indices.length / 3, 'faixas cobrem a malha da tela');
  assert.ok(tela.posicoes instanceof Float32Array, 'tela em precisão simples (placa de vídeo)');
  assert.ok(m.posicoes instanceof Float64Array, 'malha do 3MF em precisão dupla');
});

test('simplificar ao abrir mantém partes, filamentos e placas; a pintura sai com aviso', async () => {
  const JSZip = (await import('jszip')).default;
  const { ler3mf } = await import('../../js/io/3mf.js');
  const { bambuProjeto3mf } = await import('../gerar-modelos.mjs');
  const m = await ler3mf(await bambuProjeto3mf(), JSZip);
  const s = simplificarMalha(MeshoptSimplifier, m, 60);
  assert.ok(s.indices.length / 3 < m.indices.length / 3);
  assert.deepEqual(s.objetos.map((o) => o.partes.map((p) => [p.nome, p.extrusora])), m.objetos.map((o) => o.partes.map((p) => [p.nome, p.extrusora])));
  assert.deepEqual(s.placas, m.placas);
  assert.deepEqual(s.filamentos, m.filamentos);
  assert.equal(s.pinturaCor, null);
  assert.equal(s.pinturaOutros, null);
  assert.ok(s.avisos.some((a) => a.includes('pintura do Bambu foi descartada')));
  for (const o of s.objetos) {
    assert.equal(o.numTriangulos, o.partes.reduce((t, p) => t + p.numTriangulos, 0));
  }
});
