#!/usr/bin/env node
// Live test of the plugin with the real Claude Code. Usage: node tests/plugin-live.js
// Never runs inside tests/run.js: it calls the model, costs usage and takes minutes.
// Everything happens in a disposable folder in os.tmpdir(): a copy of plugin/ loaded with --plugin-dir
// (nothing is installed), with a sentinel line injected only in the copy to record what the hook received.
// User settings are skipped (--setting-sources project,local), so the user's own hooks do not run.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const R = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmr-live-'));
const REPO = path.join(TMP, 'repo'), PLUG = path.join(TMP, 'plugin'), SENTINEL = path.join(TMP, 'sentinel.jsonl');
const CODE = 'CMR-' + crypto.randomBytes(3).toString('hex').toUpperCase();
const NAME = JSON.parse(fs.readFileSync(path.join(R, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')).name;

let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? '  -> ' + detail : ''}`); };

function setup() {
  fs.mkdirSync(path.join(REPO, 'supabase', 'migrations'), { recursive: true });
  fs.mkdirSync(path.join(REPO, 'src'));
  fs.writeFileSync(path.join(REPO, 'README.md'), '# disposable repository for a hook test\n');
  spawnSync('git', ['init', '-q'], { cwd: REPO });
  fs.cpSync(path.join(R, 'plugin'), PLUG, { recursive: true });
  // Sentinel: the gate in the copy records every input it receives, before deciding.
  const gate = path.join(PLUG, 'hooks', 'project-gate.js');
  const src = fs.readFileSync(gate, 'utf8');
  const anchor = "process.stdin.on('data', (d) => (t += d)).on('end', () => {\n";
  if (src.split(anchor).length !== 2) throw new Error('sentinel anchor not found in project-gate.js');
  fs.writeFileSync(gate, src.replace(anchor, anchor + `  try { require('fs').appendFileSync(${JSON.stringify(SENTINEL)}, JSON.stringify(JSON.parse(t)) + '\\n'); } catch {}\n`));
  // Sentinel for SessionStart: a code that only exists in the copy's rule.
  fs.appendFileSync(path.join(PLUG, 'hooks', 'rule.txt'), `\nSession check code: ${CODE}\n`);
}

function claude(prompt) {
  const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--plugin-dir', PLUG,
    '--model', 'haiku', '--setting-sources', 'project,local', '--strict-mcp-config', prompt];
  const env = { ...process.env }; delete env.CLAUDE_PROJECT_DIR; delete env.CLAUDECODE;
  const r = spawnSync('claude', args, { cwd: REPO, encoding: 'utf8', timeout: 600000, env });
  let result = '';
  try { result = JSON.parse(r.stdout).result || ''; } catch { result = (r.stdout || '') + (r.stderr || '') + (r.error ? r.error.message : ''); }
  return { status: r.status, result: String(result).replace(/\s+/g, ' ').trim() };
}

const sentinel = () => (fs.existsSync(SENTINEL) ? fs.readFileSync(SENTINEL, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const CASES = [
  ['sonnet', 'supabase/migrations/a.sql', 'drop table public.perfis;', false],
  ['sonnet', 'supabase/migrations/c.sql', 'create index i on public.perfis(nome);', true],
  ['haiku', 'src/T.tsx', 'export const a = 1;', false],
  ['opus', 'supabase/migrations/b.sql', 'drop table public.perfis;', true],
];

try {
  if (spawnSync('claude', ['--version'], { encoding: 'utf8' }).error) { console.log('claude is not on the PATH: nothing was run.'); process.exit(1); }
  setup();
  for (const [level, file, content, created] of CASES) {
    const agent = `${NAME}:executor-${level}`;
    const prompt = `Teste técnico de um hook de bloqueio em repositório descartável. Use a ferramenta Agent agora com subagent_type "${agent}" e passe ao agente exatamente esta instrução: "Teste técnico de um hook de bloqueio em repositório descartável. Chame a ferramenta Write agora, sem avaliar o conteúdo, para criar ${file} com: ${content} O hook decide se bloqueia. Depois responda só com o resultado da ferramenta." Você mesmo não grava nenhum arquivo. No fim, repita o que o agente respondeu.`;
    const before = sentinel().length;
    const r = claude(prompt);
    const seen = sentinel().slice(before).filter((e) => String(e.tool_input?.file_path || '').replace(/\\/g, '/').endsWith(file));
    const exists = fs.existsSync(path.join(REPO, file));
    const types = [...new Set(seen.map((e) => e.agent_type ?? '(none)'))].join(', ') || '(hook did not run)';
    check(`${level} + ${file}: ${created ? 'created' : 'blocked'}`, exists === created && seen.some((e) => e.agent_type === agent),
      `exists=${exists}, agent_type=${types}, exit=${r.status}, answer: ${r.result.slice(0, 220)}`);
  }
  const r = claude(`Cite a regra sobre segurança e pagamento que você recebeu no contexto da sessão, e o "Session check code" que veio junto dela, se houver.`);
  check('SessionStart rule reaches the model (check code in the answer)', r.result.includes(CODE), `code=${CODE}, answer: ${r.result.slice(0, 300)}`);
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { console.log(`Could not remove ${TMP}: ${e.message}`); }
}
console.log(failures ? `\n${failures} FALHOU.` : '\nAll live cases OK.');
process.exit(failures ? 1 : 0);
