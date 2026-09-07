# Auditoria geral e cópia de segurança — 07/09/2026

## Estado consolidado

Esta entrega consolida as evoluções publicadas da plataforma Dose Certa: cadastro e perfil, Diário, Meu Plano e integração Google Agenda, Meu Peso, medidas corporais, relatório pessoal, anotações de efeitos, lembretes e rodízio, inventário de frascos e métricas operacionais não clínicas.

## Dados e segurança

- O acesso aos dados pessoais permanece associado à sessão autenticada e protegido por RLS.
- As tabelas novas usam ownership por `user_id`: frascos/retiradas, medidas corporais, locais de aplicação, anotações de efeitos e métricas de produto.
- A retirada de um frasco só ocorre por RPC transacional junto à aplicação; não há consumo inferido por medicamento ou data.
- O saldo é verificado em mg e mL. Quando não comporta a dose, a interface pergunta se um novo frasco foi iniciado.
- Métricas de produto não registram dose, peso, medidas, observações, diagnóstico ou resultado clínico. A função exige JWT.
- Não há chave administrativa, token privilegiado ou segredo publicado nos arquivos de frontend.

## Funcionalidades disponíveis

| Área | Entrega |
|---|---|
| Onboarding | Conta obrigatória após simulação, perfil de jornada, consentimentos e exclusão permanente. |
| Diário | Aplicações, peso vinculado, edição, detalhes e confirmação de agendamentos. |
| Meu Plano | Recorrência, lembrete no horário, pré-lembrete de 15 min e rodízio organizacional de local. |
| Google Agenda | Conexão OAuth e sincronização protegida de agendamentos. |
| Meu Peso | Histórico, gráfico, origem, edição/exclusão e medidas corporais. |
| Relatório | Exportação pessoal imprimível em PDF, sob ação explícita do titular. |
| Frascos | Cadastro com quantidade total em mg e mL, saldo e vínculo opcional atômico com aplicações. |
| Métricas | Eventos mínimos de ativação e retorno, sem conteúdo clínico. |

## Validações da entrega

- Testes locais: 72 verificações aprovadas, 0 falhas, incluindo 50 do ciclo de vida Google Agenda, 4 de proteção da seringa e 18 das evoluções de onboarding, métricas, lembretes, frascos, medidas, relatório e efeitos. As três suítes auxiliares de OAuth/integração de calendário também foram aprovadas.
- Verificação de sintaxe: módulos novos de frascos e Diário aprovados.
- Build: `BUILD: SUCCESS`, 21/21 arquivos sincronizados.
- Integridade do diff: aprovada.
- Produção: a função de métricas rejeita chamadas sem autenticação com HTTP 401; a Política de Privacidade e a interface de frascos foram confirmadas na publicação.

## Cópias de segurança

Criadas antes da publicação no diretório local seguro:

`C:\Users\aband\OneDrive\Documentos\Controle_Medicacao_Backups\release-20260907-020750`

- `repository-before-publication.bundle`: histórico Git restaurável antes desta publicação.
- `working-tree.patch`: alterações locais preservadas em patch.
- `source-snapshot.zip`: cópia compactada do código-fonte, documentação e migrations, sem dependências, build gerado ou arquivos de ambiente.

## Recuperação

1. Preserve a cópia atual do diretório de trabalho.
2. Para retornar o código, use o bundle ou aplique o patch somente em uma cópia do repositório.
3. Migrations já executadas em produção não devem ser revertidas por exclusão manual; qualquer rollback de banco exige migration própria e revisão.

## Próximo gate

O próximo ciclo é Premium Discovery. Ele depende de decisão de produto sobre proposta de valor, preço, período de teste e meios de pagamento antes de alterar cobrança ou acesso.
