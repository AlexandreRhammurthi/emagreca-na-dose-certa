# Pipeline de entrega — Evolução e rentabilização

Início: 06/09/2026. Cadência: ciclos semanais, com validação antes de cada publicação.

| Sprint | Janela | Entrega | Critério de saída | Responsável decisório |
|---|---|---|---|---|
| 1. Onboarding V1 | 06–17 set | Cadastro obrigatório, perfil, consentimentos e exclusão de conta | **Publicado e validado** | Produto + jurídico |
| 2A. Dados e métricas — base local | 08–12 set | Contrato mínimo de eventos sem dados de saúde | **Concluído e ativado na etapa 2B** | Produto + jurídico |
| 3. Lembretes e rodízio V1 | 15–26 set | Lembretes da aplicação, pré-lembrete de 15 min e sugestão configurável de local | **Publicado** | Produto + jurídico |
| 4. Duração do frasco V1 | 29 set–10 out | Inventário de frascos, saldo e previsão de aplicações restantes | **Publicado; consumo atômico por frasco** | Produto |
| 5. Medidas corporais V1 | 13–24 out | Histórico de peso, abdômen, cintura, braços, coxas e panturrilhas | **Publicado** | Produto + jurídico |
| 6. Relatório PDF pessoal V1 | 27 out–07 nov | PDF sob demanda com doses, locais, anotações, efeitos relatados e evolução corporal | **Publicado** | Produto + jurídico |
| 2B. Métricas — ativação controlada | 10–14 nov | Migration, Edge Function e painel agregado de ativação/retenção | **Publicado; Privacidade atualizada e JWT validado** | Produto + jurídico |
| 7. Premium discovery | 17–21 nov | Página Premium, lista de espera e entrevistas | Hipótese de preço validada | Produto |
| 8. Assinaturas | 24 nov–05 dez | Entitlements, checkout e período de teste | Pagamento QA e cancelamento validados | Produto + financeiro |
| 9. Produto profissional discovery | 08–19 dez | Protótipo de convite e consentimento paciente-profissional | Pesquisa com profissionais | Produto + jurídico |

## Ritual por sprint

1. Definição: objetivo, métricas, escopo e riscos.
2. Arquitetura: migration/RLS e UX revisadas antes de escrever em produção.
3. Implementação local: código, testes, `npm run build` e `git diff --check`.
4. QA: roteiro funcional, segurança e mobile.
5. Aprovação: produto revisa evidências e autoriza commit/push/deploy separadamente.
6. Pós-publicação: monitorar erro, conversão e retenção por sete dias.

## Novas funcionalidades incorporadas

### Lembretes e rodízio de local

- Lembrete no dia e horário da aplicação, com timezone IANA do plano.
- Pré-lembrete configurável de retirada do frasco; o padrão inicial será 15 minutos antes, mas o usuário poderá desativá-lo.
- Sugestão de rodízio corporal baseada apenas no histórico que o próprio usuário registrar, sem prescrever local de aplicação. A tela deixará claro que a escolha deve seguir a orientação do profissional de saúde.
- Notificações no navegador dependem de consentimento e não são confiáveis se o navegador estiver fechado. Para lembretes entre dispositivos, a fonte principal continuará sendo o evento no Google Agenda quando conectado.

### Calculadora de duração do frasco

- Novo inventário por frasco: medicamento, apresentação do rótulo, data de abertura opcional, quantidade inicial e saldo calculado.
- A previsão será calculada com as retiradas vinculadas ao frasco, sem alterar doses históricas.
- A aplicação só poderá consumir de um frasco selecionado explicitamente; nenhum vínculo será inferido por data ou medicamento.

### Medidas corporais

- Registro independente por data: peso, circunferência abdominal, cintura, braço esquerdo/direito, coxa esquerda/direita e panturrilha esquerda/direita.
- Todos os campos, exceto a data, serão opcionais para evitar registros artificiais.
- Evolução em lista e gráfico por medida; sem IMC, diagnóstico ou recomendação clínica nesta versão.

### Relatório PDF pessoal

- Geração somente por solicitação explícita do usuário e download local.
- Escopo selecionável antes da geração: período, aplicações, locais registrados, anotações/efeitos relatados e gráficos corporais.
- O PDF não será enviado automaticamente a médico, nutricionista, e-mail, Google ou terceiros.
- Campos de anotações e efeitos serão texto livre sensível; serão opcionais, exibidos apenas na exportação escolhida pelo titular e protegidos por RLS.

## Marcos mensais

- Setembro: onboarding seguro, lembretes e base de inventário.
- Outubro: acompanhamento corporal e relatório pessoal.
- Novembro: métricas controladas, validação comercial e primeira descoberta Premium.

## Atualização de status — 07/09/2026

- Auditoria geral concluída: testes, build, integridade, publicação e cópia de segurança registrados em `PLATFORM_RELEASE_AUDIT_2026-09-07.md`.
- A plataforma está pronta para a fase de descoberta Premium; pagamentos, preços e entitlements continuam fora do produto até decisão específica.

## Indicadores semanais

- Simulação concluída → cadastro criado;
- Cadastro criado → perfil concluído;
- Perfil concluído → primeira aplicação/plano/peso;
- Conexão com Google Agenda;
- Lembrete configurado e aplicação confirmada;
- Frasco ativo e aplicações previstas restantes;
- Registros de medidas corporais;
- Relatório PDF gerado por solicitação;
- Retenção em 7 e 30 dias;
- Interesse e conversão Premium.
