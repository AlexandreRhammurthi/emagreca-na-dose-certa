import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const plan = readFileSync(new URL('../../../js/plan.js', import.meta.url), 'utf8');
const diary = readFileSync(new URL('../../../js/diary.js', import.meta.url), 'utf8');
const calendar = readFileSync(new URL('../../../js/google-calendar.js', import.meta.url), 'utf8');

test('agenda aplicações criadas e reprocessa pendências ao conectar o Google Agenda', () => {
  assert.match(plan, /functions\.invoke\('google-calendar-sync',\s*\{\s*body: \{ occurrence_id: record\.id \}/s);
  assert.match(plan, /dosecerta:google-calendar-connection/);
  assert.match(plan, /record\.google_sync_status !== 'synced'/);
  assert.match(calendar, /dosecerta:google-calendar-connection/);
  assert.match(calendar, /userId, connectionStatus: connection\?\.connection_status \|\| 'disconnected'/);
});

test('retorno OAuth não recarrega o plano enquanto o usuário abre o agendamento', () => {
  assert.match(plan, /let calendarConnectionStatus = 'unknown'/);
  assert.match(plan, /let planDataLoaded = false/);
  assert.match(plan, /if \(calendarConnectionStatus !== 'connected' \|\| !planDataLoaded \|\| pendingCalendarSyncInFlight\)/);
  assert.doesNotMatch(plan, /connectionStatus !== 'connected'\) return;\s*await loadData\(currentUserId\);/s);
  assert.match(plan, /if \(calendarConnectionUserId !== nextUserId\) calendarConnectionStatus = 'unknown'/);
  assert.match(calendar, /if \(userId === currentUserId && \(!oauthReturn\.result \|\| oauthResultProcessed\)\) return;/);
  assert.match(plan, /if \(!formModal\.hidden \|\| !cancelModal\.hidden\) pendingCalendarRefresh = true;/);
});

test('conexão pode ser desconectada sem expor credencial ao navegador', () => {
  const disconnect = readFileSync(new URL('../../../supabase/functions/google-calendar-disconnect/index.ts', import.meta.url), 'utf8');
  assert.match(html, /id="google-calendar-disconnect"/);
  assert.match(calendar, /functions\.invoke\('google-calendar-disconnect', \{ method: 'POST' \}\)/);
  assert.match(disconnect, /delete from private\.google_calendar_credentials/);
  assert.match(disconnect, /connection_status = 'disconnected'/);
  assert.match(disconnect, /google_sync_status = 'not_connected'/);
  assert.doesNotMatch(disconnect, /GOOGLE_CLIENT_SECRET|refresh_token_ciphertext.*select/is);
});

test('alterações e confirmação usam sincronização forçada da ocorrência exata', () => {
  assert.match(plan, /syncOccurrences\(\[result\.data\], \{ force: true \}\)/);
  assert.match(plan, /syncOccurrences\(\[succeeded\], \{ force: true \}\)/);
  assert.match(plan, /syncOccurrences\(\[occurrence\], \{ force: true \}\)/);
  assert.match(diary, /detail:\s*\{\s*occurrenceId,/s);
});

test('aplicações cujo horário passou ficam visíveis para registro retroativo', () => {
  assert.match(html, /id="plan-overdue"/);
  assert.match(html, /Você esqueceu de registrar uma aplicação\?/);
  assert.match(plan, /function isOverdue\(record\)/);
  assert.match(plan, /isOverdue\(record\) \? 'Registrar agora' : 'Confirmar aplicação'/);
  assert.match(plan, /const overdueRecords = \[\.\.\.occurrences\.values\(\)\]\.filter\(isOverdue\)/);
});

test('calendário abre o agendamento pela data e mostra detalhes acionáveis quando houver ocorrência', () => {
  assert.match(html, /id="plan-calendar-details-modal"/);
  assert.match(html, /id="plan-calendar-details-content"/);
  assert.match(plan, /function openCreateForDate\(dateValue, trigger\)/);
  assert.match(plan, /function applyReusablePlanDefaults\(\)/);
  assert.match(plan, /applyReusablePlanDefaults\(\);/);
  assert.match(plan, /function resetSubmitState\(\)/);
  assert.match(plan, /if \(dayRecords\.length\) openCalendarDetails\(dateValue, dayRecords, button\);/);
  assert.match(plan, /else openCreateForDate\(dateValue, button\);/);
  assert.match(plan, /button\.style\.cursor = isActionable \? 'pointer' : 'default';/);
  assert.match(plan, /function openCalendarDetails\(dateValue, records, trigger\)/);
  assert.match(plan, /edit\.textContent = 'Editar'/);
  assert.match(plan, /remove\.textContent = 'Excluir agendamento'/);
  assert.match(plan, /openCancel\(record, remove\)/);
});

test('agendamento aberto pelo calendário recupera a ação e orienta campos obrigatórios', () => {
  assert.match(plan, /requestInFlight = false;/);
  assert.match(plan, /form\.elements\.medicine\.focus\(\);/);
  assert.match(plan, /form\.elements\.dose_mg\.focus\(\);/);
});

console.log('CALENDAR RELIABILITY CONTRACT TESTS: PASS');
