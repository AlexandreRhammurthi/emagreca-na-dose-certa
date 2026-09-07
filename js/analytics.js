(function initializeProductAnalytics() {
  'use strict';

  const client = window.supabaseClient;
  const simulatorFlag = 'dosecerta:simulator-result-ready';
  let authenticated = false;

  function markSimulatorResult() {
    try { sessionStorage.setItem(simulatorFlag, '1'); } catch { /* Storage is optional for this metric. */ }
  }

  function simulatedInSession() {
    try { return sessionStorage.getItem(simulatorFlag) === '1'; } catch { return false; }
  }

  function clearSimulatorFlag() {
    try { sessionStorage.removeItem(simulatorFlag); } catch { /* Storage is optional for this metric. */ }
  }

  async function track(eventName, { source, actionKind = 'none', simulatedInSession: simulated = false } = {}) {
    if (!client || !authenticated) return;
    const { error } = await client.functions.invoke('record-product-event', {
      body: {
        event_name: eventName,
        source,
        action_kind: actionKind,
        simulated_in_session: Boolean(simulated)
      }
    });
    if (error) console.info('Métrica de produto não registrada.', { category: 'event_not_recorded' });
  }

  window.DoseAnalytics = Object.freeze({
    accountCreated: () => {
      const simulated = simulatedInSession();
      track('account_created', { source: 'onboarding', simulatedInSession: simulated });
      clearSimulatorFlag();
    },
    onboardingCompleted: () => track('onboarding_completed', { source: 'onboarding' }),
    firstProductAction: (actionKind, source) => track('first_product_action', { actionKind, source })
  });

  document.addEventListener('dosecerta:simulation', ({ detail }) => {
    if (detail && !authenticated) markSimulatorResult();
  });
  document.addEventListener('dosecerta:account-created', () => window.DoseAnalytics.accountCreated());
  document.addEventListener('dosecerta:application-confirmed', () => window.DoseAnalytics.firstProductAction('application', 'diary'));
  document.addEventListener('dosecerta:auth-session', ({ detail }) => {
    authenticated = Boolean(detail?.user);
    if (authenticated) track('product_returned', { source: 'onboarding' });
  });
})();
