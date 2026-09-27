import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const weight = readFileSync(new URL('../../../js/weight.js', import.meta.url), 'utf8');
const vials = readFileSync(new URL('../../../js/vials.js', import.meta.url), 'utf8');

test('Diário usa o texto aprovado para nova aplicação', () => {
  assert.match(html, /id="diary-simulate" type="button">Registrar nova Aplicação/);
});

test('confirmação de exclusão de peso tem saída por botão, fundo e Esc', () => {
  assert.match(html, /id="weight-delete-modal"[\s\S]*data-weight-delete-close aria-label="Fechar confirmação de exclusão"/);
  assert.match(weight, /event\.key === 'Escape'/);
  assert.match(weight, /let formRequestInFlight = false;/);
  assert.match(weight, /let deleteRequestInFlight = false;/);
  assert.match(weight, /if \(!client \|\| deleteRequestInFlight \|\| !deletingId\) return;/);
  assert.match(weight, /deleteRequestInFlight = true;/);
  assert.match(weight, /deleteRequestInFlight = false;/);
  assert.match(weight, /!userData\?\.user/);
});

test('frascos são carregados com a sessão atual, inclusive em lançamento retroativo', () => {
  assert.match(vials, /async function resolveCurrentUserId/);
  assert.match(vials, /await resolveCurrentUserId\(\)/);
  assert.match(vials, /\.eq\('status', 'active'\)/);
});
