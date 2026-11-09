#!/usr/bin/env node
// Generates the plugin/ folder from locales/en and hooks/. Usage: node scripts/build-plugin.js
// plugin/ is deleted and recreated from scratch; nothing outside it is written.
// The output is deterministic (same bytes on every run, \n line endings), so tests/run.js can
// check that the committed plugin/ matches a fresh build.
const fs = require('fs'), path = require('path');
const R = path.resolve(__dirname, '..');
const OUT = path.join(R, 'plugin');
const NAME = 'model-router';
const SKILL = 'route';
const AGENTS = ['haiku', 'sonnet', 'opus'].map((m) => `executor-${m}.md`);
const HOOKS = ['block-ui.js', 'block-sensitive.js', 'project-gate.js', 'session-rule.js'];
const NOTE = `Installed as a plugin, the agents are named \`${NAME}:executor-haiku\`, \`${NAME}:executor-sonnet\` and \`${NAME}:executor-opus\`. Use these full names as \`subagent_type\` when delegating.`;

const read = (f) => fs.readFileSync(path.join(R, f), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const fail = (msg) => { throw new Error('build-plugin: ' + msg); };
// Replaces exactly once, so a change in the source text fails the build instead of passing silently.
const once = (text, re, to, what) => {
  if ((text.match(new RegExp(re.source, re.flags.replace('g', '') + 'g')) || []).length !== 1) fail(`expected one match for ${what}`);
  return text.replace(re, to);
};

// Returns { relative path: content } for every file of the plugin.
function files() {
  const version = read('VERSION').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`VERSION is not semver: ${version}`);
  const out = {};
  out['.claude-plugin/plugin.json'] = JSON.stringify({
    name: NAME,
    version,
    description: 'Routes work to the cheapest Claude model able to do it with the same quality: Haiku, Sonnet or Opus executors, with hooks that block the smaller ones from UI, sensitive migrations, security and payment paths.',
    author: { name: 'leotrvs' },
    license: 'MIT',
    repository: 'https://github.com/leotrvs/claude-model-router',
    keywords: ['model-routing', 'subagents', 'cost', 'haiku', 'sonnet', 'opus', 'hooks'],
  }, null, 2) + '\n';

  // Skill: same local-only cleanup as install.js --project (no log in a plugin), renamed to /model-router:route.
  let sk = read('locales/en/skill/SKILL.md').replace(/<!-- local-only:start -->[\s\S]*?<!-- local-only:end -->/g, '').replace(/\n{3,}/g, '\n\n');
  sk = once(sk, /^name: claude-model-router$/m, `name: ${SKILL}`, 'the skill name');
  sk = once(sk, /^(description: .*)\/claude-model-router\b(?!:)/m, `$1/${NAME}:${SKILL}`, 'the command in the description');
  sk = once(sk, /^# Claude Model Router\n/m, `# Claude Model Router\n\n${NOTE}\n`, 'the title');
  if (/local-only|log\.js/.test(sk)) fail('SKILL.md still has local-only content');
  out[`skills/${SKILL}/SKILL.md`] = sk;

  // Agents: plugin agents ignore hooks in the frontmatter, so the block is removed as in install.js --project;
  // the blocks run from hooks/hooks.json instead.
  for (const f of AGENTS) {
    const a = read('locales/en/agents/' + f).replace(/^hooks:\r?\n(?:[ \t]+.*\r?\n)+/m, '');
    if (/^hooks:/m.test(a)) fail(`${f} still has hooks in the frontmatter`);
    out['agents/' + f] = a;
  }

  const hook = (file) => ({ type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${file}"`, timeout: 10 });
  out['hooks/hooks.json'] = JSON.stringify({ hooks: {
    PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [hook('project-gate.js')] }],
    SessionStart: [{ hooks: [hook('session-rule.js')] }],
  } }, null, 2) + '\n';
  for (const f of HOOKS) out['hooks/' + f] = read('hooks/' + f);
  out['hooks/model-router.lang'] = 'en';
  // The always-on rule, without its markers, read by session-rule.js at runtime.
  const rule = read('locales/en/rule.md').replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!rule) fail('locales/en/rule.md is empty');
  out['hooks/rule.txt'] = rule + '\n';
  return out;
}

if (require.main === module) {
  const out = files(); // built in memory first: an error leaves plugin/ as it was
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const f of Object.keys(out).sort()) {
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out[f]);
  }
  console.log(`plugin/ generated: ${Object.keys(out).length} files, version ${JSON.parse(out['.claude-plugin/plugin.json']).version}.`);
}

module.exports = { files, OUT };
