#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { syncHub } = require('./lib/git-ops.cjs');
const { resolveHubRoot } = require('./lib/hub.cjs');

function parseArgs(argv) {
  let pushAfterIdleSec = null;
  let hubArg = null;
  let label = os.hostname();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--push-after-idle' && argv[i + 1]) {
      pushAfterIdleSec = Number(argv[i + 1]);
      i += 1;
    } else if (a === '--hub' && argv[i + 1]) {
      hubArg = argv[i + 1];
      i += 1;
    } else if (a === '--label' && argv[i + 1]) {
      label = argv[i + 1];
      i += 1;
    }
  }
  return { pushAfterIdleSec, hubArg, label };
}

function getGitPath(hubRoot, name) {
  const out = execFileSync('git', ['rev-parse', '--git-path', name], {
    cwd: hubRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  return path.resolve(hubRoot, out);
}

function appendLog(logPath, line) {
  try {
    const stamp = new Date().toISOString();
    const existing = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean)
      : [];
    existing.push(`[${stamp}] ${line}`);
    const trimmed = existing.slice(-50).join('\n') + '\n';
    fs.writeFileSync(logPath, trimmed, 'utf8');
  } catch (_) {
    // ignore log failures
  }
}

function acquireLock(lockPath) {
  const STALE_MS = 10 * 60 * 1000;
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, String(process.pid), 'utf8');
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > STALE_MS) {
          fs.unlinkSync(lockPath);
          const fd = fs.openSync(lockPath, 'wx');
          fs.writeFileSync(fd, String(process.pid), 'utf8');
          fs.closeSync(fd);
          return true;
        }
      } catch (_) {
        return false;
      }
      return false;
    }
    return false;
  }
}

function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (_) {
    // ignore
  }
}

function newestDirtyMtimeMs(hubRoot, statusLines) {
  let newest = 0;
  for (const line of statusLines) {
    // porcelain format: XY path (or XY old -> new)
    let rel = line.slice(3).trim();
    if (rel.includes(' -> ')) rel = rel.split(' -> ').pop().trim();
    if (rel.startsWith('"') && rel.endsWith('"')) rel = rel.slice(1, -1);
    const full = path.resolve(hubRoot, rel);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else {
              const s = fs.statSync(p);
              if (s.mtimeMs > newest) newest = s.mtimeMs;
            }
          }
        };
        walk(full);
      } else if (st.mtimeMs > newest) {
        newest = st.mtimeMs;
      }
    } catch (_) {
      // deleted file: treat as recently changed conservatively
      const now = Date.now();
      if (now > newest) newest = now;
    }
  }
  return newest;
}

function main() {
  const { pushAfterIdleSec, hubArg, label } = parseArgs(process.argv.slice(2));
  const hubRoot = hubArg ? path.resolve(hubArg) : resolveHubRoot();

  const lockPath = getGitPath(hubRoot, 'tema-autosync.lock');
  const logPath = getGitPath(hubRoot, 'tema-autosync.log');

  if (!acquireLock(lockPath)) {
    return;
  }

  try {
    const statusRaw = execFileSync('git', ['status', '--porcelain', '--', '.'], {
      cwd: hubRoot,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();

    if (statusRaw === '') {
      // Clean tree: check if local commits ahead of origin exist too
      let ahead = 0;
      try {
        ahead = Number(execFileSync('git', ['rev-list', '--count', '@{u}..HEAD'], {
          cwd: hubRoot,
          encoding: 'utf8',
          windowsHide: true,
        }).trim()) || 0;
      } catch (_) {
        ahead = 0;
      }
      const shouldPush = ahead > 0 && pushAfterIdleSec !== null;
      const res = syncHub(hubRoot, { push: shouldPush });
      appendLog(logPath, `ok (clean): ${res.summary}`);
      return;
    }

    if (pushAfterIdleSec === null || Number.isNaN(pushAfterIdleSec)) {
      appendLog(logPath, 'skip: dirty working tree (pull-only mode)');
      return;
    }

    const lines = statusRaw.split(/\r?\n/).filter(Boolean);
    const newest = newestDirtyMtimeMs(hubRoot, lines);
    const idleSec = (Date.now() - newest) / 1000;

    if (idleSec < pushAfterIdleSec) {
      appendLog(logPath, `skip: dirty tree edited ${Math.round(idleSec)}s ago (< ${pushAfterIdleSec}s)`);
      return;
    }

    const res = syncHub(hubRoot, {
      push: true,
      message: `docs: auto-sync (${label})`,
    });
    appendLog(logPath, `ok (auto-push): ${res.summary}`);
  } catch (err) {
    appendLog(logPath, `error: ${err && err.message ? err.message : String(err)}`);
  } finally {
    releaseLock(lockPath);
  }
}

main();
