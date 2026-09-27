import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const baseUrl = 'http://127.0.0.1:8173/';
const outputDir = new URL('./screenshots/', import.meta.url);
mkdirSync(outputDir, { recursive: true });

const consoleErrors = [];
const requestFailures = [];
const browser = await chromium.launch();

async function open(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => consoleErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  return { context, page };
}

async function setCapacity(page, capacity) {
  await page.evaluate((value) => {
    const input = document.querySelector(`input[name="capacity"][value="${value}"]`);
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(capacity));
  await page.waitForTimeout(120);
}

async function zeroState(page, capacity) {
  await setCapacity(page, capacity);
  const state = await page.evaluate(() => ({
    units: document.querySelector('#units-value')?.textContent?.trim(),
    ml: document.querySelector('#ml-value')?.textContent?.trim(),
    capacity: document.querySelector('#capacity-text')?.textContent?.trim(),
    fill: document.querySelector('#capacity-fill')?.style.width,
    liquidWidth: Number(document.querySelector('#liquid')?.getAttribute('width')),
    liquidX: document.querySelector('#liquid')?.getAttribute('x'),
    markerX: document.querySelector('#dose-marker')?.getAttribute('x1'),
    stopperTransform: document.querySelector('#plunger-stop')?.getAttribute('transform'),
    aria: document.querySelector('#syringe')?.getAttribute('aria-label')
  }));
  const stopperX = Number(state.stopperTransform?.match(/translate\(([-\d.]+)/)?.[1]);
  if (state.units !== '0,00' || state.ml !== '0,000 mL' || state.capacity !== `0% da seringa de ${capacity} UI` || state.fill !== '0%' || state.liquidWidth !== 0 || state.markerX !== state.liquidX || stopperX + 18 !== Number(state.liquidX) || !state.aria?.includes('0,00')) {
    throw new Error(`zero_${capacity}_invalid=${JSON.stringify(state)}`);
  }
}

async function prescription(page) {
  await page.evaluate(() => { window.openOnboardingSignupGate = () => {}; });
  await page.locator('#medicine').selectOption('tirzepatida');
  await page.locator('#vial-mg').fill('15');
  await page.locator('#vial-ml').fill('0.5');
  await page.locator('#dose-mg').fill('2.5');
  await page.locator('#dose-mg').dispatchEvent('input');
  await page.waitForTimeout(220);
}

async function validState(page, capacity) {
  await setCapacity(page, capacity);
  const state = await page.evaluate(() => ({
    units: document.querySelector('#units-value')?.textContent?.trim(),
    ml: document.querySelector('#ml-value')?.textContent?.trim(),
    fill: Number.parseFloat(document.querySelector('#capacity-fill')?.style.width),
    liquidWidth: Number(document.querySelector('#liquid')?.getAttribute('width')),
    liquidX: Number(document.querySelector('#liquid')?.getAttribute('x')),
    markerX: Number(document.querySelector('#dose-marker')?.getAttribute('x1')),
    stopperTransform: document.querySelector('#plunger-stop')?.getAttribute('transform')
  }));
  const stopperX = Number(state.stopperTransform?.match(/translate\(([-\d.]+)/)?.[1]);
  if (state.units !== '8,33' || state.ml !== '0,083 mL' || Math.abs(state.fill - (8.333333 / capacity * 100)) > .03 || state.liquidWidth <= 0 || Math.abs(state.liquidX - state.markerX) > .02 || Math.abs(state.liquidX - (stopperX + 18)) > .02) {
    throw new Error(`valid_${capacity}_invalid=${JSON.stringify(state)}`);
  }
}

const desktop = await open({ width: 1366, height: 900 });
await zeroState(desktop.page, 50);
await desktop.page.locator('.result-panel').screenshot({ path: fileURLToPath(new URL('pilot001-desktop-zero.png', outputDir)) });
await prescription(desktop.page);
for (const capacity of [30, 50, 100]) await validState(desktop.page, capacity);
await desktop.page.locator('.result-panel').screenshot({ path: fileURLToPath(new URL('pilot001-desktop-valid.png', outputDir)) });
await desktop.context.close();

const mobile = await open({ width: 390, height: 844 });
await zeroState(mobile.page, 50);
await mobile.page.locator('.result-panel').screenshot({ path: fileURLToPath(new URL('pilot001-mobile-zero.png', outputDir)) });
await prescription(mobile.page);
await validState(mobile.page, 50);
await mobile.page.locator('.result-panel').screenshot({ path: fileURLToPath(new URL('pilot001-mobile-valid.png', outputDir)) });
await mobile.context.close();

await browser.close();
const relevantConsole = consoleErrors.filter(value => !value.includes('ERR_NETWORK_ACCESS_DENIED'));
const relevantNetwork = requestFailures.filter(value => !value.includes('cdn.jsdelivr.net') && !value.includes('fonts.googleapis.com'));
if (relevantConsole.length || relevantNetwork.length) throw new Error(`console=${JSON.stringify(relevantConsole)} network=${JSON.stringify(relevantNetwork)}`);
console.log('PILOT-001 FINAL VISUAL: PASS');
