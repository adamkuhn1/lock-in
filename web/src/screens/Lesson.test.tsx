import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import type { LessonFiles } from '../lib/lessons';
import type { GradeResult } from '../lib/python';
import { planDay } from '../lib/time';
import { renderWithData } from '../test/render';
import Lesson from './Lesson';

const run = vi.fn<(code: string, tests: string, prelude: string) => Promise<GradeResult>>();
vi.mock('../lib/python', () => ({
  RUN_LIMIT_MS: 5000,
  getRunner: () => ({ state: () => 'ready', warm: () => Promise.resolve(), run, subscribe: () => () => {} }),
}));

// A fixed lesson, so these tests don't move when the real content is edited. (Title and minutes still come from
// the real lesson list; the screen only needs the files.)
const FILES: LessonFiles = {
  meta: {
    title: 'Bits', minutes: 10, task: 'Write `to_binary(n, width)`.',
    hints: ['Think about remainders.', 'Pad on the left.', 'Insert `n % 2` at the front.'],
    quiz: [
      { q: 'What is `101` in decimal?', options: [
        { text: '3', correct: false, why: 'That would be `11`.' }, { text: '5', correct: true, why: '4 + 1 = 5.' }] },
      { q: 'Largest 4-bit number?', answer: ['15'], why: '2⁴ − 1 = 15.' },
    ],
    review: [{ q: 'r', answer: ['1'], why: 'w' }, { q: 's', answer: ['2'], why: 'w' }],
  },
  md: '## Place value\n\nEach place is worth 2× the next.\n\n<!-- check 1 -->\n\n## Width\n\n| bits | max |\n|---|---|\n| 4 | 15 |\n\n<!-- check 2 -->\n\nThat is all.',
  starter: 'def to_binary(n, width):\n    return []\n', solution: 'def to_binary(n, width):\n    raise ValueError("SOLUTION")\n',
  tests: 'def test_a():\n    pass\n', prelude: '',
};
vi.mock('../lib/lessons', async (orig) => ({ ...(await orig<typeof import('../lib/lessons')>()), loadLessonFiles: () => Promise.resolve(FILES) }));

const FAIL: GradeResult = { passed: false, stdout: 'debug line\n', error: null, tests: [
  { name: 'to_binary handles small numbers', ok: false, message: 'to_binary(13, 4) returned [], expected [1, 1, 0, 1]' },
  { name: 'Builds the bits by hand', ok: true, message: '' }] };
const PASS: GradeResult = { passed: true, stdout: '', error: null, tests: [
  { name: 'to_binary handles small numbers', ok: true, message: '' }, { name: 'Builds the bits by hand', ok: true, message: '' }] };

const tree = <Routes><Route path="/grind/learn/:track/:module/:lesson" element={<Lesson />} /></Routes>;
/** A demo account that hasn't touched lesson 1 yet. */
function fresh() {
  const api = createDemoApi();
  vi.spyOn(api, 'listLearnProgress').mockResolvedValue([]);
  return api;
}
const open = (api = fresh()) => renderWithData(tree, { api, route: '/grind/learn/cs/cs-1/01-binary' });

beforeEach(() => { run.mockReset(); localStorage.clear(); });

describe('Lesson', () => {
  it('shows the reading with its quick checks in place, and the exercise', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Bits: counting with two digits' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Place value' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    const checks = screen.getAllByRole('region', { name: /^Quick check \d$/ });
    expect(checks).toHaveLength(2);
    // check 1 sits between the two sections, check 2 after the second
    const width = screen.getByRole('heading', { name: 'Width' });
    expect(checks[0].compareDocumentPosition(width) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(checks[1].compareDocumentPosition(width) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Your code for Bits: counting with two digits' })).toHaveTextContent('def to_binary(n, width):');
  });

  it('multiple choice explains every answer; recall takes a typed answer', async () => {
    open();
    const mc = within(await screen.findByRole('region', { name: 'Quick check 1' }));
    await userEvent.click(mc.getByRole('button', { name: '3' }));
    expect(mc.getByRole('status')).toHaveTextContent(/^Not quite\. That would be 11\. Try another\.$/);
    await userEvent.click(mc.getByRole('button', { name: '5' }));
    expect(mc.getByRole('status')).toHaveTextContent('Right. 4 + 1 = 5.');

    const rc = within(screen.getByRole('region', { name: 'Quick check 2' }));
    await userEvent.type(rc.getByRole('textbox', { name: 'Your answer' }), '16{Enter}');
    expect(rc.getByRole('status')).toHaveTextContent('Not quite. Try again, or show the answer.');
    await userEvent.clear(rc.getByRole('textbox', { name: 'Your answer' }));
    await userEvent.type(rc.getByRole('textbox', { name: 'Your answer' }), ' 15 ');
    await userEvent.click(rc.getByRole('button', { name: 'Check' }));
    expect(rc.getByRole('status')).toHaveTextContent('Right. 2⁴ − 1 = 15.');
  });

  it('a failing run shows each test, starts the lesson, and a pass finishes it as nailed', async () => {
    const api = fresh();
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
    expect(run).toHaveBeenCalledWith(FILES.starter, FILES.tests, '');

    run.mockResolvedValueOnce(PASS);
    await userEvent.click(runBtn);
    expect(await screen.findByText('All 2 tests pass')).toBeInTheDocument();
    expect(save).toHaveBeenLastCalledWith('lesson:cs-1/01-binary', { status: 'done', started_on: today, done_on: today, rating: 'nailed' });
    expect(screen.getAllByRole('link', { name: 'Next lesson' })[0]).toHaveAttribute('href', expect.stringMatching(/^\/grind\/learn\/cs\/cs-1\/02-/));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('hints come one at a time, and a pass after one is struggled', async () => {
    const api = fresh();
    const save = vi.spyOn(api, 'saveLearnProgress');
    open(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Show a hint (3 left)' }));
    expect(screen.getByText('Think about remainders.')).toBeInTheDocument();
    expect(screen.queryByText('Pad on the left.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next hint (2 left)' })).toBeInTheDocument();
    run.mockResolvedValueOnce(PASS);
    await userEvent.click(screen.getByRole('button', { name: 'Run tests' }));
    await screen.findByText('All 2 tests pass');
    expect(save).toHaveBeenLastCalledWith('lesson:cs-1/01-binary', expect.objectContaining({ status: 'done', rating: 'struggled' }));
  });

  it('the solution asks first, and counts as needed help', async () => {
    const api = fresh();
    const save = vi.spyOn(api, 'saveLearnProgress');
    open(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Show solution' }));
    await userEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    expect(screen.queryByText('Solution')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show solution' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, show it' }));
    expect(screen.getByText('Solution').closest('div')!.querySelector('pre')!.textContent).toContain('SOLUTION');
    run.mockResolvedValueOnce(PASS);
    await userEvent.click(screen.getByRole('button', { name: 'Run tests' }));
    await screen.findByText('All 2 tests pass');
    expect(save).toHaveBeenLastCalledWith('lesson:cs-1/01-binary', expect.objectContaining({ rating: 'help' }));
  });

  it('Ask Claude sends the code to the Mac, and a pass after it is struggled', async () => {
    const api = fresh();
    const launch = vi.spyOn(api, 'requestLaunch');
    const save = vi.spyOn(api, 'saveLearnProgress');
    open(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Ask Claude' }));
    expect(launch).toHaveBeenCalledWith('teach_item', { item_id: 'lesson:cs-1/01-binary', code: FILES.starter, hints_seen: 0 });
    expect(await screen.findByRole('button', { name: 'Queued for Mac' })).toBeDisabled();
    run.mockResolvedValueOnce(PASS);
    await userEvent.click(screen.getByRole('button', { name: 'Run tests' }));
    await screen.findByText('All 2 tests pass');
    expect(save).toHaveBeenLastCalledWith('lesson:cs-1/01-binary', expect.objectContaining({ rating: 'struggled' }));
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
