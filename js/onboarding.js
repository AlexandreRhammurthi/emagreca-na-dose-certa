(function initializeOnboarding() {
  'use strict';
  const client = window.supabaseClient;
  const modal = document.getElementById('onboarding-modal');
  const form = document.getElementById('onboarding-form');
  if (!modal || !form) return;
  const state = { user: null, profile: null, step: 1, loading: false };
  const steps = [...modal.querySelectorAll('[data-step]')];
  const message = document.getElementById('onboarding-message');
  const next = document.getElementById('onboarding-next');
  const back = document.getElementById('onboarding-back');
  const submit = document.getElementById('onboarding-submit');
  const cancel = document.getElementById('onboarding-cancel');
  const progress = modal.querySelector('.onboarding-progress span');

  const show = (el, text, success = false) => { el.textContent = text; el.classList.toggle('success', success); el.hidden = false; };
  const clear = (el) => { el.hidden = true; el.textContent = ''; el.classList.remove('success'); };
  const ptNumber = (value) => Number(String(value || '').trim().replace('.', '').replace(',', '.'));
  const adult = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const birth = new Date(`${value}T12:00:00Z`); const today = new Date();
    let age = today.getUTCFullYear() - birth.getUTCFullYear();
    if (Date.now() < Date.UTC(today.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate())) age -= 1;
    return age >= 18 && age <= 120;
  };
  const setStep = (step) => {
    state.step = step;
    steps.forEach((item) => { item.hidden = Number(item.dataset.step) !== step; });
    progress.style.width = `${(step / steps.length) * 100}%`;
    back.hidden = step === 1; next.hidden = step === steps.length; submit.hidden = step !== steps.length; clear(message);
  };
  const toggleConditional = () => {
    const genderOther = document.getElementById('gender-other-field');
    const medicineOther = document.getElementById('medicine-other-field');
    genderOther.hidden = form.elements.gender.value !== 'other'; medicineOther.hidden = form.elements.medicine.value !== 'other';
    form.elements.gender_other.required = !genderOther.hidden; form.elements.medicine_other.required = !medicineOther.hidden;
  };
  const updateInterval = () => { document.getElementById('interval-output').textContent = `A cada ${form.elements.application_interval_days.value} dias`; };
  const validStep = (step) => {
    const scope = steps.find((item) => Number(item.dataset.step) === step);
    let valid = true;
    scope.querySelectorAll('[required]').forEach((input) => { const ok = input.type === 'checkbox' ? input.checked : Boolean(input.value.trim()); input.setAttribute('aria-invalid', String(!ok)); valid &&= ok; });
    if (step === 1 && !adult(form.elements.date_of_birth.value)) { show(message, 'Esta versão beta está disponível somente para pessoas com 18 anos ou mais.'); return false; }
    if (step === 2 && (!(ptNumber(form.elements.weight_kg.value) > 0 && ptNumber(form.elements.weight_kg.value) <= 500) || !(Number(form.elements.height_cm.value) >= 80 && Number(form.elements.height_cm.value) <= 250))) { show(message, 'Informe um peso e uma altura válidos.'); return false; }
    if (!valid) show(message, 'Preencha os campos obrigatórios para continuar.');
    return valid;
  };
  const open = () => {
    const completed = Boolean(state.profile?.completed_at);
    modal.hidden = false; document.body.classList.add('auth-modal-open'); setStep(completed ? 3 : 1);
    document.getElementById('onboarding-delete-open').hidden = !completed;
  };
  const close = () => { modal.hidden = true; document.body.classList.remove('auth-modal-open'); };
  async function loadProfile() {
    if (!client || !state.user) return null;
    const { data, error } = await client.from('onboarding_profiles').select('*').eq('user_id', state.user.id).maybeSingle();
    if (error && error.code !== 'PGRST116') { console.error('Onboarding: perfil indisponível.', { code: error.code || 'unknown' }); return null; }
    state.profile = data; return data;
  }
  const fill = (profile) => {
    if (!profile) return;
    Object.entries(profile).forEach(([key, value]) => { if (form.elements[key] && value != null) form.elements[key].value = value; });
    form.elements.google_calendar_opt_in.checked = Boolean(profile.google_calendar_opt_in); form.elements.health_data_consent.checked = true; toggleConditional(); updateInterval();
  };
  function requireProfile(event) {
    if (!state.user) { event.preventDefault(); event.stopImmediatePropagation(); window.openOnboardingSignupGate?.(); return; }
    if (!state.profile?.completed_at) { event.preventDefault(); event.stopImmediatePropagation(); open(); }
  }
  async function save(event) {
    event.preventDefault(); if (state.loading || !state.user || !validStep(3)) return;
    state.loading = true; submit.disabled = true; clear(message);
    const medicine = form.elements.medicine.value === 'other' ? form.elements.medicine_other.value.trim() : form.elements.medicine.value;
    const payload = { user_id: state.user.id, date_of_birth: form.elements.date_of_birth.value, gender: form.elements.gender.value, gender_other: form.elements.gender.value === 'other' ? form.elements.gender_other.value.trim() : null, country_code: form.elements.country_code.value.trim().toUpperCase(), state: form.elements.state.value, city: form.elements.city.value.trim() || null, height_cm: Number(form.elements.height_cm.value), journey_goal: form.elements.journey_goal.value, medicine, application_interval_days: Number(form.elements.application_interval_days.value), reminder_time: form.elements.reminder_time.value, google_calendar_opt_in: form.elements.google_calendar_opt_in.checked, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data: profile, error } = await client.from('onboarding_profiles').upsert(payload, { onConflict: 'user_id' }).select('*').single();
    if (error) { state.loading = false; submit.disabled = false; show(message, 'Não foi possível salvar seu perfil. Tente novamente.'); return; }
    if (!state.profile?.initial_weight_record_id) {
      const { data: weight, error: weightError } = await client.from('weight_records').insert({ user_id: state.user.id, record_date: new Date().toISOString().slice(0, 10), weight_kg: ptNumber(form.elements.weight_kg.value), notes: 'Peso inicial do onboarding', source: 'manual', application_id: null }).select('id').single();
      if (weightError) { state.loading = false; submit.disabled = false; show(message, 'Seu perfil foi salvo, mas não foi possível registrar o peso inicial. Tente novamente.'); return; }
      await client.from('onboarding_profiles').update({ initial_weight_record_id: weight.id }).eq('user_id', state.user.id);
      profile.initial_weight_record_id = weight.id;
    }
    const now = new Date().toISOString();
    const { error: consentError } = await client.from('user_consents').upsert(['terms', 'privacy', 'health_data'].map((consent_key) => ({ user_id: state.user.id, consent_key, consent_version: 'v1', granted_at: now, revoked_at: null })), { onConflict: 'user_id,consent_key' });
    state.loading = false; submit.disabled = false;
    if (consentError) { show(message, 'Seu perfil foi salvo, mas não foi possível registrar os consentimentos. Tente novamente.'); return; }
    state.profile = profile; close(); window.showToast?.('Perfil concluído com sucesso.', 'success');
    window.DoseAnalytics?.onboardingCompleted();
    if (payload.google_calendar_opt_in) window.showToast?.('Você poderá conectar o Google Agenda em Meu Plano.', 'info');
  }
  async function deleteAccount(event) {
    event.preventDefault(); const deletion = document.getElementById('account-delete-form'); const out = document.getElementById('account-delete-message');
    if (deletion.elements.confirmation.value.trim() !== 'EXCLUIR' || !deletion.elements.password.value) { show(out, 'Informe sua senha e digite EXCLUIR para confirmar.'); return; }
    const { error } = await client.functions.invoke('delete-account', { body: { password: deletion.elements.password.value } }); deletion.elements.password.value = '';
    if (error) { show(out, 'Não foi possível excluir seus dados. Confirme a senha e tente novamente.'); return; }
    await client.auth.signOut(); window.location.assign(window.location.pathname);
  }
  document.addEventListener('dosecerta:auth-session', async ({ detail }) => { state.user = detail?.user || null; state.profile = null; if (!state.user) { close(); return; } await loadProfile(); fill(state.profile); });
  document.addEventListener('dosecerta:simulation', ({ detail }) => { if (detail && !state.user) window.openOnboardingSignupGate?.(); });
  ['diary-nav', 'weight-nav', 'plan-nav', 'register-application', 'weight-register', 'plan-register'].forEach((id) => document.getElementById(id)?.addEventListener('click', requireProfile, true));
  document.getElementById('profile-nav')?.addEventListener('click', async () => { await loadProfile(); fill(state.profile); open(); });
  document.getElementById('onboarding-close').addEventListener('click', close);
  cancel.addEventListener('click', () => { close(); window.showToast?.('Você pode concluir seu perfil quando quiser.', 'info'); });
  modal.querySelector('.auth-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden && !state.loading) close(); });
  form.elements.gender.addEventListener('change', toggleConditional); form.elements.medicine.addEventListener('change', toggleConditional); form.elements.application_interval_days.addEventListener('input', updateInterval);
  next.addEventListener('click', () => { if (validStep(state.step)) setStep(state.step + 1); }); back.addEventListener('click', () => setStep(state.step - 1)); form.addEventListener('submit', save);
  document.getElementById('onboarding-delete-open').addEventListener('click', () => { document.getElementById('account-delete-modal').hidden = false; close(); }); document.querySelectorAll('[data-account-delete-close]').forEach((item) => item.addEventListener('click', () => { document.getElementById('account-delete-modal').hidden = true; })); document.getElementById('account-delete-form').addEventListener('submit', deleteAccount);
  toggleConditional(); updateInterval(); setStep(1);
})();
