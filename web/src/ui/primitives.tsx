import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import type { Difficulty } from '../data/types';
import { shortError } from '../lib/errors';
import { safeHref } from '../lib/url';

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger' | 'muted';

export function Button({ variant = 'ghost', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; ref?: Ref<HTMLButtonElement> }) {
  return <button type="button" className={`btn btn-${variant} ${className}`.trim()} {...props} />;
}

export function Card({ className = '', children, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`card ${className}`.trim()} {...props}>{children}</section>;
}

export function CardHead({ title, id, children }: { title: ReactNode; id: string; children?: ReactNode }) {
  return (
    <div className="card-head">
      <h2 id={id}>{title}</h2>
      {children}
    </div>
  );
}

export function Chip({ pressed, onToggle, children }: { pressed: boolean; onToggle: () => void; children: ReactNode }) {
  return <button type="button" className="chip" aria-pressed={pressed} onClick={onToggle}>{children}</button>;
}

export function Badge({ tone = 'muted', children }: { tone?: 'accent' | 'warn' | 'danger' | 'muted'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function DifficultyTag({ d }: { d: Difficulty }) {
  return <span className={`diff diff-${d.toLowerCase()}`}>{d}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Skeleton({ label = 'Loading' }: { label?: string }) {
  return <div className="skeleton" role="status" aria-label={label} />;
}

export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p role="alert" className="error">
      Couldn't load {what}. <Button variant="quiet" onClick={onRetry}>Retry</Button>
    </p>
  );
}

export function Disclosure({ summary, open, children }: { summary: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className="disclosure" open={open}>
      <summary><ChevronDown className="chev" size={18} aria-hidden />{summary}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

export function CopyButton({ text, label, variant = 'quiet' }: { text: string; label: string; variant?: Variant }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this:', text);
    }
  };
  return (
    <Button variant={variant} onClick={copy}>
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </Button>
  );
}

export function Stepper({ label, value, min, max, onChange, disabled = false }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <Button aria-label={`Fewer: ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>−</Button>
      <output aria-live="polite">{value}</output>
      <Button aria-label={`More: ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>+</Button>
    </div>
  );
}

export function ExternalLink({ href, children, className, onClick }: { href: string | null | undefined; children: ReactNode; className?: string; onClick?: () => void }) {
  const safe = safeHref(href);
  if (!safe) return <span className={className}>{children}</span>;
  return <a className={className} href={safe} target="_blank" rel="noopener noreferrer" onClick={onClick}>{children}</a>;
}

/** A short error line; the full text sits behind a Disclosure when it was shortened. */
export function ErrorDetail({ error }: { error: string }) {
  const short = shortError(error);
  return (
    <>
      <p className="error small">{short}</p>
      {short !== error.trim() && <Disclosure summary="Details"><pre className="error-detail small">{error}</pre></Disclosure>}
    </>
  );
}
