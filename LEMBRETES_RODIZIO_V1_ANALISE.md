# Lembretes e rodízio V1 — análise e desenho

## Objetivo

Evoluir Meu Plano para apoiar a organização pessoal da aplicação: lembrete no horário planejado, pré-lembrete de preparação e sugestão configurável de rodízio de local. Não é prescrição, orientação clínica ou garantia de entrega de notificação.

## Estrutura existente confirmada

- `application_plans` armazena `time_of_day`, `timezone` IANA e `default_reminder_minutes`.
- `scheduled_applications` preserva por ocorrência `scheduled_date`, `scheduled_time`, `timezone` e `reminder_minutes`.
- As constraints atuais aceitam de zero a cinco offsets inteiros não negativos; portanto `15` já é compatível com o schema.
- `google-calendar-sync` já transmite os offsets como lembretes do evento Google e aceita até cinco valores entre 0 e 40320 minutos.
- A interface atual oferece somente 1440, 120 e 0 minutos; a alteração inicial de UX pode adicionar 15 sem migration.

## Lembretes V1

### Regras propostas

| Ação | Offset | Texto no app |
|---|---:|---|
| Preparar aplicação | 15 min antes | “Em 15 minutos: prepare sua aplicação conforme a orientação profissional.” |
| Aplicação planejada | 0 min | “Aplicação planejada para agora.” |

- O usuário poderá ativar/desativar cada lembrete por ocorrência.
- A hora civil e a timezone pertencem à ocorrência; mudança de timezone do navegador não reinterpretará agendamentos antigos.
- O rótulo de preparação não deve citar medicamento, dose, peso ou diagnóstico em uma notificação de tela bloqueada.

### Limitação importante

Google Agenda pode receber os offsets, mas não garante o texto nem a entrega de uma notificação no aparelho. Notificações do navegador também dependem de permissão, sistema operacional, bateria e de o navegador estar aberto/ter um service worker ativo.

Para prometer uma mensagem própria no horário exato e com o pré-lembrete, será necessária uma etapa posterior de PWA/Web Push: consentimento explícito, service worker, assinatura de push, job server-side, retentativas, expiração, unsubscribe e auditoria de timezone. Essa infraestrutura não será ativada nesta V1.

## Rodízio de local V1

### Princípios

- A sugestão é organizacional e baseada apenas em locais previamente registrados pelo usuário.
- O usuário confirma, troca ou deixa em branco; o app nunca presume que um local foi utilizado.
- A interface exibirá: “Sugestão de organização. Siga sempre a orientação do seu profissional de saúde.”
- Nenhum algoritmo de risco, diagnóstico, avaliação de pele ou contraindicação será criado.

### Dados mínimos propostos

Nova tabela `application_site_records`:

| Campo | Regra |
|---|---|
| `id` | UUID primário |
| `user_id` | derivado da sessão; FK `auth.users` com cascade |
| `application_id` | nullable, FK composta para application do mesmo usuário quando houver confirmação |
| `scheduled_application_id` | nullable, FK composta para ocorrência do mesmo usuário quando houver confirmação |
| `site_code` | enum fechada: `abdomen_left`, `abdomen_right`, `thigh_left`, `thigh_right`, `arm_left`, `arm_right`, `other` |
| `site_other` | obrigatório somente para `other`, máximo 80 caracteres |
| `recorded_at` | timestamp do servidor |

Uma constraint garantirá que, quando houver vínculo, ele pertença ao mesmo usuário; outra impedirá os dois vínculos simultâneos na V1. O registro só é criado após aplicação confirmada ou após confirmação explícita de uma ocorrência.

### Algoritmo de sugestão

1. Ler somente os últimos registros próprios de `site_code`.
2. Considerar apenas os locais habilitados pelo usuário.
3. Sugerir o local habilitado menos recentemente usado; em empate, usar ordem estável configurada pelo próprio usuário.
4. Se não houver histórico ou local habilitado, mostrar “Escolha o local que foi orientado para você”, sem sugestão automática.

O algoritmo não utiliza dose, medicamento, peso, efeitos ou qualquer dado clínico.

## UX proposta

- Em Meu Plano: novo chip “15 min antes” junto a “No horário”, com explicação curta do pré-lembrete.
- No card da próxima aplicação: data/hora, status do Google e sugestão opcional de local.
- Ao confirmar aplicação: seletor de local com opção “Não informar”; nenhum campo obrigatório.
- Em Detalhes: mostrar o local confirmado quando existir; nunca apresentar como recomendação médica.

## Segurança e RLS

- RLS de `application_site_records`: SELECT/INSERT/UPDATE/DELETE exclusivamente próprios.
- O cliente jamais informa `user_id` de outro usuário.
- Não incluir site em título, descrição ou metadata do Google Agenda.
- Eventos de produto, se ativados futuramente, podem registrar somente `first_product_action=application`; nunca o local.

## Testes obrigatórios

1. Offset 15 é salvo, carregado e enviado ao Google apenas como lembrete técnico.
2. Ocorrência mantém seu timezone após mudança do navegador.
3. Usuário A não lê ou escreve locais de B.
4. Sugestão não cria registro automaticamente.
5. Confirmação cria no máximo um local para a aplicação/ocorrência vinculada.
6. Cancelamento/exclusão de aplicação trata o vínculo conforme a FK aprovada, sem apagar outros registros.
7. Tela bloqueada, Google, logs e respostas não recebem medicamento, dose ou local.

## Próxima etapa

Produzir a migration proposta, decisões de FK/cascade, matriz RLS e wireframe mobile. Nenhum SQL ou deploy será executado antes de revisão e autorização de produção.
