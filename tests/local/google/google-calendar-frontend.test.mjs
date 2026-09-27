import assert from 'node:assert/strict';

const {
  connectionView,
  createGoogleCalendarController,
  googleOAuthFeedback,
  parseGoogleCalendarReturn,
  validateGoogleAuthorizationUrl,
  googleCalendarInternals
} = await import('../../../js/google-calendar.js');

function fakeElement() {
  const classes = new Set();
  const attributes = new Map();
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    dataset: {},
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      contains: (name) => classes.has(name)
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) ?? null,
    removeAttribute: (name) => attributes.delete(name)
  };
}

function elements() {
  return {
    card: fakeElement(),
    status: fakeElement(),
    account: fakeElement(),
    message: fakeElement(),
    action: fakeElement()
  };
}

function clientWith({ connection = null, connectionError = null, session = true, invoke } = {}) {
  const calls = { tables: [], fields: [], invokes: 0 };
  const user = { id: '00000000-0000-4000-8000-000000000001' };
  return {
    calls,
    from(table) {
      calls.tables.push(table);
      return {
        select(fields) {
          calls.fields.push(fields);
          return { maybeSingle: async () => ({ data: connection, error: connectionError }) };
        }
      };
    },
    auth: {
      getSession: async () => ({ data: { session: session ? { user } : null }, error: null }),
      getUser: async () => ({ data: { user: session ? user : null }, error: null })
    },
    functions: {
      async invoke(name, options) {
        calls.invokes += 1;
        assert.equal(name, 'google-oauth-start');
        assert.deepEqual(options, { method: 'POST' });
        return invoke ? invoke() : { data: null, error: new Error('not configured') };
      }
    }
  };
}

function controllerFixture(options = {}) {
  const ui = elements();
  const toasts = [];
  const navigations = [];
  const client = clientWith(options);
  const controller = createGoogleCalendarController({
    client,
    elements: ui,
    showToast: (...toast) => toasts.push(toast),
    navigate: (url) => navigations.push(url),
    logger: { error() {} }
  });
  return { controller, ui, toasts, navigations, client };
}

const disconnected = controllerFixture();
const disconnectedConnection = await disconnected.controller.loadConnection();
assert.equal(disconnected.ui.status.textContent, 'Não conectado');
assert.equal(disconnected.ui.action.textContent, 'Conectar Google Agenda');
assert.deepEqual(
  googleOAuthFeedback('connected', disconnectedConnection),
  ['Não foi possível confirmar a conexão com o Google Agenda. Tente novamente.', 'error']
);

const connected = controllerFixture({
  connection: { connection_status: 'connected', google_account_hint: 'ar***@gmail.com', calendar_id: 'primary' }
});
const connectedConnection = await connected.controller.loadConnection();
assert.equal(connected.ui.status.textContent, 'Conectado');
assert.equal(connected.ui.account.textContent, 'Conta: ar***@gmail.com');
assert.equal(connected.ui.action.textContent, 'Trocar conta');
assert.deepEqual(
  googleOAuthFeedback('connected', connectedConnection),
  ['Google Agenda conectado com sucesso.', 'success']
);
assert.deepEqual(
  googleOAuthFeedback('cancelled', connectedConnection),
  ['Conexão com Google Agenda cancelada.', 'info']
);
assert.deepEqual(
  googleOAuthFeedback('error', connectedConnection),
  ['Não foi possível conectar ao Google Agenda. Tente novamente.', 'error']
);

const switchAccount = controllerFixture({
  connection: { connection_status: 'connected', google_account_hint: 'ar***@gmail.com' },
  invoke: async () => ({
    data: { authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=switch-account' },
    error: null
  })
});
await switchAccount.controller.loadConnection();
assert.equal(switchAccount.ui.action.textContent, 'Trocar conta');
assert.equal(await switchAccount.controller.connect(), true);
assert.equal(switchAccount.client.calls.invokes, 1, 'Trocar conta deve reutilizar o mesmo OAuth start');

const stateExpectations = {
  expired: ['Conexão expirada', 'É necessário reconectar sua conta Google.', 'Reconectar'],
  revoked: ['Permissão removida', 'Autorize novamente o acesso ao Google Agenda.', 'Reconectar'],
  error: ['Problema na conexão', 'Não foi possível validar a conexão com o Google Agenda.', 'Tentar novamente'],
  disconnected: ['Não conectado', '', 'Conectar Google Agenda']
};
for (const [state, [expectedStatus, expectedMessage, expectedAction]] of Object.entries(stateExpectations)) {
  const fixture = controllerFixture({ connection: { connection_status: state } });
  await fixture.controller.loadConnection();
  assert.equal(fixture.ui.status.textContent, expectedStatus);
  assert.equal(fixture.ui.action.textContent, expectedAction);
  assert.equal(fixture.ui.message.textContent, expectedMessage);
}

const queryFailure = controllerFixture({ connectionError: { code: 'query_failed' } });
const failedConnection = await queryFailure.controller.loadConnection();
assert.equal(failedConnection, null);
assert.equal(queryFailure.ui.card.dataset.connectionStatus, 'error');
assert.equal(queryFailure.ui.status.textContent, 'Problema na conexão');
assert.equal(queryFailure.ui.action.textContent, 'Tentar novamente');
assert.deepEqual(
  googleOAuthFeedback('connected', failedConnection),
  ['Não foi possível confirmar a conexão com o Google Agenda. Tente novamente.', 'error']
);

const noSession = controllerFixture({ session: false });
noSession.controller.render(null);
assert.equal(await noSession.controller.connect(), false);
assert.equal(noSession.client.calls.invokes, 0);
assert.deepEqual(noSession.toasts[0], ['Entre na sua conta para conectar o Google Agenda.', 'info']);

let resolveInvocation;
const invocation = new Promise((resolve) => { resolveInvocation = resolve; });
const doubleClick = controllerFixture({ invoke: () => invocation });
doubleClick.controller.render(null);
const firstClick = doubleClick.controller.connect();
const secondClick = await doubleClick.controller.connect();
assert.equal(secondClick, false);
resolveInvocation({
  data: { authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=temporary' },
  error: null
});
assert.equal(await firstClick, true);
assert.equal(doubleClick.client.calls.invokes, 1);
assert.equal(doubleClick.navigations.length, 1);

const failedStart = controllerFixture({ invoke: async () => ({ data: null, error: new Error('network') }) });
failedStart.controller.render(null);
assert.equal(await failedStart.controller.connect(), false);
assert.equal(failedStart.ui.action.disabled, false);
assert.equal(failedStart.ui.action.getAttribute('aria-busy'), 'false');
assert.equal(failedStart.ui.action.textContent, 'Conectar Google Agenda');

assert.equal(
  validateGoogleAuthorizationUrl('https://accounts.google.com/o/oauth2/v2/auth?state=memory-only'),
  'https://accounts.google.com/o/oauth2/v2/auth?state=memory-only'
);
assert.equal(validateGoogleAuthorizationUrl('https://evil.example/o/oauth2/v2/auth'), null);
assert.equal(validateGoogleAuthorizationUrl('javascript:alert(1)'), null);

for (const result of ['connected', 'cancelled', 'error']) {
  const parsed = parseGoogleCalendarReturn(`https://emagrecanadosecerta.com.br/?view=plan&google_calendar=${result}`);
  assert.equal(parsed.result, result);
  assert.equal(parsed.cleanUrl, '/?view=plan');
}
assert.deepEqual(
  googleOAuthFeedback('connected', { connection_status: 'connected' }),
  ['Google Agenda conectado com sucesso.', 'success']
);
assert.deepEqual(
  googleOAuthFeedback('connected', null),
  ['Não foi possível confirmar a conexão com o Google Agenda. Tente novamente.', 'error']
);
assert.deepEqual(
  googleOAuthFeedback('connected', { connection_status: 'error' }),
  ['Não foi possível confirmar a conexão com o Google Agenda. Tente novamente.', 'error']
);
assert.deepEqual(
  googleOAuthFeedback('cancelled', { connection_status: 'connected' }),
  ['Conexão com Google Agenda cancelada.', 'info']
);
assert.deepEqual(
  googleOAuthFeedback('error', { connection_status: 'connected' }),
  ['Não foi possível conectar ao Google Agenda. Tente novamente.', 'error']
);
assert.equal(googleOAuthFeedback('forged'), null);
const invalidReturn = parseGoogleCalendarReturn('https://emagrecanadosecerta.com.br/?google_calendar=forged');
assert.deepEqual(invalidReturn, { result: null, cleanUrl: null });

assert.equal(connected.client.calls.tables[0], 'google_calendar_connections');
assert.equal(connected.client.calls.tables.some((table) => table.includes('private')), false);
assert.equal(
  connected.client.calls.fields[0],
  'connection_status,google_account_hint,calendar_id,updated_at'
);
assert.equal(connectionView(null).status, 'Não conectado');
assert.equal(googleCalendarInternals.VALID_OAUTH_RESULTS.has('connected'), true);

console.log('GOOGLE CALENDAR FRONTEND TESTS: PASS');
