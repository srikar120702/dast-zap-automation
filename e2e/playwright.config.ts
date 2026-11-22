import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Load ../.env (JS_USER, JS_PASS, ...) without extra dependencies
const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i)] ??= line.slice(i + 1);
  }
}

export default defineConfig({
  testDir: './tests',
  workers: 1,                                     // one browser at a time keeps the recorded traffic clean
  timeout: 60_000,                                // traffic goes through ZAP, allow some headroom
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://juice-shop:3000',     // resolved by ZAP inside Docker
    proxy: { server: process.env.ZAP_PROXY ?? 'http://localhost:8080' },
    ignoreHTTPSErrors: true,                      // ZAP re-signs HTTPS with its own CA
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: false
  },
});
