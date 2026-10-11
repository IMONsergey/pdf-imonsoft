import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
const fixtures = path.resolve(process.cwd(), '../../.data/fixtures');

test('catalog, organizer and enlarged preview have no automated WCAG A/AA violations', async ({ page }) => {
  test.setTimeout(120000);
  for (const theme of ['light', 'dark']) {
    await page.goto('/');
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await page.getByRole('button', { name: theme === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему' }).click();
    }
    for (const route of ['/', '/#/tools/organize-pdf', '/#/tools/crop-pdf']) {
      await page.goto(route);
      if (route.includes('organize')) {
        await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'sample.pdf'));
        await expect(page.locator('.page-tile')).toHaveCount(3);
      }
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), `${theme} ${route}`).toEqual([]);
    }
    await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'sample.pdf'));
    await page.getByRole('button', { name: 'Увеличить предпросмотр' }).click();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations.map(v => v.id), `${theme} preview dialog`).toEqual([]);
    await page.keyboard.press('Escape');
  }
});

test('access screen handles rejection and login without leaking its form into the workspace', async ({ page }) => {
  // UI-only access fixture; real password verification is covered by backend tests.
  const config = await (await page.request.get('/api/v1/config')).json();
  let authenticated = false;
  await page.route('**/api/v1/config', route => route.fulfill({
    status: authenticated ? 200 : 401, contentType: 'application/json',
    body: JSON.stringify(authenticated ? { ...config, accessEnabled: true } : { detail: 'Войдите с паролем.' }),
  }));
  await page.route('**/api/v1/access/login', async route => {
    authenticated = route.request().postDataJSON().password === 'fixture-only-access-key';
    await route.fulfill({ status: authenticated ? 200 : 401, contentType: 'application/json', body: JSON.stringify(authenticated ? { authenticated: true } : { detail: 'Неверный пароль.' }) });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ваше рабочее пространство' })).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.map(v => v.id)).toEqual([]);
  await page.getByLabel('Пароль', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Неверный пароль.');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-only-access-key');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Файлы');
  await expect(page.locator('.access-screen')).toHaveCount(0);
});
