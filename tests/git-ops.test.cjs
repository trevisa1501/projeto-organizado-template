'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { auditWorktrees, syncHub } = require('../cli/lib/git-ops.cjs');
const { createTema } = require('../cli/lib/hub.cjs');
const { parseFrontmatter, serializeFrontmatter } = require('../cli/lib/frontmatter.cjs');

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initGitRepo(dir, initialBranch = 'main') {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', initialBranch]);
  git(dir, ['config', 'user.name', 'Test User']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

function makeHubSkeleton(dir) {
  fs.mkdirSync(path.join(dir, 'projetos'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'temas'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projetos', 'HortaComunitaria.md'), '# HortaComunitaria\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'projetos', 'projeto-organizado.md'), '# projeto-organizado\n', 'utf8');
}

test('auditWorktrees lida com config ausente, JSON invalido, caminho quebrado e identifica orfaos vs vinculados', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'po-wt-'));
  try {
    const hub = path.join(base, 'hub');
    makeHubSkeleton(hub);

    // 1. Config ausente nao deve estourar excecao
    const resMissing = auditWorktrees(hub);
    assert.ok(fs.existsSync(resMissing.outputPath));
    assert.equal(resMissing.projects.length, 0);

    // 2. JSON invalido tambem nao deve estourar excecao
    const cfgPath = path.join(hub, 'config', 'projetos.local.json');
    fs.writeFileSync(cfgPath, '{ invalid json', 'utf8');
    const resBadJson = auditWorktrees(hub);
    assert.ok(resBadJson.configError);
    assert.ok(fs.existsSync(resBadJson.outputPath));

    // 3. Projeto valido + projeto inexistente + diretorio nao-git
    const validRepo = path.join(base, 'repo-valido');
    initGitRepo(validRepo, 'main');
    fs.writeFileSync(path.join(validRepo, 'README.md'), '# repo\n', 'utf8');
    git(validRepo, ['add', 'README.md']);
    git(validRepo, ['commit', '-m', 'init']);

    // Criar branch vinculada a tema e branch orfa + worktree extra orfa
    git(validRepo, ['checkout', '-b', 'feat/vinculada']);
    fs.writeFileSync(path.join(validRepo, 'vinc.txt'), 'vinc\n', 'utf8');
    git(validRepo, ['add', 'vinc.txt']);
    git(validRepo, ['commit', '-m', 'feat vinculada']);

    git(validRepo, ['checkout', 'main']);
    git(validRepo, ['checkout', '-b', 'feat/orfa']);
    fs.writeFileSync(path.join(validRepo, 'orfa.txt'), 'orfa\n', 'utf8');
    git(validRepo, ['add', 'orfa.txt']);
    git(validRepo, ['commit', '-m', 'feat orfa']);
    git(validRepo, ['checkout', 'main']);

    const extraWtPath = path.join(base, 'wt-extra');
    git(validRepo, ['worktree', 'add', '-b', 'wt/extra-orfa', extraWtPath]);

    // Criar tema no hub vinculado a feat/vinculada
    const created = createTema(hub, {
      slug: 'tema-vinculado',
      titulo: 'Tema Vinculado',
      projetos: ['HortaComunitaria'],
      estado: 'em-pr',
    });
    const parsed = parseFrontmatter(fs.readFileSync(created.temaPath, 'utf8'));
    parsed.data.branch_ativa = 'feat/vinculada';
    fs.writeFileSync(created.temaPath, serializeFrontmatter(parsed.data, parsed.body), 'utf8');

    const nonGitDir = path.join(base, 'nao-git');
    fs.mkdirSync(nonGitDir, { recursive: true });

    fs.writeFileSync(
      cfgPath,
      JSON.stringify(
        {
          projetos: [
            { nome: 'Quebrado', caminho: path.join(base, 'nao-existe'), branch_principal: 'main' },
            { nome: 'NaoGit', caminho: nonGitDir, branch_principal: 'main' },
            { nome: 'HortaComunitaria', caminho: validRepo, branch_principal: 'main' },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const res = auditWorktrees(hub);
    assert.equal(res.projects.length, 3);
    assert.ok(res.projects[0].error, 'Projeto inexistente deve registrar error');
    assert.ok(res.projects[1].error, 'Diretorio nao-git deve registrar error');

    const giga = res.projects[2];
    assert.equal(giga.error, undefined);
    assert.equal(giga.worktrees.length, 2);

    const extraWt = giga.worktrees.find((w) => w.branch === 'wt/extra-orfa');
    assert.ok(extraWt);
    assert.equal(extraWt.orphan, true);

    const vincBranch = giga.unmergedBranches.find((b) => b.branch === 'feat/vinculada');
    assert.ok(vincBranch);
    assert.equal(vincBranch.orphan, false);
    assert.equal(vincBranch.temaSlug, 'tema-vinculado');

    const orfaBranch = giga.unmergedBranches.find((b) => b.branch === 'feat/orfa');
    assert.ok(orfaBranch);
    assert.equal(orfaBranch.orphan, true);

    const md = fs.readFileSync(res.outputPath, 'utf8');
    assert.match(md, /wt\/extra-orfa/);
    assert.match(md, /feat\/orfa/);
    assert.match(md, /\[\[tema-vinculado\]\]/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

function setupBareAndTwoClones(base) {
  const bare = path.join(base, 'origin.git');
  fs.mkdirSync(bare, { recursive: true });
  git(bare, ['init', '--bare', '-b', 'main']);

  const cloneA = path.join(base, 'clone-a');
  initGitRepo(cloneA, 'main');
  makeHubSkeleton(cloneA);
  createTema(cloneA, { slug: 'tema-base', titulo: 'Tema Base', projetos: ['HortaComunitaria'] });
  git(cloneA, ['add', '-A']);
  git(cloneA, ['commit', '-m', 'init hub']);
  git(cloneA, ['remote', 'add', 'origin', bare]);
  git(cloneA, ['push', '-u', 'origin', 'main']);

  const cloneB = path.join(base, 'clone-b');
  git(base, ['clone', bare, cloneB]);
  git(cloneB, ['config', 'user.name', 'Clone B']);
  git(cloneB, ['config', 'user.email', 'b@example.com']);
  git(cloneB, ['config', 'commit.gpgsign', 'false']);

  return { bare, cloneA, cloneB };
}

test('syncHub pull limpo, recusa arvore suja sem --push e faz push seguro com --push', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'po-sync-basic-'));
  try {
    const { cloneA, cloneB } = setupBareAndTwoClones(base);

    // Clone A cria tema e sobe via syncHub --push
    createTema(cloneA, { slug: 'tema-a', titulo: 'Tema A', projetos: ['HortaComunitaria'] });
    const pushRes = syncHub(cloneA, { push: true, message: 'docs: adiciona tema-a' });
    assert.equal(pushRes.committed, true);
    assert.equal(pushRes.pushed, true);

    // Clone B com arvore suja sem --push deve recusar sem alterar arquivos
    const dirtyFile = path.join(cloneB, 'rascunho.txt');
    fs.writeFileSync(dirtyFile, 'nao apagar\n', 'utf8');
    assert.throws(() => syncHub(cloneB, { push: false }), /alterações locais|suja|commit|--push/i);
    assert.equal(fs.readFileSync(dirtyFile, 'utf8'), 'nao apagar\n');

    // Remover rascunho e fazer pull limpo
    fs.unlinkSync(dirtyFile);
    const pullRes = syncHub(cloneB, { push: false });
    assert.equal(pullRes.pulled, true);
    assert.equal(pullRes.autoResolvedPainel, false);
    assert.ok(fs.existsSync(path.join(cloneB, 'temas', 'tema-a', 'tema-a.md')));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('syncHub autorresolve conflito EXCLUSIVO em PAINEL.md preservando ambos os temas e contagens exatas', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'po-sync-painel-'));
  try {
    const { cloneA, cloneB } = setupBareAndTwoClones(base);

    // Clone A cria tema-aa (ordena antes de tema-base) e faz push
    createTema(cloneA, { slug: 'tema-aa', titulo: 'Tema AA', projetos: ['HortaComunitaria'] });
    git(cloneA, ['add', '-A']);
    git(cloneA, ['commit', '-m', 'add aa']);
    git(cloneA, ['push', 'origin', 'main']);

    // Clone B (sem puxar A) cria tema-ab (mesma posição antes de tema-base -> conflito real só em PAINEL.md)
    createTema(cloneB, { slug: 'tema-ab', titulo: 'Tema AB', projetos: ['HortaComunitaria'] });
    git(cloneB, ['add', '-A']);
    git(cloneB, ['commit', '-m', 'add ab']);

    const res = syncHub(cloneB, { push: true });
    assert.equal(res.pulled, true);
    assert.equal(res.autoResolvedPainel, true);
    assert.equal(res.pushed, true);

    assert.ok(fs.existsSync(path.join(cloneB, 'temas', 'tema-aa', 'tema-aa.md')));
    assert.ok(fs.existsSync(path.join(cloneB, 'temas', 'tema-ab', 'tema-ab.md')));
    const painel = fs.readFileSync(path.join(cloneB, 'PAINEL.md'), 'utf8');
    assert.match(painel, /\[\[tema-aa\]\]/);
    assert.match(painel, /\[\[tema-ab\]\]/);
    assert.match(painel, /\|\s*\*\*Total\*\*\s*\|\s*\*\*3\*\*\s*\|/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('syncHub atualiza contagem de PAINEL.md mesmo quando Git mescla sem conflito', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'po-sync-automerge-'));
  try {
    const { cloneA, cloneB } = setupBareAndTwoClones(base);

    createTema(cloneA, { slug: 'tema-alpha', titulo: 'Tema Alpha', projetos: ['HortaComunitaria'] });
    git(cloneA, ['add', '-A']);
    git(cloneA, ['commit', '-m', 'add alpha']);
    git(cloneA, ['push', 'origin', 'main']);

    createTema(cloneB, { slug: 'tema-beta', titulo: 'Tema Beta', projetos: ['HortaComunitaria'] });
    git(cloneB, ['add', '-A']);
    git(cloneB, ['commit', '-m', 'add beta']);

    const res = syncHub(cloneB, { push: true });
    assert.equal(res.pulled, true);
    assert.equal(res.pushed, true);
    const painel = fs.readFileSync(path.join(cloneB, 'PAINEL.md'), 'utf8');
    assert.match(painel, /\[\[tema-alpha\]\]/);
    assert.match(painel, /\[\[tema-beta\]\]/);
    assert.match(painel, /\|\s*\*\*Total\*\*\s*\|\s*\*\*3\*\*\s*\|/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('syncHub aborta rebase e preserva commits locais quando conflito envolve arquivo em temas/', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'po-sync-conflict-'));
  try {
    const { cloneA, cloneB } = setupBareAndTwoClones(base);

    const temaPathA = path.join(cloneA, 'temas', 'tema-base', 'tema-base.md');
    const temaPathB = path.join(cloneB, 'temas', 'tema-base', 'tema-base.md');

    // Clone A altera titulo/visao do tema-base e faz push
    fs.writeFileSync(
      temaPathA,
      fs.readFileSync(temaPathA, 'utf8').replace('(Resumo curto e vivo do que já foi decidido sobre este tema.)', 'Decisão do clone A'),
      'utf8'
    );
    git(cloneA, ['add', '-A']);
    git(cloneA, ['commit', '-m', 'edita tema-base em A']);
    git(cloneA, ['push', 'origin', 'main']);

    // Clone B altera a mesma linha no tema-base e commita localmente
    fs.writeFileSync(
      temaPathB,
      fs.readFileSync(temaPathB, 'utf8').replace('(Resumo curto e vivo do que já foi decidido sobre este tema.)', 'Decisão do clone B'),
      'utf8'
    );
    git(cloneB, ['add', '-A']);
    git(cloneB, ['commit', '-m', 'edita tema-base em B']);
    const headBefore = git(cloneB, ['rev-parse', 'HEAD']);

    assert.throws(() => syncHub(cloneB, { push: false }), /conflito|abortado|tema-base/i);

    // Repo NAO pode ficar preso em rebase e commit local deve estar intacto
    const gitDir = path.join(cloneB, '.git');
    assert.equal(fs.existsSync(path.join(gitDir, 'rebase-merge')), false);
    assert.equal(fs.existsSync(path.join(gitDir, 'rebase-apply')), false);
    assert.equal(git(cloneB, ['rev-parse', 'HEAD']), headBefore);
    assert.match(fs.readFileSync(temaPathB, 'utf8'), /Decisão do clone B/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('auditWorktrees escopa branch_ativa por projeto (nao vincula branch homonima de outro projeto)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'po-wt-scope-'));
  try {
    const hub = path.join(base, 'hub');
    makeHubSkeleton(hub);
    fs.writeFileSync(path.join(hub, 'projetos', 'BibliotecaBairro.md'), '# BibliotecaBairro\n', 'utf8');

    const repoCondo = path.join(base, 'condo');
    const repoFy = path.join(base, 'fy');
    for (const r of [repoCondo, repoFy]) {
      initGitRepo(r, 'main');
      fs.writeFileSync(path.join(r, 'README.md'), '# r\n', 'utf8');
      git(r, ['add', 'README.md']);
      git(r, ['commit', '-m', 'init']);
      git(r, ['checkout', '-b', 'fix/nav']);
      fs.writeFileSync(path.join(r, 'a.txt'), 'a\n', 'utf8');
      git(r, ['add', 'a.txt']);
      git(r, ['commit', '-m', 'fix nav']);
      git(r, ['checkout', 'main']);
    }

    const created = createTema(hub, {
      slug: 'ajuste-nav-condo',
      titulo: 'Ajuste Nav Condo',
      projetos: ['HortaComunitaria'],
      estado: 'em-pr',
    });
    const parsed = parseFrontmatter(fs.readFileSync(created.temaPath, 'utf8'));
    parsed.data.branch_ativa = 'fix/nav';
    fs.writeFileSync(created.temaPath, serializeFrontmatter(parsed.data, parsed.body), 'utf8');

    fs.writeFileSync(
      path.join(hub, 'config', 'projetos.local.json'),
      JSON.stringify({
        projetos: [
          { nome: 'HortaComunitaria', caminho: repoCondo, branch_principal: 'main' },
          { nome: 'BibliotecaBairro', caminho: repoFy, branch_principal: 'main' },
        ],
      }),
      'utf8'
    );

    const res = auditWorktrees(hub);
    const condo = res.projects.find((p) => p.nome === 'HortaComunitaria');
    const fy = res.projects.find((p) => p.nome === 'BibliotecaBairro');
    assert.equal(condo.unmergedBranches.find((b) => b.branch === 'fix/nav').orphan, false);
    assert.equal(fy.unmergedBranches.find((b) => b.branch === 'fix/nav').orphan, true);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('syncHub aborta quando ha conflito simultaneo em PAINEL.md e arquivo em temas/', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'po-sync-both-'));
  try {
    const { cloneA, cloneB } = setupBareAndTwoClones(base);
    const temaPathA = path.join(cloneA, 'temas', 'tema-base', 'tema-base.md');
    const temaPathB = path.join(cloneB, 'temas', 'tema-base', 'tema-base.md');

    createTema(cloneA, { slug: 'tema-aa', titulo: 'Tema AA', projetos: ['HortaComunitaria'] });
    fs.writeFileSync(temaPathA, fs.readFileSync(temaPathA, 'utf8').replace('Em aberto', 'Aberto A'), 'utf8');
    git(cloneA, ['add', '-A']);
    git(cloneA, ['commit', '-m', 'altera painel e tema-base A']);
    git(cloneA, ['push', 'origin', 'main']);

    createTema(cloneB, { slug: 'tema-ab', titulo: 'Tema AB', projetos: ['HortaComunitaria'] });
    fs.writeFileSync(temaPathB, fs.readFileSync(temaPathB, 'utf8').replace('Em aberto', 'Aberto B'), 'utf8');
    git(cloneB, ['add', '-A']);
    git(cloneB, ['commit', '-m', 'altera painel e tema-base B']);
    const headBefore = git(cloneB, ['rev-parse', 'HEAD']);

    assert.throws(() => syncHub(cloneB, { push: false }), /conflito|abortado/i);
    assert.equal(fs.existsSync(path.join(cloneB, '.git', 'rebase-merge')), false);
    assert.equal(git(cloneB, ['rev-parse', 'HEAD']), headBefore);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('syncHub recusa rodar se ja houver um rebase pausado pre-existente sem aborta-lo', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'po-sync-preexisting-'));
  try {
    const { cloneB } = setupBareAndTwoClones(base);
    const fakeRebaseDir = path.join(cloneB, '.git', 'rebase-merge');
    fs.mkdirSync(fakeRebaseDir, { recursive: true });

    assert.throws(() => syncHub(cloneB, { push: false }), /rebase em andamento/i);
    assert.equal(fs.existsSync(fakeRebaseDir), true, 'nao pode abortar/apagar rebase pre-existente');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('syncHub funciona quando hubRoot e uma subpasta dentro de um repositorio Git maior', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'po-sync-subdir-'));
  try {
    const bare = path.join(base, 'origin.git');
    fs.mkdirSync(bare, { recursive: true });
    git(bare, ['init', '--bare', '-b', 'main']);

    const cloneA = path.join(base, 'clone-a');
    initGitRepo(cloneA, 'main');
    fs.writeFileSync(path.join(cloneA, 'README.md'), '# Segundo Cerebro\n', 'utf8');
    const hubA = path.join(cloneA, 'projeto-organizado');
    makeHubSkeleton(hubA);
    createTema(hubA, { slug: 'tema-base', titulo: 'Tema Base', projetos: ['HortaComunitaria'] });
    git(cloneA, ['add', '-A']);
    git(cloneA, ['commit', '-m', 'init monorepo with hub subdir']);
    git(cloneA, ['remote', 'add', 'origin', bare]);
    git(cloneA, ['push', '-u', 'origin', 'main']);

    const cloneB = path.join(base, 'clone-b');
    git(base, ['clone', bare, cloneB]);
    git(cloneB, ['config', 'user.name', 'Clone B']);
    git(cloneB, ['config', 'user.email', 'b@example.com']);
    git(cloneB, ['config', 'commit.gpgsign', 'false']);
    const hubB = path.join(cloneB, 'projeto-organizado');

    // Clone A adiciona tema-aa e faz push
    createTema(hubA, { slug: 'tema-aa', titulo: 'Tema AA', projetos: ['HortaComunitaria'] });
    git(cloneA, ['add', '-A']);
    git(cloneA, ['commit', '-m', 'add aa']);
    git(cloneA, ['push', 'origin', 'main']);

    // Clone B adiciona tema-ab (conflito exclusivo em projeto-organizado/PAINEL.md)
    createTema(hubB, { slug: 'tema-ab', titulo: 'Tema AB', projetos: ['HortaComunitaria'] });
    const res = syncHub(hubB, { push: true, message: 'docs: add ab in subdir' });
    assert.equal(res.pulled, true);
    assert.equal(res.autoResolvedPainel, true);
    assert.equal(res.pushed, true);
    const painel = fs.readFileSync(path.join(hubB, 'PAINEL.md'), 'utf8');
    assert.match(painel, /\[\[tema-aa\]\]/);
    assert.match(painel, /\[\[tema-ab\]\]/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
