import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const SCREENS = [
  { name: 'today', path: '/', heading: /^Day \d+$/ },
  { name: 'leetcode', path: '/leetcode', heading: 'LeetCode' },
  { name: 'projects', path: '/projects', heading: 'Projects' },
  { name: 'apps', path: '/apps', heading: 'Applications' },
  { name: 'jobs', path: '/jobs', heading: 'Jobs' },
  { name: 'outreach', path: '/outreach', heading: 'Outreach' },
  { name: 'settings', path: '/settings', heading: 'Settings' },
];

for (const s of SCREENS) {
  test(`${s.name}: fits, primary above the fold, targets, copy, a11y`, async ({ page }, info) => {
    await page.goto(s.path);
    await expect(page.getByRole('heading', { level: 1, name: s.heading })).toBeVisible();
    await expect(page.locator('[role="status"][aria-label^="Loading"]')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveCount(1);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'horizontal scroll').toBeLessThanOrEqual(0);

    const box = await page.locator('[data-primary]').first().boundingBox();
    const vh = page.viewportSize()!.height;
    const navH = info.project.name.startsWith('phone') ? 64 : 0;
    expect(box, 'primary element exists').not.toBeNull();
    expect(box!.y + Math.min(box!.height, 100), 'primary above the fold').toBeLessThanOrEqual(vh - navH);

    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, summary')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') return false;
          if (el.closest('.skip-link')) return false;
          const target = (el as HTMLInputElement).type === 'checkbox' && el.closest('label') ? el.closest('label')!.getBoundingClientRect() : r;
          return target.height < 44 || target.width < 44;
        })
        .map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`));
    expect(small, 'tap targets under 44px').toEqual([]);

    const longLabels = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button')].map((b) => (b.textContent ?? '').trim()).filter((t) => t.length > 24));
    expect(longLabels, 'button labels over 24 chars').toEqual([]);

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);

    await page.screenshot({ path: `e2e/__screens__/${info.project.name}/${s.name}.png`, fullPage: true });
  });
}

test('every tab is reachable from the navigation', async ({ page }) => {
  await page.goto('/');
  for (const [label, path] of [['LeetCode', '/leetcode'], ['Projects', '/projects'], ['Apps', '/apps'], ['Jobs', '/jobs'], ['Outreach', '/outreach'], ['Today', '/']] as const) {
    await page.getByRole('link', { name: label, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/' : path}$`));
  }
  await page.getByRole('link', { name: /^Settings/ }).first().click();
  await expect(page).toHaveURL(/\/settings$/);
});

test('keyboard focus is visible', async ({ page }) => {
  await page.goto('/');
  // Wait for the signed-in shell; otherwise Tab can fire before any focusable element exists.
  await expect(page.locator('h1')).toBeVisible();
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    return { tag: el.tagName, outline: getComputedStyle(el).outlineStyle };
  });
  expect(focus.tag).not.toBe('BODY');
  expect(focus.outline).not.toBe('none');
});
