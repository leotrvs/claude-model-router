#!/usr/bin/env node
// Testes dos hooks e do instalador. Uso: node tests/rodar.js
// Node puro, sem rede e sem dependências. Tudo roda numa pasta temporária: HOME e USERPROFILE
// apontam para ela nos processos filhos, então o ~/.claude real nunca é tocado.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const R = path.resolve(__dirname, '..');
const HOOKS = path.join(R, 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmr-testes-'));
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(PROJ);

let total = 0, falhas = 0;
const caso = (nome, ok, detalhe = '') => {
  total++; if (!ok) falhas++;
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${nome}${ok || !detalhe ? '' : '  -> ' + String(detalhe).trim().slice(0, 300)}`);
};
const envCom = (home) => {
  const e = { ...process.env, HOME: home, USERPROFILE: home };
  delete e.CLAUDE_PROJECT_DIR;
  return e;
};
const HOME_HOOKS = path.join(TMP, 'home-hooks');
fs.mkdirSync(path.join(HOME_HOOKS, '.claude'), { recursive: true });

function hook(arq, args, entrada, dir = HOOKS, extraEnv = {}) {
  const input = typeof entrada === 'string' ? entrada : JSON.stringify(entrada);
  const ini = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, arq), ...args], { input, encoding: 'utf8', env: { ...envCom(HOME_HOOKS), ...extraEnv }, cwd: PROJ, timeout: 30000 });
  return { status: r.status, err: (r.stderr || '') + (r.error ? r.error.message : ''), ms: Date.now() - ini };
}
const espera = (nome, r, codigo, trecho) =>
  caso(nome, r.status === codigo && (!trecho || r.err.includes(trecho)), `status ${r.status}: ${r.err}`);
const escrita = (file_path, extra = {}, cwd = PROJ) => ({ tool_name: 'Write', cwd, tool_input: { file_path, content: '', ...extra } });

// ---------- bloquear-sensivel.js: caminhos ----------
console.log('\n# bloquear-sensivel.js: caminhos');
const bloqueiaCaminho = [
  'app/api/auth/users/route.ts', 'src/stripe/dev/handler.ts', 'src/payment/users/../index.ts', 'src/ok/../auth/x.ts',
  'src\\Payment\\Tela.ts', 'src/auth.ts::$DATA', 'src/login.ts. ', 'src/Login.ts:fluxo:$DATA',
  'src/lib/jwt.ts', 'src/token-store.ts', 'src/session.ts', 'middleware.ts', 'src/permissions.ts',
  'certs/server.pem', '.ssh/id_rsa', 'certs/server.key', 'src/rls.ts', 'supabase/rls/politicas.ts',
  path.join(PROJ, 'src', 'auth', 'x.ts'), 'C:\\outro\\stripe\\x.ts',
];
for (const p of bloqueiaCaminho) espera(`bloqueia ${p}`, hook('bloquear-sensivel.js', ['sonnet'], escrita(p)), 2, 'caminho de segurança');
const passaCaminho = [
  ['src/components/UserList.tsx', PROJ], ['src/utils/urls.ts', PROJ], ['src/lib/formatar.ts', PROJ],
  ['C:\\Users\\Carls\\proj\\src\\components\\UserList.tsx', 'C:\\Users\\Carls\\proj'],
  ['C:\\Users\\Carls\\proj\\src\\lib\\formatar.ts', 'C:\\Users\\Carls\\proj'],
  ['C:\\Users\\Carls\\outro\\src\\x.ts', 'C:\\Dev\\p'],
  ['C:\\Dev\\auth-service\\src\\lista.ts', 'C:\\Dev\\auth-service'],
];
for (const [p, cwd] of passaCaminho) espera(`passa ${p} (sonnet)`, hook('bloquear-sensivel.js', ['sonnet'], escrita(p, {}, cwd)), 0);
const SUB = path.join(PROJ, 'src', 'auth');
const comRaiz = { CLAUDE_PROJECT_DIR: PROJ };
espera('com CLAUDE_PROJECT_DIR e cwd em src/auth, handler.ts relativo bloqueia',
  hook('bloquear-sensivel.js', ['sonnet'], escrita('handler.ts', {}, SUB), HOOKS, comRaiz), 2, 'caminho de segurança');
espera('com CLAUDE_PROJECT_DIR, caminho absoluto dentro da base usa o relativo',
  hook('bloquear-sensivel.js', ['sonnet'], escrita(path.join(SUB, 'handler.ts'), {}, PROJ), HOOKS, comRaiz), 2, 'caminho de segurança');
espera('com CLAUDE_PROJECT_DIR e cwd em src/auth, src/lib/formatar.ts absoluto passa',
  hook('bloquear-sensivel.js', ['sonnet'], escrita(path.join(PROJ, 'src', 'lib', 'formatar.ts'), {}, SUB), HOOKS, comRaiz), 0);
espera('sem CLAUDE_PROJECT_DIR, cwd em src/auth e handler.ts relativo mantém o comportamento atual (passa)',
  hook('bloquear-sensivel.js', ['sonnet'], escrita('handler.ts', {}, SUB)), 0);
if (process.platform === 'win32') {
  espera('passa /c/Users/Carls/proj/src/x.ts (Git Bash)', hook('bloquear-sensivel.js', ['sonnet'], escrita('/c/Users/Carls/proj/src/x.ts', {}, 'C:\\Users\\Carls\\proj')), 0);
  espera('bloqueia /c/Users/Carls/proj/src/auth/x.ts (Git Bash)', hook('bloquear-sensivel.js', ['sonnet'], escrita('/c/Users/Carls/proj/src/auth/x.ts', {}, 'C:\\Users\\Carls\\proj')), 2);
}

// ---------- bloquear-sensivel.js: SQL ----------
console.log('\n# bloquear-sensivel.js: SQL');
const MIG = 'supabase/migrations/20260101_teste.sql';
const sql = (conteudo, nivel = 'sonnet', arq = MIG) => hook('bloquear-sensivel.js', [nivel], escrita(arq, { content: conteudo }));
const TABELA = 'create table public.t (id int);';
const bloqueiaSql = [
  ['drop database', 'drop database app;'],
  ['drop materialized view', 'drop materialized view resumo;'],
  ['drop constraint', 'alter table clientes drop constraint clientes_pk;'],
  ['alter table drop sem column', 'alter table clientes drop apelido;'],
  ['alter role bypassrls', 'alter role app bypassrls;'],
  ['create role superuser', 'create role adm with login superuser;'],
  ['update only', 'update only clientes set ativo = false;'],
  ['update com alias', 'update clientes c set ativo = false where c.id = 1;'],
  ['update com aspas e as', 'update "public"."clientes" as c set ativo = false;'],
  ['on conflict do update set', 'insert into clientes (id) values (1) on conflict (id) do update set nome = excluded.nome;'],
  ['using (1=1)', TABELA + ' alter table t enable row level security; create policy p on t for select using (1=1);'],
  ['using (true)', TABELA + ' alter table t enable row level security; create policy p on t for select using ( true );'],
  ['alter table "auth"."users"', 'alter table "auth"."users" add column x int;'],
  ['create or replace function auth.*', 'create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;'],
  ['trigger em auth.users', 'create trigger t after insert on auth.users for each row execute function public.f();'],
  ['tabela orders', 'create table orders (id int);'],
  ['tabela refund', 'create table refund_requests (id int);'],
  ['tabela pix', 'create table pix (id int);'],
  ['tabela payments', 'create table payments (id int);'],
  ['tabela invoices', 'create table invoices (id int);'],
  ['política em schema diferente', TABELA + ' create policy p on outro.t for select using (id > 0);'],
  ['política em tabela existente', 'create policy "ler" on clientes for select using (id > 0);'],
  ['RLS em tabela existente', 'alter table clientes enable row level security;'],
  ['comentário vira espaço', 'drop/**/table clientes;'],
  ['-- dentro de string', "insert into logs (m) values ('--'); drop table logs;"],
  ['/* dentro de string', "insert into logs (m) values ('/*'); drop table logs; -- */"],
  ['-- dentro de $$', 'select $$ -- $$; drop table logs;'],
  ['delete from', 'delete from clientes;'],
  ['grant', 'grant select on clientes to anon;'],
];
for (const [nome, s] of bloqueiaSql) espera(`bloqueia SQL: ${nome}`, sql(s), 2, 'migration sensível');
espera('bloqueia migration no haiku', sql('create index i on t (a);', 'haiku'), 2, 'pelo menos Sonnet');
espera('bloqueia x.sql::$DATA no haiku', sql('create index i on t (a);', 'haiku', 'supabase/migrations/x.sql::$DATA'), 2, 'pelo menos Sonnet');
espera('bloqueia x.SQL. com drop no sonnet', sql('drop table clientes;', 'sonnet', 'db\\X.SQL. '), 2, 'migration sensível');
espera('bloqueia MultiEdit com truncate', hook('bloquear-sensivel.js', ['sonnet'], { tool_name: 'MultiEdit', cwd: PROJ, tool_input: { file_path: MIG, edits: [{ old_string: 'a', new_string: 'truncate clientes;' }] } }), 2);
fs.mkdirSync(path.join(PROJ, 'supabase', 'migrations'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'supabase', 'migrations', 'velha.sql'), 'drop table antiga;\n');
espera('Edit analisa o arquivo atual', hook('bloquear-sensivel.js', ['sonnet'], { tool_name: 'Edit', cwd: PROJ, tool_input: { file_path: 'supabase/migrations/velha.sql', old_string: 'x', new_string: 'create index i on t (a);' } }), 2);
let r = sql('select 1;\n'.repeat(25000));
espera('bloqueia SQL acima de 200 KB', r, 2, '200 KB');
r = sql('alter column '.repeat(10000));
caso(`alter column x10000 sem regex quadrática (${r.ms} ms)`, r.ms < 500 && r.status !== null, `${r.ms} ms`);
r = sql('create policy "'.repeat(10000));
caso(`create policy " x10000 rápido (${r.ms} ms)`, r.ms < 500 && r.status !== null, `${r.ms} ms`);
const passaSql = [
  ['create index', 'create index idx_t_nome on public.t (nome);'],
  ['create table nova com RLS própria', `create table public.tarefas (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users (id) on delete cascade,
      titulo text not null, criado_em timestamptz default now()
    );
    alter table public.tarefas enable row level security;
    create policy "dono lê" on public.tarefas for select using (auth.uid() = user_id);
    create policy "dono grava" on tarefas for insert with check ((select auth.uid()) = user_id);`],
  ['add column', 'alter table clientes add column apelido text;'],
  ['comentário com drop', '-- drop table antiga\n/* delete from x */\ncreate index i on t (a);'],
  ['order by não é orders', 'create view v as select * from t order by id;'],
  ['pixels não é pix', 'create table pixels (id int);'],
];
for (const [nome, s] of passaSql) espera(`passa SQL: ${nome}`, sql(s), 0);

// ---------- bloquear-sensivel.js: entrada inválida ----------
console.log('\n# bloquear-sensivel.js: entrada inválida');
espera('bloqueia entrada que não é JSON', hook('bloquear-sensivel.js', ['sonnet'], 'isto não é json'), 2, 'não é JSON');
espera('bloqueia entrada vazia', hook('bloquear-sensivel.js', ['sonnet'], ''), 2, 'não é JSON');
espera('bloqueia JSON null', hook('bloquear-sensivel.js', ['sonnet'], 'null'), 2, 'não é JSON');
espera('bloqueia Write sem file_path', hook('bloquear-sensivel.js', ['sonnet'], { tool_name: 'Write', tool_input: {} }), 2, 'sem tool_input.file_path');
espera('bloqueia Edit sem tool_input (haiku)', hook('bloquear-sensivel.js', ['haiku'], { tool_name: 'Edit', agent_type: 'executor-haiku' }), 2, 'sem tool_input.file_path');
espera('passa ferramenta de leitura sem caminho', hook('bloquear-sensivel.js', ['sonnet'], { tool_name: 'Read', tool_input: {} }), 0);

// ---------- bloquear-interface.js ----------
console.log('\n# bloquear-interface.js');
for (const p of ['src/App.tsx', 'src/App.tsx::$DATA', 'src\\App.TSX', 'src/App.tsx. ', 'src/x/../App.vue', 'src/estilo.css:fluxo'])
  espera(`bloqueia ${p} no haiku`, hook('bloquear-interface.js', [], escrita(p)), 2, 'não altera interface');
for (const p of ['src/lib/util.ts', 'src/App.tsx.bak', 'README.md'])
  espera(`passa ${p} no haiku`, hook('bloquear-interface.js', [], escrita(p)), 0);
espera('bloqueia entrada que não é JSON', hook('bloquear-interface.js', [], 'x'), 2, 'não é JSON');

// ---------- portao-projeto.js ----------
console.log('\n# portao-projeto.js');
const comAgente = (agent_type, p) => ({ ...escrita(p), agent_type });
espera('opus sem bloqueio (auth)', hook('portao-projeto.js', [], comAgente('executor-opus', 'src/auth/login.ts')), 0);
espera('sessão principal sem bloqueio', hook('portao-projeto.js', [], escrita('src/auth/login.ts')), 0);
espera('sonnet bloqueado em auth', hook('portao-projeto.js', [], comAgente('executor-sonnet', 'src/auth/login.ts')), 2, 'caminho de segurança');
espera('sonnet passa em UserList.tsx', hook('portao-projeto.js', [], comAgente('executor-sonnet', 'src/components/UserList.tsx')), 0);
espera('haiku bloqueado em .tsx', hook('portao-projeto.js', [], comAgente('executor-haiku', 'src/components/UserList.tsx')), 2, 'interface');
espera('bloqueia entrada que não é JSON', hook('portao-projeto.js', [], 'x'), 2, 'não é JSON');
const portao = (nome, filho) => {
  const d = path.join(TMP, nome); fs.mkdirSync(d);
  fs.copyFileSync(path.join(HOOKS, 'portao-projeto.js'), path.join(d, 'portao-projeto.js'));
  if (filho) fs.writeFileSync(path.join(d, 'bloquear-sensivel.js'), filho);
  return d;
};
espera('bloqueia se o script filho não existe', hook('portao-projeto.js', [], comAgente('executor-sonnet', 'src/x.ts'), portao('portao-sem-filho')), 2, 'falhou');
espera('bloqueia se o filho sai com 3', hook('portao-projeto.js', [], comAgente('executor-sonnet', 'src/x.ts'), portao('portao-erro', 'process.exit(3);')), 2, 'status 3');
r = hook('portao-projeto.js', [], comAgente('executor-sonnet', 'src/x.ts'), portao('portao-lento', 'setTimeout(() => {}, 60000);'));
caso(`bloqueia no timeout do filho (${r.ms} ms)`, r.status === 2 && r.ms < 9000 && r.err.includes('falhou'), `status ${r.status}, ${r.ms} ms: ${r.err}`);

// ---------- registrar-delegacao.js ----------
console.log('\n# registrar-delegacao.js');
const JSONL = path.join(HOME_HOOKS, '.claude', 'delegacoes.jsonl');
const TR = path.join(TMP, 'transcript.jsonl');
fs.writeFileSync(TR, [
  JSON.stringify({ message: { role: 'user', content: 'Use sk-abcdefghijklmnop1234 ghp_abcdefghijklmnopqrst eyJhbGciOi.eyJzdWIi.x AKIAABCDEFGHIJKLMNOPQR fim do texto que é bem longo\nsegunda linha secreta' } }),
  '{ linha quebrada',
  JSON.stringify({ message: { role: 'assistant', content: 'STATUS: PRONTO', usage: { input_tokens: 10, output_tokens: 5 } } }),
].join('\n'));
fs.writeFileSync(JSONL, JSON.stringify({ sessao: 's1', status: 'BLOQUEADO' }) + '\n{"quebrada');
const reg = () => hook('registrar-delegacao.js', [], { agent_type: 'executor-sonnet', session_id: 's1', agent_transcript_path: TR, cwd: PROJ });
reg(); reg();
const linhas = fs.readFileSync(JSONL, 'utf8').split('\n').filter(Boolean);
const novas = linhas.slice(-2).map((l) => { try { return JSON.parse(l); } catch { return null; } });
caso('continua gravando com linha corrompida no jsonl', linhas.length === 4 && novas.every(Boolean), linhas.join(' | '));
const n0 = novas[0] || {};
caso('resumo com até 60 caracteres', typeof n0.resumo === 'string' && n0.resumo.length <= 60, n0.resumo);
caso('resumo mascara segredos', n0.resumo && !/sk-a|ghp_|eyJ|AKIA/.test(n0.resumo), n0.resumo);
caso('não grava o resto do briefing', !fs.readFileSync(JSONL, 'utf8').includes('segunda linha'), '');
caso('status, tokens e subiu corretos', n0.status === 'PRONTO' && n0.tokens === 15 && n0.subiu === true, JSON.stringify(n0));

// ---------- instalar.js ----------
console.log('\n# instalar.js');
const instala = (home, args) => {
  const r = spawnSync(process.execPath, [path.join(R, 'instalar.js'), ...args], { encoding: 'utf8', env: envCom(home), cwd: TMP, timeout: 30000 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const novaHome = (nome) => { const h = path.join(TMP, nome); fs.mkdirSync(h, { recursive: true }); return h; };
const fotografia = (d) => {
  const f = {};
  const anda = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); e.isDirectory() ? anda(p) : (f[path.relative(d, p)] = fs.readFileSync(p, 'utf8')); } };
  if (fs.existsSync(d)) anda(d);
  return f;
};
const lerJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Antes de rodar o instalador global, confirma que os.homedir() respeita HOME/USERPROFILE.
const sonda = novaHome('home-sonda');
const hd = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("os").homedir())'], { encoding: 'utf8', env: envCom(sonda) }).stdout;
caso('os.homedir() segue HOME/USERPROFILE no processo filho', path.resolve(hd) === path.resolve(sonda), hd);
if (path.resolve(hd) !== path.resolve(sonda)) {
  console.log('\nAbortado: o instalador global gravaria no ~/.claude real.');
  process.exit(1);
}

let h = novaHome('home-args');
r = instala(h, ['--project', h]);
caso('--project aborta com uso', r.status === 1 && r.out.includes('Argumento desconhecido') && r.out.includes('Uso:') && !fs.existsSync(path.join(h, '.claude')), r.out);
r = instala(h, ['--projeto']);
caso('--projeto sem pasta aborta', r.status === 1 && r.out.includes('Informe a pasta') && !fs.existsSync(path.join(h, '.claude')), r.out);
r = instala(h, ['--projeto', '--sem-modelo']);
caso('--projeto seguido de opção aborta', r.status === 1 && !fs.existsSync(path.join(h, '.claude')), r.out);
r = instala(h, ['extra']);
caso('argumento solto aborta', r.status === 1 && r.out.includes('Argumento desconhecido'), r.out);
r = instala(h, ['--projeto', h]);
caso('--projeto na pasta pessoal aborta', r.status === 1 && r.out.includes('pasta pessoal') && !fs.existsSync(path.join(h, '.claude')) && !fs.existsSync(path.join(h, 'CLAUDE.md')), r.out);
if (process.platform === 'win32') {
  const livre = 'QRSTUVWXYZJKLMNOP'.split('').find((l) => !fs.existsSync(l + ':\\'));
  if (livre) { r = instala(h, ['--projeto', livre + ':\\']); caso(`--projeto na raiz do disco (${livre}:\\) aborta`, r.status === 1 && r.out.includes('raiz do disco'), r.out); }
}

h = novaHome('home-settings-invalido');
fs.mkdirSync(path.join(h, '.claude'));
fs.writeFileSync(path.join(h, '.claude', 'settings.json'), '{ "model": "opus", ');
r = instala(h, []);
caso('settings.json inválido aborta sem alterar nada', r.status === 1 && r.out.includes('não é um JSON válido')
  && JSON.stringify(Object.keys(fotografia(h))) === JSON.stringify([path.join('.claude', 'settings.json')])
  && fs.readFileSync(path.join(h, '.claude', 'settings.json'), 'utf8') === '{ "model": "opus", ', r.out);

h = novaHome('home-claude-ilegivel');
fs.mkdirSync(path.join(h, '.claude', 'CLAUDE.md'), { recursive: true });
r = instala(h, []);
caso('CLAUDE.md ilegível aborta sem alterar nada', r.status === 1 && r.out.includes('Não consegui ler') && Object.keys(fotografia(h)).length === 0, r.out);

h = novaHome('home-marcador-solto');
fs.mkdirSync(path.join(h, '.claude'));
fs.writeFileSync(path.join(h, '.claude', 'CLAUDE.md'), '# Minha\n<!-- claude-model-router:inicio -->\nsem fim\n');
r = instala(h, []);
caso('marcador sem fim aborta sem alterar nada', r.status === 1 && Object.keys(fotografia(h)).length === 1, r.out);

h = novaHome('home-completa');
const C = path.join(h, '.claude');
fs.mkdirSync(C);
const CLAUDE_ORIG = '# Economia de modelos\ntexto antigo meu\n\n# Minhas regras\nnão mexer aqui\n';
const SETTINGS_ORIG = JSON.stringify({ model: 'opus', outra: 1, hooks: { SubagentStop: [{ matcher: '', hooks: [{ type: 'command', command: 'node meu.js' }] }] } }, null, 2);
fs.writeFileSync(path.join(C, 'CLAUDE.md'), CLAUDE_ORIG);
fs.writeFileSync(path.join(C, 'settings.json'), SETTINGS_ORIG);
r = instala(h, []);
const cm = fs.existsSync(path.join(C, 'CLAUDE.md')) ? fs.readFileSync(path.join(C, 'CLAUDE.md'), 'utf8') : '';
caso('instalação global termina com 0', r.status === 0, r.out);
caso('CLAUDE.md mantém "# Economia de modelos" e seções próprias', cm.includes('texto antigo meu') && cm.includes('# Minhas regras') && cm.includes('não mexer aqui'), cm);
caso('CLAUDE.md recebe um único bloco no fim', cm.split('<!-- claude-model-router:inicio -->').length === 2 && cm.trimEnd().endsWith('<!-- claude-model-router:fim -->'), cm);
caso('avisa que a seção antiga continua lá', r.out.includes('Economia de modelos') && r.out.includes('foi mantida'), r.out);
let st = lerJson(path.join(C, 'settings.json'));
caso('model existente é mantido, com aviso', st.model === 'opus' && st.outra === 1 && r.out.includes('"model": "opus"'), JSON.stringify(st));
caso('hook próprio mantido e registro adicionado', st.hooks.SubagentStop.length === 2 && JSON.stringify(st).includes('meu.js') && JSON.stringify(st).includes('registrar-delegacao'), JSON.stringify(st));
caso('backups do original criados', fs.readFileSync(path.join(C, 'settings.json.antes-claude-model-router'), 'utf8') === SETTINGS_ORIG
  && fs.readFileSync(path.join(C, 'CLAUDE.md.antes-claude-model-router'), 'utf8') === CLAUDE_ORIG, '');
caso('hooks copiados iguais aos do repositório', ['bloquear-interface.js', 'bloquear-sensivel.js', 'registrar-delegacao.js'].every((f) =>
  fs.readFileSync(path.join(C, 'hooks', f), 'utf8') === fs.readFileSync(path.join(HOOKS, f), 'utf8')), '');
caso('texto final lista alterações e como desfazer', r.out.includes('Criados:') && r.out.includes('Atualizados:') && r.out.includes('Para desfazer') && r.out.includes(path.join(C, 'settings.json')), r.out);
const foto1 = fotografia(h);
r = instala(h, []);
caso('segunda instalação não muda nada', r.status === 0 && JSON.stringify(fotografia(h)) === JSON.stringify(foto1) && r.out.includes('Nada mudou'), r.out);
st.extra = 2;
fs.writeFileSync(path.join(C, 'settings.json'), JSON.stringify(st, null, 2));
fs.appendFileSync(path.join(C, 'CLAUDE.md'), '\nnova linha\n');
r = instala(h, []);
caso('backup não é sobrescrito', r.status === 0 && fs.readFileSync(path.join(C, 'settings.json.antes-claude-model-router'), 'utf8') === SETTINGS_ORIG
  && fs.readFileSync(path.join(C, 'CLAUDE.md.antes-claude-model-router'), 'utf8') === CLAUDE_ORIG, r.out);
st = lerJson(path.join(C, 'settings.json'));
caso('registro não duplica', st.hooks.SubagentStop.filter((e) => JSON.stringify(e).includes('registrar-delegacao')).length === 1 && st.extra === 2, JSON.stringify(st));

h = novaHome('home-marcadores');
fs.mkdirSync(path.join(h, '.claude'));
fs.writeFileSync(path.join(h, '.claude', 'CLAUDE.md'), '# Minha\nantes\n<!-- delegar:inicio -->\nconteúdo velho\n<!-- delegar:fim -->\ndepois\n');
r = instala(h, []);
const cm2 = fs.readFileSync(path.join(h, '.claude', 'CLAUDE.md'), 'utf8');
caso('substitui só o bloco entre marcadores antigos', r.status === 0 && cm2.includes('antes') && cm2.includes('depois') && !cm2.includes('conteúdo velho') && cm2.includes('<!-- claude-model-router:inicio -->'), cm2);

h = novaHome('home-vazia');
r = instala(h, []);
caso('sem model definido, grava sonnet', r.status === 0 && lerJson(path.join(h, '.claude', 'settings.json')).model === 'sonnet', r.out);
h = novaHome('home-sem-modelo');
r = instala(h, ['--sem-modelo']);
caso('--sem-modelo não define model', r.status === 0 && !('model' in lerJson(path.join(h, '.claude', 'settings.json'))), r.out);

h = novaHome('home-antiga');
fs.mkdirSync(path.join(h, '.claude', 'skills', 'delegar'), { recursive: true });
fs.writeFileSync(path.join(h, '.claude', 'skills', 'delegar', 'SKILL.md'), '---\nname: delegar\n---\n\nEscolha o modelo mais barato capaz de fazer a tarefa.\n');
r = instala(h, []);
caso('remove skills/delegar da versão antiga', r.status === 0 && !fs.existsSync(path.join(h, '.claude', 'skills', 'delegar')), r.out);
h = novaHome('home-delegar-alheia');
fs.mkdirSync(path.join(h, '.claude', 'skills', 'delegar'), { recursive: true });
fs.writeFileSync(path.join(h, '.claude', 'skills', 'delegar', 'SKILL.md'), '---\nname: delegar\n---\n\nMinha skill de delegar tarefas ao time.\n');
r = instala(h, []);
caso('mantém skills/delegar de outra skill, com aviso', r.status === 0 && fs.existsSync(path.join(h, '.claude', 'skills', 'delegar', 'SKILL.md')) && r.out.includes('não parece a versão antiga'), r.out);

h = novaHome('home-projeto');
const P = path.join(TMP, 'repo');
fs.mkdirSync(path.join(P, '.claude'), { recursive: true });
fs.writeFileSync(path.join(P, 'CLAUDE.md'), '# Projeto\nregras do time\n');
fs.writeFileSync(path.join(P, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: [] } }));
r = instala(h, ['--projeto', P]);
st = lerJson(path.join(P, '.claude', 'settings.json'));
caso('--projeto termina com 0', r.status === 0, r.out);
caso('--projeto não define model e avisa sobre o time', !('model' in st) && r.out.includes('time'), r.out);
caso('--projeto adiciona o portão uma vez', st.hooks.PreToolUse.length === 1 && JSON.stringify(st).includes('portao-projeto') && st.permissions, JSON.stringify(st));
caso('--projeto mantém o CLAUDE.md do time', fs.readFileSync(path.join(P, 'CLAUDE.md'), 'utf8').includes('regras do time'), '');
caso('--projeto tira hooks do frontmatter dos agentes', !/^hooks:/m.test(fs.readFileSync(path.join(P, '.claude', 'agents', 'executor-haiku.md'), 'utf8')), '');
caso('--projeto não grava na pasta pessoal', !fs.existsSync(path.join(h, '.claude')), '');
const fotoP = fotografia(P);
r = instala(h, ['--projeto', P]);
caso('--projeto é idempotente', r.status === 0 && JSON.stringify(fotografia(P)) === JSON.stringify(fotoP), r.out);
const P2 = path.join(TMP, 'repo2'); fs.mkdirSync(P2);
r = instala(h, ['--projeto', P2, '--definir-modelo']);
caso('--projeto --definir-modelo grava sonnet', r.status === 0 && lerJson(path.join(P2, '.claude', 'settings.json')).model === 'sonnet', r.out);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${total - falhas} OK, ${falhas} FALHOU, ${total} casos.`);
process.exit(falhas ? 1 : 0);
