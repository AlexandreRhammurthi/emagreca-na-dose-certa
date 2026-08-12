const CONNECTION_FIELDS = 'connection_status,google_account_hint,calendar_id,updated_at';
const VALID_CONNECTION_STATES = new Set(['connected', 'expired', 'revoked', 'disconnected', 'error']);
const VALID_OAUTH_RESULTS = new Set(['connected', 'cancelled', 'error']);
const GOOGLE_AUTH_HOST = 'accounts.google.com';
const GOOGLE_AUTH_PATH = '/o/oauth2/v2/auth';

export function parseGoogleCalendarReturn(href) {
  const url = new URL(href);
  const value = url.searchParams.get('google_calendar');
  if (!VALID_OAUTH_RESULTS.has(value)) return { result: null, cleanUrl: null };
  url.searchParams.delete('google_calendar');
  return { result: value, cleanUrl: `${url.pathname}${url.search}${url.hash}` };
}

export function validateGoogleAuthorizationUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === GOOGLE_AUTH_HOST && url.pathname === GOOGLE_AUTH_PATH
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function connectionView(connection) {
  if (!connection) {
    return { state: 'not_connected', status: 'Não conectado', action: 'Conectar Google Agenda', account: '', message: '' };
  }
  const state = VALID_CONNECTION_STATES.has(connection.connection_status)
    ? connection.connection_status
    : 'error';
  if (state === 'connected') {
    return {
      state,
      status: 'Conectado',
      action: 'Trocar conta',
      account: connection.google_account_hint ? `Conta: ${connection.google_account_hint}` : '',
      message: ''
    };
  }
  const views = {
    expired: {
      status: 'Conexão expirada',
      action: 'Reconectar',
      message: 'É necessário reconectar sua conta Google.'
    },
    revoked: {
      status: 'Permissão removida',
      action: 'Reconectar',
      message: 'Autorize novamente o acesso ao Google Agenda.'
    },
    error: {
      status: 'Problema na conexão',
      action: 'Tentar novamente',
      message: 'Não foi possível validar a conexão com o Google Agenda.'
    },
    disconnected: {
      status: 'Não conectado',
      action: 'Conectar Google Agenda',
      message: ''
    }
  };
  return { state, account: '', ...views[state] };
}

export function googleOAuthFeedback(result, connection = null) {
  if (result === 'connected') {
    return connection?.connection_status === 'connected'
      ? ['Google Agenda conectado com sucesso.', 'success']
      : ['Não foi possível confirmar a conexão com o Google Agenda. Tente novamente.', 'error'];
  }
  return {
    cancelled: ['Conexão com Google Agenda cancelada.', 'info'],
    error: ['Não foi possível conectar ao Google Agenda. Tente novamente.', 'error']
  }[result] || null;
}

export function createGoogleCalendarController({ client, elements, showToast, navigate, logger = console }) {
  let requestInFlight = false;
  let loadSequence = 0;

  function render(connection, loading = false) {
    elements.card.hidden = false;
    elements.status.classList.remove('is-connected');
    if (loading) {
      elements.status.textContent = 'Verificando conexão...';
      elements.account.hidden = true;
      elements.message.hidden = true;
      elements.action.textContent = 'Aguarde...';
      elements.action.disabled = true;
      return;
    }
    const view = connectionView(connection);
    elements.card.dataset.connectionStatus = view.state;
    elements.status.textContent = view.status;
    elements.status.classList.toggle('is-connected', view.state === 'connected');
    elements.account.textContent = view.account;
    elements.account.hidden = !view.account;
    elements.message.textContent = view.message;
    elements.message.hidden = !view.message;
    elements.action.textContent = view.action;
    elements.action.disabled = false;
  }

  async function loadConnection() {
    const sequence = ++loadSequence;
    render(null, true);
    try {
      const result = await client.from('google_calendar_connections')
        .select(CONNECTION_FIELDS)
        .maybeSingle();
      if (sequence !== loadSequence) return null;
      if (result.error) {
        logger.error('Google Agenda: falha ao consultar conexão.', { code: result.error.code || 'unknown' });
        render({ connection_status: 'error' });
        return null;
      }
      render(result.data || null);
      return result.data || null;
    } catch (error) {
      if (sequence !== loadSequence) return null;
      logger.error('Google Agenda: falha ao consultar conexão.', { code: error?.code || 'unknown' });
      render({ connection_status: 'error' });
      return null;
    }
  }

  async function connect() {
    if (requestInFlight) return false;
    requestInFlight = true;
    const previousLabel = elements.action.textContent;
    elements.action.disabled = true;
    elements.action.textContent = 'Conectando...';
    elements.action.setAttribute('aria-busy', 'true');
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData.session) {
        showToast('Entre na sua conta para conectar o Google Agenda.', 'info');
        return false;
      }
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user || userData.user.id !== sessionData.session.user.id) {
        showToast('Entre na sua conta para conectar o Google Agenda.', 'info');
        return false;
      }
      const { data, error } = await client.functions.invoke('google-oauth-start', { method: 'POST' });
      if (error) throw error;
      const authorizationUrl = validateGoogleAuthorizationUrl(data?.authorization_url);
      if (!authorizationUrl) throw new Error('invalid_authorization_url');
      navigate(authorizationUrl);
      return true;
    } catch (error) {
      logger.error('Google Agenda: não foi possível iniciar OAuth.', { code: error?.code || 'unknown' });
      showToast('Não foi possível conectar ao Google Agenda. Tente novamente.', 'error');
      return false;
    } finally {
      requestInFlight = false;
      elements.action.disabled = false;
      elements.action.textContent = previousLabel;
      elements.action.setAttribute('aria-busy', 'false');
    }
  }

  function reset() {
    loadSequence += 1;
    elements.card.hidden = true;
    elements.card.removeAttribute('data-connection-status');
  }

  return Object.freeze({ loadConnection, connect, render, reset });
}

function initializeGoogleCalendarIntegration() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const client = window.supabaseClient;
  const elements = {
    card: document.getElementById('google-calendar-card'),
    status: document.getElementById('google-calendar-status'),
    account: document.getElementById('google-calendar-account'),
    message: document.getElementById('google-calendar-message'),
    action: document.getElementById('google-calendar-action')
  };
  const section = document.getElementById('plan-section');
  if (!client || !section || Object.values(elements).some((element) => !element)) return;

  const oauthReturn = parseGoogleCalendarReturn(window.location.href);
  if (oauthReturn.result) window.history.replaceState(window.history.state, '', oauthReturn.cleanUrl);

  const controller = createGoogleCalendarController({
    client,
    elements,
    showToast: (message, type) => window.showToast?.(message, type),
    navigate: (url) => window.location.assign(url),
    logger: console
  });
  let currentUserId = null;
  let oauthResultProcessed = false;
  let sessionSequence = 0;

  async function applySession(session) {
    const sequence = ++sessionSequence;
    const userId = session?.user?.id || null;
    currentUserId = userId;
    if (!userId) {
      controller.reset();
      return;
    }
    const connection = await controller.loadConnection();
    if (sequence !== sessionSequence || currentUserId !== userId) return;
    if (!oauthReturn.result || oauthResultProcessed) return;
    oauthResultProcessed = true;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const feedback = googleOAuthFeedback(oauthReturn.result, connection);
    window.showToast?.(...feedback);
    window.setTimeout(() => elements.action.focus({ preventScroll: true }), 300);
  }

  elements.action.addEventListener('click', () => controller.connect());
  client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => applySession(session), 0);
  });
  client.auth.getSession().then(({ data, error }) => {
    if (!error) applySession(data.session);
  });
}

initializeGoogleCalendarIntegration();

export const googleCalendarInternals = Object.freeze({
  CONNECTION_FIELDS,
  VALID_OAUTH_RESULTS,
  GOOGLE_AUTH_HOST,
  GOOGLE_AUTH_PATH
});
