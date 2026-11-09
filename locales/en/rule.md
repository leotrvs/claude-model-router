<!-- claude-model-router:start -->
# Model economy

Always use the cheapest model able to do the task with the same quality. Before tasks with more than 5 files or more than 10 planned actions, follow the `claude-model-router` skill:
- Mechanical (searches, summaries, renames, formatting) → `executor-haiku`
- Implementation with a defined plan and any user-visible change → `executor-sonnet` (UI never goes to Haiku)
- Architecture, bug with no clear cause, sensitive migration → `executor-opus`
- Ordinary migration (new table with its own RLS, column, index, admin panel screens with no sensitive data) → Sonnet, never Haiku. A sensitive migration is one that touches existing data, RLS on an existing table, permissions or financial data. Full criteria in the `claude-model-router` skill.
- **Security and payments → always Opus**, even for a small edit: use `executor-opus` or do it directly if you are already Opus. Applies to analysis, review and implementation.

Outside security and payments, do quick questions and small edits directly, without an agent. If it fails, go up a level. Review the diff against the project's patterns before saying you are done.

If the subject changes to a task unrelated to the current conversation, suggest `/clear` or a new session.
<!-- claude-model-router:end -->
