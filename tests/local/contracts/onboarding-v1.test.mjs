import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../../styles.css', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../../../js/auth.js', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('../../../js/onboarding.js', import.meta.url), 'utf8');
const diary = readFileSync(new URL('../../../js/diary.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../supabase/migrations/20260906_onboarding_v1.sql', import.meta.url), 'utf8');

test('cadastro obrigatório apresenta o texto aprovado e confirma maioridade', () => {
  assert.match(auth, /Crie sua conta gratuita para acompanhar seu progresso e agendar lembretes de acordo com a indicação médica/);
  assert.match(html, /name="adult_confirmation"/);
  assert.match(html, /name="legal_acceptance"/);
});

test('perfil contém opções obrigatórias de gênero, medicamento outro e intervalo de 1 a 30 dias', () => {
  for (const label of ['Mulher (Cis ou Trans)', 'Homem (Cis ou Trans)', 'Não-binário', 'Prefiro não responder', 'Outro']) assert.ok(html.includes(label));
  assert.match(html, /name="medicine" required/);
  assert.match(html, /name="application_interval_days" type="range" min="1" max="30"/);
  assert.match(html, /A cada 7 dias/);
  assert.match(html, /name="state" required/);
  assert.match(html, /<option value="SP">São Paulo<\/option>/);
  assert.match(html, /id="onboarding-cancel"/);
  assert.match(html, /id="onboarding-close"[^>]*aria-label="Fechar personalização de perfil"/);
});

test('lista de medicamentos preserva os dois primeiros e ordena os demais', () => {
  const app = readFileSync(new URL('../../../app.js', import.meta.url), 'utf8');
  const expected = ['Tirzepatida', 'Semaglutida', 'Dulaglutida', 'Exenatida', 'Liraglutida', 'Lixisenatida'];
  let previous = -1;
  expected.forEach((medicine) => {
    const position = app.indexOf(`label: '${medicine}'`);
    assert.ok(position > previous, `${medicine} deve respeitar a ordem aprovada`);
    previous = position;
    assert.match(html, new RegExp(`>${medicine}</option>`));
  });
});

test('seletor principal começa pela prescrição e preserva a grafia de Tirzepatida', () => {
  const app = readFileSync(new URL('../../../app.js', import.meta.url), 'utf8');
  assert.match(app, /label: 'Tirzepatida'/);
  assert.match(app, /placeholder\.textContent = 'Selecione sua prescrição'/);
  assert.match(app, /placeholder\.disabled = true/);
  assert.match(app, /placeholder\.selected = true/);
  assert.ok(app.indexOf("select.appendChild(placeholder)") < app.indexOf('medicines.forEach'));
});

test('perfil, consentimentos e ownership RLS estão presentes na migration', () => {
  assert.match(migration, /create table if not exists public\.onboarding_profiles/);
  assert.match(migration, /create table if not exists public\.user_consents/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /user_id = auth\.uid\(\)/);
});

test('cliente não usa chave administrativa e exclusão exige confirmação', () => {
  assert.doesNotMatch(onboarding, /SERVICE_ROLE|service_role/i);
  assert.match(onboarding, /confirmation\.value\.trim\(\) !== 'EXCLUIR'/);
  assert.match(onboarding, /functions\.invoke\('delete-account'/);
});

test('COR-007 mantém o aceite jurídico como texto inline único ao lado do checkbox', () => {
  assert.match(html, /<label class="consent-choice"><input name="legal_acceptance" type="checkbox" required \/><span class="consent-choice-text">Li e aceito os <a href="terms\.html" target="_blank" rel="noopener">Termos de Uso<\/a> e a <a href="privacy\.html" target="_blank" rel="noopener">Política de Privacidade<\/a>\.<\/span><\/label>/);
  assert.match(html, /name="legal_acceptance" type="checkbox" required/);
  assert.match(styles, /\.consent-choice-text\{min-width:0\}/);
  assert.doesNotMatch(html, /legal_acceptance[\s\S]{0,250}<span>Li e aceito<\/span>/);
});

test('COR-009 alinha País e Estado com a mesma estrutura de campo', () => {
  assert.match(html, /<div class="onboarding-grid onboarding-location-grid"><label class="auth-field">País<input class="auth-input" name="country_code"/);
  assert.match(html, /<label class="auth-field">Estado<select class="auth-input" name="state" required>/);
  assert.match(styles, /\.onboarding-location-grid\{align-items:start\}/);
  assert.match(styles, /\.onboarding-location-grid \.auth-field\{display:grid;grid-template-rows:auto 47px;gap:7px;margin:0;align-content:start\}/);
  assert.match(styles, /\.onboarding-location-grid \.auth-input\{display:block;width:100%;height:47px;box-sizing:border-box\}/);
  assert.match(styles, /\.onboarding-step>\.auth-field\+\.auth-field\{margin-top:13px\}/);
  assert.doesNotMatch(styles, /\.onboarding-step \.auth-field\+\.auth-field\{margin-top:13px\}/);
  assert.match(html, /<div class="onboarding-grid"><label class="auth-field">Peso atual \(kg\)<input/);
  assert.match(html, /<label class="auth-field">Altura \(cm\)<input/);
});

test('a primeira aplicação com peso substitui somente o peso inicial do onboarding', () => {
  assert.match(diary, /async function removeInitialOnboardingWeight\(applicationWeightRecordId\)/);
  assert.match(diary, /select\('id', \{ count: 'exact', head: true \}\)[\s\S]*?\.eq\('user_id', currentUserId\)/);
  assert.match(diary, /if \(applicationsResult\.count !== 1\) return \{ removed: false, error: null \}/);
  assert.match(diary, /select\('initial_weight_record_id'\)[\s\S]*?\.eq\('user_id', currentUserId\)/);
  assert.match(diary, /\.eq\('id', initialWeightRecordId\)[\s\S]*?\.eq\('user_id', currentUserId\)[\s\S]*?\.eq\('source', 'manual'\)[\s\S]*?\.is\('application_id', null\)/);
  assert.match(diary, /update\(\{ initial_weight_record_id: null \}\)/);
  assert.match(diary, /removeInitialOnboardingWeight\(confirmed\.weight_record_id \|\| null\)/);
  assert.match(diary, /removeInitialOnboardingWeight\(synchronizedWeight\?\.id \|\| null\)/);
});

test('atalhos autenticados revelam e navegam para suas próprias áreas', () => {
  const weight = readFileSync(new URL('../../../js/weight.js', import.meta.url), 'utf8');
  const plan = readFileSync(new URL('../../../js/plan.js', import.meta.url), 'utf8');
  assert.match(diary, /function navigateToDiary\(\)[\s\S]*?if \(!currentUser\) return;[\s\S]*?diarySection\.hidden = false;[\s\S]*?diarySection\.scrollIntoView/);
  assert.match(diary, /getElementById\('diary-nav'\)\.addEventListener\('click', navigateToDiary\)/);
  assert.match(weight, /navButton\.addEventListener\('click', \(\) => \{[\s\S]*?if \(!currentUserId\) return;[\s\S]*?section\.hidden = false;[\s\S]*?section\.scrollIntoView/);
  assert.match(plan, /navButton\.addEventListener\('click', \(\) => \{[\s\S]*?if \(!currentUserId\) return;[\s\S]*?section\.hidden = false;[\s\S]*?section\.scrollIntoView/);
  assert.doesNotMatch(plan, /diaryNavButton\.addEventListener/);
});
