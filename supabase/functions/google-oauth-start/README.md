# google-oauth-start

Primeira etapa server-side do OAuth do Google Agenda. A função aceita somente `POST` autenticado e `OPTIONS`, cria state e PKCE e devolve apenas a URL de autorização.

## Decisões desta etapa

- JWT: a plataforma permanece com `verify_jwt = true`; o handler também valida o token com Supabase Auth `getUser`, sem decodificação manual.
- Banco privado: conexão PostgreSQL server-side por `SUPABASE_DB_URL`. O schema `private` não precisa ser exposto pelo Data API.
- State: 32 bytes aleatórios, Base64URL, persistido somente como SHA-256 e válido por 10 minutos.
- PKCE: verifier de 64 bytes aleatórios e challenge S256.
- Proteção do verifier: AES-256-GCM, chave Base64 de exatamente 32 bytes, nonce aleatório de 12 bytes e versão de chave `1`.
- Scopes: `calendar.events.owned`, `openid` e `email`. Os dois últimos dão suporte futuro à identificação amigável da conta conectada, sem solicitar acesso amplo ao calendário.
- Prompt: `consent` somente quando ainda não existe conexão ativa. Uma conexão com status `connected` não força consentimento novamente.
- CORS: allowlist exata para localhost, domínio principal e domínio Cloudflare conhecidos no projeto; não usa wildcard nem credenciais para origins arbitrárias.
- Cleanup: remove somente states expirados pertencentes ao usuário autenticado antes de inserir o novo state.

Nenhum Client Secret, token real, senha ou chave administrativa fica no código. A função não utiliza o Google Client Secret porque não realiza a troca do authorization code.
