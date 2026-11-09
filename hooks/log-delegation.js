#!/usr/bin/env node
// SubagentStop: automatically logs each executor run to ~/.claude/delegations.jsonl.
// WARNING: the hooks of this skill are a convenience barrier against model mistakes, not a security barrier.
const fs = require('fs'), os = require('os'), path = require('path');
const FILE = path.join(os.homedir(), '.claude', 'delegations.jsonl');
// Statuses are stored in English. Older Portuguese entries are read as their English equivalent.
const CANONICAL = new Map([['DONE', 'DONE'], ['BLOCKED', 'BLOCKED'], ['LIMIT', 'LIMIT'], ['REJECTED', 'REJECTED'],
  ['PRONTO', 'DONE'], ['BLOQUEADO', 'BLOCKED'], ['LIMITE', 'LIMIT'], ['REPROVADO', 'REJECTED']]);
const canonical = (s) => { const u = String(s ?? '').toUpperCase(); return CANONICAL.get(u) ?? u; };
// The brief is not stored: only the start of its first line, with secret patterns masked.
const mask = (s) => s
  .replace(/\b(?:sk|pk|rk)-[\w-]{8,}/g, '***')
  .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_\w{8,}/g, '***')
  .replace(/\beyJ[\w-]+(?:\.[\w-]+)*/g, '***')
  .replace(/[A-Za-z0-9_-]{20,}/g, '***');
let t = '';
process.stdin.on('data', (d) => (t += d)).on('end', () => {
  try {
    const e = JSON.parse(t);
    const agent = e.agent_type || '';
    if (!agent.startsWith('executor-')) return;
    let tokens = null, report = '', brief = '';
    const tr = e.agent_transcript_path;
    if (tr && fs.existsSync(tr)) {
      for (const l of fs.readFileSync(tr, 'utf8').split('\n')) {
        if (!l) continue;
        let j; try { j = JSON.parse(l); } catch { continue; }
        const m = j && j.message; if (!m) continue;
        const u = m.usage;
        if (u) tokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
        const txt = typeof m.content === 'string' ? m.content
          : Array.isArray(m.content) ? m.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : '';
        if (m.role === 'assistant' && txt) report = txt;
        if (m.role === 'user' && txt && !brief) brief = txt;
      }
    }
    // The agent reports in English or Portuguese; no STATUS means it hit the turn limit.
    const s = /STATUS:\**\s*\**(PRONTO|BLOQUEADO|DONE|BLOCKED)/i.exec(report);
    const status = s ? canonical(s[1]) : 'LIMIT';
    // A corrupted line is ignored, so logging does not stop for good.
    const raw = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
    const previous = raw.split('\n').flatMap((l) => {
      try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; }
    });
    const escalated = previous.some((a) => a && a.sessao === e.session_id && canonical(a.status) !== 'DONE');
    // If the last line was cut in half, the new entry starts on a new line.
    // The field names are the same as in older logs, so old and new entries can be read together.
    fs.appendFileSync(FILE, (raw && !raw.endsWith('\n') ? '\n' : '') + JSON.stringify({
      data: new Date().toISOString().slice(0, 10),
      projeto: path.basename(e.cwd || process.cwd()),
      sessao: e.session_id, agente: agent, status, subiu: escalated, tokens,
      resumo: mask(brief.split('\n')[0]).slice(0, 60)
    }) + '\n');
  } catch { /* logging must never get in the way of the work */ }
});
