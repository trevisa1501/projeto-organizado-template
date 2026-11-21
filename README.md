# Projeto Organizado

Um template para quem constrói com IA e precisa retomar o trabalho sem reconstruir conversas. Reúne um cofre Obsidian, o CLI `tema` e uma rotina para acompanhar cada assunto da ideia ao pull request.

## Por que eu criei

Eu conseguia tocar vários projetos com IA. O difícil era retomar o trabalho no dia seguinte. Uma ideia ficava no Telegram, a discussão avançava em outro chat e, quando eu voltava ao código, precisava descobrir qual decisão ainda valia e em qual branch o trabalho tinha ficado.

Criei o Projeto Organizado para dar a cada assunto um lugar que eu e meus agentes pudéssemos consultar. A ideia vira um tema. As decisões ficam registradas por versão. Quando chega a hora de implementar, o tema aponta para o PR. No Obsidian, eu abro o painel e vejo o que está em discussão, em revisão ou concluído.

## Comece em cinco minutos

1. No GitHub, clique em **Use this template → Create a new repository**. Escolha **Private** se pretende registrar conversas de trabalho ou decisões internas.
2. Clone o seu repositório e entre na pasta pelo terminal. Você precisa de Git e Node.js 22 ou superior. O CLI funciona sem instalar dependências.
3. Rode os comandos abaixo para ver o exemplo e criar seu primeiro tema.

```bash
export PROJETO_ORGANIZADO_HOME="$PWD"
node cli/tema.cjs buscar "horta"
node cli/tema.cjs novo minha-ideia --titulo "Minha primeira ideia" --projeto HortaComunitaria
node cli/tema.cjs painel
```

No PowerShell, use `$env:PROJETO_ORGANIZADO_HOME = (Get-Location).Path` na primeira linha.

4. Leia o [painel](PAINEL.md). Se usa Obsidian, abra a pasta como cofre e consulte o painel e a visualização de grafo. O CLI também funciona pelo terminal sem Obsidian.

Veja a [página inicial da horta](temas/pagina-inicial/pagina-inicial.md) e sua [primeira versão](temas/pagina-inicial/versoes/v1.md) para acompanhar um exemplo completo. O [manual](MANUAL.md) explica como cadastrar seus projetos, conectar agentes e sincronizar o hub.

## Testes e licença

Rode `npm test` para executar os testes. O projeto está sob a [licença MIT](LICENSE).
