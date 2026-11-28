# Testes automáticos

- `unidade/` — testes rápidos no Node: leitores de STL/OBJ/3MF, **3MF ida e volta** (`3mf-ida-volta.test.mjs`: abrir, exportar e reabrir sem perder objetos, partes, filamentos, placas nem pintura), simplificação, PWA e versões das bibliotecas, **pintura do Bambu** (`pintura.test.mjs`: formato, pedaços da pintura fina, trocar/apagar cor, smile ida e volta letra por letra, malha da tela por cor), **histórico e projetos** (`historico.test.mjs`: desfazer/refazer, desfazer reabrindo o original, editar passo antigo, projeto salvo, arquivo `.lyke`) e **seleção** (`selecao.test.mjs`: vizinhança, varinha por cor/ângulo/casca, faces visíveis, laço, somar/tirar, crescer/encolher, contorno da pintura fina).
- `navegador/rodar.mjs` — abre o app no Chromium e simula os aparelhos de teste (PC de 4 GB, tablet, Galaxy S23 Ultra, aparelho fraco), com gestos de toque. Exporta 3MF pelo botão, pelo Ctrl+E e pela barra do celular e confere o arquivo baixado. Salva capturas de tela e os 3MF exportados em `testes/resultados/`.
- `gerar-modelos.mjs` — cria os modelos de teste em `testes/gerados/` (inclusive um STL de 1 milhão de triângulos e um projeto do Bambu completo, `projeto-bambu.3mf`).
- `modelos/` — arquivos de referência do Yuri (smile, arco…). **Todo arquivo .stl/.obj/.3mf colocado aqui é aberto automaticamente pelo teste do navegador.**

Rodar: `npm install` e depois `npm test`. Para rodar só uma parte do teste do navegador: `SO="histórico" node testes/navegador/rodar.mjs` (o nome da seção, ou um pedaço dele).

## Conferência no Bambu Studio de verdade (fora do `npm test`)

Na etapa 1.2 os 3MF exportados também foram fatiados no Bambu Studio 02.08.02.61 para Linux (linha de comando `--slice 0`), comparando gramas por filamento e por placa com o arquivo original. Isso não faz parte do `npm test` (o Bambu tem ~230 MB e licença AGPL; só é usado como ferramenta, sem copiar código).

Resultado na v0.0.2 (gramas por placa, filamento entre parênteses):

| Modelo | Original | Exportado pelo app |
| --- | --- | --- |
| Smile, placa 1 / 2 / 3 | 69,05 (2) · 26,81 (2) + 73,52 (4) · 15,19 (4) | igual |
| Arco, placas 1 a 9 | 157,16 · 159,71 · 154,24 · 66,28 · 67,19 · 67,53 · 67,18 · 66,27 · 236,85 | igual |

O tempo estimado varia um pouco a cada fatiamento **do mesmo arquivo** (no arco, até ~2% entre duas fatiadas do original), então o tempo não serve para comparar; os gramas, sim.

