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

test('a due follow-up opens a mail draft, then moves on to a week out', async ({ page }) => {
  await page.goto('/hunt/outreach');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Figma' }) });
  await expect(card.getByText('Follow up today')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Open follow-up in Outlook: Priya Nair (Figma)' })).toHaveAttribute('href', /^mailto:pnair@figma\.com\?subject=Re%3A/);
  await card.getByRole('button', { name: 'Follow-up sent: Figma' }).click();
  await expect(card.getByText('Check back in 7 days')).toBeVisible();
  await expect(card.getByRole('button', { name: /^Follow-up sent/ })).toHaveCount(0);
});

test('close an applied drafted outreach with Done and reopen it', async ({ page }) => {
  await page.goto('/hunt/outreach');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Stripe' }) });
  await card.getByRole('button', { name: 'Done: Stripe' }).click(); // Stripe is already in the Sheet, so Discard reads Done
  await page.getByText(/^Done \(/).click();
  await page.getByRole('button', { name: 'Reopen: Stripe' }).click();
  await expect(card.getByRole('button', { name: 'Sent' })).toBeVisible();
});

test('cold email from a posting lands on Outreach', async ({ page }) => {
  await page.goto('/hunt/jobs');
  await page.getByRole('button', { name: 'Cold email' }).first().click();
  await expect(page).toHaveURL(/\/hunt\/outreach$/);
  await expect(page.getByText('Queued for Mac').first()).toBeVisible();
});

test('Tailor resume queues and lands on Outreach', async ({ page }) => {
  await page.goto('/hunt/jobs');
  await page.getByRole('button', { name: 'Tailor resume' }).first().click();
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
  // Start on Today and move in-app: the demo data lives in memory, so a reload would reset it.
  await page.goto('/');
  const heat = page.getByRole('img', { name: /^Activity: \d+ of \d+ days active$/ });
  const active = async () => Number((await heat.getAttribute('aria-label'))!.match(/^Activity: (\d+)/)![1]);
  const before = await active();
  await page.getByRole('link', { name: 'Grind', exact: true }).first().click();
  await page.getByRole('link', { name: 'Prep', exact: true }).click();
  await page.getByLabel('Note (optional)').fill('Sliding window drills');
  await page.getByRole('button', { name: 'Log Study' }).click();
  await expect(page.getByText('Study · 30 min · Sliding window drills')).toBeVisible();

  await page.getByRole('link', { name: 'Today', exact: true }).first().click();
  await expect(page.getByText(/DAY STREAK/i)).toBeVisible();
  await expect(heat).toBeVisible();
  // Today now has a prep session, so it counts as active (it may already have been).
  expect(await active()).toBeGreaterThanOrEqual(Math.max(before, 1));
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
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => {
    const { data } = c.getContext('2d')!.getImageData(0, 560, 1080, 200);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 200 && data[i + 1] > 60 && data[i + 1] < 170 && data[i + 2] < 90) return true;
    }
    return false;
  }), { timeout: 5000 }).toBe(true);
  await expect(page.getByRole('button', { name: 'Copy caption' })).toBeVisible();
});

test('I applied adds a posting to the Sheet (with duplicate confirm) and it leaves the inbox', async ({ page }) => {
  await page.goto('/hunt/jobs');
  const ramp = page.getByRole('button', { name: 'I applied: Ramp Software Engineer, New Grad' });
  await ramp.click();
  await expect(ramp).toHaveCount(0);
  // Stripe's posting is already in the Sheet: confirm inline, then add anyway.
  await page.getByRole('button', { name: 'I applied: Stripe Software Engineer Intern, Winter 2027' }).click();
  await expect(page.getByText('Already in your Sheet. Add anyway?')).toBeVisible();
  await page.getByRole('button', { name: 'Add Stripe anyway' }).click();
  await expect(page.getByRole('button', { name: /^I applied: Stripe/ })).toHaveCount(0);
  await page.goto('/hunt/apps');
  await page.getByRole('searchbox', { name: 'Search' }).fill('New Grad');
  await expect(page.getByText('Software Engineer, New Grad')).toBeVisible();
});

test('change an application status from the Status select', async ({ page }) => {
  await page.goto('/hunt/apps');
  await page.getByRole('searchbox', { name: 'Search' }).fill('Coinbase');
  const select = page.getByRole('combobox', { name: 'Status for Coinbase Software Engineer Intern' });
  await expect(select).toHaveValue('Rejected after OA');
  await select.selectOption('Rejected after interview');
  await expect(page.getByRole('combobox', { name: 'Status for Coinbase Software Engineer Intern' })).toHaveValue('Rejected after interview');
});
