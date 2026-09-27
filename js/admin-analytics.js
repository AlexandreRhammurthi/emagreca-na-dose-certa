(function initializeAdminAnalytics() {
  'use strict';

  const client = window.supabaseClient;
  const login = document.getElementById('admin-login');
  const dashboard = document.getElementById('admin-dashboard');
  const form = document.getElementById('admin-login-form');
  const message = document.getElementById('admin-login-message');
  const status = document.getElementById('admin-status');
  const signout = document.getElementById('admin-signout');
  const refresh = document.getElementById('admin-refresh');
  let loading = false;

  const formatNumber = (value) => new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
  const formatPercent = (value) => `${Math.round((Number(value) || 0) * 100)}%`;

  function setLoginMessage(text) {
    message.textContent = text;
    message.hidden = !text;
  }

  function setLoading(next) {
    loading = next;
    form.querySelectorAll('input, button').forEach((element) => { element.disabled = next; });
    refresh.disabled = next;
  }

  function clearDashboard() {
    dashboard.hidden = true;
    login.hidden = false;
    signout.hidden = true;
    status.textContent = '';
  }

  function textElement(tag, text, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function renderMetrics(metrics) {
    const cards = [
      ['Novas contas', formatNumber(metrics.new_accounts), 'Contas criadas no período'],
      ['Conclusão de onboarding', formatPercent(metrics.onboarding_completion_rate), `${formatNumber(metrics.onboarding_completed)} usuários`],
      ['Ativação', formatPercent(metrics.activation_rate), `${formatNumber(metrics.first_product_action)} primeira ação`],
      ['Retorno D7', formatPercent(metrics.d7_return_rate), `${formatNumber(metrics.d7_returned)} retornos observados`],
      ['Simulação → conta', formatPercent(metrics.simulation_to_account_rate), `${formatNumber(metrics.accounts_after_simulation)} contas`]
    ];
    const target = document.getElementById('admin-metrics');
    target.replaceChildren(...cards.map(([label, value, note]) => {
      const card = textElement('article', '', 'admin-metric');
      card.append(textElement('span', label), textElement('strong', value), textElement('small', note));
      return card;
    }));
  }

  function renderFunnel(funnel) {
    const labels = [['account_created', 'Conta criada'], ['onboarding_completed', 'Onboarding concluído'], ['first_product_action', 'Primeira ação'], ['product_returned', 'Retorno']];
    document.getElementById('admin-funnel').replaceChildren(...labels.map(([key, label]) => {
      const item = textElement('li', '', 'admin-funnel-step');
      item.append(textElement('span', label), textElement('strong', formatNumber(funnel[key])));
      return item;
    }));
  }

  function renderAdoption(adoption) {
    const labels = { application: 'Aplicação', weight: 'Peso', plan: 'Plano', google_calendar: 'Google Agenda' };
    document.getElementById('admin-adoption').replaceChildren(...Object.entries(labels).map(([key, label]) => {
      const item = textElement('li', '', 'admin-adoption-row');
      item.append(textElement('span', label), textElement('strong', formatNumber(adoption[key])));
      return item;
    }));
  }

  function renderInsights(insights, sufficientData) {
    const target = document.getElementById('admin-insights');
    if (!sufficientData) {
      target.replaceChildren(textElement('p', 'Dados insuficientes para gerar insights. A coorte mínima é de 30 contas nos últimos 7 dias.', 'admin-empty'));
      return;
    }
    if (!insights.length) {
      target.replaceChildren(textElement('p', 'Nenhum alerta relevante no período analisado.', 'admin-empty'));
      return;
    }
    target.replaceChildren(...insights.map((insight) => {
      const item = textElement('article', '', 'admin-insight');
      item.append(textElement('h3', insight.title), textElement('p', insight.message), textElement('small', insight.recommendation));
      return item;
    }));
  }

  function render(data) {
    document.getElementById('admin-period').textContent = `Período: ${data.period.label}. Dados agregados de ${formatNumber(data.cohort_size)} contas.`;
    renderMetrics(data.metrics);
    renderFunnel(data.funnel);
    renderAdoption(data.adoption);
    renderInsights(data.insights, data.sufficient_data);
  }

  function errorMessage(error) {
    const code = String(error?.context?.error || error?.message || '').toLowerCase();
    if (code.includes('access_denied') || code.includes('forbidden')) return 'Esta conta não possui acesso ao painel administrativo.';
    if (code.includes('unauthorized')) return 'Sua sessão expirou. Entre novamente.';
    return 'Não foi possível carregar os indicadores. Tente novamente.';
  }

  async function loadDashboard() {
    if (!client || loading) return;
    setLoading(true);
    status.textContent = 'Carregando indicadores agregados…';
    const { data, error } = await client.functions.invoke('admin-product-analytics', { body: {} });
    setLoading(false);
    if (error || !data || typeof data !== 'object') {
      clearDashboard();
      setLoginMessage(errorMessage(error));
      return;
    }
    login.hidden = true;
    dashboard.hidden = false;
    signout.hidden = false;
    status.textContent = '';
    render(data);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client || loading) {
      setLoginMessage('A autenticação não está disponível neste momento.');
      return;
    }
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    if (!email || !password) {
      setLoginMessage('Informe e-mail e senha.');
      return;
    }
    setLoginMessage('');
    setLoading(true);
    const { error } = await client.auth.signInWithPassword({ email, password });
    form.elements.password.value = '';
    setLoading(false);
    if (error) {
      setLoginMessage('Não foi possível entrar com os dados informados.');
      return;
    }
    loadDashboard();
  });

  refresh.addEventListener('click', loadDashboard);
  signout.addEventListener('click', async () => {
    if (!client || loading) return;
    await client.auth.signOut();
    clearDashboard();
    form.reset();
    document.getElementById('admin-email').focus();
  });

  if (!client) {
    setLoginMessage('A autenticação não está disponível neste momento.');
    return;
  }
  client.auth.onAuthStateChange((_event, session) => { if (!session) clearDashboard(); });
  client.auth.getSession().then(({ data }) => { if (data.session) loadDashboard(); });
})();
