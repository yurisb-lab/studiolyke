// Etapa 1.4 — histórico: desfazer, refazer, editar um passo antigo, receitas,
// projeto salvo e arquivo .lyke.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { ler3mf } from '../../js/io/3mf.js';
import { lerStl } from '../../js/io/stl.js';
import { garantirEstrutura, todasAsPartes } from '../../js/core/projeto.js';
import { atualizarResumo, prepararTela } from '../../js/core/pintura.js';
import { Historico } from '../../js/core/historico.js';
import { aplicarReceitas, operacao } from '../../js/ops/index.js';
import { gravarPacote, lerPacote, paraJson, deJson } from '../../js/core/pacote.js';
import * as armazenamento from '../../js/core/armazenamento.js';
import * as projetos from '../../js/core/projetos.js';
import { bambu3mf, cubo, stlBinario } from '../gerar-modelos.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SMILE = join(RAIZ, 'testes', 'modelos', 'boneco_smile_conectores.3mf');

const iguais = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

function mesmaPintura(a, b) {
  if (!a.pinturaCor || !b.pinturaCor) return !a.pinturaCor && !b.pinturaCor;
  return iguais(a.pinturaCor.codigos, b.pinturaCor.codigos) && iguais(a.pinturaCor.inicio, b.pinturaCor.inicio);
}

const extrusoras = (m) => JSON.stringify(m.objetos.map((o) => [o.extrusora, o.partes.map((p) => p.extrusora)]));

/** Faz o que o app faz: o "original" reaberto + as receitas até a posição. */
async function reabrir(bytes, historico, alvo = historico.posicao) {
  const m = await ler3mf(bytes, JSZip);
  atualizarResumo(m);
  const { receitas, passos } = historico.receitasAte(alvo);
  const r = aplicarReceitas(m, receitas, { guardarVolta: true });
  historico.depoisDeReabrir(passos, r);
  return m;
}

/** Executa um plano do histórico na malha (caminho rápido). */
function executarPlano(m, plano) {
  for (const { passo, acao } of plano.passos) {
    const op = operacao(passo.tipo);
    if (acao === 'desfazer') {
      op.desfazer(m, passo.params, passo.volta);
    } else {
      const r = op.aplicar(m, passo.params, { guardarVolta: true });
      passo.volta = r.volta;
      passo.voltaBytes = r.voltaBytes;
    }
  }
}

test('filamento: desfazer e refazer na hora, sem reabrir', async () => {
  const m = await ler3mf(await bambu3mf(), JSZip);
  const antes = extrusoras(m);
  const h = new Historico();
  h.aplicarNovo(m, 'filamento', { objeto: 0, parte: 0, filamento: 3, de: 1, nome: 'Peça' });
  h.aplicarNovo(m, 'filamento', { objeto: 1, parte: 0, filamento: 2, de: 1, nome: 'Outra' });
  const depois = extrusoras(m);
  assert.notEqual(depois, antes);
  assert.equal(h.posicao, 2);
  let plano = h.plano(0);
  assert.ok(!plano.reabrir, 'troca de filamento tem volta exata');
  executarPlano(m, plano);
  h.irPara(0);
  assert.equal(extrusoras(m), antes, 'desfazer volta ao original');
  plano = h.plano(2);
  executarPlano(m, plano);
  h.irPara(2);
  assert.equal(extrusoras(m), depois, 'refazer chega no mesmo lugar');
  assert.match(h.passos[0].rotulo, /Filamento de Peça: 1 → 3/);
});

test('passo novo depois de desfazer corta o "refazer"', async () => {
  const m = await ler3mf(await bambu3mf(), JSZip);
  const h = new Historico();
  h.aplicarNovo(m, 'filamento', { objeto: 0, parte: 0, filamento: 3 });
  h.aplicarNovo(m, 'filamento', { objeto: 0, parte: 0, filamento: 4 });
  executarPlano(m, h.plano(1));
  h.irPara(1);
  assert.ok(h.podeRefazer);
  h.aplicarNovo(m, 'filamento', { objeto: 0, parte: 0, filamento: 2 });
  assert.equal(h.passos.length, 2);
  assert.ok(!h.podeRefazer);
});

test('smile: trocar cor e desfazer volta a pintura igual letra por letra', { skip: !existsSync(SMILE) }, async () => {
  const bytes = readFileSync(SMILE);
  const original = await ler3mf(bytes, JSZip);
  atualizarResumo(original);
  const m = await ler3mf(bytes, JSZip);
  atualizarResumo(m);
  const esq = todasAsPartes(m).findIndex(({ objeto }) => objeto.nome === 'Tênis esquerdo');
  const h = new Historico();
  // 2 -> 1 no tênis esquerdo, depois apaga tudo: duas operações que juntam cores (sem volta pela receita)
  const { resultado } = h.aplicarNovo(m, 'pintura-trocar', { de: 2, para: 1, parteIndice: esq, nome: 'Tênis esquerdo' });
  assert.ok(resultado.mudaram > 0);
  h.aplicarNovo(m, 'pintura-trocar', { de: 'todas', parteIndice: null });
  assert.equal(m.pinturaCor, null);
  assert.ok(h.passos.every((p) => p.volta), 'voltas rápidas guardadas');
  const plano = h.plano(0);
  assert.ok(!plano.reabrir);
  executarPlano(m, plano);
  h.irPara(0);
  assert.ok(mesmaPintura(m, original), 'pintura igual à original');
  assert.equal(m.pinturaApagada, false);
  assert.deepEqual(m.pinturaCor.resumo.estados, original.pinturaCor.resumo.estados);
  // refazer de novo dá o mesmo que antes
  executarPlano(m, h.plano(1));
  h.irPara(1);
  const ref = await ler3mf(bytes, JSZip);
  atualizarResumo(ref);
  operacao('pintura-trocar').aplicar(ref, { de: 2, para: 1, parteIndice: esq });
  assert.ok(mesmaPintura(m, ref), 'refazer = aplicar a receita');
});

test('smile: sem volta guardada (limite de memória), o desfazer reabre e refaz as receitas', { skip: !existsSync(SMILE) }, async () => {
  const bytes = readFileSync(SMILE);
  let m = await ler3mf(bytes, JSZip);
  atualizarResumo(m);
  const h = new Historico({ orcamentoVolta: 0 });
  h.aplicarNovo(m, 'pintura-trocar', { de: 2, para: 3 });
  h.aplicarNovo(m, 'filamento', { objeto: 0, parte: 0, filamento: 2 });
  assert.equal(h.passos[0].volta, null, 'acima do limite a volta é solta');
  const plano = h.plano(0);
  assert.ok(plano.reabrir, 'precisa reabrir');
  m = await reabrir(bytes, h, 1);
  h.irPara(1);
  const ref = await ler3mf(bytes, JSZip);
  atualizarResumo(ref);
  operacao('pintura-trocar').aplicar(ref, { de: 2, para: 3 });
  assert.ok(mesmaPintura(m, ref));
  assert.equal(extrusoras(m), extrusoras(ref));
});

test('editar um passo antigo dá o mesmo que fazer na ordem certa', { skip: !existsSync(SMILE) }, async () => {
  const bytes = readFileSync(SMILE);
  let m = await ler3mf(bytes, JSZip);
  atualizarResumo(m);
  const h = new Historico();
  h.aplicarNovo(m, 'pintura-trocar', { de: 2, para: 3 });
  h.aplicarNovo(m, 'pintura-trocar', { de: 3, para: 4 });
  h.aplicarNovo(m, 'filamento', { objeto: 0, parte: 0, filamento: 2 });
  // o primeiro passo passa a ser 2 -> 1: o segundo (3 -> 4) não acha mais nada
  h.editar(0, { para: 1 });
  assert.ok(h.passos.every((p) => !p.volta), 'voltas dali em diante não valem mais');
  assert.match(h.passos[0].rotulo, /→ 1/);
  m = await reabrir(bytes, h);
  const ref = await ler3mf(bytes, JSZip);
  atualizarResumo(ref);
  operacao('pintura-trocar').aplicar(ref, { de: 2, para: 1 });
  operacao('filamento').aplicar(ref, { objeto: 0, parte: 0, filamento: 2 });
  assert.ok(mesmaPintura(m, ref), 'pintura igual');
  assert.equal(extrusoras(m), extrusoras(ref), 'filamentos iguais');
  assert.deepEqual(m.pinturaCor.resumo.estados, [1]);
  assert.ok(h.passos.every((p) => p.volta), 'depois de reabrir as voltas voltam');
  // apagar o passo do filamento
  const r = h.apagar(2);
  assert.ok(r.modelo);
  assert.equal(h.posicao, 2);
});

test('receita que falha é pulada e o passo fica marcado', async () => {
  const bytes = await bambu3mf();
  const h = new Historico();
  let m = await ler3mf(bytes, JSZip);
  h.aplicarNovo(m, 'filamento', { objeto: 0, parte: 0, filamento: 3 });
  h.aplicarNovo(m, 'filamento', { objeto: 1, parte: 0, filamento: 2 });
  h.editar(0, { objeto: 99 });
  m = await reabrir(bytes, h);
  assert.ok(h.passos[0].erro, 'passo com erro');
  assert.equal(m.objetos[1].partes[0].extrusora, 2, 'os outros passos continuam');
});

test('passos de seleção: desfazer troca a seleção, sem mexer no modelo; seleções velhas saem', () => {
  const h = new Historico({ maxSelecoes: 3 });
  const s = (n) => ({ n, dados: new Uint32Array([0, n, 255]) });
  h.registrarSelecao(s(1), 'Varinha');
  h.registrarSelecao(s(2), 'Laço');
  assert.equal(h.selecaoEm().n, 2);
  assert.ok(!h.plano(1).reabrir && h.plano(1).passos.length === 0);
  h.irPara(1);
  assert.equal(h.selecaoEm().n, 1);
  h.irPara(0);
  assert.equal(h.selecaoEm(), null);
  h.irPara(2);
  for (let i = 3; i <= 6; i++) h.registrarSelecao(s(i), 'Varinha');
  assert.equal(h.passos.filter((p) => p.tipo === 'selecao').length, 3);
  assert.equal(h.selecaoEm().n, 6, 'a seleção em vigor fica');
  assert.deepEqual(h.paraSalvar(), { passos: [], posicao: 0 }, 'seleções do histórico não vão para o projeto');
});

test('ponto de restauração: as receitas começam depois dele', () => {
  const h = new Historico();
  const m = garantirEstrutura({ posicoes: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), objetos: [{ nome: 'a', primeiroTriangulo: 0, numTriangulos: 1 }], avisos: [] });
  h.aplicarNovo(m, 'filamento', { objeto: 0, parte: 0, filamento: 2 });
  h.aplicarNovo(m, 'filamento', { objeto: 0, parte: 0, filamento: 3 });
  h.aplicarNovo(m, 'filamento', { objeto: 0, parte: 0, filamento: 4 });
  h.pontos.set(h.passos[1].id, 'ponto-x');
  let r = h.receitasAte(3);
  assert.equal(r.ponto, 'ponto-x');
  assert.equal(r.receitas.length, 1);
  r = h.receitasAte(1);
  assert.equal(r.ponto, null);
  assert.deepEqual(h.editar(0, { filamento: 1 }), ['ponto-x'], 'editar antes do ponto invalida o ponto');
  assert.equal(h.receitasAte(3).ponto, null);
});

test('salvar e carregar o histórico (só receitas)', async () => {
  const m = await ler3mf(await bambu3mf(), JSZip);
  const h = new Historico();
  h.aplicarNovo(m, 'filamento', { objeto: 0, parte: 0, filamento: 3, nome: 'Peça', de: 1 });
  h.registrarSelecao({ n: 1 }, 'Varinha');
  h.aplicarNovo(m, 'filamento', { objeto: 1, parte: 0, filamento: 2, nome: 'Outra', de: 1 });
  h.irPara(2);
  const salvo = h.paraSalvar();
  assert.equal(salvo.passos.length, 2);
  assert.equal(salvo.posicao, 1);
  assert.ok(!('volta' in salvo.passos[0]));
  const h2 = new Historico();
  h2.carregar(JSON.parse(JSON.stringify(salvo)));
  assert.equal(h2.passos.length, 2);
  assert.equal(h2.posicao, 1);
  assert.match(h2.passos[1].rotulo, /Outra/);
});

test('arquivo .lyke: projeto e modelo vão e voltam iguais', async () => {
  const stl = stlBinario(cubo(10));
  const modelo = new File([stl], 'cubo.stl');
  const registro = projetos.novoRegistro({ nome: 'Cubo', base: { nome: 'cubo.stl', tamanho: stl.length, chaveArquivo: 'arq-1' } });
  registro.passos = [{ id: 'a', tipo: 'filamento', params: { objeto: 0, parte: 0, filamento: 2 }, rotulo: 'x', quando: 1 }];
  registro.posicao = 1;
  registro.selecoes = [{ nome: 'topo', selecao: { n: 12, runs: new Uint32Array([0, 2, 255, 5, 1, 7]) } }];
  const pacote = await gravarPacote(registro, modelo);
  const { projeto, modelo: volta } = await lerPacote(pacote, JSZip);
  assert.equal(projeto.nome, 'Cubo');
  assert.equal(projeto.posicao, 1);
  assert.equal(projeto.base.chaveArquivo, undefined, 'a chave do navegador não vai no arquivo');
  assert.ok(projeto.selecoes[0].selecao.runs instanceof Uint32Array);
  assert.deepEqual([...projeto.selecoes[0].selecao.runs], [0, 2, 255, 5, 1, 7]);
  assert.equal(volta.name, 'cubo.stl');
  assert.ok(iguais(new Uint8Array(await volta.arrayBuffer()), stl), 'modelo igual byte por byte');
  const m = lerStl((await volta.arrayBuffer()));
  assert.equal(m.indices.length / 3, 12);
  await assert.rejects(lerPacote(new Blob([new Uint8Array([1, 2, 3])]), JSZip), /danificado/);
});

test('paraJson/deJson: typed arrays viram texto e voltam', () => {
  const v = { a: new Float32Array([1.5, -2]), b: [new Uint8Array([0, 255])], c: { d: 3 } };
  const volta = deJson(JSON.parse(JSON.stringify(paraJson(v))));
  assert.deepEqual([...volta.a], [1.5, -2]);
  assert.ok(volta.b[0] instanceof Uint8Array);
  assert.equal(volta.c.d, 3);
});

test('projetos: salvar, listar, rascunho e limpeza dos arquivos sem uso', async () => {
  // adaptador de memória (o Node não tem IndexedDB)
  const dados = new Map();
  const col = (c) => { if (!dados.has(c)) dados.set(c, new Map()); return dados.get(c); };
  armazenamento.usarAdaptador({
    nome: 'teste',
    ler: async (c, k) => col(c).get(k),
    gravar: async (c, k, v) => { col(c).set(k, v); },
    apagar: async (c, k) => { col(c).delete(k); },
    listar: async (c) => [...col(c).keys()],
  });
  const chave = await projetos.guardarArquivo(new Blob(['abc']));
  const solto = await projetos.guardarArquivo(new Blob(['velho']));
  const r = projetos.novoRegistro({ nome: 'Smile', base: { nome: 'smile.3mf', chaveArquivo: chave } });
  await projetos.gravarRascunho(r);
  const salvo = await projetos.salvarProjeto(r);
  assert.match(salvo.id, /^proj-/);
  const lista = await projetos.listarProjetos();
  assert.equal(lista.length, 1, 'o rascunho não aparece na lista');
  assert.equal(lista[0].nome, 'Smile');
  assert.equal(await projetos.limparArquivos(), 1, 'só o arquivo sem projeto sai');
  assert.ok(await projetos.lerArquivo(chave));
  assert.equal(await projetos.lerArquivo(solto), null);
  await projetos.descartarRascunho();
  await projetos.apagarProjeto(salvo.id);
  assert.equal(await projetos.lerArquivo(chave), null, 'sem nenhum projeto, o original sai');
  assert.equal(projetos.nomeDoArquivo('boneco_fatiador.3mf'), 'boneco');
});

test('a tela acompanha a troca de cor e volta com os estados guardados', { skip: !existsSync(SMILE) }, async () => {
  const m = await ler3mf(readFileSync(SMILE), JSZip);
  atualizarResumo(m);
  const tela = prepararTela(null, m, 10_000_000);
  const antes = tela.faixas.map((f) => f.estado).join();
  operacao('pintura-trocar').naTela(tela, { de: 2, para: 1, parteIndice: null });
  assert.notEqual(tela.faixas.map((f) => f.estado).join(), antes);
});
