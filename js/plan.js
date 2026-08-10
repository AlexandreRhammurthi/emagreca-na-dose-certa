(function initializePlan() {
  'use strict';

  const client = window.supabaseClient;
  const section = document.getElementById('plan-section');
  const status = document.getElementById('plan-status');
  const content = document.getElementById('plan-content');
  const nextContent = document.getElementById('plan-next-content');
  const list = document.getElementById('plan-list');
  const calendar = document.getElementById('plan-calendar');
  const calendarGrid = document.getElementById('plan-calendar-grid');
  const calendarTitle = document.getElementById('plan-calendar-title');
  const calendarDayDetails = document.getElementById('plan-calendar-day-details');
  const calendarToggle = document.getElementById('plan-calendar-toggle');
  const navButton = document.getElementById('plan-nav');
  const diaryNavButton = document.getElementById('diary-nav');
  const registerButton = document.getElementById('plan-register');
  const formModal = document.getElementById('plan-form-modal');
  const cancelModal = document.getElementById('plan-cancel-modal');
  const form = document.getElementById('plan-form');
  const formMessage = document.getElementById('plan-form-message');
  const cancelMessage = document.getElementById('plan-cancel-message');
  const cancelConfirmButton = document.getElementById('plan-cancel-confirm');
  const planFields = 'id,user_id,medicine,dose_mg,start_date,frequency_type,frequency_interval,time_of_day,timezone,default_reminder_minutes,active,created_at,updated_at';
  const occurrenceFields = 'id,user_id,plan_id,scheduled_date,scheduled_time,timezone,status,reminder_minutes,notes,google_sync_status,created_at,updated_at';
  const plans = new Map();
  const occurrences = new Map();
  const modalReturnFocus = new Map();
  let currentUserId = null;
  let requestInFlight = false;
  let cancelRequestInFlight = false;
  let editingId = null;
  let cancellingId = null;
  let calendarYear = null;
  let calendarMonth = null;

  function populateMedicineSelect() {
    const select = form.elements.medicine;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecione o medicamento';
    select.appendChild(placeholder);
    (window.DoseMedicines || []).forEach(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
  }

  populateMedicineSelect();

  function todayCivil() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function currentTime() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  function formatCivilDate(value, long = false) {
    const [year, month, day] = String(value || '').split('-').map(Number);
    if (!year || !month || !day) return 'Data não informada';
    if (!long) return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, day)));
  }

  function formatTime(value) {
    return String(value || '').slice(0, 5) || 'Horário não informado';
  }

  function formatDose(value) {
    return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} mg`;
  }

  function parseDose(value) {
    const normalized = String(value || '').trim();
    if (!/^\d+(?:[.,]\d+)?$/u.test(normalized)) return Number.NaN;
    const dose = Number(normalized.replace(',', '.'));
    return Number.isFinite(dose) && dose > 0 ? dose : Number.NaN;
  }

  function daysInMonth(year, month) {
    if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
  }

  function addCivilDays(value, amount) {
    let [year, month, day] = String(value || '').split('-').map(Number);
    if (!year || !month || !day || !Number.isInteger(amount) || amount < 0) return null;
    for (let index = 0; index < amount; index += 1) {
      day += 1;
      if (day > daysInMonth(year, month)) {
        day = 1;
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function generateOccurrenceDates(startDate, frequencyType, frequencyInterval) {
    const total = frequencyType === 'once' ? 1 : 12;
    const interval = frequencyType === 'once' ? 0 : frequencyInterval;
    return Array.from({ length: total }, (_item, index) => addCivilDays(startDate, index * interval));
  }

  function validateOccurrenceDates(dates, expectedTotal) {
    return dates.length === expectedTotal
      && dates.every((date) => /^\d{4}-\d{2}-\d{2}$/u.test(String(date || '')))
      && new Set(dates).size === dates.length;
  }

  function occurrenceIdentity(record) {
    return `${record.plan_id}|${record.scheduled_date}|${formatTime(record.scheduled_time)}`;
  }

  function validateOccurrencePayloads(payloads, expectedTotal) {
    if (payloads.length !== expectedTotal || !payloads.length) return false;
    const planId = payloads[0].plan_id;
    const scheduledTime = payloads[0].scheduled_time;
    const timezone = payloads[0].timezone;
    const reminders = JSON.stringify(payloads[0].reminder_minutes);
    return Boolean(planId && scheduledTime && timezone)
      && payloads.every((record) => record.plan_id === planId
        && record.scheduled_time === scheduledTime
        && record.timezone === timezone
        && JSON.stringify(record.reminder_minutes) === reminders
        && /^\d{4}-\d{2}-\d{2}$/u.test(record.scheduled_date))
      && new Set(payloads.map(occurrenceIdentity)).size === payloads.length;
  }

  function returnedOccurrencesMatch(payloads, returned) {
    if (!Array.isArray(returned) || returned.length !== payloads.length) return false;
    const expected = new Set(payloads.map(occurrenceIdentity));
    return returned.every((record) => expected.delete(occurrenceIdentity(record))) && expected.size === 0;
  }

  function validTimezone(value) {
    return /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/u.test(String(value || ''));
  }

  function browserTimezone() {
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return validTimezone(timezone) ? timezone : '';
    } catch {
      return '';
    }
  }

  function isUpcoming(record) {
    if (record.status !== 'scheduled') return false;
    const today = todayCivil();
    if (record.scheduled_date !== today) return record.scheduled_date > today;
    return formatTime(record.scheduled_time) >= currentTime();
  }

  function compareOccurrences(first, second) {
    return String(first.scheduled_date).localeCompare(String(second.scheduled_date))
      || String(first.scheduled_time).localeCompare(String(second.scheduled_time))
      || String(first.created_at || '').localeCompare(String(second.created_at || ''));
  }

  function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
  }

  function reportTechnicalError(context, error) {
    console.error(`Meu Plano: ${context}`, { code: error?.code || 'unknown', message: error?.message || 'unknown' });
  }

  function friendlyError(error, fallback) {
    const text = String(error?.message || '').toLowerCase();
    if (text.includes('jwt') || text.includes('session')) return 'Sua sessão expirou. Entre novamente.';
    if (text.includes('fetch') || text.includes('network')) return 'Não foi possível conectar. Verifique sua internet.';
    if (String(error?.code || '') === '23505') return 'Já existe uma aplicação agendada para esta data e horário neste plano.';
    return fallback;
  }

  function setMessage(element, message = '') {
    element.textContent = message;
    element.hidden = !message;
  }

  function focusableElements(modal) {
    return [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
      .filter((element) => element.offsetParent !== null);
  }

  function openModal(modal, trigger) {
    modalReturnFocus.set(modal, trigger || document.activeElement);
    modal.hidden = false;
    document.body.classList.add('auth-modal-open');
    window.requestAnimationFrame(() => focusableElements(modal)[0]?.focus() || modal.querySelector('[role="dialog"], [role="alertdialog"]')?.focus());
  }

  function closeModal(modal, restoreFocus = true) {
    modal.hidden = true;
    if (modal === formModal) editingId = null;
    if (modal === cancelModal) cancellingId = null;
    if (formModal.hidden && cancelModal.hidden) document.body.classList.remove('auth-modal-open');
    if (restoreFocus) modalReturnFocus.get(modal)?.focus();
  }

  function selectedReminders() {
    return [...form.elements.reminders].filter((input) => input.checked).map((input) => Number(input.value));
  }

  function setSelectedReminders(values) {
    const selected = new Set((values || []).map(Number));
    [...form.elements.reminders].forEach((input) => { input.checked = selected.has(Number(input.value)); });
  }

  function updateFrequencyField(clearCustom = false) {
    const choice = form.elements.frequency_choice.value;
    const custom = choice === 'custom';
    const field = document.getElementById('plan-interval-field');
    const input = form.elements.frequency_interval;
    const hint = document.getElementById('plan-interval-hint');
    field.hidden = Boolean(editingId);
    input.disabled = !custom || Boolean(editingId);
    form.elements.frequency_interval.required = custom && !editingId;
    field.classList.toggle('is-disabled', input.disabled);
    if (choice === 'weekly') {
      input.value = '7';
      hint.textContent = 'Intervalo fixo de 7 dias.';
    } else if (choice === 'once') {
      input.value = '';
      hint.textContent = 'Não se aplica a uma única aplicação.';
    } else {
      if (clearCustom) input.value = '';
      hint.textContent = 'Informe um número inteiro entre 1 e 365.';
    }
  }

  function setFormMode(record = null) {
    editingId = record?.id || null;
    form.reset();
    form.elements.occurrence_id.value = editingId || '';
    form.querySelectorAll('.plan-create-only').forEach((element) => { element.hidden = Boolean(record); });
    form.elements.medicine.required = !record;
    form.elements.dose_mg.required = !record;
    form.elements.frequency_choice.required = !record;
    document.getElementById('plan-date-label').textContent = record ? 'Data' : 'Data inicial';
    document.getElementById('plan-form-title').textContent = record ? 'Editar aplicação agendada' : 'Agendar aplicação';
    document.getElementById('plan-form-subtitle').textContent = record ? 'Esta alteração afeta somente esta ocorrência.' : 'Defina quando deseja receber o lembrete.';
    document.getElementById('plan-submit-label').textContent = record ? 'Salvar alterações' : 'Agendar aplicação';
    if (record) {
      form.elements.scheduled_date.value = record.scheduled_date;
      form.elements.scheduled_time.value = formatTime(record.scheduled_time);
      form.elements.notes.value = record.notes || '';
      setSelectedReminders(record.reminder_minutes);
    } else {
      form.elements.scheduled_date.value = todayCivil();
      form.elements.scheduled_time.value = '09:00';
      form.elements.frequency_choice.value = 'once';
      setSelectedReminders([1440, 120, 0]);
    }
    form.elements.scheduled_date.min = todayCivil();
    setMessage(formMessage);
    updateFrequencyField();
  }

  function openCreate(trigger) {
    setFormMode();
    openModal(formModal, trigger);
  }

  function selectMedicine(value) {
    const normalized = String(value || '').trim().toLocaleLowerCase('pt-BR');
    const option = [...form.elements.medicine.options].find((item) => item.value.toLocaleLowerCase('pt-BR') === normalized
      || item.textContent.trim().toLocaleLowerCase('pt-BR') === normalized);
    form.elements.medicine.value = option?.value || '';
  }

  function openCreateWithDraft(draft = {}, trigger) {
    setFormMode();
    selectMedicine(draft.medicine);
    form.elements.dose_mg.value = String(draft.doseMg || '').replace('.', ',');
    if (draft.scheduledDate) form.elements.scheduled_date.value = draft.scheduledDate;
    form.elements.notes.value = String(draft.notes || '');
    openModal(formModal, trigger);
  }

  function openEdit(record, trigger) {
    if (!record || record.status !== 'scheduled') return;
    setFormMode(record);
    openModal(formModal, trigger);
  }

  function openCancel(record, trigger) {
    if (!record || record.status !== 'scheduled') return;
    cancellingId = record.id;
    setMessage(cancelMessage);
    openModal(cancelModal, trigger);
  }

  function planFor(record) {
    return plans.get(record.plan_id) || null;
  }

  function makeOccurrenceCard(record) {
    const plan = planFor(record);
    const article = document.createElement('article');
    article.className = 'plan-item';
    const date = document.createElement('time');
    date.dateTime = `${record.scheduled_date}T${formatTime(record.scheduled_time)}`;
    const dateLabel = document.createElement('strong');
    dateLabel.textContent = formatCivilDate(record.scheduled_date);
    const timeLabel = document.createElement('span');
    timeLabel.textContent = formatTime(record.scheduled_time);
    date.append(dateLabel, timeLabel);
    const information = document.createElement('div');
    const medicine = document.createElement('h4');
    medicine.textContent = plan?.medicine || 'Plano indisponível';
    const dose = document.createElement('p');
    dose.textContent = plan ? formatDose(plan.dose_mg) : 'Dose não disponível';
    information.append(medicine, dose);
    const actions = document.createElement('div');
    actions.className = 'plan-item-actions';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'primary-action plan-confirm-action';
    confirm.textContent = 'Confirmar aplicação';
    confirm.addEventListener('click', () => {
      const plan = planFor(record);
      if (!plan || typeof window.Diary?.openScheduledConfirmation !== 'function') {
        showToast('Não foi possível abrir a confirmação desta aplicação.', 'error');
        return;
      }
      window.Diary.openScheduledConfirmation({
        occurrenceId: record.id,
        medicine: plan.medicine,
        doseMg: plan.dose_mg,
        scheduledDate: record.scheduled_date,
        notes: record.notes || ''
      }, confirm);
    });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'secondary-action';
    edit.textContent = 'Editar';
    edit.addEventListener('click', () => openEdit(record, edit));
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'plan-cancel-action';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => openCancel(record, cancel));
    actions.append(confirm, edit, cancel);
    article.append(date, information, actions);
    return article;
  }

  function renderNext(record) {
    nextContent.replaceChildren();
    const plan = planFor(record);
    const date = document.createElement('time');
    date.dateTime = `${record.scheduled_date}T${formatTime(record.scheduled_time)}`;
    date.textContent = formatCivilDate(record.scheduled_date, true);
    const medicine = document.createElement('strong');
    medicine.textContent = plan?.medicine || 'Plano indisponível';
    const dose = document.createElement('span');
    dose.textContent = plan ? formatDose(plan.dose_mg) : 'Dose não disponível';
    const time = document.createElement('span');
    time.textContent = formatTime(record.scheduled_time);
    const badge = document.createElement('small');
    badge.textContent = 'Agendada';
    nextContent.append(date, medicine, dose, time, badge);
  }

  function renderCalendarDayDetails(dateValue, records) {
    calendarDayDetails.replaceChildren();
    const heading = document.createElement('h4');
    heading.textContent = formatCivilDate(dateValue, true);
    calendarDayDetails.appendChild(heading);
    records.forEach((record) => {
      const plan = planFor(record);
      const row = document.createElement('p');
      row.textContent = `${formatTime(record.scheduled_time)} · ${plan?.medicine || 'Plano indisponível'} · ${plan ? formatDose(plan.dose_mg) : 'Dose não disponível'}`;
      calendarDayDetails.appendChild(row);
    });
  }

  function renderCalendar(upcoming) {
    const [initialYear, initialMonth] = (upcoming[0]?.scheduled_date || todayCivil()).split('-').map(Number);
    if (!calendarYear || !calendarMonth) {
      calendarYear = initialYear;
      calendarMonth = initialMonth;
    }
    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)));
    calendarTitle.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    calendarGrid.replaceChildren();
    calendarDayDetails.replaceChildren();
    const firstWeekday = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)).getUTCDay();
    for (let blank = 0; blank < firstWeekday; blank += 1) {
      const spacer = document.createElement('span');
      spacer.className = 'plan-calendar-blank';
      spacer.setAttribute('aria-hidden', 'true');
      calendarGrid.appendChild(spacer);
    }
    const monthPrefix = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-`;
    for (let day = 1; day <= daysInMonth(calendarYear, calendarMonth); day += 1) {
      const dateValue = `${monthPrefix}${String(day).padStart(2, '0')}`;
      const dayRecords = upcoming.filter((record) => record.scheduled_date === dateValue);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `plan-calendar-day${dayRecords.length ? ' has-applications' : ''}`;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', dayRecords.length
        ? `${formatCivilDate(dateValue)}, ${dayRecords.length} ${dayRecords.length === 1 ? 'aplicação agendada' : 'aplicações agendadas'}`
        : formatCivilDate(dateValue));
      const number = document.createElement('span');
      number.textContent = String(day);
      button.appendChild(number);
      if (dayRecords.length) {
        const marker = document.createElement('img');
        marker.src = 'assets/icons/application-vial.png';
        marker.alt = '';
        marker.setAttribute('aria-hidden', 'true');
        button.appendChild(marker);
        button.addEventListener('click', () => renderCalendarDayDetails(dateValue, dayRecords));
      }
      calendarGrid.appendChild(button);
    }
  }

  function renderEmpty() {
    content.hidden = true;
    status.hidden = false;
    status.textContent = 'Você ainda não possui aplicações agendadas.';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary-action empty-action';
    button.textContent = 'Agendar primeira aplicação';
    button.addEventListener('click', () => openCreate(button));
    status.append(document.createElement('br'), button);
  }

  function render() {
    const upcoming = [...occurrences.values()].filter(isUpcoming).sort(compareOccurrences);
    if (!upcoming.length) {
      renderEmpty();
      return;
    }
    status.hidden = true;
    content.hidden = false;
    renderNext(upcoming[0]);
    list.replaceChildren(...upcoming.map(makeOccurrenceCard));
    renderCalendar(upcoming);
  }

  async function loadData(userId) {
    status.hidden = false;
    status.textContent = 'Carregando seu plano...';
    content.hidden = true;
    const [planResult, occurrenceResult] = await Promise.all([
      client.from('application_plans').select(planFields).order('created_at', { ascending: true }),
      client.from('scheduled_applications').select(occurrenceFields)
        .order('scheduled_date', { ascending: true })
        .order('scheduled_time', { ascending: true })
    ]);
    if (currentUserId !== userId) return;
    if (planResult.error || occurrenceResult.error) {
      reportTechnicalError('falha ao carregar dados', planResult.error || occurrenceResult.error);
      status.hidden = false;
      status.textContent = friendlyError(planResult.error || occurrenceResult.error, 'Não foi possível carregar seu plano. Tente novamente.');
      return;
    }
    plans.clear();
    occurrences.clear();
    (planResult.data || []).forEach((plan) => plans.set(plan.id, plan));
    (occurrenceResult.data || []).forEach((record) => occurrences.set(record.id, record));
    render();
  }

  async function applySession(session) {
    const nextUserId = session?.user?.id || null;
    if (nextUserId === currentUserId) return;
    currentUserId = nextUserId;
    editingId = null;
    cancellingId = null;
    calendarYear = null;
    calendarMonth = null;
    plans.clear();
    occurrences.clear();
    formModal.hidden = true;
    cancelModal.hidden = true;
    document.body.classList.remove('auth-modal-open');
    section.hidden = !nextUserId;
    content.hidden = true;
    if (!nextUserId) {
      status.textContent = '';
      return;
    }
    await loadData(nextUserId);
  }

  form.elements.frequency_choice.addEventListener('change', () => {
    updateFrequencyField(true);
    if (form.elements.frequency_choice.value === 'custom') form.elements.frequency_interval.focus();
  });
  registerButton.addEventListener('click', () => openCreate(registerButton));
  navButton.addEventListener('click', () => {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => registerButton.focus({ preventScroll: true }), 300);
  });
  diaryNavButton.addEventListener('click', () => {
    document.getElementById('diary-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  calendarToggle.addEventListener('click', () => {
    const visible = calendar.classList.toggle('is-mobile-visible');
    calendarToggle.setAttribute('aria-expanded', String(visible));
    calendarToggle.textContent = visible ? 'Ocultar calendário' : 'Ver calendário';
  });
  document.getElementById('plan-calendar-prev').addEventListener('click', () => {
    calendarMonth -= 1;
    if (calendarMonth < 1) { calendarMonth = 12; calendarYear -= 1; }
    renderCalendar([...occurrences.values()].filter(isUpcoming).sort(compareOccurrences));
  });
  document.getElementById('plan-calendar-next').addEventListener('click', () => {
    calendarMonth += 1;
    if (calendarMonth > 12) { calendarMonth = 1; calendarYear += 1; }
    renderCalendar([...occurrences.values()].filter(isUpcoming).sort(compareOccurrences));
  });

  document.querySelectorAll('[data-plan-close]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.planClose === 'form' ? formModal : cancelModal));
  });

  document.addEventListener('keydown', (event) => {
    const activeModal = !cancelModal.hidden ? cancelModal : !formModal.hidden ? formModal : null;
    if (!activeModal) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal(activeModal);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(activeModal);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client || requestInFlight || !currentUserId) return;
    setMessage(formMessage);
    const scheduledDate = form.elements.scheduled_date.value;
    const scheduledTime = form.elements.scheduled_time.value;
    const reminders = selectedReminders();
    if (!scheduledDate || !scheduledTime || scheduledDate < todayCivil() || (scheduledDate === todayCivil() && scheduledTime < currentTime())) {
      setMessage(formMessage, 'Informe uma data e um horário atuais ou futuros.');
      return;
    }
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user || userData.user.id !== currentUserId) {
      setMessage(formMessage, 'Sua sessão expirou. Entre novamente.');
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    requestInFlight = true;
    submit.disabled = true;
    submit.classList.add('is-loading');

    if (editingId) {
      const result = await client.from('scheduled_applications').update({
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime,
        reminder_minutes: reminders,
        notes: form.elements.notes.value.trim() || null,
        status: 'scheduled'
      }).eq('id', editingId).eq('status', 'scheduled').select(occurrenceFields).maybeSingle();
      requestInFlight = false;
      submit.disabled = false;
      submit.classList.remove('is-loading');
      if (result.error || result.data?.id !== editingId) {
        reportTechnicalError('falha ao editar ocorrência', result.error);
        setMessage(formMessage, friendlyError(result.error, 'Não foi possível atualizar esta aplicação agendada.'));
        return;
      }
      closeModal(formModal, false);
      await loadData(currentUserId);
      showToast('Aplicação agendada atualizada.', 'success');
      return;
    }

    const medicine = form.elements.medicine.value
      ? form.elements.medicine.selectedOptions[0]?.textContent.trim() || ''
      : '';
    const doseMg = parseDose(form.elements.dose_mg.value);
    const frequencyChoice = form.elements.frequency_choice.value;
    const frequencyType = frequencyChoice === 'once' ? 'once' : 'days';
    const frequencyInterval = frequencyChoice === 'once' ? null : frequencyChoice === 'weekly' ? 7 : Number(form.elements.frequency_interval.value);
    const timezone = browserTimezone();
    if (!medicine || Number.isNaN(doseMg) || !timezone || (frequencyType === 'days' && (!Number.isInteger(frequencyInterval) || frequencyInterval < 1 || frequencyInterval > 365))) {
      requestInFlight = false;
      submit.disabled = false;
      submit.classList.remove('is-loading');
      setMessage(formMessage, !timezone ? 'Não foi possível identificar uma timezone válida no navegador.' : 'Preencha medicamento, dose e frequência com valores válidos.');
      return;
    }
    const expectedOccurrenceTotal = frequencyType === 'once' ? 1 : 12;
    const dates = generateOccurrenceDates(scheduledDate, frequencyType, frequencyInterval);
    if (!validateOccurrenceDates(dates, expectedOccurrenceTotal)) {
      requestInFlight = false;
      submit.disabled = false;
      submit.classList.remove('is-loading');
      console.error('[Meu Plano] geração de datas inválida.', { expectedOccurrenceTotal, dates });
      setMessage(formMessage, 'Não foi possível gerar todas as datas do plano com segurança. Nenhum agendamento foi criado.');
      return;
    }
    const planResult = await client.from('application_plans').insert({
      user_id: userData.user.id,
      medicine,
      dose_mg: doseMg,
      start_date: scheduledDate,
      frequency_type: frequencyType,
      frequency_interval: frequencyInterval,
      time_of_day: scheduledTime,
      timezone,
      default_reminder_minutes: reminders,
      active: true
    }).select(planFields).single();
    if (planResult.error || !planResult.data) {
      requestInFlight = false;
      submit.disabled = false;
      submit.classList.remove('is-loading');
      reportTechnicalError('falha ao criar plano', planResult.error);
      setMessage(formMessage, friendlyError(planResult.error, 'Não foi possível criar o plano.'));
      return;
    }
    const occurrencePayloads = dates.map((date) => ({
      user_id: userData.user.id,
      plan_id: planResult.data.id,
      scheduled_date: date,
      scheduled_time: scheduledTime,
      timezone,
      status: 'scheduled',
      reminder_minutes: [...reminders],
      notes: form.elements.notes.value.trim() || null,
      google_sync_status: 'not_connected'
    }));
    if (!validateOccurrencePayloads(occurrencePayloads, expectedOccurrenceTotal)) {
      const cleanup = await client.from('application_plans').delete().eq('id', planResult.data.id).select('id').maybeSingle();
      requestInFlight = false;
      submit.disabled = false;
      submit.classList.remove('is-loading');
      console.error('[Meu Plano] payload de recorrência inconsistente.', { expectedOccurrenceTotal, generatedTotal: occurrencePayloads.length });
      if (cleanup.error || cleanup.data?.id !== planResult.data.id) reportTechnicalError('falha ao remover plano com payload inválido', cleanup.error);
      setMessage(formMessage, cleanup.error
        ? 'As datas ficaram inconsistentes e o plano incompleto não pôde ser removido automaticamente. Recarregue a página.'
        : 'As datas do plano ficaram inconsistentes. Nenhuma aplicação foi agendada.');
      return;
    }
    const occurrenceResult = await client.from('scheduled_applications').insert(occurrencePayloads).select(occurrenceFields);
    if (occurrenceResult.error || !returnedOccurrencesMatch(occurrencePayloads, occurrenceResult.data)) {
      const cleanup = await client.from('application_plans').delete().eq('id', planResult.data.id).select('id').maybeSingle();
      requestInFlight = false;
      submit.disabled = false;
      submit.classList.remove('is-loading');
      reportTechnicalError('falha ao criar ocorrências', occurrenceResult.error);
      if (cleanup.error || cleanup.data?.id !== planResult.data.id) reportTechnicalError('falha ao remover plano incompleto', cleanup.error);
      setMessage(formMessage, cleanup.error
        ? 'O plano foi criado, mas as ocorrências falharam e a limpeza automática não foi concluída. Recarregue e tente novamente.'
        : friendlyError(occurrenceResult.error, 'Não foi possível criar as ocorrências. O plano incompleto foi removido.'));
      return;
    }
    requestInFlight = false;
    submit.disabled = false;
    submit.classList.remove('is-loading');
    closeModal(formModal, false);
    await loadData(currentUserId);
    showToast(frequencyType === 'once' ? 'Aplicação agendada com sucesso.' : 'Plano criado com 12 aplicações agendadas.', 'success');
  });

  cancelConfirmButton.addEventListener('click', async (event) => {
    event.preventDefault();
    if (cancelRequestInFlight) return;
    const button = event.currentTarget;
    const originalLabel = button.textContent;
    cancelRequestInFlight = true;
    button.disabled = true;
    button.textContent = 'Cancelando...';
    cancelModal.setAttribute('aria-busy', 'true');
    setMessage(cancelMessage);
    let succeeded = false;
    try {
      if (!client) {
        console.error('[Plan Cancel] cliente Supabase indisponível.');
        setMessage(cancelMessage, 'Não foi possível conectar ao serviço. Recarregue a página e tente novamente.');
        return;
      }
      const id = cancellingId;
      if (!id) {
        console.error('[Plan Cancel] UUID da ocorrência não foi preservado ao abrir o modal.');
        setMessage(cancelMessage, 'Não foi possível identificar esta aplicação agendada. Feche a janela e tente novamente.');
        return;
      }
      const record = occurrences.get(id);
      if (!record || record.status !== 'scheduled') {
        console.error('[Plan Cancel] ocorrência ausente ou não agendada.', { id, status: record?.status || 'missing' });
        setMessage(cancelMessage, 'Esta aplicação não está mais disponível para cancelamento. Atualize a página.');
        return;
      }
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user || userData.user.id !== currentUserId) {
        console.error('[Plan Cancel] sessão inválida durante o cancelamento.', userError);
        setMessage(cancelMessage, 'Sua sessão expirou. Entre novamente.');
        return;
      }
      const result = await client.from('scheduled_applications').update({ status: 'cancelled' })
        .eq('id', id).eq('status', 'scheduled').select(occurrenceFields).maybeSingle();
      if (result.error || result.data?.id !== id) {
        console.error('[Plan Cancel] UPDATE não confirmou a ocorrência.', result.error || { expectedId: id, returnedId: result.data?.id || null });
        setMessage(cancelMessage, friendlyError(result.error, 'Não foi possível cancelar esta aplicação agendada.'));
        return;
      }
      succeeded = true;
    } catch (error) {
      console.error('[Plan Cancel] falha inesperada no cancelamento.', error);
      setMessage(cancelMessage, friendlyError(error, 'Não foi possível cancelar esta aplicação agendada.'));
    } finally {
      cancelRequestInFlight = false;
      button.disabled = false;
      button.textContent = originalLabel;
      cancelModal.removeAttribute('aria-busy');
    }
    if (!succeeded) return;
    closeModal(cancelModal, false);
    await loadData(currentUserId);
    showToast('Aplicação agendada cancelada.', 'success');
  });

  document.addEventListener('dosecerta:application-confirmed', () => {
    if (currentUserId) loadData(currentUserId);
  });

  window.PlanModule = Object.freeze({ addCivilDays, generateOccurrenceDates, openCreateWithDraft });

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
