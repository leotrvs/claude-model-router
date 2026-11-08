#!/usr/bin/env node
// SubagentStop: registra automaticamente cada execução dos executores em ~/.claude/delegacoes.jsonl.
// AVISO: os hooks desta skill são uma barreira de conveniência contra erro do modelo, não de segurança.
const fs = require('fs'), os = require('os'), path = require('path');
const ARQ = path.join(os.homedir(), '.claude', 'delegacoes.jsonl');
// O briefing não é gravado: só o começo da primeira linha, com padrões de segredo mascarados.
const mascara = (s) => s
  .replace(/\b(?:sk|pk|rk)-[\w-]{8,}/g, '***')
  .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_\w{8,}/g, '***')
  .replace(/\beyJ[\w-]+(?:\.[\w-]+)*/g, '***')
  .replace(/[A-Za-z0-9_-]{20,}/g, '***');
let t = '';
process.stdin.on('data', (d) => (t += d)).on('end', () => {
  try {
    const e = JSON.parse(t);
    const agente = e.agent_type || '';
    if (!agente.startsWith('executor-')) return;
    let tokens = null, relatorio = '', briefing = '';
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
        if (m.role === 'assistant' && txt) relatorio = txt;
        if (m.role === 'user' && txt && !briefing) briefing = txt;
      }
    }
    const s = /STATUS:\**\s*\**(PRONTO|BLOQUEADO)/i.exec(relatorio);
    const status = s ? s[1].toUpperCase() : 'LIMITE';
    // Linha corrompida é ignorada, para o registro não parar de vez.
    const bruto = fs.existsSync(ARQ) ? fs.readFileSync(ARQ, 'utf8') : '';
    const anteriores = bruto.split('\n').flatMap((l) => {
      try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; }
    });
    const subiu = anteriores.some((a) => a && a.sessao === e.session_id && a.status !== 'PRONTO');
    // Se a última linha ficou pela metade, o novo registro começa numa linha nova.
    fs.appendFileSync(ARQ, (bruto && !bruto.endsWith('\n') ? '\n' : '') + JSON.stringify({
      data: new Date().toISOString().slice(0, 10),
      projeto: path.basename(e.cwd || process.cwd()),
      sessao: e.session_id, agente, status, subiu, tokens,
      resumo: mascara(briefing.split('\n')[0]).slice(0, 60)
    }) + '\n');
  } catch { /* registro nunca deve atrapalhar o trabalho */ }
});
