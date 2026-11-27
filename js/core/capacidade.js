// Mede a capacidade do aparelho (memória, placa de vídeo, teste rápido de velocidade)
// e decide o modo leve, o limite de triângulos na tela e o orçamento de memória.
// A decisão é pela CAPACIDADE MEDIDA, nunca pelo tipo de aparelho: um celular
// forte (ex.: Galaxy S23 Ultra) roda tudo; um PC de 4 GB entra no modo leve.

const RENDERIZADOR_SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

/** Limites por situação. Calibrar com os números reais do PC do Yuri. */
export const PERFIS = {
  fraco: { limiteTela: 150_000, orcamentoMB: 350, pixelMax: 1, sombras: false },
  leve: { limiteTela: 300_000, orcamentoMB: 600, pixelMax: 1, sombras: false },
  normal: { limiteTela: 1_500_000, orcamentoMB: 1500, pixelMax: 2, sombras: true },
};

// Teste de velocidade (ms para um trabalho fixo). PC atual ~1 a 2 ms.
const TESTE_LENTO = 5;
const TESTE_MUITO_LENTO = 15;

export function infoPlacaDeVideo() {
  const info = { renderizador: 'desconhecido', fabricante: '', software: false, texturaMax: 0, webgl2: false };
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { ...info, semWebGL: true };
    info.webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    info.texturaMax = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      info.renderizador = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
      info.fabricante = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || '');
    } else {
      info.renderizador = String(gl.getParameter(gl.RENDERER) || '');
    }
    info.software = RENDERIZADOR_SOFTWARE.test(info.renderizador);
    const perder = gl.getExtension('WEBGL_lose_context');
    if (perder) perder.loseContext();
  } catch {
    info.semWebGL = true;
  }
  return info;
}

/** Trabalho fixo de contas; devolve o melhor tempo de 3 rodadas, em ms. */
export function testeRapido() {
  let melhor = Infinity;
  let soma = 0;
  const a = new Float32Array(4096);
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    for (let i = 0; i < 600000; i++) {
      const j = i & 4095;
      a[j] = a[j] * 0.5 + Math.sqrt(i);
      soma += a[j];
    }
    const t = performance.now() - t0;
    if (t < melhor) melhor = t;
  }
  if (soma === -1) console.log(soma); // impede o navegador de pular a conta
  return Math.round(melhor * 100) / 100;
}

export function medirCapacidade() {
  const memoriaGB = typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : null;
  const nucleos = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || null;
  const gpu = infoPlacaDeVideo();
  const testeMs = testeRapido();
  const heap = typeof performance !== 'undefined' && performance.memory ? performance.memory.jsHeapSizeLimit : null;

  const motivos = [];
  let nivel = 'forte';
  if (gpu.semWebGL) { nivel = 'fraco'; motivos.push('sem WebGL'); }
  if (gpu.software) { nivel = 'fraco'; motivos.push('vídeo por software'); }
  if (memoriaGB !== null && memoriaGB <= 2) { nivel = 'fraco'; motivos.push(`${memoriaGB} GB de memória`); }
  if (testeMs > TESTE_MUITO_LENTO) { nivel = 'fraco'; motivos.push('processador lento'); }
  if (gpu.texturaMax && gpu.texturaMax < 4096) { nivel = 'fraco'; motivos.push('placa de vídeo simples'); }
  if (nivel === 'forte') {
    if (memoriaGB !== null && memoriaGB <= 4) { nivel = 'medio'; motivos.push(`${memoriaGB} GB de memória`); }
    if (testeMs > TESTE_LENTO) { nivel = 'medio'; motivos.push('processador mais lento'); }
  }
  return {
    memoriaGB,
    nucleos,
    gpu,
    testeMs,
    heapLimiteMB: heap ? Math.round(heap / 1048576) : null,
    nivel, // 'fraco' | 'medio' | 'forte'
    modoLeveAuto: nivel !== 'forte',
    avisarOutroAparelho: nivel === 'fraco',
    motivos,
  };
}

/**
 * Perfil em uso. preferencia: 'auto' | 'ligado' | 'desligado'.
 */
export function perfilEmUso(capacidade, preferencia = 'auto') {
  const leve = preferencia === 'ligado' || (preferencia === 'auto' && capacidade.modoLeveAuto);
  let base;
  if (!leve) base = PERFIS.normal;
  else if (capacidade.nivel === 'fraco') base = PERFIS.fraco;
  else base = PERFIS.leve;
  return { ...base, modoLeve: leve, preferencia };
}
