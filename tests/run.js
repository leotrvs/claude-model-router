#!/usr/bin/env node
// Tests for the hooks, log.js and the installer. Usage: node tests/rodar.js
// Plain Node, no network and no dependencies. Everything runs in a temporary folder: HOME and USERPROFILE
// point to it in the child processes, so the real ~/.claude is never touched.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const R = path.resolve(__dirname, '..');
const HOOKS = path.join(R, 'hooks');
const LOCALES = path.join(R, 'locales');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmr-tests-'));
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(PROJ);

let total = 0, failures = 0;
const check = (name, ok, detail = '') => {
  total++; if (!ok) failures++;
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${ok || !detail ? '' : '  -> ' + String(detail).trim().slice(0, 300)}`);
};
const envFor = (home) => {
  const e = { ...process.env, HOME: home, USERPROFILE: home };
  delete e.CLAUDE_PROJECT_DIR;
  return e;
};
const newHome = (name) => { const h = path.join(TMP, name); fs.mkdirSync(h, { recursive: true }); return h; };

// Before any child process, confirm that os.homedir() follows HOME/USERPROFILE: the log hook,
// log.js and the global installer all write to ~/.claude.
const probe = newHome('home-probe');
const hd = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("os").homedir())'], { encoding: 'utf8', env: envFor(probe) }).stdout;
check('os.homedir() follows HOME/USERPROFILE in the child process', path.resolve(hd) === path.resolve(probe), hd);
if (path.resolve(hd) !== path.resolve(probe)) {
  console.log('\nAborted: the tests would write to the real ~/.claude.');
  process.exit(1);
}

const HOME_HOOKS = path.join(TMP, 'home-hooks');
fs.mkdirSync(path.join(HOME_HOOKS, '.claude'), { recursive: true });

function hook(file, args, input, dir = HOOKS, extraEnv = {}) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  const start = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, file), ...args], { input: text, encoding: 'utf8', env: { ...envFor(HOME_HOOKS), ...extraEnv }, cwd: PROJ, timeout: 30000 });
  return { status: r.status, err: (r.stderr || '') + (r.error ? r.error.message : ''), out: r.stdout || '', ms: Date.now() - start };
}
const expect = (name, r, code, part) =>
  check(name, r.status === code && (!part || r.err.includes(part)), `status ${r.status}: ${r.err}`);
const write = (file_path, extra = {}, cwd = PROJ) => ({ tool_name: 'Write', cwd, tool_input: { file_path, content: '', ...extra } });
const copyHooks = (name, lang) => {
  const d = path.join(TMP, name); fs.mkdirSync(d);
  for (const f of fs.readdirSync(HOOKS)) fs.copyFileSync(path.join(HOOKS, f), path.join(d, f));
  if (lang !== null) fs.writeFileSync(path.join(d, 'model-router.lang'), lang);
  return d;
};

// The hook cases run in both languages and must reach the same decision in each one.
// English is the repository folder itself (no model-router.lang); Portuguese is a copy with model-router.lang = pt-BR.
const RUNS = [
  { lang: 'en', dir: HOOKS, T: {
    path: 'security or payment path', sql: 'sensitive migration', sonnet: 'at least Sonnet', json: 'not valid JSON',
    noPath: 'without tool_input.file_path', ui: 'does not change the UI', failed: 'failed',
    exactPath: 'Blocked (security or payment path): src/auth.ts. Return STATUS: BLOCKED to escalate to executor-opus.',
    exactUi: 'Blocked: executor-haiku does not change the UI (src/App.tsx). Return STATUS: BLOCKED to escalate to executor-sonnet.',
    sqlDrop: 'Blocked (sensitive migration: removes an existing object)',
    sqlRls: 'RLS on an existing table (public.clientes)',
  } },
  { lang: 'pt-BR', dir: copyHooks('hooks-pt', 'pt-BR'), T: {
    path: 'caminho de segurança', sql: 'migration sensível', sonnet: 'pelo menos Sonnet', json: 'não é JSON',
    noPath: 'sem tool_input.file_path', ui: 'não altera interface', failed: 'falhou',
    exactPath: 'Bloqueado (caminho de segurança ou pagamento): src/auth.ts. Devolva STATUS: BLOQUEADO para subir ao executor-opus.',
    exactUi: 'Bloqueado: executor-haiku não altera interface (src/App.tsx). Devolva STATUS: BLOQUEADO para subir ao executor-sonnet.',
    sqlDrop: 'Bloqueado (migration sensível: remove objeto existente)',
    sqlRls: 'RLS em tabela existente (public.clientes)',
  } },
];
let r;
for (const { lang, dir, T } of RUNS) {
  const run = (file, args, input, extraEnv) => hook(file, args, input, dir, extraEnv);

  // ---------- block-sensitive.js: paths ----------
  console.log(`\n# [${lang}] block-sensitive.js: paths`);
  const blockPath = [
    'app/api/auth/users/route.ts', 'src/stripe/dev/handler.ts', 'src/payment/users/../index.ts', 'src/ok/../auth/x.ts',
    'src\\Payment\\Tela.ts', 'src/auth.ts::$DATA', 'src/login.ts. ', 'src/Login.ts:fluxo:$DATA',
    'src/lib/jwt.ts', 'src/token-store.ts', 'src/session.ts', 'middleware.ts', 'src/permissions.ts',
    'certs/server.pem', '.ssh/id_rsa', 'certs/server.key', 'src/rls.ts', 'supabase/rls/politicas.ts',
    path.join(PROJ, 'src', 'auth', 'x.ts'), 'C:\\outro\\stripe\\x.ts',
  ];
  for (const p of blockPath) expect(`[${lang}] blocks ${p}`, run('block-sensitive.js', ['sonnet'], write(p)), 2, T.path);
  r = run('block-sensitive.js', ['sonnet'], write('src/auth.ts'));
  check(`[${lang}] full block message, with the same reason and destination`, r.status === 2 && r.err.trim() === T.exactPath, r.err);
  const passPath = [
    ['src/components/UserList.tsx', PROJ], ['src/utils/urls.ts', PROJ], ['src/lib/formatar.ts', PROJ],
    ['C:\\Users\\Carls\\proj\\src\\components\\UserList.tsx', 'C:\\Users\\Carls\\proj'],
    ['C:\\Users\\Carls\\proj\\src\\lib\\formatar.ts', 'C:\\Users\\Carls\\proj'],
    ['C:\\Users\\Carls\\outro\\src\\x.ts', 'C:\\Dev\\p'],
    ['C:\\Dev\\auth-service\\src\\lista.ts', 'C:\\Dev\\auth-service'],
  ];
  for (const [p, cwd] of passPath) expect(`[${lang}] passes ${p} (sonnet)`, run('block-sensitive.js', ['sonnet'], write(p, {}, cwd)), 0);
  const SUB = path.join(PROJ, 'src', 'auth');
  const withBase = { CLAUDE_PROJECT_DIR: PROJ };
  expect(`[${lang}] with CLAUDE_PROJECT_DIR and cwd in src/auth, relative handler.ts blocks`,
    run('block-sensitive.js', ['sonnet'], write('handler.ts', {}, SUB), withBase), 2, T.path);
  expect(`[${lang}] with CLAUDE_PROJECT_DIR, an absolute path inside the base uses the relative part`,
    run('block-sensitive.js', ['sonnet'], write(path.join(SUB, 'handler.ts'), {}, PROJ), withBase), 2, T.path);
  expect(`[${lang}] with CLAUDE_PROJECT_DIR and cwd in src/auth, absolute src/lib/formatar.ts passes`,
    run('block-sensitive.js', ['sonnet'], write(path.join(PROJ, 'src', 'lib', 'formatar.ts'), {}, SUB), withBase), 0);
  expect(`[${lang}] without CLAUDE_PROJECT_DIR, cwd in src/auth and relative handler.ts keeps the current behavior (passes)`,
    run('block-sensitive.js', ['sonnet'], write('handler.ts', {}, SUB)), 0);
  if (process.platform === 'win32') {
    expect(`[${lang}] passes /c/Users/Carls/proj/src/x.ts (Git Bash)`, run('block-sensitive.js', ['sonnet'], write('/c/Users/Carls/proj/src/x.ts', {}, 'C:\\Users\\Carls\\proj')), 0);
    expect(`[${lang}] blocks /c/Users/Carls/proj/src/auth/x.ts (Git Bash)`, run('block-sensitive.js', ['sonnet'], write('/c/Users/Carls/proj/src/auth/x.ts', {}, 'C:\\Users\\Carls\\proj')), 2);
  }

  // ---------- block-sensitive.js: SQL ----------
  console.log(`\n# [${lang}] block-sensitive.js: SQL`);
  const MIG = 'supabase/migrations/20260101_teste.sql';
  const sql = (content, level = 'sonnet', file = MIG) => run('block-sensitive.js', [level], write(file, { content }));
  const TABLE = 'create table public.t (id int);';
  const blockSql = [
    ['drop database', 'drop database app;'],
    ['drop materialized view', 'drop materialized view resumo;'],
    ['drop constraint', 'alter table clientes drop constraint clientes_pk;'],
    ['alter table drop without column', 'alter table clientes drop apelido;'],
    ['alter role bypassrls', 'alter role app bypassrls;'],
    ['create role superuser', 'create role adm with login superuser;'],
    ['update only', 'update only clientes set ativo = false;'],
    ['update with alias', 'update clientes c set ativo = false where c.id = 1;'],
    ['update with quotes and as', 'update "public"."clientes" as c set ativo = false;'],
    ['on conflict do update set', 'insert into clientes (id) values (1) on conflict (id) do update set nome = excluded.nome;'],
    ['using (1=1)', TABLE + ' alter table t enable row level security; create policy p on t for select using (1=1);'],
    ['using (true)', TABLE + ' alter table t enable row level security; create policy p on t for select using ( true );'],
    ['alter table "auth"."users"', 'alter table "auth"."users" add column x int;'],
    ['create or replace function auth.*', 'create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;'],
    ['trigger on auth.users', 'create trigger t after insert on auth.users for each row execute function public.f();'],
    ['orders table', 'create table orders (id int);'],
    ['refund table', 'create table refund_requests (id int);'],
    ['pix table', 'create table pix (id int);'],
    ['payments table', 'create table payments (id int);'],
    ['invoices table', 'create table invoices (id int);'],
    ['policy in a different schema', TABLE + ' create policy p on outro.t for select using (id > 0);'],
    ['policy on an existing table', 'create policy "ler" on clientes for select using (id > 0);'],
    ['RLS on an existing table', 'alter table clientes enable row level security;'],
    ['comment becomes a space', 'drop/**/table clientes;'],
    ['-- inside a string', "insert into logs (m) values ('--'); drop table logs;"],
    ['/* inside a string', "insert into logs (m) values ('/*'); drop table logs; -- */"],
    ['-- inside $$', 'select $$ -- $$; drop table logs;'],
    ['delete from', 'delete from clientes;'],
    ['grant', 'grant select on clientes to anon;'],
  ];
  for (const [name, s] of blockSql) expect(`[${lang}] blocks SQL: ${name}`, sql(s), 2, T.sql);
  expect(`[${lang}] SQL reason is translated`, sql('drop database app;'), 2, T.sqlDrop);
  expect(`[${lang}] SQL reason keeps the table name`, sql('alter table clientes enable row level security;'), 2, T.sqlRls);
  expect(`[${lang}] blocks a migration on haiku`, sql('create index i on t (a);', 'haiku'), 2, T.sonnet);
  expect(`[${lang}] blocks x.sql::$DATA on haiku`, sql('create index i on t (a);', 'haiku', 'supabase/migrations/x.sql::$DATA'), 2, T.sonnet);
  expect(`[${lang}] blocks x.SQL. with drop on sonnet`, sql('drop table clientes;', 'sonnet', 'db\\X.SQL. '), 2, T.sql);
  expect(`[${lang}] blocks MultiEdit with truncate`, run('block-sensitive.js', ['sonnet'], { tool_name: 'MultiEdit', cwd: PROJ, tool_input: { file_path: MIG, edits: [{ old_string: 'a', new_string: 'truncate clientes;' }] } }), 2);
  fs.mkdirSync(path.join(PROJ, 'supabase', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'supabase', 'migrations', 'velha.sql'), 'drop table antiga;\n');
  expect(`[${lang}] Edit analyzes the current file`, run('block-sensitive.js', ['sonnet'], { tool_name: 'Edit', cwd: PROJ, tool_input: { file_path: 'supabase/migrations/velha.sql', old_string: 'x', new_string: 'create index i on t (a);' } }), 2);
  r = sql('select 1;\n'.repeat(25000));
  expect(`[${lang}] blocks SQL over 200 KB`, r, 2, '200 KB');
  r = sql('alter column '.repeat(10000));
  check(`[${lang}] alter column x10000 without quadratic regex (${r.ms} ms)`, r.ms < 500 && r.status !== null, `${r.ms} ms`);
  r = sql('create policy "'.repeat(10000));
  check(`[${lang}] create policy " x10000 fast (${r.ms} ms)`, r.ms < 500 && r.status !== null, `${r.ms} ms`);
  const passSql = [
    ['create index', 'create index idx_t_nome on public.t (nome);'],
    ['new table with its own RLS', `create table public.tarefas (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references auth.users (id) on delete cascade,
        titulo text not null, criado_em timestamptz default now()
      );
      alter table public.tarefas enable row level security;
      create policy "dono lê" on public.tarefas for select using (auth.uid() = user_id);
      create policy "dono grava" on tarefas for insert with check ((select auth.uid()) = user_id);`],
    ['add column', 'alter table clientes add column apelido text;'],
    ['comment with drop', '-- drop table antiga\n/* delete from x */\ncreate index i on t (a);'],
    ['order by is not orders', 'create view v as select * from t order by id;'],
    ['pixels is not pix', 'create table pixels (id int);'],
  ];
  for (const [name, s] of passSql) expect(`[${lang}] passes SQL: ${name}`, sql(s), 0);

  // ---------- block-sensitive.js: invalid input ----------
  console.log(`\n# [${lang}] block-sensitive.js: invalid input`);
  expect(`[${lang}] blocks input that is not JSON`, run('block-sensitive.js', ['sonnet'], 'isto não é json'), 2, T.json);
  expect(`[${lang}] blocks empty input`, run('block-sensitive.js', ['sonnet'], ''), 2, T.json);
  expect(`[${lang}] blocks JSON null`, run('block-sensitive.js', ['sonnet'], 'null'), 2, T.json);
  expect(`[${lang}] blocks Write without file_path`, run('block-sensitive.js', ['sonnet'], { tool_name: 'Write', tool_input: {} }), 2, T.noPath);
  expect(`[${lang}] blocks Edit without tool_input (haiku)`, run('block-sensitive.js', ['haiku'], { tool_name: 'Edit', agent_type: 'executor-haiku' }), 2, T.noPath);
  expect(`[${lang}] passes a read tool without a path`, run('block-sensitive.js', ['sonnet'], { tool_name: 'Read', tool_input: {} }), 0);

  // ---------- block-ui.js ----------
  console.log(`\n# [${lang}] block-ui.js`);
  for (const p of ['src/App.tsx', 'src/App.tsx::$DATA', 'src\\App.TSX', 'src/App.tsx. ', 'src/x/../App.vue', 'src/estilo.css:fluxo'])
    expect(`[${lang}] blocks ${p} on haiku`, run('block-ui.js', [], write(p)), 2, T.ui);
  r = run('block-ui.js', [], write('src/App.tsx'));
  check(`[${lang}] full UI block message`, r.status === 2 && r.err.trim() === T.exactUi, r.err);
  for (const p of ['src/lib/util.ts', 'src/App.tsx.bak', 'README.md'])
    expect(`[${lang}] passes ${p} on haiku`, run('block-ui.js', [], write(p)), 0);
  expect(`[${lang}] blocks input that is not JSON`, run('block-ui.js', [], 'x'), 2, T.json);

  // ---------- project-gate.js ----------
  console.log(`\n# [${lang}] project-gate.js`);
  const withAgent = (agent_type, p) => ({ ...write(p), agent_type });
  expect(`[${lang}] opus not blocked (auth)`, run('project-gate.js', [], withAgent('executor-opus', 'src/auth/login.ts')), 0);
  expect(`[${lang}] main session not blocked`, run('project-gate.js', [], write('src/auth/login.ts')), 0);
  expect(`[${lang}] sonnet blocked in auth`, run('project-gate.js', [], withAgent('executor-sonnet', 'src/auth/login.ts')), 2, T.path);
  expect(`[${lang}] sonnet passes UserList.tsx`, run('project-gate.js', [], withAgent('executor-sonnet', 'src/components/UserList.tsx')), 0);
  expect(`[${lang}] haiku blocked on .tsx`, run('project-gate.js', [], withAgent('executor-haiku', 'src/components/UserList.tsx')), 2, T.ui);
  expect(`[${lang}] blocks input that is not JSON`, run('project-gate.js', [], 'x'), 2, T.json);
  const gate = (name, child) => {
    const d = path.join(TMP, `${name}-${lang}`); fs.mkdirSync(d);
    fs.copyFileSync(path.join(HOOKS, 'project-gate.js'), path.join(d, 'project-gate.js'));
    if (lang !== 'en') fs.writeFileSync(path.join(d, 'model-router.lang'), lang);
    if (child) fs.writeFileSync(path.join(d, 'block-sensitive.js'), child);
    return d;
  };
  expect(`[${lang}] blocks if the child script does not exist`, hook('project-gate.js', [], withAgent('executor-sonnet', 'src/x.ts'), gate('gate-no-child')), 2, T.failed);
  expect(`[${lang}] blocks if the child exits with 3`, hook('project-gate.js', [], withAgent('executor-sonnet', 'src/x.ts'), gate('gate-error', 'process.exit(3);')), 2, 'status 3');
  r = hook('project-gate.js', [], withAgent('executor-sonnet', 'src/x.ts'), gate('gate-slow', 'setTimeout(() => {}, 60000);'));
  check(`[${lang}] blocks on the child timeout (${r.ms} ms)`, r.status === 2 && r.ms < 9000 && r.err.includes(T.failed), `status ${r.status}, ${r.ms} ms: ${r.err}`);
}

// ---------- hook language ----------
console.log('\n# hook language (model-router.lang)');
const EN_PATH = RUNS[0].T.exactPath, PT_PATH = RUNS[1].T.exactPath;
for (const [name, content, want] of [
  ['explicit en', 'en', EN_PATH], ['invalid value falls back to en', 'xx', EN_PATH], ['prototype name falls back to en', 'constructor', EN_PATH],
  ['empty file falls back to en', '', EN_PATH], ['pt-BR with BOM and newline', '\uFEFFpt-BR\r\n', PT_PATH],
]) {
  const d = copyHooks('hooks-lang-' + name.replace(/\W+/g, '-'), content);
  r = hook('block-sensitive.js', ['sonnet'], write('src/auth.ts'), d);
  check(`block-sensitive.js: ${name}`, r.status === 2 && r.err.trim() === want, r.err);
  r = hook('project-gate.js', [], { ...write('src/auth.ts'), agent_type: 'executor-sonnet' }, d);
  check(`project-gate.js: ${name}`, r.status === 2 && r.err.trim() === want, r.err);
}

// ---------- log-delegation.js ----------
console.log('\n# log-delegation.js');
const JSONL = path.join(HOME_HOOKS, '.claude', 'delegations.jsonl');
const TR = path.join(TMP, 'transcript.jsonl');
fs.writeFileSync(TR, [
  JSON.stringify({ message: { role: 'user', content: 'Use sk-abcdefghijklmnop1234 ghp_abcdefghijklmnopqrst eyJhbGciOi.eyJzdWIi.x AKIAABCDEFGHIJKLMNOPQR fim do texto que é bem longo\nsegunda linha secreta' } }),
  '{ linha quebrada',
  JSON.stringify({ message: { role: 'assistant', content: 'STATUS: PRONTO', usage: { input_tokens: 10, output_tokens: 5 } } }),
].join('\n'));
fs.writeFileSync(JSONL, JSON.stringify({ sessao: 's1', status: 'BLOQUEADO' }) + '\n{"quebrada');
const logRun = (session, transcript = TR) => hook('log-delegation.js', [], { agent_type: 'executor-sonnet', session_id: session, agent_transcript_path: transcript, cwd: PROJ });
logRun('s1'); logRun('s1');
const lines = fs.readFileSync(JSONL, 'utf8').split('\n').filter(Boolean);
const added = lines.slice(-2).map((l) => { try { return JSON.parse(l); } catch { return null; } });
check('keeps logging with a corrupted line in the jsonl', lines.length === 4 && added.every(Boolean), lines.join(' | '));
const n0 = added[0] || {};
check('summary with up to 60 characters', typeof n0.resumo === 'string' && n0.resumo.length <= 60, n0.resumo);
check('summary masks secrets', n0.resumo && !/sk-a|ghp_|eyJ|AKIA/.test(n0.resumo), n0.resumo);
check('does not store the rest of the brief', !fs.readFileSync(JSONL, 'utf8').includes('segunda linha'), '');
check('status, tokens and escalated correct (PRONTO is stored as DONE)', n0.status === 'DONE' && n0.tokens === 15 && n0.subiu === true, JSON.stringify(n0));
check('does not create the old delegacoes.jsonl', !fs.existsSync(path.join(HOME_HOOKS, '.claude', 'delegacoes.jsonl')), '');
const lastLog = () => JSON.parse(fs.readFileSync(JSONL, 'utf8').trimEnd().split('\n').pop());
const transcript = (name, report) => {
  const f = path.join(TMP, name);
  fs.writeFileSync(f, [JSON.stringify({ message: { role: 'user', content: 'brief' } }), JSON.stringify({ message: { role: 'assistant', content: report } })].join('\n'));
  return f;
};
for (const [report, want] of [['STATUS: DONE\nCHANGED: x', 'DONE'], ['**STATUS:** **BLOCKED**', 'BLOCKED'], ['STATUS: BLOQUEADO', 'BLOCKED'], ['no report', 'LIMIT']]) {
  logRun('s-' + want, transcript('tr-' + want + '.jsonl', report));
  const l = lastLog();
  check(`"${report.split('\n')[0]}" is logged as ${want}`, l.status === want, JSON.stringify(l));
}
fs.appendFileSync(JSONL, JSON.stringify({ sessao: 's-old-done', status: 'PRONTO' }) + '\n' + JSON.stringify({ sessao: 's-old-limit', status: 'LIMITE' }) + '\n');
logRun('s-old-done');
check('old PRONTO in the same session does not count as escalation', lastLog().subiu === false, JSON.stringify(lastLog()));
logRun('s-old-limit');
check('old LIMITE in the same session counts as escalation', lastLog().subiu === true, JSON.stringify(lastLog()));

// ---------- log.js ----------
console.log('\n# log.js');
const HOME_LOG = newHome('home-log');
fs.mkdirSync(path.join(HOME_LOG, '.claude'));
const LOG_FILE = path.join(HOME_LOG, '.claude', 'delegations.jsonl');
const logJs = (args) => {
  const x = spawnSync(process.execPath, [path.join(R, 'skill', 'log.js'), ...args], { encoding: 'utf8', env: envFor(HOME_LOG), cwd: PROJ, timeout: 30000 });
  return { status: x.status, out: (x.stdout || '') + (x.stderr || '') };
};
fs.writeFileSync(LOG_FILE, [
  { agente: 'executor-sonnet', status: 'PRONTO', subiu: false, tokens: 100 },
  { agente: 'executor-sonnet', status: 'DONE', subiu: true, tokens: 300 },
  { agente: 'executor-sonnet', status: 'BLOQUEADO', subiu: false, tokens: null },
  { agente: 'executor-sonnet', status: 'REPROVADO', subiu: false, tokens: null },
  { agente: 'executor-haiku', status: 'LIMITE', subiu: false, tokens: null },
].map((x) => JSON.stringify(x)).join('\n') + '\n{"broken\n');
// Reads the console.table output as { row: { column: value } }.
const parseTable = (out) => {
  const rows = out.split('\n').filter((l) => l.includes('│')).map((l) => l.split('│').slice(1, -1).map((x) => x.trim().replace(/^'|'$/g, '')));
  const [head = [], ...body] = rows;
  return Object.fromEntries(body.map((row) => [row[0], Object.fromEntries(head.slice(1).map((h, k) => [h, row[k + 1]]))]));
};
const summary = logJs(['--summary']), resumo = logJs(['--resumo']);
const tbl = parseTable(summary.out);
const son = tbl['executor-sonnet'] || {}, hai = tbl['executor-haiku'] || {};
check('--summary normalizes old statuses', summary.status === 0 && son.tasks === '3' && son.done === '2' && son.rejected === '1' && son.escalated === '1' && son.avgTokens === '200', summary.out);
check('--summary counts old LIMITE as a task that is not done', hai.tasks === '1' && hai.done === '0', summary.out);
check('--resumo is an alias of --summary', resumo.status === 0 && resumo.out === summary.out, resumo.out);
r = logJs(['executor-haiku', 'REPROVADO', 'nao', '?', 'motivo', 'curto']);
let last = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8').trimEnd().split('\n').pop());
check('log.js stores REPROVADO as REJECTED', r.status === 0 && last.status === 'REJECTED' && last.subiu === false && last.tokens === null && last.resumo === 'motivo curto' && last.agente === 'executor-haiku', JSON.stringify(last) + r.out);
r = logJs(['executor-opus', 'BLOCKED', 'yes', '50', 'x']);
last = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8').trimEnd().split('\n').pop());
check('log.js accepts English values', r.status === 0 && last.status === 'BLOCKED' && last.subiu === true && last.tokens === 50, JSON.stringify(last));
r = logJs(['executor-opus', 'pronto', 'sim', '7', 'x']);
last = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8').trimEnd().split('\n').pop());
check('log.js accepts Portuguese values in any case', r.status === 0 && last.status === 'DONE' && last.subiu === true, JSON.stringify(last));
const sizeBefore = fs.readFileSync(LOG_FILE, 'utf8').length;
r = logJs(['executor-opus', 'XYZ', 'no', '?', 'x']);
check('log.js rejects an unknown status without writing', r.status === 1 && r.out.includes('Usage:') && fs.readFileSync(LOG_FILE, 'utf8').length === sizeBefore, r.out);
r = logJs(['executor-opus', 'DONE']);
check('log.js with missing arguments shows usage', r.status === 1 && r.out.includes('Usage:'), r.out);
check('log.js does not create the old delegacoes.jsonl', !fs.existsSync(path.join(HOME_LOG, '.claude', 'delegacoes.jsonl')), '');

// ---------- install.js ----------
console.log('\n# install.js');
const install = (home, args, script = 'install.js') => {
  const x = spawnSync(process.execPath, [path.join(R, script), ...args], { encoding: 'utf8', env: envFor(home), cwd: TMP, timeout: 30000 });
  return { status: x.status, out: (x.stdout || '') + (x.stderr || '') };
};
const snapshot = (d) => {
  const f = {};
  const walk = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); e.isDirectory() ? walk(p) : (f[path.relative(d, p)] = fs.readFileSync(p, 'utf8')); } };
  if (fs.existsSync(d)) walk(d);
  return f;
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const readText = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const locale = (lang, f) => fs.readFileSync(path.join(LOCALES, lang, f), 'utf8');
const AGENT_FILES = ['executor-haiku.md', 'executor-sonnet.md', 'executor-opus.md'];
// The installed text matches the chosen locale: skill, agents, rule and model-router.lang.
const installedLang = (C, cm, lang) => locale(lang, 'skill/SKILL.md') === readText(path.join(C, 'skills', 'claude-model-router', 'SKILL.md'))
  && AGENT_FILES.every((f) => locale(lang, 'agents/' + f) === readText(path.join(C, 'agents', f)))
  && readText(cm).includes(locale(lang, 'rule.md').trim()) && readText(path.join(C, 'hooks', 'model-router.lang')).trim() === lang;

let h = newHome('home-args');
r = install(h, ['--projet', h]);
check('typo --projet aborts with usage', r.status === 1 && r.out.includes('Unknown argument: --projet') && r.out.includes('Usage:') && !fs.existsSync(path.join(h, '.claude')), r.out);
r = install(h, ['--project']);
check('--project without folder aborts', r.status === 1 && r.out.includes('Provide the folder') && !fs.existsSync(path.join(h, '.claude')), r.out);
r = install(h, ['--projeto']);
check('--projeto without folder aborts', r.status === 1 && r.out.includes('Provide the folder after --projeto') && !fs.existsSync(path.join(h, '.claude')), r.out);
r = install(h, ['--projeto', '--sem-modelo']);
check('--projeto followed by an option aborts', r.status === 1 && !fs.existsSync(path.join(h, '.claude')), r.out);
r = install(h, ['extra']);
check('loose argument aborts', r.status === 1 && r.out.includes('Unknown argument'), r.out);
r = install(h, ['extra', '--lang', 'pt-BR']);
check('abort message follows a valid --lang', r.status === 1 && r.out.includes('Argumento desconhecido') && r.out.includes('Uso:') && r.out.includes('Nada foi alterado'), r.out);
r = install(h, ['--projeto', h]);
check('--projeto on the home folder aborts', r.status === 1 && r.out.includes('home folder') && !fs.existsSync(path.join(h, '.claude')) && !fs.existsSync(path.join(h, 'CLAUDE.md')), r.out);
r = install(h, ['--project', h, '--lang', 'pt-BR']);
check('--project on the home folder aborts (pt-BR)', r.status === 1 && r.out.includes('pasta pessoal') && !fs.existsSync(path.join(h, '.claude')), r.out);
if (process.platform === 'win32') {
  const free = 'QRSTUVWXYZJKLMNOP'.split('').find((l) => !fs.existsSync(l + ':\\'));
  if (free) { r = install(h, ['--projeto', free + ':\\']); check(`--projeto on the disk root (${free}:\\) aborts`, r.status === 1 && r.out.includes('root of the disk'), r.out); }
}
r = install(h, ['--lang', 'xx']);
check('--lang xx aborts with usage and changes nothing', r.status === 1 && r.out.includes('Unknown language: xx') && r.out.includes('Usage:') && Object.keys(snapshot(h)).length === 0, r.out);
r = install(h, ['--lang']);
check('--lang without value aborts', r.status === 1 && r.out.includes('Usage:') && Object.keys(snapshot(h)).length === 0, r.out);
r = install(h, ['--lang', '--no-model']);
check('--lang followed by an option aborts', r.status === 1 && Object.keys(snapshot(h)).length === 0, r.out);
r = install(h, ['--no-model', '--set-model', '--project', PROJ]);
check('--no-model with --set-model aborts', r.status === 1 && r.out.includes('not both') && !fs.existsSync(path.join(PROJ, '.claude')), r.out);
r = install(h, ['--sem-modelo', '--definir-modelo', '--projeto', PROJ]);
check('--sem-modelo with --definir-modelo aborts', r.status === 1 && r.out.includes('not both') && !fs.existsSync(path.join(PROJ, '.claude')), r.out);
r = install(h, ['--definir-modelo']);
check('--definir-modelo without --projeto aborts', r.status === 1 && r.out.includes('only works with --project') && Object.keys(snapshot(h)).length === 0, r.out);

h = newHome('home-invalid-settings');
fs.mkdirSync(path.join(h, '.claude'));
fs.writeFileSync(path.join(h, '.claude', 'settings.json'), '{ "model": "opus", ');
r = install(h, []);
check('invalid settings.json aborts without changing anything', r.status === 1 && r.out.includes('is not valid JSON')
  && JSON.stringify(Object.keys(snapshot(h))) === JSON.stringify([path.join('.claude', 'settings.json')])
  && fs.readFileSync(path.join(h, '.claude', 'settings.json'), 'utf8') === '{ "model": "opus", ', r.out);
r = install(h, ['--lang', 'pt-BR']);
check('invalid settings.json aborts in pt-BR', r.status === 1 && r.out.includes('não é um JSON válido') && Object.keys(snapshot(h)).length === 1, r.out);

h = newHome('home-unreadable-claude');
fs.mkdirSync(path.join(h, '.claude', 'CLAUDE.md'), { recursive: true });
r = install(h, []);
check('unreadable CLAUDE.md aborts without changing anything', r.status === 1 && r.out.includes('Could not read') && Object.keys(snapshot(h)).length === 0, r.out);

for (const [name, text] of [
  ['old start without end', '# Minha\n<!-- claude-model-router:inicio -->\nsem fim\n'],
  ['new start without end', '# Minha\n<!-- claude-model-router:start -->\nsem fim\n'],
  ['end before start', '# Minha\n<!-- claude-model-router:end -->\nx\n<!-- claude-model-router:start -->\n'],
  ['old and new blocks repeated', '<!-- delegar:inicio -->\na\n<!-- delegar:fim -->\n<!-- claude-model-router:start -->\nb\n<!-- claude-model-router:end -->\n'],
  ['new block repeated', '<!-- claude-model-router:start -->\na\n<!-- claude-model-router:end -->\n<!-- claude-model-router:start -->\nb\n<!-- claude-model-router:end -->\n'],
]) {
  h = newHome('home-markers-' + name.replace(/\W+/g, '-'));
  fs.mkdirSync(path.join(h, '.claude'));
  fs.writeFileSync(path.join(h, '.claude', 'CLAUDE.md'), text);
  r = install(h, []);
  // Old markers mean an old installation, so the message comes out in pt-BR.
  const want = /inicio/.test(text) ? 'desencontrados ou repetidos' : 'mismatched or repeated';
  check(`markers (${name}) abort without changing anything`, r.status === 1 && r.out.includes(want) &&Object.keys(snapshot(h)).length === 1 && readText(path.join(h, '.claude', 'CLAUDE.md')) === text, r.out);
}

h = newHome('home-full');
const C = path.join(h, '.claude');
fs.mkdirSync(C);
const CLAUDE_ORIG = '# Economia de modelos\ntexto antigo meu\n\n# Minhas regras\nnão mexer aqui\n';
const SETTINGS_ORIG = JSON.stringify({ model: 'opus', outra: 1, hooks: { SubagentStop: [{ matcher: '', hooks: [{ type: 'command', command: 'node meu.js' }] }] } }, null, 2);
fs.writeFileSync(path.join(C, 'CLAUDE.md'), CLAUDE_ORIG);
fs.writeFileSync(path.join(C, 'settings.json'), SETTINGS_ORIG);
r = install(h, []);
const cm = readText(path.join(C, 'CLAUDE.md'));
check('global install exits with 0', r.status === 0, r.out);
check('default language is en (skill, agents, rule and model-router.lang)', installedLang(C, path.join(C, 'CLAUDE.md'), 'en') && cm.includes('# Model economy'), cm);
check('CLAUDE.md keeps "# Economia de modelos" and its own sections', cm.includes('texto antigo meu') && cm.includes('# Minhas regras') && cm.includes('não mexer aqui'), cm);
check('CLAUDE.md gets a single block at the end', cm.split('<!-- claude-model-router:start -->').length === 2 && cm.trimEnd().endsWith('<!-- claude-model-router:end -->'), cm);
check('warns that the old section is still there', r.out.includes('Economia de modelos') && r.out.includes('was kept'), r.out);
let st = readJson(path.join(C, 'settings.json'));
check('existing model is kept, with a warning', st.model === 'opus' && st.outra === 1 && r.out.includes('"model": "opus"'), JSON.stringify(st));
check('own hook kept and log hook added', st.hooks.SubagentStop.length === 2 && JSON.stringify(st).includes('meu.js') && JSON.stringify(st).includes('log-delegation.js'), JSON.stringify(st));
check('backups of the original created', readText(path.join(C, 'settings.json.before-claude-model-router')) === SETTINGS_ORIG
  && readText(path.join(C, 'CLAUDE.md.before-claude-model-router')) === CLAUDE_ORIG, '');
check('copied hooks identical to the repository', ['block-ui.js', 'block-sensitive.js', 'log-delegation.js'].every((f) =>
  readText(path.join(C, 'hooks', f)) === fs.readFileSync(path.join(HOOKS, f), 'utf8')), '');
check('log.js copied identical to the repository', readText(path.join(C, 'skills', 'claude-model-router', 'log.js')) === fs.readFileSync(path.join(R, 'skill', 'log.js'), 'utf8'), '');
check('global mode does not install project-gate.js', !fs.existsSync(path.join(C, 'hooks', 'project-gate.js')), '');
check('final text lists changes and how to undo', r.out.includes('Created:') && r.out.includes('Updated:') && r.out.includes('To undo') && r.out.includes(path.join(C, 'settings.json')), r.out);
r = hook('block-sensitive.js', ['sonnet'], write('src/auth.ts'), path.join(C, 'hooks'));
check('installed hook speaks en', r.status === 2 && r.err.trim() === EN_PATH, r.err);
const snap1 = snapshot(h);
r = install(h, []);
check('second install changes nothing', r.status === 0 && JSON.stringify(snapshot(h)) === JSON.stringify(snap1) && r.out.includes('Nothing changed'), r.out);
st.extra = 2;
fs.writeFileSync(path.join(C, 'settings.json'), JSON.stringify(st, null, 2));
fs.appendFileSync(path.join(C, 'CLAUDE.md'), '\nnova linha\n');
r = install(h, []);
check('backup is not overwritten', r.status === 0 && readText(path.join(C, 'settings.json.before-claude-model-router')) === SETTINGS_ORIG
  && readText(path.join(C, 'CLAUDE.md.before-claude-model-router')) === CLAUDE_ORIG, r.out);
st = readJson(path.join(C, 'settings.json'));
check('log hook is not duplicated', st.hooks.SubagentStop.filter((e) => JSON.stringify(e).includes('log-delegation')).length === 1 && st.extra === 2, JSON.stringify(st));
r = install(h, ['--lang', 'xx']);
check('--lang xx on an existing install changes nothing', r.status === 1 && readText(path.join(C, 'hooks', 'model-router.lang')) === 'en' && readText(path.join(C, 'settings.json')).includes('"extra": 2'), r.out);

h = newHome('home-old-markers');
fs.mkdirSync(path.join(h, '.claude'));
fs.writeFileSync(path.join(h, '.claude', 'CLAUDE.md'), '# Minha\nantes\n<!-- delegar:inicio -->\nconteúdo velho\n<!-- delegar:fim -->\ndepois\n');
r = install(h, []);
const cm2 = readText(path.join(h, '.claude', 'CLAUDE.md'));
check('replaces only the block between the oldest markers', r.status === 0 && cm2.includes('antes') && cm2.includes('depois') && !cm2.includes('conteúdo velho') && !cm2.includes('delegar:') && cm2.includes('<!-- claude-model-router:start -->'), cm2);
check('an old block in CLAUDE.md keeps the install in pt-BR', installedLang(path.join(h, '.claude'), path.join(h, '.claude', 'CLAUDE.md'), 'pt-BR') && r.out.includes('Criados:'), r.out);
check('CLAUDE.md with an old block gets no new backup', !fs.existsSync(path.join(h, '.claude', 'CLAUDE.md.before-claude-model-router')), '');

h = newHome('home-empty');
r = install(h, []);
check('without a model set, writes sonnet', r.status === 0 && readJson(path.join(h, '.claude', 'settings.json')).model === 'sonnet', r.out);
h = newHome('home-no-model');
r = install(h, ['--no-model']);
check('--no-model does not set model', r.status === 0 && !('model' in readJson(path.join(h, '.claude', 'settings.json'))), r.out);

h = newHome('home-old-skill');
fs.mkdirSync(path.join(h, '.claude', 'skills', 'delegar'), { recursive: true });
fs.writeFileSync(path.join(h, '.claude', 'skills', 'delegar', 'SKILL.md'), '---\nname: delegar\n---\n\nEscolha o modelo mais barato capaz de fazer a tarefa.\n');
r = install(h, []);
check('removes skills/delegar from the old version', r.status === 0 && !fs.existsSync(path.join(h, '.claude', 'skills', 'delegar')), r.out);
h = newHome('home-foreign-delegar');
fs.mkdirSync(path.join(h, '.claude', 'skills', 'delegar'), { recursive: true });
fs.writeFileSync(path.join(h, '.claude', 'skills', 'delegar', 'SKILL.md'), '---\nname: delegar\n---\n\nMinha skill de delegar tarefas ao time.\n');
r = install(h, []);
check('keeps skills/delegar from another skill, with a warning', r.status === 0 && fs.existsSync(path.join(h, '.claude', 'skills', 'delegar', 'SKILL.md')) && r.out.includes('does not look like the old version'), r.out);

// ---------- install.js: language choice ----------
console.log('\n# install.js: language');
h = newHome('home-pt');
const CP = path.join(h, '.claude');
r = install(h, ['--lang', 'pt-BR']);
check('--lang pt-BR installs Portuguese', r.status === 0 && installedLang(CP, path.join(CP, 'CLAUDE.md'), 'pt-BR') && readText(path.join(CP, 'CLAUDE.md')).includes('# Economia de modelos'), r.out);
check('--lang pt-BR report in Portuguese', r.out.includes('Criados:') && r.out.includes('Para desfazer') && r.out.includes('Pronto.'), r.out);
r = hook('block-sensitive.js', ['sonnet'], write('src/auth.ts'), path.join(CP, 'hooks'));
check('installed hook speaks pt-BR', r.status === 2 && r.err.trim() === PT_PATH, r.err);
const snapPt = snapshot(h);
r = install(h, []);
check('update without --lang keeps pt-BR', r.status === 0 && JSON.stringify(snapshot(h)) === JSON.stringify(snapPt) && r.out.includes('Nada mudou'), r.out);
r = install(h, ['--lang', 'en']);
const cmEn = readText(path.join(CP, 'CLAUDE.md'));
check('--lang en switches an existing install to English', r.status === 0 && installedLang(CP, path.join(CP, 'CLAUDE.md'), 'en') && !cmEn.includes('Economia de modelos') && cmEn.split('claude-model-router:start').length === 2, cmEn);
r = install(h, []);
check('update without --lang keeps en', r.status === 0 && r.out.includes('Nothing changed') && readText(path.join(CP, 'hooks', 'model-router.lang')) === 'en', r.out);
fs.writeFileSync(path.join(CP, 'hooks', 'model-router.lang'), 'fr');
r = install(h, []);
check('invalid model-router.lang is replaced, with a warning', r.status === 0 && readText(path.join(CP, 'hooks', 'model-router.lang')) === 'en' && r.out.includes('unknown language'), r.out);

// ---------- instalar.js (alias) ----------
console.log('\n# instalar.js (alias)');
h = newHome('home-alias');
r = install(h, ['--sem-modelo'], 'instalar.js');
check('instalar.js installs like install.js (en by default)', r.status === 0 && installedLang(path.join(h, '.claude'), path.join(h, '.claude', 'CLAUDE.md'), 'en'), r.out);
check('instalar.js --sem-modelo does not set model', !('model' in readJson(path.join(h, '.claude', 'settings.json'))), '');
r = install(h, ['--projet', h], 'instalar.js');
check('instalar.js forwards arguments (typo aborts)', r.status === 1 && r.out.includes('Unknown argument: --projet'), r.out);
const PA = path.join(TMP, 'repo-alias'); fs.mkdirSync(PA);
r = install(h, ['--projeto', PA, '--definir-modelo', '--lang', 'pt-BR'], 'instalar.js');
check('instalar.js --projeto --definir-modelo --lang pt-BR', r.status === 0 && readJson(path.join(PA, '.claude', 'settings.json')).model === 'sonnet'
  && readText(path.join(PA, '.claude', 'hooks', 'model-router.lang')) === 'pt-BR', r.out);

// ---------- install.js: migration from the Portuguese names ----------
console.log('\n# install.js: migration');
const OLD_HOOK_TEXT = "// hook antigo\nconst nivel = e.agent_type; console.error('Devolva STATUS: BLOQUEADO para subir ao executor-opus.');\n";
const oldInstall = (home) => {
  const c = path.join(home, '.claude');
  fs.mkdirSync(path.join(c, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(c, 'skills', 'claude-model-router'), { recursive: true });
  fs.mkdirSync(path.join(c, 'agents'), { recursive: true });
  for (const f of ['bloquear-interface.js', 'bloquear-sensivel.js', 'registrar-delegacao.js']) fs.writeFileSync(path.join(c, 'hooks', f), OLD_HOOK_TEXT);
  fs.writeFileSync(path.join(c, 'skills', 'claude-model-router', 'SKILL.md'), '---\nname: claude-model-router\n---\nversão antiga\n');
  fs.writeFileSync(path.join(c, 'skills', 'claude-model-router', 'registrar.js'), '// registrar antigo\n');
  for (const f of AGENT_FILES) fs.writeFileSync(path.join(c, 'agents', f), 'agente antigo\n');
  return c;
};
h = newHome('home-migration');
const CM_ = oldInstall(h);
fs.writeFileSync(path.join(CM_, 'hooks', 'portao-projeto.js'), 'console.log("meu script com nome parecido");\n');
fs.writeFileSync(path.join(CM_, 'hooks', 'meu-hook.js'), 'meu\n');
const OLD_CLAUDE = '# Minhas regras\nmeu texto\n\n<!-- claude-model-router:inicio -->\n# Economia de modelos\nregra velha\n<!-- claude-model-router:fim -->\n\n# Depois\nmais meu\n';
fs.writeFileSync(path.join(CM_, 'CLAUDE.md'), OLD_CLAUDE);
const OLD_SETTINGS = JSON.stringify({ model: 'opus', hooks: {
  SubagentStop: [{ matcher: '', hooks: [{ type: 'command', command: 'node meu.js' }] }, { matcher: '', hooks: [{ type: 'command', command: 'node "$HOME/.claude/hooks/registrar-delegacao.js"', timeout: 5 }] }],
  PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node outro.js' }] }],
} }, null, 2);
fs.writeFileSync(path.join(CM_, 'settings.json'), OLD_SETTINGS);
fs.writeFileSync(path.join(CM_, 'settings.json.antes-claude-model-router'), '{"original": true}');
fs.writeFileSync(path.join(CM_, 'CLAUDE.md.antes-delegar'), '# original\n');
const OLD_LOG_TEXT = JSON.stringify({ agente: 'executor-sonnet', status: 'PRONTO', subiu: false, tokens: 10 }) + '\n';
fs.writeFileSync(path.join(CM_, 'delegacoes.jsonl'), OLD_LOG_TEXT);
r = install(h, []);
const mcm = readText(path.join(CM_, 'CLAUDE.md'));
st = readJson(path.join(CM_, 'settings.json'));
check('migration exits with 0', r.status === 0, r.out);
check('migration without --lang keeps pt-BR', installedLang(CM_, path.join(CM_, 'CLAUDE.md'), 'pt-BR'), readText(path.join(CM_, 'hooks', 'model-router.lang')));
check('migration replaces the inicio/fim block and keeps the user content', mcm.startsWith('# Minhas regras\nmeu texto\n') && mcm.includes('# Depois\nmais meu') && !mcm.includes('regra velha')
  && !mcm.includes(':inicio') && !mcm.includes(':fim') && mcm.split('<!-- claude-model-router:start -->').length === 2, mcm);
check('migration removes the old hooks that belong to the skill', ['bloquear-interface.js', 'bloquear-sensivel.js', 'registrar-delegacao.js'].every((f) => !fs.existsSync(path.join(CM_, 'hooks', f))), '');
check('migration keeps a file with an old name that is not ours, with a warning', fs.existsSync(path.join(CM_, 'hooks', 'portao-projeto.js')) && r.out.includes(path.join(CM_, 'hooks', 'portao-projeto.js')) && r.out.includes('não parece um arquivo dela'), r.out);
check('migration keeps other user hooks', readText(path.join(CM_, 'hooks', 'meu-hook.js')) === 'meu\n', '');
check('migration installs the new hooks and log.js', ['block-ui.js', 'block-sensitive.js', 'log-delegation.js'].every((f) => fs.existsSync(path.join(CM_, 'hooks', f)))
  && fs.existsSync(path.join(CM_, 'skills', 'claude-model-router', 'log.js')), '');
check('migration removes registrar.js', !fs.existsSync(path.join(CM_, 'skills', 'claude-model-router', 'registrar.js')), '');
const stText = JSON.stringify(st);
check('migration swaps the log hook in settings without duplicating it', st.hooks.SubagentStop.length === 2 && !stText.includes('registrar-delegacao')
  && st.hooks.SubagentStop.filter((e) => JSON.stringify(e).includes('log-delegation.js')).length === 1 && stText.includes('meu.js') && stText.includes('outro.js') && st.model === 'opus', stText);
check('migration copies delegacoes.jsonl to delegations.jsonl and keeps the old file', readText(path.join(CM_, 'delegations.jsonl')) === OLD_LOG_TEXT && readText(path.join(CM_, 'delegacoes.jsonl')) === OLD_LOG_TEXT, '');
check('migration creates no new backup next to the old ones', !fs.existsSync(path.join(CM_, 'settings.json.before-claude-model-router')) && !fs.existsSync(path.join(CM_, 'CLAUDE.md.before-claude-model-router'))
  && readText(path.join(CM_, 'settings.json.antes-claude-model-router')) === '{"original": true}' && readText(path.join(CM_, 'CLAUDE.md.antes-delegar')) === '# original\n', '');
check('migration report lists removed, created and updated', r.out.includes('Removidos') && r.out.includes(path.join(CM_, 'hooks', 'registrar-delegacao.js'))
  && r.out.includes(path.join(CM_, 'skills', 'claude-model-router', 'registrar.js')) && r.out.includes('Criados:') && r.out.includes(path.join(CM_, 'delegations.jsonl'))
  && r.out.includes('Atualizados:') && r.out.includes(path.join(CM_, 'settings.json')), r.out);
check('migration undo text points to the existing old backups', r.out.includes('CLAUDE.md.antes-delegar') && r.out.includes('settings.json.antes-claude-model-router'), r.out);
const snapMig = snapshot(h);
r = install(h, []);
check('second run after migration changes nothing', r.status === 0 && JSON.stringify(snapshot(h)) === JSON.stringify(snapMig) && r.out.includes('Nada mudou'), r.out);
r = hook('log-delegation.js', [], { agent_type: 'executor-haiku', session_id: 'm1', cwd: PROJ }, path.join(CM_, 'hooks'), { HOME: h, USERPROFILE: h });
const migLog = readText(path.join(CM_, 'delegations.jsonl')).trimEnd().split('\n');
check('after migration the hook appends to delegations.jsonl', migLog.length === 2 && JSON.parse(migLog[1]).status === 'LIMIT' && readText(path.join(CM_, 'delegacoes.jsonl')) === OLD_LOG_TEXT, migLog.join(' | '));

h = newHome('home-migration-log-exists');
const CL = oldInstall(h);
fs.writeFileSync(path.join(CL, 'delegacoes.jsonl'), 'velho\n');
fs.writeFileSync(path.join(CL, 'delegations.jsonl'), 'novo\n');
r = install(h, []);
check('migration does not overwrite an existing delegations.jsonl', r.status === 0 && readText(path.join(CL, 'delegations.jsonl')) === 'novo\n' && readText(path.join(CL, 'delegacoes.jsonl')) === 'velho\n', r.out);
check('old hooks alone (no CLAUDE.md) keep pt-BR', readText(path.join(CL, 'hooks', 'model-router.lang')) === 'pt-BR', '');
h = newHome('home-migration-lang-en');
const CE = oldInstall(h);
r = install(h, ['--lang', 'en']);
check('migration with --lang en installs English and still cleans up', r.status === 0 && installedLang(CE, path.join(CE, 'CLAUDE.md'), 'en')
  && !fs.existsSync(path.join(CE, 'hooks', 'bloquear-sensivel.js')) && !fs.existsSync(path.join(CE, 'skills', 'claude-model-router', 'registrar.js')) && r.out.includes('Removed'), r.out);

h = newHome('home-old-backups');
const CB = path.join(h, '.claude');
fs.mkdirSync(CB);
fs.writeFileSync(path.join(CB, 'CLAUDE.md'), '# meu\n');
fs.writeFileSync(path.join(CB, 'settings.json'), '{}');
fs.writeFileSync(path.join(CB, 'CLAUDE.md.antes-claude-model-router'), 'b1');
fs.writeFileSync(path.join(CB, 'settings.json.antes-delegar'), 'b2');
r = install(h, []);
check('an .antes-* backup counts as an existing backup', r.status === 0 && !fs.existsSync(path.join(CB, 'CLAUDE.md.before-claude-model-router')) && !fs.existsSync(path.join(CB, 'settings.json.before-claude-model-router'))
  && readText(path.join(CB, 'CLAUDE.md.antes-claude-model-router')) === 'b1' && readText(path.join(CB, 'settings.json.antes-delegar')) === 'b2', r.out);
check('a fresh install with old backups only stays en', readText(path.join(CB, 'hooks', 'model-router.lang')) === 'en', '');

// ---------- install.js: --project ----------
console.log('\n# install.js: --project');
const LOCAL_ONLY = (text) => /local-only|log\.js|delegations\.jsonl|## 6\./.test(text);
for (const lang of ['en', 'pt-BR'])
  check(`locales/${lang}/skill/SKILL.md has local-only parts to remove (test premise)`, (locale(lang, 'skill/SKILL.md').match(/<!-- local-only:start -->/g) || []).length >= 2, '');
h = newHome('home-project');
const P = path.join(TMP, 'repo');
fs.mkdirSync(path.join(P, '.claude'), { recursive: true });
fs.writeFileSync(path.join(P, 'CLAUDE.md'), '# Projeto\nregras do time\n');
fs.writeFileSync(path.join(P, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: [] } }));
r = install(h, ['--project', P]);
st = readJson(path.join(P, '.claude', 'settings.json'));
const skP = readText(path.join(P, '.claude', 'skills', 'claude-model-router', 'SKILL.md'));
check('--project exits with 0', r.status === 0, r.out);
check('--project does not set model and warns about the team', !('model' in st) && r.out.includes('team'), r.out);
check('--project adds the gate once', st.hooks.PreToolUse.length === 1 && JSON.stringify(st).includes('project-gate.js') && st.permissions, JSON.stringify(st));
check('--project keeps the team CLAUDE.md', readText(path.join(P, 'CLAUDE.md')).includes('regras do time'), '');
check('--project removes hooks from the agent frontmatter', !/^hooks:/m.test(readText(path.join(P, '.claude', 'agents', 'executor-haiku.md'))) && readText(path.join(P, '.claude', 'agents', 'executor-haiku.md')).includes('model: haiku'), '');
check('--project removes every local-only part (en)', skP.length > 1000 && !LOCAL_ONLY(skP) && !skP.includes('REJECTED') && skP.includes('## Rules') && skP.includes('or go up a level.'), skP.slice(-600));
check('--project does not install the log hook or log.js', !fs.existsSync(path.join(P, '.claude', 'hooks', 'log-delegation.js')) && !fs.existsSync(path.join(P, '.claude', 'skills', 'claude-model-router', 'log.js')), '');
check('--project installs the gate hooks and model-router.lang', ['block-ui.js', 'block-sensitive.js', 'project-gate.js'].every((f) =>
  readText(path.join(P, '.claude', 'hooks', f)) === fs.readFileSync(path.join(HOOKS, f), 'utf8')) && readText(path.join(P, '.claude', 'hooks', 'model-router.lang')) === 'en', '');
r = hook('project-gate.js', [], { ...write('src/auth.ts'), agent_type: 'executor-sonnet' }, path.join(P, '.claude', 'hooks'));
check('installed gate blocks sonnet in auth (en)', r.status === 2 && r.err.trim() === EN_PATH, r.err);
check('--project does not write to the home folder', !fs.existsSync(path.join(h, '.claude')), '');
const snapP = snapshot(P);
r = install(h, ['--projeto', P]);
check('--project is idempotent', r.status === 0 && JSON.stringify(snapshot(P)) === JSON.stringify(snapP), r.out);
const P2 = path.join(TMP, 'repo2'); fs.mkdirSync(P2);
r = install(h, ['--project', P2, '--set-model']);
check('--project --set-model writes sonnet', r.status === 0 && readJson(path.join(P2, '.claude', 'settings.json')).model === 'sonnet', r.out);
const P3 = path.join(TMP, 'repo3'); fs.mkdirSync(P3);
r = install(h, ['--project', P3, '--lang', 'pt-BR']);
const skP3 = readText(path.join(P3, '.claude', 'skills', 'claude-model-router', 'SKILL.md'));
check('--project --lang pt-BR removes every local-only part (pt-BR)', r.status === 0 && skP3.length > 1000 && !LOCAL_ONLY(skP3) && !skP3.includes('REPROVADO') && skP3.includes('## Regras') && skP3.includes('ou suba um nível.'), skP3.slice(-600));
check('--project --lang pt-BR report and rule in Portuguese', r.out.includes('Criados:') && r.out.includes('time') && readText(path.join(P3, 'CLAUDE.md')).includes('# Economia de modelos'), r.out);
r = hook('project-gate.js', [], { ...write('src/auth.ts'), agent_type: 'executor-sonnet' }, path.join(P3, '.claude', 'hooks'));
check('installed gate blocks sonnet in auth (pt-BR)', r.status === 2 && r.err.trim() === PT_PATH, r.err);

const P4 = path.join(TMP, 'repo-old');
fs.mkdirSync(path.join(P4, '.claude', 'hooks'), { recursive: true });
for (const f of ['bloquear-interface.js', 'bloquear-sensivel.js', 'portao-projeto.js']) fs.writeFileSync(path.join(P4, '.claude', 'hooks', f), OLD_HOOK_TEXT);
fs.writeFileSync(path.join(P4, 'CLAUDE.md'), '# Projeto\n\n<!-- claude-model-router:inicio -->\nvelho\n<!-- claude-model-router:fim -->\n');
fs.writeFileSync(path.join(P4, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [
  { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/portao-projeto.js"', timeout: 10 }] },
  { matcher: 'Bash', hooks: [{ type: 'command', command: 'node lint.js' }] },
] } }));
r = install(h, ['--projeto', P4]);
st = readJson(path.join(P4, '.claude', 'settings.json'));
check('--project migration keeps pt-BR and removes the old hooks', r.status === 0 && readText(path.join(P4, '.claude', 'hooks', 'model-router.lang')) === 'pt-BR'
  && ['bloquear-interface.js', 'bloquear-sensivel.js', 'portao-projeto.js'].every((f) => !fs.existsSync(path.join(P4, '.claude', 'hooks', f))), r.out);
check('--project migration swaps the gate without duplicating it', st.hooks.PreToolUse.length === 2 && !JSON.stringify(st).includes('portao-projeto')
  && st.hooks.PreToolUse.filter((e) => JSON.stringify(e).includes('project-gate.js')).length === 1 && JSON.stringify(st).includes('lint.js'), JSON.stringify(st));
check('--project migration replaces the old block', readText(path.join(P4, 'CLAUDE.md')).startsWith('# Projeto\n') && !readText(path.join(P4, 'CLAUDE.md')).includes('velho'), readText(path.join(P4, 'CLAUDE.md')));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${total - failures} OK, ${failures} FALHOU, ${total} casos.`);
process.exit(failures ? 1 : 0);
