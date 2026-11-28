// Etapa 1.3 — pintura do Bambu: ler a árvore de subdivisão, montar os pedaços reais,
// trocar cores, mostrar na tela e regravar sem perder nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { MeshoptSimplifier } from 'meshoptimizer';
import {
  textoParaNibbles, nibblesParaTexto, analisar, pedacos, trocarCores, pintarPorRegiao, folha,
} from '../../js/io/pintura-bambu.js';
import { ler3mf } from '../../js/io/3mf.js';
import { gravar3mf, inverter } from '../../js/io/3mf-gravar.js';
import { multiplicar } from '../../js/io/3mf.js';
import { todasAsPartes, numFilamentos } from '../../js/core/projeto.js';
import { atualizarResumo, prepararTela, trocarCorDaPintura, trocarCorNaTela, parteEspelhada } from '../../js/core/pintura.js';
import { conferenciaPintura3mf, cuboConferencia, letraF, bambuProjeto3mf } from '../gerar-modelos.mjs';

await MeshoptSimplifier.ready;
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SMILE = join(RAIZ, 'testes', 'modelos', 'boneco_smile_conectores.3mf');

const area = (a, b, c) => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
};
const centro = (p) => [(p[0] + p[3] + p[6]) / 3, (p[1] + p[4] + p[7]) / 3, (p[2] + p[5] + p[8]) / 3];
const perto = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

/** Todos os pedaços de um código: [{ estado, p: [9 números] }]. */
function listaPedacos(texto, a, b, c) {
  const nib = textoParaNibbles(texto);
  const r = [];
  const fim = pedacos(nib, 0, nib.length, a, b, c, (estado, ...p) => r.push({ estado, p }));
  assert.equal(fim, nib.length, `código ${texto} lido até o fim`);
  return r;
}

async function gravar(malha) {
  const r = await gravar3mf(malha);
  return Buffer.concat(r.pedacos.map((p) => Buffer.from(p.buffer, p.byteOffset, p.length)));
}

async function atributosPintura(buffer) {
  const z = await JSZip.loadAsync(buffer);
  const xml = await z.file('3D/3dmodel.model').async('string');
  return xml.match(/paint_color="[^"]*"/g) || [];
}

// ---------- formato ----------

test('cores de um triângulo inteiro: "4" = 1, "8" = 2, "0C" = 3, "1C" = 4 … "FC" = 18', () => {
  const casos = { 4: 1, 8: 2, '0C': 3, '1C': 4, '2C': 5, DC: 16, FC: 18, 0: 0 };
  for (const [texto, cor] of Object.entries(casos)) {
    const a = analisar(textoParaNibbles(texto), 0, texto.length);
    assert.ok(a.valido, texto);
    assert.equal(a.unico, cor, texto);
    assert.equal(a.pedacos, 1);
  }
  for (const [texto, cor] of Object.entries(casos)) assert.equal(nibblesParaTexto(Uint8Array.from(folha(cor))), texto);
  for (let e = 0; e <= 18; e++) {
    const n = Uint8Array.from(folha(e));
    assert.equal(analisar(n, 0, n.length).unico, e);
  }
  assert.throws(() => folha(19));
});

test('texto -> nibbles -> texto volta igual (o texto é lido de trás para frente)', () => {
  for (const t of ['8', '0C', '40C03C3', '085', '0C00A', '1C1C1C1C3', 'ABCDEF0123456789']) {
    assert.equal(nibblesParaTexto(textoParaNibbles(t)), t);
  }
  assert.deepEqual([...textoParaNibbles('0C')], [12, 0], 'o último caractere vem primeiro');
  assert.throws(() => textoParaNibbles('xyz'));
});

test('códigos quebrados são reconhecidos', () => {
  for (const t of ['C', '3', '43', '88', 'F', '0F']) {
    assert.equal(analisar(textoParaNibbles(t), 0, t.length).valido, false, t);
  }
});

// ---------- geometria da subdivisão ----------

const A = [0, 0, 0], B = [4, 0, 0], C = [0, 4, 0];

test('3 lados: 4 pedaços (cantos a, b, c e o do meio), filhos do último para o primeiro', () => {
  // '40C03C3' = dividido em 4; canto a = cor 1, canto b = 3, canto c = 0, meio = 6
  const r = listaPedacos('40C03C3', A, B, C);
  assert.equal(r.length, 4);
  const cor = (ponto) => r.find(({ p }) => {
    const c = centro(p);
    return Math.hypot(c[0] - ponto[0], c[1] - ponto[1]) < 0.01;
  }).estado;
  assert.equal(cor([2 / 3, 2 / 3]), 1, 'canto do vértice a');
  assert.equal(cor([2 / 3 + 2, 2 / 3]), 3, 'canto do vértice b');
  assert.equal(cor([2 / 3, 2 / 3 + 2]), 0, 'canto do vértice c');
  assert.equal(cor([4 / 3, 4 / 3]), 6, 'pedaço do meio');
});

test('1 lado: o lado especial é o vértice oposto à aresta dividida', () => {
  // frente do cubo de conferência: (BL, BR, TR), lado especial 1 (BR); o filho 1 = (meio, BL, BR) é azul
  const BL = [0, 0, 0], BR = [30, 0, 0], TR = [30, 0, 30];
  const r = listaPedacos('085', BL, BR, TR);
  assert.equal(r.length, 2);
  const azul = r.find((x) => x.estado === 2);
  assert.deepEqual(azul.p.map((v) => Math.round(v * 1000) / 1000), [15, 0, 15, 0, 0, 0, 30, 0, 0], 'triângulo apoiado na borda de baixo com a ponta no centro');
  assert.equal(r.find((x) => x.estado === 0).p.length, 9);
});

test('2 lados: o lado especial é o vértice entre as duas arestas divididas', () => {
  // (BL, TR, TL), lado especial 2 (TL); o filho 0 = canto em TL, na cor 3
  const BL = [0, 0, 0], TR = [30, 0, 30], TL = [0, 0, 30];
  const r = listaPedacos('0C00A', BL, TR, TL);
  assert.equal(r.length, 3);
  const bege = r.find((x) => x.estado === 3);
  assert.deepEqual(bege.p.map((v) => Math.round(v * 1000) / 1000), [0, 0, 30, 0, 0, 15, 15, 0, 30], 'canto de cima à esquerda');
  const areas = r.map(({ p }) => area(p.slice(0, 3), p.slice(3, 6), p.slice(6, 9))).sort((a, b) => a - b);
  perto(areas[0], 112.5); perto(areas[1], 112.5); perto(areas[2], 225);
});

/** Código aleatório válido, com divisões de 1, 2 e 3 lados e qualquer lado especial. */
function codigoAleatorio(sorteio, prof = 0) {
  if (prof > 5 || sorteio() < 0.35) return folha(Math.floor(sorteio() * 19));
  const lados = 1 + Math.floor(sorteio() * 3);
  const esp = Math.floor(sorteio() * 3);
  const saida = [lados | (esp << 2)];
  for (let k = 0; k <= lados; k++) saida.push(...codigoAleatorio(sorteio, prof + 1));
  return saida;
}

function sorteador(semente) {
  let s = semente >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('pedaços cobrem o triângulo: áreas somam, ficam dentro dele e as frações batem', () => {
  const sorteio = sorteador(42);
  const a = [1, 2, 3], b = [11, 4, 2], c = [3, 9, 7];
  const total = area(a, b, c);
  for (let caso = 0; caso < 300; caso++) {
    const nib = Uint8Array.from(codigoAleatorio(sorteio));
    let soma = 0, n = 0;
    const porCor = new Float64Array(19);
    const fim = pedacos(nib, 0, nib.length, a, b, c, (e, ...p) => {
      const ar = area(p.slice(0, 3), p.slice(3, 6), p.slice(6, 9));
      soma += ar; porCor[e] += ar; n++;
      // o centro do pedaço está dentro do triângulo (coordenadas baricêntricas ≥ 0)
      const q = centro(p);
      const sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
      const cr = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      const nrm = cr(sub(b, a), sub(c, a));
      for (const [x, y] of [[a, b], [b, c], [c, a]]) assert.ok(dot(cr(sub(y, x), sub(q, x)), nrm) > -1e-9, 'pedaço dentro do triângulo');
    });
    assert.equal(fim, nib.length);
    perto(soma, total, 1e-9 * total);
    const an = analisar(nib, 0, nib.length);
    assert.equal(an.pedacos, n);
    for (let e = 0; e < 19; e++) perto(an.areas[e] * total, porCor[e], 1e-9 * total);
    assert.equal(nibblesParaTexto(textoParaNibbles(nibblesParaTexto(nib))), nibblesParaTexto(nib));
  }
});

// ---------- troca de cores ----------

test('trocar cores: troca só a cor pedida e junta pedaços que ficaram iguais', () => {
  const nib = textoParaNibbles('40C03C3');
  assert.equal(nibblesParaTexto(Uint8Array.from(trocarCores(nib, 0, nib.length, { 6: 1 }))), '40C043');
  const r1 = Uint8Array.from(trocarCores(nib, 0, nib.length, { 6: 1 }));
  const a1 = analisar(r1, 0, r1.length);
  assert.ok(a1.valido);
  perto(a1.areas[1], 0.5); perto(a1.areas[3], 0.25); perto(a1.areas[0], 0.25); perto(a1.areas[6], 0);
  // tudo vira 2: vira um triângulo inteiro "8"
  assert.equal(nibblesParaTexto(Uint8Array.from(trocarCores(nib, 0, nib.length, [2, 2, 2, 2, 2, 2, 2]))), '8');
  // tudo vira 0: sem pintura
  assert.deepEqual(trocarCores(nib, 0, nib.length, new Array(19).fill(0)), []);
  assert.equal(trocarCores(textoParaNibbles('43'), 0, 2, { 1: 2 }), null, 'código quebrado não é mexido');
});

test('pintar por região: cada pedaço tem a cor do lugar onde está', () => {
  const L = 30;
  const F = letraF(L);
  const a = [0, 0, L], b = [L, 0, L], c = [L, L, L];
  const nib = Uint8Array.from(pintarPorRegiao(a, b, c, (x, y) => F(x, y), 7, 4));
  let erradas = 0, total = 0;
  pedacos(nib, 0, nib.length, a, b, c, (e, ...p) => {
    const q = centro(p);
    total++;
    if (F(q[0], q[1]) !== e) erradas++;
  });
  assert.ok(total > 50);
  assert.ok(erradas / total < 0.02, `${erradas} de ${total} pedaços na cor errada`);
});

// ---------- 3MF ----------

test('smile: os 147.643 códigos de pintura voltam iguais, letra por letra', { skip: !existsSync(SMILE) }, async () => {
  const original = readFileSync(SMILE);
  const m = await ler3mf(original, JSZip);
  assert.equal(m.avisos.length, 0);
  const r = atualizarResumo(m);
  assert.deepEqual(r.estados, [2]);
  assert.equal(r.pintados, 147643);
  assert.equal(r.subdivididos, 0);
  // a pintura azul (filamento 2) está nos dois tênis, que são brancos (filamento 4)
  const pintadas = todasAsPartes(m).filter((_, k) => r.partes[k].pintada).map(({ objeto }) => objeto.nome);
  assert.deepEqual(pintadas, ['Tênis esquerdo', 'Tênis direito']);
  const antes = await atributosPintura(original);
  const depois = await atributosPintura(await gravar(m));
  assert.equal(depois.length, antes.length);
  assert.ok(depois.every((v, i) => v === antes[i]), 'códigos iguais, na mesma ordem');
});

test('smile: trocar a cor da pintura e apagar', { skip: !existsSync(SMILE) }, async () => {
  const m = await ler3mf(readFileSync(SMILE), JSZip);
  atualizarResumo(m);
  const partes = todasAsPartes(m);
  const esq = partes.findIndex(({ objeto }) => objeto.nome === 'Tênis esquerdo');
  const dir = partes.findIndex(({ objeto }) => objeto.nome === 'Tênis direito');
  const noEsq = m.pinturaCor.resumo.partes[esq].areas[2];
  // só no tênis esquerdo: 2 -> 3
  const n = trocarCorDaPintura(m, { de: 2, para: 3, parteIndice: esq });
  assert.ok(n > 0 && n < 147643);
  assert.deepEqual(m.pinturaCor.resumo.estados, [2, 3]);
  perto(m.pinturaCor.resumo.partes[esq].areas[3], noEsq, 1e-6);
  assert.equal(m.pinturaCor.resumo.partes[esq].areas[2], 0);
  // no modelo todo: tudo vai para o filamento 1
  assert.equal(trocarCorDaPintura(m, { de: 2, para: 1 }), 147643 - n);
  assert.equal(trocarCorDaPintura(m, { de: 3, para: 1 }), n);
  let attrs = await atributosPintura(await gravar(m));
  assert.equal(attrs.length, 147643);
  assert.ok(attrs.every((a) => a === 'paint_color="4"'), 'filamento 1 no formato do Bambu');
  // numa parte sem pintura nada muda
  assert.equal(trocarCorDaPintura(m, { de: 1, para: 2, parteIndice: 0 }), 0);
  assert.equal(trocarCorDaPintura(m, { de: 'todas', parteIndice: esq }), n, 'apaga só o tênis esquerdo');
  assert.ok(m.pinturaCor && m.pinturaCor.resumo.partes[dir].pintada && !m.pinturaCor.resumo.partes[esq].pintada);
  assert.equal(trocarCorDaPintura(m, { de: 'todas' }), 147643 - n);
  assert.equal(m.pinturaCor, null);
  assert.equal(m.pinturaApagada, true);
  attrs = await atributosPintura(await gravar(m));
  assert.equal(attrs.length, 0, 'sem pintura no arquivo');
});

test('projeto do Bambu: suporte pintado e pintura de cor saem juntos e voltam iguais', async () => {
  const m = await ler3mf(await bambuProjeto3mf(), JSZip);
  const buf = await gravar(m);
  const z = await JSZip.loadAsync(buf);
  const xml = await z.file('3D/3dmodel.model').async('string');
  assert.ok(xml.includes('paint_supports="8" paint_color="0C"'), 'suporte guardado como veio + cor regravada');
  assert.ok(xml.includes('paint_color="40C03C3"'));
  const v = await ler3mf(buf, JSZip);
  assert.equal(Buffer.compare(Buffer.from(v.pinturaCor.codigos), Buffer.from(m.pinturaCor.codigos)), 0);
  assert.equal(Buffer.compare(Buffer.from(v.pinturaOutros.atributos), Buffer.from(m.pinturaOutros.atributos)), 0);
});

test('código que o app não entende fica guardado e volta igual (com aviso)', async () => {
  const zip = await JSZip.loadAsync(await conferenciaPintura3mf());
  let xml = await zip.file('3D/3dmodel.model').async('string');
  xml = xml.replaceAll('paint_color="085"', 'paint_color="43"').replaceAll('paint_color="0C00A"', 'paint_color="zz"');
  zip.file('3D/3dmodel.model', xml);
  const m = await ler3mf(await zip.generateAsync({ type: 'nodebuffer' }), JSZip);
  assert.ok(m.avisos.some((a) => a.includes('não entendeu')));
  atualizarResumo(m);
  assert.equal(m.pinturaCor.resumo.quebrados, 2, '"43" nas duas instâncias');
  const tela = prepararTela(null, m, 1e6);
  assert.ok(tela.faixas.reduce((s, f) => s + f.numTriangulos, 0) + tela.detalhe.posicoes.length / 9 > 0);
  const saida = await (await JSZip.loadAsync(await gravar(m))).file('3D/3dmodel.model').async('string');
  assert.equal((saida.match(/paint_color="43"/g) || []).length, 2, 'código quebrado volta igual');
  assert.equal((saida.match(/paint_color="zz"/g) || []).length, 2, 'texto estranho volta igual');
});

// ---------- tela ----------

test('cubo de conferência na tela: pedaços reais na cor do lugar, também na peça espelhada', async () => {
  const m = await ler3mf(await conferenciaPintura3mf(), JSZip);
  assert.equal(m.avisos.length, 0);
  const r = atualizarResumo(m);
  assert.deepEqual(r.estados, [2, 3]);
  assert.equal(r.subdivididos, 8, '4 triângulos pintados em cada cubo');
  assert.equal(numFilamentos(m), 4);
  const tela = prepararTela(null, m, 300000);
  assert.equal(tela.posicoes, null, 'abaixo do limite: usa as posições da própria malha');
  assert.ok(tela.detalhe && tela.detalhe.posicoes.length > 0);
  const partes = todasAsPartes(m);
  assert.equal(parteEspelhada(partes[0].objeto, partes[0].parte), false);
  assert.equal(parteEspelhada(partes[1].objeto, partes[1].parte), true);
  // cada pedaço, levado de volta às coordenadas do cubo, tem a cor esperada
  const L = 30;
  const F = letraF(L);
  const esperado = (x, y, z) => {
    if (z > L - 1e-6) return F(x, y);
    if (y < 1e-6) {
      if (z < x && z < L - x) return 2; // triângulo apoiado na borda de baixo
      if (x < L / 2 && z > L / 2 && z - L / 2 > x) return 3; // canto de cima à esquerda
      return 0;
    }
    return 0;
  };
  let erradas = 0, total = 0;
  const det = tela.detalhe;
  for (const f of det.faixas) {
    const { objeto, parte } = partes[f.parte];
    const inv = inverter(multiplicar(parte.matriz, objeto.matriz));
    for (let t = f.primeiroTriangulo; t < f.primeiroTriangulo + f.numTriangulos; t++) {
      const q = centro(det.posicoes.subarray(t * 9, t * 9 + 9));
      const x = q[0] * inv[0] + q[1] * inv[3] + q[2] * inv[6] + inv[9];
      const y = q[0] * inv[1] + q[1] * inv[4] + q[2] * inv[7] + inv[10];
      const z = q[0] * inv[2] + q[1] * inv[5] + q[2] * inv[8] + inv[11];
      total++;
      if (esperado(x, y, z) !== f.estado) erradas++;
    }
  }
  assert.ok(erradas / total < 0.02, `${erradas} de ${total} pedaços na cor errada`);
  // toda a malha aparece: triângulos inteiros + subdivididos
  const inteiros = tela.faixas.reduce((s, f) => s + f.numTriangulos, 0);
  assert.equal(inteiros + r.subdivididos, m.indices.length / 3);
  // trocar a cor na tela: só as faixas daquela cor
  trocarCorNaTela(tela, { de: 3, para: 1, parteIndice: 1 });
  assert.ok(det.faixas.some((f) => f.parte === 0 && f.estado === 3) && det.faixas.some((f) => f.parte === 1 && f.estado === 1));
  assert.ok(!det.faixas.some((f) => f.parte === 1 && f.estado === 3));
});

test('smile na tela leve: grupos por cor, borda travada, dentro do limite', { skip: !existsSync(SMILE) }, async () => {
  const m = await ler3mf(readFileSync(SMILE), JSZip);
  atualizarResumo(m);
  const tela = prepararTela(MeshoptSimplifier, m, 300000);
  const n = tela.indices.length / 3;
  assert.ok(n <= 300000 * 1.15, `${n} triângulos na tela`);
  assert.ok(tela.posicoes instanceof Float32Array);
  assert.ok(tela.faixas.every((f) => Number.isInteger(f.parte) && f.estado >= 0));
  assert.ok(tela.faixas.some((f) => f.estado === 2), 'a pintura da cabeça aparece');
  const soma = tela.faixas.reduce((s, f) => s + f.numTriangulos, 0);
  assert.equal(soma, n);
  // cada parte continua presente
  const partes = new Set(tela.faixas.map((f) => f.parte));
  assert.equal(partes.size, todasAsPartes(m).length);
});

test('modelo grande com pintura fina: pedaços além do orçamento aparecem na cor de maior área', async () => {
  const m = await ler3mf(await conferenciaPintura3mf(), JSZip);
  atualizarResumo(m);
  const tela = prepararTela(MeshoptSimplifier, m, 40); // orçamento de 20 pedaços: o topo não cabe
  assert.ok(tela.detalhe && tela.detalhe.posicoes.length / 9 <= 20, 'só os pedaços da frente');
  // o topo tem mais branco que azul: aparece branco (cor da parte)
  const cor = m.pinturaCor;
  for (const t of [2, 3]) {
    const a = analisar(cor.codigos, cor.inicio[t], cor.inicio[t + 1]);
    assert.equal(a.dominante, 0);
  }
  const inteiros = tela.faixas.reduce((s, f) => s + f.numTriangulos, 0);
  assert.ok(inteiros > 0 && inteiros <= m.indices.length / 3);
});
