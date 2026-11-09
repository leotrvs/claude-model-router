#!/usr/bin/env node
// PreToolUse for the smaller executors. Usage: node block-sensitive.js <haiku|sonnet>
// Blocks writes to sensitive paths and classifies migrations by the content of the SQL.
// WARNING: this is a convenience barrier against model mistakes, not a security barrier.
// The executor has Bash and can write files without going through Edit/Write.
const fs = require('fs'), path = require('path');
const LEVELS = { 'executor-haiku': 'haiku', 'executor-sonnet': 'sonnet' };
const WRITE = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const MAX_BYTES = 200 * 1024;

// Messages. The language comes from model-router.lang next to this file; English if missing or invalid.
// Only the text changes with the language: the decisions and exit codes are the same.
const MESSAGES = {
  en: {
    invalidJson: 'Blocked: the block-sensitive.js hook received input that is not valid JSON. Return STATUS: BLOCKED.',
    block: (reason, target, dest) => `Blocked (${reason}): ${target}. Return STATUS: BLOCKED to escalate to ${dest}.`,
    noPath: '(no path)',
    writeWithoutPath: 'write without tool_input.file_path',
    migrationNeedsSonnet: 'migration requires at least Sonnet',
    migrationTooLarge: 'migration over 200 KB, too large for automatic analysis',
    sensitiveMigration: (reason) => `sensitive migration: ${reason}`,
    sensitivePath: 'security or payment path',
    sql: {
      dropsObject: 'removes an existing object',
      deletesData: 'deletes data',
      changesData: 'changes existing data',
      changesColumn: 'changes an existing column',
      changesPermissions: 'changes permissions',
      changesRoles: 'changes roles and permissions',
      securityDefiner: 'function with elevated privilege',
      disablesRls: 'disables RLS',
      openPolicy: 'open policy',
      authSchema: 'touches the auth schema',
      rlsOnExisting: (t) => `RLS on an existing table (${t})`,
      policyOnExisting: (t) => `policy on an existing table (${t})`,
      financial: 'involves financial data',
    },
  },
  'pt-BR': {
    invalidJson: 'Bloqueado: o hook block-sensitive.js recebeu uma entrada que não é JSON válido. Devolva STATUS: BLOQUEADO.',
    block: (reason, target, dest) => `Bloqueado (${reason}): ${target}. Devolva STATUS: BLOQUEADO para subir ao ${dest}.`,
    noPath: '(sem caminho)',
    writeWithoutPath: 'gravação sem tool_input.file_path',
    migrationNeedsSonnet: 'migration exige pelo menos Sonnet',
    migrationTooLarge: 'migration acima de 200 KB, grande demais para a análise automática',
    sensitiveMigration: (reason) => `migration sensível: ${reason}`,
    sensitivePath: 'caminho de segurança ou pagamento',
    sql: {
      dropsObject: 'remove objeto existente',
      deletesData: 'apaga dados',
      changesData: 'altera dados existentes',
      changesColumn: 'altera coluna existente',
      changesPermissions: 'muda permissões',
      changesRoles: 'muda papéis e permissões',
      securityDefiner: 'função com privilégio elevado',
      disablesRls: 'desliga RLS',
      openPolicy: 'política aberta',
      authSchema: 'mexe no schema auth',
      rlsOnExisting: (t) => `RLS em tabela existente (${t})`,
      policyOnExisting: (t) => `política em tabela existente (${t})`,
      financial: 'envolve dados financeiros',
    },
  },
};
let lang = 'en';
try {
  const l = fs.readFileSync(path.join(__dirname, 'model-router.lang'), 'utf8').replace(/^﻿/, '').trim();
  if (l === 'en' || l === 'pt-BR') lang = l;
} catch { /* missing file: English */ }
const M = MESSAGES[lang];

// Terms searched only in the part of the path relative to the project (already lowercase).
const PATH_RULES = [
  /auth(?!or)|login|senha|password|secret|credential|\.env|payment|pagament|checkout|billing|cobranc|fatura|invoice|assinatura|subscription|webhook|stripe|mercadopago|saldo|wallet|carteira|comiss|commission|caixa/,
  /jwt|token|session|middleware|permission|id_rsa|\.(pem|key)(\/|$)/,
  /(^|[^a-z0-9])rls([^a-z0-9]|$)/, // rls as a word: does not match urls.ts
];
const FINANCIAL = /payment|pagament|checkout|billing|cobranc|fatura|invoice|subscription|assinatura|saldo|balance|wallet|carteira|comiss|commission|caixa|withdraw|saque|deposit|refund|reembols/;
const FINANCIAL_PART = /(^|_)(orders|pix)(_|$)/;

// Slashes, NTFS streams (x::$DATA, x:stream), trailing dots and spaces, `..` and uppercase.
function normalize(p) {
  let s = String(p).replace(/\\/g, '/').replace(/^\/\/[?.]\//, '').toLowerCase();
  if (process.platform === 'win32') s = s.replace(/^\/([a-z])(?=\/|$)/, '$1:'); // /c/dev from Git Bash
  const m = /^([a-z]:)?(.*)$/s.exec(s);
  const rest = m[2].split('/').map((x) => (x === '.' || x === '..' ? x : x.replace(/:.*$/s, '').replace(/[. ]+$/, ''))).join('/');
  return (m[1] || '') + path.posix.normalize(rest || '.');
}
const isAbsolute = (p) => /^([a-z]:|[\\/])/i.test(String(p));

// Part relative to the project base. A relative path starts from the session cwd, which may be a
// subfolder of the base (src/auth): the part then includes the subfolder. Outside the base, returns the whole path.
function relative(target, base, cwd) {
  const b = normalize(base).replace(/\/+$/, '');
  const a = normalize(isAbsolute(target) ? target : cwd + '/' + target);
  if (a === b) return '';
  return a.startsWith(b + '/') ? a.slice(b.length + 1) : a;
}

// Replaces comments with a space. Strings, quoted identifiers and $$...$$ bodies stay intact.
function withoutComments(sql) {
  const out = []; let k = 0, start = 0;
  const n = sql.length;
  while (k < n) {
    const c = sql[k], d = sql[k + 1];
    if ((c === '-' && d === '-') || (c === '/' && d === '*')) {
      out.push(sql.slice(start, k), ' ');
      const f = c === '-' ? sql.indexOf('\n', k) : sql.indexOf('*/', k + 2);
      k = start = f < 0 ? n : c === '-' ? f : f + 2;
    } else if (c === "'" || c === '"') {
      const esc = c === "'" && /e/i.test(sql[k - 1] || '') && !/[\w$]/.test(sql[k - 2] || '');
      for (k++; k < n; k++) {
        if (esc && sql[k] === '\\') k++;
        else if (sql[k] === c) { if (sql[k + 1] === c) k++; else break; }
      }
      k++;
    } else if (c === '$' && !/[\w$]/.test(sql[k - 1] || '')) {
      const tag = /^\$(?:[a-z_]\w*)?\$/i.exec(sql.slice(k, k + 65));
      if (!tag) { k++; continue; }
      const f = sql.indexOf(tag[0], k + tag[0].length);
      k = f < 0 ? n : f + tag[0].length;
    } else k++;
  }
  out.push(sql.slice(start));
  return out.join('');
}

// Identifiers with bounded length, so no rule becomes quadratic.
const ID = '(?:"[^"]{1,255}"|[a-z_][\\w$]*)';
const NAME = `${ID}(?: ?\\. ?${ID}){0,2}`;
const AUTH = '(?:"auth"|\\bauth) ?\\. ?';
const SQL_RULES = [
  [/\bdrop (?:table|column|schema|type|policy|function|procedure|trigger|view|materialized view|database|constraint|role|user|owned)\b/, 'dropsObject'],
  [/\btruncate\b/, 'deletesData'],
  [/\bdelete from\b/, 'deletesData'],
  [new RegExp(`\\bupdate (?:only )?${NAME} ?\\*?(?: (?:as )?${ID})? set\\b`), 'changesData'],
  [/\bdo update set\b|\bmerge into\b/, 'changesData'],
  [new RegExp(`\\balter (?:column )?${ID} (?:(?:set data )?type|set not null)\\b`), 'changesColumn'],
  [/\b(?:grant|revoke)\b|\bowner to\b/, 'changesPermissions'],
  [/\b(?:create|alter|drop) (?:role|user|group)\b|\b(?:bypassrls|superuser)\b/, 'changesRoles'],
  [/\bsecurity definer\b/, 'securityDefiner'],
  [/\bdisable row level security\b/, 'disablesRls'],
  [/\b(?:using|with check) ?\(+ ?(?:true|1 ?= ?1) ?\)/, 'openPolicy'],
  [new RegExp(`\\b(?:function|procedure) (?:if exists )?${AUTH}`), 'authSchema'],
];
const AUTH_REF = new RegExp(`(?<!references )${AUTH}(${ID})( ?\\()?`, 'g');
const AUTH_FUNCTIONS = /^(uid|jwt|role|email)$/; // auth.uid() in a policy is normal use
const POLICY = new RegExp(`\\b(?:create|alter) policy ${ID} on (${NAME})`, 'g');
const ALTER_TABLE = new RegExp(`\\balter table (?:if exists )?(?:only )?(${NAME})`);
const CREATE_TABLE = new RegExp(`\\bcreate (?:(?:global |local )?(?:temp|temporary|unlogged) )?table (?:if not exists )?(${NAME})`, 'g');

// schema.table without quotes; without a schema, public.
const table = (q) => { const p = q.split(/ ?\. ?/).map((x) => x.replace(/"/g, '')); return (p.length > 1 ? p.slice(-2) : ['public', p[0]]).join('.'); };

function sensitiveInSql(sql) {
  const s = withoutComments(sql).toLowerCase().replace(/\s+/g, ' ');
  const created = new Set([...s.matchAll(CREATE_TABLE)].map((m) => table(m[1])));
  // Per-statement analysis: each part between `;` is tested on its own.
  for (const st of s.split(';')) {
    for (const [re, reason] of SQL_RULES) if (re.test(st)) return M.sql[reason];
    const at = ALTER_TABLE.exec(st);
    if (at && /\bdrop (?!default\b|not null\b)/.test(st)) return M.sql.dropsObject;
    if (at && /\b(?:enable|force) row level security\b/.test(st) && !created.has(table(at[1]))) return M.sql.rlsOnExisting(table(at[1]));
    for (const m of st.matchAll(POLICY)) if (!created.has(table(m[1]))) return M.sql.policyOnExisting(table(m[1]));
    for (const m of st.matchAll(AUTH_REF)) if (!(m[2] && AUTH_FUNCTIONS.test(m[1].replace(/"/g, '')))) return M.sql.authSchema;
  }
  for (const tk of s.match(/[a-z0-9_$]+/g) || []) if (FINANCIAL.test(tk) || FINANCIAL_PART.test(tk)) return M.sql.financial;
  return null;
}

let t = '';
process.stdin.on('data', (d) => (t += d)).on('end', () => {
  // Fail-closed: Claude Code always sends JSON. Input that is not JSON means a failure, and letting it
  // through would allow everything. So it blocks instead of exiting with 0.
  let e;
  try { e = JSON.parse(t); } catch { e = null; }
  if (!e || typeof e !== 'object') {
    console.error(M.invalidJson);
    process.exit(2);
  }
  // The level comes from agent_type when present; otherwise, from the frontmatter argument.
  const level = LEVELS[e.agent_type] || process.argv[2] || 'sonnet';
  const i = e.tool_input && typeof e.tool_input === 'object' ? e.tool_input : {};
  const target = String(i.file_path || i.path || i.notebook_path || '');
  const block = (reason, dest) => {
    console.error(M.block(reason, target || M.noPath, dest));
    process.exit(2);
  };
  if (!target) {
    // A write without a path cannot be classified: block instead of letting it through.
    if ((WRITE.test(e.tool_name || '') || !e.tool_name) && LEVELS['executor-' + level]) block(M.writeWithoutPath, 'executor-opus');
    process.exit(0);
  }
  // The base comes from CLAUDE_PROJECT_DIR; without it, from the cwd. So a cd into a subfolder does not shorten the tested part.
  const cwd = e.cwd || process.cwd();
  const base = process.env.CLAUDE_PROJECT_DIR || cwd;
  const rel = relative(target, base, cwd);
  if (/\.sql$/.test(rel)) {
    if (level === 'haiku') block(M.migrationNeedsSonnet, 'executor-sonnet');
    const file = path.resolve(cwd, target);
    let current = ''; try { current = fs.readFileSync(file, 'utf8'); } catch {}
    const added = [i.content, i.new_string, i.new_source, ...(Array.isArray(i.edits) ? i.edits.map((x) => x && x.new_string) : [])]
      .filter((x) => typeof x === 'string').join('\n');
    const sql = current + '\n' + added;
    if (Buffer.byteLength(sql) > MAX_BYTES) block(M.migrationTooLarge, 'executor-opus');
    const reason = sensitiveInSql(sql);
    if (reason) block(M.sensitiveMigration(reason), 'executor-opus');
    process.exit(0);
  }
  if (PATH_RULES.some((re) => re.test(rel))) block(M.sensitivePath, 'executor-opus');
  process.exit(0);
});
