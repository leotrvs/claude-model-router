#!/usr/bin/env node
// PreToolUse do modo --projeto. Roda pelo settings.json do repositório e aplica os bloqueios por agente.
// A sessão principal e o executor-opus passam direto.
// AVISO: é uma barreira de conveniência contra erro do modelo, não uma barreira de segurança.
// O executor tem Bash e pode gravar arquivos sem passar por Edit/Write.
const path = require('path'), { spawnSync } = require('child_process');
// Dois scripts em sequência precisam caber no timeout de 10 s do settings.json.
const TIMEOUT = 4000;
let t = '';
process.stdin.on('data', (d) => (t += d)).on('end', () => {
  let agente = '';
  try { agente = JSON.parse(t).agent_type || ''; } catch {
    // Sem JSON não dá para saber o agente: bloqueia em vez de deixar passar.
    console.error('Bloqueado: o hook portao-projeto.js recebeu uma entrada que não é JSON válido.');
    process.exit(2);
  }
  const nivel = { 'executor-haiku': 'haiku', 'executor-sonnet': 'sonnet' }[agente];
  if (!nivel) process.exit(0);
  const roda = (arq, ...args) => {
    const r = spawnSync(process.execPath, [path.join(__dirname, arq), ...args], { input: t, encoding: 'utf8', timeout: TIMEOUT });
    if (r.status === 0) return;
    // Qualquer falha do filho (bloqueio, erro, script ausente, timeout) bloqueia.
    if (r.status === 2) process.stderr.write(r.stderr);
    else console.error(`Bloqueado: a verificação ${arq} falhou (${r.error ? r.error.code || r.error.message : r.signal ? 'sinal ' + r.signal : 'status ' + r.status}). Devolva STATUS: BLOQUEADO.`);
    process.exit(2);
  };
  if (nivel === 'haiku') roda('bloquear-interface.js');
  roda('bloquear-sensivel.js', nivel);
  process.exit(0);
});
