# Manual de rotina

[English](MANUAL.en.md) · Português
## Da ideia ao PR

1. **Ideia.** Busque o assunto com `tema buscar "<assunto>"`. Se for novo, crie-o com `tema novo <slug> --titulo "<título>" --projeto "<projeto>"`.
2. **Discutindo.** Mude o campo `estado` do tema para `discutindo` e registre contexto, decisões e critérios de aceite em `versoes/v1.md`.
3. **Em PR.** Depois de combinar o desenho, implemente em uma branch no repositório do projeto. Abra o PR e registre `branch_ativa` e `pr_ativo` no tema. Mude `estado` para `em-pr`.
4. **Pronto.** Após a revisão, registre o desfecho no histórico do tema, atualize a visão atual, retire os campos do PR ativo e marque `pronto`. Para uma evolução, rode `tema nova-versao <slug>`.

Rode `tema painel` para atualizar o resumo após edições. Crie um arquivo em `projetos/` a partir de [PROJETO.md](templates/PROJETO.md) e use o nome do arquivo, sem extensão, em `--projeto`.

## Instalação opcional

Rode `node cli/install-local.cjs --check` para listar os arquivos que precisam ser atualizados. Até a instalação estar em dia, o comando de verificação retorna código 1. A instalação com `node cli/install-local.cjs` grava o ponteiro do hub, o comando `tema` e a [skill Fluxo Organizado](regras/skills/fluxo-organizado/SKILL.md) nos diretórios de agentes detectados. Se você já tem outro hub instalado, prefira usar o CLI diretamente para preservar sua configuração.

Adicione o diretório `.local/bin` da sua pasta de usuário ao PATH para chamar `tema` de outras pastas. Por padrão, o CLI considera o ponteiro do hub antes da pasta atual. A variável `PROJETO_ORGANIZADO_HOME` permite selecionar outro hub explicitamente.

## Sincronização e worktrees

- Use `tema sync` para puxar alterações do remoto do seu hub.
- Use `tema sync --push -m "docs: atualiza tema"` para atualizar o painel, registrar e enviar as alterações do hub ao seu remoto Git. Confira o destino antes de enviar.
- Para auditar branches e worktrees de outros projetos, copie [projetos.example.json](config/projetos.example.json) para `config/projetos.local.json`, preencha seus caminhos e rode `tema worktrees`.
- Antes de compartilhar o hub com um agente, indique o caminho do cofre e peça que ele leia a skill e busque um tema antes de alterar um projeto acompanhado.
