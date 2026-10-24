import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../../../js/auth.js', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('../../../js/onboarding.js', import.meta.url), 'utf8');
const config = readFileSync(new URL('../../../supabase/config.toml', import.meta.url), 'utf8');
const confirmation = readFileSync(new URL('../../../supabase/templates/confirmation.html', import.meta.url), 'utf8');

test('cadastro único reúne acesso, perfil, objetivo e rotina antes do envio', () => {
  for (const step of ['1', '2', '3', '4']) assert.match(html, new RegExp(`data-signup-step="${step}"`));
  for (const field of ['date_of_birth', 'gender', 'state', 'city', 'weight_kg', 'height_cm', 'journey_goal', 'medicine', 'application_interval_days', 'reminder_time']) {
    assert.match(html, new RegExp(`name="${field}"`));
  }
  assert.match(html, /id="signup-next" type="button">Continuar/);
  assert.match(html, /id="signup-submit" type="submit" hidden/);
  assert.match(html, /name="legal_acceptance" type="checkbox" required/);
  assert.match(html, /name="health_data_consent" type="checkbox" required/);
});

test('cadastro preserva todos os estados brasileiros e valida idade e medidas', () => {
  for (const state of ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']) {
    assert.match(html, new RegExp(`<option value="${state}">`));
  }
  assert.match(auth, /function adult\(value\)/);
  assert.match(auth, /age >= 18 && age <= 120/);
  assert.match(auth, /weight_kg\.value\) > 0/);
  assert.match(auth, /height_cm\.value\) >= 80/);
});

test('dados completos aguardam confirmação de e-mail e não substituem o aceite explícito', () => {
  assert.match(auth, /data: \{ display_name: name, registration_v1: registration \}/);
  assert.match(auth, /emailRedirectTo: `\$\{window\.location\.origin\}\$\{window\.location\.pathname\}`/);
  assert.match(onboarding, /async function materializeConfirmedRegistration\(\)/);
  assert.match(onboarding, /const draft = state\.user\?\.user_metadata\?\.registration_v1/);
  assert.match(onboarding, /onboarding_profiles'\)\.upsert/);
  assert.match(onboarding, /user_consents'\)\.upsert/);
  assert.match(onboarding, /updateUser\(\{ data: \{ registration_v1: null \} \}\)/);
});

test('template de confirmação reforça termos e o limite médico sem substituir consentimento', () => {
  assert.match(config, /\[auth\.email\.template\.confirmation\]/);
  assert.match(config, /content_path = "\.\/supabase\/templates\/confirmation\.html"/);
  assert.match(confirmation, /\{\{ \.ConfirmationURL \}\}/);
  assert.match(confirmation, /https:\/\/emagrecanadosecerta\.com\.br\/terms\.html/);
  assert.match(confirmation, /https:\/\/emagrecanadosecerta\.com\.br\/privacy\.html/);
  assert.match(confirmation, /não substitui a confirmação realizada no cadastro/);
  assert.match(confirmation, /não substitui consulta, diagnóstico, prescrição ou orientação/);
});
