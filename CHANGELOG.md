# Mudanças

## v0.0.5 — Etapa 1.5: seleção (28/11/2026)

- **Seção "Seleção"** no painel de ferramentas (no celular, em "Ferram.") e uma **barrinha sobre a peça** com a ferramenta, quanto está selecionado, ＋ (somar), − (tirar) e ✕ (limpar).
- **Varinha mágica**: clique na peça (no celular, **toque rápido**). Três jeitos:
  - **Cor**: a região do mesmo filamento, seja pintura ou a cor da parte. "Só a região tocada" (ligado) pega só a mancha ligada ao toque; desligado, pega aquela cor no modelo todo.
  - **Ângulo**: cresce pela superfície até achar uma quina mais forte que o limite (5° a 180°, padrão 30°).
  - **Casca**: a peça solta inteira.
- **Contorno exato da pintura fina**: nos triângulos da borda do desenho do Bambu, a seleção guarda só os pedaços da cor tocada, e o destaque mostra só eles. É a base do "sorriso com contorno exato" da etapa 1.7.
- **Laço** (tecla L): desenhe um contorno com o mouse, o dedo ou a S Pen. Com o laço ligado, um dedo (ou o botão esquerdo) desenha; dois dedos, a pinça e o botão direito continuam mexendo na vista.
- **Só faces visíveis** (ligado por padrão): a varinha e o laço só pegam o que aparece na tela, nunca o lado de trás ou de baixo, que era o defeito do split3mf. Tudo cresce pela superfície, sem atravessar o modelo.
- **Somar e tirar**: Shift + clique soma, Alt + clique tira; ou os botões Nova / ＋ Somar / − Tirar.
- **Ajustes**: Crescer e Encolher (em mm; crescer pega sempre ao menos os vizinhos), Inverter (Ctrl+I), Tudo (Ctrl+A), Limpar (Ctrl+D).
- **Seleções salvas**: dar nome ("olho esquerdo") e, depois, Usar, ＋ ou apagar. Vão junto com o projeto e com o `.lyke`, e a seleção atual também.
- Cada seleção é um passo do **histórico** (Ctrl+Z volta a seleção anterior), guardada compacta. As seleções antigas do histórico saem sozinhas acima do limite de memória (16 MB no modo leve).
- A seleção é feita na **malha completa** e o destaque usa as posições da malha da tela (sem copiar a malha). Na malha leve, o destaque é aproximado pelos vértices.
- Tempos no PC de 4 GB (simulado): arco (1,1 milhão de triângulos) — primeira varinha 0,4 s (monta a vizinhança uma vez), as seguintes ~50 ms, laço ~0,25 s, 116 MB no total. Smile: ~0,3 s na primeira, depois ~70 ms.
- Atalhos: W varinha · L laço · Shift soma · Alt tira · Ctrl+D limpa · Ctrl+A tudo · Ctrl+I inverte.
- Testes automáticos novos (`testes/unidade/selecao.test.mjs`): vizinhança, casca, ângulo, faces visíveis (também em peça "do avesso"), raio, laço, somar/tirar/inverter, crescer/encolher, formato compacto, varinha no smile (só o azul, sem sair do tênis) e na pintura fina (só os pedaços da cor, com a área certa). No navegador, no PC de 4 GB e no S23 Ultra: clique e toque, Shift, Ctrl+Z, ângulo com e sem "só visível", cor no F pintado, crescer/encolher/inverter, seleção salva, laço com mouse e com o dedo (sem girar a vista), pinça com o laço ligado, seleção voltando com o projeto, tempos no arco e no smile.

## v0.0.4 — Etapa 1.4: histórico e projetos (28/11/2026)

- **Desfazer e refazer**: botões no topo (computador e tablet) e na barra de baixo do celular, **Ctrl+Z** e **Ctrl+Y** (ou Ctrl+Shift+Z), e no menu de segurar. Vale para trocar filamento, trocar cor da pintura e apagar pintura.
- **Painel "Histórico"** (no alto do painel da direita, ou em "Info" no celular): lista dos passos com a hora.
  - Tocar num passo volta o modelo até ali; os passos de depois ficam riscados até você fazer outra coisa.
  - **Editar** (lápis) muda a receita de um passo antigo, por exemplo o filamento escolhido ou a cor da troca. O app refaz os passos seguintes sozinho.
  - **Apagar** (lixeira) tira um passo; o app refaz os outros sem ele.
  - Se um passo não dá mais certo depois de uma edição, ele fica marcado em amarelo e é pulado.
- **Como funciona por dentro (modo leve)**: o histórico guarda só a **receita** de cada passo, nunca cópias do modelo.
  - Desfazer rápido: o passo guarda só o pedacinho que mudou (o filamento antigo; na pintura, os códigos antigos só dos triângulos que mudaram), com limite de memória (16 MB no modo leve).
  - Acima do limite, ou depois de editar um passo, o app reabre o original e refaz as receitas, sem travar a tela.
  - No smile: trocar a cor ~0,1 s; desfazer rápido ~0,3 s; desfazer reabrindo ~1,6 s. A pintura volta **igual letra por letra**.
  - Pontos de restauração (o modelo pronto gravado no IndexedDB) já estão preparados para as operações pesadas, que chegam a partir do corte (1.6).
- **Projetos** (painel da esquerda, seção "Projeto"):
  - **Salvar projeto** (Ctrl+S) pede um nome e guarda no navegador o modelo original e os passos. Depois disso o projeto se salva sozinho a cada mudança.
  - **Projetos salvos**: lista com Abrir, Baixar .lyke e Apagar.
  - **Baixar projeto (.lyke)**: um arquivo só, com o original e os passos, para levar do PC para o celular ou guardar de backup. Abre pelo "Abrir modelo" (ou arrastando para a tela) e já entra na lista de projetos do aparelho.
  - **Salvamento automático**: se a página fechar ou o aparelho travar, ao abrir o app de novo ele pergunta "Continuar de onde parou?". Dá para continuar desfazendo até o original.
  - Abrir outro modelo com trabalho sem nome não perde nada: ele fica em "Projetos salvos" como "(não salvo)" (os 3 mais recentes).
  - Tudo passa pela camada única de armazenamento: o Google Drive entra depois no mesmo lugar.
- Corrigido: arquivos com acento no nome (ex.: "Tênis.3mf") podiam baixar com o nome "download". Agora o nome do arquivo baixado sai sem acento ("Tenis_fatiador.3mf").
- Corrigido: no celular, ao soltar o dedo depois de segurar para abrir o menu, o item que ficava embaixo do dedo era escolhido sozinho.
- Barra do celular: Abrir · Desfazer · Refazer · Ferramentas · Info · Exportar (o "Enquadrar" fica no painel de ferramentas e no menu de segurar).
- Testes automáticos novos (`testes/unidade/historico.test.mjs`): desfazer e refazer na hora, smile voltando letra por letra, desfazer reabrindo o original, editar um passo antigo, passo que falha, seleções no histórico, pontos de restauração, projeto salvo, `.lyke` ida e volta. No navegador: botões e atalhos, editar passo, salvar com Ctrl+S, recarregar e continuar, lista de projetos, `.lyke` aberto no S23 Ultra, tempos no smile.

## v0.0.3 — Etapa 1.3: pintura do Bambu (28/11/2026)

- **A pintura do Bambu aparece na tela**, nas cores dos filamentos. O que não está pintado fica na cor da parte.
  - O app entende a "pintura fina" do Bambu: cada triângulo pintado com o pincel é dividido em pedaços menores, e a tela mostra esses pedaços de verdade. Por isso o contorno da pintura aparece certinho.
  - Limite de pedaços na tela conforme o aparelho (metade do limite da tela: 150 mil no PC de 4 GB, 750 mil no S23 Ultra). Se passar disso, o resto aparece na cor que ocupa mais área de cada triângulo.
  - Na malha leve da tela (modelos grandes), cada cor é simplificada separada e com a borda travada: o contorno não borra nem abre fresta.
  - **"Mostrar pintura"** (chave no painel, tecla **P** no computador, menu de segurar) liga e desliga. A escolha fica salva.
- **Painel "Pintura"**: cores usadas e a área de cada uma em cm²; em cada parte, as cores pintadas nela. Aviso se a pintura usa um filamento que o projeto não tem ou passa dos 4 do AMS.
- **Edição simples da pintura** (pincel e balde ficam para a fase 3):
  - **Trocar uma cor por outra** (ou por "sem pintura"), no modelo todo ou numa parte.
  - **Apagar a pintura de uma parte**, com confirmação (o desfazer chega na etapa 1.4).
  - Pedaços que ficam todos da mesma cor são juntados, como o Bambu faz.
- **Exportar**: a pintura é regravada no formato do Bambu. Sem edição, sai **igual letra por letra** (conferido nos 147.643 triângulos pintados do smile). A pintura de suporte e de costura continua indo como veio. Pintura que o app não entende (arquivo estranho) não aparece na tela, mas volta igual.
- Peças espelhadas: a pintura fina fica no lugar certo (a ordem dos vértices é desfeita antes de montar os pedaços).
- O smile: a pintura está nos **dois tênis** (brancos, filamento 4) com o azul do filamento 2. Agora ela aparece.
- **Arquivo de conferência** `testes/modelos/conferencia_pintura.3mf`, para abrir no Bambu Studio e comparar com o app (ver `testes/modelos/LEIA-ME.md`).
- Corrigido: clicar em qualquer lugar do painel da direita podia ligar o modo leve sem querer.
- Painel: "Na tela" agora diz se é a malha completa ou a leve, e quantos pedaços da pintura fina aparecem.
- Testes automáticos novos (`testes/unidade/pintura.test.mjs`): formato da pintura, pedaços de 1, 2 e 3 lados divididos, 300 árvores sorteadas (as áreas fecham e os pedaços ficam dentro do triângulo), trocar e apagar cores, smile ida e volta letra por letra, cubo de conferência (pedaços na cor certa também na peça espelhada), malha da tela por cor. No navegador: pintura na tela, chave e tecla P, trocar cor, apagar com confirmação, exportar e reler, no PC de 4 GB e no S23 Ultra.

## v0.0.2 — Etapa 1.2: 3MF ida e volta (27/11/2026)

- **Lê tudo o que o Bambu Studio guarda no 3MF:** objetos e as partes de cada um (com nome, tipo e posição), filamentos do projeto (cor, tipo, perfil), filamento de cada objeto e de cada parte, placas (nome, travada, objetos de cada uma), ajustes por objeto e por parte (brim, suporte, paredes…), configurações do projeto e miniaturas.
- **Cada parte aparece na cor do seu filamento.** Modificadores e partes negativas aparecem transparentes; objetos que não imprimem ficam apagados.
- **Painel novo:** paleta dos filamentos e lista por placa → objeto → parte, com o filamento de cada parte. Dá para **trocar o filamento de uma parte** ali mesmo (num objeto de uma parte só, o objeto acompanha, como no Bambu). A troca entra no histórico (desfazer) na etapa 1.4.
- **Exportar 3MF** (botão no painel Arquivo, "Exportar" na barra do celular, Ctrl+E no computador e no menu de segurar). O arquivo sai no formato de projeto do Bambu Studio: objetos, partes, filamento por parte, placas, ajustes, configurações do projeto e miniatura.
  - **A pintura do Bambu é guardada como veio e volta igual** (cor, suporte e costura pintados). Ela ainda não aparece na tela; isso é a etapa 1.3.
  - As coordenadas voltam exatamente como o Bambu as lê: fatiando o smile original e o exportado no Bambu Studio 02.08.02.61, os gramas de cada filamento em cada placa dão iguais.
  - Modelo de STL ou OBJ sai como objetos no filamento 1, no centro da placa 1, apoiados na mesa, com miniatura tirada da tela. Sem configurações do projeto: o Bambu usa as dele.
  - G-code e resultados de fatiamento antigos não vão junto (ficariam errados).
  - Modo leve: o arquivo é escrito e comprimido aos pedaços, uma parte por vez, fora da tela. O arco (1,1 milhão de triângulos) exporta em ~2,5 s.
- "Simplificar ao abrir" agora simplifica parte por parte e mantém objetos, partes, filamentos e placas. A pintura do Bambu, nesse caso, é descartada com aviso.
- Posições do 3MF guardadas em precisão dupla (sem isso, objetos nas placas 2 e 3 perdiam casas decimais).
- Testes automáticos novos: ida e volta de um projeto completo (várias partes, modificador, peça espelhada, instâncias repetidas, objeto que não imprime, arquivos extras), do smile e do arco; ZIP; coordenadas; troca de filamento; exportação pelo botão, Ctrl+E e barra do celular, também sem internet; XML conferido pelo leitor estrito do navegador.

## v0.0.1 — Etapa 1.1: esqueleto e modo leve (27/11/2026)

- Página do app com visualizador 3D (eixo Z para cima, mesa da A1 de 256 × 256 mm com grade de 10 mm).
- Abre **STL** (binário e texto), **OBJ** e **3MF** (inclusive o formato do Bambu Studio com componentes em `3D/Objects/`). Pelo botão ou arrastando o arquivo.
  - No 3MF, por enquanto só a geometria e os nomes dos objetos. Se houver pintura do Bambu, o app avisa (a pintura chega na etapa 1.3).
- **Modo leve**: o app mede o aparelho (memória, placa de vídeo, teste rápido) e decide sozinho; dá para ligar/desligar à mão (fica salvo).
  - Malha leve na tela (300 mil triângulos no modo leve, 1,5 milhão no aparelho forte); a malha completa fica guardada para o processamento.
  - Sem sombras e com resolução reduzida no modo leve.
  - Aviso "melhor em outro aparelho" só para aparelhos fracos.
- **Medidor de memória** no topo e estimativa antes de abrir: se o modelo for grande demais para o aparelho, sugere "simplificar ao abrir".
- Leitura e simplificação em **Web Worker** (a página não trava); a malha vai e volta sem cópia.
- **Responsivo**: computador (ferramentas à esquerda, propriedades à direita), tablet (gavetas), celular (tela cheia, barra embaixo, folha deslizante). Botões com pelo menos 44 px.
- **Gestos**: um dedo gira, pinça dá zoom, dois dedos arrastam, segurar abre o menu.
- Atalhos no computador: Ctrl+O abrir, F enquadrar, 0/1/3/7 vistas 3D/frente/lado/cima.
- **App instalável (PWA)** e funcionando offline com o que já foi aberto uma vez.
- Camada única de armazenamento (`js/core/armazenamento.js`), hoje local (IndexedDB), pronta para o Google Drive depois.
- Com vários objetos (projetos do Bambu com mais de uma placa), o aviso da mesa olha cada objeto: "Cada objeto cabe na mesa da A1". A lista de objetos mostra as medidas de cada um.
- Testes automáticos: leitores, simplificação, PWA e o app no navegador simulando o PC de 4 GB, tablet, Galaxy S23 Ultra e aparelho fraco, e abrem os modelos de referência (arco rendilhado: 1,1 milhão de triângulos em ~1,6 s; boneco smile: 553 mil em ~1 s; ambos com ~60 MB no modo leve).
