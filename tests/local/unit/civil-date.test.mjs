import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

await import('../../../js/date-utils.js');

const projectFile = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const applicationFiles = [
  'js/effects.js',
  'js/onboarding.js',
  'js/diary.js',
  'js/measurements.js',
  'js/plan.js',
  'js/weight.js'
];

test('toCivilDate usa exclusivamente os componentes locais da data', () => {
  const date = {
    getFullYear: () => 2026,
    getMonth: () => 0,
    getDate: () => 9,
    toISOString: () => { throw new Error('toISOString não deve ser chamado'); }
  };
  assert.equal(globalThis.DoseDate.toCivilDate(date), '2026-01-09');
});

test('todayCivil delega para toCivilDate(new Date())', () => {
  const source = projectFile('js/date-utils.js');
  assert.match(source, /function todayCivil\(\)\s*\{\s*return toCivilDate\(new Date\(\)\);\s*\}/u);
});

test('data civil preserva o dia local de São Paulo quando UTC já virou o dia', () => {
  const utilityUrl = new URL('../../../js/date-utils.js', import.meta.url).href;
  const script = `await import(${JSON.stringify(utilityUrl)}); process.stdout.write(globalThis.DoseDate.toCivilDate(new Date('2026-09-08T00:30:00.000Z')));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'America/Sao_Paulo' }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '2026-09-07');
});

test('utilitário cobre viradas de mês, ano e ano bissexto', () => {
  const date = (year, month, day) => ({
    getFullYear: () => year,
    getMonth: () => month - 1,
    getDate: () => day
  });
  assert.equal(globalThis.DoseDate.toCivilDate(date(2026, 2, 1)), '2026-02-01');
  assert.equal(globalThis.DoseDate.toCivilDate(date(2027, 1, 1)), '2027-01-01');
  assert.equal(globalThis.DoseDate.toCivilDate(date(2028, 2, 29)), '2028-02-29');
});

test('todos os módulos de data civil usam DoseDate sem recorte de timestamp UTC', () => {
  for (const file of applicationFiles) {
    const source = projectFile(file);
    assert.match(source, /window\.DoseDate/u, `${file} deve consumir DoseDate`);
    assert.doesNotMatch(source, /toISOString\(\)\.slice\(0,\s*10\)/u, `${file} não deve gerar data civil por UTC`);
  }
});

test('onboarding preserva timestamps ISO e usa data civil no peso inicial', () => {
  const source = projectFile('js/onboarding.js');
  assert.match(source, /completed_at: new Date\(\)\.toISOString\(\)/u);
  assert.match(source, /updated_at: new Date\(\)\.toISOString\(\)/u);
  assert.match(source, /granted_at: now/u);
  assert.match(source, /record_date: todayCivil\(\)/u);
});

test('maioridade usa o aniversário no dia civil local', () => {
  const source = projectFile('js/onboarding.js');
  const match = /const adult = \(value\) => \{([\s\S]*?)\n  \};/u.exec(source);
  assert.ok(match, 'função de validação de maioridade deve existir');
  const createAdult = new Function('todayCivil', `return (value) => {${match[1]}\n};`);
  const beforeBirthday = createAdult(() => '2026-09-07');
  const onBirthday = createAdult(() => '2026-09-08');
  const afterBirthday = createAdult(() => '2026-09-09');
  assert.equal(beforeBirthday('2008-09-08'), false);
  assert.equal(onBirthday('2008-09-08'), true);
  assert.equal(afterBirthday('2008-09-08'), true);
});

test('utilitário é carregado antes dos consumidores e faz parte do build', () => {
  const html = projectFile('index.html');
  const utilityPosition = html.indexOf('src="js/date-utils.js"');
  assert.ok(utilityPosition >= 0, 'index.html deve carregar date-utils.js');
  for (const consumer of applicationFiles) {
    const fileName = consumer.slice(3);
    assert.ok(utilityPosition < html.indexOf(`src="js/${fileName}"`), `${consumer} deve carregar depois do utilitário`);
  }
  assert.match(projectFile('scripts/build.mjs'), /'js\/date-utils\.js'/u);
});
