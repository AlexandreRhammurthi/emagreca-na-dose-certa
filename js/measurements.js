(function initializeMeasurements() {
  'use strict';

  const client = window.supabaseClient;
  const section = document.getElementById('weight-section');
  const status = document.getElementById('measurements-status');
  const list = document.getElementById('measurements-list');
  const modal = document.getElementById('measurements-form-modal');
  const form = document.getElementById('measurements-form');
  const message = document.getElementById('measurements-message');
  const register = document.getElementById('measurements-register');
  const fields = ['abdominal_cm', 'waist_cm', 'upper_arm_left_cm', 'upper_arm_right_cm', 'thigh_left_cm', 'thigh_right_cm', 'calf_left_cm', 'calf_right_cm'];
  const labels = { abdominal_cm: 'Abdômen', waist_cm: 'Cintura', upper_arm_left_cm: 'Braço esquerdo', upper_arm_right_cm: 'Braço direito', thigh_left_cm: 'Coxa esquerda', thigh_right_cm: 'Coxa direita', calf_left_cm: 'Panturrilha esquerda', calf_right_cm: 'Panturrilha direita' };
  const records = new Map();
  let currentUserId = null;
  let editingId = null;
  let requestInFlight = false;
  let returnFocus = null;

  function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
  function parse(value) { const normalized = String(value || '').trim(); if (!normalized) return null; if (!/^\d+(?:[.,]\d+)?$/u.test(normalized)) return Number.NaN; const number = Number(normalized.replace(',', '.')); return Number.isFinite(number) && number > 0 && number <= 999.99 ? number : Number.NaN; }
  function dateLabel(value) { const [year, month, day] = String(value || '').split('-'); return year ? `${day}/${month}/${year}` : 'Data não informada'; }
  function format(value) { return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }
  function setMessage(text = '') { message.textContent = text; message.hidden = !text; }
  function toast(text, type = 'info') { if (typeof window.showToast === 'function') window.showToast(text, type); }
  function friendly(error) { const text = String(error?.message || '').toLowerCase(); return text.includes('jwt') || text.includes('session') ? 'Sua sessão expirou. Entre novamente.' : 'Não foi possível salvar as medidas. Tente novamente.'; }

  function open(trigger, record = null) {
    returnFocus = trigger || document.activeElement; editingId = record?.id || null; form.reset();
    form.elements.record_date.value = record?.record_date || today();
    fields.forEach((field) => { form.elements[field].value = record?.[field] == null ? '' : String(record[field]).replace('.', ','); });
    form.elements.notes.value = record?.notes || ''; document.getElementById('measurements-form-title').textContent = record ? 'Editar medidas' : 'Registrar medidas'; setMessage();
    modal.hidden = false; document.body.classList.add('auth-modal-open'); window.requestAnimationFrame(() => form.elements.record_date.focus());
  }
  function close() { modal.hidden = true; editingId = null; document.body.classList.remove('auth-modal-open'); returnFocus?.focus(); }

  function card(record) {
    const article = document.createElement('article'); article.className = 'measurements-card';
    const date = document.createElement('strong'); date.textContent = dateLabel(record.record_date);
    const values = document.createElement('p'); values.textContent = fields.filter((field) => record[field] != null).map((field) => `${labels[field]}: ${format(record[field])} cm`).join(' · ');
    const actions = document.createElement('div'); actions.className = 'measurements-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'weight-action edit'; edit.textContent = 'Editar'; edit.addEventListener('click', () => open(edit, record));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'weight-action delete'; remove.textContent = 'Excluir'; remove.addEventListener('click', () => removeRecord(record, remove));
    actions.append(edit, remove); article.append(date, values, actions); return article;
  }
  function render(data) { records.clear(); list.replaceChildren(); if (!data.length) { status.hidden = false; status.textContent = 'Você ainda não registrou medidas corporais.'; return; } status.hidden = true; data.forEach((record) => { records.set(record.id, record); list.append(card(record)); }); }
  async function load(userId) { status.hidden = false; status.textContent = 'Carregando medidas...'; const { data, error } = await client.from('body_measurements').select('*').order('record_date', { ascending: false }).order('created_at', { ascending: false }); if (userId !== currentUserId) return; if (error) { status.textContent = 'Não foi possível carregar as medidas.'; return; } render(data || []); }

  async function removeRecord(record, button) {
    if (!window.confirm(`Excluir as medidas de ${dateLabel(record.record_date)}?`)) return;
    const { data: userData } = await client.auth.getUser(); if (!userData?.user || userData.user.id !== currentUserId) return toast('Sua sessão expirou.', 'error');
    button.disabled = true; const { data, error } = await client.from('body_measurements').delete().eq('id', record.id).select('id').maybeSingle(); button.disabled = false;
    if (error || data?.id !== record.id) return toast('Não foi possível excluir as medidas.', 'error'); await load(currentUserId); toast('Medidas excluídas.', 'success');
  }

  register.addEventListener('click', () => open(register));
  document.querySelectorAll('[data-measurements-close]').forEach((button) => button.addEventListener('click', close));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) { event.preventDefault(); close(); } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!client || requestInFlight) return; setMessage();
    const payload = { record_date: form.elements.record_date.value, notes: form.elements.notes.value.trim() || null };
    let total = 0;
    for (const field of fields) { const value = parse(form.elements[field].value); if (Number.isNaN(value)) return setMessage('Informe apenas medidas válidas maiores que zero.'); payload[field] = value; if (value !== null) total += 1; }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(payload.record_date) || total === 0) return setMessage('Informe a data e pelo menos uma medida válida.');
    let userData; let userError;
    try { ({ data: userData, error: userError } = await client.auth.getUser()); } catch (error) { userError = error; }
    if (userError || !userData?.user || userData.user.id !== currentUserId) return setMessage('Sua sessão expirou. Entre novamente.');
    const recordId = editingId;
    const updating = Boolean(recordId);
    requestInFlight = true; const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    let result;
    try { result = updating ? await client.from('body_measurements').update(payload).eq('id', recordId).select('*').single() : await client.from('body_measurements').insert({ ...payload, user_id: userData.user.id }).select('*').single(); } catch (error) { result = { data: null, error }; } finally { requestInFlight = false; submit.disabled = false; }
    if (result.error || !result.data) return setMessage(friendly(result.error)); close(); await load(currentUserId); toast(updating ? 'Medidas atualizadas.' : 'Medidas registradas.', 'success');
  });
  if (!client) return;
  client.auth.onAuthStateChange((_event, session) => { window.setTimeout(() => { const next = session?.user?.id || null; if (next === currentUserId) return; currentUserId = next; modal.hidden = true; records.clear(); if (next) load(next); else { list.replaceChildren(); status.textContent = ''; } }, 0); });
}());
