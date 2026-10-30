import { afterEach, describe, expect, it, vi } from 'vitest';
import { RUN_LIMIT_MS, createRunner, type GradeResult } from './python';

const PASS: GradeResult = { passed: true, tests: [{ name: 'a', ok: true, message: '' }], stdout: '', error: null };

/** A stand-in for the Pyodide worker: answers init and run the way pyWorker.ts does. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  constructor(private behave: { load?: 'ok' | 'fail' | 'hang'; run?: 'ok' | 'hang' } = {}) {}
  postMessage(m: { type: string; id?: number }) {
    this.posted.push(m);
    const reply = (data: unknown) => queueMicrotask(() => this.onmessage?.({ data } as MessageEvent));
    if (m.type === 'init') {
      if (this.behave.load === 'fail') reply({ type: 'load-error', error: 'Python failed to load: offline' });
      else if (this.behave.load !== 'hang') reply({ type: 'ready' });
    } else if (m.type === 'run' && this.behave.run !== 'hang') {
      reply({ type: 'result', id: m.id, result: PASS });
    }
  }
  terminate() { this.terminated = true; }
}

afterEach(() => vi.useRealTimers());

describe('python runner', () => {
  it('loads once, sends the harness, and grades', async () => {
    const workers: FakeWorker[] = [];
    const r = createRunner(() => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker; });
    const states: string[] = [];
    r.subscribe((s) => states.push(s));
    expect(await r.run('code', 'tests', '')).toEqual(PASS);
    expect(await r.run('code', 'tests', '')).toEqual(PASS);
    expect(workers).toHaveLength(1);
    expect(workers[0].posted[0]).toMatchObject({ type: 'init', harness: expect.stringContaining('def grade(') });
    expect(workers[0].posted[1]).toEqual({ type: 'run', id: 1, code: 'code', tests: 'tests', prelude: '' });
    expect(states).toEqual(['loading', 'ready']);
  });

  it('stops a run that never finishes and starts fresh next time', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const r = createRunner(() => { const w = new FakeWorker({ run: workers.length ? 'ok' : 'hang' }); workers.push(w); return w as unknown as Worker; });
    const first = r.run('while True: pass', 't', '');
    await vi.advanceTimersByTimeAsync(RUN_LIMIT_MS + 10);
    expect((await first).error).toMatch(/^Stopped after 5 seconds/);
    expect(workers[0].terminated).toBe(true);
    const second = r.run('ok', 't', '');
    await vi.advanceTimersByTimeAsync(0);
    expect(await second).toEqual(PASS);
    expect(workers).toHaveLength(2);
  });

  it('reports a load failure and tries again on the next run', async () => {
    const workers: FakeWorker[] = [];
    const r = createRunner(() => { const w = new FakeWorker({ load: workers.length ? 'ok' : 'fail' }); workers.push(w); return w as unknown as Worker; });
    await expect(r.run('x', 't', '')).rejects.toThrow('offline');
    expect(r.state()).toBe('failed');
    expect(await r.run('x', 't', '')).toEqual(PASS);
    expect(r.state()).toBe('ready');
  });

  it('warm() never throws', async () => {
    const r = createRunner(() => new FakeWorker({ load: 'fail' }) as unknown as Worker);
    await expect(r.warm()).resolves.toBeUndefined();
  });
});
