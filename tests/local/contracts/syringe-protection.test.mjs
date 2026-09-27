import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cwd = fileURLToPath(new URL('../../..', import.meta.url));
const app = readFileSync(new URL('../../../app.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const headApp = execFileSync('git', ['show', 'HEAD:app.js'], { cwd, encoding: 'utf8' }).replaceAll('\r\n', '\n');

function extract(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  return source.slice(from, to);
}

test('fórmula e arredondamento do simulador permanecem idênticos à versão validada', () => {
  assert.equal(extract(app, 'function calculateDose', 'window.DoseCalculator'), extract(headApp, 'function calculateDose', 'window.DoseCalculator'));
  assert.match(app, /maximumFractionDigits: digits, minimumFractionDigits: 0/);
});

test('a escala está no SVG, recortada pela mesma área útil do líquido', () => {
  assert.match(html, /<clipPath id="barrelClip">\s*<rect x="144" y="45" width="446" height="30"/);
  assert.match(html, /<g id="layer-liquido" clip-path="url\(#barrelClip\)">\s*<rect id="liquid" x="574" y="45" width="0" height="30"/);
  assert.match(html, /<g id="layer-escala" clip-path="url\(#barrelClip\)">\s*<g id="ticks"/);
});

test('estado sem prescrição válida limpa o resultado visual sem tocar na fórmula', () => {
  assert.match(app, /const calculation = medicine \? calculateDose\(/);
  assert.match(app, /function renderZeroResult\(capacity\)/);
  assert.match(app, /renderSyringeResult\(\{ capacity, units: 0, volume: 0, percentage: 0 \}\)/);
  assert.match(app, /\$\('units-value'\)\.textContent = resultNumber\(units, 2\)/);
  assert.match(app, /\$\('ml-value'\)\.textContent = `\$\{resultNumber\(volume, 3\)\} mL`/);
  assert.match(html, /id="units-value">0,00</);
  assert.match(html, /id="ml-value">0,000 mL</);
});

test('identificadores dinâmicos e camadas anatômicas foram preservados', () => {
  for (const id of ['liquid', 'plunger-stop', 'plunger-rod', 'dose-marker', 'marker-arrow', 'ticks']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ['layer-sombra', 'layer-apoio-polegar', 'layer-flange', 'layer-area-interna', 'layer-cilindro-externo', 'layer-bico', 'layer-protetor-laranja']) assert.match(html, new RegExp(`id="${id}"`));
});

test('as coordenadas da escala usam somente o intervalo interno do cilindro', () => {
  assert.match(app, /const syringeStart = 184;/);
  assert.match(app, /const syringeEnd = 574;/);
  assert.match(app, /syringeEnd - \(value \/ capacity\) \* \(syringeEnd - syringeStart\)/);
  assert.match(html, /<rect x="144" y="45" width="446" height="30"/);
});
