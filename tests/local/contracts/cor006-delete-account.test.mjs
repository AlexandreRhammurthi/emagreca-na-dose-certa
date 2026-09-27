import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const edge = readFileSync(new URL('../../../supabase/functions/delete-account/index.ts', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('../../../js/onboarding.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const config = readFileSync(new URL('../../../supabase/config.toml', import.meta.url), 'utf8');

test('COR-006 trata preflight com allowlist e não libera origens arbitrárias', () => {
  assert.match(edge, /const ALLOWED_ORIGINS = new Set/);
  assert.match(edge, /https:\/\/emagrecanadosecerta\.com\.br/);
  assert.match(edge, /https:\/\/emagreca-na-dose-certa\.arbandeira\.workers\.dev/);
  assert.match(edge, /if \(origin && !ALLOWED_ORIGINS\.has\(origin\)\) return response\(\{ error: 'origin_not_allowed' \}, 403, origin\)/);
  assert.match(edge, /if \(request\.method === 'OPTIONS'\) return new Response\(null, \{ status: 204, headers: corsHeaders\(origin\) \}\)/);
  assert.match(edge, /'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info'/);
  assert.match(edge, /'Access-Control-Allow-Methods': 'POST, OPTIONS'/);
  assert.match(edge, /Vary: 'Origin'/);
  assert.doesNotMatch(edge, /Access-Control-Allow-Origin['"]?\s*[:=]\s*['"]\*/);
});

test('COR-006 aplica CORS a POST, erros e sucesso', () => {
  assert.match(edge, /if \(request\.method !== 'POST'\) return response\(\{ error: 'method_not_allowed' \}, 405, origin\)/);
  assert.match(edge, /return response\(\{ error: 'unauthorized' \}, 401, origin\)/);
  assert.match(edge, /const payload = await request\.json\(\)\.catch\(\(\) => null\)/);
  assert.match(edge, /return response\(\{ error: 'reauthentication_required' \}, 400, origin\)/);
  assert.match(edge, /return response\(\{ error: 'reauthentication_failed' \}, 403, origin\)/);
  assert.match(edge, /return response\(\{ error: 'deletion_failed' \}, 500, origin\)/);
  assert.match(edge, /status: 204, headers: \{ \.\.\.corsHeaders\(origin\), 'Cache-Control': 'no-store' \}/);
});

test('COR-006 preserva JWT, reautenticação e a administração somente no servidor', () => {
  assert.match(config, /\[functions\.delete-account\]\s+verify_jwt\s*=\s*true/);
  assert.match(edge, /client\.auth\.getUser\(authorization\.slice\(7\)\)/);
  assert.match(edge, /auth\/v1\/token\?grant_type=password/);
  assert.match(edge, /reauth\?\.user\?\.id !== data\.user\.id/);
  assert.match(edge, /admin\.auth\.admin\.deleteUser\(data\.user\.id, false\)/);
  assert.doesNotMatch(onboarding, /SERVICE_ROLE|service_role|SUPABASE_SERVICE_ROLE_KEY/i);
});

test('COR-006 valida a confirmação local antes de invocar a Edge Function', () => {
  assert.match(onboarding, /confirmation\.value\.trim\(\) !== 'EXCLUIR' \|\| !password\.value/);
  assert.match(onboarding, /Informe sua senha e digite EXCLUIR para confirmar\./);
  assert.match(onboarding, /functions\.invoke\('delete-account', \{ body: \{ password: password\.value \} \}\)/);
});

test('COR-006 informa progresso, bloqueia duplo envio e recupera controles após falha', () => {
  assert.match(onboarding, /if \(accountDeletionInFlight\) return/);
  assert.match(onboarding, /accountDeletionInFlight = true/);
  assert.match(onboarding, /Excluindo sua conta e seus dados\.\.\./);
  assert.match(onboarding, /submitButton\.textContent = 'Excluindo\.\.\.'/);
  assert.match(onboarding, /control\.disabled = true/);
  assert.match(onboarding, /try \{/);
  assert.match(onboarding, /catch \{/);
  assert.match(onboarding, /finally \{/);
  assert.match(onboarding, /accountDeletionInFlight = false/);
  assert.match(onboarding, /control\.disabled = false/);
});

test('COR-006 apresenta mensagens sanitizadas de senha, rede e backend', () => {
  assert.match(onboarding, /Senha incorreta\. Verifique e tente novamente\./);
  assert.match(onboarding, /Não foi possível concluir a exclusão\. Verifique sua conexão e tente novamente\./);
  assert.match(onboarding, /Não foi possível excluir sua conta neste momento\. Tente novamente\./);
  assert.match(html, /id="account-delete-message" role="status" aria-live="polite"/);
  assert.doesNotMatch(onboarding, /console\.log\([^\n]*(password|token|secret)/i);
});

test('COR-006 mantém o sucesso no modal até o usuário confirmar OK', () => {
  assert.match(onboarding, /function showAccountDeletionSuccess\(\)/);
  assert.match(onboarding, /document\.getElementById\('account-delete-title'\)\.textContent = 'Conta excluída com sucesso'/);
  assert.match(html, /Sua conta e seus dados foram excluídos permanentemente\./);
  assert.match(html, /id="account-delete-success-ok" type="button">OK<\/button>/);
  assert.match(onboarding, /deletion\.hidden = true; success\.hidden = false/);
  assert.match(onboarding, /document\.getElementById\('account-delete-success-ok'\)\.focus\(\)/);
  assert.doesNotMatch(onboarding, /showAccountDeletionSuccess\(\);[\s\S]{0,240}window\.location\.assign/);
});

test('COR-006 redireciona somente após OK e logout inválido não bloqueia a finalização', () => {
  assert.match(onboarding, /async function finishAccountDeletion\(\)/);
  assert.match(onboarding, /try \{ await client\.auth\.signOut\(\); \} catch/);
  assert.match(onboarding, /window\.location\.assign\(window\.location\.pathname\)/);
  assert.match(onboarding, /account-delete-success-ok'\)\.addEventListener\('click', finishAccountDeletion/);
  assert.match(onboarding, /if \(!success\.hidden \|\| accountDeletionInFlight\) return/);
});
