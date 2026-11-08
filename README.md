# claude-model-router

Skill do Claude Code que manda cada tarefa para o modelo mais barato capaz de fazê-la com a mesma qualidade. **Sonnet é o padrão**, Haiku fica com o trabalho mecânico e Opus com segurança, pagamento e o que for difícil.

Os textos da skill estão em português.

## O que ela instala
| Peça | Função |
|---|---|
| `skill/SKILL.md` | Regras de roteamento, briefing, revisão e escalonamento. Comando: `/claude-model-router` |
| `agents/executor-*.md` | Três executores: Haiku (esforço baixo, 15 turnos), Sonnet (médio, 30) e Opus (alto, 40) |
| `hooks/bloquear-interface.js` | Impede o Haiku de gravar arquivos de interface |
| `hooks/bloquear-sensivel.js` | Bloqueia caminhos sensíveis e classifica migrations SQL pelo conteúdo |
| `hooks/registrar-delegacao.js` | Registra cada execução em `~/.claude/delegacoes.jsonl` (só no modo global) |
| `hooks/portao-projeto.js` | Aplica os bloqueios por agente no modo `--projeto` |
| `regra-CLAUDE.md` | Bloco com a regra, copiado para o `CLAUDE.md` |

## Requisitos
- Claude Code
- Node.js 18 ou mais novo
- Um plano com acesso ao Opus. Sem ele, o `executor-opus` não roda e a regra de segurança e pagamento não funciona como descrita.

## Instalar neste computador
```bash
git clone https://github.com/leotrvs/claude-model-router.git
cd claude-model-router
node instalar.js
```
Depois abra uma sessão nova. Para atualizar, rode `git pull` e `node instalar.js` de novo.

**O que o instalador altera em `~/.claude`:**
- cria `skills/claude-model-router/`, `agents/executor-*.md` e os hooks em `hooks/`
- acrescenta ou atualiza, no `CLAUDE.md`, só o bloco entre `<!-- claude-model-router:inicio -->` e `<!-- claude-model-router:fim -->`
- no `settings.json`, registra o hook de registro de delegações e define `"model": "sonnet"` **somente se você ainda não tiver um modelo definido**. Use `--sem-modelo` para nunca definir.
- guarda cópia do original em `settings.json.antes-claude-model-router` e `CLAUDE.md.antes-claude-model-router`, sem sobrescrever uma cópia que já exista
- valida tudo antes de gravar: se o `settings.json` for inválido, nada é alterado

Ao terminar, o instalador lista o que criou, o que atualizou e como desfazer.

## Instalar em um repositório (sessões na nuvem)
Sessões na nuvem não têm o `~/.claude` do seu computador, então a skill precisa estar dentro do repositório:

```bash
node instalar.js --projeto "C:/caminho/do/repositorio"
```

Depois faça commit e push de `.claude/` e `CLAUDE.md`. O modo `--projeto` só grava na pasta indicada, nunca faz commit, não instala o registro de delegações e recusa a pasta pessoal e a raiz do disco. O `"model"` do `.claude/settings.json` vale para o time inteiro, então ele só é definido com `--definir-modelo`.

Para instalar sem usar o seu computador, cole em uma sessão na nuvem do projeto:

```text
Instale a skill claude-model-router neste repositório. Nunca altere a main, não faça merge e não abra PR.
1. Trabalhe em uma branch que não seja a main. Se a sessão já tiver uma branch própria, use essa.
2. Rode: git clone --depth 1 --branch v1.0.0 https://github.com/leotrvs/claude-model-router.git /tmp/claude-model-router
3. Na raiz deste repositório, rode: node /tmp/claude-model-router/instalar.js --projeto .
4. Faça git add somente de .claude/skills .claude/agents .claude/hooks .claude/settings.json CLAUDE.md, faça o commit e dê push da branch.
5. Se algum desses caminhos estiver no .gitignore, pare e me avise.
6. No final, informe o nome da branch e a lista de arquivos do commit.
```

O prompt usa uma versão fixa (`v1.0.0`). Leia o código antes de rodá-lo: ele executa o instalador deste repositório.

Depois abra uma sessão nova na branch criada, porque a skill só carrega no início da sessão. Enquanto não houver merge, ela só funciona nessa branch. **Ainda não foi testado em uma sessão real na nuvem.** Na primeira vez, peça a um `executor-sonnet` para gravar `drop table teste;` em uma migration de teste e confirme que foi bloqueado.

## Regras principais
- Segurança e pagamento: sempre Opus, mesmo em edição pequena.
- Interface: nunca Haiku.
- Migrations: comum no Sonnet, sensível no Opus, nunca no Haiku. A classificação é pelo SQL, voltada ao Postgres/Supabase.
- Delegue só quando passar de 5 arquivos ou 10 ações; abaixo disso, faça direto.
- O briefing tem campos fixos e a revisão do diff é obrigatória: `STATUS: PRONTO` do agente não é prova.
- Falhou, sobe um nível: Haiku, Sonnet, Opus.

## Limites
- **Os hooks são uma barreira de conveniência contra erro do modelo, não de segurança.** Eles leem só `Edit`, `Write`, `MultiEdit` e `NotebookEdit`, usam heurística, e o executor tem `Bash`, que grava arquivos sem passar por eles.
- O bloqueio só vale para os executores. A sessão principal segue a regra escrita.
- A análise de SQL é heurística e pode bloquear de mais (por exemplo, nomes como `tokenizer.ts`) ou deixar passar construções que ela não conhece.
- As regras de migration e de caminhos sensíveis são pensadas para projetos web com Supabase. Ajuste as listas em `hooks/bloquear-sensivel.js` ao seu projeto.

## Resultado medido
Nas medições do autor (4 tarefas simples, 3 rodadas, 24 execuções, custo estimado em dólar pelo Claude Code), Sonnet com delegação custou 56% menos que Opus puro, com 12 de 12 nas checagens automáticas dos dois modos. A economia veio quase toda de usar o Sonnet como padrão; a parte delegada ao Haiku pesou menos de 3%. Os dados desse teste não estão neste repositório e o resultado varia com o projeto e com os plugins instalados.

## Testes
```bash
node tests/rodar.js
```
Roda os casos dos hooks e do instalador sem dependências e sem rede. O instalador é testado em pastas temporárias e não toca no seu `~/.claude`.

## Licença
[MIT](LICENSE)
