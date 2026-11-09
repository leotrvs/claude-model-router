---
name: route
description: Use to save usage limit by routing work to the cheapest model able to do it with the same quality. Use when the user invokes /model-router:route, before tasks with more than 5 files or more than 10 actions, when executing a plan with independent steps, when creating migrations, on any security or payment task, and when the task is too hard for the current model and needs to go up to Opus.
---

# Claude Model Router

Installed as a plugin, the agents are named `model-router:executor-haiku`, `model-router:executor-sonnet` and `model-router:executor-opus`. Use these full names as `subagent_type` when delegating.

Pick the cheapest model able to do the task **with the same quality**, hand it a complete brief, and review the result. Quality comes before savings: rework costs more than the model one level up.

## 0. Security and payments: always Opus

This rule comes before all others and has no size exception, not even for a small edit, and it includes analysis and review.

- **Security:** authentication, authorization, permissions, RLS on an existing table, secrets, encryption, validation of sensitive input, personal data
- **Payments:** checkout, billing, gateway, payment webhooks, subscriptions, refunds, balance, commission, calculation of financial values

If you are Opus, do it directly. Otherwise, use `executor-opus`. If you are unsure whether the task fits, treat it as if it does. If only part of it is sensitive, that part goes to Opus.

### Migrations: classify by content

Reading migrations is free for any level. What decides the model is what the new migration does.

| Level | What it does |
|---|---|
| **Sonnet** (minimum) | New table with its own RLS and policies, new column, index, admin panel screens and tables with no personal or financial data |
| **Opus** | Policy or RLS on an existing table, `drop`, `truncate`, `delete`, bulk `update`, changing a type or `not null`, `grant`/`revoke`, `security definer`, `using (true)` policy, `auth` schema, any financial data |

- Haiku never writes a migration.
- A hook tries to block the Opus-row cases in the `haiku` and `sonnet` executors, as well as writes to sensitive paths (see the list in `hooks/block-sensitive.js`). If it blocks, escalate to `executor-opus`.
- The hook is a convenience barrier against model mistakes, not a security control: it reads only `Edit` and `Write`, uses heuristics, and the executor has `Bash`. The level decision is still yours, before delegating.
- If the new table stores personal or financial data, treat it as Opus even if the hook does not catch it.
- Before applying any migration, run it through a migration review agent, if the project has one (for example, a `migration-checker`). If it does not, re-read the SQL yourself.

## 1. Worth delegating?

Do it yourself, without an agent, when it is:
- a quick question
- an edit to 1 already-known file
- a task that depends heavily on the context of this conversation

Delegate when the task involves **more than 5 files** or **more than 10 planned actions**, or when it is repetitive work. Below that, do it directly, unless the task requires a level above yours. The agent starts from zero, so the brief and the report must cost less than doing it directly.

## 2. Pick the level

| Agent | Tasks |
|---|---|
| `executor-haiku` | Broad searches, summaries, renames, repetitive tweaks, formatting. Only when a command proves the result is right |
| `executor-sonnet` | Any user-visible change, even a small one. Features with a ready plan, tests, bugs with a known cause, localized refactors |
| `executor-opus` | **Every security or payment task.** Architecture, bugs with no clear cause, sensitive migrations |

- Always use an agent with restricted tools (executors or specialized ones), never `general-purpose`. In the author's measurements, an executor started with about 10k tokens of context and a session with all tools, with about 50k. Your numbers depend on the installed plugins and MCPs.
- **UI never goes to Haiku:** screen, table, form, dropdown, style, visible text. Tests do not catch a component that breaks the visual pattern. A hook blocks Haiku from writing `.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro`, `.html` and CSS, so even a rename in those files goes to Sonnet.
- When in doubt between two levels, use the higher one. Escalation only covers errors that show up; a result that works but breaks the pattern goes unnoticed.
- If you are already the model of the right level, do it directly instead of opening an agent of the same model, unless you want to keep a lot of reading out of the main context.
- If the project has specialized lookup agents, prefer them over the executors.

## 3. Write the brief

Include all fields. The agent does not see this conversation and only knows what is here or in the files.

Before writing, read the file that will serve as the pattern yourself and identify the project's components, tokens and utilities that must be reused. If you do not know which they are, search first.

```
GOAL: one sentence with the expected result
CONTEXT: project, stack and the reason for the task, in 2 or 3 lines
FILES: exact paths to read or change
PATTERN: closest existing file, to copy the structure from
REUSE: components, styles and functions that must be used, with path
DO NOT TOUCH: what stays out of scope
DONE WHEN: objective criterion + verification command
```

For a read-only task, replace DONE WHEN with the exact format of the answer. In code, REUSE and PATTERN are never empty: if there is no equivalent, write that. Include the structure to copy, not just the components: tests showed that, without it, the agent gets the components right and misses the page layout. Confirm that the DONE WHEN command works before sending it.

## 4. Review the result

The agent's report is a claim, not proof. Only tell the user it is finished after:
- reading the entire diff and comparing it with the PATTERN file, without trusting `STATUS: DONE`: in a test, an agent delivered the wrong screen marked DONE
- redoing on your own any number cited in the report, when it is used in a decision
- confirming that nothing was recreated when it already existed, especially native elements (`select`, `button`, `input`, `table`) in place of project components
- running the brief's verification
- for UI, opening the screen in the browser and comparing it with a neighboring screen; if you cannot open it, tell the user

If the review rejects the result, fix it yourself or go up a level.

## 5. Escalate when it fails

Haiku → Sonnet → Opus. Go up a level on the first real failure, on `STATUS: BLOCKED`, or if the agent stops without a report (turn limit: 15, 30 and 40), including in the new brief what was already tried. Do not repeat the same model with the same brief.

If the reason for the block is an ambiguous brief, fix the brief instead of going up a level. If it is a product decision, ask the user.

If even `executor-opus` fails, stop and present what was tried.

## Rules

- Do not delegate product decisions or irreversible or external actions (deploy, push, migration in production) without the user's request.
- Two agents that write never touch the same files at the same time.
- State in one line which level was chosen and why.
