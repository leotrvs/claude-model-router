#!/usr/bin/env node
// PreToolUse do executor-haiku: impede gravar arquivos de interface.
// AVISO: é uma barreira de conveniência contra erro do modelo, não uma barreira de segurança.
// O executor tem Bash e pode gravar arquivos sem passar por Edit/Write.
const path = require('path');

// Mesma normalização do bloquear-sensivel.js: barras, fluxo NTFS (x::$DATA), pontos e espaços finais, `..` e maiúsculas.
function normaliza(p) {
  const s = String(p).replace(/\\/g, '/').toLowerCase();
  const resto = s.split('/').map((x, k) => (x === '.' || x === '..' || (k === 0 && /^[a-z]:$/.test(x)) ? x : x.replace(/:.*$/s, '').replace(/[. ]+$/, ''))).join('/');
  return path.posix.normalize(resto || '.');
}

let t = '';
process.stdin.on('data', (d) => (t += d)).on('end', () => {
  // Entrada que não é JSON indica falha do hook: bloqueia em vez de deixar passar.
  let i;
  try { i = JSON.parse(t).tool_input || {}; } catch {
    console.error('Bloqueado: o hook bloquear-interface.js recebeu uma entrada que não é JSON válido. Devolva STATUS: BLOQUEADO.');
    process.exit(2);
  }
  const alvo = String(i.file_path || i.path || i.notebook_path || '');
  if (/\.(tsx|jsx|vue|svelte|astro|html|css|scss|sass|less)$/.test(normaliza(alvo))) {
    console.error(`Bloqueado: executor-haiku não altera interface (${alvo}). Devolva STATUS: BLOQUEADO para subir ao executor-sonnet.`);
    process.exit(2);
  }
  process.exit(0);
});
