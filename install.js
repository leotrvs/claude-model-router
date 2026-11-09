#!/usr/bin/env node
// Installs or updates the claude-model-router skill.
//   node install.js [--lang en|pt-BR] [--no-model]                                  installs into ~/.claude (this computer)
//   node install.js --project <dir> [--lang en|pt-BR] [--set-model|--no-model]      installs inside a repository, for cloud sessions
// The old Portuguese flags still work: --projeto, --sem-modelo, --definir-modelo.
// --project mode only writes files inside the given folder. Commit and push are up to you.
// Everything is read and validated before the first write: if anything fails, nothing is changed.
const fs = require('fs'), os = require('os'), path = require('path');
const SRC = __dirname;
const SKILL = 'claude-model-router';
const LANGS = ['en', 'pt-BR'];
const LANG_FILE = 'model-router.lang';
const AGENTS = ['haiku', 'sonnet', 'opus'].map((m) => `executor-${m}.md`);
const BACKUP = '.before-claude-model-router';
// Names used by older versions, only to recognize and migrate an existing installation.
const OLD_BACKUPS = ['.antes-claude-model-router', '.antes-delegar'];
const OLD_HOOKS = ['bloquear-interface.js', 'bloquear-sensivel.js', 'registrar-delegacao.js', 'portao-projeto.js'];
const OLD_LOG_SCRIPT = 'registrar.js';
const OLD_LOG = 'delegacoes.jsonl', LOG = 'delegations.jsonl';
const OUR_HOOK_COMMAND = /registrar-delegacao|portao-projeto|log-delegation|project-gate/;

const MESSAGES = {
  en: {
    usage: 'Usage: node install.js [--lang en|pt-BR] [--no-model]\n       node install.js --project <dir> [--lang en|pt-BR] [--set-model | --no-model]',
    nothingChanged: 'Nothing was changed.',
    unknownArg: (a) => `Unknown argument: ${a}`,
    missingProject: (flag) => `Provide the folder after ${flag}.`,
    missingLang: 'Provide the language after --lang.',
    invalidLang: (l) => `Unknown language: ${l}. Use en or pt-BR.`,
    bothModel: 'Use --no-model or --set-model, not both.',
    setModelNeedsProject: '--set-model only works with --project.',
    homeFolder: "the user's home folder",
    diskRoot: 'the root of the disk',
    folderNotFound: (p) => `Folder not found: ${p}`,
    forbiddenProject: (reason, p) => `--project cannot point to ${reason} (${p}). Use the repository folder.`,
    missingFile: (f, code) => `Skill file missing: ${f} (${code}).`,
    invalidJson: (f, msg) => `${f} is not valid JSON (${msg}). Fix the file and run again.`,
    notObject: (f) => `${f} must be a JSON object.`,
    hooksNotObject: (f) => `${f}: "hooks" must be an object.`,
    eventNotList: (f, ev) => `${f}: "hooks.${ev}" must be a list.`,
    cannotRead: (f, code) => `Could not read ${f} (${code}).`,
    badMarkers: (f) => `${f} has mismatched or repeated claude-model-router markers. Leave a single block between start and end and run again.`,
    ruleMarkers: (f) => `${f} must start and end with the claude-model-router markers.`,
    localOnlyLeft: (f) => `${f} still has local-only content after cleanup for --project mode.`,
    invalidLangFile: (f) => `${f} has an unknown language and was ignored.`,
    oldSectionKept: (f, title) => `${f} already had a "# ${title}" section without markers. It was kept and the new block was added at the end; delete the old section if you want.`,
    modelKept: (f, m) => `${f} already has "model": "${m}". It was kept; the recommended default is sonnet.`,
    projectModelTeam: 'In --project mode, the "model" in .claude/settings.json applies to the whole team that opens the repository.',
    projectModelNotSet: '"model" was not set. Run with --set-model if the team agrees on sonnet as the default.',
    oldSkillNotOurs: (p) => `${p} exists, but does not look like the old version of this skill. It was not removed; check it and delete it by hand if that is the case.`,
    oldFileNotOurs: (p) => `${p} has an old name of this skill, but does not look like one of its files. It was not removed; check it and delete it by hand if that is the case.`,
    copiedFrom: (f) => `(copy of ${f}, which was kept)`,
    nothingNew: 'Nothing changed: the installation was already up to date.',
    created: 'Created:',
    updated: 'Updated:',
    backups: 'Backups of the original:',
    removed: 'Removed (old version of the skill):',
    warnings: 'Warnings:',
    undo: (r) => [
      'To undo:',
      `  - delete ${r.skillDir}, the agents/executor-*.md and the hooks and ${LANG_FILE} copied to ${r.hooksDir}`,
      `  - in ${r.claudeMd}, delete the block between <!-- claude-model-router:start --> and <!-- claude-model-router:end --> (or restore CLAUDE.md${r.claudeBackup}, if it exists)`,
      `  - restore ${r.settingsBackup} over ${r.settings}, if it exists; otherwise, remove the ${r.hook} hook from settings.json, and "model" if it was set here`,
      '  - files listed under "Created" that did not exist before can be deleted',
    ],
    doneProject: 'Done. Commit .claude/ and CLAUDE.md to use it in the cloud.',
    doneGlobal: 'Done. Open a new session to load it.',
  },
  'pt-BR': {
    usage: 'Uso: node install.js [--lang en|pt-BR] [--no-model]\n     node install.js --project <pasta> [--lang en|pt-BR] [--set-model | --no-model]',
    nothingChanged: 'Nada foi alterado.',
    unknownArg: (a) => `Argumento desconhecido: ${a}`,
    missingProject: (flag) => `Informe a pasta depois de ${flag}.`,
    missingLang: 'Informe o idioma depois de --lang.',
    invalidLang: (l) => `Idioma desconhecido: ${l}. Use en ou pt-BR.`,
    bothModel: 'Use --no-model ou --set-model, não os dois.',
    setModelNeedsProject: '--set-model só vale com --project.',
    homeFolder: 'a pasta pessoal do usuário',
    diskRoot: 'a raiz do disco',
    folderNotFound: (p) => `Pasta não encontrada: ${p}`,
    forbiddenProject: (reason, p) => `--project não pode apontar para ${reason} (${p}). Use a pasta do repositório.`,
    missingFile: (f, code) => `Arquivo da skill ausente: ${f} (${code}).`,
    invalidJson: (f, msg) => `${f} não é um JSON válido (${msg}). Corrija o arquivo e rode de novo.`,
    notObject: (f) => `${f} precisa ser um objeto JSON.`,
    hooksNotObject: (f) => `${f}: "hooks" precisa ser um objeto.`,
    eventNotList: (f, ev) => `${f}: "hooks.${ev}" precisa ser uma lista.`,
    cannotRead: (f, code) => `Não consegui ler ${f} (${code}).`,
    badMarkers: (f) => `${f} tem marcadores claude-model-router desencontrados ou repetidos. Deixe um só bloco entre start e end e rode de novo.`,
    ruleMarkers: (f) => `${f} precisa começar e terminar com os marcadores claude-model-router.`,
    localOnlyLeft: (f) => `${f} ainda tem conteúdo local-only depois da limpeza para o modo --project.`,
    invalidLangFile: (f) => `${f} tem um idioma desconhecido e foi ignorado.`,
    oldSectionKept: (f, title) => `${f} já tinha uma seção "# ${title}" sem marcadores. Ela foi mantida e o bloco novo foi acrescentado no fim; apague a seção antiga se quiser.`,
    modelKept: (f, m) => `${f} já tem "model": "${m}". Foi mantido; o padrão recomendado é sonnet.`,
    projectModelTeam: 'No modo --project, o "model" do .claude/settings.json vale para todo o time que abrir o repositório.',
    projectModelNotSet: '"model" não foi definido. Rode com --set-model se o time concordar com sonnet como padrão.',
    oldSkillNotOurs: (p) => `${p} existe, mas não parece a versão antiga desta skill. Não foi removida; confira e apague à mão se for o caso.`,
    oldFileNotOurs: (p) => `${p} tem um nome antigo desta skill, mas não parece um arquivo dela. Não foi removido; confira e apague à mão se for o caso.`,
    copiedFrom: (f) => `(cópia de ${f}, que foi mantido)`,
    nothingNew: 'Nada mudou: a instalação já estava atualizada.',
    created: 'Criados:',
    updated: 'Atualizados:',
    backups: 'Backups do original:',
    removed: 'Removidos (versão antiga da skill):',
    warnings: 'Avisos:',
    undo: (r) => [
      'Para desfazer:',
      `  - apague ${r.skillDir}, os agents/executor-*.md e os hooks e o ${LANG_FILE} copiados para ${r.hooksDir}`,
      `  - em ${r.claudeMd}, apague o bloco entre <!-- claude-model-router:start --> e <!-- claude-model-router:end --> (ou restaure CLAUDE.md${r.claudeBackup}, se existir)`,
      `  - restaure ${r.settingsBackup} sobre ${r.settings}, se existir; senão, tire do settings.json o hook ${r.hook} e o "model", se foi definido aqui`,
      '  - arquivos listados em "Criados" que não existiam antes podem ser apagados',
    ],
    doneProject: 'Pronto. Faça commit de .claude/ e CLAUDE.md para usar na nuvem.',
    doneGlobal: 'Pronto. Abra uma sessão nova para carregar.',
  },
};

// Arguments: anything unknown aborts, so a typo does not install in the wrong place.
// Until the language is known, messages use the --lang value if it is valid, or English.
const args = process.argv.slice(2);
const langPos = args.indexOf('--lang');
let M = MESSAGES[langPos >= 0 && LANGS.includes(args[langPos + 1]) ? args[langPos + 1] : 'en'];
const abort = (msg, usage) => { console.error(msg + (usage ? '\n' + M.usage : '') + '\n' + M.nothingChanged); process.exit(1); };
let project = null, noModel = false, setModel = false, langArg = null;
for (let k = 0; k < args.length; k++) {
  const a = args[k];
  if (a === '--project' || a === '--projeto') {
    project = args[++k];
    if (!project || project.startsWith('--')) abort(M.missingProject(a), true);
  } else if (a === '--lang') {
    langArg = args[++k];
    if (!langArg || langArg.startsWith('--')) abort(M.missingLang, true);
    if (!LANGS.includes(langArg)) abort(M.invalidLang(langArg), true);
  } else if (a === '--no-model' || a === '--sem-modelo') noModel = true;
  else if (a === '--set-model' || a === '--definir-modelo') setModel = true;
  else abort(M.unknownArg(a), true);
}
if (noModel && setModel) abort(M.bothModel, true);
if (setModel && !project) abort(M.setModelNeedsProject, true);

const same = (a, b) => {
  const n = (p) => { const r = path.resolve(p); return r.length > path.parse(r).root.length ? r.replace(/[\\/]+$/, '') : r; };
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};
const forbidden = (p) => (same(p, os.homedir()) ? M.homeFolder : same(p, path.parse(path.resolve(p)).root) ? M.diskRoot : null);
let P = null;
if (project) {
  P = path.resolve(project);
  let reason = forbidden(P);
  if (!reason && !fs.statSync(P, { throwIfNoEntry: false })?.isDirectory()) abort(M.folderNotFound(P), true);
  reason ||= forbidden(fs.realpathSync(P));
  if (reason) abort(M.forbiddenProject(reason, P), true);
}

const ROOT = P ? path.join(P, '.claude') : path.join(os.homedir(), '.claude');
const HOOKS_DIR = path.join(ROOT, 'hooks');
const SKILL_DIR = path.join(ROOT, 'skills', SKILL);
const CM = P ? path.join(P, 'CLAUDE.md') : path.join(ROOT, 'CLAUDE.md');
const SP = path.join(ROOT, 'settings.json');
const isFile = (f) => !!fs.statSync(f, { throwIfNoEntry: false })?.isFile();
const warnings = [];

// Language: --lang wins. On an update without --lang, the previous language is kept: it comes from
// model-router.lang; without that file, an installation with the old Portuguese names counts as pt-BR.
const OLD_START = /<!-- (?:delegar|claude-model-router):inicio -->/;
let lang = langArg, invalidLangFile = null;
if (!lang) {
  const lf = path.join(HOOKS_DIR, LANG_FILE);
  let saved = null;
  try { saved = fs.readFileSync(lf, 'utf8').replace(/^﻿/, '').trim(); } catch {}
  if (saved !== null && LANGS.includes(saved)) lang = saved;
  else {
    if (saved !== null) invalidLangFile = lf;
    let oldText = ''; try { oldText = fs.readFileSync(CM, 'utf8'); } catch {}
    lang = OLD_HOOKS.some((f) => fs.existsSync(path.join(HOOKS_DIR, f))) || OLD_START.test(oldText) ? 'pt-BR' : 'en';
  }
}
M = MESSAGES[lang];
if (invalidLangFile) warnings.push(M.invalidLangFile(invalidLangFile));
const read = (f) => { try { return fs.readFileSync(path.join(SRC, f), 'utf8'); } catch (e) { abort(M.missingFile(f, e.code)); } };
const LOCALE = `locales/${lang}/`;

// 1. Validation: settings.json must be valid JSON and CLAUDE.md must be readable.
let settings = {}, settingsText = null;
if (fs.existsSync(SP)) {
  try { settingsText = fs.readFileSync(SP, 'utf8'); settings = JSON.parse(settingsText.replace(/^﻿/, '')); } catch (e) {
    abort(M.invalidJson(SP, e.message));
  }
  const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(settings)) abort(M.notObject(SP));
  if (settings.hooks !== undefined && !isObject(settings.hooks)) abort(M.hooksNotObject(SP));
  for (const ev of ['PreToolUse', 'SubagentStop'])
    if (settings.hooks?.[ev] !== undefined && !Array.isArray(settings.hooks[ev])) abort(M.eventNotList(SP, ev));
}
let claude = null;
if (fs.existsSync(CM)) {
  try { claude = fs.readFileSync(CM, 'utf8'); } catch (e) { abort(M.cannotRead(CM, e.code || e.message)); }
}
// Current markers and the ones from older versions; any of them is replaced by the new block.
const START_SRC = '<!-- (?:delegar:inicio|claude-model-router:(?:inicio|start)) -->';
const END_SRC = '<!-- (?:delegar:fim|claude-model-router:(?:fim|end)) -->';
const START = new RegExp(START_SRC, 'g'), END = new RegExp(END_SRC, 'g');
const BLOCK = new RegExp(`${START_SRC}[\\s\\S]*?${END_SRC}`);
const nStart = (claude || '').match(START)?.length || 0, nEnd = (claude || '').match(END)?.length || 0;
if (nStart !== nEnd || nStart > 1 || (nStart && !BLOCK.test(claude))) abort(M.badMarkers(CM));
const rule = read(LOCALE + 'rule.md').trim();
if (!/^<!-- claude-model-router:start -->/.test(rule) || !/<!-- claude-model-router:end -->$/.test(rule)) abort(M.ruleMarkers(LOCALE + 'rule.md'));

// 2. Plan: everything is built in memory before writing.
const files = []; // [destination, content]
files.push([path.join(HOOKS_DIR, LANG_FILE), lang]);
if (P) {
  // Cloud sessions have no ~/.claude and the machine is disposable, so there is no log:
  // every local-only part of SKILL.md is removed.
  const sk = read(LOCALE + 'skill/SKILL.md').replace(/<!-- local-only:start -->[\s\S]*?<!-- local-only:end -->/g, '').replace(/\n{3,}/g, '\n\n');
  if (/local-only|log\.js/.test(sk)) abort(M.localOnlyLeft(LOCALE + 'skill/SKILL.md'));
  files.push([path.join(SKILL_DIR, 'SKILL.md'), sk]);
  // A hook in a project agent's frontmatter did not run in the tests; the block lives in settings.json.
  for (const f of AGENTS) files.push([path.join(ROOT, 'agents', f), read(LOCALE + 'agents/' + f).replace(/^hooks:\r?\n(?:[ \t]+.*\r?\n)+/m, '')]);
  for (const f of ['block-ui.js', 'block-sensitive.js', 'project-gate.js']) files.push([path.join(HOOKS_DIR, f), read('hooks/' + f)]);
} else {
  files.push([path.join(SKILL_DIR, 'SKILL.md'), read(LOCALE + 'skill/SKILL.md')]);
  files.push([path.join(SKILL_DIR, 'log.js'), read('skill/log.js')]);
  for (const f of AGENTS) files.push([path.join(ROOT, 'agents', f), read(LOCALE + 'agents/' + f)]);
  for (const f of ['block-ui.js', 'block-sensitive.js', 'log-delegation.js']) files.push([path.join(HOOKS_DIR, f), read('hooks/' + f)]);
}

// CLAUDE.md: only the block between markers is replaced; the rest of the file stays as it is.
let c = claude || '';
if (nStart) c = c.replace(BLOCK, () => rule);
else {
  const old = /^# (Economia de modelos|Model economy)\s*$/m.exec(c);
  if (old) warnings.push(M.oldSectionKept(CM, old[1]));
  c = (c.trimEnd() + '\n\n' + rule).trimStart();
}
files.push([CM, c.trimEnd() + '\n']);

// settings.json: model is only set if it does not exist yet.
const s = settings;
const setDefaultModel = () => {
  if (s.model == null) s.model = 'sonnet';
  else if (s.model !== 'sonnet') warnings.push(M.modelKept(SP, s.model));
};
if (P) {
  warnings.push(M.projectModelTeam);
  if (setModel) setDefaultModel();
  else warnings.push(M.projectModelNotSet);
} else if (!noModel) setDefaultModel();
s.hooks ??= {};
const event = P ? 'PreToolUse' : 'SubagentStop';
const hookName = P ? 'project-gate' : 'log-delegation';
// Entries of this skill, with the current or the old name, are replaced by a single new one.
const ours = P ? /portao-projeto|project-gate/ : /registrar-delegacao|log-delegation/;
s.hooks[event] = (s.hooks[event] ?? []).filter((e) => !(e?.hooks || []).some((h) => ours.test(h?.command || '')));
s.hooks[event].push(P
  ? { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/project-gate.js"', timeout: 10 }] }
  : { matcher: '', hooks: [{ type: 'command', command: 'node "$HOME/.claude/hooks/log-delegation.js"', timeout: 5 }] });
files.push([SP, JSON.stringify(s, null, 2) + '\n']);

// Backups only of the original: never overwrites, does not create a second one next to an older
// backup and does not copy a file that already has the installation.
const backupOf = (f) => [BACKUP, ...OLD_BACKUPS].find((x) => fs.existsSync(f + x));
const backups = [];
if (settingsText !== null && !backupOf(SP) && !OUR_HOOK_COMMAND.test(settingsText)) backups.push(SP);
if (claude !== null && !backupOf(CM) && !nStart) backups.push(CM);

// Copy with the oldest name: only removed if it really is the old version of this skill.
const removals = [];
const oldSkill = path.join(ROOT, 'skills', 'delegar');
if (fs.existsSync(oldSkill)) {
  let sk = ''; try { sk = fs.readFileSync(path.join(oldSkill, 'SKILL.md'), 'utf8'); } catch {}
  if (/^name:\s*delegar\s*$/m.test(sk) && sk.includes('Escolha o modelo mais barato capaz')) removals.push(oldSkill);
  else warnings.push(M.oldSkillNotOurs(oldSkill));
}
// Hooks with the old Portuguese names: only removed if the content looks like this skill.
for (const f of OLD_HOOKS) {
  const p = path.join(HOOKS_DIR, f);
  if (!fs.existsSync(p)) continue;
  let text = null; if (isFile(p)) try { text = fs.readFileSync(p, 'utf8'); } catch {}
  if (text !== null && /agent_type|STATUS|executor-/.test(text)) removals.push(p);
  else warnings.push(M.oldFileNotOurs(p));
}
// The old log script lives inside this skill's folder and was replaced by log.js.
const oldLogScript = path.join(SKILL_DIR, OLD_LOG_SCRIPT);
if (fs.existsSync(oldLogScript)) {
  if (isFile(oldLogScript)) removals.push(oldLogScript);
  else warnings.push(M.oldFileNotOurs(oldLogScript));
}
// The log changed names: the old file is copied (never moved) if the new one does not exist yet.
let logCopy = null;
if (!P && isFile(path.join(ROOT, OLD_LOG)) && !fs.existsSync(path.join(ROOT, LOG))) logCopy = [path.join(ROOT, OLD_LOG), path.join(ROOT, LOG)];

// 3. Writing.
const created = [], updated = [];
for (const f of backups) fs.copyFileSync(f, f + BACKUP, fs.constants.COPYFILE_EXCL);
for (const [dest, content] of files) {
  const before = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
  if (before === content) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  (before === null ? created : updated).push(dest);
}
if (logCopy) {
  fs.copyFileSync(logCopy[0], logCopy[1], fs.constants.COPYFILE_EXCL);
  created.push(`${logCopy[1]} ${M.copiedFrom(path.basename(logCopy[0]))}`);
}
for (const p of removals) fs.rmSync(p, { recursive: true, force: true });

// 4. Report: what changed and how to undo it.
const list = (title, l) => l.length && console.log(title + '\n' + l.map((f) => '  ' + f).join('\n'));
if (!created.length && !updated.length && !removals.length && !backups.length) console.log(M.nothingNew);
list(M.created, created);
list(M.updated, updated);
list(M.backups, backups.map((f) => f + BACKUP));
list(M.removed, removals);
list(M.warnings, warnings);
console.log(M.undo({
  skillDir: SKILL_DIR, hooksDir: HOOKS_DIR, claudeMd: CM, claudeBackup: backupOf(CM) || BACKUP,
  settings: path.basename(SP), settingsBackup: path.basename(SP) + (backupOf(SP) || BACKUP), hook: hookName,
}).join('\n'));
console.log(P ? M.doneProject : M.doneGlobal);
