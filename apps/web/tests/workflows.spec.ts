import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import catalog from '../../../shared/tools.json' with { type: 'json' };
const fixtures = path.resolve(process.cwd(), '../../.data/fixtures');

test('organizer edits, undoes, replaces input and exports a PDF', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/tools/organize-pdf');
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'sample.pdf'));
  await expect(page.locator('.page-tile')).toHaveCount(3);
  await page.getByRole('button', { name: 'Страница 3: переместить выше' }).click();
  await expect(page.locator('.page-tile').nth(1)).toHaveAttribute('data-page', '3');
  await page.getByRole('button', { name: 'Повернуть страницу 3', exact: true }).click();
  await expect(page.locator('[data-page="3"] .page-tile-label')).toContainText('+90°');
  await page.getByRole('button', { name: 'Удалить страницу 2', exact: true }).click();
  await expect(page.locator('.page-tile')).toHaveCount(2);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('.page-tile')).toHaveCount(3);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.page-tile')).toHaveCount(2);
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'sample.pdf'));
  await expect(page.locator('.page-tile')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Обратный порядок', exact: true }).click();
  await page.getByRole('button', { name: 'Обработать', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Скачать PDF', exact: true })).toBeVisible({ timeout: 40000 });
  expect(errors).toEqual([]);
});

test('batch success and failure are distinguished in UI and archive', async ({ page }) => {
  await page.goto('/#/tools/rotate-pdf');
  const good = await readFile(path.join(fixtures, 'sample.pdf'));
  await page.getByTestId('file-input').setInputFiles([
    { name: 'good.pdf', mimeType: 'application/pdf', buffer: good },
    { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid PDF') },
  ]);
  await expect(page.getByRole('checkbox', { name: /Пакетная обработка/ })).toBeChecked();
  await page.getByRole('button', { name: /Обработать/ }).click();
  await expect(page.getByRole('heading', { name: 'Готово с ошибками', exact: true })).toBeVisible({ timeout: 40000 });
  await expect(page.locator('.batch-result')).toContainText('1 из 2');
  await expect(page.getByRole('link', { name: 'Скачать ZIP', exact: true })).toBeVisible();
  await page.goto('/#/history');
  await page.getByRole('button', { name: 'С замечаниями', exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.job-state-tag')).toHaveText('Часть файлов');
});

test('continue uses the server result without a second upload and history can be cleared', async ({ page }) => {
  let uploads = 0; let continuations = 0;
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    if (request.url().endsWith('/api/v1/jobs')) uploads++;
    if (request.url().endsWith('/continue')) continuations++;
  });
  await page.goto('/#/tools/rotate-pdf');
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'sample.pdf'));
  await page.getByRole('button', { name: 'Обработать', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Скачать PDF', exact: true })).toBeVisible({ timeout: 40000 });
  await page.getByRole('combobox', { name: 'Следующий инструмент' }).selectOption('number-pages');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('.source-result')).toBeVisible();
  await page.getByLabel('Начать нумерацию с', { exact: true }).fill('40');
  await page.getByRole('button', { name: 'Обработать', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Скачать PDF', exact: true })).toBeVisible({ timeout: 40000 });
  expect(uploads).toBe(1); expect(continuations).toBe(1);
  await page.getByRole('button', { name: 'Обработать другой файл' }).click();
  await expect(page.locator('.source-result')).toHaveCount(0);
  await page.goto('/#/history');
  await expect(page.locator('.history-row')).toHaveCount(2);
  await page.getByRole('searchbox', { name: 'Поиск в задачах' }).fill('no-match');
  await expect(page.getByRole('heading', { name: 'Задач с такими условиями нет' })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await page.getByRole('button', { name: 'Очистить завершённые' }).click();
  await page.getByRole('button', { name: 'Удалить результаты', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Здесь появятся ваши задачи' })).toBeVisible();
});

test('protected PDF preview, jump, expanded view and processing keep working together', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/tools/rotate-pdf');
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'protected.pdf'));
  await expect(page.locator('.preview-error')).toContainText('Нужен верный пароль');
  await page.getByLabel(/Пароль исходного PDF/).fill('fixture-password-123');
  await expect(page.getByRole('button', { name: 'Следующая страница' })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Перейти к странице' }).fill('2');
  await page.getByRole('spinbutton', { name: 'Перейти к странице' }).press('Enter');
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', 'Страница 2');
  await page.getByRole('button', { name: 'Увеличить предпросмотр' }).click();
  const dialog = page.getByRole('dialog', { name: 'Увеличенный предпросмотр PDF' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Следующая страница' }).click();
  await expect(dialog.locator('canvas')).toHaveAttribute('aria-label', 'Увеличенная страница 3');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Обработать', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Скачать PDF', exact: true })).toBeVisible({ timeout: 40000 });
  await expect(page.locator('.preview-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Office finishing and text-only DOCX export produce downloadable files', async ({ page }) => {
  await page.goto('/#/tools/pptx-to-pdf');
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'sample.pptx'));
  await page.getByLabel(/После конвертации/).selectOption('watermark');
  await page.getByLabel('Текст водяного знака', { exact: true }).fill('REVIEW FIXTURE');
  await page.getByRole('button', { name: 'Обработать', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Скачать PDF', exact: true })).toBeVisible({ timeout: 60000 });
  await page.getByRole('combobox', { name: 'Следующий инструмент' }).selectOption('pdf-to-docx');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('.source-result')).toBeVisible();
  await page.getByRole('button', { name: 'Обработать', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Скачать DOCX', exact: true })).toBeVisible({ timeout: 40000 });
  await expect(page.locator('.result-warning')).toContainText('не восстановлены');
});

test('large documents use bounded thumbnail windows', async ({ page }) => {
  await page.goto('/#/tools/organize-pdf');
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'many-pages.pdf'));
  await expect(page.locator('.page-tile')).toHaveCount(24);
  await page.getByRole('button', { name: 'Следующие миниатюры' }).click();
  await expect(page.locator('.page-tile')).toHaveCount(3);
  await page.getByRole('button', { name: 'Предыдущие миниатюры' }).click();
  await expect(page.locator('.page-tile')).toHaveCount(24);
});

test('every tool opens at mobile and desktop widths without overflow', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tool of catalog) {
      await page.goto(`/#/tools/${tool.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(tool.title);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tool.id} at ${width}px`).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
