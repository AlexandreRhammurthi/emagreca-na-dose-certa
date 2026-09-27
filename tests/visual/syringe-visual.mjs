import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const outputDir = new URL('./artifacts/', import.meta.url);
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch();
const errors = [];

async function openPage(viewport, reducedMotion = true) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:8173/', { waitUntil: 'networkidle' });
  return { context, page };
}

async function setUnits(page, capacity, units) {
  await page.locator(`input[name="capacity"][value="${capacity}"]`).check();
  await page.locator('#vial-mg').fill('15');
  await page.locator('#vial-ml').fill('0.5');
  const dose = units === 0 ? '0' : String((units * 0.3).toFixed(6));
  await page.locator('#dose-mg').evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, dose);
  await page.waitForTimeout(1200);
}

async function setDose(page, units) {
  await page.locator('#dose-mg').evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, String((units * 0.3).toFixed(6)));
}

async function assertGeometry(page, capacity, units) {
  const state = await page.locator('#syringe').evaluate((svg, expected) => {
    const inner = svg.querySelector('#barrel-inner');
    const clip = svg.querySelector('#syringe-inner-clip rect');
    const ticks = [...svg.querySelector('#ticks').children];
    const marker = svg.querySelector('#dose-marker');
    const liquid = svg.querySelector('#liquid');
    const stop = svg.querySelector('#plunger-stop');
    const number = (element, name) => Number(element.getAttribute(name));
    const bounds = { x: number(inner, 'x'), y: number(inner, 'y'), width: number(inner, 'width'), height: number(inner, 'height') };
    const within = (box) => box.x >= bounds.x - .01 && box.y >= bounds.y - .01 && box.x + box.width <= bounds.x + bounds.width + .01 && box.y + box.height <= bounds.y + bounds.height + .01;
    return {
      sameClip: number(clip, 'x') === bounds.x && number(clip, 'y') === bounds.y && number(clip, 'width') === bounds.width && number(clip, 'height') === bounds.height,
      invalidTicks: ticks.map((item) => {
        const box = item.getBBox();
        return { tag: item.tagName, text: item.textContent, box: { x: box.x, y: box.y, width: box.width, height: box.height } };
      }).filter((item) => !within(item.box)),
      labels: ticks.filter((item) => item.tagName === 'text').map((item) => item.textContent),
      liquidX: number(liquid, 'x'),
      liquidWidth: number(liquid, 'width'),
      stopX: number(stop, 'x'),
      stopWidth: number(stop, 'width'),
      markerX: number(marker, 'x1'),
      markerX2: number(marker, 'x2'),
      doseValue: svg.ownerDocument.querySelector('#dose-mg').value,
      errorHidden: svg.ownerDocument.querySelector('#form-error').hidden,
      displayedUnits: svg.ownerDocument.querySelector('#units-value').textContent,
      displayedMl: svg.ownerDocument.querySelector('#ml-value').textContent,
      start: 190,
      end: 554
    };
  }, { capacity, units });

  const expectedMarker = state.end - (units / capacity) * (state.end - state.start);
  if (!state.sameClip || state.invalidTicks.length) throw new Error(`Escala fora do cilindro em ${capacity} UI / ${units} UI: ${JSON.stringify(state)}`);
  if (Math.abs(state.markerX - expectedMarker) > .02 || state.markerX !== state.markerX2) throw new Error(`Marcador desalinhado em ${capacity} UI / ${units} UI`);
  if (Math.abs(state.stopX + state.stopWidth - state.liquidX) > .02 || Math.abs(state.liquidX - state.markerX) > .02) throw new Error(`Líquido, vedação e marcador divergentes em ${capacity} UI / ${units} UI`);
  if (units === 0 && (state.errorHidden || state.displayedUnits !== '0' || state.displayedMl !== '0 mL')) throw new Error('Estado de 0 UI não foi apresentado de forma segura');
  const expectedLabels = capacity === 100 ? ['10', '20', '30', '40', '50', '60', '70', '80', '90', '100'] : Array.from({ length: capacity / 5 }, (_, index) => String((index + 1) * 5));
  if (state.labels.join(',') !== expectedLabels.join(',')) throw new Error(`Números incorretos em ${capacity} UI: ${state.labels.join(',')}`);
}

const desktop = await openPage({ width: 1366, height: 900 });
for (const scenario of [
  { name: '0-ui-validacao', capacity: 50, units: 0 },
  { name: '8-33-ui', capacity: 50, units: 8.333333 },
  { name: 'capacidade-maxima', capacity: 50, units: 50 },
  { name: '30-ui', capacity: 30, units: 25 },
  { name: '100-ui', capacity: 100, units: 100 }
]) {
  await setUnits(desktop.page, scenario.capacity, scenario.units);
  await assertGeometry(desktop.page, scenario.capacity, scenario.units);
  await desktop.page.locator('.result-panel').screenshot({ path: fileURLToPath(new URL(`./${scenario.name}.png`, outputDir)) });
}
await desktop.context.close();

const mobile = await openPage({ width: 390, height: 844 });
await setUnits(mobile.page, 50, 8.333333);
await assertGeometry(mobile.page, 50, 8.333333);
await mobile.page.locator('.result-panel').screenshot({ path: fileURLToPath(new URL('./mobile-8-33-ui.png', outputDir)) });
await mobile.context.close();

const animated = await openPage({ width: 1366, height: 900 }, false);
await setUnits(animated.page, 50, 5);
const startX = await animated.page.locator('#dose-marker').getAttribute('x1');
await setDose(animated.page, 25);
await animated.page.waitForTimeout(80);
const intermediateX = await animated.page.locator('#dose-marker').getAttribute('x1');
await animated.page.waitForTimeout(300);
const finalX = await animated.page.locator('#dose-marker').getAttribute('x1');
if (!(Number(finalX) < Number(intermediateX) && Number(intermediateX) < Number(startX))) throw new Error('Animação da dose não teve transição suave e monotônica');
await animated.context.close();
await browser.close();

if (errors.length) throw new Error(`Erros no console: ${errors.join(' | ')}`);
console.log('SERINGA VISUAL: PASS');
