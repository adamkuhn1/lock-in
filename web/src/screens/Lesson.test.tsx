import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import type { GradeResult } from '../lib/python';
import { planDay } from '../lib/time';
import { renderWithData } from '../test/render';
import Lesson from './Lesson';

const run = vi.fn<(code: string, tests: string, prelude: string) => Promise<GradeResult>>();
vi.mock('../lib/python', () => ({
  RUN_LIMIT_MS: 5000,
  getRunner: () => ({ state: () => 'ready', warm: () => Promise.resolve(), run, subscribe: () => () => {} }),
}));

const FAIL: GradeResult = { passed: false, stdout: 'debug line\n', error: null, tests: [
  { name: 'to_binary handles small numbers', ok: false, message: 'to_binary(13, 4) returned [], expected [1, 1, 0, 1]' },
  { name: 'Builds the bits by hand', ok: true, message: '' }] };
const PASS: GradeResult = { passed: true, stdout: '', error: null, tests: [
  { name: 'to_binary handles small numbers', ok: true, message: '' }, { name: 'Builds the bits by hand', ok: true, message: '' }] };

const tree = <Routes><Route path="/grind/learn/:track/:module/:lesson" element={<Lesson />} /></Routes>;
const open = (api = createDemoApi()) => renderWithData(tree, { api, route: '/grind/learn/cs/cs-1/01-binary' });

beforeEach(() => { run.mockReset(); localStorage.clear(); });

describe('Lesson', () => {
  it('shows the reading, the quiz and the exercise', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Bits: counting with two digits' })).toBeInTheDocument();
    expect(screen.getByText(/Lesson 1 of \d+ · 10 min/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Place value, in base 2' })).toBeInTheDocument();
    expect(screen.getAllByRole('table').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('textbox', { name: 'Your code for Bits: counting with two digits' })).toHaveTextContent('def to_binary(n, width):');
  });

  it('quiz answers explain themselves', async () => {
    open();
    const q = within((await screen.findAllByRole('group'))[0]);
    await userEvent.click(q.getByRole('button', { name: '13' }));
    expect(q.getByRole('status')).toHaveTextContent(/^Not quite\..*Try another\.$/);
    await userEvent.click(q.getByRole('button', { name: '22' }));
    expect(q.getByRole('status')).toHaveTextContent(/^Right\. 16 \+ 4 \+ 2 = 22/);
  });

  it('a failing run shows each test, starts the lesson, and a pass finishes it as nailed', async () => {
    const api = createDemoApi();
    const save = vi.spyOn(api, 'saveLearnProgress');
    open(api);
    const runBtn = await screen.findByRole('button', { name: 'Run tests' });
    run.mockResolvedValueOnce(FAIL);
    await userEvent.click(runBtn);
    expect(await screen.findByText('1 of 2 tests pass')).toBeInTheDocument();
    expect(screen.getByText('to_binary(13, 4) returned [], expected [1, 1, 0, 1]')).toBeInTheDocument();
    expect(screen.getByText('debug line')).toBeInTheDocument();
    const today = planDay(new Date());
    expect(save).toHaveBeenCalledWith('lesson:cs-1/01-binary', { status: 'in_progress', started_on: today });
    expect(run.mock.calls[0][0]).toContain('def to_binary');
    expect(run.mock.calls[0][1]).toContain('def test_');

    run.mockResolvedValueOnce(PASS);
    await userEvent.click(runBtn);
    expect(await screen.findByText('All 2 tests pass')).toBeInTheDocument();
    expect(save).toHaveBeenLastCalledWith('lesson:cs-1/01-binary', { status: 'done', started_on: today, done_on: today, rating: 'nailed' });
    expect(screen.getAllByRole('link', { name: 'Next lesson' })[0]).toHaveAttribute('href', expect.stringMatching(/^\/grind\/learn\/cs\/cs-1\/02-/));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('hints come one at a time, and a pass after one is struggled', async () => {
    const api = createDemoApi();
    const save = vi.spyOn(api, 'saveLearnProgress');
    open(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Show a hint (3 left)' }));
    expect(screen.getByText(/the loop from the lesson gives you bits right to left/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next hint (2 left)' })).toBeInTheDocument();
    run.mockResolvedValueOnce(PASS);
    await userEvent.click(screen.getByRole('button', { name: 'Run tests' }));
    await screen.findByText('All 2 tests pass');
    expect(save).toHaveBeenLastCalledWith('lesson:cs-1/01-binary', expect.objectContaining({ status: 'done', rating: 'struggled' }));
  });

  it('the solution asks first, and counts as needed help', async () => {
    const api = createDemoApi();
    const save = vi.spyOn(api, 'saveLearnProgress');
    open(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Show solution' }));
    await userEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    expect(screen.queryByText('Solution')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show solution' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, show it' }));
    expect(screen.getByText('Solution')).toBeInTheDocument();
    expect(screen.getByText('Solution').closest('div')!.querySelector('pre')!.textContent).toContain('raise ValueError');
    run.mockResolvedValueOnce(PASS);
    await userEvent.click(screen.getByRole('button', { name: 'Run tests' }));
    await screen.findByText('All 2 tests pass');
    expect(save).toHaveBeenLastCalledWith('lesson:cs-1/01-binary', expect.objectContaining({ rating: 'help' }));
  });

  it('a crash or a runner failure shows the error', async () => {
    open();
    run.mockResolvedValueOnce({ passed: false, tests: [], stdout: '', error: 'SyntaxError: invalid syntax (your code, line 3)' });
    await userEvent.click(await screen.findByRole('button', { name: 'Run tests' }));
    expect(await screen.findByText('SyntaxError: invalid syntax (your code, line 3)')).toBeInTheDocument();
    run.mockRejectedValueOnce(new Error('Python failed to load: offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Run tests' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Python failed to load: offline');
  });

  it('an unknown lesson links back to the track', async () => {
    renderWithData(tree, { route: '/grind/learn/cs/cs-1/99-nope' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Lesson not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the track' })).toHaveAttribute('href', '/grind/learn/cs');
  });
});
