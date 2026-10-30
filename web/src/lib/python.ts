/**
 * Runs lesson code in Python (Pyodide) on a Web Worker, so a slow or looping program never freezes the page.
 * One worker is kept warm across lessons. A run that goes past the time limit is stopped by killing the worker;
 * the next run starts a fresh one.
 */
import harness from '../../../shared/lessons/harness.py?raw';

export interface TestResult { name: string; ok: boolean; message: string }
export interface GradeResult { passed: boolean; tests: TestResult[]; stdout: string; error: string | null }
export type RunnerState = 'idle' | 'loading' | 'ready' | 'failed';

export const RUN_LIMIT_MS = 5000;
const LOAD_LIMIT_MS = 60_000;

type Pending = { resolve: (r: GradeResult) => void; reject: (e: Error) => void };

export interface Runner {
  state(): RunnerState;
  /** Start loading Python now, so the first Run is quick. */
  warm(): Promise<void>;
  run(code: string, tests: string, prelude: string): Promise<GradeResult>;
  subscribe(fn: (s: RunnerState) => void): () => void;
}

export function createRunner(makeWorker: () => Worker = () => new Worker(new URL('./pyWorker.ts', import.meta.url), { type: 'module' })): Runner {
  let worker: Worker | null = null;
  let ready: Promise<void> | null = null;
  let state: RunnerState = 'idle';
  let seq = 0;
  const pending = new Map<number, Pending>();
  const subs = new Set<(s: RunnerState) => void>();
  const set = (s: RunnerState) => { state = s; subs.forEach((f) => f(s)); };

  const kill = (why: Error) => {
    worker?.terminate();
    worker = null;
    ready = null;
    pending.forEach((p) => p.reject(why));
    pending.clear();
  };

  const start = (): Promise<void> => {
    if (ready) return ready;
    set('loading');
    const w = makeWorker();
    worker = w;
    ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { kill(new Error('Python took too long to load. Check your connection and try again.')); set('failed'); reject(new Error('load timeout')); }, LOAD_LIMIT_MS);
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; id?: number; result?: GradeResult; error?: string };
        if (m.type === 'ready') { clearTimeout(timer); set('ready'); resolve(); return; }
        if (m.type === 'load-error') { clearTimeout(timer); kill(new Error(m.error ?? 'Python failed to load')); set('failed'); reject(new Error(m.error)); return; }
        const p = m.id !== undefined ? pending.get(m.id) : undefined;
        if (!p) return;
        pending.delete(m.id!);
        if (m.type === 'result' && m.result) p.resolve(m.result);
        else p.reject(new Error(m.error ?? 'Python stopped unexpectedly'));
      };
      w.onerror = (e) => { clearTimeout(timer); kill(new Error(e.message || 'Python stopped unexpectedly')); set('failed'); reject(new Error('worker error')); };
      w.postMessage({ type: 'init', harness });
    });
    return ready;
  };

  return {
    state: () => state,
    warm: () => start().catch(() => undefined),
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    async run(code, tests, prelude) {
      await start();
      const id = ++seq;
      return new Promise<GradeResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          kill(new Error('stopped'));
          set('idle');
          resolve({ passed: false, tests: [], stdout: '', error: `Stopped after ${RUN_LIMIT_MS / 1000} seconds. Is there a loop that never ends?` });
        }, RUN_LIMIT_MS);
        pending.set(id, {
          resolve: (r) => { clearTimeout(timer); resolve(r); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });
        worker!.postMessage({ type: 'run', id, code, tests, prelude });
      });
    },
  };
}

let shared: Runner | null = null;
export const getRunner = () => (shared ??= createRunner());
