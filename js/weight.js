(function initializeWeightHistory() {
  'use strict';

  const client = window.supabaseClient;
  const section = document.getElementById('weight-section');
  const status = document.getElementById('weight-status');
  const list = document.getElementById('weight-list');
  const chart = document.getElementById('weight-chart');
  const details = document.getElementById('weight-details');
  const detailsToggle = document.getElementById('weight-details-toggle');
  const detailsClose = document.getElementById('weight-details-close');
  const navButton = document.getElementById('weight-nav');
  const registerButton = document.getElementById('weight-register');
  const modal = document.getElementById('weight-form-modal');
  const deleteModal = document.getElementById('weight-delete-modal');
  const form = document.getElementById('weight-form');
  const message = document.getElementById('weight-form-message');
  const deleteMessage = document.getElementById('weight-delete-message');
  const notes = document.getElementById('weight-notes');
  const records = new Map();
  let currentUserId = null;
  let requestInFlight = false;
  let returnFocus = null;
  let editingId = null;
  let deletingId = null;

  function todayCivil() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatCivilDate(value) {
    const [year, month, day] = String(value || '').split('-').map(Number);
    if (!year || !month || !day) return 'Data não informada';
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  }

  function formatWeight(value) {
    return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  }

  function parseWeight(value) {
    const normalized = String(value || '').trim();
    if (!/^\d+(?:[.,]\d+)?$/u.test(normalized)) return Number.NaN;
    const weight = Number(normalized.replace(',', '.'));
    return Number.isFinite(weight) && weight > 0 ? weight : Number.NaN;
  }

  function validCivilDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ''));
    if (!match) return false;
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function showToast(text, type = 'info') {
    if (typeof window.showToast === 'function') window.showToast(text, type);
  }

  function reportTechnicalError(context, error) {
    console.error(`Meu Peso: ${context}`, { code: error?.code || 'unknown', message: error?.message || 'unknown' });
  }

  function friendlyError(error, fallback) {
    const text = String(error?.message || '').toLowerCase();
    if (text.includes('jwt') || text.includes('session')) return 'Sua sessão expirou. Entre novamente.';
    if (text.includes('fetch') || text.includes('network')) return 'Não foi possível conectar. Verifique sua internet.';
    return fallback;
  }

  function setMessage(text = '') {
    message.textContent = text;
    message.hidden = !text;
  }

  function setDetailsVisible(visible, restoreFocus = false) {
    details.hidden = !visible;
    detailsToggle.setAttribute('aria-expanded', String(visible));
    detailsToggle.textContent = visible ? 'Fechar detalhes' : 'Ver detalhes';
    if (restoreFocus) {
      detailsToggle.focus({ preventScroll: true });
      document.getElementById('weight-evolution-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function focusableElements(targetModal) {
    return [...targetModal.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')]
      .filter((element) => element.offsetParent !== null);
  }

  function openModal(trigger, record = null) {
    returnFocus = trigger || document.activeElement;
    editingId = record?.id || null;
    form.reset();
    form.elements.record_date.value = record?.record_date || todayCivil();
    form.elements.weight_kg.value = record ? String(Number(record.weight_kg)).replace('.', ',') : '';
    form.elements.notes.value = record?.notes || '';
    document.getElementById('weight-form-title').textContent = record ? 'Editar peso' : 'Registrar peso';
    document.getElementById('weight-form-subtitle').textContent = record ? 'Atualize os dados deste registro diário.' : 'Adicione uma medição ao seu histórico.';
    document.getElementById('weight-submit-label').textContent = record ? 'Salvar alterações' : 'Registrar peso';
    document.getElementById('weight-notes-count').textContent = `${form.elements.notes.value.length}/500`;
    setMessage();
    modal.hidden = false;
    document.body.classList.add('auth-modal-open');
    window.requestAnimationFrame(() => form.elements.record_date.focus());
  }

  function closeModal(restoreFocus = true) {
    if (requestInFlight) return;
    modal.hidden = true;
    editingId = null;
    if (deleteModal.hidden) document.body.classList.remove('auth-modal-open');
    if (restoreFocus) returnFocus?.focus();
  }

  function openDeleteModal(id, trigger) {
    const record = records.get(id);
    if (!record || record.source !== 'manual' || record.application_id !== null) return;
    deletingId = id;
    returnFocus = trigger;
    deleteMessage.textContent = '';
    deleteMessage.hidden = true;
    deleteModal.hidden = false;
    document.body.classList.add('auth-modal-open');
    window.requestAnimationFrame(() => document.getElementById('weight-delete-confirm').focus());
  }

  function closeDeleteModal(restoreFocus = true) {
    if (requestInFlight) return;
    deleteModal.hidden = true;
    deletingId = null;
    if (modal.hidden) document.body.classList.remove('auth-modal-open');
    if (restoreFocus) returnFocus?.focus();
  }

  function createCard(record) {
    const article = document.createElement('article');
    article.className = 'weight-card';
    const date = document.createElement('time');
    date.dateTime = record.record_date;
    date.textContent = formatCivilDate(record.record_date);
    const weight = document.createElement('strong');
    weight.textContent = `${formatWeight(record.weight_kg)} kg`;
    const origin = document.createElement('span');
    origin.className = `weight-origin${record.source === 'application' ? ' application' : ''}`;
    const originIcon = document.createElement('img');
    originIcon.src = record.source === 'application' ? 'assets/icons/weight-syringe.png' : 'assets/icons/weight-scale.png';
    originIcon.alt = '';
    originIcon.setAttribute('aria-hidden', 'true');
    origin.append(originIcon, document.createTextNode(record.source === 'application' ? 'Registrado na aplicação' : 'Registro diário'));
    article.append(date, weight, origin);
    if (record.source === 'manual' && record.application_id === null) {
      const actions = document.createElement('div');
      actions.className = 'weight-card-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'weight-action edit';
      edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>';
      edit.title = 'Editar';
      edit.setAttribute('aria-label', `Editar peso de ${formatCivilDate(record.record_date)}`);
      edit.addEventListener('click', () => openModal(edit, record));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'weight-action delete';
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';
      remove.title = 'Excluir';
      remove.setAttribute('aria-label', `Excluir peso de ${formatCivilDate(record.record_date)}`);
      remove.addEventListener('click', () => openDeleteModal(record.id, remove));
      actions.append(edit, remove);
      article.appendChild(actions);
    }
    return article;
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function setChartMessage(text) {
    const state = document.createElement('p');
    state.className = 'weight-chart-state';
    state.textContent = text;
    chart.replaceChildren(state);
  }

  function renderChart(records) {
    if (!records.length) {
      setChartMessage('Você ainda não registrou nenhum peso.');
      return;
    }
    const chronological = [...records].sort((first, second) => {
      const dateOrder = String(first.record_date).localeCompare(String(second.record_date));
      return dateOrder || String(first.created_at || '').localeCompare(String(second.created_at || ''));
    });
    const width = Math.max(640, chronological.length * 112 + 56);
    const height = 326;
    const plot = { left: 28, right: width - 28, top: 84, bottom: 258 };
    const values = chronological.map((record) => Number(record.weight_kg));
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = maximum - minimum;
    const padding = range ? Math.max(range * 0.35, 1) : Math.max(Math.abs(minimum) * 0.02, 1);
    const yMinimum = minimum - padding;
    const yMaximum = maximum + padding;
    const bandWidth = (plot.right - plot.left) / chronological.length;
    const xFor = (index) => plot.left + bandWidth * index + bandWidth / 2;
    const yFor = (value) => plot.bottom - ((value - yMinimum) / (yMaximum - yMinimum)) * (plot.bottom - plot.top);
    const variations = chronological.slice(1).map((record, index) => {
      const previous = Number(chronological[index].weight_kg);
      const current = Number(record.weight_kg);
      return {
        index: index + 1,
        value: ((current - previous) / previous) * 100,
        from: chronological[index],
        to: record
      };
    });
    const signed = (value, suffix) => {
      const prefix = value > 0 ? '+' : '';
      return `${prefix}${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${suffix}`;
    };
    const variationKind = (value) => value < 0 ? 'reduce' : value > 0 ? 'gain' : 'stable';
    const variationLabel = (value) => `${signed(value, '%')} ${value < 0 ? '↓' : value > 0 ? '↑' : '→'}`;
    const appendOriginChip = (record, x) => {
      const application = record.source === 'application';
      const label = application ? 'Registrado na aplicação' : 'Registro diário';
      const imageWidth = application ? 50 : 34;
      const imageHeight = 34;
      const group = svgElement('g', {
        class: 'weight-bar-origin-image-wrap',
        role: 'img',
        'aria-label': label,
        tabindex: 0
      });
      const title = svgElement('title');
      title.textContent = label;
      const image = svgElement('image', {
        href: application ? 'assets/icons/weight-syringe.png' : 'assets/icons/weight-scale.png',
        x: x - imageWidth / 2,
        y: 286,
        width: imageWidth,
        height: imageHeight,
        preserveAspectRatio: 'xMidYMid meet',
        class: 'weight-bar-origin-image',
        alt: label,
        'aria-hidden': 'true'
      });
      group.append(title, image);
      svg.appendChild(group);
    };
    const scroll = document.createElement('div');
    scroll.className = 'weight-chart-scroll';
    scroll.tabIndex = 0;
    scroll.setAttribute('aria-label', 'Gráfico de barras. Deslize horizontalmente para ver todas as pesagens.');
    const canvas = document.createElement('div');
    canvas.className = 'weight-chart-canvas';
    canvas.style.width = `${width}px`;
    const svg = svgElement('svg', {
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': `Evolução do peso em barras com ${chronological.length} ${chronological.length === 1 ? 'registro' : 'registros'}`
    });
    const definitions = svgElement('defs');
    const gradient = svgElement('linearGradient', { id: 'weight-bar-gradient', x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.append(
      svgElement('stop', { offset: '0%', 'stop-color': '#35bda4' }),
      svgElement('stop', { offset: '100%', 'stop-color': '#148d79' })
    );
    const shadow = svgElement('filter', { id: 'weight-bar-shadow', x: '-30%', y: '-20%', width: '160%', height: '150%' });
    shadow.appendChild(svgElement('feDropShadow', { dx: 0, dy: 4, stdDeviation: 4, 'flood-color': '#0b5046', 'flood-opacity': 0.18 }));
    const strongShadow = svgElement('filter', { id: 'weight-bar-shadow-strong', x: '-30%', y: '-20%', width: '160%', height: '150%' });
    strongShadow.appendChild(svgElement('feDropShadow', { dx: 0, dy: 5, stdDeviation: 5, 'flood-color': '#0b5046', 'flood-opacity': 0.3 }));
    definitions.append(gradient, shadow, strongShadow);
    svg.appendChild(definitions);
    svg.appendChild(svgElement('line', { x1: plot.left, y1: plot.bottom, x2: plot.right, y2: plot.bottom, class: 'weight-bar-baseline' }));
    const tooltip = document.createElement('div');
    tooltip.className = 'weight-chart-tooltip';
    tooltip.hidden = true;
    const showTooltip = (record, x, y) => {
      const origin = record.source === 'application' ? 'Registrado na aplicação' : 'Registro diário';
      tooltip.replaceChildren();
      const weight = document.createElement('b');
      weight.textContent = `${formatWeight(record.weight_kg)} kg`;
      const date = document.createElement('span');
      date.textContent = formatCivilDate(record.record_date);
      const source = document.createElement('span');
      source.textContent = origin;
      tooltip.append(date, weight, source);
      tooltip.style.left = `${Math.min(width - 85, Math.max(85, x))}px`;
      tooltip.style.top = `${y}px`;
      tooltip.classList.toggle('is-below', y < 80);
      tooltip.hidden = false;
    };
    const hideTooltip = () => { tooltip.hidden = true; };
    variations.forEach((variation) => {
      const previousX = xFor(variation.index - 1);
      const currentX = xFor(variation.index);
      const middleX = (previousX + currentX) / 2;
      const kind = variationKind(variation.value);
      svg.appendChild(svgElement('path', {
        d: `M ${previousX + 27} 66 Q ${middleX} 50 ${currentX - 27} 66`,
        class: 'weight-variation-guide'
      }));
      const chipWidth = 66;
      svg.appendChild(svgElement('rect', { x: middleX - chipWidth / 2, y: 28, width: chipWidth, height: 24, rx: 12, class: `weight-variation-chip ${kind}` }));
      const label = svgElement('text', { x: middleX, y: 44, 'text-anchor': 'middle', class: `weight-variation-text ${kind}` });
      label.textContent = variationLabel(variation.value);
      svg.appendChild(label);
    });
    chronological.forEach((record, index) => {
      const x = xFor(index);
      const y = yFor(Number(record.weight_kg));
      const barWidth = Math.min(52, bandWidth * 0.48);
      const origin = record.source === 'application' ? 'Registrado na aplicação' : 'Registro diário';
      const value = svgElement('text', { x, y: y - 10, 'text-anchor': 'middle', class: 'weight-bar-value' });
      value.textContent = `${formatWeight(record.weight_kg)} kg`;
      const date = svgElement('text', { x, y: plot.bottom + 24, 'text-anchor': 'middle', class: 'weight-bar-date' });
      date.textContent = formatCivilDate(record.record_date).slice(0, 5);
      const bar = svgElement('rect', {
        x: x - barWidth / 2,
        y,
        width: barWidth,
        height: Math.max(8, plot.bottom - y),
        rx: 9,
        class: 'weight-bar',
        tabindex: 0,
        role: 'button',
        'aria-label': `${formatCivilDate(record.record_date)}, ${formatWeight(record.weight_kg)} quilogramas, ${origin}`
      });
      bar.addEventListener('pointerenter', () => showTooltip(record, x, y));
      bar.addEventListener('pointerleave', hideTooltip);
      bar.addEventListener('focus', () => showTooltip(record, x, y));
      bar.addEventListener('blur', hideTooltip);
      bar.addEventListener('click', (event) => {
        event.stopPropagation();
        showTooltip(record, x, y);
      });
      svg.append(bar, value, date);
      appendOriginChip(record, x);
    });
    canvas.append(svg, tooltip);
    scroll.appendChild(canvas);

    const legend = document.createElement('div');
    legend.className = 'weight-chart-legend';
    legend.innerHTML = '<b class="reduce">↓ Redução de peso</b><b class="gain">↑ Ganho de peso</b><b class="stable">→ Sem alteração</b><p>Percentual de mudança entre uma pesagem e outra.</p><div class="weight-origin-legend"><span class="weight-origin-key application"><img src="assets/icons/weight-syringe.png" alt="Registrado na aplicação" />Registrado na aplicação</span><span class="weight-origin-key daily"><img src="assets/icons/weight-scale.png" alt="Registro diário" />Registro diário</span></div>';
    const metrics = document.createElement('div');
    metrics.className = 'weight-summary-grid';
    const largestReduction = variations.filter((variation) => variation.value < 0).sort((a, b) => a.value - b.value)[0] || null;
    const largestGain = variations.filter((variation) => variation.value > 0).sort((a, b) => b.value - a.value)[0] || null;
    const totalChange = Number(chronological.at(-1).weight_kg) - Number(chronological[0].weight_kg);
    const metric = (title, value, period, kind = '') => {
      const card = document.createElement('article');
      card.className = `weight-metric${kind ? ` ${kind}` : ''}`;
      const label = document.createElement('span');
      label.textContent = title;
      const strong = document.createElement('strong');
      strong.textContent = value;
      const small = document.createElement('small');
      small.textContent = period;
      card.append(label, strong, small);
      return card;
    };
    const periodFor = (variation) => variation
      ? `${formatCivilDate(variation.from.record_date).slice(0, 5)} → ${formatCivilDate(variation.to.record_date).slice(0, 5)}`
      : '—';
    metrics.append(
      metric('MAIOR REDUÇÃO', largestReduction ? signed(largestReduction.value, '%') : '—', periodFor(largestReduction), 'reduce'),
      metric('MAIOR AUMENTO', largestGain ? signed(largestGain.value, '%') : '—', periodFor(largestGain), 'gain'),
      metric(
        'EVOLUÇÃO TOTAL',
        chronological.length > 1 ? signed(totalChange, ' kg') : '—',
        chronological.length > 1 ? `${formatCivilDate(chronological[0].record_date).slice(0, 5)} → ${formatCivilDate(chronological.at(-1).record_date).slice(0, 5)}` : '—',
        totalChange < 0 ? 'reduce' : totalChange > 0 ? 'gain' : ''
      )
    );
    chart.replaceChildren(scroll, legend, metrics);
    canvas.onclick = (event) => {
      if (!event.target.classList?.contains('weight-bar')) hideTooltip();
    };
  }

  function renderHistory(items) {
    list.replaceChildren();
    records.clear();
    renderChart(items);
    if (!items.length) {
      status.hidden = false;
      status.textContent = 'Você ainda não registrou nenhum peso.';
      return;
    }
    status.hidden = true;
    items.forEach((record) => {
      records.set(record.id, record);
      list.appendChild(createCard(record));
    });
  }

  async function loadHistory(userId) {
    status.hidden = false;
    status.textContent = 'Carregando histórico...';
    setChartMessage('Carregando evolução...');
    list.replaceChildren();
    const { data, error } = await client.from('weight_records')
      .select('id,record_date,weight_kg,notes,source,application_id,created_at')
      .order('record_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (currentUserId !== userId) return;
    if (error) {
      reportTechnicalError('falha ao carregar histórico', error);
      status.textContent = 'Não foi possível carregar seu histórico.';
      showToast(friendlyError(error, 'Não foi possível carregar seu histórico de peso.'), 'error');
      return;
    }
    renderHistory(data || []);
  }

  async function applySession(session) {
    const nextUserId = session?.user?.id || null;
    if (nextUserId === currentUserId) return;
    currentUserId = nextUserId;
    modal.hidden = true;
    deleteModal.hidden = true;
    editingId = null;
    deletingId = null;
    records.clear();
    document.body.classList.remove('auth-modal-open');
    setDetailsVisible(false);
    section.hidden = !nextUserId;
    list.replaceChildren();
    if (!nextUserId) {
      status.textContent = '';
      return;
    }
    await loadHistory(nextUserId);
  }

  navButton.addEventListener('click', () => {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    registerButton.focus({ preventScroll: true });
  });

  registerButton.addEventListener('click', () => openModal(registerButton));
  detailsToggle.addEventListener('click', () => setDetailsVisible(details.hidden));
  detailsClose.addEventListener('click', () => setDetailsVisible(false, true));
  notes.addEventListener('input', () => {
    document.getElementById('weight-notes-count').textContent = `${notes.value.length}/500`;
  });
  document.querySelectorAll('[data-weight-close]').forEach((button) => {
    button.addEventListener('click', () => closeModal());
  });
  document.querySelectorAll('[data-weight-delete-close]').forEach((button) => {
    button.addEventListener('click', () => closeDeleteModal());
  });

  document.addEventListener('keydown', (event) => {
    const activeModal = !deleteModal.hidden ? deleteModal : !modal.hidden ? modal : null;
    if (!activeModal) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (activeModal === deleteModal) closeDeleteModal();
      else closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(activeModal);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client || requestInFlight) return;
    setMessage();
    const recordDate = form.elements.record_date.value;
    const weightKg = parseWeight(form.elements.weight_kg.value);
    if (!validCivilDate(recordDate) || Number.isNaN(weightKg)) {
      setMessage('Informe uma data e um peso válido maior que zero.');
      return;
    }
    const updating = Boolean(editingId);
    const selectedRecord = updating ? records.get(editingId) : null;
    if (updating && (!selectedRecord || selectedRecord.source !== 'manual' || selectedRecord.application_id !== null)) {
      setMessage('Este registro não pode ser editado por esta tela.');
      return;
    }
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user || userData.user.id !== currentUserId) {
      setMessage('Sua sessão expirou. Entre novamente.');
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    requestInFlight = true;
    submit.disabled = true;
    submit.classList.add('is-loading');
    const payload = {
      record_date: recordDate,
      weight_kg: weightKg,
      notes: notes.value.trim() || null
    };
    const result = updating
      ? await client.from('weight_records').update(payload)
        .eq('id', editingId)
        .eq('source', 'manual')
        .is('application_id', null)
        .select('id,record_date,weight_kg,notes,source,application_id,created_at')
        .single()
      : await client.from('weight_records').insert({
        ...payload,
        user_id: userData.user.id,
        source: 'manual',
        application_id: null
      }).select('id,record_date,weight_kg,notes,source,application_id,created_at').single();
    requestInFlight = false;
    submit.disabled = false;
    submit.classList.remove('is-loading');
    const invalidUpdate = updating && (result.data?.id !== editingId || result.data?.source !== 'manual' || result.data?.application_id !== null);
    if (result.error || !result.data || invalidUpdate) {
      reportTechnicalError(updating ? 'falha ao atualizar peso' : 'falha ao registrar peso', result.error);
      setMessage(friendlyError(result.error, updating ? 'Não foi possível atualizar o peso. Tente novamente.' : 'Não foi possível registrar o peso. Tente novamente.'));
      return;
    }
    closeModal(false);
    await loadHistory(currentUserId);
    showToast(updating ? 'Peso atualizado com sucesso.' : 'Peso registrado com sucesso.', 'success');
  });

  document.getElementById('weight-delete-confirm').addEventListener('click', async (event) => {
    if (!client || requestInFlight || !deletingId) return;
    const id = deletingId;
    const record = records.get(id);
    if (!record || record.source !== 'manual' || record.application_id !== null) return;
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user || userData.user.id !== currentUserId) {
      deleteMessage.textContent = 'Sua sessão expirou. Entre novamente.';
      deleteMessage.hidden = false;
      return;
    }
    const button = event.currentTarget;
    requestInFlight = true;
    button.disabled = true;
    const result = await client.from('weight_records').delete()
      .eq('id', id)
      .eq('source', 'manual')
      .is('application_id', null)
      .select('id')
      .maybeSingle();
    requestInFlight = false;
    button.disabled = false;
    if (result.error || result.data?.id !== id) {
      reportTechnicalError('falha ao excluir peso', result.error);
      deleteMessage.textContent = friendlyError(result.error, 'Não foi possível excluir o registro. Tente novamente.');
      deleteMessage.hidden = false;
      return;
    }
    closeDeleteModal(false);
    await loadHistory(currentUserId);
    showToast('Registro de peso excluído.', 'success');
  });

  if (!client) {
    section.hidden = true;
    return;
  }
  client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => applySession(session), 0);
  });
  client.auth.getSession().then(({ data, error }) => {
    if (!error) applySession(data.session);
  });
})();
