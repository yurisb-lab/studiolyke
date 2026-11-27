# Mudanças

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
- Testes automáticos: leitores, simplificação, PWA e o app no navegador simulando o PC de 4 GB, tablet, Galaxy S23 Ultra e aparelho fraco.
