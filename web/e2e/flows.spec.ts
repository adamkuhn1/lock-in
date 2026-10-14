import { expect, test } from '@playwright/test';

test('rate a fresh solve with one tap', async ({ page }) => {
  await page.goto('/grind/leetcode');
  const group = page.getByRole('group', { name: /How did .* go\?/ });
  await expect(group).toHaveCount(1);
  await group.getByRole('button', { name: 'Nailed it' }).click();
  await expect(group).toHaveCount(0);
});

test('paste a job link and see it queued for the Mac', async ({ page }) => {
  await page.goto('/hunt/outreach');
  await page.getByRole('textbox', { name: 'Job link' }).fill('https://jobs.lever.co/acme/42');
  await page.getByRole('button', { name: 'Draft emails' }).click();
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'jobs.lever.co' }) });
  await expect(card.getByText('Queued for Mac')).toBeVisible();
});

test('cold email from a posting lands on Outreach', async ({ page }) => {
  await page.goto('/hunt/jobs');
  await page.getByRole('button', { name: 'Cold email' }).first().click();
  await expect(page).toHaveURL(/\/hunt\/outreach$/);
  await expect(page.getByText('Queued for Mac').first()).toBeVisible();
});

test('Today shows rings and the season funnel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /^Day \d+$/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /^LeetCode today: \d+ of 6$/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Applications this week: \d+ of 25$/ })).toBeVisible();
  await expect(page.getByText('Online assessments')).toBeVisible();
});

test('Work on this queues a Mac launch', async ({ page }) => {
  await page.goto('/me');
  await page.getByRole('button', { name: 'Work on this: Cache weather API responses' }).click();
  await expect(page.getByRole('button', { name: 'Queued for Mac: Cache weather API responses' })).toBeDisabled();
});

test('log a prep session', async ({ page }) => {
  await page.goto('/grind/prep');
  await page.getByLabel('Note (optional)').fill('Sliding window drills');
  await page.getByRole('button', { name: 'Log Study' }).click();
  await expect(page.getByText('Study · 30 min · Sliding window drills')).toBeVisible();
});

test('add an event and see it in Upcoming', async ({ page }) => {
  await page.goto('/calendar');
  await page.getByLabel('Title').fill('Stripe interview');
  await page.getByLabel('Kind').selectOption('interview');
  await page.getByRole('button', { name: 'Add event' }).click();
  await expect(page.getByRole('region', { name: 'Upcoming' }).getByText('Stripe interview')).toBeVisible();
});

test('share card renders', async ({ page }) => {
  await page.goto('/me/share');
  const canvas = page.locator('canvas.share-canvas');
  await expect(canvas).toBeVisible();
  // Scan the day-number band for an orange pixel instead of probing one coordinate: a single point (540, 700)
  // can land between glyphs, while any orange pixel in the band proves the card was drawn.
  const painted = await canvas.evaluate((c: HTMLCanvasElement) => {
    const { data } = c.getContext('2d')!.getImageData(0, 560, 1080, 200);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 200 && data[i + 1] > 60 && data[i + 1] < 170 && data[i + 2] < 90) return true;
    }
    return false;
  });
  expect(painted).toBe(true);
  await expect(page.getByRole('button', { name: 'Copy caption' })).toBeVisible();
});
