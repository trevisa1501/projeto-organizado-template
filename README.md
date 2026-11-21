# Projeto Organizado

English · [Português](README.pt-BR.md)

A GitHub template for people building with AI who want to pick up where they left off. It includes an Obsidian vault, a CLI called `tema`, and a workflow for taking each idea through to a pull request.

## Why I built it

I could work on several projects with AI. Picking up the work the next day was the hard part. An idea would start in Telegram and the discussion would continue in another chat. By the time I got back to the code, I had to figure out which decision still held and which branch had the work.

I built Projeto Organizado to give each topic a home that both my agents and I could find. An idea becomes a topic. Decisions are recorded by version. When implementation starts, the topic links to the pull request. In Obsidian, I can open the dashboard and see what's being discussed, reviewed, or finished.

## Get started

1. On GitHub, click **Use this template → Create a new repository**. Choose **Private** if you'll record internal discussions or decisions.
2. Clone your new repository and open its folder in a terminal. You'll need Git and Node.js 22 or later. The CLI has zero dependencies.
3. Run these commands to find the bundled example, create your first topic, and refresh the dashboard.

```bash
export PROJETO_ORGANIZADO_HOME="$PWD"
node cli/tema.cjs buscar "horta"
node cli/tema.cjs novo my-first-idea --titulo "My first idea" --projeto HortaComunitaria
node cli/tema.cjs painel
```

In PowerShell, use `$env:PROJETO_ORGANIZADO_HOME = (Get-Location).Path` for the first line.

4. Read the [dashboard](PAINEL.md), or open the repository folder as an Obsidian vault to see the dashboard and graph view.

The CLI commands, output, and bundled example are in Portuguese. Topic titles, notes, and decisions can be written in English or Portuguese. The [English manual](MANUAL.en.md) explains the commands and status fields. The [community garden example](temas/pagina-inicial/versoes/v1.md) shows how to record an idea, decisions, and the outcome of a PR.

## Tests and license

Run `npm test` to run the test suite. The project is available under the [MIT License](LICENSE).
