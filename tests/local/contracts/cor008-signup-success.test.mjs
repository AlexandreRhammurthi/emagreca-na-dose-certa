import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../../../js/auth.js', import.meta.url), 'utf8');

test('COR-008 mostra confirmação acessível depois de criação bem-sucedida', () => {
  assert.match(html, /data-auth-view="signup-success" role="status" aria-live="polite"/);
  assert.match(html, /<h2 tabindex="-1">Cadastro realizado com sucesso<\/h2>/);
  assert.match(html, /Verifique seu e-mail para confirmar sua conta\./);
  assert.match(html, /id="signup-success-ok" type="button">OK<\/button>/);
  assert.match(auth, /form\.reset\(\);\s+if \(data\.session\) document\.dispatchEvent[\s\S]*showSignupSuccess\(\);/);
  assert.match(auth, /function showSignupSuccess\(\)[\s\S]*showView\('signup-success'\)/);
  assert.match(auth, /\(signupSuccessActive \? title : modal\.querySelector/);
});

test('COR-008 não redireciona antes de OK e mantém erros no formulário', () => {
  assert.match(auth, /if \(error\) \{\s+setMessage\('signup-message', friendlyError/);
  assert.match(auth, /async function finishSignupSuccess\(\)/);
  assert.match(auth, /signup-success-ok'\)\.addEventListener\('click', finishSignupSuccess/);
  assert.match(auth, /try \{ await client\?\.auth\.signOut\(\); \} catch/);
  assert.match(auth, /window\.location\.assign\(window\.location\.pathname\)/);
  assert.doesNotMatch(auth, /showSignupSuccess\(\);[\s\S]{0,260}window\.location\.assign/);
});

test('modal de cadastro pode ser fechado antes de uma solicitação ser enviada', () => {
  assert.match(auth, /function closeModal\(\) \{\s*if \(activeRequest \|\| recoveryMode \|\| signupSuccessActive\) return;\s*signupGateActive = false;/);
  assert.doesNotMatch(auth, /activeRequest \|\| recoveryMode \|\| signupGateActive \|\| signupSuccessActive/);
});

test('COR-008 preserva validações e o consentimento corrigido no COR-007', () => {
  assert.match(auth, /validate\(form\.elements\.legal_acceptance, legalAcceptance\)/);
  assert.match(auth, /validate\(form\.elements\.adult_confirmation, adultConfirmation\)/);
  assert.match(html, /name="legal_acceptance" type="checkbox" required \/><span class="consent-choice-text">Li e aceito os/);
  assert.match(html, />Termos de Uso<\/a> e a <a href="privacy\.html"/);
});
