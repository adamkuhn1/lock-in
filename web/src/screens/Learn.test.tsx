import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { planDay } from '../lib/time';
import { renderWithData } from '../test/render';
import Learn from './Learn';
import { TodayLearning } from './TodayLearning';

const tree = <Routes><Route path="/grind/learn/:track" element={<Learn />} /></Routes>;
const at = (track: string, api = createDemoApi()) => renderWithData(tree, { api, route: `/grind/learn/${track}` });

describe('Learn', () => {
  it('shows the roadmap with every module open, and the module in progress', async () => {
    at('cs');
    expect(await screen.findByRole('heading', { level: 1, name: 'CS' })).toBeInTheDocument();
    const map = within(await screen.findByRole('region', { name: 'Roadmap' }));
    const buttons = map.getAllByRole('button');
    expect(buttons[0]).toHaveAccessibleName(/^1\. How computers work, In progress, 0 of \d+ done$/);
    expect(buttons.every((b) => !b.hasAttribute('disabled'))).toBe(true);
    const detail = within(screen.getByRole('region', { name: /^1\. How computers work/ }));
    const lessons = within(detail.getByRole('region', { name: /^Lessons · 0 of \d+ done$/ }));
    expect(lessons.getByRole('link', { name: 'Start: lesson 1, Bits: counting with two digits' })).toHaveAttribute('href', '/grind/learn/cs/cs-1/01-binary');
    expect(detail.getByText('Go deeper: videos and projects (optional)')).toBeInTheDocument();
    for (const g of ['Watch', 'Do', 'Build', 'Check']) expect(detail.getByRole('region', { name: g })).toBeInTheDocument();
  });
  it('changing status and rating saves progress', async () => {
    const { api } = at('cs');
    const spy = vi.spyOn(api, 'saveLearnProgress');
    const build = within(await screen.findByRole('region', { name: 'Build' }));
    await userEvent.click(build.getAllByRole('button', { name: 'In progress' })[0]);
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/^cs-1-b/), expect.objectContaining({ status: 'in_progress', started_on: planDay(new Date()), done_on: null }));
    const watch = within(screen.getByRole('region', { name: 'Watch' }));
    await userEvent.click(watch.getAllByRole('button', { name: /Struggled/ })[0]);
    expect(spy).toHaveBeenLastCalledWith(expect.stringMatching(/^cs-1-w/), { rating: 'struggled' });
  });
  it('Teach me, Check me and Mark module done', async () => {
    const { api } = at('cs');
    const launch = vi.spyOn(api, 'requestLaunch');
    const done = vi.spyOn(api, 'setModuleDone');
    const watch = within(await screen.findByRole('region', { name: 'Watch' }));
    await userEvent.click(watch.getAllByRole('button', { name: /^Teach me: / })[0]);
    expect(launch).toHaveBeenCalledWith('teach_item', { item_id: expect.stringMatching(/^cs-1-w/) });
    await userEvent.click(screen.getByRole('button', { name: 'Check me: How computers work' }));
    expect(launch).toHaveBeenCalledWith('check_module', { module_id: 'cs-1' });
    await userEvent.click(screen.getByRole('button', { name: 'Mark done: How computers work' }));
    expect(done).toHaveBeenCalledWith('cs-1', planDay(new Date()));
  });
  it('a finished module whose review is due offers Review first', async () => {
    const { api } = at('math');
    const launch = vi.spyOn(api, 'requestLaunch');
    await userEvent.click(await screen.findByRole('button', { name: /^Review: / }));
    expect(launch).toHaveBeenCalledWith('review_module', { module_id: 'math-1' });
    expect(screen.getByText(/Checks and reviews \(1\)/)).toBeInTheDocument();
  });
});

describe('TodayLearning', () => {
  it('splits the day 70/30 and suggests the due review first', async () => {
    const api = createDemoApi();
    const launch = vi.spyOn(api, 'requestLaunch');
    renderWithData(<TodayLearning lcDone={2} lcTotal={6} />, { api });
    expect(await screen.findByRole('img', { name: 'Interview prep 70%, learning 30%' })).toBeInTheDocument();
    expect(screen.getByText('Interview prep · 2 h 6 min')).toBeInTheDocument();
    expect(screen.getByText('Learning · 54 min')).toBeInTheDocument();
    expect(screen.getByText('LeetCode 2/6 · do this first')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Start review' }));
    expect(launch).toHaveBeenCalledWith('review_module', { module_id: 'math-1' });
  });
  it('without a review, suggests the next lesson of the module in progress', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'listLearnModuleStates').mockResolvedValue([]);
    const doItem = (await api.listLearnItems()).find((i) => i.module_id === 'cs-1' && i.type === 'do')!;
    vi.spyOn(api, 'listLearnProgress').mockResolvedValue([
      { item_id: doItem.id, status: 'in_progress', rating: null, notes: '', started_on: '2026-10-01', done_on: null }]);
    renderWithData(<TodayLearning lcDone={6} lcTotal={6} />, { api });
    expect(await screen.findByRole('link', { name: 'Start lesson' })).toHaveAttribute('href', '/grind/learn/cs/cs-1/01-binary');
    expect(screen.getByText(/^Lesson 1:/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CS track' })).toHaveAttribute('href', '/grind/learn/cs?module=cs-1');
  });
  it('an item in progress in a module without lessons gets Teach me', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'listLearnModuleStates').mockResolvedValue([]);
    const items = await api.listLearnItems();
    const watch = items.find((i) => i.module_id === 'math-2' && i.type === 'watch')!;
    vi.spyOn(api, 'listLearnProgress').mockResolvedValue([
      { item_id: watch.id, status: 'in_progress', rating: null, notes: '', started_on: '2026-10-01', done_on: null }]);
    const launch = vi.spyOn(api, 'requestLaunch');
    renderWithData(<TodayLearning lcDone={6} lcTotal={6} />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Teach me' }));
    expect(launch).toHaveBeenCalledWith('teach_item', { item_id: watch.id });
  });
});
