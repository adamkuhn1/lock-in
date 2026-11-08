import { readFileSync } from 'node:fs';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { planDay } from '../lib/time';
import { renderWithData } from '../test/render';
import LeetCode from './LeetCode';

describe('LeetCode', () => {
  it('draws all 18 topics on the map with level, lock and focus', async () => {
    const { container } = renderWithData(<LeetCode />);
    await screen.findByRole('button', { name: /^Stack,/ });
    expect(container.querySelectorAll('.map .node')).toHaveLength(18);
    expect(screen.getByRole('button', { name: /^Stack, Practicing, your focus, \d+% to Mastered$/ })).toHaveClass('is-focus');
    expect(screen.getByRole('button', { name: /^Arrays & Hashing, Mastered, 100% to Mastered$/ })).toHaveClass('lvl-mastered');
    expect(screen.getByRole('button', { name: /^Trees, Locked$/ })).toHaveClass('lvl-locked');
    expect(screen.getByText('1/18 mastered')).toBeInTheDocument();
  });
  it('levels come from solves, not the stored topic state', async () => {
    const api = createDemoApi();
    api.listTopicStates = async () => [];
    renderWithData(<LeetCode />, { api });
    expect(await screen.findByRole('button', { name: /^Two Pointers, Solid,/ })).toBeInTheDocument();
  });
  it('the focus topic is open by default with what it needs next', async () => {
    renderWithData(<LeetCode />);
    const panel = (await screen.findByRole('heading', { level: 3, name: 'Stack' })).closest('section') as HTMLElement;
    expect(within(panel).getByText(/To reach/)).toHaveTextContent('To reach Solid');
    expect(within(panel).getByText(/Solve 3 of your last 5 new Mediums on your own/)).toHaveTextContent(': 2 of 3');
    expect(within(panel).getByText('This is your focus. It stays until it\'s Mastered.')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Stacks' })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/neetcode\.io\/courses\//));
  });
  it('picking a topic shows its bars', async () => {
    renderWithData(<LeetCode />);
    await userEvent.click(await screen.findByRole('button', { name: /^Two Pointers,/ }));
    const panel = screen.getByRole('heading', { level: 3, name: 'Two Pointers' }).closest('section') as HTMLElement;
    expect(within(panel).getByText(/To reach/)).toHaveTextContent('To reach Mastered');
    expect(within(panel).getByText(/Clear every Easy \(9\)/)).toHaveTextContent(': 6 of 9');
    expect(within(panel).getByText(/Work through 2 Hards/)).toHaveTextContent(': 1 of 2');
  });
  it('Make focus sets the focus topic from today', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateSettings');
    renderWithData(<LeetCode />, { api });
    await userEvent.click(await screen.findByRole('button', { name: /^Binary Search, Learning/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Make focus' }));
    expect(spy).toHaveBeenCalledWith({ lc_focus_topic: 'Binary Search', lc_focus_since: planDay(new Date()) });
  });
  it('lists due reviews and the week ahead', async () => {
    renderWithData(<LeetCode />);
    const card = (await screen.findByRole('heading', { name: 'Reviews due' })).closest('section') as HTMLElement;
    expect(await within(card).findByRole('link', { name: 'Group Anagrams' })).toHaveAttribute('href', 'https://leetcode.com/problems/group-anagrams/');
    expect(within(card).getByRole('link', { name: '4Sum' })).toBeInTheDocument();
    expect(screen.getByText('3 more this week.')).toBeInTheDocument();
  });
  it('labels the heatmap for screen readers', async () => {
    renderWithData(<LeetCode />);
    expect(await screen.findByRole('img', { name: /solves in the last 26 weeks/ })).toBeInTheDocument();
  });
  it('shows the level word on each topic, not just color', async () => {
    renderWithData(<LeetCode />);
    const b = await screen.findByRole('button', { name: /^Sliding Window,/ });
    expect(b).toHaveTextContent('Sliding WindowReady');
  });
  it('undo restores the previous focus', async () => {
    const api = createDemoApi();
    const before = await api.getSettings();
    const spy = vi.spyOn(api, 'updateSettings');
    renderWithData(<LeetCode />, { api });
    await userEvent.click(await screen.findByRole('button', { name: /^Binary Search, Learning/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Make focus' }));
    expect(await screen.findByText(/Focus: Binary Search\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(spy).toHaveBeenLastCalledWith({ lc_focus_topic: before.lc_focus_topic, lc_focus_since: before.lc_focus_since });
  });
  it('shows an error when the focus change fails', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'updateSettings').mockRejectedValue(new Error('x'));
    renderWithData(<LeetCode />, { api });
    await userEvent.click(await screen.findByRole('button', { name: /^Binary Search, Learning/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Make focus' }));
    expect(await screen.findByText("Couldn't change focus. Try again.")).toBeInTheDocument();
  });
  it('daily count failure has its own message', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'updateSettings').mockRejectedValue(new Error('x'));
    renderWithData(<LeetCode />, { api });
    await userEvent.click(await screen.findByText('Daily count'));
    await userEvent.click(screen.getByRole('button', { name: /increase|more|\+/i }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't change focus/)).not.toBeInTheDocument();
  });
  it('no Make focus for a mastered topic, but a Solid one can be picked (M6)', async () => {
    renderWithData(<LeetCode />);
    await userEvent.click(await screen.findByRole('button', { name: /^Arrays & Hashing, Mastered/ }));
    expect(screen.queryByRole('button', { name: 'Make focus' })).toBeNull();
    expect(screen.getByText('Mastered. Mystery problems keep checking it.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Two Pointers, Solid/ }));
    expect(screen.getByRole('button', { name: 'Make focus' })).toBeInTheDocument();
  });
  it('the daily count stepper is disabled while its save is pending (M9)', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'updateSettings').mockImplementation(() => new Promise(() => {}));
    renderWithData(<LeetCode />, { api });
    await userEvent.click(await screen.findByText('Daily count'));
    const more = screen.getByRole('button', { name: 'More: Problems per day' });
    expect(more).toBeEnabled();
    await userEvent.click(more);
    await waitFor(() => expect(more).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Fewer: Problems per day' })).toBeDisabled();
    expect(screen.getByText("Applies from tomorrow's set.")).toBeInTheDocument();
  });
  it('recent solves: an applied unrated solve shows what it counted as (M13)', async () => {
    const api = createDemoApi();
    const S = (id: number, over: object) => ({ id, slug: `s${id}`, title: `Solve ${id}`, accepted_at: new Date().toISOString(),
      rating: null, rated_at: null, applied_at: null, slot: null, note: null, ...over });
    api.listSolves = async () => [S(1, { title: 'Auto one', applied_at: '2026-10-01T00:00:00Z' }), S(2, { title: 'Pending one' })];
    renderWithData(<LeetCode />, { api });
    await userEvent.click(await screen.findByText('Recent solves'));
    const auto = (await screen.findByText('Auto one')).closest('li') as HTMLElement;
    expect(auto).toHaveTextContent('Explained (not rated)');
    expect((screen.getByText('Pending one').closest('li') as HTMLElement)).toHaveTextContent('Not rated yet');
  });
  it('external links go through ExternalLink, not a raw <a> (M14)', () => {
    const src = readFileSync(`${process.cwd()}/src/screens/LeetCode.tsx`, 'utf8');
    expect(src).not.toMatch(/<a\s/);
  });
});
