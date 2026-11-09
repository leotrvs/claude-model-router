#!/usr/bin/env node
// Usage: node log.js <agent> <DONE|BLOCKED|LIMIT|REJECTED> <escalated:yes|no> <tokens|?> "summary"
//        node log.js --summary
// The Portuguese forms still work: PRONTO, BLOQUEADO, LIMITE, REPROVADO, sim, nao and --resumo.
const fs = require('fs'), os = require('os'), path = require('path');
const file = path.join(os.homedir(), '.claude', 'delegations.jsonl');
// Statuses are stored in English. Older Portuguese entries are read as their English equivalent.
const CANONICAL = new Map([['DONE', 'DONE'], ['BLOCKED', 'BLOCKED'], ['LIMIT', 'LIMIT'], ['REJECTED', 'REJECTED'],
  ['PRONTO', 'DONE'], ['BLOQUEADO', 'BLOCKED'], ['LIMITE', 'LIMIT'], ['REPROVADO', 'REJECTED']]);
const canonical = (s) => { const u = String(s ?? '').toUpperCase(); return CANONICAL.get(u) ?? u; };
const a = process.argv.slice(2);
if (a[0] === '--summary' || a[0] === '--resumo') {
  // A corrupted line is ignored, as in the log-delegation.js hook.
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } }).filter((l) => l && typeof l === 'object') : [];
  const t = {};
  for (const l of lines) {
    const r = (t[l.agente] ||= { tasks: 0, done: 0, rejected: 0, escalated: 0, tokens: 0, withTokens: 0 });
    const status = canonical(l.status);
    if (status === 'REJECTED') { r.rejected++; continue; }
    r.tasks++;
    if (status === 'DONE') r.done++;
    if (l.subiu) r.escalated++;
    if (Number.isFinite(l.tokens)) { r.tokens += l.tokens; r.withTokens++; }
  }
  for (const r of Object.values(t)) { r.avgTokens = r.withTokens ? Math.round(r.tokens / r.withTokens) : null; delete r.tokens; delete r.withTokens; }
  console.table(t);
  process.exit(0);
}
const USAGE = 'Usage: node log.js <agent> <DONE|BLOCKED|LIMIT|REJECTED> <yes|no> <tokens|?> "summary"\n       node log.js --summary';
if (a.length < 5) { console.error(USAGE); process.exit(1); }
const [agent, statusArg, escalated, tokens, ...rest] = a;
const status = canonical(statusArg);
if (!['DONE', 'BLOCKED', 'LIMIT', 'REJECTED'].includes(status)) { console.error(`Unknown status: ${statusArg}\n${USAGE}`); process.exit(1); }
const n = Number(tokens);
fs.appendFileSync(file, JSON.stringify({
  data: new Date().toISOString().slice(0, 10),
  projeto: path.basename(process.cwd()),
  agente: agent, status, subiu: /^(yes|sim)$/i.test(escalated),
  tokens: Number.isFinite(n) ? n : null,
  resumo: rest.join(' ')
}) + '\n');
console.log('logged');
