// Second pass: stable selectors (aria-label / placeholder / formcontrolname / mat-label) for the forms
// the test suite will drive, plus a walk through the checkout flow.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'http://localhost:3000';
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: 'welcomebanner_status', value: 'dismiss', url: BASE },
                      { name: 'cookieconsent_status', value: 'dismiss', url: BASE }]);
const page = await ctx.newPage();
const dump = async (label) => {
  await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700);
  const f = await page.evaluate(() => {
    const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    return [...document.querySelectorAll('mat-sidenav-content input, mat-sidenav-content textarea, mat-sidenav-content mat-select, mat-dialog-container input, mat-dialog-container textarea, mat-sidenav-content mat-slider, mat-sidenav-content button[id], mat-sidenav-content mat-radio-button, mat-sidenav-content mat-row, mat-sidenav-content [id=captcha]')]
      .filter(vis).map(e => {
        const ff = e.closest('mat-form-field');
        return [e.tagName.toLowerCase(), e.id && '#' + e.id, e.getAttribute('aria-label') && `aria="${e.getAttribute('aria-label')}"`,
          e.getAttribute('placeholder') && `ph="${e.getAttribute('placeholder')}"`, e.getAttribute('formcontrolname') && `fc=${e.getAttribute('formcontrolname')}`,
          ff?.querySelector('mat-label') && `label="${ff.querySelector('mat-label').textContent.trim()}"`,
          (e.tagName === 'BUTTON' || e.id === 'captcha' || e.tagName === 'MAT-ROW' || e.tagName === 'MAT-RADIO-BUTTON') && `text="${e.textContent.trim().replace(/\s+/g, ' ').slice(0, 50)}"`]
          .filter(Boolean).join(' ');
      });
  });
  console.log(`== ${label} (${page.url().replace(BASE, '')})\n   ` + f.join('\n   '));
};

await page.goto(BASE + '/#/register'); await dump('register');
await page.locator('#securityQuestionControl').click(); await page.waitForTimeout(500);
console.log('   security question options:', (await page.locator('mat-option').allTextContents()).slice(0, 3).map(s => s.trim()));
await page.keyboard.press('Escape');
await page.goto(BASE + '/#/contact'); await dump('contact');

await page.goto(BASE + '/#/login'); await page.fill('#email', env.JS_USER); await page.fill('#password', env.JS_PASS);
await page.click('#loginButton'); await page.waitForURL(/#\/search/);
await page.locator('mat-card img').first().click(); await dump('product dialog'); await page.keyboard.press('Escape');
await page.goto(BASE + '/#/complain'); await dump('complain');
await page.goto(BASE + '/#/privacy-security/change-password'); await dump('change-password');

// Checkout walk
await page.goto(BASE + '/#/search'); await page.waitForLoadState('networkidle');
await page.getByRole('button', { name: 'Add to Basket' }).first().click(); await page.waitForTimeout(1000);
await page.goto(BASE + '/#/basket'); await dump('basket');
await page.click('#checkoutButton'); await dump('after checkout click');
await page.getByRole('button', { name: 'Add New Address' }).click(); await dump('address create');
await page.screenshot({ path: 'explore/address-create.png' });
await browser.close();
