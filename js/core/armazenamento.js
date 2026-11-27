// Camada ÚNICA de armazenamento. Toda leitura e gravação do app passa por aqui.
//
// Hoje: adaptador local (IndexedDB no próprio navegador).
// Depois: um adaptador do Google Drive (pasta "Fatiador L.Y.K.E", escopo drive.file)
// entra ao lado deste, com as mesmas funções, sem mudar o resto do app.
//
// Coleções previstas:
//   preferencias        ajustes do app (ex.: modo leve)
//   projetos            projetos salvos (etapa 1.4)
//   pontos-restauracao  cópias de segurança do histórico (etapa 1.4)
//   perfis              perfis de folga, filamentos e preços

const NOME_BANCO = 'fatiador-lyke';
const VERSAO_BANCO = 1;
const COLECOES = ['preferencias', 'projetos', 'pontos-restauracao', 'perfis'];

function adaptadorIndexedDB() {
  let aberto = null;
  const abrir = () => {
    if (!aberto) {
      aberto = new Promise((resolver, rejeitar) => {
        const req = indexedDB.open(NOME_BANCO, VERSAO_BANCO);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const c of COLECOES) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c);
        };
        req.onsuccess = () => resolver(req.result);
        req.onerror = () => rejeitar(req.error);
        req.onblocked = () => rejeitar(new Error('Banco local bloqueado por outra aba.'));
      });
    }
    return aberto;
  };
  const operar = async (colecao, modo, fazer) => {
    const db = await abrir();
    return new Promise((resolver, rejeitar) => {
      const tx = db.transaction(colecao, modo);
      const req = fazer(tx.objectStore(colecao));
      tx.oncomplete = () => resolver(req ? req.result : undefined);
      tx.onerror = () => rejeitar(tx.error);
      tx.onabort = () => rejeitar(tx.error);
    });
  };
  return {
    nome: 'local',
    ler: (c, chave) => operar(c, 'readonly', (s) => s.get(chave)),
    gravar: (c, chave, valor) => operar(c, 'readwrite', (s) => s.put(valor, chave)),
    apagar: (c, chave) => operar(c, 'readwrite', (s) => s.delete(chave)),
    listar: (c) => operar(c, 'readonly', (s) => s.getAllKeys()),
  };
}

/** Se o navegador bloquear o IndexedDB (aba anônima, por exemplo), guarda só na memória. */
function adaptadorMemoria() {
  const dados = new Map();
  const col = (c) => {
    if (!dados.has(c)) dados.set(c, new Map());
    return dados.get(c);
  };
  return {
    nome: 'memória (não fica salvo)',
    ler: async (c, k) => col(c).get(k),
    gravar: async (c, k, v) => { col(c).set(k, v); },
    apagar: async (c, k) => { col(c).delete(k); },
    listar: async (c) => [...col(c).keys()],
  };
}

let adaptador = null;

async function obterAdaptador() {
  if (adaptador) return adaptador;
  try {
    if (typeof indexedDB === 'undefined') throw new Error('sem IndexedDB');
    const local = adaptadorIndexedDB();
    await local.listar('preferencias');
    adaptador = local;
  } catch (e) {
    console.warn('Armazenamento local indisponível; usando memória.', e);
    adaptador = adaptadorMemoria();
  }
  return adaptador;
}

export async function ler(colecao, chave, padrao = undefined) {
  try {
    const v = await (await obterAdaptador()).ler(colecao, chave);
    return v === undefined ? padrao : v;
  } catch (e) {
    console.warn('Falha ao ler', colecao, chave, e);
    return padrao;
  }
}

export async function gravar(colecao, chave, valor) {
  return (await obterAdaptador()).gravar(colecao, chave, valor);
}

export async function apagar(colecao, chave) {
  return (await obterAdaptador()).apagar(colecao, chave);
}

export async function listar(colecao) {
  return (await obterAdaptador()).listar(colecao);
}

export async function onde() {
  return (await obterAdaptador()).nome;
}

/** Para os testes ou para trocar pelo Drive no futuro. */
export function usarAdaptador(novo) {
  adaptador = novo;
}
