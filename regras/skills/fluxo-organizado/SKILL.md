---
name: fluxo-organizado
description: Consulta e registra temas no Projeto Organizado antes de alterar projetos acompanhados pelo hub.
---

# Fluxo Organizado

1. Encontre o hub pelo comando `tema`, pela variável `PROJETO_ORGANIZADO_HOME` ou pelo campo `hubPath` em `~/.projeto-organizado.json`.
2. Use `tema buscar "<assunto>"` antes de criar um tema. Se o assunto já existir, retome a versão em andamento. Abra uma nova versão quando houver evolução de um tema concluído.
3. Registre contexto, decisões e critérios de aceite no arquivo da versão. Combine o desenho com a pessoa responsável antes de implementar.
4. Faça a alteração em uma branch e abra um PR no repositório do projeto. Registre a branch e o link no tema e atualize o estado para `em-pr`.
5. Após a revisão, registre o resultado, atualize a visão atual e regenere o painel com `tema painel`.
6. Use `tema sync --push` quando houver autorização para enviar o conteúdo ao remoto do próprio hub. Confira o destino e o que será enviado.

Pedidos de leitura e pesquisa podem seguir direto. Use o modo direto para alterações pontuais quando a pessoa responsável pedir essa exceção.
