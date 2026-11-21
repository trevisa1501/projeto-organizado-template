'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI_PATH = path.resolve(__dirname, '../cli/tema.cjs');

function runCli(args, hubRoot) {
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PROJETO_ORGANIZADO_HOME: hubRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function makeTempHub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-e2e-'));
  fs.mkdirSync(path.join(dir, 'projetos'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'temas'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projetos', 'HortaComunitaria.md'), '# HortaComunitaria\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'projetos', 'BibliotecaBairro.md'), '# BibliotecaBairro\n', 'utf8');
  return dir;
}

test('tema --help retorna exit 0 e lista todos os 6 subcomandos', () => {
  const hub = makeTempHub();
  try {
    const out = runCli(['--help'], hub);
    for (const cmd of ['painel', 'buscar', 'novo', 'nova-versao', 'worktrees', 'sync']) {
      assert.match(out, new RegExp(`\\b${cmd}\\b`), `esperava encontrar comando "${cmd}" no --help`);
    }
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
  }
});

test('fluxo E2E completo: novo -> buscar -> nova-versao -> painel -> worktrees', () => {
  const hub = makeTempHub();
  try {
    const outNovo = runCli(
      [
        'novo',
        'portal-sindico',
        '--titulo',
        'Portal do Síndico',
        '--projeto',
        'HortaComunitaria',
        '--estado',
        'ideia',
      ],
      hub
    );
    assert.match(outNovo, /portal-sindico/);
    assert.ok(fs.existsSync(path.join(hub, 'temas', 'portal-sindico', 'portal-sindico.md')));

    const outBuscar = runCli(['buscar', 'sindico'], hub);
    assert.match(outBuscar, /portal-sindico/);
    assert.match(outBuscar, /Portal do Síndico/);

    const outNv = runCli(['nova-versao', 'portal-sindico', '--resumo', 'Fase 2 relatórios'], hub);
    assert.match(outNv, /v2/);
    assert.ok(fs.existsSync(path.join(hub, 'temas', 'portal-sindico', 'versoes', 'v2.md')));

    const outPainel = runCli(['painel'], hub);
    assert.match(outPainel, /PAINEL\.md/);
    assert.match(fs.readFileSync(path.join(hub, 'PAINEL.md'), 'utf8'), /\[\[portal-sindico\]\]/);

    // worktrees sem config local retorna aviso limpo com exit 0
    const outWt = runCli(['worktrees'], hub);
    assert.match(outWt, /WORKTREES\.local\.md|projetos\.local\.json/i);
    assert.ok(fs.existsSync(path.join(hub, 'WORKTREES.local.md')));
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
  }
});

test('comando desconhecido e flags obrigatorias ausentes retornam exit code 1 com mensagem em stderr', () => {
  const hub = makeTempHub();
  try {
    assert.throws(
      () => runCli(['nao-existe'], hub),
      (err) => err.status === 1 && /comando desconhecido|inválido/i.test(String(err.stderr))
    );

    assert.throws(
      () => runCli(['novo', 'sem-flags'], hub),
      (err) => err.status === 1 && /--titulo/i.test(String(err.stderr))
    );

    assert.throws(
      () => runCli(['buscar'], hub),
      (err) => err.status === 1 && /termo/i.test(String(err.stderr))
    );
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
  }
});
