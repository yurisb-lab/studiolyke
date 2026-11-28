// Estrutura do projeto em cima da malha: objetos, partes, filamentos e placas.
//
// A malha continua sendo UMA só (posicoes/indices em typed arrays). Objetos e
// partes são só faixas de triângulos (e de vértices) dentro dela:
//
//   malha.objetos[i] = {
//     nome, primeiroTriangulo, numTriangulos,      (faixa do objeto inteiro)
//     extrusora,        filamento padrão do objeto (1, 2, 3…)
//     matriz,           posição do objeto na placa (transformação 3MF, 12 números) ou null
//     imprimivel,       false = o Bambu não imprime (fica cinza lá)
//     config,           [[chave, valor], …] outros ajustes do objeto (brim, suporte…)
//     partes: [{
//       nome, subtipo ('normal_part', 'modifier_part', 'negative_part', 'support_blocker'…),
//       primeiroTriangulo, numTriangulos,          (faixa dentro da malha)
//       primeiroVertice, numVertices,              (faixa de vértices, quando conhecida)
//       matriz,           posição da parte dentro do objeto (12 números)
//       extrusora (null = usa o do objeto), config: [[chave, valor], …]
//     }]
//   }
//   malha.filamentos = [{ cor: '#1A1A1A', tipo: 'PLA', perfil: 'Bambu PLA Basic @BBL A1' }]
//   malha.placas     = [{ id, nome, bloqueada, objetos: [índices em malha.objetos], config }]
//   malha.pinturaCor = { codigos: Uint8Array, inicio: Uint32Array, resumo } | null
//                      Pintura de cor do Bambu: a árvore de subdivisão de cada
//                      triângulo em nibbles (ver js/io/pintura-bambu.js). O
//                      triângulo t usa codigos[inicio[t] .. inicio[t+1]); vazio = sem pintura.
//                      resumo: ver js/core/pintura.js (áreas por cor, por parte).
//   malha.pinturaOutros = { atributos: Uint8Array, inicio: Uint32Array } | null
//                      Pintura de suporte e de costura, guardada como veio
//                      (texto ` paint_supports="…"`), e volta igual.
//   malha.arquivo3mf = { aplicacao, metadados, extras: [{ caminho, bytes }], ordemPreservada }

export const IDENTIDADE = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);

// Cores de exemplo para modelos sem filamentos (STL, OBJ): só para a tela,
// nunca gravadas no arquivo.
export const PALETA_EXEMPLO = ['#DFE3E8', '#E2574C', '#3B82C4', '#F2C14E'];

export const NOMES_SUBTIPO = {
  normal_part: 'parte',
  modifier_part: 'modificador',
  negative_part: 'parte negativa',
  support_blocker: 'bloqueador de suporte',
  support_enforcer: 'reforço de suporte',
};

/** Completa a estrutura para malhas que não vieram de um 3MF do Bambu (STL, OBJ…). */
export function garantirEstrutura(malha) {
  for (const o of malha.objetos) {
    if (o.extrusora == null) o.extrusora = 1;
    if (o.imprimivel == null) o.imprimivel = true;
    if (!o.config) o.config = [];
    if (o.matriz === undefined) o.matriz = null;
    if (!o.partes || !o.partes.length) {
      o.partes = [{
        nome: o.nome,
        subtipo: 'normal_part',
        primeiroTriangulo: o.primeiroTriangulo,
        numTriangulos: o.numTriangulos,
        matriz: IDENTIDADE,
        extrusora: o.extrusora,
        config: [],
      }];
    }
  }
  if (!malha.filamentos) malha.filamentos = [];
  if (!malha.placas || !malha.placas.length) {
    malha.placas = [{ id: 1, nome: '', bloqueada: false, objetos: malha.objetos.map((_, i) => i), config: [] }];
  }
  if (malha.pinturaCor === undefined) malha.pinturaCor = null;
  if (malha.pinturaOutros === undefined) malha.pinturaOutros = null;
  if (!malha.arquivo3mf) malha.arquivo3mf = null;
  return malha;
}

/** Todas as partes em ordem (objeto por objeto), com o índice do objeto. */
export function todasAsPartes(malha) {
  const lista = [];
  malha.objetos.forEach((o, io) => {
    for (const p of o.partes || []) lista.push({ parte: p, objeto: o, indiceObjeto: io });
  });
  return lista;
}

/** Faixas de triângulos de cada parte, na mesma ordem de todasAsPartes(). */
export function faixasDasPartes(malha) {
  return todasAsPartes(malha).map(({ parte }) => ({
    primeiroTriangulo: parte.primeiroTriangulo,
    numTriangulos: parte.numTriangulos,
  }));
}

/** Quantos filamentos o usuário pode escolher (no mínimo os 4 do AMS). */
export function numFilamentos(malha) {
  let maior = Math.max(4, malha.filamentos ? malha.filamentos.length : 0);
  const resumo = malha.pinturaCor && malha.pinturaCor.resumo;
  if (resumo) maior = Math.max(maior, resumo.maiorEstado);
  for (const { parte, objeto } of todasAsPartes(malha)) maior = Math.max(maior, parte.extrusora || 0, objeto.extrusora || 0);
  return Math.min(maior, 32);
}

/** Cor de um filamento (1, 2, 3…) para a tela. */
export function corDoFilamento(malha, n) {
  const f = malha.filamentos && malha.filamentos[n - 1];
  if (f && /^#[0-9a-f]{6}/i.test(f.cor)) return f.cor.slice(0, 7).toUpperCase();
  return PALETA_EXEMPLO[(Math.max(1, n) - 1) % PALETA_EXEMPLO.length];
}

/** Filamento que a parte usa de fato (0 ou vazio = o do objeto). */
export function filamentoDaParte(parte, objeto) {
  return parte.extrusora > 0 ? parte.extrusora : (objeto.extrusora > 0 ? objeto.extrusora : 1);
}

/** Como desenhar cada parte na tela: cor e se é "fantasma" (modificador, negativa…). */
export function aparenciaDasPartes(malha) {
  return todasAsPartes(malha).map(({ parte, objeto }) => ({
    cor: corDoFilamento(malha, filamentoDaParte(parte, objeto)),
    fantasma: parte.subtipo && parte.subtipo !== 'normal_part',
    apagado: objeto.imprimivel === false,
  }));
}

/**
 * Troca o filamento de uma parte. Num objeto de uma parte só, o objeto acompanha
 * (como o Bambu Studio faz). Nesta etapa é uma troca direta; entra no histórico na 1.4.
 */
export function trocarFilamento(malha, indiceObjeto, indiceParte, filamento) {
  const o = malha.objetos[indiceObjeto];
  if (!o || !o.partes[indiceParte]) throw new Error('Parte não encontrada.');
  const n = Math.round(Number(filamento));
  if (!(n >= 1 && n <= numFilamentos(malha))) throw new Error(`Filamento ${filamento} não existe.`);
  o.partes[indiceParte].extrusora = n;
  const normais = o.partes.filter((p) => p.subtipo === 'normal_part');
  if (normais.length <= 1) o.extrusora = n;
}

/** Nome curto do filamento para a lista ("2 · PLA"). */
export function rotuloFilamento(malha, n) {
  const f = malha.filamentos && malha.filamentos[n - 1];
  return f && f.tipo ? `${n} · ${f.tipo}` : `${n}`;
}
