# QA — UNIFIED-REGISTRATION-V1

**Data:** 2026-10-24
**Resultado:** PASS

## Escopo revisado

- Cadastro único em quatro etapas: acesso, dados pessoais, objetivo/medidas e tratamento/rotina.
- Aceites explícitos obrigatórios: maioridade, Termos de Uso, Política de Privacidade e dados de saúde.
- Rascunho completo enviado somente em `user_metadata.registration_v1`; perfil, peso inicial e consentimentos são materializados após sessão confirmada.
- Template de confirmação contém `{{ .ConfirmationURL }}`, links públicos dos Termos e da Política, reforço de que o aceite ocorreu no cadastro e aviso de que o produto não substitui consulta, diagnóstico, prescrição ou orientação profissional.

## Gates automatizados

| Verificação | Resultado |
| --- | --- |
| `npm.cmd test` | PASS — 173/173 |
| `npm.cmd run build` | PASS — 28/28 artefatos; nenhuma Secret Key/service_role no bundle |
| `git diff --check` | PASS |
| Contratos do cadastro único e template | PASS — 4/4 |
| Chromium local — desktop 1440 px | PASS |
| Chromium local — mobile 390 px | PASS |

## Revisão estática

- Todos os 27 estados/DF foram preservados no novo formulário.
- A transição de etapas não envia o formulário: `Continuar` é `type="button"`; somente o último passo possui submit.
- A confirmação por e-mail não despacha o fluxo de perfil antes da confirmação; a materialização é executada pelo evento de sessão autenticada.
- A cópia do e-mail afirma expressamente que o aviso é reforço e não substitui o aceite marcado durante o cadastro.

## Revisão visual e interação

- O modal abriu corretamente em desktop e viewport de 390 px.
- Os quatro passos avançaram e retornaram pelo botão **Voltar** sem submeter uma conta.
- A data de nascimento de menor de idade bloqueou o avanço e exibiu a mensagem apropriada; uma data válida liberou a etapa seguinte.
- Os campos obrigatórios dos passos de perfil, medidas e rotina puderam ser preenchidos, e os três consentimentos foram marcados antes da tela final.
- Os links dos Termos e da Política apontam para `terms.html` e `privacy.html`.
- Não houve `console.error` nem `pageerror` durante o fluxo não submetido.

Evidências salvas em `.agents/artifacts/screenshots/`:

- `qa-unified-registration-desktop-step-1.png`
- `qa-unified-registration-desktop-step-4.png`
- `qa-unified-registration-mobile-step-1.png`
- `qa-unified-registration-mobile-step-4.png`

## Limite da rodada

Esta rodada não enviou o formulário, portanto não criou conta real nem testou entrega de e-mail. A configuração remota do template no Supabase deve ser publicada e conferida pelo fluxo de deploy autorizado.

## Revalidação pós-correção de configuração

**Resultado:** PASS — 2026-10-24

A alteração posterior ficou restrita a `supabase/config.toml`; não houve mudança de interface, portanto os screenshots da rodada anterior permanecem válidos e não foram repetidos.

- `content_path` aponta para `./supabase/templates/confirmation.html`, caminho correto a partir da raiz do repositório para o envio por configuração remota.
- `site_url` permanece no domínio HTTPS de produção; URLs adicionais são do domínio de produção e do Worker já utilizado pelo projeto.
- Confirmação por e-mail está habilitada, OTP permanece com 8 caracteres, TOTP de matrícula/verificação está explicitamente habilitado e storage vector permanece desabilitado.
- Não há segredo, `service_role` ou configuração local de desenvolvimento adicionada ao arquivo.
- `node --test tests/local/contracts/unified-registration-v1.test.mjs`: PASS — 4/4.
- `npm.cmd test`: PASS — 173/173.
- `npm.cmd run build`: PASS — 28/28, sem Secret Key/service_role no bundle.
- `git diff --check`: PASS.
