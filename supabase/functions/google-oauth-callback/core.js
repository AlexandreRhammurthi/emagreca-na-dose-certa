const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
const FRONTEND_PLAN_URL = 'https://emagrecanadosecerta.com.br/';

function decodeBase64(value) {
  const normalized = value.trim().replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value) {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

function encryptionKey(encodedKey) {
  const keyBytes = decodeBase64(encodedKey);
  if (keyBytes.byteLength !== 32) throw new Error('invalid_encryption_key');
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function decryptVerifier(ciphertext, nonce, encodedKey, keyVersion) {
  if (keyVersion !== 1) throw new Error('unsupported_encryption_key_version');
  if (!(nonce instanceof Uint8Array) || nonce.byteLength !== 12) {
    throw new Error('invalid_verifier_nonce');
  }
  const key = await encryptionKey(encodedKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    ciphertext
  );
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
}

async function encryptRefreshToken(refreshToken, encodedKey) {
  const key = await encryptionKey(encodedKey);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    new TextEncoder().encode(refreshToken)
  ));
  return { ciphertext, nonce, encryptionKeyVersion: 1 };
}

function maskEmail(email) {
  if (typeof email !== 'string') return null;
  const separator = email.lastIndexOf('@');
  if (separator < 1 || separator === email.length - 1) return null;
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

function grantedCalendarScopes(scope) {
  if (typeof scope !== 'string' || !scope.trim()) {
    throw new Error('required_calendar_scope_not_granted');
  }
  const scopes = [...new Set(scope.trim().split(/\s+/u).filter(Boolean))];
  if (!scopes.includes(CALENDAR_SCOPE)) {
    throw new Error('required_calendar_scope_not_granted');
  }
  return scopes;
}

export function decideRefreshCredential({
  existingSubjectHash,
  hasExistingCredential,
  newSubjectHash,
  hasNewRefreshToken
}) {
  if (hasNewRefreshToken) return 'replace';
  if (!hasExistingCredential) throw new Error('missing_refresh_token');
  if (!existingSubjectHash || existingSubjectHash !== newSubjectHash) {
    throw new Error('account_switch_requires_refresh_token');
  }
  return 'preserve';
}

function htmlResponse(status, title, message, kind) {
  const document = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`;
  return new Response(document, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-OAuth-Result': kind
    }
  });
}

function errorResponse(status = 400) {
  return htmlResponse(
    status,
    'Conexão não concluída',
    'Não foi possível concluir a conexão com o Google Agenda. Volte ao Dose Certa e tente novamente.',
    'error'
  );
}

function oauthResultResponse(result) {
  const fallback = {
    connected: ['Google Agenda conectado', 'Google Agenda conectado com sucesso. Você pode fechar esta janela e voltar ao Dose Certa.'],
    cancelled: ['Conexão cancelada', 'Conexão com Google Agenda cancelada.'],
    error: ['Conexão não concluída', 'Não foi possível concluir a conexão com o Google Agenda. Volte ao Dose Certa e tente novamente.']
  }[result] || ['Conexão não concluída', 'Volte ao Dose Certa e tente novamente.'];
  try {
    const destination = new URL(FRONTEND_PLAN_URL);
    destination.searchParams.set('view', 'plan');
    destination.searchParams.set('google_calendar', result);
    return new Response(null, {
      status: 303,
      headers: {
        'Location': destination.toString(),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'X-OAuth-Result': result
      }
    });
  } catch {
    return htmlResponse(result === 'error' ? 500 : 200, fallback[0], fallback[1], result);
  }
}

function safeCategory(error) {
  const allowed = new Set([
    'invalid_state',
    'missing_code',
    'invalid_encryption_key',
    'unsupported_encryption_key_version',
    'invalid_verifier_nonce',
    'pkce_decryption_failed',
    'token_exchange_failed',
    'invalid_token_response',
    'userinfo_failed',
    'invalid_userinfo',
    'unverified_email',
    'required_calendar_scope_not_granted',
    'missing_refresh_token',
    'account_switch_requires_refresh_token',
    'callback_schema_mismatch',
    'missing_configuration'
  ]);
  const message = error instanceof Error ? error.message : '';
  return allowed.has(message) ? message : 'internal_error';
}

function externalStatus(error) {
  if (!error || typeof error !== 'object') return null;
  const status = Number(error.httpStatus);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

export function createOAuthCallbackHandler(dependencies) {
  const {
    validateSchema,
    consumeOAuthState,
    exchangeAuthorizationCode,
    fetchUserInfo,
    persistConnection,
    getEnv,
    logger = console
  } = dependencies;

  return async function handleOAuthCallback(request) {
    const correlationId = crypto.randomUUID();
    let userId = null;

    if (request.method !== 'GET') {
      const response = errorResponse(405);
      response.headers.set('Allow', 'GET');
      return response;
    }

    const url = new URL(request.url);
    const rawState = url.searchParams.get('state');
    if (!rawState) return oauthResultResponse('error');

    try {
      const encodedKey = getEnv('GOOGLE_TOKEN_ENCRYPTION_KEY');
      const clientId = getEnv('GOOGLE_CLIENT_ID');
      const clientSecret = getEnv('GOOGLE_CLIENT_SECRET');
      const redirectUri = getEnv('GOOGLE_REDIRECT_URI');
      if (!encodedKey || !clientId || !clientSecret || !redirectUri) {
        throw new Error('missing_configuration');
      }

      await validateSchema();
      const stateHash = await sha256(rawState);
      const stateRecord = await consumeOAuthState(stateHash, 'plan');
      if (!stateRecord) throw new Error('invalid_state');
      userId = stateRecord.userId;

      if (url.searchParams.has('error')) {
        return oauthResultResponse('cancelled');
      }

      const code = url.searchParams.get('code');
      if (!code) throw new Error('missing_code');

      let verifier;
      try {
        verifier = await decryptVerifier(
          stateRecord.verifierCiphertext,
          stateRecord.verifierNonce,
          encodedKey,
          stateRecord.encryptionKeyVersion
        );
      } catch (error) {
        if (error instanceof Error && (
          error.message === 'invalid_encryption_key' ||
          error.message === 'unsupported_encryption_key_version' ||
          error.message === 'invalid_verifier_nonce'
        )) throw error;
        throw new Error('pkce_decryption_failed');
      }

      const tokenResponse = await exchangeAuthorizationCode({
        clientId,
        clientSecret,
        code,
        codeVerifier: verifier,
        redirectUri
      });
      if (!tokenResponse?.accessToken) throw new Error('invalid_token_response');
      const grantedScopes = grantedCalendarScopes(tokenResponse.scope);

      const userInfo = await fetchUserInfo(tokenResponse.accessToken);
      if (!userInfo?.sub) throw new Error('invalid_userinfo');
      if (userInfo.email && userInfo.emailVerified !== true) throw new Error('unverified_email');

      const subjectHash = Array.from(await sha256(userInfo.sub), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      const accountHint = maskEmail(userInfo.email);
      const refreshCredential = tokenResponse.refreshToken
        ? await encryptRefreshToken(tokenResponse.refreshToken, encodedKey)
        : null;
      await persistConnection({
        userId,
        googleSubjectHash: subjectHash,
        googleAccountHint: accountHint,
        calendarId: 'primary',
        grantedScopes,
        connectionStatus: 'connected',
        tokenType: tokenResponse.tokenType || null,
        refreshCredential
      });

      return oauthResultResponse('connected');
    } catch (error) {
      logger.error({
        operation: 'google_oauth_callback',
        correlation_id: correlationId,
        user_id: userId,
        category: safeCategory(error),
        google_http_status: externalStatus(error)
      });
      return oauthResultResponse('error');
    }
  };
}

export const oauthCallbackInternals = Object.freeze({
  sha256,
  decryptVerifier,
  encryptRefreshToken,
  grantedCalendarScopes,
  maskEmail,
  oauthResultResponse,
  TOKEN_ENDPOINT,
  USERINFO_ENDPOINT,
  CALENDAR_SCOPE,
  FRONTEND_PLAN_URL
});
