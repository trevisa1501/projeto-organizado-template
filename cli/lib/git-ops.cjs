'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadHubData, writePainel, stripWikilink } = require('./hub.cjs');

function runGit(cwd, args, extraEnv = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function tryRunGit(cwd, args, extraEnv = {}) {
  try {
    const stdout = runGit(cwd, args, extraEnv);
    return { ok: true, stdout };
  } catch (err) {
    return {
      ok: false,
      stdout: err && err.stdout ? String(err.stdout) : '',
      stderr: err && err.stderr ? String(err.stderr) : (err && err.message ? err.message : ''),
      error: err,
    };
  }
}

function parseWorktreePorcelain(output) {
  const blocks = String(output || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n\n+/)
    .filter(Boolean);

  const items = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const entry = { path: '', branch: '(detached)', isBare: false };
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        entry.path = line.slice('worktree '.length).trim();
      } else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length).trim();
        entry.branch = ref.replace(/^refs\/heads\//, '');
      } else if (line === 'bare') {
        entry.isBare = true;
      } else if (line === 'detached') {
        entry.branch = '(detached)';
      }
    }
    if (entry.path) items.push(entry);
  }
  return items;
}

function renderWorktreesMarkdown({ projects, configWarning, configError }) {
  const lines = [
    '# Worktrees e Branches Locais (Esta Máquina)',
    '',
    '> Arquivo local (`gitignored`), gerado por `tema worktrees`. Não é sincronizado com o GitHub.',
    '> Voltar ao painel compartilhado: [[PAINEL]]',
    '',
  ];

  if (configError) {
    lines.push(`> **Erro na configuração local:** ${configError}`);
    lines.push('');
  } else if (configWarning) {
    lines.push(`> **Aviso:** ${configWarning}`);
    lines.push('');
  }

  const orphans = [];

  if (projects.length === 0) {
    lines.push('_Nenhum projeto local auditado._');
    lines.push('');
  } else {
    for (const proj of projects) {
      lines.push(`## ${proj.nome}`);
      lines.push('');
      lines.push(`- **Caminho local:** \`${proj.caminho}\``);
      if (proj.error) {
        lines.push(`- **Status:** Erro — ${proj.error}`);
        lines.push('');
        continue;
      }

      lines.push('');
      lines.push('### Worktrees');
      lines.push('');
      if (proj.worktrees.length === 0) {
        lines.push('_Nenhuma worktree encontrada._');
      } else {
        lines.push('| Caminho | Branch | Principal | Vínculo no Hub | Status |');
        lines.push('|---|---|---|---|---|');
        for (const wt of proj.worktrees) {
          const link = wt.temaSlug ? `[[${wt.temaSlug}]]` : '-';
          const status = wt.orphan ? 'Órfã' : 'OK';
          lines.push(`| \`${wt.path}\` | \`${wt.branch}\` | ${wt.isMain ? 'Sim' : 'Não'} | ${link} | ${status} |`);
          if (wt.orphan) {
            orphans.push(`- **${proj.nome}** (worktree): \`${wt.branch}\` em \`${wt.path}\``);
          }
        }
      }
      lines.push('');

      lines.push('### Branches não mescladas');
      lines.push('');
      if (proj.unmergedBranches.length === 0) {
        lines.push('_Nenhuma branch pendente fora da principal._');
      } else {
        lines.push('| Branch | Vínculo no Hub | Status |');
        lines.push('|---|---|---|');
        for (const br of proj.unmergedBranches) {
          const link = br.temaSlug ? `[[${br.temaSlug}]]` : '-';
          const status = br.orphan ? 'Órfã' : 'Vinculada';
          lines.push(`| \`${br.branch}\` | ${link} | ${status} |`);
          if (br.orphan) {
            orphans.push(`- **${proj.nome}** (branch): \`${br.branch}\``);
          }
        }
      }
      lines.push('');
    }
  }

  lines.push('## Itens Órfãos (Sem Tema Vinculado)');
  lines.push('');
  if (orphans.length === 0) {
    lines.push('_Nenhum item órfão detectado nesta máquina._');
  } else {
    for (const item of orphans) lines.push(item);
  }
  lines.push('');

  return `${lines.join('\n').trimEnd()}\n`;
}

function auditWorktrees(hubRoot, localConfigPath) {
  const root = path.resolve(hubRoot);
  const outputPath = path.join(root, 'WORKTREES.local.md');
  const configPath = localConfigPath
    ? path.resolve(localConfigPath)
    : path.join(root, 'config', 'projetos.local.json');

  const { temas } = loadHubData(root);
  const projectBranchToTema = new Map();
  const unscopedBranchToTema = new Map();
  for (const tema of temas) {
    if (tema.data && tema.data.branch_ativa) {
      const branchKey = String(tema.data.branch_ativa).trim();
      const projs = Array.isArray(tema.data.projetos) ? tema.data.projetos.map(stripWikilink).filter(Boolean) : [];
      if (projs.length === 0) {
        unscopedBranchToTema.set(branchKey, tema.slug);
      } else {
        for (const pName of projs) {
          projectBranchToTema.set(`${pName.toLowerCase()}\0${branchKey}`, tema.slug);
        }
      }
    }
  }
  const resolveTemaForBranch = (projectName, branchName) => {
    const scoped = projectBranchToTema.get(`${String(projectName || '').toLowerCase()}\0${branchName}`);
    return scoped || unscopedBranchToTema.get(branchName);
  };

  if (!fs.existsSync(configPath)) {
    const configWarning =
      'Arquivo config/projetos.local.json não encontrado. Copie config/projetos.example.json para config/projetos.local.json e informe os caminhos locais.';
    fs.writeFileSync(
      outputPath,
      renderWorktreesMarkdown({ projects: [], configWarning }),
      'utf8'
    );
    return { outputPath, projects: [], configWarning };
  }

  let parsedConfig;
  try {
    parsedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!parsedConfig || !Array.isArray(parsedConfig.projetos)) {
      throw new Error('Estrutura inválida: esperado objeto com array "projetos".');
    }
  } catch (err) {
    const configError = `Não foi possível ler config/projetos.local.json: ${err.message}`;
    fs.writeFileSync(
      outputPath,
      renderWorktreesMarkdown({ projects: [], configError }),
      'utf8'
    );
    return { outputPath, projects: [], configError };
  }

  const projects = [];
  for (const item of parsedConfig.projetos) {
    const nome = String((item && item.nome) || '(sem nome)');
    const caminho = item && item.caminho ? String(item.caminho) : '';
    const branchPrincipal = String((item && item.branch_principal) || 'main');

    if (!caminho || !fs.existsSync(caminho)) {
      projects.push({
        nome,
        caminho,
        error: 'Caminho não encontrado neste computador.',
        worktrees: [],
        unmergedBranches: [],
      });
      continue;
    }

    const repoCheck = tryRunGit(caminho, ['rev-parse', '--is-inside-work-tree']);
    if (!repoCheck.ok || repoCheck.stdout.trim() !== 'true') {
      projects.push({
        nome,
        caminho,
        error: 'Diretório não é um repositório Git válido.',
        worktrees: [],
        unmergedBranches: [],
      });
      continue;
    }

    const wtRes = tryRunGit(caminho, ['worktree', 'list', '--porcelain']);
    const rawWts = wtRes.ok ? parseWorktreePorcelain(wtRes.stdout) : [];
    const normalizedRepoPath = path.resolve(caminho).toLowerCase();

    const worktrees = rawWts.map((wt, idx) => {
      const isMain = idx === 0 || path.resolve(wt.path).toLowerCase() === normalizedRepoPath;
      const linkedSlug = resolveTemaForBranch(nome, wt.branch);
      let orphan = false;
      if (isMain && wt.branch === branchPrincipal) {
        orphan = false;
      } else if (linkedSlug) {
        orphan = false;
      } else {
        orphan = true;
      }
      const entry = {
        path: wt.path,
        branch: wt.branch,
        isMain,
        orphan,
      };
      if (linkedSlug) entry.temaSlug = linkedSlug;
      return entry;
    });

    const refCheck = tryRunGit(caminho, ['rev-parse', '--verify', branchPrincipal]);
    const baseRef = refCheck.ok ? branchPrincipal : 'HEAD';
    const brRes = tryRunGit(caminho, ['branch', '--no-merged', baseRef, '--format=%(refname:short)']);
    const unmergedBranches = [];
    if (brRes.ok) {
      const names = brRes.stdout
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s && s !== branchPrincipal);
      for (const branch of names) {
        const linkedSlug = resolveTemaForBranch(nome, branch);
        const entry = {
          branch,
          orphan: !linkedSlug,
        };
        if (linkedSlug) entry.temaSlug = linkedSlug;
        unmergedBranches.push(entry);
      }
    }

    projects.push({
      nome,
      caminho,
      worktrees,
      unmergedBranches,
    });
  }

  fs.writeFileSync(outputPath, renderWorktreesMarkdown({ projects }), 'utf8');
  return { outputPath, projects };
}

function isRebaseInProgress(hubRoot) {
  const mergePathRes = tryRunGit(hubRoot, ['rev-parse', '--git-path', 'rebase-merge']);
  if (mergePathRes.ok) {
    const p = path.resolve(hubRoot, mergePathRes.stdout.trim());
    if (fs.existsSync(p)) return true;
  }
  const applyPathRes = tryRunGit(hubRoot, ['rev-parse', '--git-path', 'rebase-apply']);
  if (applyPathRes.ok) {
    const p = path.resolve(hubRoot, applyPathRes.stdout.trim());
    if (fs.existsSync(p)) return true;
  }
  return false;
}

function getConflictedFiles(hubRoot) {
  const res = tryRunGit(hubRoot, ['diff', '--name-only', '--diff-filter=U']);
  if (!res.ok) return [];
  return res.stdout
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function syncHub(hubRoot, { push = false, message = '' } = {}) {
  const root = path.resolve(hubRoot);
  const check = tryRunGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (!check.ok || check.stdout.trim() !== 'true') {
    throw new Error(`Diretório "${root}" não é um repositório Git.`);
  }
  if (isRebaseInProgress(root)) {
    throw new Error(
      'Já existe um rebase em andamento no hub. Resolva ou aborte o rebase manualmente (git rebase --abort) antes de executar "tema sync".'
    );
  }

  const gitNonInteractiveEnv = {
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
    GIT_TERMINAL_PROMPT: '0',
  };

  let committed = false;
  let pulled = false;
  let autoResolvedPainel = false;
  let pushed = false;

  const topLevel = path.resolve(runGit(root, ['rev-parse', '--show-toplevel']).trim());
  const expectedPainelRel = path.relative(topLevel, path.join(root, 'PAINEL.md')).replace(/\\/g, '/');

  const statusOut = runGit(root, ['status', '--porcelain', '--', '.']).trim();
  if (statusOut !== '') {
    if (!push) {
      throw new Error(
        'Existem alterações locais não commitadas no hub. Salve/commite suas mudanças ou execute "tema sync --push".'
      );
    }
    writePainel(root);
    runGit(root, ['add', '-A', '--', '.']);
    const staged = runGit(root, ['diff', '--cached', '--name-only']).trim();
    if (staged !== '') {
      const commitMsg = String(message || '').trim() || 'docs: atualiza temas e painel';
      runGit(root, ['commit', '-m', commitMsg]);
      committed = true;
    }
  }

  const remotes = runGit(root, ['remote'])
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const hasOrigin = remotes.includes('origin');

  if (hasOrigin) {
    const pullRes = tryRunGit(root, ['pull', '--rebase'], gitNonInteractiveEnv);
    if (pullRes.ok) {
      pulled = true;
    } else if (isRebaseInProgress(root)) {
      let guard = 0;
      const MAX_REBASE_STEPS = 25;
      try {
        while (isRebaseInProgress(root)) {
          guard += 1;
          if (guard > MAX_REBASE_STEPS) {
            throw new Error('Limite de passos de rebase atingido; rebase abortado com segurança.');
          }

          const conflicts = getConflictedFiles(root);
          if (conflicts.length === 1 && conflicts[0] === expectedPainelRel) {
            writePainel(root);
            runGit(root, ['add', '--', 'PAINEL.md']);
            const contRes = tryRunGit(root, ['-c', 'core.editor=true', 'rebase', '--continue'], gitNonInteractiveEnv);
            autoResolvedPainel = true;
            if (contRes.ok) {
              pulled = true;
              break;
            }
            if (!isRebaseInProgress(root)) {
              throw new Error(`Falha ao continuar rebase após regenerar PAINEL.md: ${contRes.stderr.trim()}`);
            }
          } else {
            const listStr = conflicts.length > 0 ? conflicts.join(', ') : '(arquivos não identificados)';
            throw new Error(
              `Conflito detectado fora do PAINEL.md (${listStr}). Rebase abortado com segurança e commits locais preservados.`
            );
          }
        }
      } catch (err) {
        if (isRebaseInProgress(root)) {
          tryRunGit(root, ['rebase', '--abort']);
        }
        throw err;
      }
      pulled = true;
    } else {
      throw new Error(`Falha ao executar git pull --rebase: ${pullRes.stderr.trim() || pullRes.stdout.trim()}`);
    }

    // Após rebase, garante que PAINEL.md reflita contagens exatas mesmo quando o Git auto-mesclou sem conflito
    if (push) {
      writePainel(root);
      const painelStatus = runGit(root, ['status', '--porcelain', '--', 'PAINEL.md']).trim();
      if (painelStatus !== '') {
        runGit(root, ['add', 'PAINEL.md']);
        runGit(root, ['commit', '-m', 'docs: atualiza PAINEL.md após sincronização']);
        committed = true;
      }
    }
  }

  if (push && hasOrigin) {
    const pushRes = tryRunGit(root, ['push'], gitNonInteractiveEnv);
    if (!pushRes.ok) {
      throw new Error(`Falha ao executar git push (sem --force): ${pushRes.stderr.trim() || pushRes.stdout.trim()}`);
    }
    pushed = true;
  }

  const parts = [];
  if (committed) parts.push('commit local criado');
  if (pulled) parts.push(autoResolvedPainel ? 'pull-rebase concluído (PAINEL.md regenerado)' : 'pull-rebase concluído');
  if (!hasOrigin) parts.push('sem remoto origin configurado');
  if (pushed) parts.push('push enviado para origin');
  const summary = parts.length > 0 ? parts.join('; ') : 'hub já sincronizado';

  return {
    pulled,
    autoResolvedPainel,
    committed,
    pushed,
    summary,
  };
}

module.exports = {
  auditWorktrees,
  syncHub,
};
