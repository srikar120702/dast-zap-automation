import { test, expect } from './fixtures';

test.describe('Catalog module', { tag: '@catalog' }, () => {
  test.skip('browse products on the home page', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.locator('mat-card').first()).toBeVisible();
    expect(await page.locator('mat-card').count()).toBeGreaterThan(5);
  });

  test('search products from the search bar', async ({ page }) => {
    await page.goto('/#/');
    await page.getByRole('button', { name: 'Open search' }).click();
    const box = page.locator('#searchQuery input, input[aria-label*="search" i]').first();
    await box.fill('apple');
    await box.press('Enter');
    await expect(page).toHaveURL(/search\?q=apple/);
    await expect(page.locator('mat-card').first()).toContainText(/apple/i);
  });

  test.skip('open product details and reviews', async ({ page }) => {
    await page.goto('/#/search');
    await page.locator('mat-card img').first().click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Reviews/);
    await dialog.getByRole('button', { name: 'Close Dialog' }).click();
    await expect(dialog).toBeHidden();
  });

  test.skip('product API: list and search', async ({ request }) => {
    const all = await request.get('/api/Products');
    expect(all.ok()).toBeTruthy();
    expect((await all.json()).data.length).toBeGreaterThan(5);
    const found = await request.get('/rest/products/search?q=juice');
    expect(found.ok()).toBeTruthy();
    expect((await found.json()).data.length).toBeGreaterThan(0);
  });
});
