import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../../../admin.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../../js/admin-analytics.js', import.meta.url), 'utf8');
const edgeFunction = readFileSync(new URL('../../../supabase/functions/admin-product-analytics/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../supabase/migrations/20260927000000_product_events_retention_v1.sql', import.meta.url), 'utf8');

test('admin page é separada, acessível e não contém credencial administrativa', () => {
  assert.match(page, /id="admin-login-form"/);
  assert.match(page, /id="admin-dashboard"/);
  assert.match(page, /role="status" aria-live="polite"/);
  assert.match(page, /id="admin-signout"/);
  assert.match(page, /id="admin-census-gender"/);
  assert.match(page, /id="admin-census-age"/);
  assert.match(page, /id="admin-census-city"/);
  assert.match(page, /id="admin-growth-chart"/);
  assert.doesNotMatch(page, /arbandeira@gmail\.com|ADMIN_ANALYTICS_ALLOWED_EMAIL|service_role|sb_secret_/i);
});

test('cliente usa autenticação normal e Edge Function, sem dados individuais', () => {
  assert.match(client, /signInWithPassword/);
  assert.match(client, /functions\.invoke\('admin-product-analytics'/);
  assert.match(client, /auth\.signOut/);
  assert.doesNotMatch(client, /user_id|user\.email|ADMIN_ANALYTICS_ALLOWED_EMAIL|service_role|sb_secret_/i);
});

test('Edge Function protege acesso no servidor e retorna somente agregados', () => {
  assert.match(edgeFunction, /required\('ADMIN_ANALYTICS_ALLOWED_EMAIL'\)/);
  assert.match(edgeFunction, /authData\.user\.email/);
  assert.match(edgeFunction, /access_denied/);
  assert.match(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edgeFunction, /select\('user_id,event_name,action_kind,simulated_in_session,event_day'\)/);
  assert.match(edgeFunction, /period: \{ days: RETENTION_DAYS/);
  assert.match(edgeFunction, /metrics,/);
  assert.match(edgeFunction, /funnel:/);
  assert.match(edgeFunction, /adoption,/);
  assert.match(edgeFunction, /\.from\('profiles'\)/);
  assert.match(edgeFunction, /select\('id,created_at'\)/);
  assert.match(edgeFunction, /new_accounts: accounts\.length/);
  assert.match(edgeFunction, /total_registered_users: census\.total_registered_users/);
  assert.match(edgeFunction, /minimum_group_size: CENSUS_MIN_GROUP_SIZE/);
  assert.match(edgeFunction, /select\('date_of_birth,gender,city,state'\)/);
  assert.match(edgeFunction, /count >= CENSUS_MIN_GROUP_SIZE/);
  assert.match(edgeFunction, /cities: aggregateCensus/);
  assert.match(edgeFunction, /function registrationGrowth\(profiles: RegistrationProfile\[\], endDay: string\)/);
  assert.match(edgeFunction, /registration_growth: growth/);
  assert.match(edgeFunction, /const accountUsers = new Set\(accounts\.map/);
  assert.match(edgeFunction, /d7Eligible\.map\(\(account\) => account\.id\)/);
  assert.match(edgeFunction, /account_cohort_available: accountUsers\.size > 0/);
  assert.doesNotMatch(edgeFunction, /cohortEvents\(/);
  assert.doesNotMatch(edgeFunction, /return response\([^\n]*user_id|return response\([^\n]*email/i);
});

test('cliente renderiza somente os agrupamentos demográficos agregados', () => {
  assert.match(client, /function renderCensus\(census\)/);
  assert.match(client, /renderCensusRows\('admin-census-gender', census\.gender\)/);
  assert.match(client, /renderCensusRows\('admin-census-age', census\.age_bands\)/);
  assert.match(client, /renderCensusRows\('admin-census-city', census\.cities\)/);
  assert.match(client, /metrics\.total_registered_users/);
  assert.match(client, /function renderGrowth\(growth\)/);
  assert.match(client, /renderGrowth\(data\.registration_growth\)/);
  assert.doesNotMatch(client, /date_of_birth|gender_other|city.*state.*user_id/i);
});

test('painel não apresenta taxa de coorte inexistente como zero por cento', () => {
  assert.match(client, /Indisponível sem coorte de novas contas/);
  assert.match(client, /Indisponível sem telemetria de simulação/);
  assert.match(client, /accountCohortAvailable/);
  assert.match(client, /value !== null/);
});

test('Edge Function usa somente os quatro eventos aprovados e CORS conhecido', () => {
  assert.match(edgeFunction, /account_created.*onboarding_completed.*first_product_action.*product_returned/s);
  assert.doesNotMatch(edgeFunction, /simulator_completed|diary_opened|weight_recorded|report_exported|body_measurements_recorded/);
  assert.match(edgeFunction, /ALLOWED_ORIGINS/);
  assert.match(edgeFunction, /request\.method === 'OPTIONS'/);
  assert.match(edgeFunction, /Access-Control-Allow-Methods.*POST, OPTIONS/);
});

test('retenção é de 30 dias, reversível e não altera RLS existente', () => {
  assert.match(migration, /interval '30 days'/);
  assert.match(migration, /product-events-retention-daily/);
  assert.match(migration, /cron\.unschedule/);
  assert.match(migration, /if exists \(select 1 from pg_extension where extname = 'pg_cron'\)/);
  assert.doesNotMatch(migration, /enable row level security|create policy|alter table.*row level security/i);
});
