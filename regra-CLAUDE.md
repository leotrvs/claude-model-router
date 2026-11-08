<!-- claude-model-router:inicio -->
# Economia de modelos

Use sempre o modelo mais barato capaz de fazer a tarefa com a mesma qualidade. Antes de tarefas com mais de 5 arquivos ou mais de 10 ações previstas, siga a skill `claude-model-router`:
- Mecânico (buscas, resumos, renomeações, formatação) → `executor-haiku`
- Implementação com plano definido e qualquer mudança visível ao usuário → `executor-sonnet` (interface nunca vai para o Haiku)
- Arquitetura, bug sem causa clara, migration sensível → `executor-opus`
- Migration comum (tabela nova com RLS própria, coluna, índice, telas de painel admin sem dado sensível) → Sonnet, nunca Haiku. Migration sensível é a que mexe em dados existentes, RLS de tabela existente, permissões ou dado financeiro. Critérios completos na skill `claude-model-router`.
- **Segurança e pagamento → sempre Opus**, mesmo em edição pequena: use `executor-opus` ou faça direto se já estiver no Opus. Vale para análise, revisão e implementação.

Fora de segurança e pagamento, faça direto, sem agente, perguntas rápidas e edições pequenas. Se falhar, suba um nível. Revise o diff contra os padrões do projeto antes de dizer que terminou.

Se o assunto mudar para uma tarefa sem relação com a conversa atual, sugira `/clear` ou uma sessão nova.
<!-- claude-model-router:fim -->
