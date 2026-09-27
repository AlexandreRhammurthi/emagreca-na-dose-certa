import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const consoleErrors = [];
const requestFailures = [];

async function pageFor(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => consoleErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
  await page.goto('http://127.0.0.1:8173/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(450);
  return { context, page };
}

async function choosePrescription(page) {
  await page.locator('#medicine').selectOption('tirzepatida');
  await page.locator('#vial-mg').fill('15');
  await page.locator('#vial-ml').fill('0.5');
  await page.locator('#dose-mg').fill('2.5');
  await page.locator('#dose-mg').dispatchEvent('input');
  await page.waitForTimeout(150);
}

async function selectCapacityForGeometry(page, capacity) {
  await page.evaluate((value) => {
    const input = document.querySelector(`input[name="capacity"][value="${value}"]`);
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(capacity));
  await page.waitForTimeout(100);
}

async function assertZero(page, capacity) {
  await selectCapacityForGeometry(page, capacity);
  const state = await page.evaluate(() => ({
    units: document.querySelector('#units-value').textContent.trim(),
    ml: document.querySelector('#ml-value').textContent.trim(),
    capacity: document.querySelector('#capacity-text').textContent.trim(),
    fill: document.querySelector('#capacity-fill').style.width,
    liquidWidth: document.querySelector('#liquid').getAttribute('width'),
    markerX: document.querySelector('#dose-marker').getAttribute('x1'),
    liquidX: document.querySelector('#liquid').getAttribute('x'),
    aria: document.querySelector('#syringe').getAttribute('aria-label')
  }));
  if (state.units !== '0,00' || state.ml !== '0,000 mL' || state.capacity !== `0% da seringa de ${capacity} UI` || state.fill !== '0%' || Number(state.liquidWidth) !== 0 || state.markerX !== state.liquidX || !state.aria.includes('0,00')) {
    throw new Error(`Estado zero invalido em ${capacity} UI: ${JSON.stringify(state)}`);
  }
}

const desktop = await pageFor({ width: 1366, height: 900 });
await assertZero(desktop.page, 50);
// A prescrição válida dispara o cadastro obrigatório para visitantes. Para isolar
// a geometria do simulador, o gate alheio ao escopo é neutralizado somente nesta
// página de teste; o estado inicial acima foi validado com o fluxo real intacto.
await desktop.page.evaluate(() => { window.openOnboardingSignupGate = () => {}; });
await choosePrescription(desktop.page);
const valid = await desktop.page.evaluate(() => ({
  units: document.querySelector('#units-value').textContent.trim(),
  ml: document.querySelector('#ml-value').textContent.trim(),
  fill: document.querySelector('#capacity-fill').style.width,
  hasLiquid: Number(document.querySelector('#liquid').getAttribute('width')) > 0,
  marker: document.querySelector('#dose-marker').getAttribute('x1'),
  liquid: document.querySelector('#liquid').getAttribute('x')
}));
if (valid.units !== '8,33' || valid.ml !== '0,083 mL' || Math.abs(parseFloat(valid.fill) - 16.6667) > .001 || !valid.hasLiquid || valid.marker !== valid.liquid) throw new Error(`Prescricao valida incorreta: ${JSON.stringify(valid)}`);
for (const capacity of [30, 50, 100]) {
  await selectCapacityForGeometry(desktop.page, capacity);
  const value = await desktop.page.locator('#units-value').textContent();
  if (value.trim() !== '8,33') throw new Error(`Dose valida se alterou em ${capacity} UI: ${value}`);
}
await desktop.context.close();

const mobile = await pageFor({ width: 390, height: 844 });
await assertZero(mobile.page, 50);
await mobile.page.evaluate(() => { window.openOnboardingSignupGate = () => {}; });
await choosePrescription(mobile.page);
await mobile.context.close();

await browser.close();
const relevantConsoleErrors = consoleErrors.filter(message => !message.includes('net::ERR_NETWORK_ACCESS_DENIED'));
const relevantRequestFailures = requestFailures.filter(item => !item.includes('cdn.jsdelivr.net') && !item.includes('fonts.googleapis.com'));
if (relevantConsoleErrors.length || relevantRequestFailures.length) throw new Error(`Console=${JSON.stringify(relevantConsoleErrors)} Rede=${JSON.stringify(relevantRequestFailures)}`);
console.log('PILOT-001 VISUAL: PASS');
