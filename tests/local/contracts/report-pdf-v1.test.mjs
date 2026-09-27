import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const reportSource = readFileSync(new URL('../../../js/report.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../supabase/migrations/20260907000400_application_effect_notes_v1.sql', import.meta.url), 'utf8');

function initializeReport({ openReport, responses }) {
  let clickHandler;
  const button = {
    disabled: false,
    attributes: new Map(),
    addEventListener(type, handler) {
      if (type === 'click') clickHandler = handler;
    },
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  };
  const status = { hidden: true, textContent: '', dataset: {} };
  const toQuery = (table) => ({
    select() {
      return {
        order() { return Promise.resolve(responses[table]); },
      };
    },
  });
  const window = {
    supabaseClient: { from: toQuery },
    open: openReport,
    showToast(message) { window.toast = message; },
  };
  const document = {
    getElementById(id) {
      return id === 'report-export' ? button : id === 'report-export-status' ? status : null;
    },
  };

  vm.runInNewContext(reportSource, { window, document, console, Promise, String, Number, Date, Object });
  return { button, status, window, click: () => clickHandler({ preventDefault() {} }) };
}

test('relatório lida com sucesso, pop-up bloqueado e erro sem prender o botão', async () => {
  assert.match(html, /id="report-export"/);
  assert.match(html, /id="report-export-status"/);
  for (const table of ['applications', 'weight_records', 'body_measurements', 'application_effect_notes']) {
    assert.ok(reportSource.includes(`from('${table}')`));
  }
  assert.match(migration, /enable row level security/);

  const safeResponses = {
    applications: { data: [{ application_date: '2026-09-09', medicine: '<img src=x>&"\'', dose_mg: 2.5, units: 8.33 }], error: null },
    weight_records: { data: [{ record_date: '2026-09-09', weight_kg: 80, source: 'manual' }], error: null },
    body_measurements: { data: [], error: null },
    application_effect_notes: { data: [{ record_date: '2026-09-09', note: '<script>alert("x")</script>&"\'' }], error: null },
  };
  const printed = [];
  const successfulReport = {
    document: { open() {}, write(value) { printed.push(value); }, close() {} },
    close() { this.closed = true; },
  };
  const success = initializeReport({ openReport: () => successfulReport, responses: safeResponses });
  await success.click();
  assert.equal(success.button.disabled, false);
  assert.equal(success.status.dataset.state, 'success');
  assert.match(printed.at(-1), /Histórico de aplicações/);
  assert.match(printed.at(-1), /Evolução do peso/);
  assert.match(printed.at(-1), /Medidas corporais/);
  assert.match(printed.at(-1), /Efeitos relatados/);
  assert.match(printed.at(-1), /<title>Relatório pessoal — Dose Certa<\/title>/);
  assert.match(printed.at(-1), /Gerado em/);
  assert.match(printed.at(-1), /&lt;img src=x&gt;&amp;&quot;&#039;/);
  assert.match(printed.at(-1), /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;&amp;&quot;&#039;/);
  assert.doesNotMatch(printed.at(-1), /<img src=x>/);
  assert.doesNotMatch(printed.at(-1), /<script>alert/);
  assert.doesNotMatch(reportSource, /service_role|SUPABASE_SECRET|refresh_token/i);

  const blocked = initializeReport({ openReport: () => null, responses: safeResponses });
  await blocked.click();
  assert.equal(blocked.button.disabled, false);
  assert.equal(blocked.status.dataset.state, 'error');
  assert.match(blocked.window.toast, /pop-up/i);

  const failedReport = { document: { open() {}, write() {}, close() {} }, close() { this.closed = true; } };
  const failure = initializeReport({
    openReport: () => failedReport,
    responses: { ...safeResponses, applications: { data: null, error: { code: '42501' } } },
  });
  await failure.click();
  assert.equal(failure.button.disabled, false);
  assert.equal(failure.status.dataset.state, 'error');
  assert.equal(failedReport.closed, true);
  assert.match(failure.window.toast, /Não foi possível gerar/i);
});
