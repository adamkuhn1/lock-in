import { expect, test } from '@playwright/test';

test('rate a fresh solve with one tap', async ({ page }) => {
  await page.goto('/');
  const group = page.getByRole('group', { name: /How did .* go\?/ });
  await expect(group).toHaveCount(1);
  await group.getByRole('button', { name: 'Nailed it' }).click();
  await expect(group).toHaveCount(0);
});

test('paste a job link and see it queued for the Mac', async ({ page }) => {
  await page.goto('/outreach');
  await page.getByRole('textbox', { name: 'Job link' }).fill('https://jobs.lever.co/acme/42');
  await page.getByRole('button', { name: 'Draft emails' }).click();
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'jobs.lever.co' }) });
  await expect(card.getByText('Queued for Mac')).toBeVisible();
});

test('cold email from a posting lands on Outreach', async ({ page }) => {
  await page.goto('/jobs');
  await page.getByRole('button', { name: 'Cold email' }).first().click();
  await expect(page).toHaveURL(/\/outreach$/);
  await expect(page.getByText('Queued for Mac').first()).toBeVisible();
});
