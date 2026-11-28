# Modelos de referência

Coloque aqui (pelo GitHub: **Add file → Upload files**) os arquivos de teste:

- boneco smile pintado no Bambu Studio (3MF)
- arco rendilhado
- chaveiro de 2 cores
- figura com peças separadas

Os testes automáticos abrem todos os .stl, .obj e .3mf desta pasta.

## conferencia_pintura.3mf (gerado pelo app, etapa 1.3)

Serve para conferir se o app entende a pintura fina do Bambu do mesmo jeito que o Bambu Studio. São dois cubos brancos de 30 mm. Abrindo no Bambu Studio, deve aparecer:

- **Cubo da esquerda:**
  - em cima, a letra **F** azul, legível olhando de cima com a frente do cubo virada para você;
  - na frente, um **triângulo azul** apoiado na borda de baixo, com a ponta no centro da face;
  - na frente, um **triangulinho bege no canto de cima à esquerda**.
- **Cubo da direita:** é o espelho do outro. O F aparece ao contrário e o triangulinho bege fica no canto de cima à **direita**.

No app tem que aparecer igual. Se no Bambu o desenho sair embaralhado, o app está lendo a pintura fina errado. O arquivo é refeito por `testes/gerar-modelos.mjs` (função `conferenciaPintura3mf`).
