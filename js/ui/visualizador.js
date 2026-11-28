// Visualizador 3D (three.js). Eixo Z para cima, como no Bambu Studio; tudo em mm.
// Desenha só quando algo muda (sem laço contínuo), para poupar o PC e a bateria.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { IMPRESSORA } from '../config.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const COR_PECA = 0xdfe3e8;
const COR_MESA = 0x22262d;
const COR_GRADE = 0x2f343c;
const COR_GRADE_FORTE = 0x3d444f;
const COR_BORDA = 0x59616e;
const COR_SELECAO = 0xff8a3d; // a cor de destaque do app

// Profundidade para a seleção: distância da câmera (mm) / longe, guardada em 24 bits (RGB).
const PROFUNDIDADE_VERTICE = `
varying float vDist;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const PROFUNDIDADE_FRAGMENTO = `
precision highp float;
uniform float uLonge;
varying float vDist;
void main() {
  float v = floor(clamp(vDist / uLonge, 0.0, 1.0) * 16777215.0);
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
}`;

export const VISTAS = {
  iso: new THREE.Vector3(0.75, -1, 0.7),
  frente: new THREE.Vector3(0, -1, 0.0001),
  cima: new THREE.Vector3(0, -0.0001, 1),
  lado: new THREE.Vector3(1, 0, 0.0001),
};

export class Visualizador {
  constructor(container, perfil, { aoPerderContexto } = {}) {
    this.container = container;
    this.perfil = perfil;
    this.renderer = new THREE.WebGLRenderer({
      antialias: !perfil.modoLeve,
      powerPreference: perfil.modoLeve ? 'default' : 'high-performance',
    });
    this.renderer.setClearColor(0x15171a, 1);
    this.renderer.domElement.className = 'tela-3d';
    this.renderer.domElement.setAttribute('aria-label', 'Visualização 3D da peça');
    container.prepend(this.renderer.domElement);

    this.cena = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    this.cena.add(this.camera);

    // Luz: céu + chave fixa (com sombra no modo normal) + luz que acompanha a câmera.
    this.cena.add(new THREE.HemisphereLight(0xffffff, 0x3a3f48, 1.4));
    this.luzChave = new THREE.DirectionalLight(0xffffff, 1.6);
    this.luzChave.position.set(-120, -160, 260);
    this.cena.add(this.luzChave, this.luzChave.target);
    const farol = new THREE.DirectionalLight(0xffffff, 0.9);
    farol.position.set(0, 0, 0);
    farol.target.position.set(0, 0, -1);
    this.camera.add(farol, farol.target);

    this.cena.add(this._criarMesa());
    this.sombra = new THREE.Mesh(
      new THREE.PlaneGeometry(IMPRESSORA.mesaX * 3, IMPRESSORA.mesaY * 3),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    this.sombra.position.z = -0.04;
    this.sombra.receiveShadow = true;
    this.cena.add(this.sombra);

    this.grupoModelo = new THREE.Group();
    this.cena.add(this.grupoModelo);
    this.peca = null;
    this.detalhe = null; // pedaços reais da pintura fina (malha à parte)
    this.selecao = null; // destaque da seleção (grupo com 2 malhas)
    this.caixa = null;
    this.trianguloNaTela = 0;
    this.bytesGpu = 0;

    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.enableDamping = false;
    this.controles.screenSpacePanning = true;
    this.controles.zoomToCursor = true;
    this.controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controles.addEventListener('change', () => this.desenhar());

    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (aoPerderContexto) aoPerderContexto();
    });
    canvas.addEventListener('webglcontextrestored', () => this.desenhar());

    this._observador = new ResizeObserver(() => this.redimensionar());
    this._observador.observe(container);
    this.aplicarPerfil(perfil);
    this.redimensionar();
    this.enquadrar('iso');
  }

  _criarMesa() {
    const { mesaX: X, mesaY: Y } = IMPRESSORA;
    const g = new THREE.Group();
    g.name = 'mesa';
    const placa = new THREE.Mesh(
      new THREE.PlaneGeometry(X, Y),
      new THREE.MeshBasicMaterial({ color: COR_MESA }),
    );
    placa.position.z = -0.12;
    g.add(placa);
    const fina = [], forte = [];
    for (let x = -X / 2; x <= X / 2 + 0.01; x += 10) {
      const alvo = Math.round(x + X / 2) % 50 === 0 ? forte : fina;
      alvo.push(x, -Y / 2, 0, x, Y / 2, 0);
    }
    for (let y = -Y / 2; y <= Y / 2 + 0.01; y += 10) {
      const alvo = Math.round(y + Y / 2) % 50 === 0 ? forte : fina;
      alvo.push(-X / 2, y, 0, X / 2, y, 0);
    }
    const linhas = (pos, cor) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: cor }));
      l.position.z = -0.08;
      return l;
    };
    g.add(linhas(fina, COR_GRADE), linhas(forte, COR_GRADE_FORTE));
    const borda = [-X / 2, -Y / 2, 0, X / 2, -Y / 2, 0, X / 2, -Y / 2, 0, X / 2, Y / 2, 0,
      X / 2, Y / 2, 0, -X / 2, Y / 2, 0, -X / 2, Y / 2, 0, -X / 2, -Y / 2, 0];
    const b = linhas(borda, COR_BORDA);
    b.position.z = -0.06;
    g.add(b);
    return g;
  }

  aplicarPerfil(perfil) {
    this.perfil = perfil;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, perfil.pixelMax));
    const sombras = !!perfil.sombras;
    this.renderer.shadowMap.enabled = sombras;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.luzChave.castShadow = sombras;
    this.luzChave.shadow.mapSize.set(2048, 2048);
    this.sombra.visible = sombras;
    if (this.peca) this.peca.castShadow = sombras;
    if (this.detalhe) this.detalhe.castShadow = sombras;
    this.cena.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    this.redimensionar();
  }

  redimensionar() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.perfil.pixelMax));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.desenhar();
  }

  desenhar() {
    if (this._pendente) return;
    this._pendente = true;
    requestAnimationFrame(() => {
      this._pendente = false;
      this.renderer.render(this.cena, this.camera);
    });
  }

  /** Tira a peça da tela e libera a memória da placa de vídeo. */
  limpar() {
    this.limparSelecao();
    if (this.peca) {
      this.grupoModelo.remove(this.peca);
      this.peca.geometry.dispose();
      this.peca = null;
    }
    this._tirarDetalhe();
    this._descartarMateriais();
    this.caixa = null;
    this.trianguloNaTela = 0;
    this.bytesGpu = 0;
    this.desenhar();
  }

  /**
   * Mostra uma malha {posicoes, indices}. A caixa é a da malha completa:
   * a peça é apoiada na mesa (z = 0) e centralizada, só na tela; os dados não mudam.
   */
  mostrar(malhaTela, caixa, aparencia = null) {
    const enquadrarDepois = !this.peca;
    this.limparSelecao(); // o destaque usa a geometria antiga: o app refaz depois
    if (this.peca) {
      this.grupoModelo.remove(this.peca);
      this.peca.geometry.dispose();
    }
    this._tirarDetalhe();
    const geo = new THREE.BufferGeometry();
    // A placa de vídeo só aceita precisão simples (o 3MF guarda em dupla).
    const pos = malhaTela.posicoes instanceof Float32Array ? malhaTela.posicoes : new Float32Array(malhaTela.posicoes);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(malhaTela.indices, 1));
    const [x0, y0, z0] = caixa.min, [x1, y1, z1] = caixa.max;
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    this.peca = new THREE.Mesh(geo, this._material(COR_PECA));
    this.peca.castShadow = !!this.perfil.sombras;
    this.peca.name = 'peca';
    this.grupoModelo.add(this.peca);
    this.grupoModelo.position.set(-(x0 + x1) / 2, -(y0 + y1) / 2, -z0);
    this.caixa = caixa;
    this.trianguloNaTela = malhaTela.indices.length / 3;
    this.bytesGpu = pos.byteLength + malhaTela.indices.byteLength;
    this.bytesCopia = pos === malhaTela.posicoes ? 0 : pos.byteLength;
    if (malhaTela.detalhe && malhaTela.detalhe.posicoes.length) {
      const d = malhaTela.detalhe;
      const gd = new THREE.BufferGeometry();
      gd.setAttribute('position', new THREE.BufferAttribute(d.posicoes, 3));
      gd.boundingBox = geo.boundingBox.clone();
      gd.boundingSphere = geo.boundingSphere.clone();
      this.detalhe = new THREE.Mesh(gd, this._material(COR_PECA));
      this.detalhe.castShadow = !!this.perfil.sombras;
      this.detalhe.name = 'pintura-fina';
      this.grupoModelo.add(this.detalhe);
      this.trianguloNaTela += d.posicoes.length / 9;
      this.bytesGpu += d.posicoes.byteLength;
    }
    if (aparencia) this.colorir(aparencia.faixas, aparencia.partes, aparencia.detalhe);
    this._ajustarSombra();
    if (enquadrarDepois) this.enquadrar('iso');
    else this.desenhar();
  }

  /**
   * Pinta cada faixa de triângulos (uma por parte) com a cor do filamento.
   * Usa grupos da mesma geometria: não copia nada da malha.
   * @param {{primeiroTriangulo:number, numTriangulos:number}[]} faixas
   * @param {{cor:string, fantasma?:boolean, apagado?:boolean}[]} partes
   */
  colorir(faixas, partes, detalhe = null) {
    if (!this.peca) return;
    if (this.detalhe && detalhe) this._colorirMalha(this.detalhe, detalhe.faixas, detalhe.partes);
    this._colorirMalha(this.peca, faixas, partes);
    this.desenhar();
  }

  _tirarDetalhe() {
    if (!this.detalhe) return;
    this.grupoModelo.remove(this.detalhe);
    this.detalhe.geometry.dispose();
    this.detalhe = null;
  }

  _colorirMalha(malha3d, faixas, partes) {
    const geo = malha3d.geometry;
    geo.clearGroups();
    const materiais = [];
    const indiceDe = new Map();
    let atual = null;
    faixas.forEach((f, k) => {
      if (!f.numTriangulos) return;
      const a = partes[k] || { cor: '#DFE3E8' };
      const chave = `${a.cor}|${a.fantasma ? 1 : 0}|${a.apagado ? 1 : 0}`;
      if (!indiceDe.has(chave)) {
        indiceDe.set(chave, materiais.length);
        materiais.push(this._material(a.cor, a));
      }
      const mi = indiceDe.get(chave);
      if (atual && atual.materialIndex === mi && atual.start + atual.count === f.primeiroTriangulo * 3) {
        atual.count += f.numTriangulos * 3;
      } else {
        geo.addGroup(f.primeiroTriangulo * 3, f.numTriangulos * 3, mi);
        atual = geo.groups[geo.groups.length - 1];
      }
    });
    malha3d.material = materiais.length ? materiais : this._material(COR_PECA);
  }

  /** Material por cor, guardado para reaproveitar. */
  _material(cor, { fantasma = false, apagado = false } = {}) {
    if (!this._materiais) this._materiais = new Map();
    const c = new THREE.Color(cor);
    if (apagado) c.lerp(new THREE.Color(0x6b7280), 0.65);
    const chave = `${c.getHexString()}|${fantasma}`;
    if (this._materiais.has(chave)) return this._materiais.get(chave);
    const mat = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.6,
      metalness: 0,
      flatShading: true, // normais calculadas na placa de vídeo: não gasta memória
      side: THREE.DoubleSide,
      transparent: fantasma,
      opacity: fantasma ? 0.35 : 1,
      depthWrite: !fantasma,
    });
    // Triângulos menores que um pixel dão normal inválida (vira ponto preto).
    // Nesse caso usamos uma normal virada para a câmera.
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace(
          'vec3 normal = normalize( cross( fdx, fdy ) );',
          'vec3 nCruz = cross( fdx, fdy ); vec3 normal = dot( nCruz, nCruz ) > 1e-24 ? normalize( nCruz ) : vec3( 0.0, 0.0, 1.0 );',
        ),
      );
    };
    this._materiais.set(chave, mat);
    return mat;
  }

  _descartarMateriais() {
    if (!this._materiais) return;
    for (const m of this._materiais.values()) m.dispose();
    this._materiais.clear();
  }

  /** Cores das partes na tela (para os testes): [{ cor, triangulos }]. */
  coresNaTela() {
    if (!this.peca) return [];
    const soma = new Map();
    for (const m of [this.peca, this.detalhe]) {
      if (!m) continue;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const geo = m.geometry;
      const total = geo.index ? geo.index.count : geo.attributes.position.count;
      const grupos = geo.groups.length ? geo.groups : [{ start: 0, count: total, materialIndex: 0 }];
      for (const g of grupos) {
        const cor = `#${mats[g.materialIndex].color.getHexString().toUpperCase()}`;
        soma.set(cor, (soma.get(cor) || 0) + g.count / 3);
      }
    }
    return [...soma].map(([cor, triangulos]) => ({ cor, triangulos }));
  }

  /**
   * Foto quadrada da peça (PNG), para a miniatura do 3MF quando o arquivo não tem uma.
   * Vista 3D, fundo transparente, sem a mesa.
   */
  async capturarMiniatura(lado = 512) {
    if (!this.peca || !this.caixa) return null;
    const alvo = new THREE.WebGLRenderTarget(lado, lado);
    const cam = new THREE.PerspectiveCamera(this.camera.fov, 1, 1, 5000);
    cam.add(...this.camera.children.map((c) => c.clone()));
    const [sx, sy, sz] = this.caixa.tamanho;
    const centro = new THREE.Vector3(0, 0, sz / 2);
    const raio = Math.max(0.5 * Math.hypot(sx, sy, sz), 1);
    const dist = (raio / Math.sin(THREE.MathUtils.degToRad(cam.fov) / 2)) * 1.02;
    cam.near = Math.max(0.05, dist / 500);
    cam.far = dist * 40 + 2000;
    cam.position.copy(centro).addScaledVector(VISTAS.iso.clone().normalize(), dist);
    cam.lookAt(centro);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.cena.add(cam);
    const mesa = this.cena.getObjectByName('mesa');
    const estavam = [mesa.visible, this.sombra.visible];
    mesa.visible = false;
    this.sombra.visible = false;
    const fundo = this.renderer.getClearColor(new THREE.Color());
    const alfa = this.renderer.getClearAlpha();
    const px = new Uint8Array(lado * lado * 4);
    try {
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setRenderTarget(alvo);
      this.renderer.render(this.cena, cam);
      this.renderer.readRenderTargetPixels(alvo, 0, 0, lado, lado, px);
    } finally {
      this.renderer.setRenderTarget(null);
      this.renderer.setClearColor(fundo, alfa);
      [mesa.visible, this.sombra.visible] = estavam;
      this.cena.remove(cam);
      alvo.dispose();
      this.desenhar();
    }
    // A imagem sai de cabeça para baixo e em cor linear: ajusta para PNG normal (sRGB).
    const tabela = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const l = i / 255;
      tabela[i] = Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055));
    }
    const img = new ImageData(lado, lado);
    for (let y = 0; y < lado; y++) {
      const de = (lado - 1 - y) * lado * 4, para = y * lado * 4;
      for (let k = 0; k < lado * 4; k += 4) {
        img.data[para + k] = tabela[px[de + k]];
        img.data[para + k + 1] = tabela[px[de + k + 1]];
        img.data[para + k + 2] = tabela[px[de + k + 2]];
        img.data[para + k + 3] = px[de + k + 3];
      }
    }
    const tela = new OffscreenCanvas(lado, lado);
    tela.getContext('2d').putImageData(img, 0, 0);
    const blob = await tela.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }

  _ajustarSombra() {
    if (!this.caixa) return;
    const [sx, sy, sz] = this.caixa.tamanho;
    const r = Math.max(sx, sy, sz, 20) * 1.2;
    const s = this.luzChave.shadow.camera;
    s.left = -r; s.right = r; s.top = r; s.bottom = -r;
    s.near = 1; s.far = 4 * r + 600;
    this.luzChave.position.set(-0.45 * r - 60, -0.6 * r - 80, sz + r + 200);
    this.luzChave.target.position.set(0, 0, sz / 2);
    s.updateProjectionMatrix();
  }

  /** Aponta a câmera para a peça (ou para a mesa, se não houver peça). */
  enquadrar(vista) {
    let centro, raio;
    if (this.caixa) {
      const [sx, sy, sz] = this.caixa.tamanho;
      centro = new THREE.Vector3(0, 0, sz / 2);
      raio = Math.max(0.5 * Math.hypot(sx, sy, sz), 1);
    } else {
      centro = new THREE.Vector3(0, 0, 0);
      raio = Math.hypot(IMPRESSORA.mesaX, IMPRESSORA.mesaY) / 2;
    }
    let dir;
    if (vista && VISTAS[vista]) dir = VISTAS[vista].clone().normalize();
    else dir = this.camera.position.clone().sub(this.controles.target).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() === 0) dir = VISTAS.iso.clone().normalize();
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const dist = (raio / Math.sin(Math.min(fovV, fovH) / 2)) * 1.08;
    this.camera.near = Math.max(0.05, dist / 500);
    this.camera.far = dist * 40 + 2000;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(centro).addScaledVector(dir, dist);
    this.controles.target.copy(centro);
    this.controles.minDistance = raio * 0.05;
    this.controles.maxDistance = dist * 20 + 1000;
    this.controles.update();
    this.desenhar();
  }

  /** Posição da câmera (para guardar no projeto). */
  vista() {
    const p = this.camera.position, a = this.controles.target;
    return { posicao: [p.x, p.y, p.z], alvo: [a.x, a.y, a.z] };
  }

  /** Volta a câmera para uma vista guardada (depois de mostrar a peça). */
  aplicarVista(v) {
    if (!v || !Array.isArray(v.posicao) || !Array.isArray(v.alvo)) return;
    if (![...v.posicao, ...v.alvo].every(Number.isFinite)) return;
    this.camera.position.set(...v.posicao);
    this.controles.target.set(...v.alvo);
    const dist = this.camera.position.distanceTo(this.controles.target);
    this.camera.near = Math.max(0.05, dist / 500);
    this.camera.far = dist * 40 + 2000;
    this.camera.updateProjectionMatrix();
    this.controles.update();
    this.desenhar();
  }

  // --- seleção -------------------------------------------------------------

  /** Raio do ponto da tela (clientX, clientY) no espaço do modelo: { origem, direcao }. */
  raio(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const raio = new THREE.Raycaster();
    this.camera.updateMatrixWorld(true);
    raio.setFromCamera(ndc, this.camera);
    const desloc = this.grupoModelo.position;
    const o = raio.ray.origin.clone().sub(desloc);
    const d = raio.ray.direction.clone().normalize();
    return { origem: [o.x, o.y, o.z], direcao: [d.x, d.y, d.z] };
  }

  /** Ponto da tela (clientX, clientY) em pixels do canvas, com y para CIMA. */
  pixelDoCanvas(clientX, clientY, largura, altura) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * largura, (1 - (clientY - r.top) / r.height) * altura];
  }

  /**
   * Mapa de profundidade da peça como está na tela, para "só faces visíveis" e para o laço.
   * Devolve { matriz, largura, altura, profundidade, olho, fatorPixel } (ver js/core/selecao.js).
   */
  vistaParaSelecao(ladoMax = 1024) {
    const canvas = this.renderer.domElement;
    const cw = Math.max(1, canvas.clientWidth || this.container.clientWidth);
    const ch = Math.max(1, canvas.clientHeight || this.container.clientHeight);
    // até ladoMax pixels no lado maior (no PC de 4 GB: ~3 MB de leitura, uma vez por clique)
    const f = Math.min(Math.min(window.devicePixelRatio || 1, 2), ladoMax / Math.max(cw, ch));
    const W = Math.max(16, Math.round(cw * f));
    const H = Math.max(16, Math.round(ch * f));
    this.camera.updateMatrixWorld(true);
    this.grupoModelo.updateMatrixWorld(true);
    const longe = this.camera.far;
    const prof = new Float32Array(W * H).fill(Infinity);
    if (this.peca) {
      if (!this._matProf) {
        this._matProf = new THREE.ShaderMaterial({
          vertexShader: PROFUNDIDADE_VERTICE,
          fragmentShader: PROFUNDIDADE_FRAGMENTO,
          uniforms: { uLonge: { value: 1 } },
          side: THREE.DoubleSide,
        });
      }
      this._matProf.uniforms.uLonge.value = longe;
      const alvo = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
      const cena = new THREE.Scene();
      const copias = [this.peca, this.detalhe].filter(Boolean).map((m) => {
        const c = new THREE.Mesh(m.geometry, this._matProf);
        c.matrixAutoUpdate = false;
        c.matrix.copy(m.matrixWorld);
        c.matrixWorld.copy(m.matrixWorld);
        return c;
      });
      cena.add(...copias);
      const px = new Uint8Array(W * H * 4);
      const fundo = this.renderer.getClearColor(new THREE.Color());
      const alfa = this.renderer.getClearAlpha();
      try {
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.setRenderTarget(alvo);
        this.renderer.clear();
        this.renderer.render(cena, this.camera);
        this.renderer.readRenderTargetPixels(alvo, 0, 0, W, H, px);
      } finally {
        this.renderer.setRenderTarget(null);
        this.renderer.setClearColor(fundo, alfa);
        alvo.dispose();
      }
      for (let i = 0, k = 0; i < W * H; i++, k += 4) {
        if (px[k + 3] === 0) continue;
        prof[i] = ((px[k] * 65536 + px[k + 1] * 256 + px[k + 2]) / 16777215) * longe;
      }
    }
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).multiply(this.grupoModelo.matrixWorld);
    const olho = this.camera.position.clone().sub(this.grupoModelo.position);
    return {
      matriz: Float64Array.from(m.elements),
      largura: W,
      altura: H,
      profundidade: prof,
      olho: [olho.x, olho.y, olho.z],
      fatorPixel: (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / H,
    };
  }

  /**
   * Destaque da seleção: { indices (triângulos da malha da tela), pedacos (Float32Array, 9 por pedaço) }.
   * Usa as mesmas posições da peça (não copia a malha).
   */
  mostrarSelecao(d) {
    this.limparSelecao();
    if (!this.peca || !d) return;
    if (!this._matSelecao) {
      this._matSelecao = new THREE.MeshBasicMaterial({
        color: COR_SELECAO,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -6,
      });
    }
    const grupo = new THREE.Group();
    grupo.name = 'selecao';
    grupo.renderOrder = 2;
    if (d.indices && d.indices.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', this.peca.geometry.attributes.position);
      g.setIndex(new THREE.BufferAttribute(d.indices, 1));
      g.boundingBox = this.peca.geometry.boundingBox;
      g.boundingSphere = this.peca.geometry.boundingSphere;
      const m = new THREE.Mesh(g, this._matSelecao);
      m.renderOrder = 2;
      m.userData.posicaoDaPeca = true;
      grupo.add(m);
    }
    if (d.pedacos && d.pedacos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(d.pedacos, 3));
      g.boundingBox = this.peca.geometry.boundingBox;
      g.boundingSphere = this.peca.geometry.boundingSphere;
      const m = new THREE.Mesh(g, this._matSelecao);
      m.renderOrder = 2;
      grupo.add(m);
    }
    this.selecao = grupo;
    this.bytesSelecao = (d.indices ? d.indices.byteLength : 0) + (d.pedacos ? d.pedacos.byteLength : 0);
    this.grupoModelo.add(grupo);
    this.desenhar();
  }

  limparSelecao() {
    if (!this.selecao) return;
    this.grupoModelo.remove(this.selecao);
    for (const m of this.selecao.children) {
      // a posição de uma delas é a da peça: sai antes do dispose (senão a peça perde o buffer)
      if (m.userData.posicaoDaPeca) m.geometry.deleteAttribute('position');
      m.geometry.dispose();
    }
    this.selecao = null;
    this.bytesSelecao = 0;
    this.desenhar();
  }

  /** Triângulos destacados na tela (para os testes). */
  triangulosDestacados() {
    if (!this.selecao) return 0;
    let n = 0;
    for (const m of this.selecao.children) n += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
    return n;
  }

  /** Com o laço ligado, o arrastar de um dedo / botão esquerdo desenha em vez de girar. */
  modoLaco(ligado) {
    this.controles.mouseButtons.LEFT = ligado ? null : THREE.MOUSE.ROTATE;
    this.controles.touches.ONE = ligado ? null : THREE.TOUCH.ROTATE;
  }

  infoGpu() {
    const i = this.renderer.info;
    return { geometrias: i.memory.geometries, chamadas: i.render.calls, triangulos: i.render.triangles };
  }
}
