#!/usr/bin/env node
// Instala ou atualiza a skill claude-model-router.
//   node instalar.js [--sem-modelo]                                     instala em ~/.claude (este computador)
//   node instalar.js --projeto <pasta> [--definir-modelo|--sem-modelo]  instala dentro de um repositório, para sessões na nuvem
// O modo --projeto só grava arquivos na pasta indicada. Commit e push ficam por sua conta.
// Tudo é lido e validado antes da primeira gravação: se algo falhar, nada é alterado.
const fs = require('fs'), os = require('os'), path = require('path');
const A = __dirname;
const SKILL = 'claude-model-router';
const AGENTES = ['haiku', 'sonnet', 'opus'].map((m) => `executor-${m}.md`);
const HOOKS = ['bloquear-interface.js', 'bloquear-sensivel.js', 'registrar-delegacao.js'];
const BACKUP = '.antes-claude-model-router';
const USO = 'Uso: node instalar.js [--sem-modelo]\n     node instalar.js --projeto <pasta> [--definir-modelo | --sem-modelo]';
const aborta = (msg, uso) => { console.error(msg + (uso ? '\n' + USO : '') + '\nNada foi alterado.'); process.exit(1); };

// Argumentos: qualquer coisa desconhecida aborta, para um erro de digitação não instalar no lugar errado.
let projeto = null, semModelo = false, definirModelo = false;
const args = process.argv.slice(2);
for (let k = 0; k < args.length; k++) {
  const a = args[k];
  if (a === '--projeto') {
    projeto = args[++k];
    if (!projeto || projeto.startsWith('--')) aborta('Informe a pasta depois de --projeto.', true);
  } else if (a === '--sem-modelo') semModelo = true;
  else if (a === '--definir-modelo') definirModelo = true;
  else aborta(`Argumento desconhecido: ${a}`, true);
}
if (semModelo && definirModelo) aborta('Use --sem-modelo ou --definir-modelo, não os dois.', true);
if (definirModelo && !projeto) aborta('--definir-modelo só vale com --projeto.', true);

const igual = (a, b) => {
  const n = (p) => { const r = path.resolve(p); return r.length > path.parse(r).root.length ? r.replace(/[\\/]+$/, '') : r; };
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};
const proibida = (p) => (igual(p, os.homedir()) ? 'a pasta pessoal do usuário' : igual(p, path.parse(path.resolve(p)).root) ? 'a raiz do disco' : null);
let P = null;
if (projeto) {
  P = path.resolve(projeto);
  let motivo = proibida(P);
  if (!motivo && !fs.statSync(P, { throwIfNoEntry: false })?.isDirectory()) aborta(`Pasta não encontrada: ${P}`, true);
  motivo ||= proibida(fs.realpathSync(P));
  if (motivo) aborta(`--projeto não pode apontar para ${motivo} (${P}). Use a pasta do repositório.`, true);
}

const le = (f) => { try { return fs.readFileSync(path.join(A, f), 'utf8'); } catch (e) { aborta(`Arquivo da skill ausente: ${f} (${e.code}).`); } };
const RAIZ = P ? path.join(P, '.claude') : path.join(os.homedir(), '.claude');
const CM = P ? path.join(P, 'CLAUDE.md') : path.join(RAIZ, 'CLAUDE.md');
const SP = path.join(RAIZ, 'settings.json');
const avisos = [];

// 1. Validação: settings.json precisa ser JSON válido e CLAUDE.md precisa ser legível.
let settings = {}, settingsTexto = null;
if (fs.existsSync(SP)) {
  try { settingsTexto = fs.readFileSync(SP, 'utf8'); settings = JSON.parse(settingsTexto.replace(/^﻿/, '')); } catch (e) {
    aborta(`${SP} não é um JSON válido (${e.message}). Corrija o arquivo e rode de novo.`);
  }
  const objeto = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!objeto(settings)) aborta(`${SP} precisa ser um objeto JSON.`);
  if (settings.hooks !== undefined && !objeto(settings.hooks)) aborta(`${SP}: "hooks" precisa ser um objeto.`);
  for (const ev of ['PreToolUse', 'SubagentStop'])
    if (settings.hooks?.[ev] !== undefined && !Array.isArray(settings.hooks[ev])) aborta(`${SP}: "hooks.${ev}" precisa ser uma lista.`);
}
let claude = null;
if (fs.existsSync(CM)) {
  try { claude = fs.readFileSync(CM, 'utf8'); } catch (e) { aborta(`Não consegui ler ${CM} (${e.code || e.message}).`); }
}
const INICIO = /<!-- (?:delegar|claude-model-router):inicio -->/g, FIM = /<!-- (?:delegar|claude-model-router):fim -->/g;
const BLOCO = /<!-- (?:delegar|claude-model-router):inicio -->[\s\S]*?<!-- (?:delegar|claude-model-router):fim -->/;
const nInicio = (claude || '').match(INICIO)?.length || 0, nFim = (claude || '').match(FIM)?.length || 0;
if (nInicio !== nFim || nInicio > 1 || (nInicio && !BLOCO.test(claude)))
  aborta(`${CM} tem marcadores claude-model-router desencontrados ou repetidos. Deixe um só bloco entre inicio e fim e rode de novo.`);
const regra = le('regra-CLAUDE.md').trim();
if (!/^<!-- claude-model-router:inicio -->/.test(regra) || !/<!-- claude-model-router:fim -->$/.test(regra))
  aborta('regra-CLAUDE.md precisa começar e terminar com os marcadores claude-model-router.');

// 2. Plano: tudo é montado em memória antes de gravar.
const arquivos = []; // [destino, conteudo]
if (P) {
  // Sessões na nuvem não têm ~/.claude e a máquina é descartável, então não há registro.
  const sk = le('skill/SKILL.md').replace(/## 6\. Registro[\s\S]*?(?=## Regras)/, '').replace(' e registre `REPROVADO`', '');
  arquivos.push([path.join(RAIZ, 'skills', SKILL, 'SKILL.md'), sk]);
  // Hook no frontmatter de agente do projeto não rodou nos testes; o bloqueio fica no settings.json.
  for (const f of AGENTES) arquivos.push([path.join(RAIZ, 'agents', f), le('agents/' + f).replace(/^hooks:\r?\n(?:[ \t]+.*\r?\n)+/m, '')]);
  for (const f of ['bloquear-interface.js', 'bloquear-sensivel.js', 'portao-projeto.js']) arquivos.push([path.join(RAIZ, 'hooks', f), le('hooks/' + f)]);
} else {
  for (const f of ['SKILL.md', 'registrar.js']) arquivos.push([path.join(RAIZ, 'skills', SKILL, f), le('skill/' + f)]);
  for (const f of AGENTES) arquivos.push([path.join(RAIZ, 'agents', f), le('agents/' + f)]);
  for (const f of HOOKS) arquivos.push([path.join(RAIZ, 'hooks', f), le('hooks/' + f)]);
}

// CLAUDE.md: só o bloco entre marcadores é substituído; o resto do arquivo fica como está.
let c = claude || '';
if (nInicio) c = c.replace(BLOCO, () => regra);
else {
  if (/^# Economia de modelos\s*$/m.test(c)) avisos.push(`${CM} já tinha uma seção "# Economia de modelos" sem marcadores. Ela foi mantida e o bloco novo foi acrescentado no fim; apague a seção antiga se quiser.`);
  c = (c.trimEnd() + '\n\n' + regra).trimStart();
}
arquivos.push([CM, c.trimEnd() + '\n']);

// settings.json: model só é definido se ainda não existir.
const s = settings;
const defineModelo = () => {
  if (s.model == null) s.model = 'sonnet';
  else if (s.model !== 'sonnet') avisos.push(`${SP} já tem "model": "${s.model}". Foi mantido; o padrão recomendado é sonnet.`);
};
if (P) {
  avisos.push('No modo --projeto, o "model" do .claude/settings.json vale para todo o time que abrir o repositório.');
  if (definirModelo) defineModelo();
  else avisos.push('"model" não foi definido. Rode com --definir-modelo se o time concordar com sonnet como padrão.');
} else if (!semModelo) defineModelo();
s.hooks ??= {};
const evento = P ? 'PreToolUse' : 'SubagentStop';
const nome = P ? /portao-projeto/ : /registrar-delegacao/;
s.hooks[evento] = (s.hooks[evento] ?? []).filter((e) => !(e?.hooks || []).some((h) => nome.test(h?.command || '')));
s.hooks[evento].push(P
  ? { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/portao-projeto.js"', timeout: 10 }] }
  : { matcher: '', hooks: [{ type: 'command', command: 'node "$HOME/.claude/hooks/registrar-delegacao.js"', timeout: 5 }] });
arquivos.push([SP, JSON.stringify(s, null, 2) + '\n']);

// Backups só do original: nunca sobrescreve e não copia um arquivo que já tem a instalação.
const backups = [];
if (settingsTexto !== null && !fs.existsSync(SP + BACKUP) && !/registrar-delegacao|portao-projeto/.test(settingsTexto)) backups.push(SP);
if (claude !== null && !fs.existsSync(CM + BACKUP) && !nInicio) backups.push(CM);

// Cópia com o nome antigo: só remove se for mesmo a versão antiga desta skill.
let antiga = path.join(RAIZ, 'skills', 'delegar');
if (fs.existsSync(antiga)) {
  let sk = ''; try { sk = fs.readFileSync(path.join(antiga, 'SKILL.md'), 'utf8'); } catch {}
  if (!(/^name:\s*delegar\s*$/m.test(sk) && sk.includes('Escolha o modelo mais barato capaz'))) {
    avisos.push(`${antiga} existe, mas não parece a versão antiga desta skill. Não foi removida; confira e apague à mão se for o caso.`);
    antiga = null;
  }
} else antiga = null;

// 3. Gravação.
const criados = [], atualizados = [];
for (const f of backups) fs.copyFileSync(f, f + BACKUP, fs.constants.COPYFILE_EXCL);
if (antiga) fs.rmSync(antiga, { recursive: true, force: true });
for (const [destino, conteudo] of arquivos) {
  const antes = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : null;
  if (antes === conteudo) continue;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo);
  (antes === null ? criados : atualizados).push(destino);
}

// 4. Relatório: o que mudou e como desfazer.
const lista = (titulo, l) => l.length && console.log(titulo + '\n' + l.map((f) => '  ' + f).join('\n'));
if (!criados.length && !atualizados.length && !antiga && !backups.length) console.log('Nada mudou: a instalação já estava atualizada.');
lista('Criados:', criados);
lista('Atualizados:', atualizados);
lista('Backups do original:', backups.map((f) => f + BACKUP));
lista('Removido (versão antiga da skill):', antiga ? [antiga] : []);
lista('Avisos:', avisos);
console.log([
  'Para desfazer:',
  `  - apague ${path.join(RAIZ, 'skills', SKILL)}, os agents/executor-*.md e os hooks copiados para ${path.join(RAIZ, 'hooks')}`,
  `  - em ${CM}, apague o bloco entre <!-- claude-model-router:inicio --> e <!-- claude-model-router:fim --> (ou restaure CLAUDE.md${BACKUP}, se existir)`,
  `  - restaure ${path.basename(SP) + BACKUP} sobre ${path.basename(SP)}, se existir; senão, tire do settings.json o hook ${P ? 'portao-projeto' : 'registrar-delegacao'} e o "model", se foi definido aqui`,
  '  - arquivos listados em "Criados" que não existiam antes podem ser apagados',
].join('\n'));
console.log(P ? 'Pronto. Faça commit de .claude/ e CLAUDE.md para usar na nuvem.' : 'Pronto. Abra uma sessão nova para carregar.');
