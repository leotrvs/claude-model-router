#!/usr/bin/env node
// PreToolUse for executor-haiku: prevents writing UI files.
// WARNING: this is a convenience barrier against model mistakes, not a security barrier.
// The executor has Bash and can write files without going through Edit/Write.
const fs = require('fs'), path = require('path');

// Messages. The language comes from model-router.lang next to this file; English if missing or invalid.
const MESSAGES = {
  en: {
    invalidJson: 'Blocked: the block-ui.js hook received input that is not valid JSON. Return STATUS: BLOCKED.',
    ui: (target) => `Blocked: executor-haiku does not change the UI (${target}). Return STATUS: BLOCKED to escalate to executor-sonnet.`,
  },
  'pt-BR': {
    invalidJson: 'Bloqueado: o hook block-ui.js recebeu uma entrada que não é JSON válido. Devolva STATUS: BLOQUEADO.',
    ui: (target) => `Bloqueado: executor-haiku não altera interface (${target}). Devolva STATUS: BLOQUEADO para subir ao executor-sonnet.`,
  },
};
let lang = 'en';
try {
  const l = fs.readFileSync(path.join(__dirname, 'model-router.lang'), 'utf8').replace(/^﻿/, '').trim();
  if (l === 'en' || l === 'pt-BR') lang = l;
} catch { /* missing file: English */ }
const M = MESSAGES[lang];

// Same normalization as block-sensitive.js: slashes, NTFS streams (x::$DATA), trailing dots and spaces, `..` and uppercase.
function normalize(p) {
  const s = String(p).replace(/\\/g, '/').toLowerCase();
  const rest = s.split('/').map((x, k) => (x === '.' || x === '..' || (k === 0 && /^[a-z]:$/.test(x)) ? x : x.replace(/:.*$/s, '').replace(/[. ]+$/, ''))).join('/');
  return path.posix.normalize(rest || '.');
}

let t = '';
process.stdin.on('data', (d) => (t += d)).on('end', () => {
  // Input that is not JSON means the hook failed: block instead of letting it through.
  let i;
  try { i = JSON.parse(t).tool_input || {}; } catch {
    console.error(M.invalidJson);
    process.exit(2);
  }
  const target = String(i.file_path || i.path || i.notebook_path || '');
  if (/\.(tsx|jsx|vue|svelte|astro|html|css|scss|sass|less)$/.test(normalize(target))) {
    console.error(M.ui(target));
    process.exit(2);
  }
  process.exit(0);
});
