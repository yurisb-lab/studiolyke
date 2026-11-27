# Bibliotecas e licenças

Regra do projeto: só MIT, Apache 2.0, BSD, ISC, Boost e OFL (fontes). Nada de GPL ou AGPL.

## Usadas pelo app (carregadas do CDN jsDelivr, versão fixa)

| Biblioteca | Versão | Licença | Para que serve | Desde |
| --- | --- | --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js) (com OrbitControls) | 0.187.0 | MIT | Visualizador 3D, giro/zoom/arrasto | v0.0.1 |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) (simplificador em WASM) | 1.3.0 | MIT | Malha leve da tela e "simplificar ao abrir" | v0.0.1 |
| [JSZip](https://github.com/Stuk/jszip) | 3.10.2 | MIT **ou** GPL-3.0, à escolha. **Usada pela opção MIT.** Inclui o pako (MIT). | Abrir o 3MF (que é um ZIP) | v0.0.1 |

## Usadas só nos testes automáticos (não vão para o app)

| Ferramenta | Versão | Licença |
| --- | --- | --- |
| Playwright | 1.63.0 | Apache 2.0 |
| three, meshoptimizer, jszip (mesmas versões acima, servidas do `node_modules` nos testes) | — | ver acima |

## Previstas para as próximas etapas

three-mesh-bvh (MIT), manifold-3d (Apache 2.0), Clipper2 (Boost), polylabel (ISC), opentype.js (MIT), three-gpu-pathtracer (MIT).

Ferramentas de referência como BumpMesh/stlTexturizer e three-slicer (AGPL) servem só de inspiração: nenhum código delas é copiado.
