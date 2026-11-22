import { test, expect, USER } from './fixtures';

/** Juice Shop's captcha is a small arithmetic expression such as "1+9-6" */
function solveCaptcha(expr: string): string {
  const e = expr.trim();
  if (!/^[\d+\-*]+$/.test(e)) throw new Error(`unexpected captcha: ${e}`);
  return String(Function(`"use strict"; return (${e});`)());
}

test.describe.skip('Feedback module', { tag: '@feedback' }, () => {
  test('submit customer feedback with captcha', async ({ page }) => {
    await page.goto('/#/contact');
    await page.locator('#comment').fill(`DAST feedback ${Date.now()}`);
    const slider = page.locator('#rating input[type="range"]').first();
    await slider.focus();
    for (let i = 0; i < 3; i++) await slider.press('ArrowRight');
    await expect(page.locator('#captcha')).toHaveText(/\d/);          // captcha is loaded asynchronously
    await page.locator('#captchaControl').fill(solveCaptcha((await page.locator('#captcha').textContent()) ?? ''));
    await page.locator('#submitButton').click();
    await expect(page.getByText(/Thank you for your feedback/i)).toBeVisible();
  });

  test('file a complaint', async ({ loggedInPage: page }) => {
    await page.goto('/#/complain');
    // the Customer field is filled asynchronously from /rest/user/whoami; wait so the form isn't reset under us
    await expect(page.getByLabel('Text field for the mail address of the user')).toHaveValue(USER);
    await page.locator('#complaintMessage').fill(`DAST complaint ${Date.now()}`);
    await expect(page.locator('#submitButton')).toBeEnabled();
    const saved = page.waitForResponse(r => r.url().includes('/api/Complaints') && r.request().method() === 'POST');
    await page.locator('#submitButton').click();
    expect((await saved).status()).toBe(201);
    await expect(page.getByText(/Customer support will get in touch/i)).toBeVisible();
  });

  test('write a product review', async ({ loggedInPage: page }) => {
    await page.goto('/#/search');
    await page.locator('mat-card img').first().click();
    const dialog = page.locator('mat-dialog-container');
    await dialog.getByLabel('Text field to review a product').fill(`DAST review ${Date.now()}`);
    await dialog.getByRole('button', { name: 'Send the review' }).click();
    await expect(page.getByText(/review has been saved/i)).toBeVisible();
  });

  test('feedback API with captcha', async ({ request }) => {
    const captcha = await (await request.get('/rest/captcha/')).json();
    const res = await request.post('/api/Feedbacks/', {
      data: { captchaId: captcha.captchaId, captcha: solveCaptcha(captcha.captcha), comment: 'DAST API feedback', rating: 4 },
    });
    expect(res.status()).toBe(201);
  });
});
