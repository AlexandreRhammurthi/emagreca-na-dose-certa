(function initializePersonalReport() {
  'use strict';
  const client = window.supabaseClient;
  const button = document.getElementById('report-export');
  if (!client || !button) return;
  const text = (value) => String(value ?? '').replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  const date = (value) => { const [year, month, day] = String(value || '').split('-'); return year ? `${day}/${month}/${year}` : '—'; };
  const number = (value, suffix = '') => `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}`;
  button.addEventListener('click', async () => {
    const report = window.open('', '_blank');
    if (!report) return window.showToast?.('Permita a abertura da janela para gerar o relatório.', 'error');
    report.opener = null;
    button.disabled = true;
    const [apps, weights, measures, effects] = await Promise.all([
      client.from('applications').select('application_date,medicine,dose_mg,units').order('application_date', { ascending: false }),
      client.from('weight_records').select('record_date,weight_kg,source').order('record_date', { ascending: true }),
      client.from('body_measurements').select('*').order('record_date', { ascending: false }),
      client.from('application_effect_notes').select('record_date,note').order('record_date', { ascending: false })
    ]);
    button.disabled = false;
    if (apps.error || weights.error || measures.error || effects.error) { report.close(); return window.showToast?.('Não foi possível gerar o relatório agora.', 'error'); }
    const weightRows = (weights.data || []).map((item) => `<tr><td>${date(item.record_date)}</td><td>${number(item.weight_kg, ' kg')}</td><td>${item.source === 'application' ? 'Registrado na aplicação' : 'Registro diário'}</td></tr>`).join('');
    const appRows = (apps.data || []).map((item) => `<tr><td>${date(item.application_date)}</td><td>${text(item.medicine)}</td><td>${number(item.dose_mg, ' mg')}</td><td>${number(item.units, ' UI')}</td></tr>`).join('');
    const effectRows = (effects.data || []).map((item) => `<li><b>${date(item.record_date)}:</b> ${text(item.note)}</li>`).join('') || '<li>Nenhuma anotação registrada.</li>';
    const measurementRows = (measures.data || []).map((item) => `<tr><td>${date(item.record_date)}</td><td>${Object.entries(item).filter(([key, value]) => key.endsWith('_cm') && value != null).map(([key, value]) => `${text(key.replace('_cm', '').replaceAll('_', ' '))}: ${number(value, ' cm')}`).join(' · ')}</td></tr>`).join('');
    report.document.write(`<!doctype html><html lang="pt-BR"><head><title>Relatório pessoal — Dose Certa</title><style>body{font-family:Arial,sans-serif;color:#173f39;margin:32px}h1{color:#087e6b}h2{margin-top:28px;font-size:18px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:8px;border-bottom:1px solid #d8e5e1;text-align:left}li{margin:7px 0}@media print{body{margin:14mm}}</style></head><body><h1>Dose Certa — Relatório pessoal</h1><p>Gerado em ${new Date().toLocaleDateString('pt-BR')}. Material de acompanhamento; não substitui orientação profissional.</p><h2>Evolução do peso</h2><table><thead><tr><th>Data</th><th>Peso</th><th>Origem</th></tr></thead><tbody>${weightRows || '<tr><td colspan="3">Sem registros.</td></tr>'}</tbody></table><h2>Histórico de aplicações</h2><table><thead><tr><th>Data</th><th>Medicamento</th><th>Dose</th><th>Quantidade</th></tr></thead><tbody>${appRows || '<tr><td colspan="4">Sem registros.</td></tr>'}</tbody></table><h2>Medidas corporais</h2><table><tbody>${measurementRows || '<tr><td colspan="2">Sem registros.</td></tr>'}</tbody></table><h2>Efeitos relatados</h2><ul>${effectRows}</ul><script>window.onload=()=>window.print()<\/script></body></html>`);
    report.document.close();
  });
}());
