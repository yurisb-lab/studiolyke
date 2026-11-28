// Gera modelos de teste (esfera, cubo, 3MF no estilo do Bambu Studio).
// Uso: import { ... } from './gerar-modelos.mjs'   ou   node testes/gerar-modelos.mjs

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { nibblesParaTexto, pintarPorRegiao } from '../js/io/pintura-bambu.js';

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

function malhaXmlPintada({ posicoes, indices }, pinturas) {
  let s = '<mesh><vertices>';
  for (let i = 0; i < posicoes.length; i += 3) s += `<vertex x="${posicoes[i]}" y="${posicoes[i + 1]}" z="${posicoes[i + 2]}"/>`;
  s += '</vertices><triangles>';
  for (let t = 0; t < indices.length; t += 3) {
    const extra = pinturas[(t / 3) % pinturas.length] || '';
    s += `<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}"${extra}/>`;
  }
  return s + '</triangles></mesh>';
}

// Pinturas de exemplo (formato do Bambu: árvore de subdivisão em hexadecimal).
// '40C03C3' = triângulo dividido em 4: pedaços nas cores 1, 3, 0 e 6.
export const PINTURAS_EXEMPLO = ['', ' paint_color="4"', ' paint_color="0C" paint_supports="8"', ' paint_color="40C03C3"', ''];

/**
 * Projeto completo do Bambu Studio para testar a ida e volta:
 *   - 4 filamentos (project_settings.config)
 *   - "Boneco": 3 partes (corpo pintado no filamento 1, olho no 3 deslocado, modificador)
 *   - "Peça espelhada": espelhada e girada, com 2 instâncias, filamento 2, na placa 2
 *   - "Etiqueta": não imprime
 *   - arquivos que voltam iguais (miniatura, G-code por camada) e que saem (G-code, slice_info)
 * Usa o arranjo "production" (3D/Objects/object_1.model), como o Bambu grava.
 */
export async function bambuProjeto3mf() {
  const corpo = cubo(10);
  const olho = esfera(3, 8, 12, [0, 0, 0]);
  const mod = cubo(4, [3, 3, 3]);
  const espelhada = cubo(6);
  const etiqueta = cubo(2);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="config" ContentType="text/xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/><Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/></Relationships>');
  zip.file('3D/Objects/object_1.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <resources>
  <object id="1" type="model">${malhaXmlPintada(corpo, PINTURAS_EXEMPLO)}</object>
  <object id="2" type="model">${malhaXml(olho)}</object>
  <object id="3" type="model">${malhaXml(mod)}</object>
  <object id="4" type="model">${malhaXmlPintada(espelhada, [' paint_color="8"', ''])}</object>
  <object id="5" type="model">${malhaXml(etiqueta)}</object>
 </resources>
</model>`);
  const p = 'p:path="/3D/Objects/object_1.model"';
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">BambuStudio-02.08.02.61</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">Projeto de teste</metadata>
 <resources>
  <object id="10" type="model"><components>
   <component ${p} objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   <component ${p} objectid="2" transform="1 0 0 0 1 0 0 0 1 5 0 10"/>
   <component ${p} objectid="3" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
  </components></object>
  <object id="11" type="model"><components><component ${p} objectid="4" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>
  <object id="12" type="model"><components><component ${p} objectid="5" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>
 </resources>
 <build>
  <item objectid="10" transform="1 0 0 0 1 0 0 0 1 128 128 0" printable="1"/>
  <item objectid="11" transform="0 -1 0 -1 0 0 0 0 1 435.25 120.125 0" printable="1"/>
  <item objectid="11" transform="0 -1 0 -1 0 0 0 0 1 455.75 130.5 0" printable="1"/>
  <item objectid="12" transform="1 0 0 0 1 0 0 0 1 60 60 0" printable="0"/>
 </build>
</model>`);
  const meta = (k, v) => `<metadata key="${k}" value="${v}"/>`;
  const inst = (o, i, ident) => `<model_instance>${meta('object_id', o)}${meta('instance_id', i)}${meta('identify_id', ident)}</model_instance>`;
  zip.file('Metadata/model_settings.config', `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="10">${meta('name', 'Boneco &amp; olho')}${meta('extruder', '1')}${meta('brim_type', 'outer_only')}
    <part id="1" subtype="normal_part">${meta('name', 'Corpo')}${meta('matrix', '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1')}${meta('extruder', '1')}</part>
    <part id="2" subtype="normal_part">${meta('name', 'Olho')}${meta('matrix', '1 0 0 5 0 1 0 0 0 0 1 10 0 0 0 1')}${meta('extruder', '3')}</part>
    <part id="3" subtype="modifier_part">${meta('name', 'Reforço')}${meta('matrix', '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1')}${meta('wall_loops', '4')}</part>
  </object>
  <object id="11">${meta('name', 'Peça espelhada')}${meta('extruder', '2')}
    <part id="4" subtype="normal_part">${meta('name', 'Peça espelhada')}${meta('matrix', '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1')}${meta('extruder', '2')}</part>
  </object>
  <object id="12">${meta('name', 'Etiqueta')}${meta('extruder', '4')}
    <part id="5" subtype="normal_part">${meta('name', 'Etiqueta')}${meta('matrix', '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1')}${meta('extruder', '4')}</part>
  </object>
  <plate>${meta('plater_id', '1')}${meta('plater_name', 'Frente')}${meta('locked', 'false')}${meta('thumbnail_file', 'Metadata/plate_1.png')}${meta('gcode_file', 'Metadata/plate_1.gcode')}${meta('first_layer_print_sequence', '1 3')}${inst(10, 0, 100)}${inst(12, 0, 103)}</plate>
  <plate>${meta('plater_id', '2')}${meta('plater_name', '')}${meta('locked', 'true')}${inst(11, 0, 101)}${inst(11, 1, 102)}</plate>
  <assemble><assemble_item object_id="10" instance_id="0" transform="1 0 0 0 1 0 0 0 1 128 128 0" offset="0 0 0"/></assemble>
</config>`);
  zip.file('Metadata/project_settings.config', JSON.stringify({
    filament_colour: ['#1A1A1A', '#1B2A6B', '#D9C49A', '#FFFFFF'],
    filament_type: ['PLA', 'PLA', 'PETG', 'PLA'],
    filament_settings_id: ['Bambu PLA Basic @BBL A1', 'Bambu PLA Basic @BBL A1', 'Bambu PETG HF @BBL A1', 'eSUN PLA+ @BBL A1'],
    filament_vendor: ['Bambu Lab', 'Bambu Lab', 'Bambu Lab', 'eSUN'],
    printer_model: 'Bambu Lab A1',
  }, null, 4));
  zip.file('Metadata/plate_1.png', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
  zip.file('Metadata/custom_gcode_per_layer.xml', '<?xml version="1.0" encoding="utf-8"?><custom_gcodes_per_layer><plate><plate_info id="1"/></plate></custom_gcodes_per_layer>');
  zip.file('Metadata/layer_config_ranges.xml', '<?xml version="1.0" encoding="utf-8"?><objects><object id="1"/></objects>');
  zip.file('Metadata/plate_1.gcode', '; G-code velho\nG28\n');
  zip.file('Metadata/slice_info.config', '<?xml version="1.0"?><config/>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---------- cubo de conferência da pintura ----------

/** Cubo de lado L com 8 vértices e a ordem de cada triângulo conhecida (normais para fora). */
export function cuboConferencia(L = 30) {
  const posicoes = [0, 0, 0, L, 0, 0, L, L, 0, 0, L, 0, 0, 0, L, L, 0, L, L, L, L, 0, L, L];
  // 0 (0,0,0) 1 (L,0,0) 2 (L,L,0) 3 (0,L,0) 4 (0,0,L) 5 (L,0,L) 6 (L,L,L) 7 (0,L,L)
  const faces = {
    baixo: [[0, 3, 2], [0, 2, 1]],
    cima: [[4, 5, 6], [4, 6, 7]],
    frente: [[0, 1, 5], [0, 5, 4]], // y = 0: (BL, BR, TR) e (BL, TR, TL)
    tras: [[3, 7, 6], [3, 6, 2]],
    esquerda: [[0, 4, 7], [0, 7, 3]],
    direita: [[1, 2, 6], [1, 6, 5]],
  };
  const indices = Object.values(faces).flat().flat();
  return { posicoes, indices, faces, L };
}

/** A letra F no topo do cubo (coordenadas do cubo, em mm): 2 = azul, 0 = sem pintura. */
export function letraF(L) {
  return (x, y) => {
    const u = x / L, v = y / L;
    const haste = u >= 0.25 && u <= 0.42 && v >= 0.15 && v <= 0.85;
    const topo = u >= 0.25 && u <= 0.78 && v >= 0.68 && v <= 0.85;
    const meio = u >= 0.25 && u <= 0.64 && v >= 0.44 && v <= 0.58;
    return haste || topo || meio ? 2 : 0;
  };
}

/** Código de pintura (texto do Bambu) de cada triângulo do cubo de conferência. */
export function pinturasConferencia(cubo, profundidade = 7) {
  const { posicoes: p, indices, L } = cubo;
  const F = letraF(L);
  const v = (i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  const codigos = [];
  for (let t = 0; t < indices.length; t += 3) codigos.push('');
  // topo (triângulos 2 e 3): a letra F, com a pintura fina do Bambu
  for (const t of [2, 3]) {
    const [a, b, c] = indices.slice(t * 3, t * 3 + 3).map(v);
    codigos[t] = nibblesParaTexto(Uint8Array.from(pintarPorRegiao(a, b, c, (x, y) => F(x, y), profundidade, 4)));
  }
  // frente: 1 lado dividido (triângulo azul apoiado na borda de baixo, ponta no centro)
  codigos[4] = '085';
  // frente: 2 lados divididos (triangulinho bege no canto de cima à esquerda)
  codigos[5] = '0C00A';
  return codigos;
}

/**
 * 3MF para conferir a pintura no Bambu Studio: dois cubos brancos de 30 mm.
 * Cubo da esquerda: F azul em cima (legível de cima, com a frente virada para você);
 * na frente, triângulo azul na borda de baixo com a ponta no centro e triangulinho
 * bege no canto de cima à esquerda. Cubo da direita: o mesmo, espelhado.
 */
export async function conferenciaPintura3mf() {
  const cubo = cuboConferencia(30);
  const codigos = pinturasConferencia(cubo);
  const { posicoes, indices } = cubo;
  let malhaTxt = '<mesh><vertices>';
  for (let i = 0; i < posicoes.length; i += 3) malhaTxt += `<vertex x="${posicoes[i]}" y="${posicoes[i + 1]}" z="${posicoes[i + 2]}"/>`;
  malhaTxt += '</vertices><triangles>';
  for (let t = 0; t < indices.length; t += 3) {
    const c = codigos[t / 3];
    malhaTxt += `<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}"${c ? ` paint_color="${c}"` : ''}/>`;
  }
  malhaTxt += '</triangles></mesh>';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <metadata name="Application">BambuStudio-02.08.02.61</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
  <object id="1" type="model">${malhaTxt}</object>
  <object id="2" type="model"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>
  <object id="3" type="model">${malhaTxt}</object>
  <object id="4" type="model"><components><component objectid="3" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>
 </resources>
 <build>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 70 113 0" printable="1"/>
  <item objectid="4" transform="-1 0 0 0 1 0 0 0 1 186 113 0" printable="1"/>
 </build>
</model>`);
  const meta = (k, v) => `<metadata key="${k}" value="${v}"/>`;
  const obj = (id, parte, nome) => `<object id="${id}">${meta('name', nome)}${meta('extruder', '4')}<part id="${parte}" subtype="normal_part">${meta('name', nome)}${meta('matrix', '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1')}${meta('extruder', '4')}</part></object>`;
  zip.file('Metadata/model_settings.config', `<?xml version="1.0" encoding="UTF-8"?>
<config>
  ${obj(2, 1, 'Cubo F')}
  ${obj(4, 3, 'Cubo F espelhado')}
  <plate>${meta('plater_id', '1')}${meta('plater_name', 'Conferência da pintura')}${meta('locked', 'false')}<model_instance>${meta('object_id', '2')}${meta('instance_id', '0')}${meta('identify_id', '100')}</model_instance><model_instance>${meta('object_id', '4')}${meta('instance_id', '0')}${meta('identify_id', '101')}</model_instance></plate>
</config>`);
  zip.file('Metadata/project_settings.config', JSON.stringify({
    filament_colour: ['#1A1A1A', '#1B2A6B', '#D9C49A', '#FFFFFF'],
    filament_type: ['PLA', 'PLA', 'PLA', 'PLA'],
    filament_settings_id: ['eSUN PLA+ @BBL A1', 'eSUN PLA+ @BBL A1', 'eSUN PLA+ @BBL A1', 'eSUN PLA+ @BBL A1'],
    filament_vendor: ['eSUN', 'eSUN', 'eSUN', 'eSUN'],
    printer_model: 'Bambu Lab A1',
  }, null, 4));
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
    projeto: gravar('projeto-bambu.3mf', await bambuProjeto3mf()),
    conferencia: gravar('conferencia-pintura.3mf', await conferenciaPintura3mf()),
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
