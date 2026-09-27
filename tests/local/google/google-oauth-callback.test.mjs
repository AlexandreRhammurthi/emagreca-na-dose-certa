import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  createOAuthCallbackHandler,
  oauthCallbackInternals,
  decideRefreshCredential
} = await import('../../../supabase/functions/google-oauth-callback/core.js');

const keyBytes = crypto.getRandomValues(new Uint8Array(32));
const encodedKey = Buffer.from(keyBytes).toString('base64');
const userId = '00000000-0000-4000-8000-000000000001';
const rawState = 'safe-state-value';
const verifier = 'test-pkce-verifier-with-sufficient-entropy-0123456789';

async function encryptForState(plaintext, key = keyBytes) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    new TextEncoder().encode(plaintext)
  ));
  return { ciphertext, nonce };
}

const protectedVerifier = await encryptForState(verifier);

function stateRecord() {
  return {
    userId,
    verifierCiphertext: protectedVerifier.ciphertext,
    verifierNonce: protectedVerifier.nonce,
    encryptionKeyVersion: 1
  };
}

function makeDependencies(overrides = {}) {
  return {
    validateSchema: async () => {},
    consumeOAuthState: async () => stateRecord(),
    exchangeAuthorizationCode: async ({ codeVerifier }) => ({
      accessToken: 'memory-only-access-token',
      refreshToken: 'new-refresh-token',
      scope: 'openid email https://www.googleapis.com/auth/calendar.events.owned',
      tokenType: 'Bearer',
      codeVerifier,
      idToken: 'must-not-persist'
    }),
    fetchUserInfo: async () => ({
      sub: 'stable-google-subject',
      email: 'alexandre@example.com',
      emailVerified: true
    }),
    persistConnection: async () => {},
    getEnv: (name) => ({
      GOOGLE_TOKEN_ENCRYPTION_KEY: encodedKey,
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-only-client-secret',
      GOOGLE_REDIRECT_URI: 'https://example.test/google-oauth-callback'
    })[name],
    logger: { error() {} },
    ...overrides
  };
}

function callbackUrl(params = {}) {
  const url = new URL('https://function.test/google-oauth-callback');
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url;
}

function assertOAuthRedirect(response, result) {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('x-oauth-result'), result);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin, 'https://emagrecanadosecerta.com.br');
  assert.equal(location.pathname, '/');
  assert.equal(location.searchParams.get('view'), 'plan');
  assert.equal(location.searchParams.get('google_calendar'), result);
  for (const forbidden of ['state', 'code', 'token', 'redirect_uri']) {
    assert.equal(location.searchParams.has(forbidden), false);
  }
}

const noState = await createOAuthCallbackHandler(makeDependencies())(
  new Request(callbackUrl(), { method: 'GET' })
);
assertOAuthRedirect(noState, 'error');

for (const scenario of ['invalid', 'expired', 'used']) {
  const response = await createOAuthCallbackHandler(makeDependencies({
    consumeOAuthState: async () => null
  }))(new Request(callbackUrl({ state: `${scenario}-state` }), { method: 'GET' }));
  assertOAuthRedirect(response, 'error');
}

let consumed = false;
const atomicConsume = async () => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (consumed) return null;
  consumed = true;
  return stateRecord();
};
const replayHandler = createOAuthCallbackHandler(makeDependencies({ consumeOAuthState: atomicConsume }));
const [firstReplay, secondReplay] = await Promise.all([
  replayHandler(new Request(callbackUrl({ state: rawState, error: 'access_denied' }))),
  replayHandler(new Request(callbackUrl({ state: rawState, error: 'access_denied' })))
]);
assert.deepEqual(
  [firstReplay.headers.get('x-oauth-result'), secondReplay.headers.get('x-oauth-result')].sort(),
  ['cancelled', 'error']
);

let exchangeCalled = false;
const cancelled = await createOAuthCallbackHandler(makeDependencies({
  exchangeAuthorizationCode: async () => { exchangeCalled = true; }
}))(new Request(callbackUrl({ state: rawState, error: 'access_denied', error_description: 'sensitive' })));
assertOAuthRedirect(cancelled, 'cancelled');
assert.equal(exchangeCalled, false, 'cancelamento não deve trocar token');
assert.equal((await cancelled.text()).includes('sensitive'), false);

let receivedVerifier = null;
let persisted = null;
const logs = [];
const success = await createOAuthCallbackHandler(makeDependencies({
  exchangeAuthorizationCode: async (input) => {
    receivedVerifier = input.codeVerifier;
    return {
      accessToken: 'memory-only-access-token',
      refreshToken: 'new-refresh-token',
      scope: 'openid email https://www.googleapis.com/auth/calendar.events.owned',
      tokenType: 'Bearer',
      idToken: 'must-not-persist'
    };
  },
  persistConnection: async (record) => { persisted = record; },
  logger: { error(entry) { logs.push(entry); } }
}))(new Request(callbackUrl({ state: rawState, code: 'one-time-code' })));
assertOAuthRedirect(success, 'connected');
assert.equal(receivedVerifier, verifier, 'PKCE verifier deve ser descriptografado corretamente');
assert.equal(persisted.userId, userId);
assert.equal(persisted.calendarId, 'primary');
assert.equal(persisted.connectionStatus, 'connected');
assert.equal(persisted.googleSubjectHash.length, 64);
assert.equal(persisted.googleAccountHint, 'al***@example.com');
assert.notEqual(persisted.googleAccountHint, 'alexandre@example.com');
assert.equal(persisted.refreshCredential.nonce.byteLength, 12);
assert.equal(persisted.refreshCredential.encryptionKeyVersion, 1);
const serializedPersistence = JSON.stringify(persisted);
for (const forbidden of [
  'memory-only-access-token',
  'one-time-code',
  'must-not-persist',
  'new-refresh-token',
  'stable-google-subject',
  'alexandre@example.com'
]) {
  assert.equal(serializedPersistence.includes(forbidden), false, `${forbidden} não deve persistir`);
}
assert.equal(logs.length, 0);

const calendarScope = oauthCallbackInternals.CALENDAR_SCOPE;
for (const invalidScope of [null, '', 'openid email']) {
  let blockedPersistence = false;
  const scopeLogs = [];
  const scopeBlocked = await createOAuthCallbackHandler(makeDependencies({
    exchangeAuthorizationCode: async () => ({
      accessToken: 'memory-only-access-token',
      refreshToken: 'new-refresh-token',
      scope: invalidScope,
      tokenType: 'Bearer'
    }),
    persistConnection: async () => { blockedPersistence = true; },
    logger: { error(entry) { scopeLogs.push(entry); } }
  }))(new Request(callbackUrl({ state: rawState, code: 'code' })));
  assertOAuthRedirect(scopeBlocked, 'error');
  assert.equal(blockedPersistence, false, 'BLOCK não pode alterar connection/credential');
  assert.equal(scopeLogs[0]?.category, 'required_calendar_scope_not_granted');
}

let grantedOnly = null;
const exactScopes = `${calendarScope} custom.granted.scope`;
const scopeAllowed = await createOAuthCallbackHandler(makeDependencies({
  exchangeAuthorizationCode: async () => ({
    accessToken: 'memory-only-access-token',
    refreshToken: 'new-refresh-token',
    scope: exactScopes,
    tokenType: 'Bearer'
  }),
  persistConnection: async (record) => { grantedOnly = record.grantedScopes; }
}))(new Request(callbackUrl({ state: rawState, code: 'code' })));
assertOAuthRedirect(scopeAllowed, 'connected');
assert.deepEqual(grantedOnly, [calendarScope, 'custom.granted.scope']);
assert.equal(grantedOnly.includes('openid'), false, 'scope ausente não pode ser inventado');

assert.equal(decideRefreshCredential({
  existingSubjectHash: null,
  hasExistingCredential: false,
  newSubjectHash: 'account-a',
  hasNewRefreshToken: true
}), 'replace', 'primeira conexão com refresh novo deve prosseguir');
assert.throws(() => decideRefreshCredential({
  existingSubjectHash: null,
  hasExistingCredential: false,
  newSubjectHash: 'account-a',
  hasNewRefreshToken: false
}), /missing_refresh_token/u);
assert.equal(decideRefreshCredential({
  existingSubjectHash: 'account-a',
  hasExistingCredential: true,
  newSubjectHash: 'account-a',
  hasNewRefreshToken: false
}), 'preserve', 'mesma conta pode preservar credential');

const consistentBefore = Object.freeze({ subjectHash: 'account-a', credential: 'credential-a' });
let consistentAfter = consistentBefore;
assert.throws(() => {
  decideRefreshCredential({
    existingSubjectHash: consistentBefore.subjectHash,
    hasExistingCredential: true,
    newSubjectHash: 'account-b',
    hasNewRefreshToken: false
  });
  consistentAfter = { subjectHash: 'account-b', credential: 'credential-a' };
}, /account_switch_requires_refresh_token/u);
assert.equal(consistentAfter, consistentBefore, 'BLOCK deve preservar metadata e credential antigas');
assert.equal(decideRefreshCredential({
  existingSubjectHash: 'account-a',
  hasExistingCredential: true,
  newSubjectHash: 'account-b',
  hasNewRefreshToken: true
}), 'replace', 'conta diferente com refresh novo pode substituir atomicamente');

const accountSwitchLogs = [];
const accountSwitchBlocked = await createOAuthCallbackHandler(makeDependencies({
  exchangeAuthorizationCode: async () => ({
    accessToken: 'memory-only-access-token',
    refreshToken: null,
    scope: calendarScope,
    tokenType: 'Bearer'
  }),
  persistConnection: async () => { throw new Error('account_switch_requires_refresh_token'); },
  logger: { error(entry) { accountSwitchLogs.push(entry); } }
}))(new Request(callbackUrl({ state: rawState, code: 'code' })));
assertOAuthRedirect(accountSwitchBlocked, 'error');
assert.equal(accountSwitchLogs[0]?.category, 'account_switch_requires_refresh_token');

let requestedRedirectTarget = null;
const wrongRedirectTarget = await createOAuthCallbackHandler(makeDependencies({
  consumeOAuthState: async (_hash, expectedRedirectTarget) => {
    requestedRedirectTarget = expectedRedirectTarget;
    const storedRedirectTarget = 'other-flow';
    return storedRedirectTarget === expectedRedirectTarget ? stateRecord() : null;
  }
}))(new Request(callbackUrl({ state: rawState, code: 'code' })));
assert.equal(requestedRedirectTarget, 'plan');
assertOAuthRedirect(wrongRedirectTarget, 'error');
const callbackIndexSource = await readFile(
  new URL('../../../supabase/functions/google-oauth-callback/index.ts', import.meta.url),
  'utf8'
);
assert.match(
  callbackIndexSource,
  /update private\.google_oauth_states[\s\S]*and redirect_target = \$\{redirectTarget\}[\s\S]*returning/u,
  'redirect_target deve integrar o mesmo UPDATE atômico'
);
assert.ok(
  callbackIndexSource.indexOf('select id, user_id, google_subject_hash') <
    callbackIndexSource.indexOf('insert into public.google_calendar_connections'),
  'identidade anterior deve ser bloqueada antes de sobrescrever metadata'
);

let invalidKeyPersisted = false;
const invalidKey = await createOAuthCallbackHandler(makeDependencies({
  getEnv: (name) => name === 'GOOGLE_TOKEN_ENCRYPTION_KEY'
    ? Buffer.from(new Uint8Array(16)).toString('base64')
    : 'configured',
  persistConnection: async () => { invalidKeyPersisted = true; }
}))(new Request(callbackUrl({ state: rawState, code: 'code' })));
assertOAuthRedirect(invalidKey, 'error');
assert.equal(invalidKeyPersisted, false);

let failedExchangePersisted = false;
const exchangeError = new Error('token_exchange_failed');
exchangeError.httpStatus = 400;
const exchangeFailed = await createOAuthCallbackHandler(makeDependencies({
  exchangeAuthorizationCode: async () => { throw exchangeError; },
  persistConnection: async () => { failedExchangePersisted = true; }
}))(new Request(callbackUrl({ state: rawState, code: 'code' })));
assertOAuthRedirect(exchangeFailed, 'error');
assert.equal(failedExchangePersisted, false);

const missingRefresh = await createOAuthCallbackHandler(makeDependencies({
  exchangeAuthorizationCode: async () => ({
    accessToken: 'memory-only-access-token',
    refreshToken: null,
    scope: 'openid email',
    tokenType: 'Bearer'
  }),
  persistConnection: async (record) => {
    assert.equal(record.refreshCredential, null);
    throw new Error('missing_refresh_token');
  }
}))(new Request(callbackUrl({ state: rawState, code: 'code' })));
assertOAuthRedirect(missingRefresh, 'error');

const wrongMethod = await createOAuthCallbackHandler(makeDependencies())(
  new Request(callbackUrl(), { method: 'POST' })
);
assert.equal(wrongMethod.status, 405);
assert.equal(wrongMethod.headers.get('allow'), 'GET');

for (const response of [noState, invalidKey, exchangeFailed, missingRefresh]) {
  const text = await response.text();
  for (const forbidden of ['safe-state-value', 'one-time-code', 'test-only-client-secret']) {
    assert.equal(text.includes(forbidden), false, 'resposta não deve expor segredo');
  }
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'none'/u);
}

console.log('GOOGLE-OAUTH-CALLBACK TESTS: PASS');
