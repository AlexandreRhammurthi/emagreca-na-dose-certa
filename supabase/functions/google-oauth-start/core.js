const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
const OAUTH_SCOPES = Object.freeze(['openid', 'email', CALENDAR_SCOPE]);
const STATE_TTL_SECONDS = 600;

export const ALLOWED_ORIGINS = Object.freeze(new Set([
  'http://localhost:8000',
  'https://emagrecanadosecerta.com.br',
  'https://emagreca-na-dose-certa.arbandeira.workers.dev'
]));

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

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

async function encryptVerifier(verifier, encodedKey) {
  const keyBytes = decodeBase64(encodedKey);
  if (keyBytes.byteLength !== 32) throw new Error('invalid_encryption_key');

  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    new TextEncoder().encode(verifier)
  ));

  return { ciphertext, nonce };
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function jsonResponse(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function readBearerToken(request) {
  const authorization = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+([^\s]+)$/iu.exec(authorization);
  return match?.[1] || null;
}

function requireConfiguration(getEnv) {
  const clientId = getEnv('GOOGLE_CLIENT_ID');
  const redirectUri = getEnv('GOOGLE_REDIRECT_URI');
  const encryptionKey = getEnv('GOOGLE_TOKEN_ENCRYPTION_KEY');
  if (!clientId || !redirectUri || !encryptionKey) throw new Error('missing_configuration');

  let parsedRedirect;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    throw new Error('invalid_redirect_uri');
  }
  if (parsedRedirect.protocol !== 'https:') throw new Error('invalid_redirect_uri');

  return { clientId, redirectUri: parsedRedirect.toString(), encryptionKey };
}

function errorCategory(error) {
  const knownCategories = new Set([
    'missing_configuration',
    'invalid_redirect_uri',
    'invalid_encryption_key',
    'oauth_state_schema_mismatch',
    'missing_supabase_url',
    'missing_supabase_publishable_keys',
    'missing_supabase_publishable_key',
    'missing_supabase_db_url'
  ]);
  const message = error instanceof Error ? error.message : '';
  return knownCategories.has(message) ? message : 'internal_error';
}

export function createOAuthStartHandler(dependencies) {
  const {
    authenticate,
    getConnectionStatus,
    persistOAuthState,
    getEnv,
    now = () => new Date(),
    logger = console
  } = dependencies;

  return async function handleOAuthStart(request) {
    const correlationId = crypto.randomUUID();
    const origin = request.headers.get('Origin');

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse(403, { error: 'Origin not allowed' }, null);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed' }, origin);
    }

    const jwt = readBearerToken(request);
    if (!jwt) return jsonResponse(401, { error: 'Authentication required' }, origin);

    let userId = null;
    try {
      userId = await authenticate(jwt);
      if (!userId) return jsonResponse(401, { error: 'Authentication required' }, origin);

      const { clientId, redirectUri, encryptionKey } = requireConfiguration(getEnv);
      const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      const verifier = base64Url(crypto.getRandomValues(new Uint8Array(64)));
      const stateHash = await sha256(state);
      const challenge = base64Url(await sha256(verifier));
      const { ciphertext, nonce } = await encryptVerifier(verifier, encryptionKey);
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + STATE_TTL_SECONDS * 1000);
      const connectionStatus = await getConnectionStatus(userId);

      await persistOAuthState({
        userId,
        stateHash,
        verifierCiphertext: ciphertext,
        verifierNonce: nonce,
        encryptionKeyVersion: 1,
        redirectTarget: 'plan',
        expiresAt,
        usedAt: null
      });

      const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
      authorizationUrl.searchParams.set('client_id', clientId);
      authorizationUrl.searchParams.set('redirect_uri', redirectUri);
      authorizationUrl.searchParams.set('response_type', 'code');
      authorizationUrl.searchParams.set('scope', OAUTH_SCOPES.join(' '));
      authorizationUrl.searchParams.set('access_type', 'offline');
      authorizationUrl.searchParams.set('include_granted_scopes', 'true');
      authorizationUrl.searchParams.set('state', state);
      authorizationUrl.searchParams.set('code_challenge', challenge);
      authorizationUrl.searchParams.set('code_challenge_method', 'S256');
      if (connectionStatus !== 'connected') authorizationUrl.searchParams.set('prompt', 'consent');

      return jsonResponse(200, {
        authorization_url: authorizationUrl.toString(),
        expires_in_seconds: STATE_TTL_SECONDS
      }, origin);
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid_jwt') {
        return jsonResponse(401, { error: 'Authentication required' }, origin);
      }
      logger.error({
        operation: 'google_oauth_start',
        correlation_id: correlationId,
        user_id: userId,
        category: errorCategory(error)
      });
      return jsonResponse(500, { error: 'Unable to start Google Calendar connection' }, origin);
    }
  };
}

export const oauthStartInternals = Object.freeze({
  base64Url,
  decodeBase64,
  sha256,
  STATE_TTL_SECONDS,
  CALENDAR_SCOPE
});
