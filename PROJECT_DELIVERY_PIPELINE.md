# Pipeline de entrega — Evolução e rentabilização

Início: 06/09/2026. Cadência: ciclos semanais, com validação antes de cada publicação.

| Sprint | Janela | Entrega | Critério de saída | Responsável decisório |
|---|---|---|---|---|
| 1. Onboarding V1 | 06–17 set | Cadastro obrigatório, perfil, consentimentos e exclusão de conta | Migration/RLS aprovadas, testes e build verdes | Produto + jurídico |
| 2. Dados e métricas | 18–24 set | Eventos sem dados de saúde e funil de ativação | Painel com ativação e retenção | Produto |
| 3. Premium discovery | 25 set–01 out | Página Premium, lista de espera e entrevistas | Hipótese de preço validada | Produto |
| 4. Assinaturas | 02–16 out | Entitlements, checkout e período de teste | Pagamento QA e cancelamento validados | Produto + financeiro |
| 5. Relatórios Premium | 17–30 out | Relatório pessoal de peso e aplicações | Exportação e privacidade validadas | Produto |
| 6. Profissional discovery | 31 out–13 nov | Protótipo de convite e consentimento paciente-profissional | Pesquisa com profissionais | Produto + jurídico |

## Ritual por sprint

1. Definição: objetivo, métricas, escopo e riscos.
2. Arquitetura: migration/RLS e UX revisadas antes de escrever em produção.
3. Implementação local: código, testes, `npm run build` e `git diff --check`.
4. QA: roteiro funcional, segurança e mobile.
5. Aprovação: produto revisa evidências e autoriza commit/push/deploy separadamente.
6. Pós-publicação: monitorar erro, conversão e retenção por sete dias.

## Marcos mensais

- Setembro: onboarding seguro e métricas confiáveis.
- Outubro: validação comercial e primeira assinatura Premium.
- Novembro: relatórios e descoberta do produto para profissionais.

## Indicadores semanais

- Simulação concluída → cadastro criado;
- Cadastro criado → perfil concluído;
- Perfil concluído → primeira aplicação/plano/peso;
- Conexão com Google Agenda;
- Retenção em 7 e 30 dias;
- Interesse e conversão Premium.
