import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const SCREENS = [
  { name: 'today', path: '/', heading: /^Day \d+$/ },
  { name: 'grind-leetcode', path: '/grind/leetcode', heading: 'LeetCode' },
  { name: 'grind-prep', path: '/grind/prep', heading: 'Prep' },
  { name: 'grind-cs', path: '/grind/learn/cs', heading: 'CS' },
  { name: 'grind-math', path: '/grind/learn/math', heading: 'Math' },
  { name: 'grind-review', path: '/grind/review', heading: 'Review' },
  { name: 'grind-lesson', path: '/grind/learn/cs/cs-1/01-binary', heading: 'Bits: counting with two digits' },
  { name: 'hunt-jobs', path: '/hunt/jobs', heading: 'Jobs' },
  { name: 'hunt-apps', path: '/hunt/apps', heading: 'Applications' },
  { name: 'hunt-engineers', path: '/hunt/engineers', heading: 'Engineers' },
  { name: 'hunt-outreach', path: '/hunt/outreach', heading: 'Outreach' },
  { name: 'projects', path: '/projects', heading: 'Projects' },
  { name: 'calendar', path: '/calendar', heading: 'Calendar' },
  { name: 'me', path: '/me', heading: 'Me' },
  { name: 'share', path: '/me/share', heading: 'Share' },
  { name: 'settings', path: '/me/settings', heading: 'Settings' },
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
  for (const [label, path] of [['Grind', '/grind/leetcode'], ['Hunt', '/hunt/jobs'], ['Projects', '/projects'], ['Calendar', '/calendar'], ['Me', '/me'], ['Today', '/']] as const) {
    // The demo data has a stale Sheet sync, so the Me tab's accessible name is "Me (a sync is stale)" there.
    const name = label === 'Me' ? /^Me( \(a sync is stale\))?$/ : label;
    await page.getByRole('link', { name, exact: label !== 'Me' }).first().click();
    await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/' : path}$`));
  }
  // Settings is a row on the Me screen, not a tab.
  await page.getByRole('link', { name: /^Me/ }).first().click();
  await page.getByRole('link', { name: /^Settings/ }).first().click();
  await expect(page).toHaveURL(/\/me\/settings$/);
});

test('old v1 paths redirect', async ({ page }) => {
  await page.goto('/jobs');
  await expect(page).toHaveURL(/\/hunt\/jobs$/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/me\/settings$/);
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
