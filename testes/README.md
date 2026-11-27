# Testes automáticos

- `unidade/` — testes rápidos no Node: leitores de STL/OBJ/3MF, **3MF ida e volta** (`3mf-ida-volta.test.mjs`: abrir, exportar e reabrir sem perder objetos, partes, filamentos, placas nem pintura), simplificação, PWA e versões das bibliotecas.
- `navegador/rodar.mjs` — abre o app no Chromium e simula os aparelhos de teste (PC de 4 GB, tablet, Galaxy S23 Ultra, aparelho fraco), com gestos de toque. Exporta 3MF pelo botão, pelo Ctrl+E e pela barra do celular e confere o arquivo baixado. Salva capturas de tela e os 3MF exportados em `testes/resultados/`.
- `gerar-modelos.mjs` — cria os modelos de teste em `testes/gerados/` (inclusive um STL de 1 milhão de triângulos e um projeto do Bambu completo, `projeto-bambu.3mf`).
- `modelos/` — arquivos de referência do Yuri (smile, arco…). **Todo arquivo .stl/.obj/.3mf colocado aqui é aberto automaticamente pelo teste do navegador.**

Rodar: `npm install` e depois `npm test`.

## Conferência no Bambu Studio de verdade (fora do `npm test`)

Na etapa 1.2 os 3MF exportados também foram fatiados no Bambu Studio 02.08.02.61 para Linux (linha de comando `--slice 0`), comparando gramas por filamento e por placa com o arquivo original. Isso não faz parte do `npm test` (o Bambu tem ~230 MB e licença AGPL; só é usado como ferramenta, sem copiar código).
