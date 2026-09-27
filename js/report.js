(function initializePersonalReport() {
  'use strict';

  const client = window.supabaseClient;
  const button = document.getElementById('report-export');
  const status = document.getElementById('report-export-status');
  if (!client || !button) return;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  const formatDate = (value) => {
    const [year, month, day] = String(value || '').split('-');
    return year ? escapeHtml(`${day}/${month}/${year}`) : '—';
  };
  const formatNumber = (value, suffix = '') => `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}`;
  const setStatus = (message = '', type = '') => {
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    status.dataset.state = type;
  };
  const closeReport = (report) => {
    try { report?.close(); } catch { /* A janela pode ter sido fechada pelo usuário. */ }
  };

  function buildReportHtml({ apps, weights, measures, effects }) {
    const weightRows = (weights || []).map((item) => `<tr><td>${formatDate(item.record_date)}</td><td>${formatNumber(item.weight_kg, ' kg')}</td><td>${item.source === 'application' ? 'Registrado na aplicação' : 'Registro diário'}</td></tr>`).join('');
    const applicationRows = (apps || []).map((item) => `<tr><td>${formatDate(item.application_date)}</td><td>${escapeHtml(item.medicine)}</td><td>${formatNumber(item.dose_mg, ' mg')}</td><td>${formatNumber(item.units, ' UI')}</td></tr>`).join('');
    const effectRows = (effects || []).map((item) => `<li><b>${formatDate(item.record_date)}:</b> ${escapeHtml(item.note)}</li>`).join('') || '<li>Nenhuma anotação registrada.</li>';
    const measurementRows = (measures || []).map((item) => {
      const values = Object.entries(item)
        .filter(([key, value]) => key.endsWith('_cm') && value != null)
        .map(([key, value]) => `${escapeHtml(key.replace('_cm', '').replaceAll('_', ' '))}: ${formatNumber(value, ' cm')}`)
        .join(' · ');
      return `<tr><td>${formatDate(item.record_date)}</td><td>${values}</td></tr>`;
    }).join('');

    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório pessoal — Dose Certa</title><style>body{font-family:Arial,sans-serif;color:#173f39;margin:32px}h1{color:#087e6b}h2{margin-top:28px;font-size:18px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:8px;border-bottom:1px solid #d8e5e1;text-align:left}li{margin:7px 0}@media print{body{margin:14mm}}</style></head><body><h1>Dose Certa — Relatório pessoal</h1><p>Gerado em ${new Date().toLocaleDateString('pt-BR')}. Material de acompanhamento; não substitui orientação profissional.</p><h2>Evolução do peso</h2><table><thead><tr><th>Data</th><th>Peso</th><th>Origem</th></tr></thead><tbody>${weightRows || '<tr><td colspan="3">Sem registros.</td></tr>'}</tbody></table><h2>Histórico de aplicações</h2><table><thead><tr><th>Data</th><th>Medicamento</th><th>Dose</th><th>Quantidade</th></tr></thead><tbody>${applicationRows || '<tr><td colspan="4">Sem registros.</td></tr>'}</tbody></table><h2>Medidas corporais</h2><table><tbody>${measurementRows || '<tr><td colspan="2">Sem registros.</td></tr>'}</tbody></table><h2>Efeitos relatados</h2><ul>${effectRows}</ul></body></html>`;
  }

  button.addEventListener('click', async () => {
    setStatus();
    let report;
    try { report = window.open('', '_blank'); } catch { report = null; }
    if (!report) {
      const message = 'Permita pop-ups neste navegador e tente novamente para abrir o relatório.';
      setStatus(message, 'error');
      window.showToast?.(message, 'error');
      return;
    }

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    setStatus('Gerando relatório…', 'loading');
    try {
      try { report.opener = null; } catch { /* Não impede a geração do relatório. */ }
      report.document.write('<!doctype html><title>Gerando relatório…</title><p>Gerando relatório pessoal…</p>');
      report.document.close();
      const [apps, weights, measures, effects] = await Promise.all([
        client.from('applications').select('application_date,medicine,dose_mg,units').order('application_date', { ascending: false }),
        client.from('weight_records').select('record_date,weight_kg,source').order('record_date', { ascending: true }),
        client.from('body_measurements').select('*').order('record_date', { ascending: false }),
        client.from('application_effect_notes').select('record_date,note').order('record_date', { ascending: false })
      ]);
      if (apps.error || weights.error || measures.error || effects.error) throw new Error('report_data_unavailable');
      report.document.open();
      report.document.write(buildReportHtml({ apps: apps.data, weights: weights.data, measures: measures.data, effects: effects.data }));
      report.document.close();
      setStatus('Relatório aberto em uma nova janela. Use Imprimir para salvar em PDF.', 'success');
    } catch (error) {
      console.error('Relatório: não foi possível gerar a visualização.', { code: error?.code || 'unknown' });
      closeReport(report);
      const message = 'Não foi possível gerar o relatório agora. Tente novamente.';
      setStatus(message, 'error');
      window.showToast?.(message, 'error');
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });

  window.PersonalReport = Object.freeze({ buildReportHtml, escapeHtml });
}());
