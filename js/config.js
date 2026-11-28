// Configurações gerais do Fatiador L.Y.K.E 3D.
// Nenhum segredo fica aqui (nem em lugar nenhum do código).

export const VERSAO = 'v0.0.3';

// Bibliotecas pelo CDN, sempre com versão fixa.
// O importmap do index.html usa os mesmos endereços; os Web Workers não enxergam
// o importmap, por isso importam direto daqui.
export const CDN = {
  three: 'https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js',
  threeAddons: 'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/',
  meshoptSimplificador: 'https://cdn.jsdelivr.net/npm/meshoptimizer@1.3.0/meshopt_simplifier.js',
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js',
};

// Google Drive (para depois): ID de cliente OAuth com escopo drive.file.
// Fica vazio até o Drive ser ligado. Não é segredo, mas também não é senha.
export const GOOGLE_CLIENT_ID = '';

// Versão do Bambu Studio gravada nos 3MF exportados (a mesma do PC do Yuri).
// Se o arquivo aberto já veio de um Bambu Studio, a versão dele é mantida.
export const BAMBU_APLICACAO = 'BambuStudio-02.08.02.61';

// Impressora padrão (mm).
export const IMPRESSORA = {
  nome: 'Bambu Lab A1',
  mesaX: 256,
  mesaY: 256,
  alturaMax: 256,
};
