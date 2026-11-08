import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AlreadyCountedError } from '../data/api';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import { DailySetCard } from './DailySet';

describe('DailySetCard', () => {
  it('shows the LeetCode set', async () => {
    const { container } = renderWithData(<DailySetCard />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Stack' })).toBeInTheDocument();
    expect(await screen.findAllByRole('listitem', {}, { timeout: 2000 })).not.toHaveLength(0);
    expect(container.querySelector('[data-primary]')).toHaveTextContent('Stack');
    expect(container.querySelector('.count')).toHaveTextContent('2/6');
  });
  it('hides the mystery topic', async () => {
    renderWithData(<DailySetCard />);
    const row = await screen.findByRole('link', { name: /Find All Anagrams in a String/ });
    expect(row).toHaveTextContent('Mystery');
    expect(row).not.toHaveTextContent('Arrays');
  });
  it('one tap rates a fresh solve and the buttons go away', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'rateSolve');
    renderWithData(<DailySetCard />, { api });
    const group = await screen.findByRole('group', { name: 'How did Decode String go?' });
    await userEvent.click(within(group).getByRole('button', { name: /^Solo/ }));
    expect(spy).toHaveBeenCalledWith(expect.any(Number), 'solo', expect.any(Date));
    await waitFor(() => expect(screen.queryByRole('group', { name: /How did/ })).toBeNull());
  });
  it('the three ratings match how a problem gets worked', async () => {
    renderWithData(<DailySetCard />);
    const group = await screen.findByRole('group', { name: 'How did Decode String go?' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Solo', 'Explained', 'Code-along']);
    expect(group).toHaveTextContent('Explained: you watched the explanation, then wrote it yourself.');
  });
  it('shows the focus level and what it needs next', async () => {
    const { container } = renderWithData(<DailySetCard />);
    await screen.findByRole('heading', { level: 2, name: 'Stack' });
    await waitFor(() => expect(container.querySelector('.set-focus')).toHaveTextContent(
      'PracticingNext: solve 3 of your last 5 new Mediums on your own (2/3)'));
  });
  it('before the first set', async () => {
    const api = createDemoApi();
    api.getDailySet = async () => null;
    renderWithData(<DailySetCard />, { api });
    expect(await screen.findByText('No set yet.')).toBeInTheDocument(); // M11
  });
  it('late solves show the counted state instead of rating buttons', async () => {
    const api = createDemoApi();
    const list = api.listSolves.bind(api);
    api.listSolves = async () => (await list()).map((s) => ({ ...s, applied_at: s.applied_at ?? '2026-01-01T00:00:00Z' }));
    renderWithData(<DailySetCard />, { api });
    expect(await screen.findByText(/Not rated in time, so it counted as Explained/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /How did/ })).toBeNull();
  });
  it('hides the topic of a non-mystery item on a mixed day until solved', async () => {
    const api = createDemoApi();
    const get = api.getDailySet.bind(api);
    api.getDailySet = async (d) => { const set = await get(d); return set && { ...set, mixed_day: true }; };
    renderWithData(<DailySetCard />, { api });
    expect(await screen.findByRole('heading', { level: 2, name: 'Mixed day' })).toBeInTheDocument();
    const row = await screen.findByRole('link', { name: /Car Fleet/ });
    expect(row).not.toHaveTextContent('Stack');
  });
  it('a failed rating write restores the buttons', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'rateSolve').mockRejectedValue(new Error('nope'));
    renderWithData(<DailySetCard />, { api });
    const group = await screen.findByRole('group', { name: 'How did Decode String go?' });
    await userEvent.click(within(group).getByRole('button', { name: /^Solo/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(await screen.findByRole('group', { name: 'How did Decode String go?' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /How did Decode String/ })).getByRole('button', { name: /^Solo/ })).toBeEnabled();
  });
  it('a failed rating write says so in the set card (I3)', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'rateSolve').mockRejectedValue(new Error('nope'));
    const { container } = renderWithData(<DailySetCard />, { api });
    const group = await screen.findByRole('group', { name: 'How did Decode String go?' });
    await userEvent.click(within(group).getByRole('button', { name: /^Solo/ }));
    expect(await screen.findByText("Couldn't save rating. Try again.")).toBeInTheDocument();
    expect(container.querySelector('[data-primary]')).toHaveTextContent("Couldn't save rating. Try again.");
  });
  it('a rating the worker beat says Already counted (I3/I4)', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'rateSolve').mockRejectedValue(new AlreadyCountedError());
    renderWithData(<DailySetCard />, { api });
    const group = await screen.findByRole('group', { name: 'How did Decode String go?' });
    await userEvent.click(within(group).getByRole('button', { name: /^Solo/ }));
    expect(await screen.findByText('Already counted.')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't save rating. Try again.")).toBeNull();
  });
});
