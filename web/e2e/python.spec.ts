import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The real thing: Pyodide from the CDN grades lesson 1 in the browser. Desktop only (lessons code on desktop).
test('a lesson grades real Python: starter fails, solution passes, a loop gets stopped', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('phone'), 'code exercises are desktop-only');
  test.setTimeout(120_000);
  await page.goto('/grind/learn/cs/cs-1/01-binary');
  const editor = page.getByRole('textbox', { name: 'Your code for Bits: counting with two digits' });
  const runBtn = page.getByRole('button', { name: 'Run tests' });
  const replace = async (code: string) => {
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(code);
  };

  await runBtn.click();
  await expect(page.getByText(/^1 of 7 tests pass$/i)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('to_binary(13, 4) returned [], expected [1, 1, 0, 1]')).toBeVisible();

  await replace(readFileSync(new URL('../../shared/lessons/cs-1/01-binary/solution.py', import.meta.url), 'utf8'));
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByText(/^All 7 tests pass$/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('link', { name: 'Next lesson' }).first()).toBeVisible();

  await replace('while True:\n    pass\n');
  await runBtn.click();
  await expect(page.getByText(/^Stopped after 5 seconds/)).toBeVisible({ timeout: 15_000 });
});
