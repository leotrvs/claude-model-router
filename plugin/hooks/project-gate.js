#!/usr/bin/env node
// PreToolUse for --project mode and for the plugin. Runs from the repository's settings.json (or the
// plugin's hooks.json) and applies the per-agent blocks.
// The main session and executor-opus pass straight through.
// WARNING: this is a convenience barrier against model mistakes, not a security barrier.
// The executor has Bash and can write files without going through Edit/Write.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
// Two scripts in sequence must fit in the 10 s timeout from settings.json.
const TIMEOUT = 4000;
const PLUGIN_PREFIX = 'model-router:';

// Messages. The language comes from model-router.lang next to this file; English if missing or invalid.
// The child scripts read the same file, so their messages come out in the same language.
const MESSAGES = {
  en: {
    invalidJson: 'Blocked: the project-gate.js hook received input that is not valid JSON.',
    signal: (s) => 'signal ' + s,
    childFailed: (file, detail) => `Blocked: the ${file} check failed (${detail}). Return STATUS: BLOCKED.`,
  },
  'pt-BR': {
    invalidJson: 'Bloqueado: o hook project-gate.js recebeu uma entrada que não é JSON válido.',
    signal: (s) => 'sinal ' + s,
    childFailed: (file, detail) => `Bloqueado: a verificação ${file} falhou (${detail}). Devolva STATUS: BLOQUEADO.`,
  },
};
let lang = 'en';
try {
  const l = fs.readFileSync(path.join(__dirname, 'model-router.lang'), 'utf8').replace(/^﻿/, '').trim();
  if (l === 'en' || l === 'pt-BR') lang = l;
} catch { /* missing file: English */ }
const M = MESSAGES[lang];

let t = '';
process.stdin.on('data', (d) => (t += d)).on('end', () => {
  let agent = '';
  try { agent = JSON.parse(t).agent_type || ''; } catch {
    // Without JSON there is no way to know the agent: block instead of letting it through.
    console.error(M.invalidJson);
    process.exit(2);
  }
  // Installed as a plugin, the agents carry this plugin's prefix. Any other prefix is not ours and passes.
  const name = String(agent).startsWith(PLUGIN_PREFIX) ? String(agent).slice(PLUGIN_PREFIX.length) : agent;
  const level = { 'executor-haiku': 'haiku', 'executor-sonnet': 'sonnet' }[name];
  if (!level) process.exit(0);
  const run = (file, ...args) => {
    const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { input: t, encoding: 'utf8', timeout: TIMEOUT });
    if (r.status === 0) return;
    // Any child failure (block, error, missing script, timeout) blocks.
    if (r.status === 2) process.stderr.write(r.stderr);
    else console.error(M.childFailed(file, r.error ? r.error.code || r.error.message : r.signal ? M.signal(r.signal) : 'status ' + r.status));
    process.exit(2);
  };
  if (level === 'haiku') run('block-ui.js');
  run('block-sensitive.js', level);
  process.exit(0);
});
