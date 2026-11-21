#!/usr/bin/env node
'use strict';

const {
  resolveHubRoot,
  writePainel,
  buscarTemas,
  createTema,
  createNovaVersao,
} = require('./lib/hub.cjs');
const { auditWorktrees, syncHub } = require('./lib/git-ops.cjs');

const HELP_TEXT = `Uso: tema <comando> [opções]

Comandos disponíveis:
  painel                                 Regenera PAINEL.md a partir dos temas
  buscar "<termo>"                       Busca temas por título, slug, projeto ou conteúdo (ignora acentos)
  novo <slug> --titulo "..." --projeto "..." [--estado ideia] [--relacionado "..."] [--fonte "..."]
                                         Cria novo tema (temas/<slug>/<slug>.md + versoes/v1.md)
  nova-versao <slug> [--resumo "..."]    Abre a próxima versão (v2, v3...) de um tema existente
  worktrees                              Audita worktrees e branches locais e grava WORKTREES.local.md
  sync [--push] [--message "..."]        Sincroniza o hub com origin via pull --rebase seguro

Opções globais:
  -h, --help                             Exibe esta ajuda
`;

function parseFlags(args, { multi = [], booleans = [], valueFlags = [] } = {}) {
  const multiSet = new Set(multi);
  const boolSet = new Set(booleans);
  const valSet = new Set([...valueFlags, ...multi]);
  const flags = {};
  for (const k of multi) flags[k] = [];
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      flags.help = true;
      continue;
    }
    if (arg.startsWith('--') || arg === '-m') {
      const normalized = arg === '-m' ? '--message' : arg;
      const eqIdx = normalized.indexOf('=');
      let key;
      let val;
      if (eqIdx !== -1) {
        key = normalized.slice(2, eqIdx);
        val = normalized.slice(eqIdx + 1);
      } else {
        key = normalized.slice(2);
      }

      if (boolSet.has(key)) {
        flags[key] = true;
        continue;
      }
      if (!valSet.has(key)) {
        throw new Error(`Opção desconhecida: --${key}`);
      }
      if (val === undefined) {
        if (i + 1 >= args.length) {
          throw new Error(`A opção --${key} exige um valor.`);
        }
        val = args[i + 1];
        i += 1;
      }
      if (multiSet.has(key)) {
        const parts = String(val)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        flags[key].push(...parts);
      } else {
        flags[key] = val;
      }
      continue;
    }
    positionals.push(arg);
  }
  return { flags, positionals };
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const [cmd, ...rest] = argv;
  const hubRoot = resolveHubRoot();

  if (cmd === 'painel') {
    const { flags } = parseFlags(rest);
    if (flags.help) {
      process.stdout.write(HELP_TEXT);
      return 0;
    }
    const res = writePainel(hubRoot);
    console.log(`PAINEL.md atualizado com ${res.temaCount} tema(s).`);
    if (res.warnings.length > 0) {
      console.log('Avisos:');
      for (const w of res.warnings) console.log(`  - ${w}`);
    }
    return 0;
  }

  if (cmd === 'buscar') {
    const { flags, positionals } = parseFlags(rest);
    if (flags.help) {
      process.stdout.write(HELP_TEXT);
      return 0;
    }
    const query = positionals.join(' ').trim();
    if (!query) {
      throw new Error('Informe um termo de busca. Ex.: tema buscar "reunioes"');
    }
    const results = buscarTemas(hubRoot, query);
    if (results.length === 0) {
      console.log(`Nenhum tema encontrado para "${query}".`);
      return 0;
    }
    console.log(`Encontrados ${results.length} tema(s) para "${query}":`);
    for (const r of results) {
      const projs = r.projetos.join(', ');
      console.log(`- ${r.slug} | ${r.titulo} [${r.estado}, ${r.versao}] (${projs}) — match: ${r.matchedIn.join(', ')}`);
    }
    return 0;
  }

  if (cmd === 'novo') {
    const { flags, positionals } = parseFlags(rest, {
      valueFlags: ['titulo', 'estado'],
      multi: ['projeto', 'relacionado', 'fonte'],
    });
    if (flags.help) {
      process.stdout.write(HELP_TEXT);
      return 0;
    }
    const slug = positionals[0];
    if (!slug) {
      throw new Error('Informe o slug do tema. Ex.: tema novo meu-tema --titulo "Meu Tema" --projeto HortaComunitaria');
    }
    const res = createTema(hubRoot, {
      slug,
      titulo: flags.titulo,
      projetos: flags.projeto,
      estado: flags.estado || 'ideia',
      relacionados: flags.relacionado,
      fontes_anteriores: flags.fonte,
    });
    console.log(`Tema criado: ${res.slug}`);
    console.log(`  Principal: ${res.temaPath}`);
    console.log(`  Versão v1: ${res.versaoPath}`);
    return 0;
  }

  if (cmd === 'nova-versao') {
    const { flags, positionals } = parseFlags(rest, {
      valueFlags: ['resumo'],
    });
    if (flags.help) {
      process.stdout.write(HELP_TEXT);
      return 0;
    }
    const slug = positionals[0];
    if (!slug) {
      throw new Error('Informe o slug do tema. Ex.: tema nova-versao meu-tema');
    }
    const res = createNovaVersao(hubRoot, slug, { resumo: flags.resumo || '' });
    console.log(`Nova versão criada para ${res.slug}: ${res.versao}`);
    console.log(`  Arquivo: ${res.versaoPath}`);
    return 0;
  }

  if (cmd === 'worktrees') {
    const { flags } = parseFlags(rest);
    if (flags.help) {
      process.stdout.write(HELP_TEXT);
      return 0;
    }
    const res = auditWorktrees(hubRoot);
    if (res.configError) {
      console.log(`Erro na config local: ${res.configError}`);
    } else if (res.configWarning) {
      console.log(`Aviso: ${res.configWarning}`);
    }
    for (const proj of res.projects) {
      if (proj.error) {
        console.log(`- ${proj.nome}: ERRO (${proj.error})`);
        continue;
      }
      const orphanWts = proj.worktrees.filter((w) => w.orphan).length;
      const orphanBrs = proj.unmergedBranches.filter((b) => b.orphan).length;
      console.log(
        `- ${proj.nome}: ${proj.worktrees.length} worktree(s) (${orphanWts} órfã(s)), ${proj.unmergedBranches.length} branch(es) fora da principal (${orphanBrs} órfã(s))`
      );
    }
    console.log(`Relatório gravado em: ${res.outputPath}`);
    return 0;
  }

  if (cmd === 'sync') {
    const { flags } = parseFlags(rest, {
      booleans: ['push'],
      valueFlags: ['message'],
    });
    if (flags.help) {
      process.stdout.write(HELP_TEXT);
      return 0;
    }
    const res = syncHub(hubRoot, {
      push: Boolean(flags.push),
      message: flags.message || '',
    });
    console.log(`Sync concluído: ${res.summary}`);
    return 0;
  }

  throw new Error(`Comando desconhecido: "${cmd}". Use "tema --help" para ver os comandos disponíveis.`);
}

if (require.main === module) {
  try {
    const code = main(process.argv.slice(2));
    process.exit(code);
  } catch (err) {
    process.stderr.write(`Erro: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

module.exports = { main };
