(function initializeMedicationVials() {
  'use strict';

  const client = window.supabaseClient;
  const modal = document.getElementById('medication-vial-modal');
  const form = document.getElementById('medication-vial-form');
  const message = document.getElementById('medication-vial-message');
  const select = document.getElementById('application-medication-vial');
  const createButton = document.getElementById('application-vial-create');
  const replacementModal = document.getElementById('medication-vial-replacement-modal');
  const replacementCreate = document.getElementById('vial-replacement-create');
  let currentUserId = null;
  let returnFocus = null;
  let pendingMedicine = '';

  async function resolveCurrentUserId() {
    if (currentUserId) return currentUserId;
    if (!client) return null;
    const { data, error } = await client.auth.getUser();
    currentUserId = error ? null : data.user?.id || null;
    return currentUserId;
  }

  function setMessage(text = '') { message.textContent = text; message.hidden = !text; }
  function close() {
    modal.hidden = true;
    if (document.querySelectorAll('.diary-modal:not([hidden]),.auth-modal:not([hidden])').length === 0) document.body.classList.remove('auth-modal-open');
    returnFocus?.focus();
  }
  async function open({ medicine = '', trigger = document.activeElement } = {}) {
    if (!await resolveCurrentUserId()) return;
    returnFocus = trigger;
    pendingMedicine = String(medicine || '').trim();
    form.reset();
    form.elements.medicine.value = pendingMedicine;
    setMessage();
    modal.hidden = false;
    document.body.classList.add('auth-modal-open');
    window.requestAnimationFrame(() => form.elements.medicine.focus());
  }
  function offerReplacement({ medicine = '', trigger = document.activeElement } = {}) {
    pendingMedicine = String(medicine || '').trim();
    returnFocus = trigger;
    replacementModal.hidden = false;
    document.body.classList.add('auth-modal-open');
    window.requestAnimationFrame(() => replacementCreate.focus());
  }
  function closeReplacement() {
    replacementModal.hidden = true;
    returnFocus?.focus();
  }
  function number(value) {
    const parsed = Number(String(value).replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  function label(vial) {
    const usedMg = Number(vial.used_mg || 0);
    const usedMl = Number(vial.used_ml || 0);
    const remainingMg = Math.max(0, Number(vial.initial_mg) - usedMg);
    const remainingMl = Math.max(0, Number(vial.initial_ml) - usedMl);
    const format = (value) => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    return `${vial.medicine} · saldo ${format(remainingMg)} mg / ${format(remainingMl)} mL`;
  }
  async function loadActive({ selectedId = '', medicine = '' } = {}) {
    if (!client || !await resolveCurrentUserId()) {
      select.replaceChildren(new Option('Não vincular a um frasco', ''));
      return [];
    }
    const { data, error } = await client.from('medication_vials')
      .select('id,medicine,initial_mg,initial_ml,status,created_at,vial_usages(used_mg,used_ml)')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (error) { console.error('Frascos: falha ao carregar lista.', { code: error.code || 'unknown' }); return []; }
    const vials = (data || []).map((vial) => ({
      ...vial,
      used_mg: (vial.vial_usages || []).reduce((sum, usage) => sum + Number(usage.used_mg || 0), 0),
      used_ml: (vial.vial_usages || []).reduce((sum, usage) => sum + Number(usage.used_ml || 0), 0)
    }));
    const preferred = String(medicine || '').trim().toLowerCase();
    const ordered = preferred ? [...vials].sort((a, b) => Number(b.medicine.toLowerCase() === preferred) - Number(a.medicine.toLowerCase() === preferred)) : vials;
    select.replaceChildren(new Option('Não vincular a um frasco', ''));
    ordered.forEach((vial) => select.add(new Option(label(vial), vial.id, false, vial.id === selectedId)));
    return ordered;
  }
  async function getApplicationVialId(applicationId) {
    if (!client || !applicationId) return '';
    const { data, error } = await client.from('vial_usages').select('vial_id').eq('application_id', applicationId).maybeSingle();
    if (error) console.error('Frascos: falha ao localizar retirada.', { code: error.code || 'unknown' });
    return data?.vial_id || '';
  }

  createButton.addEventListener('click', () => open({ medicine: document.getElementById('application-medicine').value, trigger: createButton }));
  modal.querySelectorAll('[data-vial-close]').forEach((button) => button.addEventListener('click', close));
  replacementModal.querySelectorAll('[data-vial-replacement-close]').forEach((button) => button.addEventListener('click', closeReplacement));
  replacementCreate.addEventListener('click', () => { replacementModal.hidden = true; open({ medicine: pendingMedicine, trigger: replacementCreate }); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client || !await resolveCurrentUserId()) { setMessage('Sua sessão expirou. Entre novamente.'); return; }
    const medicine = form.elements.medicine.value.trim();
    const initialMg = number(form.elements.initial_mg.value);
    const initialMl = number(form.elements.initial_ml.value);
    if (!medicine || !initialMg || !initialMl) { setMessage('Informe medicamento, quantidade em mg e volume em mL válidos.'); return; }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const { data, error } = await client.from('medication_vials').insert({
      user_id: currentUserId, medicine, initial_mg: initialMg, initial_ml: initialMl,
      opened_on: form.elements.opened_on.value || null, notes: form.elements.notes.value.trim() || null
    }).select('id').single();
    submit.disabled = false;
    if (error || !data?.id) { setMessage('Não foi possível salvar este frasco. Tente novamente.'); console.error('Frascos: falha ao salvar.', { code: error?.code || 'unknown' }); return; }
    await loadActive({ selectedId: data.id, medicine: pendingMedicine || medicine });
    close();
    window.showToast?.('Novo frasco cadastrado. Ele já pode ser usado nesta aplicação.', 'success');
  });
  document.addEventListener('dosecerta:auth-session', ({ detail }) => {
    currentUserId = detail?.user?.id || null;
    if (!currentUserId) select.replaceChildren(new Option('Não vincular a um frasco', ''));
  });
  client?.auth.getSession().then(({ data }) => { currentUserId = data.session?.user?.id || null; });
  window.MedicationVials = Object.freeze({ loadActive, getApplicationVialId, open, offerReplacement });
})();
