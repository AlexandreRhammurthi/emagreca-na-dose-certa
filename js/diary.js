(function initializeDiary() {
  'use strict';

  const client = window.supabaseClient;
  const calculator = window.DoseCalculator;
  const registerButton = document.getElementById('register-application');
  const diarySection = document.getElementById('diary-section');
  const diaryStatus = document.getElementById('diary-status');
  const diaryList = document.getElementById('diary-list');
  const diaryDashboard = document.getElementById('diary-dashboard');
  const diaryHistory = document.getElementById('diary-history');
  const diaryHistoryToggle = document.getElementById('diary-history-toggle');
  const diaryHistoryClose = document.getElementById('diary-history-close');
  const formModal = document.getElementById('application-form-modal');
  const detailsModal = document.getElementById('application-details-modal');
  const deleteModal = document.getElementById('application-delete-modal');
  const applicationForm = document.getElementById('application-form');
  const notes = document.getElementById('application-notes');
  const formMessage = document.getElementById('application-form-message');
  const deleteMessage = document.getElementById('application-delete-message');
  const formFields = ['application-vial-mg', 'application-vial-ml', 'application-dose-mg', 'application-syringe'];
  const records = new Map();
  const associatedWeights = new Map();
  const modalReturnFocus = new Map();
  const linkedWeightNote = 'Peso registrado junto à aplicação';
  let currentUser = null;
  let currentUserId = null;
  let selectedId = null;
  let pendingRegistration = false;
  let requestInFlight = false;
  let latestDashboardId = null;

  function ptNumber(value, digits = 2) {
    return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  }

  function todayCivil() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function daysAgoCivil(days) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatCivilDate(value, long = false) {
    const [year, month, day] = String(value || '').split('-').map(Number);
    if (!year || !month || !day) return 'Data não informada';
    if (!long) return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, day))).replace('.', '').toUpperCase();
  }

  function friendlyDatabaseError(error, fallback) {
    const text = String(error?.message || '').toLowerCase();
    if (text.includes('jwt') || text.includes('session')) return 'Sua sessão expirou. Entre novamente.';
    if (text.includes('fetch') || text.includes('network')) return 'Não foi possível conectar. Verifique sua internet.';
    return fallback;
  }

  function reportTechnicalError(context, error) {
    console.error(`Diário: ${context}`, { code: error?.code || 'unknown', message: error?.message || 'unknown' });
  }

  function setInlineMessage(element, message = '') {
    element.textContent = message;
    element.hidden = !message;
  }

  function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
  }

  function focusableElements(modal) {
    return [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
      .filter((element) => element.offsetParent !== null);
  }

  function openModal(modal, trigger = document.activeElement) {
    modalReturnFocus.set(modal, trigger);
    modal.hidden = false;
    document.body.classList.add('auth-modal-open');
    window.requestAnimationFrame(() => focusableElements(modal)[0]?.focus() || modal.querySelector('[role="dialog"], [role="alertdialog"]')?.focus());
  }

  function closeModal(modal, restoreFocus = true) {
    if (requestInFlight) return;
    modal.hidden = true;
    if ([formModal, detailsModal, deleteModal].every((item) => item.hidden)) document.body.classList.remove('auth-modal-open');
    if (restoreFocus) modalReturnFocus.get(modal)?.focus();
  }

  function calculationFromForm() {
    return calculator?.calculateDose({
      vialMg: applicationForm.elements.vial_mg.value,
      vialMl: applicationForm.elements.vial_ml.value,
      doseMg: applicationForm.elements.dose_mg.value,
      syringeCapacity: applicationForm.elements.syringe_capacity.value
    });
  }

  function updateCalculationPreview() {
    const calculation = calculationFromForm();
    document.getElementById('application-volume-preview').textContent = calculation ? `${ptNumber(calculation.volumeMl, 3)} mL` : '—';
    document.getElementById('application-units-preview').textContent = calculation ? `${ptNumber(calculation.units)} UI` : '—';
    return calculation;
  }

  function updateNotesCount() {
    document.getElementById('application-notes-count').textContent = `${notes.value.length}/500`;
  }

  function parseOptionalWeight(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    if (!/^\d+(?:[.,]\d+)?$/u.test(normalized)) return Number.NaN;
    const weight = Number(normalized.replace(',', '.'));
    return Number.isFinite(weight) && weight > 0 ? weight : Number.NaN;
  }

  function formatWeightInput(value) {
    return Number.isFinite(Number(value)) ? String(Number(value)).replace('.', ',') : '';
  }

  async function findAssociatedWeight(application) {
    const fields = 'id,record_date,weight_kg,notes,source,application_id,created_at';
    const linkedResult = await client.from('weight_records')
      .select(fields)
      .eq('application_id', application.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (linkedResult.error || linkedResult.data) {
      return { record: linkedResult.data || null, error: linkedResult.error };
    }
    const legacyResult = await client.from('weight_records')
      .select(fields)
      .eq('record_date', application.application_date)
      .eq('notes', linkedWeightNote)
      .eq('source', 'application')
      .is('application_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return { record: legacyResult.data || null, error: legacyResult.error };
  }

  function fillForm(data, editing = false, initialCalculation = null, associatedWeight = null) {
    applicationForm.reset();
    applicationForm.elements.id.value = editing ? data.id : '';
    applicationForm.elements.medicine.value = data.medicine;
    applicationForm.elements.application_date.value = data.application_date || todayCivil();
    applicationForm.elements.vial_mg.value = data.vial_mg;
    applicationForm.elements.vial_ml.value = data.vial_ml;
    applicationForm.elements.dose_mg.value = data.dose_mg;
    applicationForm.elements.syringe_capacity.value = String(data.syringe_capacity);
    applicationForm.elements.notes.value = data.notes || '';
    applicationForm.elements.weight_kg.value = formatWeightInput(associatedWeight?.weight_kg);
    document.getElementById('application-weight-field').hidden = false;
    document.getElementById('application-form-title').textContent = editing ? 'Editar aplicação' : 'Registrar aplicação';
    document.getElementById('application-submit-label').textContent = editing ? 'Salvar alterações' : 'Registrar aplicação';
    setInlineMessage(formMessage);
    updateNotesCount();
    if (initialCalculation) {
      document.getElementById('application-volume-preview').textContent = `${ptNumber(initialCalculation.volumeMl, 3)} mL`;
      document.getElementById('application-units-preview').textContent = `${ptNumber(initialCalculation.units)} UI`;
    } else {
      updateCalculationPreview();
    }
  }

  function openRegistration(trigger = registerButton) {
    const simulation = calculator?.getCurrentSimulation();
    if (!simulation) {
      showToast('Faça uma simulação válida antes de registrar.', 'info');
      return;
    }
    fillForm({
      medicine: simulation.medicine,
      vial_mg: simulation.vialMg,
      vial_ml: simulation.vialMl,
      dose_mg: simulation.doseMg,
      syringe_capacity: simulation.syringeCapacity,
      application_date: todayCivil(),
      notes: ''
    }, false, simulation);
    openModal(formModal, trigger);
  }

  function appendDetail(list, label, value) {
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    list.append(term, description);
  }

  async function openDetails(id, trigger) {
    const record = records.get(id);
    if (!record) return;
    const userIdAtStart = currentUserId;
    selectedId = id;
    const weightLookup = await findAssociatedWeight(record);
    if (selectedId !== id || currentUserId !== userIdAtStart) return;
    if (weightLookup.error) {
      reportTechnicalError('falha ao carregar peso associado', weightLookup.error);
      showToast('Não foi possível carregar o peso associado.', 'error');
    } else if (weightLookup.record) {
      associatedWeights.set(id, weightLookup.record);
    } else {
      associatedWeights.delete(id);
    }
    const list = document.getElementById('application-details');
    list.replaceChildren();
    appendDetail(list, 'Data', formatCivilDate(record.application_date));
    appendDetail(list, 'Medicamento', record.medicine);
    appendDetail(list, 'Apresentação', `${ptNumber(record.vial_mg)} mg / ${ptNumber(record.vial_ml)} mL`);
    appendDetail(list, 'Dose informada', `${ptNumber(record.dose_mg)} mg`);
    appendDetail(list, 'Volume calculado', `${ptNumber(record.volume_ml, 3)} mL`);
    appendDetail(list, 'Quantidade calculada', `${ptNumber(record.units)} UI`);
    appendDetail(list, 'Seringa', `${ptNumber(record.syringe_capacity, 0)} UI`);
    appendDetail(
      list,
      'Peso no momento da aplicação',
      weightLookup.error ? 'Não foi possível carregar' : weightLookup.record ? `${ptNumber(weightLookup.record.weight_kg)} kg` : 'Não informado'
    );
    appendDetail(list, 'Observações', record.notes || 'Nenhuma observação.');
    if (record.created_at) appendDetail(list, 'Registrado em', new Date(record.created_at).toLocaleString('pt-BR'));
    openModal(detailsModal, trigger);
  }

  function createDiaryCard(record) {
    const article = document.createElement('article');
    article.className = 'diary-card';
    const date = document.createElement('time');
    date.dateTime = record.application_date;
    date.textContent = formatCivilDate(record.application_date, true);
    const content = document.createElement('div');
    const medicine = document.createElement('h3');
    medicine.textContent = record.medicine;
    const values = document.createElement('p');
    values.textContent = `${ptNumber(record.dose_mg)} mg · ${ptNumber(record.units)} UI`;
    content.append(medicine, values);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-action';
    button.textContent = 'Ver detalhes';
    button.setAttribute('aria-label', `Ver detalhes da aplicação de ${record.medicine} em ${formatCivilDate(record.application_date)}`);
    button.addEventListener('click', () => openDetails(record.id, button));
    article.append(date, content, button);
    return article;
  }

  function setHistoryVisible(visible, restoreFocus = false) {
    diaryHistory.hidden = !visible;
    diaryHistoryToggle.setAttribute('aria-expanded', String(visible));
    diaryHistoryToggle.querySelector('b').textContent = visible ? 'Ocultar histórico completo' : 'Ver histórico completo';
    if (restoreFocus) {
      diaryHistoryToggle.focus({ preventScroll: true });
      diaryHistoryToggle.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function renderDashboard(items) {
    const latest = items[0];
    latestDashboardId = latest.id;
    document.getElementById('diary-last-date').textContent = formatCivilDate(latest.application_date);
    document.getElementById('diary-last-medicine').textContent = latest.medicine;
    const cutoff = daysAgoCivil(29);
    document.getElementById('diary-month-count').textContent = String(items.filter((record) => record.application_date >= cutoff && record.application_date <= todayCivil()).length);
    const medicineCounts = new Map();
    items.forEach((record) => medicineCounts.set(record.medicine, (medicineCounts.get(record.medicine) || 0) + 1));
    const [topMedicine, topCount] = [...medicineCounts.entries()].sort((first, second) => second[1] - first[1])[0];
    document.getElementById('diary-top-medicine').textContent = topMedicine;
    document.getElementById('diary-top-count').textContent = `${topCount} ${topCount === 1 ? 'aplicação' : 'aplicações'}`;
    document.getElementById('diary-latest-dose').textContent = `${ptNumber(latest.dose_mg)} mg`;
    document.getElementById('diary-latest-units').textContent = `${ptNumber(latest.units)} UI`;
    document.getElementById('diary-latest-syringe').textContent = `${ptNumber(latest.syringe_capacity, 0)} UI`;
    const activity = document.getElementById('diary-activity');
    activity.replaceChildren();
    const recentItems = items.slice(0, 5).reverse();
    activity.style.gridTemplateColumns = `repeat(${recentItems.length}, minmax(0, 1fr))`;
    activity.classList.toggle('single', recentItems.length === 1);
    recentItems.forEach((record) => {
      const point = document.createElement('span');
      const dose = document.createElement('b');
      dose.textContent = `${ptNumber(record.dose_mg)} mg`;
      const dot = document.createElement('i');
      dot.setAttribute('aria-hidden', 'true');
      const date = document.createElement('time');
      date.dateTime = record.application_date;
      date.textContent = formatCivilDate(record.application_date).slice(0, 5);
      point.append(dose, dot, date);
      activity.appendChild(point);
    });
    diaryDashboard.hidden = false;
  }

  function renderHistory(items) {
    diaryList.replaceChildren();
    records.clear();
    associatedWeights.clear();
    latestDashboardId = null;
    setHistoryVisible(false);
    if (!items.length) {
      diaryDashboard.hidden = true;
      diaryStatus.hidden = false;
      diaryStatus.textContent = 'Você ainda não registrou nenhuma aplicação.';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-action empty-action';
      button.textContent = 'Fazer uma simulação';
      button.addEventListener('click', scrollToSimulator);
      diaryStatus.append(document.createElement('br'), button);
      return;
    }
    diaryStatus.hidden = true;
    renderDashboard(items);
    items.forEach((record) => {
      records.set(record.id, record);
      diaryList.appendChild(createDiaryCard(record));
    });
  }

  async function loadHistory(userId) {
    diaryStatus.hidden = false;
    diaryStatus.textContent = 'Carregando seu diário...';
    diaryDashboard.hidden = true;
    setHistoryVisible(false);
    diaryList.replaceChildren();
    const { data, error } = await client.from('applications')
      .select('id,application_date,medicine,vial_mg,vial_ml,dose_mg,volume_ml,units,syringe_capacity,source,calculation_version,notes,created_at,updated_at')
      .order('application_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    if (currentUserId !== userId) return;
    if (error) {
      reportTechnicalError('falha ao carregar histórico', error);
      diaryStatus.textContent = friendlyDatabaseError(error, 'Não foi possível carregar seu diário. Tente novamente.');
      return;
    }
    renderHistory(data || []);
  }

  async function applySession(session) {
    const nextUser = session?.user || null;
    if (nextUser?.id === currentUserId) return;
    currentUser = nextUser;
    currentUserId = nextUser?.id || null;
    selectedId = null;
    latestDashboardId = null;
    records.clear();
    associatedWeights.clear();
    diaryList.replaceChildren();
    diaryDashboard.hidden = true;
    setHistoryVisible(false);
    [formModal, detailsModal, deleteModal].forEach((modal) => { modal.hidden = true; });
    document.body.classList.remove('auth-modal-open');
    diarySection.hidden = !nextUser;
    if (!nextUser) {
      diaryStatus.textContent = '';
      return;
    }
    await loadHistory(nextUser.id);
    if (pendingRegistration) {
      pendingRegistration = false;
      window.setTimeout(() => openRegistration(registerButton), 0);
    }
  }

  function scrollToSimulator() {
    document.querySelector('.app-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('medicine')?.focus({ preventScroll: true });
  }

  registerButton.addEventListener('click', () => {
    if (!calculator?.getCurrentSimulation()) return;
    if (!currentUser) {
      pendingRegistration = true;
      document.querySelector('[data-auth-open="login"]')?.click();
      return;
    }
    openRegistration(registerButton);
  });

  document.addEventListener('dosecerta:simulation', (event) => {
    registerButton.disabled = !event.detail;
  });

  document.getElementById('diary-simulate').addEventListener('click', scrollToSimulator);
  document.getElementById('diary-latest-details').addEventListener('click', (event) => {
    if (latestDashboardId) openDetails(latestDashboardId, event.currentTarget);
  });
  diaryHistoryToggle.addEventListener('click', () => setHistoryVisible(diaryHistory.hidden));
  diaryHistoryClose.addEventListener('click', () => setHistoryVisible(false, true));
  formFields.forEach((id) => document.getElementById(id).addEventListener('input', updateCalculationPreview));
  notes.addEventListener('input', updateNotesCount);

  document.querySelectorAll('[data-diary-close]').forEach((button) => {
    button.addEventListener('click', () => {
      const modal = { form: formModal, details: detailsModal, delete: deleteModal }[button.dataset.diaryClose];
      closeModal(modal);
    });
  });

  document.addEventListener('keydown', (event) => {
    const openDiaryModal = [deleteModal, detailsModal, formModal].find((modal) => !modal.hidden);
    if (!openDiaryModal) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal(openDiaryModal);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(openDiaryModal);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  document.getElementById('application-edit').addEventListener('click', async (event) => {
    const record = records.get(selectedId);
    if (!record) return;
    const userIdAtStart = currentUserId;
    const button = event.currentTarget;
    button.disabled = true;
    const weightLookup = await findAssociatedWeight(record);
    button.disabled = false;
    if (currentUserId !== userIdAtStart || !records.has(record.id)) return;
    if (weightLookup.error) {
      reportTechnicalError('falha ao preparar edição do peso', weightLookup.error);
      showToast('Não foi possível carregar o peso para edição.', 'error');
      return;
    }
    if (weightLookup.record) associatedWeights.set(record.id, weightLookup.record);
    else associatedWeights.delete(record.id);
    const originalTrigger = modalReturnFocus.get(detailsModal);
    closeModal(detailsModal, false);
    fillForm(record, true, null, weightLookup.record);
    openModal(formModal, originalTrigger);
  });

  document.getElementById('application-delete-open').addEventListener('click', () => {
    if (!records.has(selectedId)) return;
    const originalTrigger = modalReturnFocus.get(detailsModal);
    closeModal(detailsModal, false);
    setInlineMessage(deleteMessage);
    openModal(deleteModal, originalTrigger);
  });

  applicationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client || requestInFlight) return;
    setInlineMessage(formMessage);
    const medicine = applicationForm.elements.medicine.value.trim();
    const applicationDate = applicationForm.elements.application_date.value;
    const calculation = updateCalculationPreview();
    const id = applicationForm.elements.id.value;
    const weightKg = parseOptionalWeight(applicationForm.elements.weight_kg.value);
    if (!medicine || !applicationDate || !calculation) {
      setInlineMessage(formMessage, 'Preencha todos os campos com valores válidos.');
      return;
    }
    if (Number.isNaN(weightKg)) {
      setInlineMessage(formMessage, 'Informe um peso válido maior que zero ou deixe o campo vazio.');
      return;
    }
    if (applicationDate > todayCivil()) {
      setInlineMessage(formMessage, 'Aplicações futuras serão tratadas no Plano. Informe uma data de aplicação realizada.');
      return;
    }
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user || userData.user.id !== currentUserId) {
      setInlineMessage(formMessage, 'Sua sessão expirou. Entre novamente.');
      return;
    }
    const payload = {
      application_date: applicationDate,
      medicine,
      vial_mg: calculation.vialMg,
      vial_ml: calculation.vialMl,
      dose_mg: calculation.doseMg,
      volume_ml: calculation.volumeMl,
      units: calculation.units,
      syringe_capacity: calculation.syringeCapacity,
      notes: applicationForm.elements.notes.value.trim()
    };
    const submit = applicationForm.querySelector('[type="submit"]');
    requestInFlight = true;
    submit.disabled = true;
    submit.classList.add('is-loading');
    let result;
    if (id) {
      result = await client.from('applications').update(payload).eq('id', id).select('*').single();
    } else {
      result = await client.from('applications').insert({
        ...payload,
        user_id: userData.user.id,
        source: 'simulator',
        calculation_version: 1
      }).select('*').single();
    }
    if (result.error || !result.data) {
      requestInFlight = false;
      submit.disabled = false;
      submit.classList.remove('is-loading');
      reportTechnicalError(id ? 'falha ao atualizar aplicação' : 'falha ao registrar aplicação', result.error);
      setInlineMessage(formMessage, friendlyDatabaseError(result.error, id ? 'Não foi possível atualizar a aplicação.' : 'Não foi possível registrar a aplicação.'));
      return;
    }
    let weightError = null;
    let synchronizedWeight = null;
    const existingWeight = id ? associatedWeights.get(id) || null : null;
    const applicationId = result.data.id;
    if (existingWeight && weightKg === null) {
      if (existingWeight.application_id !== applicationId) {
        const linkResult = await client.from('weight_records').update({
          source: 'application',
          application_id: applicationId
        }).eq('id', existingWeight.id).is('application_id', null).select('id').maybeSingle();
        weightError = linkResult.error || (linkResult.data?.id === existingWeight.id ? null : { message: 'Registro de peso legado não foi vinculado.' });
      }
      const weightResult = weightError ? null : await client.from('weight_records').delete()
        .eq('id', existingWeight.id)
        .eq('application_id', applicationId)
        .select('id')
        .maybeSingle();
      if (!weightError) {
        weightError = weightResult.error || (weightResult.data?.id === existingWeight.id ? null : { message: 'Registro de peso não foi excluído.' });
      }
    } else if (existingWeight && weightKg !== null) {
      const weightResult = await client.from('weight_records').update({
        record_date: applicationDate,
        weight_kg: weightKg,
        source: 'application',
        application_id: applicationId
      }).eq('id', existingWeight.id).select('id,record_date,weight_kg,notes,source,application_id,created_at').single();
      weightError = weightResult.error;
      synchronizedWeight = weightResult.data || null;
    } else if (!existingWeight && weightKg !== null) {
      const weightResult = await client.from('weight_records').insert({
        user_id: userData.user.id,
        record_date: applicationDate,
        weight_kg: weightKg,
        notes: linkedWeightNote,
        source: 'application',
        application_id: applicationId
      }).select('id,record_date,weight_kg,notes,source,application_id,created_at').single();
      weightError = weightResult.error;
      synchronizedWeight = weightResult.data || null;
    }
    if (weightError) reportTechnicalError(id ? 'aplicação atualizada, mas houve falha ao sincronizar peso' : 'aplicação registrada, mas houve falha ao registrar peso', weightError);
    requestInFlight = false;
    submit.disabled = false;
    submit.classList.remove('is-loading');
    if (weightError && id) {
      records.set(id, result.data);
      setInlineMessage(formMessage, 'A aplicação foi atualizada, mas não foi possível sincronizar o peso. Tente salvar novamente.');
      return;
    }
    if (id) {
      if (synchronizedWeight) associatedWeights.set(id, synchronizedWeight);
      else if (existingWeight && weightKg === null) associatedWeights.delete(id);
    }
    closeModal(formModal, false);
    await loadHistory(currentUserId);
    if (weightError) {
      showToast('Aplicação registrada, mas não foi possível registrar o peso.', 'error');
    } else {
      showToast(id ? 'Aplicação atualizada com sucesso.' : 'Aplicação registrada com sucesso.', 'success');
    }
  });

  document.getElementById('application-delete-confirm').addEventListener('click', async (event) => {
    if (!client || requestInFlight || !selectedId) return;
    const id = selectedId;
    const button = event.currentTarget;
    requestInFlight = true;
    button.disabled = true;
    const { data, error } = await client.from('applications').delete().eq('id', id).select('id').maybeSingle();
    requestInFlight = false;
    button.disabled = false;
    if (error || data?.id !== id) {
      reportTechnicalError('falha ao excluir aplicação', error);
      setInlineMessage(deleteMessage, friendlyDatabaseError(error, 'Não foi possível excluir a aplicação.'));
      return;
    }
    selectedId = null;
    closeModal(deleteModal, false);
    await loadHistory(currentUserId);
    showToast('Aplicação excluída.', 'success');
  });

  registerButton.disabled = !calculator?.getCurrentSimulation();
  if (!client) {
    diarySection.hidden = true;
    return;
  }
  client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => applySession(session), 0);
  });
  client.auth.getSession().then(({ data, error }) => {
    if (!error) applySession(data.session);
  });
})();
