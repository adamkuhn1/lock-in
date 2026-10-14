import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import { AppShell } from './AppShell';

const tree = (
  <Routes>
    <Route element={<AppShell />}>
      <Route index element={<p>home</p>} />
    </Route>
  </Routes>
);

describe('AppShell', () => {
  it('has five tabs, a Me tab flagged stale, and syncs on open', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'syncLeetCode');
    renderWithData(tree, { api });
    const tabs = screen.getByRole('navigation', { name: 'Tabs' });
    expect(within(tabs).getAllByRole('link').map((a) => a.textContent)).toEqual(['Today', 'Grind', 'Hunt', 'Calendar', 'Me']);
    expect(await screen.findAllByRole('link', { name: 'Me (a sync is stale)' })).not.toHaveLength(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('main')).toHaveTextContent('home');
  });
  it('a failed manual Refresh shows one short line (I3)', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'syncLeetCode').mockResolvedValue({ status: 'error', message: 'LeetCode HTTP 503 secret detail' });
    renderWithData(tree, { api });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Couldn't sync LeetCode.")).toBeNull(); // the automatic sync stays quiet
    await userEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
    expect(await screen.findByText("Couldn't sync LeetCode.")).toBeInTheDocument();
    expect(screen.queryByText(/secret detail/)).toBeNull();
  });
  it('a thrown sync error on Refresh also shows the line; skipped shows nothing', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'syncLeetCode').mockResolvedValue({ status: 'skipped' });
    renderWithData(tree, { api });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Couldn't sync LeetCode.")).toBeNull();
    spy.mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
    expect(await screen.findByText("Couldn't sync LeetCode.")).toBeInTheDocument();
  });
});
