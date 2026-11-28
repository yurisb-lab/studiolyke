# Fatiador L.Y.K.E 3D — plano do app

Nov 24, 2026 · @Yuri

## Visão geral

Um app web próprio, no GitHub Pages, para dividir, conectar, pintar, texturizar e fotografar peças 3D e exportar 3MF pronto para o Bambu Studio (A1 + AMS). Ele junta num só lugar o que hoje está espalhado em split3mf, BumpMesh, geradores de chaveiro e conversores de imagem.

Por que fazer o próprio: liberdade total para pintar e dividir qualquer modelo, inclusive personagens, e funções pensadas para a L.Y.K.E 3D (chaveiros, lote de nomes, custo, fotos de venda).

**Decisões já tomadas**

- Código escrito do zero, em JS puro, sem nada em AGPL. As ferramentas de referência servem só de inspiração.
- Tudo roda no navegador, sem servidor; os arquivos nunca saem do computador.
- Fatiamento continua no Bambu Studio; o app não gera G-code.
- Saída principal: 3MF multipartes, com pintura e filamento por parte.
- Venda de peças de personagens licenciados: checar a licença de cada modelo antes de vender; uso pessoal é livre.

## Ferramentas de referência

Seis ferramentas foram avaliadas; cinco viram inspiração para módulos e uma ficou de fora.

| Ferramenta | O que faz | O que aproveitar | Veredito |
| --- | --- | --- | --- |
| [split3mf](https://split3mf.com/) | Separa 3MF pintado por cor, corta por plano ou desenho, conectores automáticos | Ideia central de separar por cor mantendo a pintura | Base dos módulos de corte, cor e conectores. Corrigir a seleção que pega o branco de baixo e perde o contorno |
| [BumpMesh](https://github.com/CNCKitchen/stlTexturizer) | Texturas de relevo (displacement) no navegador; 96 texturas, 7 projeções, máscaras | Fluxo de textura, exclusão automática da face da mesa, subdivisão adaptativa | Vira o módulo de textura, escrito do zero (o original é AGPL) |
| [3D Keychain Generator](https://madegooddesigns.com/?p=139806) | Chaveiro com nome, fontes livres, 3MF em 2 cores | opentype.js (MIT) + Google Fonts (OFL), troca de cor por altura | Módulo de chaveiros, prioridade alta |
| [ContainerCAD](https://containercad.com/) | Recipientes que preenchem uma gaveta, com folgas calculadas | Partir da medida do espaço; matemática de folgas entre módulos | Módulo de geradores, prioridade média |
| Conversores STL → imagem ([exemplo](https://www.printready3d.com/convert/stl-to-png)) | PNG transparente, ângulo e fundo | Base para fotos de venda | Módulo Estúdio, bem mais completo |
| [three-slicer](https://socket.dev/npm/package/three-slicer) | Fatiador OrcaSlicer em WASM | — | Fora: AGPL, versão 0.1, depende de React e repete o Bambu Studio |

Também avaliada depois: a [STLAI](https://get.stlflix.com/launch-stlai/). As ferramentas de edição (texto, furo para cordão, redimensionar, trocar partes, proporções, pose) viram o Kit de personagem; a geração por IA a partir de foto e os modelos da biblioteca deles ficam fora.

E o [Terrain 6](https://makerworld.com/en/crowdfunding/294-terrain-6-make-a-puzzle-of-anywhere), quebra-cabeça topográfico de qualquer lugar, pago por geração: vira o módulo Terreno, escrito do zero com dados de relevo abertos.

E o [TOPO.mapper](https://makerworld.com/en/models/2272481-topo-mapper-print-every-place-on-earth), gratuito no navegador: mapas e relevo com prédios, ruas, água e áreas verdes em 3MF multipartes. Suas camadas de mapa entram no módulo Terreno; até lá, dá para usar o próprio TOPO.mapper e trazer o 3MF para o app.

## Arquitetura e base técnica

O coração do app é um **histórico de operações**, como num CAD: cada corte, conector, pintura ou texto é um passo editável. Mudar um passo antigo refaz tudo dali para frente sem perder pintura nem textura.

**Ordem fixa na exportação:** importar → pintar → texturizar → cortar → conectores → texto e logo → simplificar → exportar 3MF. A textura vem antes do corte para o padrão continuar entre as partes.

**A seleção é peça central:** a mesma região selecionada serve para pintar, separar, cortar, texturizar ou proteger.

| Peça | Uso | Licença |
| --- | --- | --- |
| three.js | Visualização 3D e renders | MIT |
| three-mesh-bvh | Clique, pincel, "só visível", mapa de espessura | MIT |
| manifold-3d (WASM) | Cortes, uniões e subtrações; leva a identidade de cada triângulo, o que preserva a pintura | Apache 2.0 |
| Clipper2 + polylabel | Seções 2D e posição dos conectores | Boost / ISC |
| JSZip | Ler e gravar 3MF | MIT |
| opentype.js | Fontes dos chaveiros e textos | MIT |
| three-gpu-pathtracer | Render realista no Estúdio | MIT |

- **Desempenho:** contas pesadas em Web Workers; malha simplificada só para a visualização.
- **Dados:** projetos e perfis (folgas, filamentos, preços) salvos no navegador (IndexedDB); funciona offline como PWA.
- **Publicação:** `index.html` + alguns módulos JS, com bibliotecas pelo CDN, enviados pela interface web do GitHub, sem terminal.

## Modo leve (PC de 4 GB)

O app é construído para rodar num PC de 4 GB de RAM desde a fase 1; isso é regra de projeto, não um ajuste posterior.

**Regras de memória**

- **Malha leve na tela:** a visualização usa uma versão simplificada; a malha completa fica só no processamento e na exportação.
- **Uma cópia só da malha** em memória, em arrays compactos, passada ao worker sem duplicar.
- **Histórico guarda receitas, não modelos:** cada passo salva só os parâmetros; pontos de restauração vão para o disco (IndexedDB).
- **Uma parte por vez:** depois de dividir, processa e exporta parte por parte, liberando memória entre elas.
- **Textura só visual na prévia;** o relevo real é gerado no final, parte por parte.
- **Pintura em arrays compactos** por triângulo, nunca objetos soltos.

**Na tela**

- Liga sozinho quando o navegador indica pouca memória, e pode ser ligado ou desligado à mão.
- Sem sombras nem oclusão de ambiente; resolução de tela reduzida; render realista desativado.
- Medidor de memória no canto da tela.
- Ao abrir um modelo, estima a memória necessária e sugere simplificar antes de começar.

**Dicas de uso:** fechar o Bambu Studio enquanto usa o app e deixar poucas abas abertas.

Modo turbo no Google Colab (pacote de trabalho processado no notebook) fica como opção para decidir depois, só para trabalhos pesados.

## Responsivo e preparado para depois

O app funciona no computador, no tablet e no celular desde a fase 1, e já nasce com a base pronta para senha e sincronização, que ficam desligadas por enquanto.

**Responsivo (fase 1)**

- Computador: ferramentas à esquerda, propriedades à direita. Tablet: painéis em gavetas. Celular: peça em tela cheia, barra de ferramentas embaixo e opções em folha deslizante, com botões grandes.
- Toque: um dedo gira, pinça dá zoom, dois dedos arrastam; toque rápido usa a varinha; segurar abre o menu; pincel com dedo ou caneta.
- O modo leve e os avisos dependem da memória e da placa de vídeo medidas no aparelho, não do tipo de aparelho: o Galaxy S23 Ultra do Yuri tem mais memória que o PC dele e deve rodar tudo, inclusive operações pesadas. Só aparelhos fracos recebem o aviso "melhor em outro aparelho". Aparelhos de teste: o PC de 4 GB e o S23 Ultra no Chrome. S Pen: pressão no pincel e prévia do pincel ao passar a caneta sobre a tela.
- Instalável como app (PWA) na tela inicial.

**Para depois (não implementar agora; só deixar a base pronta)**

- **Acesso só do Yuri:** publicar pelo Cloudflare Pages com repositório privado e Cloudflare Access na frente (código de uso único no e-mail, plano gratuito). Base: o app usa só caminhos relativos e não depende do endereço do GitHub Pages, para trocar de hospedagem sem mudar código. Nunca fazer "senha" em JavaScript no próprio app.
- **Arquivos no Google Drive:** pasta "Fatiador L.Y.K.E" com projetos, 3MFs, modelos da casa, perfis de folga e preços, sincronizada entre PC e celular, com a permissão `drive.file` (só os arquivos do app). Base: toda gravação passa por uma camada de armazenamento única, hoje só local (IndexedDB), para depois ligar o Drive sem mexer no resto. O ID de cliente do Google fica num arquivo de configuração, vazio por enquanto.
- Firebase Storage descartado: exige plano Blaze (pagamento por uso).

## Módulos e funções

Treze módulos, todos ligados pelo histórico e pelo sistema de seleção.

### 1. Seleção (estilo Photoshop)

- **Varinha mágica 3D** por cor, por ângulo (tolerância em graus) ou por casca; opção Contíguo; Shift soma, Alt subtrai.
- **Só faces visíveis** ligado por padrão: nunca pega o que está escondido dentro da peça.
- Laço, retângulo e pincel de seleção; expandir, contrair, suavizar borda, inverter.
- Seleções salvas com nome ("olhos", "base").
- Contorno animado na borda e contador de área em cm².
- Atalhos: W varinha, L laço, B pincel, G balde, I conta-gotas, \[ \] tamanho, Ctrl+Shift+I inverter, Ctrl+D desmarcar.

### 2. Cor e pintura

- **Decodificar a pintura do Bambu:** cada triângulo pintado vira os sub-triângulos reais, para o contorno do sorriso existir na malha.
- **Separar por cor como incrustação:** a região vira uma camada de profundidade *d* (1 a 1,2 mm), cortada pelo corpo original; o branco ganha só um rebaixo.
- Direção pelas normais (peças curvas) ou por eixo (peças planas); modo por casca para olhos que são corpos separados.
- Pincel com tamanho em mm e borda lisa, pincel que gruda nas quinas, balde, espelho, conta-gotas, substituir cor.
- Paleta com os filamentos reais e aviso acima de 4 cores (AMS).
- Textura → AMS: modelo GLB/OBJ texturizado vira 3MF pintado em até 4 cores.
- Otimizador de purga e modo marchetaria (pintura vira peças que se encaixam).

### 3. Corte

- **Clique e corte:** clica na peça, o plano aparece alinhado; rodinha move, Enter corta.
- **Sugestões automáticas** nos pontos estreitos (pescoço, cintura, base).
- **Separar isto:** pinta uma região e o app acha o melhor plano.
- **Faca:** riscar reto, em degrau ou curva livre na tela.
- **Por comando:** "3 partes iguais", "Z = 40 mm", "caber na A1", "frente e trás".
- Pela fronteira de cor; divisão automática otimizada para a mesa da A1.
- Prévia ao vivo da seção, alertas de lascas e ilhas, atalhos X/Y/Z, R e Shift.
- Depois: cada parte deita sozinha pela face cortada, vista explodida, corte editável no histórico.

**Pôr de pé** (modo do corte): acha as solas, nivela o modelo pelo plano que toca as duas, corta o mínimo para ficar firme e mostra a estabilidade pelo centro de massa e o ângulo até tombar. O desenho da sola pode ser removido, mantido num corte raso, virar cor para o AMS ou gravação de 0,4 mm; sem cortar, há base unindo os pés ou furo para peso.

### 4. Conectores

- Painel **"Conectores desta emenda"** abre logo após cada corte, já com sugestão.
- **Biscoito em arco** (prioridade): solto e impresso deitado, ou lingueta integrada; profundidade com reservatório de cola de 0,3 a 0,5 mm, folga de 0,15 a 0,2 mm, canaletas para a cola, chanfro na entrada, biscoitos extras na placa.
- Outros tipos: pino, rabo de andorinha, baioneta, rosca, snap-fit, ímã, parafuso ou inserto, degrau de sobreposição, tala por trás, articulações.
- Posicionamento automático na área útil da seção, vários ao longo de emendas longas, encaixe à prova de erro.
- Parede mínima de 1,2 mm; se não couber, sugere tala.
- Perfis de folga por filamento com peça de teste; prévia em raio-X; "usar em todos os cortes".

### 5. Textura (no lugar do BumpMesh)

- Texturas procedurais (madeira, pedra, couro, tecido, grip, hexágono, escamas), fotos próprias como relevo e monograma L.Y.K.E.
- Projeções triplanar, caixa, cilíndrica, esférica, planar e modo adesivo.
- Máscara por cor, por parte, por ângulo e pincel; exclusão automática da face da mesa, cortes, conectores e textos.
- Camadas com modos de mistura; profundidade em mm limitada pela espessura; modo sem suporte; aviso de detalhe menor que o bico.
- Prévia na placa de vídeo; malha real só na exportação; placa de amostras numeradas para a feira.

### 6. Chaveiros e personalização

- Nome com contorno automático, borda ajustável e fontes livres.
- Logo PNG/SVG para chaveiro de 2 a 4 cores; QR code, ímã, abridor, clicker, textura no fundo.
- **Lote:** lista de nomes vira placa cheia ou um arquivo por criança.
- Texto em relevo sobre superfície curva, argola ou furo para cordão em qualquer modelo, base com nome, carimbo L.Y.K.E embaixo.
- Preço na hora pela tabela de chaveiros.

### 7. Geradores

- Organizadores de gaveta, caixas com tampa deslizante ou de encaixe, divisórias, etiqueta em relevo, expositores para a feira.

### 8. Personagens

- **Kit de personagem:** pino de pescoço padrão L.Y.K.E (junta de bola com medida fixa), cabeças e acessórios trocáveis, corpos base próprios.
- Ajuste de proporções por região (alongar, engrossar ou encurtar braços e pernas) e pose simples girando as partes nas juntas.
- Segmentação automática por anatomia (cabeça, tronco, braços).
- Articulações: junta de bola e dobradiça no lugar do corte.
- Cortes não planos e oco com nervuras e furo de dreno.
- Geração por IA a partir de foto fica fora do app; usar STLAI ou outro serviço só para essa etapa.

### 9. Estúdio (fotos de venda)

- Render com as cores do 3MF e materiais de filamento (fosco, silk, metalizado, translúcido).
- Linhas de camada simuladas, presets de luz de estúdio, modo foto realista.
- Fundos, mockups (parede, mochila, prateleira, mão), formatos 1:1, 4:5 e 9:16.
- Marca d'água L.Y.K.E + WhatsApp, card de catálogo com preço, grade de variações de cor.
- Giro 360° em vídeo ou GIF, vista explodida animada.
- **Prova digital** para o cliente aprovar antes de imprimir, inclusive em lote.

### 10. Produção

- Arranjo automático nas placas da A1, inclusive para pedidos de muitas unidades.
- Custo: estimativa rápida pelo volume e leitura do 3MF já fatiado pelo Bambu (gramas e tempo exatos).
- Guia de montagem em PDF com numeração das partes.
- Mapa de espessura, mapa de balanço, reparo de malha, orientação automática.

### 11. Estilizar (low poly)

- Reduz qualquer modelo a 100 a 5.000 faces planas, mantendo silhueta, simetria e detalhes protegidos com a varinha.
- Estilos: facetado clássico, triângulos uniformes, cristal e aramado (com checagem de espessura das hastes).
- Cor por faceta para o AMS: degradê por altura, mosaico com a paleta ou por região; a troca de cor cai na aresta.
- Base plana ou pedestal com nome; mais tarde, estilo voxel.
- Usa o mesmo simplificador do modo leve, então deixa o modelo mais leve.

### 12. Biblioteca de modelos da casa

- Os produtos fixos da L.Y.K.E viram modelos com campos editáveis: nome, frase, tamanho, cores, fonte.
- **Cada produto custa IA uma vez só:** é criado numa conversa com o Claude, que entrega o 3MF e o pacote de modelo para o app; as variações saem no app, sem IA.
- Cada modelo guarda as medidas e folgas testadas, as cores padrão e o preço.
- Primeiros modelos: chaveiro com nome, miçanga de letra, passador, placa de versículo com moldura 21×21, quadro de palavra vazada, ímã 5×5, polaroid, porta-photocard e caixas.
- Importar e exportar modelos, com cópia de segurança no repositório do GitHub.

### 13. Terreno (quebra-cabeça topográfico)

- Escolher um lugar no mapa (busca, retângulo, círculo ou contorno de município) e gerar o relevo real.
- Relevo do [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles), gratuito e sem chave, com crédito obrigatório; resolução de cerca de 12 a 30 m, então funciona melhor para serras, litoral e regiões.
- Ajustes: tamanho em mm, exagero vertical, espessura da base, nível do mar.
- Quebra-cabeça por curvas de nível, clássico com encaixe sobre o relevo, ou misto, usando os perfis de folga.
- Cores: sólida, por altitude (cada peça de uma cor só, sem purga) ou por imagem de satélite reduzida a 4 cores; para vender, só imagens com licença comercial.
- Molduras retangular, quadrada, circular ou hexagonal; bandeja com rebaixo, nome do lugar, coordenadas e seta do norte.
- Produtos: Serra de Maranguape, litoral de Fortaleza, Jericoacoara, Chapada do Araripe, Morro do Careca, quebra-cabeças para escolas e presentes personalizados.

**Camadas do mapa** (inspiradas no TOPO.mapper)

- Do OpenStreetMap, com crédito: prédios em relevo, ruas, rios, água e áreas verdes, cada camada como uma parte separada no 3MF, com sua cor no AMS.
- Prédios com a altura do mapa ou estimada, apoiados no terreno, com prioridade para marcos como igrejas e praças.
- Litoral fechado corretamente em baías e ilhas; mar plano em azul.
- Filtro automático de detalhes menores do que o bico imprime; exagero do relevo de 10 a 500%.
- Marcador de ponto (coração ou pino) num local escolhido.
- Saída 2D opcional: pôster de curvas de nível em PNG ou SVG.

**Produto novo:** quadro de mapa em relevo dentro da moldura padrão 21×21, com o local do casamento ou da casa marcado.

## Fases de desenvolvimento

Oito fases. A fase 1 resolve as maiores frustrações com o split3mf, e as fases 2 e 3 (divisão, conectores e cor) vêm antes dos chaveiros, por serem a prioridade.

| Fase | O que entra | Já serve para |
| --- | --- | --- |
| 1. Fundação | Modo leve como regra; histórico de operações; abrir e exportar 3MF com a pintura do Bambu decodificada; seleção (varinha, laço, só visível, seleções salvas); corte por clique, por comando e pela cor; pôr de pé; separar por cor como incrustação | Separar olhos e sorriso sem pegar o branco; cortes simples |
| 2. Divisão e conectores | Painel de conectores; biscoito em arco e pino; perfis de folga; sugestões automáticas e "separar isto"; divisão otimizada para a A1 com numeração; rabo de andorinha, ímã, degrau e tala | Peças grandes como o arco montadas com cola e encaixe |
| 3. Cor | Pincel inteligente, espelho, substituir cor, paleta; textura → AMS; otimizador de purga; marchetaria | Colorir qualquer modelo e economizar filamento |
| 4. Chaveiros, Biblioteca e Estúdio básico | Nome com contorno, logo, lote de nomes, QR, ímã e furo para cordão, preço; biblioteca de modelos da casa; low poly com cor por faceta; PNG transparente, luz, marca d'água, formatos do Instagram, prova digital | Pedidos repetidos sem gastar IA; vender e mandar prova ao cliente |
| 5. Textura | Procedurais, projeções, máscara por cor, camadas, limite por espessura, modo sem suporte, placa de amostras | Grip, madeira e pedra nos produtos |
| 6. Geradores | Caixas, organizadores, divisórias, expositores, vasos low poly; Terreno (quebra-cabeça topográfico) | Embalagens e estrutura da feira |
| 7. Personagens | Kit de personagem (pino de pescoço padrão, troca de partes, proporções, pose); segmentação por anatomia, articulações, faca com curva livre, oco com nervuras | Colecionáveis divididos e articulados |
| 8. Produção + Estúdio avançado | Arranjo nas placas, custo pelo 3MF fatiado, guia de montagem; render realista, mockups, giro 360°, card de catálogo | Produção em lote e catálogo profissional |

## Plano de implementação

A implementação anda em etapas pequenas, cada uma com uma entrega testável no seu PC e na A1. A primeira versão útil (v0.1) sai ao fim da fase 1.

### Como vamos trabalhar

- **O Claude Code escreve e testa o código na nuvem (claude.ai/code)** antes de entregar: testes automáticos de abrir e exportar, malha fechada depois de cada corte, cores preservadas.
- **Você testa no seu PC e imprime** as peças de validação; o retorno decide se a etapa fecha.
- **Publicação sem terminal**, pelo Claude Code na nuvem: cada etapa vira uma branch; você revisa as mudanças, cria o PR e clica em Merge no GitHub. O GitHub Pages atualiza o app sozinho.
- **Um bloco por sessão** do Claude Code (um bloco = uma ou mais etapas pequenas que andam juntas, por exemplo 1.4 + 1.5; as pesadas, como corte e incrustação, ficam sozinhas). Cada etapa continua com a própria versão e os próprios testes; o Yuri testa uma vez no fim do bloco, com um PR só. Este plano fica no repositório como docs/PLANO.md e o CLAUDE.md guarda as regras; no fim de cada etapa o Claude Code marca o que ficou pronto.
- **Versões numeradas** (v0.1, v0.2…) com a lista de mudanças dentro do app; o GitHub guarda as anteriores para voltar se algo der errado. Dentro da fase 1, cada etapa sobe um número (v0.0.1, v0.0.2…) até a v0.1 no fim da fase.

### Estrutura do repositório

| Pasta | O que guarda |
| --- | --- |
| `index.html`, `css/` | Página e visual |
| `js/core/` | Histórico, malha, seleção, controle de memória |
| `js/io/` | Leitura e gravação de 3MF, STL, OBJ e da pintura do Bambu |
| `js/ops/` | Uma operação por arquivo: corte, conectores, incrustação, textura, low poly, chaveiro |
| `js/ui/` | Visualizador, ferramentas, painéis, atalhos |
| `js/workers/` | Processamento pesado fora da tela |
| `assets/` | Fontes livres, presets de textura, logo L.Y.K.E |
| `testes/` | Modelos de referência e testes automáticos |

### Etapa 0 — Preparação

- [ ] Escolher o nome do app e criar o repositório no GitHub, com o Pages ligado.
- [x] Conectar o GitHub no claude.ai/code e subir o CLAUDE.md e o docs/PLANO.md no repositório.
- [ ] Separar os arquivos de teste: o boneco smile pintado no Bambu Studio (3MF), o arco rendilhado, um chaveiro de 2 cores e uma figura com peças separadas. *(smile e arco já em `testes/modelos/`; faltam o chaveiro de 2 cores e a figura com peças separadas)*
- [ ] Anotar o modelo do seu PC e o navegador usado, para calibrar o modo leve.

### Fase 1 — Fundação (sai a v0.1)

1. **Esqueleto e modo leve:** página, visualizador, abrir STL/OBJ/3MF, malha leve na tela, medidor de memória, layout responsivo e gestos de toque. Pronto quando: o arco e o smile abrem no seu PC sem travar. — ✅ **Feita na v0.0.1** (27/11/2026). Testes automáticos passando, inclusive abrindo o arco (1,1 milhão de triângulos, ~1,6 s) e o smile (553 mil, ~1 s) no perfil do PC de 4 GB; falta a confirmação do Yuri no PC e no S23 Ultra de verdade.
2. **3MF ida e volta:** ler objetos, partes e filamentos; exportar no formato do Bambu Studio. Pronto quando: um 3MF reaberto no Bambu fica igual ao original. — ✅ **Feita na v0.0.2** (27/11/2026). Lê objetos, partes, filamentos, placas, ajustes e configurações do projeto; cada parte aparece na cor do filamento, que pode ser trocado na lista; exporta no formato do Bambu (botão, Ctrl+E, barra do celular). A pintura do Bambu já é guardada e regravada igual (ainda sem aparecer na tela). Conferido no Bambu Studio 02.08.02.61 (linha de comando): o smile e o arco exportados dão os mesmos gramas por filamento e por placa que os originais. Falta a confirmação do Yuri no PC e no S23 Ultra.
3. **Pintura do Bambu:** decodificar e regravar a pintura fina. Pronto quando: o smile vai e volta sem perder nenhuma cor. — ✅ **Feita na v0.0.3** (28/11/2026). A pintura aparece na tela com os pedaços reais da pintura fina, mostra a área por cor, troca e apaga cor; o smile volta igual letra por letra (147.643 triângulos pintados, nos dois tênis). O formato foi escrito do zero. Desta vez não deu para conferir no Bambu Studio da nuvem (download bloqueado): falta o Yuri abrir `testes/modelos/conferencia_pintura.3mf` no Bambu do PC e ver se o desenho bate com o do app, e testar no PC e no S23 Ultra.
4. **Histórico:** operações editáveis, desfazer, salvar e abrir projeto, pela camada de armazenamento única (local agora, Google Drive depois). — ✅ **Feita na v0.0.4** (28/11/2026, no bloco A junto com a 1.5). Desfazer/refazer (botões, Ctrl+Z/Ctrl+Y), painel Histórico com voltar, editar e apagar passo; o histórico guarda receitas, com desfazer rápido limitado em memória e, acima disso, reabre o original e refaz as receitas. Projetos salvos no navegador, salvamento automático com "Continuar de onde parou?" e arquivo `.lyke` para levar entre aparelhos. Testes automáticos passando (smile volta letra por letra; desfazer ~0,3 s rápido, ~1,6 s reabrindo); falta a confirmação do Yuri no PC e no S23 Ultra.
5. **Seleção:** varinha (cor, ângulo, casca), laço, só visível, ajustes, seleções salvas.
6. **Corte básico:** clique e corte, por comando, caber na A1; partes deitam pela face cortada; pino simples; pôr de pé com medidor de estabilidade.
7. **Separar por cor:** incrustação com profundidade ajustável. Pronto quando: o teste do smile passa (olho sozinho, sorriso com contorno exato, branco só com rebaixo).

### Fase 2 — Divisão e conectores (v0.2)

1. Painel de conectores após cada corte; biscoito em arco e pino com posicionamento automático.
2. Perfis de folga com placa de teste.
3. Sugestões automáticas de corte e "separar isto".
4. Divisão otimizada para a A1 com numeração das partes.
5. Rabo de andorinha, ímã, degrau e tala.

Pronto quando: o arco rendilhado é dividido, impresso e colado sem desalinhar.

### Fase 3 — Cor (v0.3)

1. Pincel inteligente com borda lisa, balde e espelho.
2. Conta-gotas, substituir cor e paleta com os filamentos reais (aviso acima de 4 cores).
3. Textura para AMS: modelo GLB/OBJ texturizado vira 3MF pintado; mesma projeção leva o desenho da sola para cor no pôr de pé.
4. Otimizador de purga.
5. Marchetaria.

Pronto quando: um modelo GLB texturizado sai pintado em 4 cores e o otimizador mostra a economia em gramas.

### Fase 4 — Chaveiros, Biblioteca e Estúdio básico (v0.4)

1. Texto com fontes livres, contorno automático, argola, furo para cordão, base com nome.
2. Logo PNG/SVG para chaveiro de 2 a 4 cores; QR e ímã.
3. Lote de nomes e preço pela tabela.
4. Biblioteca de modelos da casa: formato do pacote de modelo e os primeiros modelos.
5. Low poly com cor por faceta.
6. Estúdio básico: PNG transparente, luz, cores do 3MF, marca d'água, formatos do Instagram, prova digital.

Pronto quando: 10 nomes saem numa placa com preço e prova, uma placa de versículo nova sai do modelo da casa sem usar IA, e um animal low poly sai em 3 cores.

### Fases 5 a 8

| Fase | Versão | Etapas em ordem | Pronto quando |
| --- | --- | --- | --- |
| 5. Textura | v0.5 | Procedurais e projeções → máscaras → camadas → limite por espessura e modo sem suporte → placa de amostras | A placa de amostras imprime sem furar paredes |
| 6. Geradores | v0.6 | Caixas e tampas → organizadores de gaveta → divisórias e etiquetas → expositores → vaso low poly → Terreno (relevo, quebra-cabeça, cor por altitude, bandeja com nome) | Uma caixa com tampa encaixa na primeira impressão e o quebra-cabeça da Serra de Maranguape monta sem forçar |
| 7. Personagens | v0.7 | Pino de pescoço padrão e troca de partes → proporções e pose → articulações → segmentação → faca curva e oco | Duas cabeças diferentes encaixam no mesmo corpo |
| 8. Produção | v1.0 | Arranjo nas placas → custo pelo 3MF fatiado → guia de montagem → render realista e mockups → giro 360° e card de catálogo | Um pedido de 20 unidades sai com placas, custo e fotos |

O modo turbo no Colab, se for decidido, entra junto com a fase 5.

## Riscos e testes

O maior risco é decodificar a pintura do Bambu; por isso ele é testado na fase 1, antes de qualquer outra função de cor.

| Risco | Por que importa | Como lidar |
| --- | --- | --- |
| Formato da pintura do Bambu | Gravada como árvore de subdivisão por triângulo; ler só a cor principal perde contornos | Decodificar e gravar de volta na fase 1, testando ida e volta no Bambu Studio |
| Malhas pesadas (1 milhão+ triângulos) | Navegador fica lento ou sem memória | Workers, malha simplificada na tela, limite de triângulos na exportação |
| Textura → pintura | Precisa subdividir para pegar detalhes, o arquivo cresce | Subdividir só nas fronteiras de cor; orçamento de triângulos |
| Booleanas em malha quebrada | Corte ou conector falha | Diagnóstico e reparo automático ao abrir |
| Folga dos conectores | Varia com filamento e impressora | Peça de teste e perfil por filamento |

**Testes de validação**

- [ ] **Boneco smile azul e branco:** clicar no olho seleciona só o olho; o sorriso sai com o contorno exato; o corpo branco sai inteiro, só com o rebaixo.
- [ ] **Ida e volta do 3MF:** abrir um 3MF pintado no app, exportar e reabrir no Bambu Studio sem perder nenhuma cor. *(v0.0.2: a pintura já volta igual, conferido fatiando o smile. v0.0.3: a pintura aparece na tela, dá para trocar e apagar cor, e volta letra por letra; falta o teste do Yuri no Bambu do PC, com o smile e o `conferencia_pintura.3mf`.)*
- [ ] **Arco rendilhado:** dividir para caber na A1 com biscoitos em arco e montar com cola sem desalinhar.
- [ ] **Teste de folga:** imprimir a placa de folgas de 0,10 a 0,30 mm e salvar o perfil do eSUN PLA+.
- [ ] **Lote de chaveiros:** gerar 10 nomes numa placa e conferir preço e prova digital.
