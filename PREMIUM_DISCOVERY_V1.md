# Premium Discovery V1 — proposta e validação

Status: **DISCOVERY — sem cobrança, sem bloqueio de recursos e sem alteração de acesso**

## Objetivo

Validar se usuários percebem valor recorrente no Dose Certa antes de implementar pagamento, assinatura ou qualquer limitação de recursos já disponíveis.

## Princípios de produto

- O simulador educativo, registros já publicados e dados pessoais permanecem disponíveis como estão durante o discovery.
- O Premium não cria prescrição, diagnóstico, recomendação clínica ou promessa de resultado de saúde.
- Nenhum dado de saúde é usado para precificação, publicidade comportamental ou decisão automatizada.
- Nenhuma cobrança, cartão, renovação automática ou período de teste será exibido nesta etapa.

## Hipótese a validar

Usuários que já registram aplicações, peso ou planos recorrentes podem ter interesse em uma camada de organização ampliada, desde que ela reduza esforço de acompanhamento e gere um resumo pessoal útil para consultas.

## Proposta de valor candidata

**Dose Certa Premium**: recursos adicionais de organização e exportação pessoal para quem deseja acompanhar sua própria jornada com mais continuidade.

Possíveis entregas futuras, ainda não prometidas:

1. Relatórios pessoais com período configurável e apresentação ampliada para consulta.
2. Histórico e tendências de longo prazo, sempre descritivos e não clínicos.
3. Lembretes ampliados entre dispositivos, condicionados a consentimento explícito e viabilidade técnica.
4. Gestão mais detalhada de frascos, retiradas e alertas de saldo.

## O que não será Premium nesta fase

- Simulação de dose, orientações de segurança, acesso aos próprios dados ou exclusão de conta.
- Prescrição, interpretação de exames, diagnóstico, recomendação de dose ou suporte médico.
- Integração com profissional de saúde sem consentimento específico do titular.

## Experimento recomendado: lista de espera

### Tela

Uma página informativa, separada do Diário, com:

- descrição clara de que a funcionalidade está em pesquisa;
- lista enxuta de benefícios candidatos, sem promessas clínicas;
- campo opcional de interesse;
- escolha opcional de até dois temas de maior interesse;
- concordância explícita para receber novidades sobre o Premium;
- link para a Política de Privacidade;
- opção de sair da lista a qualquer momento.

Não solicitar cartão, CPF, renda, histórico clínico, medicamento, peso ou observações.

### Sinal de preço

O primeiro experimento deve usar apenas uma pergunta opcional de faixa de valor, sem cobrança:

| Faixa para teste | Finalidade |
|---|---|
| Até R$ 9,90/mês | Teste de entrada acessível |
| R$ 10,00–14,90/mês | Teste de valor intermediário |
| R$ 15,00–19,90/mês | Teste de disposição para recursos ampliados |
| Prefiro não informar | Resposta sem pressão |

Essas faixas são hipóteses de pesquisa, não preço definido ou oferta contratual.

## Métricas de sucesso

Medir somente de forma agregada e com a coleta mínima:

- visualização da página Premium;
- manifestação de interesse;
- temas selecionados;
- faixa de valor escolhida, quando voluntariamente informada;
- conversão da página para lista de espera;
- intenção de entrevista opcional.

Critério inicial sugerido: pelo menos 10% de interesse entre usuários ativos que visualizarem a página e ao menos 10 respostas voluntárias antes de decidir a implementação de assinatura.

## Arquitetura proposta para a próxima etapa

Caso aprovada a lista de espera:

- tabela isolada de interesse Premium, com `user_id`, interesses selecionados, faixa opcional e datas de consentimento/remoção;
- RLS de ownership integral;
- nenhuma coluna com dado clínico;
- página e formulário protegidos por sessão autenticada;
- eventos mínimos de funil separados dos dados pessoais;
- mecanismo de remoção da lista pelo próprio titular.

Não criar esta estrutura até a aprovação das decisões abaixo.

## Riscos e controles

| Risco | Controle |
|---|---|
| Parecer uma promessa médica | Linguagem de organização pessoal e revisão de textos. |
| Cobrança percebida como imediata | Indicar "lista de espera" e "sem cobrança nesta etapa". |
| Coletar dados excessivos | Limitar o formulário a interesse, temas e faixa opcional. |
| Retirar recursos já usados | Não aplicar bloqueio retroativo. |
| Dados sensíveis em métricas | Não transmitir dose, peso, medicamento ou notas. |

## Decisões necessárias para sair do discovery

1. Aprovar ou ajustar a proposta de valor acima.
2. Aprovar as faixas de pesquisa de preço ou indicar outras.
3. Autorizar a implementação da lista de espera sem cobrança.
4. Definir se haverá convite para entrevista e qual canal de contato será permitido.

Sem essas decisões, não é seguro implementar uma página comercial ou iniciar coleta de interesse.
