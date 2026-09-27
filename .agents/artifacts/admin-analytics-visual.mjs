import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const root = process.cwd();
const artifacts = join(root, '.agents', 'artifacts', 'screenshots');
const aggregate = {
  period: { days: 30, start: '2026-08-29', end: '2026-09-27', label: 'últimos 30 dias' },
  cohort_size: 34,
  sufficient_data: true,
  metrics: { new_accounts: 34, onboarding_completed: 20, first_product_action: 12, d7_returned: 6, accounts_after_simulation: 10, onboarding_completion_rate: 0.5882, activation_rate: 0.3529, d7_return_rate: 0.3, simulation_to_account_rate: 0.2941 },
  funnel: { account_created: 34, onboarding_completed: 20, first_product_action: 12, product_returned: 15 },
  adoption: { application: 7, weight: 3, plan: 1, google_calendar: 1 },
  insights: [{ title: 'Ativação inicial abaixo do limiar', message: 'Menos de 40% das contas realizaram uma primeira ação de produto.', recommendation: 'Priorizar checklist de primeiros passos no Diário.' }]
};
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer((request, response) => {
  const path = normalize(join(root, request.url === '/' ? 'admin.html' : request.url.split('?')[0]));
  if (!path.startsWith(root) || !existsSync(path)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
  createReadStream(path).pipe(response);
});
await new Promise((resolve) => server.listen(8174, '127.0.0.1', resolve));
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch();
const issues = [];
const supabaseStub = (denied) => `window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signInWithPassword:async()=>({error:null}),signOut:async()=>({error:null})},functions:{invoke:async()=>${denied ? "({data:null,error:{context:{error:'access_denied'}}})" : `({data:${JSON.stringify(aggregate)},error:null})`}}}}};`;
async function open(viewport, denied = false) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (error) => issues.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') issues.push(message.text()); });
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: supabaseStub(denied) }));
  await page.goto('http://127.0.0.1:8174/admin.html', { waitUntil: 'networkidle' });
  return { context, page };
}
async function signIn(page) {
  await page.locator('#admin-email').fill('admin@example.test');
  await page.locator('#admin-password').fill('not-a-real-password');
  await page.locator('button[type="submit"]').click();
}
try {
  let test = await open({ width: 1440, height: 1000 });
  assert.equal(await test.page.locator('#admin-login').isVisible(), true);
  assert.equal(await test.page.locator('#admin-dashboard').isVisible(), false);
  await signIn(test.page);
  await test.page.locator('#admin-dashboard').waitFor({ state: 'visible' });
  assert.match(await test.page.locator('#admin-period').textContent(), /últimos 30 dias/);
  assert.equal(await test.page.locator('.admin-metric').count(), 5);
  assert.equal(await test.page.locator('.admin-funnel-step').count(), 4);
  assert.equal(await test.page.locator('.admin-adoption-row').count(), 4);
  await test.page.screenshot({ path: join(artifacts, 'admin-analytics-desktop.png'), fullPage: true });
  await test.page.locator('#admin-signout').click();
  assert.equal(await test.page.locator('#admin-login').isVisible(), true);
  await test.context.close();

  test = await open({ width: 390, height: 844 });
  await signIn(test.page);
  await test.page.locator('#admin-dashboard').waitFor({ state: 'visible' });
  assert.equal(await test.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await test.page.screenshot({ path: join(artifacts, 'admin-analytics-mobile.png'), fullPage: true });
  await test.context.close();

  test = await open({ width: 390, height: 844 }, true);
  await signIn(test.page);
  await test.page.locator('#admin-login-message').waitFor({ state: 'visible' });
  assert.match(await test.page.locator('#admin-login-message').textContent(), /não possui acesso/i);
  assert.equal(await test.page.locator('#admin-dashboard').isVisible(), false);
  await test.context.close();
  if (issues.length) throw new Error(`Console: ${issues.join(' | ')}`);
  console.log('ADMIN ANALYTICS VISUAL LOCAL: PASS');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
