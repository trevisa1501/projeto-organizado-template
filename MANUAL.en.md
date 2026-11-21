# Workflow guide

English · [Português](MANUAL.md)

## From idea to pull request

Before installing the optional shortcut, replace `tema` in the commands below with `node cli/tema.cjs` and run them from your hub folder. Set `PROJETO_ORGANIZADO_HOME` as shown in the [quick start](README.md#get-started) to select your hub explicitly.

1. **Idea (`ideia`).** Search for a topic with `tema buscar "<search term>"`. To create one, run `tema novo <slug> --titulo "<title>" --projeto "<project>"`.
2. **In discussion (`discutindo`).** Set the topic's `estado` field to `discutindo` and record context, decisions, and acceptance criteria in `versoes/v1.md`.
3. **In review (`em-pr`).** Once the design is agreed, implement it on a branch in the project repository and open a PR. Record the branch in `branch_ativa` and the PR URL in `pr_ativo`. Set `estado` to `em-pr`.
4. **Done (`pronto`).** After review, record the outcome in the topic history, update the current summary, remove the active PR fields, and set `estado` to `pronto`. Run `tema nova-versao <slug>` when you want to revisit the topic in a new version.

Run `tema painel` to regenerate the dashboard. To register a project, copy the [project template](templates/PROJETO.md) into `projetos/` with the project's name and pass that filename without the extension to `--projeto`.

## Optional installation

Run `node cli/install-local.cjs --check` to see what would change. It exits with status 1 while installation changes are pending. Run `node cli/install-local.cjs` to write the hub pointer, install the `tema` shortcut, and copy the [Fluxo Organizado skill](regras/skills/fluxo-organizado/SKILL.md) to detected agent skill directories. If you already have another hub installed, use the CLI directly to preserve that setup.

Add your user directory's `.local/bin` folder to PATH to call `tema` from other folders. The CLI checks the hub pointer before falling back to the current directory. Set `PROJETO_ORGANIZADO_HOME` to override both.

## Syncing and worktrees

- Run `tema sync` to pull changes from your hub's remote.
- Run `tema sync --push -m "docs: update topic"` to refresh the dashboard, commit, and push your hub changes. Check which remote will receive the changes before pushing.
- To audit branches and worktrees, copy [projetos.example.json](config/projetos.example.json) to `config/projetos.local.json`, fill in your local paths, and run `tema worktrees`.
- When sharing your hub with an agent, give it the vault path and ask it to read the skill and search for an existing topic before editing a tracked project.
