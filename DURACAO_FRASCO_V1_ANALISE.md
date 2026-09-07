# Duração do frasco V1 — análise e desenho

## Objetivo

Permitir que o usuário registre um frasco e acompanhe o saldo calculado a partir de aplicações explicitamente vinculadas. O recurso organiza inventário; não determina validade, segurança, descarte ou conduta clínica.

## Limitação atual

`applications` registra a apresentação e a dose, mas não possui identidade de frasco. Inferir consumo por medicamento ou data criaria erro quando houver dois frascos semelhantes, dose alterada ou aplicação não vinculada.

## Modelo proposto

### `medication_vials`

- `id`, `user_id`, `medicine`, `initial_mg`, `initial_ml`, `opened_on` opcional, `status` (`active`, `finished`, `archived`), `created_at`, `updated_at`.
- Valores de mg e mL positivos, derivados do rótulo informado pelo usuário.
- Um frasco pode permanecer sem uso vinculado até que o usuário o selecione numa aplicação.

### `vial_usages`

- `id`, `user_id`, `vial_id`, `application_id`, `used_mg`, `used_ml`, `created_at`.
- FK composta por ownership: `(vial_id, user_id)` e `(application_id, user_id)`.
- Índice único em `application_id`: uma aplicação consome no máximo um frasco na V1.
- Não alterar aplicações históricas e não vincular automaticamente registros antigos.

## Fórmula transparente

```text
concentração = initial_mg / initial_ml
saldo_mg = initial_mg - soma(used_mg)
saldo_ml = saldo_mg / concentração
aplicações_restantes = floor(saldo_mg / dose_planejada_mg)
```

O cálculo só aparece se o usuário selecionar uma dose planejada de referência. A interface deve mostrar “estimativa baseada nas aplicações vinculadas” e permitir que o usuário escolha outro frasco, sem sugerir alteração de dose.

## Exemplo correto

Um frasco de 10 mg com volume de rótulo informado pelo usuário e duas retiradas de 2,5 mg deixa 5 mg. O volume restante é calculado pela concentração do próprio rótulo, não por uma regra fixa. Portanto, uma mensagem como “restará 0,5 mL” só é exibida se essa for a consequência matemática dos valores de mg e mL registrados.

## UX proposta

- Tela “Meus frascos”: card ativo, apresentação, saldo em mg/mL, estimativa de aplicações e histórico de retiradas.
- No modal de aplicação: campo opcional “Usar frasco” com saldo visível.
- Se a retirada exceder saldo calculado: bloquear salvamento e pedir revisão do frasco/dose.
- Estado “Finalizado” é definido pelo usuário ou quando o saldo chega a zero; sem alerta de descarte, validade ou recomendação clínica.

## Segurança e testes

- RLS próprio em ambas as tabelas; nenhum `user_id` vem do formulário.
- Transação/RPC futura deve criar a aplicação e o `vial_usage` juntos para evitar saldo divergente.
- Testar concorrência de duas aplicações contra o mesmo saldo, alteração/exclusão da aplicação vinculada, cross-user e cleanup.

## Próxima etapa

Propor migration com FKs compostas, índice único e uma RPC transacional de consumo. Não executar antes de revisar schema e RLS reais.
