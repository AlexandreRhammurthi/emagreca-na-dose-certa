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

console.log('CALENDAR RELIABILITY CONTRACT TESTS: PASS');
