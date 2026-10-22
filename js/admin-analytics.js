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
  const formatPercent = (value) => Number.isFinite(Number(value)) && value !== null ? `${Math.round(Number(value) * 100)}%` : '—';
  const formatDay = (value) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00.000Z`));

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

  function renderMetrics(metrics, accountCohortAvailable, simulationTelemetryAvailable) {
    const unavailableNote = 'Indisponível sem coorte de novas contas';
    const cards = [
      ['Total de usuários', formatNumber(metrics.total_registered_users), 'Todas as contas cadastradas'],
      ['Novas contas', formatNumber(metrics.new_accounts), 'Contas criadas no período'],
      ['Conclusão de onboarding', formatPercent(metrics.onboarding_completion_rate), accountCohortAvailable ? `${formatNumber(metrics.onboarding_completed)} usuários` : unavailableNote],
      ['Ativação', formatPercent(metrics.activation_rate), accountCohortAvailable ? `${formatNumber(metrics.first_product_action)} primeira ação` : unavailableNote],
      ['Retorno D7', formatPercent(metrics.d7_return_rate), `${formatNumber(metrics.d7_returned)} retornos observados`],
      ['Simulação → conta', formatPercent(metrics.simulation_to_account_rate), simulationTelemetryAvailable ? `${formatNumber(metrics.accounts_after_simulation)} contas` : 'Indisponível sem telemetria de simulação']
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

  function renderCensusRows(targetId, values) {
    const target = document.getElementById(targetId);
    if (!values?.length) {
      target.replaceChildren(textElement('p', 'Dados insuficientes para exibir grupos preservando a privacidade.', 'admin-empty'));
      return;
    }
    target.replaceChildren(...values.map((item) => {
      const row = textElement('li', '', 'admin-adoption-row');
      row.append(textElement('span', item.label), textElement('strong', formatNumber(item.count)));
      return row;
    }));
  }

  function renderCensus(census) {
    document.getElementById('admin-census-note').textContent = `${formatNumber(census.profiled_users)} perfis concluídos. Categorias com menos de ${formatNumber(census.minimum_group_size)} pessoas são agrupadas.`;
    renderCensusRows('admin-census-gender', census.gender);
    renderCensusRows('admin-census-age', census.age_bands);
    renderCensusRows('admin-census-city', census.cities);
  }

  function renderGrowth(growth) {
    const target = document.getElementById('admin-growth-chart');
    const note = document.getElementById('admin-growth-note');
    const total = document.getElementById('admin-growth-total');
    const days = Array.isArray(growth?.days) ? growth.days.filter((item) => typeof item?.day === 'string' && Number.isFinite(Number(item.total))) : [];
    total.textContent = `${formatNumber(growth?.total_registered_users)} usuários`;
    if (!days.length) {
      note.textContent = 'Ainda não há cadastros para compor a evolução histórica.';
      target.replaceChildren(textElement('p', 'O gráfico aparecerá após o primeiro cadastro.', 'admin-empty'));
      return;
    }
    note.textContent = `Evolução cumulativa de ${formatDay(days[0].day)} até ${formatDay(days.at(-1).day)}.`;
    const width = 920;
    const height = 260;
    const padding = { top: 20, right: 18, bottom: 38, left: 46 };
    const values = days.map((item) => Number(item.total));
    const maximum = Math.max(...values, 1);
    const x = (index) => padding.left + ((width - padding.left - padding.right) * index / Math.max(days.length - 1, 1));
    const y = (value) => height - padding.bottom - ((height - padding.top - padding.bottom) * value / maximum);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const namespace = 'http://www.w3.org/2000/svg';
    [0, maximum / 2, maximum].forEach((value) => {
      const line = document.createElementNS(namespace, 'line');
      line.setAttribute('x1', String(padding.left)); line.setAttribute('x2', String(width - padding.right));
      line.setAttribute('y1', String(y(value))); line.setAttribute('y2', String(y(value))); line.setAttribute('class', 'admin-growth-gridline');
      svg.append(line);
      const label = document.createElementNS(namespace, 'text');
      label.setAttribute('x', String(padding.left - 9)); label.setAttribute('y', String(y(value) + 4)); label.setAttribute('text-anchor', 'end'); label.setAttribute('class', 'admin-growth-axis');
      label.textContent = formatNumber(Math.round(value)); svg.append(label);
    });
    const line = document.createElementNS(namespace, 'polyline');
    line.setAttribute('points', days.map((item, index) => `${x(index)},${y(Number(item.total))}`).join(' '));
    line.setAttribute('class', 'admin-growth-line'); svg.append(line);
    [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((value, index, array) => array.indexOf(value) === index).forEach((index) => {
      const label = document.createElementNS(namespace, 'text');
      label.setAttribute('x', String(x(index))); label.setAttribute('y', String(height - 12)); label.setAttribute('text-anchor', index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle'); label.setAttribute('class', 'admin-growth-axis');
      label.textContent = formatDay(days[index].day); svg.append(label);
    });
    target.replaceChildren(svg);
    target.setAttribute('aria-label', `Crescimento cumulativo de usuários: ${formatNumber(values[0])} no início e ${formatNumber(values.at(-1))} no fim do período.`);
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
    renderMetrics(data.metrics, Boolean(data.account_cohort_available), Boolean(data.simulation_telemetry_available));
    renderFunnel(data.funnel);
    renderAdoption(data.adoption);
    renderCensus(data.census);
    renderGrowth(data.registration_growth);
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
