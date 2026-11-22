import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';

export const USER = process.env.JS_USER!;
export const PASS = process.env.JS_PASS!;
export const uniqueEmail = (prefix = 'dast') =>
  `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e4)}@juice-sh.op`;

/** UI login: the realistic flow (POST /rest/user/login, whoami, basket) */
export async function uiLogin(page: Page, email = USER, password = PASS) {
  await page.goto('/#/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#loginButton').click();
  await expect(page).toHaveURL(/#\/search/);
}

/** API login: returns JWT + basket id for API-level tests */
export async function apiLogin(request: APIRequestContext, email = USER, password = PASS) {
  const res = await request.post('/rest/user/login', { data: { email, password } });
  expect(res.ok(), `login failed for ${email}`).toBeTruthy();
  const { authentication } = await res.json();
  return {
    token: authentication.token as string,
    bid: authentication.bid as number,
    headers: { Authorization: `Bearer ${authentication.token}` },
  };
}

/** API registration of a throw-away user (security question 1, answer "dast") */
export async function apiRegister(request: APIRequestContext, email: string, password: string) {
  const res = await request.post('/api/Users', {
    data: { email, password, passwordRepeat: password, securityQuestion: { id: 1 }, securityAnswer: 'dast' },
  });
  expect(res.status(), `register failed for ${email}`).toBe(201);
}

type Fixtures = { loggedInPage: Page };

export const test = base.extend<Fixtures>({
  // Pre-dismiss the welcome banner and cookie notice so they never block clicks
  context: async ({ context, baseURL }, use) => {
    await context.addCookies([
      { name: 'welcomebanner_status', value: 'dismiss', url: baseURL! },
      { name: 'cookieconsent_status', value: 'dismiss', url: baseURL! },
    ]);
    await use(context);
  },
  // A page already logged in as the DAST test user (login traffic is part of the test run)
  loggedInPage: async ({ page }, use) => {
    await uiLogin(page);
    await use(page);
  },
});

export { expect };
