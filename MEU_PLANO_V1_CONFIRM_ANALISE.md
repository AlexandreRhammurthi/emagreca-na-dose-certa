# Meu Plano V1 — Etapa 4 — análise do fluxo Confirmar aplicação

Status: **DESENHO — NÃO IMPLEMENTADO**
Data: 2026-08-09

## A. Estado atual relevante

- `js/plan.js` mantém `application_plans` e `scheduled_applications`, renderizando somente ocorrências com `status = scheduled` como próximas.
- `js/diary.js` possui o único modal de aplicação e toda a apresentação/validação dos campos realizados.
- O Diário hoje faz operações separadas no browser: grava `applications`, depois sincroniza `weight_records` quando existe peso.
- O peso associado usa `source = 'application'` e `application_id = applications.id`.
- `scheduled_applications` já possui `completed_application_id`, FK composta para `applications(id, user_id)`, constraint de consistência do status e índice único parcial sobre `completed_application_id`.
- RLS real de `applications` e `weight_records` já foi aprovada com duas sessões. As policies propostas/executadas do Meu Plano usam `auth.uid() = user_id` em SELECT/INSERT/UPDATE.

## B. Reutilização do Diário

Não criar outro formulário. A próxima etapa deve expor em `js/diary.js` uma API controlada, por exemplo:

```js
window.DiaryModule.openScheduledConfirmation({
  occurrenceId,
  medicine,
  doseMg,
  scheduledDate,
  notes
}, trigger);
```

Essa API deve abrir `#application-form-modal` em modo `scheduled-confirmation` e guardar o UUID da ocorrência somente em estado JS interno, nunca em campo editável.

Pré-preencher:

- medicamento, somente leitura;
- dose planejada, somente leitura;
- data efetiva inicialmente igual a `scheduled_date`, mas editável;
- notes apenas se a decisão de produto for reaproveitá-la.

Deixar vazios e obrigar confirmação no momento real:

- quantidade do frasco;
- volume do frasco;
- seringa;
- peso opcional;
- observação específica da aplicação.

O cálculo visual pode continuar usando `DoseCalculator.calculateDose()`. No modo normal, o submit do Diário permanece inalterado. No modo de confirmação, o submit chama exclusivamente a RPC proposta.

## C. Operação transacional recomendada

Usar `public.confirm_scheduled_application(...)`, em PostgreSQL, com:

- `SECURITY INVOKER`;
- `auth.uid()` como única autoridade de ownership;
- lock `SELECT ... FOR UPDATE` da ocorrência própria;
- leitura de medicamento e dose diretamente do plano pertencente ao mesmo usuário;
- INSERT de `applications`;
- INSERT opcional de `weight_records`;
- UPDATE da ocorrência para `completed`, preenchendo `completed_application_id`;
- retorno dos UUIDs criados.

Uma chamada de função PostgreSQL é uma única transação. Se application, peso ou UPDATE falhar, toda a confirmação é revertida.

Não usar `service_role`, Edge Function privilegiada ou sequência de writes independentes no browser.

## D. Dados e regras

### Aplicação

- `user_id`: sempre `auth.uid()`.
- `medicine` e `dose_mg`: provenientes de `application_plans`, não do DOM.
- `application_date`: data real informada pelo usuário.
- `scheduled_date`: permanece inalterada na ocorrência.
- `vial_mg`, `vial_ml` e `syringe_capacity`: dados reais informados na confirmação.
- `volume_ml` e `units`: recalculados dentro da RPC com a mesma fórmula do simulador.
- `source`: manter `simulator`, valor já usado pelo Diário, até uma futura alteração explícita de domínio.
- `calculation_version`: 1.

### Peso opcional

Quando informado:

- `user_id = auth.uid()`;
- `record_date = application_date`;
- `weight_kg = peso informado`;
- `notes = 'Peso registrado junto à aplicação'`;
- `source = 'application'`;
- `application_id = application criada`.

O índice único parcial de `weight_records.application_id` impede dois pesos para a mesma aplicação. Como a application é criada dentro da RPC, não existe peso anterior a atualizar nesse fluxo novo.

## E. Idempotência e concorrência

1. A RPC bloqueia a ocorrência por UUID e usuário com `FOR UPDATE`.
2. A primeira chamada cria os registros e muda o status para `completed`.
3. Uma chamada concorrente aguarda o lock e depois encontra `completed`.
4. Para retry técnico, a RPC retorna o `completed_application_id` existente com `already_completed = true`, sem criar outra application.
5. Ocorrências `cancelled` ou `missed` falham sem qualquer escrita.
6. A constraint de consistência garante que `completed` sempre tenha `completed_application_id`.

O front-end também deve desabilitar o botão no primeiro clique e exibir `Confirmando...`, mas essa proteção é apenas UX; a proteção definitiva fica no banco.

## F. Segurança e RLS

- A função é `SECURITY INVOKER`; portanto, privilégios e RLS do usuário autenticado continuam ativos.
- O parâmetro `user_id` não existe.
- A ocorrência é buscada por `id` e `user_id = auth.uid()`.
- O plano é buscado por `plan_id` e pelo mesmo usuário.
- As FKs compostas impedem vínculos entre proprietários diferentes.
- Revogar EXECUTE de `PUBLIC` e `anon`; conceder apenas a `authenticated`.
- Antes de executar a migration, confirmar que o valor `source = 'simulator'` permanece aceito no schema real de `applications`.

## G. Comportamento de erros

| Cenário | Resultado esperado |
|---|---|
| Ocorrência não pertence ao usuário | erro genérico de ocorrência indisponível; nenhuma escrita |
| Ocorrência cancelada ou missed | erro de estado; nenhuma escrita |
| Ocorrência já completed | retornar application existente como retry idempotente; UI não abre confirmação novamente |
| Application falha | rollback integral |
| Peso falha | rollback da application e da conclusão |
| UPDATE de conclusão falha | rollback de application e peso |
| Duplo clique | segunda chamada não cria application |
| Refresh durante a chamada | transação conclui inteira ou reverte inteira; recarregar estado |

## H. UX após sucesso

- fechar o modal do Diário;
- limpar o modo e UUID temporários;
- atualizar Meu Diário;
- atualizar Meu Peso se houve peso;
- recarregar Meu Plano;
- ocorrência sai das próximas e do calendário porque deixou de ser `scheduled`;
- toast: `Aplicação confirmada e registrada no Diário.`

## I. Testes obrigatórios da próxima etapa

1. Confirmação normal sem peso.
2. Confirmação com peso e vínculo correto.
3. Data real diferente da planejada, preservando `scheduled_date`.
4. Duplo clique com apenas uma application.
5. Retry retornando a application existente.
6. Occurrence cancelled e missed bloqueadas.
7. Occurrence already completed não duplicada.
8. Usuário A tentando confirmar ocorrência B.
9. Falha provocada no peso revertendo application e status.
10. `completed_application_id` igual ao UUID criado.
11. Regressão do registro normal pelo Diário.
12. Regressão do Meu Peso.
13. Matriz RLS A/B da execução da RPC.

## J. Arquivos da futura implementação

- `index.html`: texto/estado do modal existente, sem segundo formulário.
- `js/diary.js`: modo de confirmação e chamada única da RPC.
- `js/plan.js`: ação Confirmar aplicação e recarregamento por evento.
- `styles.css`: somente estados visuais necessários.
- `scripts/build.mjs`: apenas se entrar algum novo arquivo, o que não é necessário no desenho atual.
- migration SQL desta etapa, após revisão e aprovação.

## K. Recomendação final

Adotar a RPC proposta. Ela reutiliza a interface do Diário, mantém as datas planejada e real separadas, preserva ownership/RLS e elimina o principal risco: application criada com ocorrência ainda `scheduled`.
