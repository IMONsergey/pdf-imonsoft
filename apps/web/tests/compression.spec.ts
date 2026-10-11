import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import { stat } from 'node:fs/promises';
const fixtures = path.resolve(process.cwd(), '../../.data/fixtures');
const ready = (page: Page) => page.getByRole('link', { name: 'Скачать PDF', exact: true });

async function submit(page: Page) {
  const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/v1/jobs'));
  await page.getByRole('button', { name: 'Обработать', exact: true }).click();
  const created = await (await createdResponse).json();
  await expect(ready(page)).toBeVisible({ timeout: 60000 });
  const result = await page.request.get(`/api/v1/jobs/${created.id}`);
  expect(result.ok()).toBe(true);
  return result.json();
}


test('compression saves real bytes, compares quality and retries the ORIGINAL file', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/tools/compress-pdf');
  await expect(page.getByRole('radio', { name: /^Оптимальное/ })).toBeChecked();
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'compression-heavy.pdf'));
  const input = (await stat(path.join(fixtures, 'compression-heavy.pdf'))).size;
  const first = await submit(page);
  expect(first.details.compression.inputBytes).toBe(input);
  expect(first.outputSize).toBeLessThan(input * .5);
  await expect(page.getByRole('region', { name: 'Результат сжатия PDF' })).toContainText('До сжатия');
  await expect(page.locator('.compression-gain')).toContainText('Сэкономлено');
  await page.getByRole('button', { name: 'Сравнить до и после' }).click();
  const dialog = page.getByRole('dialog', { name: 'Сравнение качества сжатия PDF' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('canvas')).toHaveCount(2);
  await expect(dialog.getByRole('img', { name: 'Исходник, страница 1' })).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Результат, страница 1' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Масштаб сравнения' }).selectOption('2');
  await page.getByRole('button', { name: 'Закрыть сравнение' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Изменить сжатие', exact: true }).click();
  await expect(page.locator('.picked-file')).toContainText('compression-heavy.pdf');
  await page.getByRole('radio', { name: /^Сильное/ }).check();
  const second = await submit(page);
  expect(second.details.compression.inputBytes).toBe(input);
  expect(second.details.compression.targetDpi).toBe(96);
  expect(second.outputSize).toBeLessThan(first.outputSize);
  const downloadEvent = page.waitForEvent('download');
  await ready(page).click();
  const downloaded = await downloadEvent;
  expect(await downloaded.failure()).toBeNull();
  expect(downloaded.suggestedFilename()).toMatch(/\.pdf$/);
  expect(errors).toEqual([]);
});


test('no-gain result is explicit and byte-identical, not fake compression', async ({ page }) => {
  await page.goto('/#/tools/compress-pdf');
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'compression-optimized.pdf'));
  const job = await submit(page);
  expect(job.details.compression.unchanged).toBe(true);
  expect(job.outputSize).toBe(job.inputSize);
  await expect(page.getByRole('heading', { name: 'Размер не уменьшился' })).toBeVisible();
  await expect(page.locator('.compression-gain')).toContainText('Без изменений');
  expect(job.details.compression.jpegReencoded).toBe(0);
});


test('compression controls, result and comparison are accessible on mobile and both themes', async ({ page }) => {
  test.setTimeout(120000);
  for (const theme of ['light', 'dark']) {
    await page.goto('/#/tools/compress-pdf');
    await page.reload(); // A same-hash navigation intentionally preserves the workspace; reset only the test fixture.
    if (await page.locator('html').getAttribute('data-theme') !== theme) {
      await page.getByRole('button', { name: theme === 'light' ? 'Включить светлую тему' : 'Включить тёмную тему' }).click();
    }
    await page.getByRole('radio', { name: /^Свои настройки/ }).check();
    await page.getByLabel(/Предельное разрешение изображений/).selectOption('240');
    const controls = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(controls.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'compression-heavy.pdf'));
    const job = await submit(page);
    expect(job.details.compression.mode).toBe('custom');
    expect(job.details.compression.targetDpi).toBe(240);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
    await page.getByRole('button', { name: 'Сравнить до и после' }).click();
    const dialog = page.getByRole('dialog', { name: 'Сравнение качества сжатия PDF' });
    await expect(dialog.locator('canvas')).toHaveCount(2);
    const compare = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(compare.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.getByRole('button', { name: 'До сжатия', exact: true }).click();
    await expect(dialog.getByRole('img', { name: 'Исходник, страница 1' })).toBeVisible();
    await dialog.getByRole('button', { name: 'После сжатия', exact: true }).click();
    await expect(dialog.getByRole('img', { name: 'Результат, страница 1' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  }
});
