# claude-model-router

[English](README.md) · **Português**

Uma **skill do Claude Code** que manda cada tarefa para o modelo mais barato capaz de fazê-la bem: **Sonnet** como padrão, **Haiku** para o trabalho mecânico e **Opus** para segurança, pagamento e problemas difíceis. Mesma qualidade, menos consumo do seu limite.

<p align="center">
  <img src="docs/how-it-works.svg" alt="Animação: as tarefas chegam e a skill as envia para Haiku, Sonnet ou Opus. Um hook bloqueia o Haiku de editar um arquivo de interface." width="100%">
</p>

## Por que usar
Rodar tudo no maior modelo gasta o seu limite em trabalho que um modelo menor faz igualmente bem. A skill define o Sonnet como padrão, entrega o trabalho simples ao Haiku e só sobe para o Opus quando precisa. No teste do autor, custou 56% menos que usar só o Opus (veja [Resultado medido](#resultado-medido)).

## Começo rápido
Você precisa do [Claude Code](https://claude.com/claude-code) e do Node.js 18 ou mais novo.

```bash
git clone https://github.com/leotrvs/claude-model-router.git
cd claude-model-router
node instalar.js
```

Abra uma sessão nova do Claude Code. Só isso: a skill entra sozinha quando a tarefa é grande o bastante, e você também pode chamá-la com `/claude-model-router`.

Para atualizar, rode `git pull` e `node instalar.js` de novo.

## Como ela escolhe
| Tarefa | Vai para |
|---|---|
| Buscas, resumos, renomeações, formatação | `executor-haiku` |
| Tudo que o usuário vê (interface), features com plano, testes, migrations comuns | `executor-sonnet` |
| **Segurança e pagamento**, arquitetura, bug sem causa clara, migrations sensíveis | `executor-opus` |

- Ela só delega quando a tarefa envolve **mais de 5 arquivos ou mais de 10 ações**. Abaixo disso, o Claude faz direto.
- O agente recebe um briefing escrito e o diff dele é revisado antes de a tarefa valer como pronta. `STATUS: PRONTO` não é prova.
- Se um agente falha, a tarefa sobe um nível: Haiku, depois Sonnet, depois Opus.
- **Hooks aplicam as regras mais rígidas**: o Haiku não grava arquivos de interface, e o Haiku e o Sonnet não gravam em caminhos de segurança ou pagamento nem em migrations SQL sensíveis.

## O que o instalador altera
<details>
<summary>Clique para abrir</summary>

Em `~/.claude` (a pasta do seu usuário):
- cria `skills/claude-model-router/`, `agents/executor-*.md` e os hooks em `hooks/`
- acrescenta ou atualiza, no `CLAUDE.md`, só o bloco entre `<!-- claude-model-router:inicio -->` e `<!-- claude-model-router:fim -->`
- no `settings.json`, registra um hook que anota cada delegação em `~/.claude/delegacoes.jsonl` e define `"model": "sonnet"` **somente se você ainda não tiver um modelo definido**. Use `--sem-modelo` para nunca definir.
- guarda cópia dos originais em `settings.json.antes-claude-model-router` e `CLAUDE.md.antes-claude-model-router`, sem sobrescrever uma cópia que já exista
- valida tudo antes de gravar: se o seu `settings.json` for inválido, nada é alterado

Ao terminar, ele lista o que criou, o que atualizou e como desfazer.
</details>

## Usar em um repositório ou na nuvem
<details>
<summary>Clique para abrir</summary>

Sessões na nuvem não têm o `~/.claude` do seu computador, então a skill precisa estar dentro do repositório:

```bash
node instalar.js --projeto "C:/caminho/do/repositorio"
```

Depois faça commit e push de `.claude/` e `CLAUDE.md`. Esse modo só grava na pasta indicada, nunca faz commit, não instala o registro de delegações e recusa a sua pasta pessoal e a raiz do disco. O `"model"` do `.claude/settings.json` vale para o time inteiro, então só é definido com `--definir-modelo`.

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

O prompt usa a versão fixa `v1.0.0` e executa o instalador deste repositório, então leia o código antes. Depois abra uma sessão nova nessa branch: a skill só carrega no início da sessão e, até o merge, só funciona nela.

**Ainda não foi testado em uma sessão real na nuvem.** Na primeira vez, peça a um `executor-sonnet` para gravar `drop table teste;` em uma migration de teste e confirme que foi bloqueado.
</details>

## Limites
- **Os hooks são uma barreira de conveniência contra erro do modelo, não de segurança.** Eles leem só `Edit`, `Write`, `MultiEdit` e `NotebookEdit`, usam heurística, e os executores têm `Bash`, que grava arquivos sem passar por eles.
- O bloqueio só vale para os executores. A sessão principal segue a regra escrita.
- A análise de SQL é heurística. Pode bloquear de mais (por exemplo, nomes como `tokenizer.ts`) ou deixar passar construções que ela não conhece.
- As regras de migration e de caminhos sensíveis são pensadas para projetos web com Postgres/Supabase. Ajuste as listas em `hooks/bloquear-sensivel.js` ao seu projeto.
- Exige um plano com acesso ao Opus; sem ele, o `executor-opus` não roda.

## Resultado medido
Nas medições do autor (4 tarefas simples, 3 rodadas, 24 execuções, custo estimado em dólar pelo Claude Code), Sonnet com delegação custou 56% menos que Opus puro, com 12 de 12 nas checagens automáticas dos dois modos. A economia veio quase toda de usar o Sonnet como padrão; a parte delegada ao Haiku pesou menos de 3%. Os dados desse teste não estão neste repositório e o resultado varia com o projeto e com os plugins instalados.

## Testes
```bash
node tests/rodar.js
```
Roda os casos dos hooks e do instalador sem dependências e sem rede. O instalador é testado em pastas temporárias e não toca no seu `~/.claude`.

## Licença
[MIT](LICENSE)
