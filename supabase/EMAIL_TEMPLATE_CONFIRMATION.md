# Template de confirmação de conta

O HTML em `templates/confirmation.html` é o conteúdo canônico do e-mail **Confirm sign up**.

Para o projeto hospedado, publique-o pela configuração de Auth do Supabase com:

- assunto: `Confirme sua conta — Dose Certa`;
- conteúdo: o HTML do arquivo `templates/confirmation.html`;
- variável de confirmação preservada: `{{ .ConfirmationURL }}`.

O link de Termos e o aviso médico são reforços informativos. O aceite jurídico continua obrigatório, explícito e registrado durante o cadastro; o e-mail não coleta nem substitui esse consentimento.
