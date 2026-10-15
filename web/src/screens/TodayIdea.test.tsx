import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import type { DataApi } from '../data/api';
import type { Idea } from '../data/types';
import { renderWithData } from '../test/render';
import { TodayIdeaCard } from './TodayIdea';

describe('TodayIdeaCard', () => {
  it("shows today's idea and marks it done", async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateIdea');
    renderWithData(<TodayIdeaCard />, { api });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Add Chicago to the city picker' }));
    expect(spy).toHaveBeenCalledWith('i1', expect.objectContaining({ status: 'done' }));
  });

  const withIdea = (api: DataApi, patch: Partial<Idea>) => {
    const list = api.listIdeas.bind(api);
    vi.spyOn(api, 'listIdeas').mockImplementation(async () => (await list()).map((i) => (i.id === 'i1' ? { ...i, ...patch } : i)));
  };

  it('keeps an in-progress idea on the card, with no Swap and no done-by-commit', async () => {
    const api = createDemoApi();
    withIdea(api, { status: 'in_progress', started_at: new Date().toISOString() });
    // A commit earlier today (before Work on this) must not show the idea as done.
    vi.spyOn(api, 'listCommits').mockResolvedValue([{ sha: 'early', project_id: '27b', message: 'm', committed_at: new Date(Date.now() - 60_000).toISOString() }]);
    const spy = vi.spyOn(api, 'updateIdea');
    renderWithData(<TodayIdeaCard />, { api });
    const box = await screen.findByRole('checkbox', { name: 'Add Chicago to the city picker' });
    expect(box).not.toBeChecked();
    expect(box).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Swap/ })).toBeNull();
    expect(screen.queryByText("Done by today's commit.")).toBeNull();
    await userEvent.click(box);
    expect(spy).toHaveBeenCalledWith('i1', expect.objectContaining({ status: 'done' }));
  });

  it("undo puts a done idea back as today's idea", async () => {
    const api = createDemoApi();
    withIdea(api, { status: 'done', done_at: new Date().toISOString() });
    vi.spyOn(api, 'listCommits').mockResolvedValue([]);
    const spy = vi.spyOn(api, 'updateIdea');
    renderWithData(<TodayIdeaCard />, { api });
    const box = await screen.findByRole('checkbox', { name: 'Add Chicago to the city picker' });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(spy).toHaveBeenCalledWith('i1', { status: 'today', done_at: null });
  });

  it('undo restores in_progress when the idea had been started', async () => {
    const api = createDemoApi();
    const startedAt = new Date().toISOString();
    // Stateful stand-in for the server: updateIdea patches i1, listIdeas reflects it.
    let current: Partial<Idea> = { status: 'in_progress', started_at: startedAt };
    const list = api.listIdeas.bind(api);
    vi.spyOn(api, 'listIdeas').mockImplementation(async () => (await list()).map((i) => (i.id === 'i1' ? { ...i, ...current } : i)));
    const spy = vi.spyOn(api, 'updateIdea').mockImplementation(async (_id, patch) => {
      current = { ...current, ...patch };
    });
    vi.spyOn(api, 'listCommits').mockResolvedValue([]);
    renderWithData(<TodayIdeaCard />, { api });
    const name = 'Add Chicago to the city picker';
    await userEvent.click(await screen.findByRole('checkbox', { name }));
    expect(spy).toHaveBeenLastCalledWith('i1', expect.objectContaining({ status: 'done' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name })).toBeChecked());
    await userEvent.click(screen.getByRole('checkbox', { name }));
    expect(spy).toHaveBeenLastCalledWith('i1', { status: 'in_progress', done_at: null });
  });
});
