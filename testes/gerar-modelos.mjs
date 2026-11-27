// Gera modelos de teste (esfera, cubo, 3MF no estilo do Bambu Studio).
// Uso: import { ... } from './gerar-modelos.mjs'   ou   node testes/gerar-modelos.mjs

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const aqui = dirname(fileURLToPath(import.meta.url));
export const PASTA_GERADOS = join(aqui, 'gerados');

/** Esfera UV indexada e fechada: 2 * aneis * (segmentos) - 2*segmentos triângulos aprox. */
export function esfera(raio = 20, aneis = 16, segmentos = 32, centro = [0, 0, raio]) {
  const pos = [];
  pos.push(centro[0], centro[1], centro[2] + raio); // polo norte
  for (let r = 1; r < aneis; r++) {
    const th = (Math.PI * r) / aneis;
    for (let s = 0; s < segmentos; s++) {
      const ph = (2 * Math.PI * s) / segmentos;
      pos.push(
        centro[0] + raio * Math.sin(th) * Math.cos(ph),
        centro[1] + raio * Math.sin(th) * Math.sin(ph),
        centro[2] + raio * Math.cos(th),
      );
    }
  }
  pos.push(centro[0], centro[1], centro[2] - raio); // polo sul
  const sul = pos.length / 3 - 1;
  const idx = [];
  const v = (r, s) => 1 + (r - 1) * segmentos + (s % segmentos);
  for (let s = 0; s < segmentos; s++) idx.push(0, v(1, s), v(1, s + 1));
  for (let r = 1; r < aneis - 1; r++) {
    for (let s = 0; s < segmentos; s++) {
      idx.push(v(r, s), v(r + 1, s), v(r + 1, s + 1));
      idx.push(v(r, s), v(r + 1, s + 1), v(r, s + 1));
    }
  }
  for (let s = 0; s < segmentos; s++) idx.push(sul, v(aneis - 1, s + 1), v(aneis - 1, s));
  return { posicoes: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Cubo de lado L com um canto na origem. */
export function cubo(L = 10, origem = [0, 0, 0]) {
  const [ox, oy, oz] = origem;
  const p = [];
  for (const z of [0, L]) for (const y of [0, L]) for (const x of [0, L]) p.push(ox + x, oy + y, oz + z);
  // índices: (x,y,z) -> x + 2y + 4z
  const f = [
    [0, 2, 3, 1], [4, 5, 7, 6], // baixo, cima
    [0, 1, 5, 4], [2, 6, 7, 3], // frente, trás
    [0, 4, 6, 2], [1, 3, 7, 5], // esquerda, direita
  ];
  const idx = [];
  for (const [a, b, c, d] of f) idx.push(a, b, c, a, c, d);
  return { posicoes: new Float32Array(p), indices: new Uint32Array(idx), quads: f };
}

export function stlBinario({ posicoes, indices }) {
  const n = indices.length / 3;
  const buf = Buffer.alloc(84 + n * 50);
  buf.write('Fatiador LYKE teste', 0);
  buf.writeUInt32LE(n, 80);
  let o = 84;
  for (let t = 0; t < n; t++) {
    o += 12; // normal zero
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      buf.writeFloatLE(posicoes[v * 3], o);
      buf.writeFloatLE(posicoes[v * 3 + 1], o + 4);
      buf.writeFloatLE(posicoes[v * 3 + 2], o + 8);
      o += 12;
    }
    o += 2;
  }
  return buf;
}

export function stlTexto({ posicoes, indices }, nome = 'cubo') {
  let s = `solid ${nome}\n`;
  for (let t = 0; t < indices.length / 3; t++) {
    s += '  facet normal 0 0 0\n    outer loop\n';
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      s += `      vertex ${posicoes[v * 3]} ${posicoes[v * 3 + 1]} ${posicoes[v * 3 + 2]}\n`;
    }
    s += '    endloop\n  endfacet\n';
  }
  return s + `endsolid ${nome}\n`;
}

/** OBJ com quadriláteros, "o" e índices negativos na segunda peça. */
export function objCubos() {
  const a = cubo(10);
  const b = cubo(5, [20, 0, 0]);
  let s = '# teste\no Cubo grande\n';
  for (let i = 0; i < 8; i++) s += `v ${a.posicoes[i * 3]} ${a.posicoes[i * 3 + 1]} ${a.posicoes[i * 3 + 2]}\n`;
  for (const q of a.quads) s += `f ${q.map((v) => `${v + 1}/1/1`).join(' ')}\n`;
  s += 'o Cubo pequeno\n';
  for (let i = 0; i < 8; i++) s += `v ${b.posicoes[i * 3]} ${b.posicoes[i * 3 + 1]} ${b.posicoes[i * 3 + 2]}\n`;
  for (const q of b.quads) s += `f ${q.map((v) => v - 8).join(' ')}\n`;
  return s;
}

function malhaXml({ posicoes, indices }, pintar = false) {
  let s = '<mesh><vertices>';
  for (let i = 0; i < posicoes.length; i += 3) s += `<vertex x="${posicoes[i]}" y="${posicoes[i + 1]}" z="${posicoes[i + 2]}"/>`;
  s += '</vertices><triangles>';
  for (let t = 0; t < indices.length; t += 3) {
    const pc = pintar && t % 2 === 0 ? ' paint_color="8"' : '';
    s += `<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}"${pc}/>`;
  }
  return s + '</triangles></mesh>';
}

/**
 * 3MF no estilo do Bambu Studio: modelo principal com componentes que apontam
 * para 3D/Objects/object_1.model, transformação de posição na placa, pintura e
 * um objeto com nome acentuado.
 */
export async function bambu3mf() {
  const corpo = cubo(10);
  const olho = esfera(3, 8, 12, [0, 0, 0]);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/Objects/object_1.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <!-- peças do boneco -->
 <resources>
  <object id="1" type="model">${malhaXml(corpo, true)}</object>
  <object id="2" type="model">${malhaXml(olho)}</object>
 </resources>
</model>`);
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">BambuStudio-02.03.00.70</metadata>
 <resources>
  <object id="3" p:UUID="00000001-61cb-4c03-9d28-80fed5dfa1dc" type="model" name="Boneco &amp; olho">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
    <component p:path="/3D/Objects/object_1.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 5 0 10"/>
   </components>
  </object>
  <object id="4" type="model" name="Peça espelhada"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
 </resources>
 <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">
  <item objectid="3" p:UUID="00000002-b1ec-4553-aec9-835e5b724bb4" transform="1 0 0 0 1 0 0 0 1 128 128 0" printable="1"/>
  <item objectid="4" transform="-1 0 0 0 1 0 0 0 1 50 0 0" printable="1"/>
 </build>
</model>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Grava os arquivos de teste em testes/gerados/ (só se ainda não existem). */
export async function gerarTodos({ pesado = true } = {}) {
  mkdirSync(PASTA_GERADOS, { recursive: true });
  const gravar = (nome, dados) => {
    const c = join(PASTA_GERADOS, nome);
    if (!existsSync(c)) writeFileSync(c, dados);
    return c;
  };
  const arquivos = {
    esferaStl: gravar('esfera.stl', stlBinario(esfera(20, 48, 96))),
    cuboTexto: gravar('cubo-texto.stl', stlTexto(cubo(10))),
    cubosObj: gravar('cubos.obj', objCubos()),
    bambu: gravar('boneco-bambu.3mf', await bambu3mf()),
  };
  if (pesado) {
    // ~1 milhão de triângulos, ~50 MB: o "modelo pesado" do modo leve
    arquivos.pesado = gravar('pesado-1M.stl', stlBinario(esfera(60, 500, 1000)));
  }
  return arquivos;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = await gerarTodos();
  console.log(a);
}
