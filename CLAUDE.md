# Fatiador L.Y.K.E 3D

App web do Yuri (L.Y.K.E 3D, Pacatuba-CE) para dividir, conectar, pintar, texturizar e fotografar peças 3D e exportar 3MF pronto para o Bambu Studio. Impressora: Bambu Lab A1 com AMS (4 cores), filamento eSUN PLA+, bico 0,4 mm, mesa 256 × 256 mm.

**O plano completo está em `docs/PLANO.md`. Ele é a fonte da verdade: leia antes de cada etapa.**

## Como falar com o Yuri

- Sempre em português do Brasil, em linguagem simples.
- Ele **não usa terminal**. Nunca peça para ele rodar comandos. Tudo o que ele fizer é pelo navegador: GitHub (revisar, criar PR, clicar em Merge), GitHub Pages e o próprio app.
- No fim de cada etapa, diga em poucas linhas o que mudou e **como ele testa no PC dele** (o que abrir, o que clicar, o que deve acontecer).

## Regras de código

- **JS puro** (ES modules), HTML e CSS. Sem frameworks (nada de React, Vue etc.) e sem etapa de build. O app roda abrindo o GitHub Pages.
- Bibliotecas pelo CDN (jsDelivr ou esm.sh) com **versão fixa**, via `importmap` no `index.html`.
- **Licenças:** só MIT, Apache 2.0, BSD, ISC, Boost, OFL (fontes). **Nada de GPL ou AGPL**, nem copiar código delas (BumpMesh/stlTexturizer, three-slicer etc. servem só de inspiração). Registrar cada biblioteca e licença em `LICENSES.md`.
- Bibliotecas previstas: three.js, three-mesh-bvh, manifold-3d (WASM), Clipper2, polylabel, JSZip, opentype.js, three-gpu-pathtracer.
- Comentários e nomes de interface em português.
- Unidades sempre em mm.

## Modo leve (PC de 4 GB de RAM) — regra de projeto

- Malha simplificada na tela; malha completa só no processamento e na exportação.
- Uma única cópia da malha em memória, em typed arrays, passada ao Web Worker sem duplicar (transferable).
- O histórico guarda **receitas** (parâmetros das operações), não cópias do modelo. Pontos de restauração vão para o IndexedDB.
- Processar e exportar uma parte por vez depois de dividir.
- Textura: só visual na prévia (shader); relevo real gerado na exportação.
- Pintura em arrays compactos por triângulo.
- Sem sombras/oclusão quando o modo leve estiver ligado; medidor de memória visível.

## Responsivo (desde a fase 1)

- Funciona no computador, tablet e celular. Computador: ferramentas à esquerda, propriedades à direita. Tablet: painéis em gavetas. Celular: peça em tela cheia, barra de ferramentas embaixo, opções em folha deslizante, alvos de toque de pelo menos 44 px.
- Gestos: um dedo gira, pinça dá zoom, dois dedos arrastam; toque rápido = varinha; segurar = menu; pincel com dedo ou caneta (Pointer Events).
- O modo leve e os avisos dependem da **capacidade medida do aparelho** (memória, WebGL/placa de vídeo, teste rápido de desempenho), não do tipo de aparelho. O celular do Yuri, um **Galaxy S23 Ultra**, tem mais memória que o PC dele e deve rodar tudo, inclusive operações pesadas. Só aparelhos fracos recebem o aviso "melhor em outro aparelho".
- **Aparelhos de teste:** o PC de 4 GB de RAM e o S23 Ultra no Chrome para Android. Toda etapa deve funcionar nos dois.
- **S Pen:** usar a pressão da caneta (Pointer Events) no pincel e mostrar a prévia do pincel quando a caneta passa sobre a tela sem tocar.
- PWA instalável (manifest + service worker), funcionando offline com o que estiver salvo.

## Preparado para depois (NÃO implementar agora — só deixar a base pronta)

- **Acesso só do Yuri:** no futuro o app pode ir para o Cloudflare Pages (repositório privado) com Cloudflare Access na frente. Por isso: usar só caminhos relativos, nunca depender do endereço do GitHub Pages, e **nunca** criar "senha" em JavaScript no próprio app (não protege nada).
- **Arquivos no Google Drive:** no futuro, sincronizar projetos, 3MFs, modelos da casa, perfis de folga e preços numa pasta "Fatiador L.Y.K.E", com o escopo `drive.file`. Por isso: toda leitura e gravação passa por **uma única camada de armazenamento** (`js/core/armazenamento.js`) com implementação local (IndexedDB) agora; o adaptador do Drive entra depois sem mudar o resto. O ID de cliente do Google fica em `js/config.js`, vazio por enquanto. Nenhum segredo no código.
- Firebase Storage está descartado (exige plano Blaze).

## 3MF e Bambu Studio

- Exportar 3MF **multipartes** compatível com o Bambu Studio: objetos, partes, filamento por parte, placas.
- Preservar a pintura do Bambu (`paint_color`, árvore de subdivisão por triângulo): ler, decodificar e regravar sem perder detalhe.
- Separar por cor = **incrustação**: a região pintada vira uma camada de profundidade ajustável (padrão 1 a 1,2 mm) cortada pelo corpo original; o corpo ganha só um rebaixo. Nunca projetar a área através do modelo.
- Seleção e varinha sempre só em faces visíveis por padrão, crescendo por vizinhança na superfície.

## Folgas e conectores (valores testados)

- Folga padrão de encaixe: 0,15 mm por lado (perfil eSUN PLA+); permitir perfis por filamento.
- Parede mínima ao redor de furos e rasgos: 1,2 mm.
- Ao escalar, regerar conectores no tamanho final (não escalar a folga).
- Conector prioritário: biscoito em arco (solto, impresso deitado), com reservatório de cola de 0,3 a 0,5 mm e chanfro na entrada.

## Estrutura do repositório

```
index.html, css/
js/config.js configurações (ex.: ID de cliente do Google, vazio por enquanto)
js/core/     histórico, malha, seleção, memória, armazenamento
js/io/       3MF, STL, OBJ, pintura do Bambu
js/ops/      uma operação por arquivo (corte, conectores, incrustação…)
js/ui/       visualizador, ferramentas, painéis, atalhos
js/workers/  processamento pesado
assets/      fontes livres, presets, logo
testes/      testes automáticos + testes/modelos/ (arquivos de referência)
docs/PLANO.md
```

## Fluxo de trabalho

1. Uma etapa do plano por sessão. Comece apresentando o plano da etapa e espere o OK antes de escrever código.
2. Escreva testes automáticos em `testes/` (pode usar Node e npm **só para testes**, como devDependencies) e rode antes de terminar: abrir e exportar 3MF, malha fechada depois de cada corte, cores preservadas.
3. Use os arquivos de `testes/modelos/` como referência (ex.: boneco smile pintado, arco rendilhado).
4. Ao terminar: atualize `docs/PLANO.md` (marque a etapa), `CHANGELOG.md` e o número de versão mostrado no app (v0.1, v0.2…).
5. Não avance para a etapa seguinte sem o Yuri pedir.
