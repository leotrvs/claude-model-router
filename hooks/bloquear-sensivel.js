#!/usr/bin/env node
// PreToolUse dos executores menores. Uso: node bloquear-sensivel.js <haiku|sonnet>
// Bloqueia gravação em caminhos sensíveis e classifica migrations pelo conteúdo do SQL.
// AVISO: é uma barreira de conveniência contra erro do modelo, não uma barreira de segurança.
// O executor tem Bash e pode gravar arquivos sem passar por Edit/Write.
const fs = require('fs'), path = require('path');
const NIVEIS = { 'executor-haiku': 'haiku', 'executor-sonnet': 'sonnet' };
const ESCRITA = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const LIMITE = 200 * 1024;

// Termos procurados só no trecho do caminho relativo ao projeto (já em minúsculas).
const CAMINHO = [
  /auth(?!or)|login|senha|password|secret|credential|\.env|payment|pagament|checkout|billing|cobranc|fatura|invoice|assinatura|subscription|webhook|stripe|mercadopago|saldo|wallet|carteira|comiss|commission|caixa/,
  /jwt|token|session|middleware|permission|id_rsa|\.(pem|key)(\/|$)/,
  /(^|[^a-z0-9])rls([^a-z0-9]|$)/, // rls como palavra: não pega urls.ts
];
const FINANCEIRO = /payment|pagament|checkout|billing|cobranc|fatura|invoice|subscription|assinatura|saldo|balance|wallet|carteira|comiss|commission|caixa|withdraw|saque|deposit|refund|reembols/;
const FINANCEIRO_PARTE = /(^|_)(orders|pix)(_|$)/;

// Barras, fluxo NTFS (x::$DATA, x:fluxo), pontos e espaços finais, `..` e maiúsculas.
function normaliza(p) {
  let s = String(p).replace(/\\/g, '/').replace(/^\/\/[?.]\//, '').toLowerCase();
  if (process.platform === 'win32') s = s.replace(/^\/([a-z])(?=\/|$)/, '$1:'); // /c/dev do Git Bash
  const m = /^([a-z]:)?(.*)$/s.exec(s);
  const resto = m[2].split('/').map((x) => (x === '.' || x === '..' ? x : x.replace(/:.*$/s, '').replace(/[. ]+$/, ''))).join('/');
  return (m[1] || '') + path.posix.normalize(resto || '.');
}
const absoluto = (p) => /^([a-z]:|[\\/])/i.test(String(p));

// Trecho relativo à base do projeto. Caminho relativo parte do cwd da sessão, que pode ser uma
// subpasta da base (src/auth): o trecho então inclui a subpasta. Fora da base, devolve o caminho inteiro.
function relativo(alvo, base, cwd) {
  const b = normaliza(base).replace(/\/+$/, '');
  const a = normaliza(absoluto(alvo) ? alvo : cwd + '/' + alvo);
  if (a === b) return '';
  return a.startsWith(b + '/') ? a.slice(b.length + 1) : a;
}

// Troca comentários por espaço. Strings, identificadores entre aspas e corpos $$...$$ ficam intactos.
function semComentarios(sql) {
  const out = []; let k = 0, ini = 0;
  const n = sql.length;
  while (k < n) {
    const c = sql[k], d = sql[k + 1];
    if ((c === '-' && d === '-') || (c === '/' && d === '*')) {
      out.push(sql.slice(ini, k), ' ');
      const f = c === '-' ? sql.indexOf('\n', k) : sql.indexOf('*/', k + 2);
      k = ini = f < 0 ? n : c === '-' ? f : f + 2;
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
  out.push(sql.slice(ini));
  return out.join('');
}

// Identificadores com tamanho limitado, para nenhuma regra ficar quadrática.
const ID = '(?:"[^"]{1,255}"|[a-z_][\\w$]*)';
const NOME = `${ID}(?: ?\\. ?${ID}){0,2}`;
const AUTH = '(?:"auth"|\\bauth) ?\\. ?';
const REGRAS = [
  [/\bdrop (?:table|column|schema|type|policy|function|procedure|trigger|view|materialized view|database|constraint|role|user|owned)\b/, 'remove objeto existente'],
  [/\btruncate\b/, 'apaga dados'],
  [/\bdelete from\b/, 'apaga dados'],
  [new RegExp(`\\bupdate (?:only )?${NOME} ?\\*?(?: (?:as )?${ID})? set\\b`), 'altera dados existentes'],
  [/\bdo update set\b|\bmerge into\b/, 'altera dados existentes'],
  [new RegExp(`\\balter (?:column )?${ID} (?:(?:set data )?type|set not null)\\b`), 'altera coluna existente'],
  [/\b(?:grant|revoke)\b|\bowner to\b/, 'muda permissões'],
  [/\b(?:create|alter|drop) (?:role|user|group)\b|\b(?:bypassrls|superuser)\b/, 'muda papéis e permissões'],
  [/\bsecurity definer\b/, 'função com privilégio elevado'],
  [/\bdisable row level security\b/, 'desliga RLS'],
  [/\b(?:using|with check) ?\(+ ?(?:true|1 ?= ?1) ?\)/, 'política aberta'],
  [new RegExp(`\\b(?:function|procedure) (?:if exists )?${AUTH}`), 'mexe no schema auth'],
];
const REF_AUTH = new RegExp(`(?<!references )${AUTH}(${ID})( ?\\()?`, 'g');
const FUNCOES_AUTH = /^(uid|jwt|role|email)$/; // auth.uid() em política é uso normal
const POLITICA = new RegExp(`\\b(?:create|alter) policy ${ID} on (${NOME})`, 'g');
const ALTERA_TABELA = new RegExp(`\\balter table (?:if exists )?(?:only )?(${NOME})`);
const CRIA_TABELA = new RegExp(`\\bcreate (?:(?:global |local )?(?:temp|temporary|unlogged) )?table (?:if not exists )?(${NOME})`, 'g');

// schema.tabela sem aspas; sem schema vale public.
const tabela = (q) => { const p = q.split(/ ?\. ?/).map((x) => x.replace(/"/g, '')); return (p.length > 1 ? p.slice(-2) : ['public', p[0]]).join('.'); };

function sensivelNoSql(sql) {
  const s = semComentarios(sql).toLowerCase().replace(/\s+/g, ' ');
  const criadas = new Set([...s.matchAll(CRIA_TABELA)].map((m) => tabela(m[1])));
  // Análise por instrução: cada trecho entre `;` é testado sozinho.
  for (const st of s.split(';')) {
    for (const [re, motivo] of REGRAS) if (re.test(st)) return motivo;
    const at = ALTERA_TABELA.exec(st);
    if (at && /\bdrop (?!default\b|not null\b)/.test(st)) return 'remove objeto existente';
    if (at && /\b(?:enable|force) row level security\b/.test(st) && !criadas.has(tabela(at[1]))) return `RLS em tabela existente (${tabela(at[1])})`;
    for (const m of st.matchAll(POLITICA)) if (!criadas.has(tabela(m[1]))) return `política em tabela existente (${tabela(m[1])})`;
    for (const m of st.matchAll(REF_AUTH)) if (!(m[2] && FUNCOES_AUTH.test(m[1].replace(/"/g, '')))) return 'mexe no schema auth';
  }
  for (const tk of s.match(/[a-z0-9_$]+/g) || []) if (FINANCEIRO.test(tk) || FINANCEIRO_PARTE.test(tk)) return 'envolve dados financeiros';
  return null;
}

let t = '';
process.stdin.on('data', (d) => (t += d)).on('end', () => {
  // Fail-closed: o Claude Code sempre manda JSON. Entrada que não é JSON indica falha, e passar
  // direto liberaria tudo. Por isso bloqueia em vez de sair com 0.
  let e;
  try { e = JSON.parse(t); } catch { e = null; }
  if (!e || typeof e !== 'object') {
    console.error('Bloqueado: o hook bloquear-sensivel.js recebeu uma entrada que não é JSON válido. Devolva STATUS: BLOQUEADO.');
    process.exit(2);
  }
  // O nível vem do agent_type quando ele existe; senão, do argumento do frontmatter.
  const nivel = NIVEIS[e.agent_type] || process.argv[2] || 'sonnet';
  const i = e.tool_input && typeof e.tool_input === 'object' ? e.tool_input : {};
  const alvo = String(i.file_path || i.path || i.notebook_path || '');
  const bloqueia = (motivo, destino) => {
    console.error(`Bloqueado (${motivo}): ${alvo || '(sem caminho)'}. Devolva STATUS: BLOQUEADO para subir ao ${destino}.`);
    process.exit(2);
  };
  if (!alvo) {
    // Gravação sem caminho não dá para classificar: bloqueia em vez de deixar passar.
    if ((ESCRITA.test(e.tool_name || '') || !e.tool_name) && NIVEIS['executor-' + nivel]) bloqueia('gravação sem tool_input.file_path', 'executor-opus');
    process.exit(0);
  }
  // A raiz vem de CLAUDE_PROJECT_DIR; sem ela, do cwd. Assim um cd para subpasta não encurta o trecho testado.
  const cwd = e.cwd || process.cwd();
  const base = process.env.CLAUDE_PROJECT_DIR || cwd;
  const rel = relativo(alvo, base, cwd);
  if (/\.sql$/.test(rel)) {
    if (nivel === 'haiku') bloqueia('migration exige pelo menos Sonnet', 'executor-sonnet');
    const arq = path.resolve(cwd, alvo);
    let atual = ''; try { atual = fs.readFileSync(arq, 'utf8'); } catch {}
    const novo = [i.content, i.new_string, i.new_source, ...(Array.isArray(i.edits) ? i.edits.map((x) => x && x.new_string) : [])]
      .filter((x) => typeof x === 'string').join('\n');
    const sql = atual + '\n' + novo;
    if (Buffer.byteLength(sql) > LIMITE) bloqueia('migration acima de 200 KB, grande demais para a análise automática', 'executor-opus');
    const motivo = sensivelNoSql(sql);
    if (motivo) bloqueia(`migration sensível: ${motivo}`, 'executor-opus');
    process.exit(0);
  }
  if (CAMINHO.some((re) => re.test(rel))) bloqueia('caminho de segurança ou pagamento', 'executor-opus');
  process.exit(0);
});
