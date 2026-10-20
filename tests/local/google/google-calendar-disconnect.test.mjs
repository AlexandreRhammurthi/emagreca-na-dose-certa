import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { createGoogleCalendarDisconnectHandler } = await import(
  '../../../supabase/functions/google-calendar-disconnect/core.js'
);

let disconnectedUserId = null;
function makeHandler(overrides = {}) {
  return createGoogleCalendarDisconnectHandler({
    authenticate: async (jwt) => {
      if (jwt !== 'valid-test-jwt') throw new Error('invalid_jwt');
      return '00000000-0000-4000-8000-000000000001';
    },
    disconnect: async (userId) => { disconnectedUserId = userId; },
    logger: { error() {} },
    ...overrides
  });
}

assert.equal((await makeHandler()(new Request('https://function.test', { method: 'GET' }))).status, 405);
assert.equal((await makeHandler()(new Request('https://function.test', { method: 'POST' }))).status, 401);
assert.equal((await makeHandler()(new Request('https://function.test', {
  method: 'POST', headers: { Authorization: 'Bearer invalid-test-jwt' }
}))).status, 401);

disconnectedUserId = null;
const success = await makeHandler()(new Request('https://function.test', {
  method: 'POST',
  headers: { Authorization: 'Bearer valid-test-jwt', Origin: 'http://localhost:8000' }
}));
assert.equal(success.status, 200);
assert.deepEqual(await success.json(), { success: true });
assert.equal(disconnectedUserId, '00000000-0000-4000-8000-000000000001');
assert.equal(success.headers.get('access-control-allow-origin'), 'http://localhost:8000');

assert.equal((await makeHandler()(new Request('https://function.test', {
  method: 'OPTIONS', headers: { Origin: 'https://emagrecanadosecerta.com.br' }
}))).status, 204);
assert.equal((await makeHandler()(new Request('https://function.test', {
  method: 'POST', headers: { Authorization: 'Bearer valid-test-jwt', Origin: 'https://untrusted.example' }
}))).status, 403);
assert.equal((await makeHandler({ disconnect: async () => { throw new Error('db_failure'); } })(new Request('https://function.test', {
  method: 'POST', headers: { Authorization: 'Bearer valid-test-jwt' }
}))).status, 500);

console.log('GOOGLE-CALENDAR-DISCONNECT TESTS: PASS');
