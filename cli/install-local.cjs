#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function detectSkillRoots(homeDir) {
  const candidates = [
    path.join(homeDir, '.agents', 'skills'),
    path.join(homeDir, '.codex', 'skills'),
    path.join(homeDir, '.claude', 'skills'),
    path.join(homeDir, '.gemini', 'skills'),
  ];

  const antigravityBase = path.join(homeDir, '.t3', 'userdata', 'providers', 'antigravity');
  if (fs.existsSync(antigravityBase)) {
    for (const entry of fs.readdirSync(antigravityBase, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillsDir = path.join(antigravityBase, entry.name, 'config', 'skills');
      if (fs.existsSync(skillsDir)) {
        candidates.push(skillsDir);
      }
    }
  }

  return candidates.filter((dir) => fs.existsSync(dir));
}

function buildShimSpec(hubRoot, homeDir, platform) {
  const binDir = path.join(homeDir, '.local', 'bin');
  if (platform === 'win32') {
    const targetCli = path.win32.join(hubRoot, 'cli', 'tema.cjs');
    return {
      shimPath: path.join(binDir, 'tema.cmd'),
      content: `@echo off\r\nnode "${targetCli}" %*\r\n`,
      executable: false,
    };
  }
  const targetCliPosix = `${hubRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/cli/tema.cjs`;
  const escaped = targetCliPosix.replace(/'/g, "'\\''");
  return {
    shimPath: path.join(binDir, 'tema'),
    content: `#!/usr/bin/env sh\nNODE_BIN="$(command -v node 2>/dev/null || printf '%s' "$HOME/.local/bin/node")"\nexec "$NODE_BIN" '${escaped}' "$@"\n`,
    executable: true,
  };
}

function syncFile(filePath, desiredContent, { checkOnly, executable = false }) {
  const exists = fs.existsSync(filePath);
  const current = exists ? fs.readFileSync(filePath, 'utf8') : null;
  let needsModeFix = false;
  if (exists && executable && process.platform !== 'win32') {
    const mode = fs.statSync(filePath).mode & 0o777;
    if ((mode & 0o100) === 0) needsModeFix = true;
  }

  if (current === desiredContent && !needsModeFix) {
    return false;
  }

  if (!checkOnly) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, desiredContent, 'utf8');
    if (executable && process.platform !== 'win32') {
      fs.chmodSync(filePath, 0o755);
    }
  }
  return true;
}

function installLocal({
  hubRoot = path.resolve(__dirname, '..'),
  homeDir = os.homedir(),
  platform = process.platform,
  checkOnly = false,
} = {}) {
  const resolvedHub = path.resolve(hubRoot);
  const resolvedHome = path.resolve(homeDir);
  const skillSrcPath = path.join(resolvedHub, 'regras', 'skills', 'fluxo-organizado', 'SKILL.md');

  if (!fs.existsSync(skillSrcPath)) {
    throw new Error(`Skill canônica não encontrada em ${skillSrcPath}.`);
  }
  const skillContent = fs.readFileSync(skillSrcPath, 'utf8');

  const changes = [];

  // 1. Ponteiro ~/.projeto-organizado.json
  const pointerPath = path.join(resolvedHome, '.projeto-organizado.json');
  const pointerContent = `${JSON.stringify({ hubPath: resolvedHub }, null, 2)}\n`;
  if (syncFile(pointerPath, pointerContent, { checkOnly })) {
    changes.push(`pointer:${pointerPath}`);
  }

  // 2. Shim em ~/.local/bin
  const shimSpec = buildShimSpec(resolvedHub, resolvedHome, platform);
  if (syncFile(shimSpec.shimPath, shimSpec.content, { checkOnly, executable: shimSpec.executable })) {
    changes.push(`shim:${shimSpec.shimPath}`);
  }

  // 3. Skills nos diretórios locais detectados
  const skillRoots = detectSkillRoots(resolvedHome);
  const installedSkills = [];
  for (const rootDir of skillRoots) {
    const destSkillPath = path.join(rootDir, 'fluxo-organizado', 'SKILL.md');
    installedSkills.push(destSkillPath);
    if (syncFile(destSkillPath, skillContent, { checkOnly })) {
      changes.push(`skill:${destSkillPath}`);
    }
  }

  return {
    pointerPath,
    shimPath: shimSpec.shimPath,
    installedSkills,
    changes,
    upToDate: changes.length === 0,
  };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('-h') || args.includes('--help')) {
      process.stdout.write(
        'Uso: node cli/install-local.cjs [--check]\n\n' +
          'Opções:\n' +
          '  --check    Apenas verifica se ponteiro, shim e skills estão atualizados (não grava nada)\n' +
          '  -h, --help Exibe esta ajuda\n'
      );
      process.exit(0);
    }
    const unknown = args.filter((a) => a !== '--check');
    if (unknown.length > 0) {
      throw new Error(`Opção desconhecida: ${unknown.join(', ')}. Use --check ou --help.`);
    }
    const checkOnly = args.includes('--check');
    const result = installLocal({ checkOnly });

    if (checkOnly) {
      if (result.upToDate) {
        console.log('Instalação local verificada: tudo atualizado (upToDate).');
        process.exit(0);
      } else {
        console.log('Instalação local desatualizada. Itens pendentes:');
        for (const ch of result.changes) console.log(`  - ${ch}`);
        process.exit(1);
      }
    } else {
      console.log(`Ponteiro: ${result.pointerPath}`);
      console.log(`Shim CLI: ${result.shimPath}`);
      console.log(`Skills sincronizadas (${result.installedSkills.length}):`);
      for (const s of result.installedSkills) console.log(`  - ${s}`);
      if (result.upToDate) {
        console.log('Nenhuma alteração necessária (já estava atualizado).');
      } else {
        console.log(`Alterações aplicadas: ${result.changes.length}`);
      }
      process.exit(0);
    }
  } catch (err) {
    process.stderr.write(`Erro: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

module.exports = {
  installLocal,
  detectSkillRoots,
};
