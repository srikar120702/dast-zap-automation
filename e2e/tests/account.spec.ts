import { test, expect, uniqueEmail, uiLogin, apiRegister, USER } from './fixtures';

test.describe.skip('Account module', { tag: '@account' }, () => {
  test('register a new user via the UI', async ({ page }) => {
    const email = uniqueEmail('reg');
    const password = `Pw!${Date.now() % 1e8}`;          // Juice Shop allows 5-20 chars
    const questions = page.waitForResponse(/\/api\/SecurityQuestions/);
    await page.goto('/#/register');
    await questions;                                              // options come from this API call
    await page.locator('#emailControl').fill(email);
    await page.locator('#passwordControl').fill(password);
    await page.locator('#repeatPasswordControl').fill(password);
    // the select sometimes ignores the first click while Angular is still rendering: retry until it opens
    await expect(async () => {
      await page.locator('#securityQuestionControl').click();
      await expect(page.locator('mat-option').first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.locator('mat-option').first().click();
    await page.locator('#securityAnswerControl').fill('dast');
    await expect(page.locator('#registerButton')).toBeEnabled();
    await page.locator('#registerButton').click();
    await expect(page).toHaveURL(/#\/login/);
  });

  test('login with valid credentials', async ({ page }) => {
    await uiLogin(page);
    await page.locator('#navbarAccount').click();
    await expect(page.getByRole('menu')).toContainText(USER);
  });

  test('login with a wrong password is rejected', async ({ page }) => {
    await page.goto('/#/login');
    await page.locator('#email').fill(USER);
    await page.locator('#password').fill('definitely-wrong');
    await page.locator('#loginButton').click();
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
  });

  test('change the password of a fresh user', async ({ page, request }) => {
    const email = uniqueEmail('pw');
    const oldPw = 'OldPassw0rd!';
    const newPw = 'NewPassw0rd!';
    await apiRegister(request, email, oldPw);
    await uiLogin(page, email, oldPw);
    await page.goto('/#/privacy-security/change-password');
    await page.locator('#currentPassword').fill(oldPw);
    await page.locator('#newPassword').fill(newPw);
    await page.locator('#newPasswordRepeat').fill(newPw);
    await page.locator('#changeButton').click();
    await expect(page.getByText(/password was successfully changed/i)).toBeVisible();
  });
});
