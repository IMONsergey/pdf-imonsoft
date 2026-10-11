import { test, expect } from '@playwright/test';
import path from 'node:path';
const fixtures = path.resolve(process.cwd(), '../../.data/fixtures');

test('catalog, search, theme persistence and unknown route', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Файлы');
  await expect(page.locator('.tool-grid .tool-card')).toHaveCount(23);
  await page.getByRole('searchbox').fill('pptx');
  await expect(page.locator('.tool-grid .tool-card')).toHaveCount(2);
  await page.getByRole('searchbox').fill('zzzz-impossible');
  await expect(page.getByText('Ничего не нашлось')).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить поиск' }).click();
  await page.getByRole('button', { name: 'Включить тёмную тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/#/not-a-route');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Такой страницы нет');
});

test('responsive navigation and no horizontal page overflow', async ({ page }) => {
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Презентации', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Презентации');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('real PDF preview, conversion, download and history', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/#/tools/pdf-to-pptx');
  await expect(page.getByText('Слайды в виде изображений', { exact: true })).toBeVisible();
  const workerResponse = page.waitForResponse(response => response.url().includes('pdf.worker.min'));
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'sample.pdf'));
  expect((await workerResponse).headers()['content-type']).toContain('javascript');
  await expect(page.getByRole('button', { name: 'Следующая страница' })).toBeVisible();
  await page.getByRole('button', { name: 'Следующая страница' }).click();
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', 'Страница 2');
  await page.getByRole('button', { name: 'Обработать', exact: true }).click();
  const downloadButton = page.getByRole('link', { name: /Скачать/ });
  await expect(downloadButton).toBeVisible({ timeout: 40_000 });
  const download = page.waitForEvent('download');
  await downloadButton.click();
  expect((await download).suggestedFilename()).toMatch(/\.pptx$/);
  await page.goto('/#/history');
  await expect(page.locator('.history-list')).toContainText('sample.pdf');
  expect(failures).toEqual([]);
});

test('client rejects wrong extension and empty files without upload', async ({ page }) => {
  let creates = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/jobs')) creates++; });
  await page.goto('/#/tools/rotate-pdf');
  await page.getByTestId('file-input').setInputFiles({ name: 'bad.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(page.getByRole('alert')).toContainText('Не подходит формат');
  await page.getByTestId('file-input').setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
  await expect(page.getByRole('alert')).toContainText('Пустой файл');
  expect(creates).toBe(0);
});

test('merge requires two files and supports order changes', async ({ page }) => {
  await page.goto('/#/tools/merge-pdf');
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'sample.pdf'));
  await expect(page.getByRole('button', { name: /Обработать/ })).toBeDisabled();
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'sample.pdf'));
  await expect(page.getByRole('button', { name: /Обработать/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Переместить файл 2 выше' }).click();
  await expect(page.getByText('Порядок файлов изменён')).toBeVisible();
});


test('PowerPoint exports to a real PDF through the Office engine', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/tools/pptx-to-pdf');
  await page.locator('input[type=file]').setInputFiles(path.join(fixtures, 'sample.pptx'));
  await page.getByRole('button', { name: 'Обработать', exact: true }).click();
  await expect(page.getByRole('link', { name: /Скачать/ })).toBeVisible({ timeout: 60000 });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: /Скачать/ }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(await download.failure()).toBeNull();
  expect(errors).toEqual([]);
});
