/// <reference lib="webworker" />
/** The Python worker: loads Pyodide once, then grades lesson code with shared/lessons/harness.py. */

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';

interface Pyodide {
  runPython(code: string): unknown;
  globals: { get(name: string): (...args: string[]) => string };
}

let gradeJson: ((code: string, tests: string, prelude: string) => string) | null = null;

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: 'init'; harness: string } | { type: 'run'; id: number; code: string; tests: string; prelude: string };
  if (m.type === 'init') {
    try {
      const { loadPyodide } = (await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`)) as { loadPyodide: (o: { indexURL: string }) => Promise<Pyodide> };
      const py = await loadPyodide({ indexURL: PYODIDE });
      py.runPython(m.harness);
      gradeJson = py.globals.get('grade_json');
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'load-error', error: `Python failed to load: ${err instanceof Error ? err.message : String(err)}` });
    }
    return;
  }
  if (!gradeJson) {
    self.postMessage({ type: 'error', id: m.id, error: 'Python is not loaded yet' });
    return;
  }
  try {
    self.postMessage({ type: 'result', id: m.id, result: JSON.parse(gradeJson(m.code, m.tests, m.prelude)) });
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
