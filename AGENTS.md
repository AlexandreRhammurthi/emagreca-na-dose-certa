# Protocolo de agentes — Dose Certa

Este arquivo define o fluxo obrigatório para agentes que trabalham neste repositório. As instruções de `.agent.md` continuam válidas e complementam este protocolo.

## Papéis

- **DEV:** implementa somente a tarefa descrita em `.agents/task.md` e corrige os achados registrados pelo QA.
- **QA:** não altera arquivos de produto, migrations, configurações de produção ou Git. Executa testes, revisão visual e registra evidências em `.agents/qa/qa-report.md`.
- **Orquestrador:** entrega a tarefa ao DEV, encaminha achados QA ao DEV e autoriza a publicação Git apenas quando o QA retornar `PASS`.
- **PO/Guardião:** após a validação deste fluxo, evolui do papel técnico generalista atual para responsável por priorização, escopo, critérios de aceite, riscos de produto e decisão de release. Não implementa nem aprova a própria implementação.

## Isolamento de trabalho

1. Uma tarefa usa uma branch `feature/<nome-da-tarefa>` criada a partir de `main` atualizado.
2. Antes de editar, o DEV registra branch, `HEAD` e `git status` no relatório de execução.
3. Mudanças preexistentes ou fora do escopo interrompem o trabalho: não sobrescrevê-las, não restaurá-las e não incluí-las em commits.
4. O QA testa exatamente o commit entregue pelo DEV. Se o DEV fizer nova alteração, a rodada QA anterior deixa de ser válida.

## Qualidade obrigatória

O DEV executa a validação mínima indicada na tarefa antes de chamar o QA.

O QA valida, conforme o escopo:

- comportamento funcional e critérios de aceite;
- `npm test`, `npm run build` e `git diff --check`;
- erros de console e falhas de rede relevantes;
- desktop e viewport móvel;
- screenshots com evidências salvas em `.agents/artifacts/screenshots/` quando houver mudança visual;
- regressão dos fluxos relacionados.

Uma tarefa só recebe `QA: PASS` se todos os critérios aplicáveis estiverem aprovados. Ausência de navegador, teste ou evidência significa `BLOCKED`, nunca `PASS`.

## Correção e publicação Git

1. Ao receber `FAIL`, o DEV corrige somente os achados do relatório e executa novamente suas validações.
2. A nova revisão retorna ao QA; o ciclo continua até `PASS` ou bloqueio real.
3. Após `QA: PASS`, o DEV deve, nesta ordem:
   - confirmar branch prevista e `git status`;
   - confirmar que o diff contém somente a tarefa;
   - executar as validações finais previstas;
   - criar um commit Conventional Commit descritivo;
   - fazer push da branch da tarefa;
   - confirmar `git status`, branch, `HEAD` e rastreamento remoto após o push.
4. Não fazer push direto para `main`. A integração ocorre por PR/revisão posterior.
5. Deploy em Cloudflare, migrations, alterações de RLS, mudanças de schema ou uso de credenciais exigem autorização explícita separada — um push Git não é autorização de deploy.

## Segurança e privacidade

- Nunca registrar nem expor senhas, tokens, chaves, JWTs ou dados pessoais em relatórios, screenshots ou commits.
- Não usar chaves privilegiadas, Admin API ou `service_role` sem autorização explícita.
- Não editar `public/` diretamente: ele é artefato gerado pelo build.

## Artefatos operacionais

- Tarefa atual: `.agents/task.md`
- Andamento ao vivo: `.agents/status.md`
- Relatório QA: `.agents/qa/qa-report.md`
- Evidências visuais: `.agents/artifacts/screenshots/`
- Relatório DEV: `.agents/dev-report.md`

## Transparência de andamento

O agente ativo atualiza `.agents/status.md` no início, antes de uma validação longa, ao concluir cada gate e quando ficar bloqueado. O arquivo deve conter papel, etapa, percentual estimado, último comando/ação, resultado e próximo passo. Percentuais representam gates concluídos, não tempo transcorrido.
- Papel futuro de PO: `.agents/po.md`
