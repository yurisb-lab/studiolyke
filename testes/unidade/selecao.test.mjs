// Etapa 1.5 — seleção: vizinhança, varinha (cor, ângulo, casca), só faces visíveis,
// laço, somar/tirar/inverter, crescer/encolher, formato compacto e destaque na tela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { ler3mf } from '../../js/io/3mf.js';
import { criarMalha } from '../../js/core/malha.js';
import { todasAsPartes } from '../../js/core/projeto.js';
import { atualizarResumo, corSimples, prepararTela } from '../../js/core/pintura.js';
import { analisar } from '../../js/io/pintura-bambu.js';
import * as S from '../../js/core/selecao.js';
import { cubo, conferenciaPintura3mf } from '../gerar-modelos.mjs';
import { pedacos as pedacosDaPintura } from '../../js/io/pintura-bambu.js';
import { parteEspelhada } from '../../js/core/pintura.js';

await MeshoptSimplifier.ready;
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SMILE = join(RAIZ, 'testes', 'modelos', 'boneco_smile_conectores.3mf');

/** Malha simples a partir de cubos (cada cubo é um objeto). */
function cubos(lista) {
  const pos = [], idx = [], objetos = [];
  for (const [L, origem] of lista) {
    const c = cubo(L, origem);
    const base = pos.length / 3;
    objetos.push({ nome: `cubo ${objetos.length + 1}`, primeiroTriangulo: idx.length / 3, numTriangulos: c.indices.length / 3 });
    pos.push(...c.posicoes);
    for (const i of c.indices) idx.push(i + base);
  }
  return criarMalha({ posicoes: new Float64Array(pos), indices: new Uint32Array(idx), objetos });
}

/** Plano em grade (nx × ny quadrados de 1 mm), normal +z. */
function grade(nx, ny) {
  const pos = [], idx = [];
  for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) pos.push(x, y, 0);
  const v = (x, y) => y * (nx + 1) + x;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) idx.push(v(x, y), v(x + 1, y), v(x + 1, y + 1), v(x, y), v(x + 1, y + 1), v(x, y + 1));
  return criarMalha({ posicoes: new Float64Array(pos), indices: new Uint32Array(idx) });
}

/** Câmera olhando de cima; mapa de profundidade constante (um "anteparo" à distância d). */
function vistaDeCima(alvo, altura, d, W = 200, H = 200) {
  const cam = new THREE.PerspectiveCamera(40, W / H, 1, 1000);
  cam.up.set(0, 1, 0);
  cam.position.set(alvo[0], alvo[1], altura);
  cam.lookAt(alvo[0], alvo[1], alvo[2]);
  cam.updateMatrixWorld(true);
  const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  return {
    matriz: Float64Array.from(m.elements),
    largura: W,
    altura: H,
    profundidade: new Float32Array(W * H).fill(d),
    olho: [alvo[0], alvo[1], altura],
    fatorPixel: (2 * Math.tan((40 * Math.PI) / 360)) / H,
    tolerancia: 0.2,
  };
}

test('vizinhança: num cubo fechado cada aresta tem vizinho, e a vizinhança é mútua', () => {
  const m = cubos([[10, [0, 0, 0]]]);
  const viz = S.vizinhanca(m);
  assert.equal(viz.length, 36);
  for (let t = 0; t < 12; t++) {
    for (let k = 0; k < 3; k++) {
      const u = viz[t * 3 + k];
      assert.ok(u >= 0 && u !== t);
      assert.ok([viz[u * 3], viz[u * 3 + 1], viz[u * 3 + 2]].includes(t));
    }
  }
});

test('casca pega a peça solta inteira e não pula para outra', () => {
  const m = cubos([[10, [0, 0, 0]], [10, [30, 0, 0]]]);
  const ctx = S.criarContexto(m);
  const sel = S.varinha(m, ctx, 0, { modo: 'casca' });
  assert.equal(S.resumir(m, ctx, sel).triangulos, 12);
  assert.ok(sel.slice(12).every((v) => v === 0));
});

test('ângulo: para nas quinas do cubo (pega só a face tocada)', () => {
  const m = cubos([[10, [0, 0, 0]]]);
  const ctx = S.criarContexto(m);
  const sel = S.varinha(m, ctx, 2, { modo: 'angulo', angulo: 30 });
  assert.equal(S.resumir(m, ctx, sel).triangulos, 2, 'uma face = 2 triângulos');
  assert.equal(Math.round(S.resumir(m, ctx, sel).area), 100, '100 mm²');
  const tudoJunto = S.varinha(m, ctx, 2, { modo: 'angulo', angulo: 95 });
  assert.equal(S.resumir(m, ctx, tudoJunto).triangulos, 12, 'com 95° passa das quinas de 90°');
});

test('só faces visíveis: de cima, pega só o topo do cubo da frente', () => {
  // cubo de cima (topo em z=10) e cubo de baixo (topo em z=-20), um embaixo do outro
  const m = cubos([[10, [0, 0, 0]], [10, [0, 0, -30]]]);
  const ctx = S.criarContexto(m);
  const vista = vistaDeCima([5, 5, 0], 100, 90); // tudo na tela está a 90 mm (o topo do cubo de cima)
  const vis = S.visiveis(m, ctx, vista);
  const visiveis = [...vis.keys()].filter((t) => vis[t]);
  const topo = (t) => { const i = m.indices; return [0, 1, 2].every((k) => m.posicoes[i[t * 3 + k] * 3 + 2] === 10); };
  assert.equal(visiveis.length, 2);
  assert.ok(visiveis.every(topo), 'só os 2 triângulos do topo de cima');
  // casca ignora a visibilidade; ângulo e cor respeitam
  assert.equal(S.resumir(m, ctx, S.varinha(m, ctx, visiveis[0], { modo: 'angulo', angulo: 95, visivel: vis })).triangulos, 2);
  assert.equal(S.resumir(m, ctx, S.varinha(m, ctx, visiveis[0], { modo: 'casca', visivel: vis })).triangulos, 12);
});

test('peça "do avesso" (STL ruim) também é vista', () => {
  const m = cubos([[10, [0, 0, 0]]]);
  for (let t = 0; t < 12; t++) { const a = m.indices[t * 3 + 1]; m.indices[t * 3 + 1] = m.indices[t * 3 + 2]; m.indices[t * 3 + 2] = a; }
  const ctx = S.criarContexto(m);
  assert.deepEqual(ctx.sinal, [-1]);
  const vis = S.visiveis(m, ctx, vistaDeCima([5, 5, 0], 100, 90));
  assert.equal(vis.reduce((a, b) => a + b, 0), 2);
});

test('raio acha o triângulo da frente', () => {
  const m = cubos([[10, [0, 0, 0]], [10, [0, 0, -30]]]);
  const r = S.raioNaMalha(m, [5, 5, 100], [0, 0, -1]);
  assert.ok(r);
  assert.ok(Math.abs(r.distancia - 90) < 1e-9);
  assert.deepEqual(r.ponto.map((v) => Math.round(v)), [5, 5, 10]);
  assert.equal(S.raioNaMalha(m, [50, 50, 100], [0, 0, -1]), null);
});

test('laço: pega o que cai dentro do contorno (e respeita "só visível")', () => {
  const m = grade(20, 20);
  const ctx = S.criarContexto(m);
  const vista = vistaDeCima([10, 10, 0], 60, 60);
  // quadrado no meio da tela
  const sel = S.laco(m, [[80, 80], [120, 80], [120, 120], [80, 120]], vista);
  const r = S.resumir(m, ctx, sel);
  assert.ok(r.triangulos > 10 && r.triangulos < 800, `${r.triangulos}`);
  const nada = S.laco(m, [[80, 80], [120, 80], [120, 120]], vista, new Uint8Array(800));
  assert.equal(S.resumir(m, ctx, nada).triangulos, 0);
});

test('somar, tirar, inverter e tudo', () => {
  const a = Uint8Array.from([255, 0, 2, 0, 255, 102]);
  const b = Uint8Array.from([0, 255, 255, 0, 2, 0]);
  assert.deepEqual([...S.combinar(a, b, 'somar')], [255, 255, 255, 0, 255, 102]);
  assert.deepEqual([...S.combinar(a, b, 'tirar')], [255, 0, 0, 0, 102, 102]);
  assert.deepEqual([...S.combinar(a, b, 'nova')], [...b]);
  assert.deepEqual([...S.inverter(a)], [0, 255, 102, 255, 0, 2]);
  assert.deepEqual([...S.inverter(S.inverter(a))], [...a]);
  assert.ok(S.tudo(4).every((v) => v === 255));
  // tudo menos a cor 2, tirando "tudo menos a cor 2", sobra nada; e "só 2" - "tudo menos 2" = só 2
  assert.deepEqual([...S.combinar(Uint8Array.from([102, 2]), Uint8Array.from([102, 102]), 'tirar')], [0, 2]);
});

test('crescer e encolher em mm, pela superfície', () => {
  const m = grade(20, 20);
  const ctx = S.criarContexto(m);
  const sel = new Uint8Array(800);
  const meio = (10 * 20 + 10) * 2; // um triângulo no meio
  sel[meio] = 255;
  const g1 = S.crescer(m, ctx, sel, 1);
  const g3 = S.crescer(m, ctx, sel, 3);
  const n1 = S.resumir(m, ctx, g1).triangulos, n3 = S.resumir(m, ctx, g3).triangulos;
  assert.ok(n1 > 1 && n3 > n1 * 3, `${n1} ${n3}`);
  assert.ok(n3 < 120, 'não passa muito de 3 mm');
  const e = S.encolher(m, ctx, g3, 1.2);
  const ne = S.resumir(m, ctx, e).triangulos;
  assert.ok(ne > 0 && ne < n3, `${ne}`);
  assert.equal(S.resumir(m, ctx, S.encolher(m, ctx, g3, 10)).triangulos, 0);
});

test('formato compacto: vai e volta igual; malha diferente = descartada', () => {
  const sel = new Uint8Array(1000);
  sel.fill(255, 100, 300); sel.fill(2, 300, 310); sel[999] = 105;
  const c = S.compactar(sel);
  assert.ok(c.trechos && c.trechos.length === 9);
  assert.deepEqual([...S.expandir(c, 1000)], [...sel]);
  assert.equal(S.expandir(c, 999), null);
  assert.equal(S.compactar(new Uint8Array(10)), null, 'vazia = null');
  const salteada = new Uint8Array(1000);
  for (let i = 0; i < 1000; i += 2) salteada[i] = 255;
  const cb = S.compactar(salteada);
  assert.ok(cb.bruto, 'salteada vai em bruto (menor)');
  assert.deepEqual([...S.expandir(cb, 1000)], [...salteada]);
});

test('smile: a varinha por cor no tênis pega só o azul, com o contorno da pintura fina', { skip: !existsSync(SMILE) }, async () => {
  const m = await ler3mf(readFileSync(SMILE), JSZip);
  atualizarResumo(m);
  const t0 = Date.now();
  const ctx = S.criarContexto(m);
  const msCtx = Date.now() - t0;
  const partes = todasAsPartes(m);
  const esq = partes.findIndex(({ objeto }) => objeto.nome === 'Tênis esquerdo');
  const { parte } = partes[esq];
  // um triângulo azul inteiro (cor 2) no tênis esquerdo
  let semente = -1;
  for (let t = parte.primeiroTriangulo; t < parte.primeiroTriangulo + parte.numTriangulos; t++) if (corSimples(m.pinturaCor, t) === 2) { semente = t; break; }
  assert.ok(semente >= 0);
  const c = m.posicoes, i = m.indices;
  const ponto = [0, 1, 2].map((k) => (c[i[semente * 3] * 3 + k] + c[i[semente * 3 + 1] * 3 + k] + c[i[semente * 3 + 2] * 3 + k]) / 3);
  assert.equal(S.corNoPonto(m, ctx, semente, ponto), 2, 'cor no ponto = azul');
  const t1 = Date.now();
  const sel = S.varinha(m, ctx, semente, { modo: 'cor', cor: 2 });
  const msVarinha = Date.now() - t1;
  const r = S.resumir(m, ctx, sel);
  let fora = 0, errados = 0, pedacos = 0;
  for (let t = 0; t < sel.length; t++) {
    if (!sel[t]) continue;
    if (ctx.parteDe[t] !== esq) fora++;
    const e = corSimples(m.pinturaCor, t);
    if (e >= 0 && e !== 2) errados++;
    if (sel[t] === 2) {
      pedacos++;
      const a = analisar(m.pinturaCor.codigos, m.pinturaCor.inicio[t], m.pinturaCor.inicio[t + 1]);
      if (!(a.areas[2] > 0)) errados++;
    }
  }
  assert.equal(fora, 0, 'não sai do tênis esquerdo');
  assert.equal(errados, 0, 'só triângulos com azul');
  assert.ok(r.triangulos > 1000, `${r.triangulos} triângulos`);
  assert.equal(pedacos, 0, 'no smile a pintura segue os triângulos (sem pintura fina)');
  // não contíguo: o azul dos dois tênis
  const todos = S.varinha(m, ctx, semente, { modo: 'cor', cor: 2, contiguo: false });
  const rt = S.resumir(m, ctx, todos);
  assert.ok(rt.triangulos >= r.triangulos);
  const area2 = m.pinturaCor.resumo.partes.reduce((s, p) => s + p.areas[2], 0);
  // "cor 2" = tudo o que sai no filamento 2: a pintura azul E as partes inteiras no filamento 2
  let areaSemPintura2 = 0;
  partes.forEach(({ parte, objeto }, k) => {
    if ((parte.extrusora > 0 ? parte.extrusora : objeto.extrusora) !== 2) return;
    for (let t = parte.primeiroTriangulo; t < parte.primeiroTriangulo + parte.numTriangulos; t++) if (corSimples(m.pinturaCor, t) === 0) areaSemPintura2 += S.areaTriangulo(m.posicoes, m.indices, t);
  });
  const esperado = area2 + areaSemPintura2;
  assert.ok(Math.abs(rt.area - esperado) / esperado < 1e-6, `área ${rt.area.toFixed(1)} = pintura azul ${area2.toFixed(1)} + partes no filamento 2 ${areaSemPintura2.toFixed(1)}`);
  // compacto e destaque
  const comp = S.compactar(sel);
  assert.deepEqual(S.expandir(comp, sel.length), sel);
  const tela = prepararTela(MeshoptSimplifier, m, 244000);
  assert.ok(tela.origem && tela.origem.length === tela.posicoes.length / 3);
  const d = S.destaque(m, ctx, sel, tela);
  assert.ok(d.indices.length > 0 && d.indices.length % 3 === 0 && d.pedacos.length === 0, "sem pintura fina: destaque só pela malha da tela");
  assert.ok(d.indices.every((v) => v < tela.posicoes.length / 3), 'índices da tela');
  console.log(`      contexto ${msCtx} ms, varinha ${msVarinha} ms, ${r.triangulos} triângulos (${pedacos} com pedaços), compacto ${comp.trechos ? comp.trechos.length * 4 : comp.bruto.length} bytes`);
});

test('pintura fina: a varinha guarda só os pedaços da cor (contorno exato) e o destaque mostra só eles', async () => {
  const m = await ler3mf(await conferenciaPintura3mf(), JSZip);
  atualizarResumo(m);
  const ctx = S.criarContexto(m);
  const cor = m.pinturaCor;
  const partes = todasAsPartes(m);
  // um triângulo com pintura fina que tem a cor 2, e o centro de um pedaço dessa cor
  let t0 = -1, ponto = null;
  for (let t = 0; t < m.indices.length / 3 && t0 < 0; t++) {
    if (corSimples(cor, t) !== -1) continue;
    const { parte, objeto } = partes[ctx.parteDe[t]];
    const esp = parteEspelhada(objeto, parte);
    const i = m.indices, p = m.posicoes;
    const v = (k) => [p[i[t * 3 + k] * 3], p[i[t * 3 + k] * 3 + 1], p[i[t * 3 + k] * 3 + 2]];
    const [A, B, C] = esp ? [v(0), v(2), v(1)] : [v(0), v(1), v(2)];
    pedacosDaPintura(cor.codigos, cor.inicio[t], cor.inicio[t + 1], A, B, C, (e, x0, y0, z0, x1, y1, z1, x2, y2, z2) => {
      if (e === 2 && !ponto) { ponto = [(x0 + x1 + x2) / 3, (y0 + y1 + y2) / 3, (z0 + z1 + z2) / 3]; t0 = t; }
    });
  }
  assert.ok(t0 >= 0, 'achou pintura fina com a cor 2');
  assert.equal(S.corNoPonto(m, ctx, t0, ponto), 2);
  const sel = S.varinha(m, ctx, t0, { modo: 'cor', cor: 2, contiguo: false });
  assert.equal(sel[t0], 2, 'o triângulo misto guarda "só a cor 2"');
  const r = S.resumir(m, ctx, sel);
  const area2 = cor.resumo.partes.reduce((s, p) => s + p.areas[2], 0);
  assert.ok(r.pedacos > 0 && Math.abs(r.area - area2) < 1e-6 * Math.max(1, area2), `área selecionada ${r.area} = área da cor 2 ${area2}`);
  const d = S.destaque(m, ctx, sel, null);
  let areaPedacos = 0;
  for (let k = 0; k < d.pedacos.length; k += 9) {
    const q = d.pedacos;
    const ux = q[k + 3] - q[k], uy = q[k + 4] - q[k + 1], uz = q[k + 5] - q[k + 2];
    const vx = q[k + 6] - q[k], vy = q[k + 7] - q[k + 1], vz = q[k + 8] - q[k + 2];
    areaPedacos += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  let areaInteiros = 0;
  for (let k = 0; k < d.indices.length; k += 3) {
    const p = m.posicoes, i = d.indices;
    const a = i[k] * 3, b = i[k + 1] * 3, c = i[k + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    areaInteiros += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  assert.ok(Math.abs(areaPedacos + areaInteiros - area2) < 1e-3 * area2, `destaque cobre a área da cor 2 (${(areaPedacos + areaInteiros).toFixed(2)} ≈ ${area2.toFixed(2)})`);
  // inverter guarda "tudo menos a cor 2" nesses triângulos
  assert.equal(S.inverter(sel)[t0], 102);
});
