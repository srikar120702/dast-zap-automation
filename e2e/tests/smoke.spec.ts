import { test, expect } from '@playwright/test';

// Pre-setup check: the browser reaches Juice Shop *through ZAP* (http://juice-shop:3000 only resolves via the proxy)
test.skip('juice shop loads through ZAP proxy', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/OWASP Juice Shop/);
});
