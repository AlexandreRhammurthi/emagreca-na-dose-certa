import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  createOAuthStartHandler,
  oauthStartInternals
} = await import('../../../supabase/functions/google-oauth-start/core.js');

const encryptionKeyBytes = crypto.getRandomValues(new Uint8Array(32));
const encryptionKey = Buffer.from(encryptionKeyBytes).toString('base64');
const fixedNow = new Date('2026-08-10T12:00:00.000Z');
let persisted = null;

function makeHandler(overrides = {}) {
  return createOAuthStartHandler({
    authenticate: async (jwt) => {
      if (jwt !== 'valid-test-jwt') throw new Error('invalid_jwt');
      return '00000000-0000-4000-8000-000000000001';
    },
    getConnectionStatus: async () => null,
    persistOAuthState: async (record) => { persisted = record; },
    getEnv: (name) => ({
      GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      GOOGLE_REDIRECT_URI: 'https://example.supabase.co/functions/v1/google-oauth-callback',
      GOOGLE_TOKEN_ENCRYPTION_KEY: encryptionKey
    })[name],
    now: () => fixedNow,
    logger: { error() {} },
    ...overrides
  });
}

const missingAuth = await makeHandler()(new Request('https://function.test', { method: 'POST' }));
assert.equal(missingAuth.status, 401, 'POST sem Authorization deve retornar 401');

const invalidAuth = await makeHandler()(new Request('https://function.test', {
  method: 'POST',
  headers: { Authorization: 'Bearer invalid-test-jwt' }
}));
assert.equal(invalidAuth.status, 401, 'JWT inválido deve retornar 401');

const invalidMethod = await makeHandler()(new Request('https://function.test', { method: 'GET' }));
assert.equal(invalidMethod.status, 405, 'GET deve retornar 405');

persisted = null;
const success = await makeHandler()(new Request('https://function.test', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer valid-test-jwt',
    Origin: 'http://localhost:8000'
  }
}));
assert.equal(success.status, 200, 'POST autenticado deve retornar 200');
assert.equal(success.headers.get('access-control-allow-origin'), 'http://localhost:8000');

const body = await success.json();
assert.deepEqual(Object.keys(body).sort(), ['authorization_url', 'expires_in_seconds']);
const authorizationUrl = new URL(body.authorization_url);
assert.equal(authorizationUrl.searchParams.get('client_id'), 'test-client-id.apps.googleusercontent.com');
assert.equal(
  authorizationUrl.searchParams.get('redirect_uri'),
  'https://example.supabase.co/functions/v1/google-oauth-callback'
);
assert.match(authorizationUrl.searchParams.get('scope') || '', /calendar\.events\.owned/u);
assert.ok(authorizationUrl.searchParams.get('state'));
assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
assert.ok(authorizationUrl.searchParams.get('code_challenge'));
assert.equal(authorizationUrl.searchParams.has('client_secret'), false);
assert.equal(authorizationUrl.searchParams.get('prompt'), 'consent');

const rawState = authorizationUrl.searchParams.get('state');
const expectedHash = await oauthStartInternals.sha256(rawState);
assert.deepEqual(persisted.stateHash, expectedHash, 'state_hash deve ser SHA-256(state)');
assert.equal(JSON.stringify(persisted).includes(rawState), false, 'state bruto não deve ser persistido');
assert.equal(persisted.verifierNonce.byteLength, 12);
assert.ok(persisted.verifierCiphertext.byteLength > 64, 'ciphertext deve conter tag GCM');
assert.equal(persisted.encryptionKeyVersion, 1);
assert.equal(persisted.usedAt, null);
assert.equal(persisted.expiresAt.getTime() - fixedNow.getTime(), 600_000);
assert.equal(body.expires_in_seconds, 600);

const connectedSuccess = await makeHandler({ getConnectionStatus: async () => 'connected' })(
  new Request('https://function.test', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-test-jwt' }
  })
);
const connectedUrl = new URL((await connectedSuccess.json()).authorization_url);
assert.equal(connectedUrl.searchParams.has('prompt'), false, 'conexão ativa não força novo consentimento');

const options = await makeHandler()(new Request('https://function.test', {
  method: 'OPTIONS',
  headers: { Origin: 'https://emagrecanadosecerta.com.br' }
}));
assert.equal(options.status, 204);

const blockedOrigin = await makeHandler()(new Request('https://function.test', {
  method: 'POST',
  headers: { Origin: 'https://untrusted.example', Authorization: 'Bearer valid-test-jwt' }
}));
assert.equal(blockedOrigin.status, 403);

console.log('GOOGLE-OAUTH-START TESTS: PASS');
