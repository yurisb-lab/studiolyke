# Mudanças

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
