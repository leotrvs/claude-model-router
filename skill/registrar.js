#!/usr/bin/env node
// Uso: node registrar.js <agente> <PRONTO|BLOQUEADO|LIMITE> <subiu:sim|nao> <tokens|?> "resumo"
//      node registrar.js --resumo
const fs = require('fs'), os = require('os'), path = require('path');
const arq = path.join(os.homedir(), '.claude', 'delegacoes.jsonl');
const a = process.argv.slice(2);
if (a[0] === '--resumo') {
  // Linha corrompida é ignorada, como no hook registrar-delegacao.js.
  const linhas = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8').split('\n').flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } }).filter((l) => l && typeof l === 'object') : [];
  const t = {};
  for (const l of linhas) {
    const r = (t[l.agente] ||= { tarefas: 0, pronto: 0, reprovado: 0, subiu: 0, tokens: 0, comTokens: 0 });
    if (l.status === 'REPROVADO') { r.reprovado++; continue; }
    r.tarefas++;
    if (l.status === 'PRONTO') r.pronto++;
    if (l.subiu) r.subiu++;
    if (Number.isFinite(l.tokens)) { r.tokens += l.tokens; r.comTokens++; }
  }
  for (const r of Object.values(t)) { r.mediaTokens = r.comTokens ? Math.round(r.tokens / r.comTokens) : null; delete r.tokens; delete r.comTokens; }
  console.table(t);
  process.exit(0);
}
if (a.length < 5) { console.error('Uso: node registrar.js <agente> <status> <sim|nao> <tokens|?> "resumo"'); process.exit(1); }
const [agente, status, subiu, tokens, ...resto] = a;
const n = Number(tokens);
fs.appendFileSync(arq, JSON.stringify({
  data: new Date().toISOString().slice(0, 10),
  projeto: path.basename(process.cwd()),
  agente, status, subiu: subiu === 'sim',
  tokens: Number.isFinite(n) ? n : null,
  resumo: resto.join(' ')
}) + '\n');
console.log('registrado');
