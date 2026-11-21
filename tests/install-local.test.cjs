'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { installLocal } = require('../cli/install-local.cjs');

const HUB_ROOT = path.resolve(__dirname, '..');
const SKILL_SRC = path.join(HUB_ROOT, 'regras', 'skills', 'fluxo-organizado', 'SKILL.md');

test('regras/skills/fluxo-organizado/SKILL.md nao contem caminhos hardcoded de maquina', () => {
  assert.ok(fs.existsSync(SKILL_SRC), 'SKILL.md precisa existir');
  const content = fs.readFileSync(SKILL_SRC, 'utf8');
  assert.doesNotMatch(content, /C:\\Users\\/i);
  assert.doesNotMatch(content, /\/home\/usuario\//i);
  assert.match(content, /name:\s*fluxo-organizado/);
  assert.match(content, /modo direto/i);
  assert.match(content, /tema sync --push/);
});

test('installLocal --check (checkOnly: true) nao cria nem altera nenhum arquivo em homeDir', () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'po-inst-check-'));
  try {
    fs.mkdirSync(path.join(fakeHome, '.agents', 'skills'), { recursive: true });
    const res = installLocal({
      hubRoot: HUB_ROOT,
      homeDir: fakeHome,
      platform: 'win32',
      checkOnly: true,
    });
    assert.equal(res.upToDate, false);
    assert.ok(res.changes.length >= 3);
    assert.equal(fs.existsSync(path.join(fakeHome, '.projeto-organizado.json')), false);
    assert.equal(fs.existsSync(path.join(fakeHome, '.local', 'bin', 'tema.cmd')), false);
    assert.equal(
      fs.existsSync(path.join(fakeHome, '.agents', 'skills', 'fluxo-organizado', 'SKILL.md')),
      false
    );
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('installLocal em win32 cria ponteiro, shim .cmd, instala skills e e 100% idempotente', () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'po-inst-win-'));
  try {
    const skillDirs = [
      path.join(fakeHome, '.agents', 'skills'),
      path.join(fakeHome, '.codex', 'skills'),
      path.join(fakeHome, '.claude', 'skills'),
      path.join(fakeHome, '.gemini', 'skills'),
      path.join(fakeHome, '.t3', 'userdata', 'providers', 'antigravity', 'abc123hash', 'config', 'skills'),
    ];
    for (const dir of skillDirs) fs.mkdirSync(dir, { recursive: true });

    const first = installLocal({
      hubRoot: HUB_ROOT,
      homeDir: fakeHome,
      platform: 'win32',
      checkOnly: false,
    });
    assert.equal(first.upToDate, false);
    assert.equal(first.installedSkills.length, 5);

    const pointer = JSON.parse(fs.readFileSync(first.pointerPath, 'utf8'));
    assert.equal(pointer.hubPath, path.resolve(HUB_ROOT));

    assert.ok(first.shimPath.endsWith('tema.cmd'));
    const shimText = fs.readFileSync(first.shimPath, 'utf8');
    assert.match(shimText, /cli\\tema\.cjs/);

    const expectedSkill = fs.readFileSync(SKILL_SRC, 'utf8');
    for (const installed of first.installedSkills) {
      assert.equal(fs.readFileSync(installed, 'utf8'), expectedSkill);
    }

    // Reexecução em checkOnly e em modo normal deve ser 100% idempotente
    const checkAfter = installLocal({
      hubRoot: HUB_ROOT,
      homeDir: fakeHome,
      platform: 'win32',
      checkOnly: true,
    });
    assert.equal(checkAfter.upToDate, true);
    assert.deepEqual(checkAfter.changes, []);

    const second = installLocal({
      hubRoot: HUB_ROOT,
      homeDir: fakeHome,
      platform: 'win32',
      checkOnly: false,
    });
    assert.equal(second.upToDate, true);
    assert.deepEqual(second.changes, []);
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('installLocal em linux gera shim POSIX executavel e suporta reexecucao idempotente', () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'po-inst-linux-'));
  try {
    fs.mkdirSync(path.join(fakeHome, '.agents', 'skills'), { recursive: true });
    const res = installLocal({
      hubRoot: HUB_ROOT,
      homeDir: fakeHome,
      platform: 'linux',
      checkOnly: false,
    });
    assert.ok(res.shimPath.endsWith(`${path.sep}tema`));
    const shimText = fs.readFileSync(res.shimPath, 'utf8');
    assert.match(shimText, /^#!\/usr\/bin\/env sh\n/);
    assert.match(shimText, /NODE_BIN=/);
    assert.match(shimText, /exec "\$NODE_BIN" /);
    assert.match(shimText, /cli\/tema\.cjs/);
    if (process.platform !== 'win32') {
      const mode = fs.statSync(res.shimPath).mode & 0o777;
      assert.ok((mode & 0o111) !== 0, 'shim POSIX deve ter bit executavel');
    }

    const checkAfter = installLocal({
      hubRoot: HUB_ROOT,
      homeDir: fakeHome,
      platform: 'linux',
      checkOnly: true,
    });
    assert.equal(checkAfter.upToDate, true);
    assert.deepEqual(checkAfter.changes, []);
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('install-local.cjs CLI trata --help (exit 0) e rejeita flag desconhecida (exit 1) sem gravar nada', () => {
  const { execFileSync } = require('node:child_process');
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'po-inst-cli-'));
  const scriptPath = path.join(HUB_ROOT, 'cli', 'install-local.cjs');
  try {
    const helpOut = execFileSync(process.execPath, [scriptPath, '--help'], {
      encoding: 'utf8',
      env: { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(helpOut, /--check/);
    assert.equal(fs.existsSync(path.join(fakeHome, '.projeto-organizado.json')), false);

    assert.throws(
      () =>
        execFileSync(process.execPath, [scriptPath, '--chek'], {
          encoding: 'utf8',
          env: { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome },
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      (err) => err.status === 1 && /desconhecida|inválida/i.test(String(err.stderr))
    );
    assert.equal(fs.existsSync(path.join(fakeHome, '.projeto-organizado.json')), false);
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});
