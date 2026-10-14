import { readFileSync } from 'node:fs';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { planDay } from '../lib/time';
import { renderWithData } from '../test/render';
import LeetCode from './LeetCode';

describe('LeetCode', () => {
  it('shows all 18 topics with level, lock and focus', async () => {
    const { container } = renderWithData(<LeetCode />);
    await screen.findByRole('button', { name: /Sliding Window/ });
    expect(container.querySelectorAll('.roadmap .topic')).toHaveLength(18);
    expect(screen.getByRole('button', { name: /Sliding Window.*Focus.*Learning/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Trees, Locked$/ })).toHaveClass('lvl-locked');
    expect(container.querySelector('[data-primary]')).toHaveTextContent('Roadmap');
  });
  it('Make focus sets the focus topic from today', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateSettings');
    renderWithData(<LeetCode />, { api });
    await userEvent.click(await screen.findByRole('button', { name: /^Binary Search, Ready$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Make focus' }));
    expect(spy).toHaveBeenCalledWith({ lc_focus_topic: 'Binary Search', lc_focus_since: planDay(new Date()) });
  });
  it('lists due reviews and the week ahead', async () => {
    renderWithData(<LeetCode />);
    expect(await screen.findByRole('link', { name: 'Valid Anagram' })).toHaveAttribute('href', 'https://leetcode.com/problems/valid-anagram/');
    expect(screen.getByRole('link', { name: 'Group Anagrams' })).toBeInTheDocument();
    expect(screen.getByText('3 more this week.')).toBeInTheDocument();
  });
  it('labels the heatmap for screen readers', async () => {
    renderWithData(<LeetCode />);
    expect(await screen.findByRole('img', { name: /solves in the last 26 weeks/ })).toBeInTheDocument();
  });
  it('shows the level word, not just color', async () => {
    renderWithData(<LeetCode />);
    const b = await screen.findByRole('button', { name: /Sliding Window/ });
    // The caption is drawn from data-sub (CSS ::after) so the button's text stays the topic name.
    expect(b).toHaveAttribute('data-sub', 'Learning · Focus');
    expect(b).toHaveTextContent(/^Sliding Window$/);
  });
  it('undo restores the previous focus', async () => {
    const api = createDemoApi();
    const before = await api.getSettings();
    const spy = vi.spyOn(api, 'updateSettings');
    renderWithData(<LeetCode />, { api });
    await userEvent.click(await screen.findByRole('button', { name: /^Binary Search, Ready$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Make focus' }));
    expect(await screen.findByText(/Focus: Binary Search\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(spy).toHaveBeenLastCalledWith({ lc_focus_topic: before.lc_focus_topic, lc_focus_since: before.lc_focus_since });
  });
  it('shows an error when the focus change fails', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'updateSettings').mockRejectedValue(new Error('x'));
    renderWithData(<LeetCode />, { api });
    await userEvent.click(await screen.findByRole('button', { name: /^Binary Search, Ready$/ }));
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
  it('no Make focus for a solid or mastered topic (M6)', async () => {
    renderWithData(<LeetCode />);
    await userEvent.click(await screen.findByRole('button', { name: /^Arrays & Hashing, Solid$/ }));
    expect(screen.queryByRole('button', { name: 'Make focus' })).toBeNull();
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
  it('recent solves: an applied unrated solve shows the auto rating (M13)', async () => {
    const api = createDemoApi();
    const S = (id: number, over: object) => ({ id, slug: `s${id}`, title: `Solve ${id}`, accepted_at: new Date().toISOString(),
      rating: null, rated_at: null, applied_at: null, slot: null, note: null, ...over });
    api.listSolves = async () => [S(1, { title: 'Auto one', applied_at: '2026-10-01T00:00:00Z' }), S(2, { title: 'Pending one' })];
    renderWithData(<LeetCode />, { api });
    await userEvent.click(await screen.findByText('Recent solves'));
    const auto = (await screen.findByText('Auto one')).closest('li') as HTMLElement;
    expect(within(auto).getByText(/🟡 \(auto\)/)).toBeInTheDocument();
    expect(auto).not.toHaveTextContent('Unrated');
    expect((screen.getByText('Pending one').closest('li') as HTMLElement)).toHaveTextContent('Unrated');
  });
  it('external links go through ExternalLink, not a raw <a> (M14)', () => {
    const src = readFileSync(`${process.cwd()}/src/screens/LeetCode.tsx`, 'utf8');
    expect(src).not.toMatch(/<a\s/);
  });
});
