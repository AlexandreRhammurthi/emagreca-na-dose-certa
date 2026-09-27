import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../../js/effects.js', import.meta.url), 'utf8');
test('anotações de efeitos permitem registro, edição e exclusão', () => {
  assert.match(html, /id="effects-register"/); assert.match(source, /application_effect_notes/); assert.match(source, /\.update\(payload\)/); assert.match(source, /\.delete\(\)/);
});
