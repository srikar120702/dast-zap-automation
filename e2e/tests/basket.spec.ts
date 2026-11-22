import { test, expect, apiLogin } from './fixtures';

test.describe.skip('Basket module', { tag: '@basket' }, () => {
  test('add a product to the basket', async ({ loggedInPage: page }) => {
    await page.goto('/#/search');
    await page.getByRole('button', { name: 'Add to Basket' }).first().click();
    await expect(page.getByText(/into basket|Added another/i)).toBeVisible();
    await page.goto('/#/basket');
    await expect(page.locator('mat-row').first()).toBeVisible();
  });

  test('change item quantity via the basket API', async ({ request }) => {
    const { bid, headers } = await apiLogin(request);
    // make sure there is at least one item (ignore "already in basket" errors)
    await request.post('/api/BasketItems/', { headers, data: { ProductId: 1, BasketId: String(bid), quantity: 1 } });
    const basket = await (await request.get(`/rest/basket/${bid}`, { headers })).json();
    const item = basket.data.Products[0].BasketItem;
    const res = await request.put(`/api/BasketItems/${item.id}`, { headers, data: { quantity: 2 } });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.quantity).toBe(2);
  });

  test('checkout: address, delivery, payment and order', async ({ loggedInPage: page }) => {
    await page.goto('/#/search');
    await page.getByRole('button', { name: 'Add to Basket' }).first().click();
    await page.goto('/#/basket');
    await page.locator('#checkoutButton').click();

    // Address
    await expect(page).toHaveURL(/address\/select/);
    await page.getByRole('button', { name: 'Add New Address' }).click();
    await page.getByPlaceholder('Please provide a name.').fill('DAST Tester');
    await page.getByPlaceholder('Please provide a country.').fill('India');
    await page.getByPlaceholder('Please provide a mobile number.').fill('9876543210');
    await page.getByPlaceholder('Please provide a ZIP code.').fill('560001');
    await page.getByPlaceholder('Please provide an address.').fill('1 Test Street');
    await page.getByPlaceholder('Please provide a city.').fill('Bengaluru');
    await page.getByPlaceholder('Please provide a state.').fill('Karnataka');
    await page.locator('#submitButton').click();
    await expect(page).toHaveURL(/address\/select/);
    await page.getByRole('row').filter({ hasText: 'DAST Tester' }).first().getByRole('radio').check();
    await page.getByRole('button', { name: /Proceed to payment selection|Continue/ }).click();

    // Delivery
    await expect(page).toHaveURL(/delivery-method/);
    await page.getByRole('row').getByRole('radio').first().check();
    await page.getByRole('button', { name: /Proceed to delivery method selection|Continue/ }).click();

    // Payment: add a card, select it
    await expect(page).toHaveURL(/payment\/shop/);
    await page.getByText('Add new card').click();
    await page.getByLabel('Name').fill('DAST Tester');
    await page.getByLabel('Card Number').fill('4111111111111111');
    await page.getByLabel('Expiry Month').selectOption('12');
    await page.getByLabel('Expiry Year').selectOption('2090');
    await page.locator('#submitButton').click();
    await page.getByRole('row').filter({ hasText: '1111' }).first().getByRole('radio').check();
    await page.getByRole('button', { name: /Proceed to review/ }).click();

    // Review + place order
    await expect(page).toHaveURL(/order-summary/);
    await page.locator('#checkoutButton').click();
    await expect(page).toHaveURL(/order-completion/);
    await expect(page.getByText(/Thank you for your purchase/i)).toBeVisible();
  });
});
