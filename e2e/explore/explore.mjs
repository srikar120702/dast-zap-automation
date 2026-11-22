// Discovery crawl of Juice Shop: for each route, record the API calls it triggers and the
// form controls / buttons available, so we can design module-tagged Playwright tests.
// Run: node explore/explore.mjs   (direct to http://localhost:3000, not through ZAP)
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.JS_BASE ?? 'http://localhost:3000';
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
let calls = new Set();
page.on('request', r => {
  const u = new URL(r.url());
  if (u.origin === BASE && /^\/(rest|api|b2b|file-upload|profile|ftp|snippets|redirect|video|metrics|socket\.io)/.test(u.pathname)
      && !u.pathname.startsWith('/socket.io'))
    calls.add(`${r.method()} ${u.pathname.replace(/\/\d+(?=\/|$)/g, '/{id}')}`);
});

async function controls() {
  return page.evaluate(() => {
    const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const ids = [...document.querySelectorAll('input[id],textarea[id],mat-select[id],button[id],mat-slider[id]')]
      .filter(vis).map(e => `#${e.id}`);
    const buttons = [...document.querySelectorAll('button[aria-label]')].filter(vis)
      .map(b => b.getAttribute('aria-label')).filter((v, i, a) => a.indexOf(v) === i).slice(0, 15);
    return { ids: [...new Set(ids)], buttons };
  });
}

async function visit(route, label = route) {
  calls = new Set();
  await page.goto(BASE + '/#' + route);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
  const c = await controls();
  out.push({ route: label, title: await page.title(), api: [...calls].sort(), ...c });
}

const out = [];
await page.goto(BASE);
await page.getByRole('button', { name: 'Close Welcome Banner' }).click().catch(() => {});
await page.getByRole('button', { name: 'dismiss cookie message' }).click().catch(() => {});

// Side-nav links (unauthenticated)
await page.getByRole('button', { name: 'Open Sidenav' }).click().catch(() => {});
const navLinks = await page.$$eval('mat-sidenav a[href*="#/"], mat-sidenav a[routerlink]', as =>
  as.map(a => (a.getAttribute('href') || a.getAttribute('routerlink'))).filter(Boolean));
await page.reload(); await page.waitForLoadState('networkidle').catch(() => {});   // close the sidenav (it makes the page inert)

const publicRoutes = ['/', '/search?q=apple', '/login', '/register', '/forgot-password', '/contact',
  '/about', '/photo-wall', '/score-board', '/chatbot', '/track-result?id=1'];
for (const r of publicRoutes) await visit(r);

// Log in via UI
calls = new Set();
await page.goto(BASE + '/#/login');
await page.screenshot({ path: 'explore/before-login.png' });
await page.fill('#email', env.JS_USER);
await page.fill('#password', env.JS_PASS);
await page.click('#loginButton');
await page.waitForURL(/#\/search/, { timeout: 10000 }).catch(() => {});
await page.waitForLoadState('networkidle').catch(() => {});
out.push({ route: 'ACTION login', api: [...calls].sort(), landed: page.url() });

await page.getByRole('button', { name: 'Open Sidenav' }).click().catch(() => {});
const authNavLinks = await page.$$eval('mat-sidenav a[href*="#/"], mat-sidenav a[routerlink]', as =>
  as.map(a => (a.getAttribute('href') || a.getAttribute('routerlink'))).filter(Boolean));
await page.reload(); await page.waitForLoadState('networkidle').catch(() => {});   // close the sidenav (it makes the page inert)

// Product interactions: add first product to basket, open product details
calls = new Set();
await page.goto(BASE + '/#/search');
await page.waitForLoadState('networkidle');
await page.getByRole('button', { name: 'Add to Basket' }).first().click();
await page.waitForTimeout(1500);
out.push({ route: 'ACTION add-to-basket', api: [...calls].sort() });
calls = new Set();
await page.locator('mat-card img').first().click();
await page.waitForTimeout(1500);
out.push({ route: 'ACTION product-details dialog', api: [...calls].sort(), ...(await controls()) });
await page.keyboard.press('Escape');

const authRoutes = ['/basket', '/address/select', '/address/create', '/payment/shop', '/saved-payment-methods',
  '/order-history', '/complain', '/recycle', '/wallet', '/deluxe-membership', '/privacy-security/data-export',
  '/privacy-security/change-password', '/privacy-security/two-factor', '/privacy-security/last-login-ip', '/accounting',
  '/administration'];
for (const r of authRoutes) await visit(r);

await page.screenshot({ path: 'explore/last-page.png' });
fs.writeFileSync('explore/juice-shop-map.json', JSON.stringify({ navLinks, authNavLinks, pages: out }, null, 2));
console.log(`navLinks: ${navLinks.join(' ')}\nauthNavLinks: ${authNavLinks.join(' ')}\n`);
for (const p of out) {
  console.log(`== ${p.route}${p.landed ? '  -> ' + p.landed : ''}`);
  if (p.api?.length) console.log('   API: ' + p.api.join(' | '));
  if (p.ids?.length) console.log('   ids: ' + p.ids.join(' '));
  if (p.buttons?.length) console.log('   btns: ' + p.buttons.join(' | '));
}
await browser.close();
