---
name: claude-model-router
description: Use para economizar limite roteando trabalho para o modelo mais barato capaz de fazê-lo com a mesma qualidade. Use quando o usuário invocar /claude-model-router, antes de tarefas com mais de 5 arquivos ou mais de 10 ações, ao executar um plano com etapas independentes, ao criar migrations, em qualquer tarefa de segurança ou pagamento, e quando a tarefa for difícil demais para o modelo atual e precisar subir para o Opus.
---

# Claude Model Router

Escolha o modelo mais barato capaz de fazer a tarefa **com a mesma qualidade**, entregue um briefing completo e revise o resultado. Qualidade vem antes de economia: retrabalho custa mais do que o modelo acima.

## 0. Segurança e pagamento: sempre Opus

Esta regra vem antes de todas as outras e não tem exceção de tamanho, nem para edição pequena, e inclui análise e revisão.

- **Segurança:** autenticação, autorização, permissões, RLS de tabela existente, secrets, criptografia, validação de entrada sensível, dados pessoais
- **Pagamento:** checkout, cobrança, gateway, webhooks de pagamento, assinaturas, reembolso, saldo, comissão, cálculo de valores financeiros

Se você é o Opus, faça direto. Caso contrário, use `executor-opus`. Na dúvida se a tarefa se encaixa, trate como se encaixasse. Se só uma parte for sensível, essa parte vai para o Opus.

### Migrations: classifique pelo conteúdo

Ler migrations é livre para qualquer nível. O que define o modelo é o que a nova migration faz.

| Nível | O que ela faz |
|---|---|
| **Sonnet** (mínimo) | Tabela nova com RLS e políticas próprias, coluna nova, índice, telas e tabelas de painel administrativo sem dado pessoal ou financeiro |
| **Opus** | Política ou RLS em tabela existente, `drop`, `truncate`, `delete`, `update` em massa, mudar tipo ou `not null`, `grant`/`revoke`, `security definer`, política `using (true)`, schema `auth`, qualquer dado financeiro |

- Haiku nunca grava migration.
- Um hook tenta barrar os casos da linha Opus nos executores `haiku` e `sonnet`, além de gravação em caminhos sensíveis (veja a lista em `hooks/bloquear-sensivel.js`). Se bloquear, suba para `executor-opus`.
- O hook é uma barreira de conveniência contra erro do modelo, não de segurança: ele lê só `Edit` e `Write`, usa heurística e o executor tem `Bash`. A decisão de nível continua sendo sua, antes de delegar.
- Se a tabela nova guardar dado pessoal ou financeiro, trate como Opus mesmo que o hook não pegue.
- Antes de aplicar qualquer migration, passe-a por um agente de revisão de migrations, se o projeto tiver um (por exemplo, um `migration-checker`). Se não tiver, releia o SQL você mesmo.

## 1. Vale delegar?

Faça você mesmo, sem agente, quando for:
- pergunta rápida
- edição de 1 arquivo já conhecido
- tarefa que depende muito do contexto desta conversa

Delegue quando a tarefa envolver **mais de 5 arquivos** ou **mais de 10 ações previstas**, ou quando for trabalho repetitivo. Abaixo disso, faça direto, exceto se a tarefa exigir um nível acima do seu. O agente começa do zero, então o briefing e o relatório precisam custar menos do que fazer direto.

## 2. Escolha o nível

| Agente | Tarefas |
|---|---|
| `executor-haiku` | Buscas amplas, resumos, renomeações, ajustes repetitivos, formatação. Só quando um comando prova que o resultado está certo |
| `executor-sonnet` | Qualquer mudança visível ao usuário, mesmo pequena. Features com plano pronto, testes, bugs com causa conhecida, refatorações localizadas |
| `executor-opus` | **Toda tarefa de segurança ou pagamento.** Arquitetura, bugs sem causa clara, migrations sensíveis |

- Use sempre um agente com ferramentas restritas (executores ou especializados), nunca `general-purpose`. Nas medições do autor, um executor iniciou com cerca de 10 mil tokens de contexto e uma sessão com todas as ferramentas, com cerca de 50 mil. Seus números dependem dos plugins e MCPs instalados.
- **Interface nunca vai para o Haiku:** tela, tabela, formulário, dropdown, estilo, texto visível. Teste não pega componente fora do padrão visual. Um hook bloqueia gravação do Haiku em `.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro`, `.html` e CSS, então até renomeação nesses arquivos vai para o Sonnet.
- Na dúvida entre dois níveis, use o de cima. O escalonamento só cobre erro que aparece; resultado que funciona mas está fora do padrão passa despercebido.
- Se você já é o modelo do nível certo, faça direto em vez de abrir um agente do mesmo modelo, exceto quando quiser isolar muita leitura do contexto principal.
- Se o projeto tiver agentes especializados de consulta, prefira-os aos executores.

## 3. Escreva o briefing

Inclua todos os campos. O agente não vê esta conversa e só sabe o que estiver aqui ou nos arquivos.

Antes de escrever, leia você mesmo o arquivo que servirá de padrão e identifique os componentes, tokens e utilitários do projeto que devem ser reutilizados. Se não souber quais são, procure primeiro.

```
OBJETIVO: uma frase com o resultado esperado
CONTEXTO: projeto, stack e o porquê da tarefa, em 2 ou 3 linhas
ARQUIVOS: caminhos exatos a ler ou alterar
PADRÃO: arquivo existente mais parecido, para copiar a estrutura
REUTILIZAR: componentes, estilos e funções que devem ser usados, com caminho
NÃO TOCAR: o que fica fora do escopo
PRONTO QUANDO: critério objetivo + comando de verificação
```

Para tarefa só de leitura, troque PRONTO QUANDO pelo formato exato da resposta. Em código, REUTILIZAR e PADRÃO nunca ficam vazios: se não existir equivalente, escreva isso. Inclua a estrutura a copiar, não só os componentes: testes mostraram que, sem isso, o agente acerta os componentes e perde o layout da página. Confirme que o comando de PRONTO QUANDO funciona antes de enviá-lo.

## 4. Revise o resultado

O relatório do agente é uma alegação, não uma prova. Só diga ao usuário que terminou depois de:
- ler o diff inteiro e comparar com o arquivo de PADRÃO, sem confiar em `STATUS: PRONTO`: em teste, um agente entregou a tela errada marcando PRONTO
- refazer por conta própria qualquer número citado no relatório, quando ele for usado em decisão
- confirmar que nada foi recriado quando já existia, em especial elementos nativos (`select`, `button`, `input`, `table`) no lugar de componentes do projeto
- rodar a verificação do briefing
- em interface, abrir a tela no navegador e comparar com uma tela vizinha; se não der para abrir, diga isso ao usuário

Se a revisão reprovar, corrija você mesmo ou suba um nível, e registre `REPROVADO`.

## 5. Escalone quando falhar

Haiku → Sonnet → Opus. Suba um nível na primeira falha real, em `STATUS: BLOQUEADO` ou se o agente parar sem relatório (limite de turnos: 15, 30 e 40), incluindo no novo briefing o que já foi tentado. Não repita o mesmo modelo com o mesmo briefing.

Se o motivo do bloqueio for briefing ambíguo, corrija o briefing em vez de subir de nível. Se for decisão de produto, pergunte ao usuário.

Se até o `executor-opus` falhar, pare e apresente o que foi tentado.

## 6. Registro

Cada execução dos executores é registrada automaticamente por um hook em `~/.claude/delegacoes.jsonl`. Registre à mão só quando sua revisão reprovar um resultado:

```bash
node ~/.claude/skills/claude-model-router/registrar.js <agente> REPROVADO nao ? "motivo em poucas palavras"
```

Para ver os totais, rode `registrar.js --resumo`. Ao passar de 30 registros, sugira ao usuário revisar a tabela do passo 2 com esses dados.

## Regras

- Não delegue decisões de produto nem ações irreversíveis ou externas (deploy, push, migration em produção) sem o pedido do usuário.
- Dois agentes que escrevem nunca mexem nos mesmos arquivos ao mesmo tempo.
- Avise em uma linha qual nível foi escolhido e por quê.
