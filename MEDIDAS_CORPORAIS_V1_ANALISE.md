# Medidas corporais V1 — análise e desenho

## Objetivo

Ampliar Meu Peso com registros corporais opcionais para acompanhamento pessoal: circunferência abdominal, cintura, braços, coxas e panturrilhas. Não haverá IMC, meta, diagnóstico ou recomendação clínica.

## Reuso do peso existente

`weight_records` continua sendo a única fonte de peso. A nova tabela não duplicará `weight_kg`; a tela combinará peso e medidas pela data somente para visualização, preservando origens e histórico atuais.

## Modelo proposto

Tabela `body_measurements`:

- `id`, `user_id`, `record_date`, `created_at`, `updated_at`;
- `abdominal_cm`, `waist_cm`;
- `upper_arm_left_cm`, `upper_arm_right_cm`;
- `thigh_left_cm`, `thigh_right_cm`;
- `calf_left_cm`, `calf_right_cm`;
- `notes` opcional, máximo de 500 caracteres.

Cada medida é `numeric(6,2)`, positiva e limitada a faixa humana ampla configurada após revisão. Uma constraint exige pelo menos uma medida preenchida. Não haverá campo obrigatório além da data.

## UX proposta

- Seção “Medidas corporais” dentro de Meu Peso, com botão “Registrar medidas”.
- Campos agrupados por região, lado esquerdo/direito com rótulos claros e unidades em cm.
- Histórico em ordem decrescente; gráfico selecionável para uma medida de cada vez, evitando escala incoerente entre regiões.
- Notas são opcionais e não aparecem em cards resumidos ou em notificações.

## Privacidade e RLS

- São dados sensíveis de saúde. RLS completo por usuário, sem acesso administrativo no cliente e sem envio ao Google.
- A exportação em PDF será explícita e o usuário escolhe se inclui observações.
- Exclusão de conta remove todos os registros em cascade; testes de exclusão devem ser ampliados.

## Testes obrigatórios

1. Inserção/edição/exclusão próprias e bloqueio cruzado.
2. Uma medida por registro é aceita; registro sem medida é recusado.
3. Valores brasileiros (`92,5`) normalizam para decimal sem arredondamento silencioso.
4. Peso não é duplicado; a tela lê `weight_records` existente.
5. Gráfico não mistura unidades ou lados sem identificação.

## Próxima etapa

Preparar migration/RLS e wireframe mobile; nenhuma mudança de banco foi executada.
