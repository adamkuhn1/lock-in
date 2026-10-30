import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import type { LessonMeta } from '../lib/lessons';
import { planDay } from '../lib/time';
import { renderWithData } from '../test/render';
import LessonReview from './LessonReview';

const META = (n: number): LessonMeta => ({
  title: `L${n}`, minutes: 10, task: 't', hints: ['h'], quiz: [],
  review: [
    { q: `L${n} first: 2 + 2?`, answer: ['4'], why: 'Arithmetic.' },
    { q: `L${n} second: pick B`, options: [{ text: 'A', correct: false, why: 'No.' }, { text: 'B', correct: true, why: 'Yes.' }] },
    { q: `L${n} third`, answer: ['x'], why: 'w' },
  ],
});
vi.mock('../lib/lessons', async (orig) => ({
  ...(await orig<typeof import('../lib/lessons')>()),
  loadLessonMeta: (l: { ord: number }) => Promise.resolve(META(l.ord)),
}));

const tree = <Routes><Route path="/grind/review" element={<LessonReview />} /></Routes>;

describe('LessonReview', () => {
  it('asks two questions per due lesson and saves a score for each lesson', async () => {
    // The demo has lessons 1 and 2 of CS 1 finished 4 and 3 days ago: both due.
    const api = createDemoApi();
    const add = vi.spyOn(api, 'addLearnCheck');
    renderWithData(tree, { api, route: '/grind/review' });
    expect(await screen.findByText('L1 first: 2 + 2?')).toBeInTheDocument();
    expect(screen.getByText(/^1\/4 · about \d+ min$/)).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Next question' });
    expect(next).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox', { name: 'Your answer' }), '4{Enter}');
    await userEvent.click(next);
    await userEvent.click(screen.getByRole('button', { name: 'A' }));   // wrong first try
    await userEvent.click(screen.getByRole('button', { name: 'B' }));
    const today = planDay(new Date());
    expect(add).toHaveBeenCalledWith({ module_id: 'lesson:cs-1/01-binary', kind: 'review', score: 1, total: 2, rating: 'struggled', summary: '', taken_on: today });
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }));

    expect(screen.getByText('L2 first: 2 + 2?')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Your answer' }), '4{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }));
    await userEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(add).toHaveBeenLastCalledWith(expect.objectContaining({ module_id: 'lesson:cs-1/02-nand', score: 2, total: 2, rating: 'nailed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));

    expect(screen.getByRole('heading', { name: 'Done: 3 of 4 right' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Today' })).toHaveAttribute('href', '/');
  });

  it('says when the next review is, when nothing is due', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'listLearnChecks').mockResolvedValue([]);
    vi.spyOn(api, 'listLearnProgress').mockResolvedValue([
      { item_id: 'lesson:cs-1/01-binary', status: 'done', rating: 'nailed', notes: '', started_on: planDay(new Date()), done_on: planDay(new Date()) }]);
    renderWithData(tree, { api, route: '/grind/review' });
    expect(await screen.findByText(/^Nothing to review today\. The next one is /)).toBeInTheDocument();
  });
});
