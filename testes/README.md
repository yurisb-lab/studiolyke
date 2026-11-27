# Testes automáticos

- `unidade/` — testes rápidos no Node: leitores de STL/OBJ/3MF, simplificação, PWA e versões das bibliotecas.
- `navegador/rodar.mjs` — abre o app no Chromium e simula os aparelhos de teste (PC de 4 GB, tablet, Galaxy S23 Ultra, aparelho fraco), com gestos de toque. Salva capturas de tela em `testes/resultados/`.
- `gerar-modelos.mjs` — cria os modelos de teste em `testes/gerados/` (inclusive um STL de 1 milhão de triângulos).
- `modelos/` — arquivos de referência do Yuri (smile, arco…). **Todo arquivo .stl/.obj/.3mf colocado aqui é aberto automaticamente pelo teste do navegador.**

Rodar: `npm install` e depois `npm test`.
