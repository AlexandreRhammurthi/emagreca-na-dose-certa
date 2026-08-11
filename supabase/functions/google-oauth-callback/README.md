# google-oauth-callback

Callback público temporário do OAuth Google Agenda. Aceita somente `GET`; sua segurança depende de state aleatório, expiração, consumo atômico e PKCE, não de JWT Supabase.

## Fluxo e segurança

1. Calcula SHA-256 do state recebido e executa um único `UPDATE ... RETURNING` condicionado a `used_at IS NULL` e `expires_at > now()`.
2. Um state consumido nunca é reaberto, inclusive quando o Google nega o consentimento ou a troca de token falha.
3. O verifier PKCE é descriptografado em memória com AES-256-GCM e descartado após a troca do authorization code.
4. Access token é usado somente para UserInfo. Authorization code, access token e ID token não são persistidos.
5. `sub` é transformado em hash SHA-256; e-mail é reduzido a um hint mascarado.
6. Refresh token novo é cifrado com nonce próprio. Se estiver ausente, uma credential anterior válida é preservada; primeira conexão sem refresh token falha sem marcar a conexão como ativa.
7. Connection e credential são persistidas juntas em uma transação, respeitando `(connection_id, user_id)`.

## Hardening pré-deploy

- O callback exige que `calendar.events.owned` esteja presente no `scope` efetivamente retornado pelo Google. Scope ausente ou incompleto bloqueia a persistência; nenhum scope solicitado é inferido.
- Sem refresh token novo, a credential anterior só é preservada quando o hash do `sub` atual é exatamente igual ao hash já vinculado. Troca de conta exige refresh token novo e causa rollback integral quando ele não existe.
- O consumo atômico do state exige também `redirect_target = 'plan'`, impedindo o uso de state emitido para outro fluxo.

O callback não usa CORS porque é uma navegação direta do Google. As páginas HTML temporárias usam `no-store`, `no-referrer`, `nosniff` e CSP `default-src 'none'`.
