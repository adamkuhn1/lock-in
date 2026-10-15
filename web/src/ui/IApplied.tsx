import { useEffect, useRef, useState } from 'react';
import { useMarkApplied } from '../data/hooks';
import type { MarkAppliedInput } from '../data/types';
import { Button } from './primitives';

/**
 * "I applied": appends the job to the Sheet. If the Sheet already has it, asks inline before adding a second row.
 * `company`/`role` name the job for screen readers; `applied` shows "Applied ✓" instead of the button.
 */
export function IApplied({ input, company, role, applied = false, onApplied }: {
  input: Omit<MarkAppliedInput, 'force'>; company: string; role?: string | null; applied?: boolean; onApplied?: () => void;
}) {
  const mark = useMarkApplied();
  const [state, setState] = useState<'idle' | 'confirm' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const label = [company, role].filter(Boolean).join(' ');
  const addRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLSpanElement>(null);
  // Keep keyboard and screen-reader users on the thing that changed.
  useEffect(() => {
    if (state === 'confirm') addRef.current?.focus();
    if (state === 'done') doneRef.current?.focus();
  }, [state]);

  const send = async (force: boolean) => {
    setError(null);
    try {
      const r = await mark.mutateAsync(force ? { ...input, force: true } : input);
      if (r.duplicate) return setState('confirm');
      setState('done');
      onApplied?.();
    } catch (e) {
      setState('idle');
      setError(e instanceof Error ? e.message : "Couldn't reach Google. Try again.");
    }
  };

  if (applied || state === 'done') {
    return <span ref={doneRef} role="status" tabIndex={-1} className="muted small applied-mark">Applied ✓</span>;
  }
  return (
    <>
      {state === 'confirm' ? (
        <span className="row-actions" role="group" aria-label={`${label} is already in your Sheet`}>
          <span className="small">Already in your Sheet. Add anyway?</span>
          <Button ref={addRef} variant="primary" disabled={mark.isPending} aria-label={`Add ${company} anyway`} onClick={() => void send(true)}>Add anyway</Button>
          <Button variant="quiet" disabled={mark.isPending} aria-label={`Cancel adding ${company}`} onClick={() => setState('idle')}>Cancel</Button>
        </span>
      ) : (
        <Button className="job-applied" disabled={mark.isPending} aria-label={`I applied: ${label}`} onClick={() => void send(false)}>
          {mark.isPending ? 'Adding…' : 'I applied'}
        </Button>
      )}
      {error && <p role="alert" className="error small">{error}</p>}
    </>
  );
}
