import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithData } from './test/render';
import { AppRoutes, LEGACY } from './routes';

describe('routes', () => {
  // jsdom has no canvas; Share's card draws on one.
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });

  it.each([
    ['/', /^Day \d+$/], ['/grind', 'LeetCode'], ['/grind/prep', 'Prep'], ['/hunt', 'Jobs'], ['/hunt/apps', 'Applications'],
    ['/hunt/outreach', 'Outreach'], ['/calendar', 'Calendar'], ['/me', 'Me'], ['/me/share', 'Share'], ['/me/settings', 'Settings'],
  ])('%s shows its screen', async (route, heading) => {
    renderWithData(<AppRoutes />, { route });
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it.each(LEGACY)('old /%s redirects to %s', async (from, to) => {
    const names: Record<string, string> = {
      '/grind/leetcode': 'LeetCode', '/me': 'Me', '/hunt/apps': 'Applications', '/hunt/jobs': 'Jobs', '/hunt/outreach': 'Outreach', '/me/settings': 'Settings',
    };
    renderWithData(<AppRoutes />, { route: `/${from}` });
    expect(await screen.findByRole('heading', { level: 1, name: names[to] })).toBeInTheDocument();
  });

  it('the tab bar has the five tabs', async () => {
    renderWithData(<AppRoutes />, { route: '/' });
    const tabs = await screen.findByRole('navigation', { name: 'Tabs' });
    expect(within(tabs).getAllByRole('link').map((a) => a.textContent)).toEqual(['Today', 'Grind', 'Hunt', 'Calendar', 'Me']);
  });

  it('Hunt shows badges for new postings and follow-ups due', async () => {
    renderWithData(<AppRoutes />, { route: '/hunt/jobs' });
    expect(await screen.findByRole('link', { name: /^Jobs, \d+ new$/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Applications' })).toBeInTheDocument();
  });
});
