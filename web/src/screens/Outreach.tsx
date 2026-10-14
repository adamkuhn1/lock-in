import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  useContacts, useLaunchRequests, useNow, useOutreach, useQueueOutreach, useRequestLaunch, useUpdateOutreach,
} from '../data/hooks';
import type { Contact, Outreach as OutreachRow } from '../data/types';
import { PHASE_LABEL, followUpOn, outreachPhase, sortOutreach, type Phase } from '../lib/outreach';
import { copyPrompt } from '../lib/outreachPrompt';
import { localDay, shortDate } from '../lib/time';
import { hostOf, isJobUrl, safeHref } from '../lib/url';
import { Badge, Button, Card, CardHead, CopyButton, Disclosure, Empty, ErrorDetail, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

const TONE: Record<Phase['kind'], 'accent' | 'warn' | 'danger' | 'muted'> = {
  not_queued: 'warn', queued: 'muted', on_mac: 'muted', failed: 'danger', drafted: 'accent',
  sent: 'muted', due: 'warn', replied: 'accent', closed: 'muted',
};
const CONFIDENCE_TONE = { verified: 'accent', pattern: 'muted', guess: 'warn' } as const;

function ContactBlock({ c }: { c: Contact }) {
  return (
    <div className="contact">
      <p className="contact-name">{c.name}{c.title && <span className="muted small"> · {c.title}</span>}</p>
      {c.email_guess && (
        <div className="row-actions">
          <span className="email">{c.email_guess}</span>
          {c.email_confidence && <Badge tone={CONFIDENCE_TONE[c.email_confidence]}>{c.email_confidence}</Badge>}
          <CopyButton text={c.email_guess} label="Copy email" variant="ghost" />
        </div>
      )}
      <Disclosure summary="Draft">
        {c.draft_subject && <p><b>{c.draft_subject}</b></p>}
        {c.draft_body && <pre className="draft-body">{c.draft_body}</pre>}
        <div className="row-actions">
          {c.draft_subject && <CopyButton text={c.draft_subject} label="Copy subject" />}
          {c.draft_body && <CopyButton text={c.draft_body} label="Copy body" />}
          {safeHref(c.linkedin_url) && <ExternalLink className="btn btn-quiet" href={c.linkedin_url}>LinkedIn</ExternalLink>}
        </div>
        {c.why && <p className="muted small">{c.why}</p>}
      </Disclosure>
    </div>
  );
}

export function PromptButton({ build }: { build: () => string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const click = async () => {
    let text: string;
    try {
      text = build();
    } catch {
      setState('error');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('Copy this:', text);
    }
    setState('copied');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1500);
  };
  return (
    <>
      <Button variant="quiet" onClick={() => void click()}><span aria-live="polite">{state === 'copied' ? 'Copied' : 'Copy prompt'}</span></Button>
      {state === 'error' && <p role="alert" className="error small">Couldn't build the prompt.</p>}
    </>
  );
}

function OutreachCard({ o, phase, contacts, prompt, busy, onSent, onReplied, onClose, onRetry }: {
  o: OutreachRow; phase: Phase; contacts: Contact[]; prompt: () => string; busy: boolean;
  onSent: () => void; onReplied: () => void; onClose: () => void; onRetry: () => void;
}) {
  const headId = `out-${o.id}`;
  const waiting = phase.kind === 'queued' || phase.kind === 'on_mac' || phase.kind === 'failed' || phase.kind === 'not_queued';
  const followUp = (phase.kind === 'sent' || phase.kind === 'due') && o.follow_up_on ? `Follow up ${shortDate(o.follow_up_on)}` : null;
  return (
    <Card aria-labelledby={headId}>
      <CardHead id={headId} title={o.company ?? hostOf(o.job_url)}>
        <Badge tone={TONE[phase.kind]}>{PHASE_LABEL[phase.kind]}</Badge>
      </CardHead>
      {(o.role || followUp) && <p className="muted small">{[o.role, followUp].filter(Boolean).join(' · ')}</p>}
      {phase.kind === 'failed' && <ErrorDetail error={phase.error} />}
      <div className="row-actions">
        {(phase.kind === 'failed' || phase.kind === 'not_queued') && <Button onClick={onRetry} disabled={busy}>Try again</Button>}
        {waiting && <PromptButton build={prompt} />}
        {phase.kind === 'drafted' && <Button variant="primary" onClick={onSent} disabled={busy}>Sent</Button>}
        {(phase.kind === 'sent' || phase.kind === 'due') && (
          <>
            <Button variant="primary" onClick={onReplied} disabled={busy}>Replied</Button>
            <Button variant="quiet" onClick={onClose} disabled={busy}>Close</Button>
          </>
        )}
        <ExternalLink className="btn btn-quiet" href={o.job_url}>Posting</ExternalLink>
      </div>
      {contacts.map((c) => <ContactBlock key={c.id} c={c} />)}
    </Card>
  );
}

export default function Outreach() {
  const now = useNow();
  const today = localDay(now);
  const outreach = useOutreach();
  const contacts = useContacts();
  const requests = useLaunchRequests();
  const queue = useQueueOutreach();
  const update = useUpdateOutreach();
  const launch = useRequestLaunch();
  const [url, setUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const reqs = requests.data ?? [];
  const list = sortOutreach(outreach.data ?? [], reqs, today);
  const active = list.filter((o) => o.status !== 'replied' && o.status !== 'closed');
  const finished = list.filter((o) => o.status === 'replied' || o.status === 'closed');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (!isJobUrl(u)) {
      setErr('Paste a full job link (https://…).');
      return;
    }
    setErr(null);
    queue.mutate({ job_url: u }, { onSuccess: () => setUrl('') });
  };

  const card = (o: OutreachRow) => (
    <OutreachCard key={o.id} o={o} phase={outreachPhase(o, reqs, today)}
      contacts={(contacts.data ?? []).filter((c) => c.outreach_id === o.id)}
      prompt={() => copyPrompt(o)} busy={update.isPending || launch.isPending}
      onSent={() => update.mutate({ id: o.id, patch: { status: 'sent', sent_on: today, follow_up_on: followUpOn(today) } })}
      onReplied={() => update.mutate({ id: o.id, patch: { status: 'replied' } })}
      onClose={() => update.mutate({ id: o.id, patch: { status: 'closed' } })}
      onRetry={() => launch.mutate({ kind: 'outreach', payload: { outreach_id: o.id, job_url: o.job_url } })} />
  );

  return (
    <div className="screen">
      <header className="screen-head"><h1>Outreach</h1></header>

      <Card data-primary aria-labelledby="new-h">
        <CardHead id="new-h" title="New" />
        <form className="inline-form" onSubmit={submit} noValidate>
          <input aria-label="Job link" type="url" inputMode="url" placeholder="Paste a job link" value={url}
            aria-invalid={err ? true : undefined} aria-describedby={err ? 'url-err' : undefined}
            onChange={(e) => setUrl(e.target.value)} />
          <Button type="submit" variant="primary" disabled={queue.isPending}>Draft emails</Button>
        </form>
        {err && <p id="url-err" role="alert" className="error small">{err}</p>}
      </Card>

      {(queue.isError || update.isError || launch.isError) && <p role="alert" className="error small">Couldn't save. Try again.</p>}

      {outreach.isPending ? (
        <Skeleton label="Loading outreach" />
      ) : outreach.isError ? (
        <LoadError what="outreach" onRetry={() => void outreach.refetch()} />
      ) : list.length === 0 ? (
        <Empty>No outreach yet.</Empty>
      ) : (
        active.map(card)
      )}
      {finished.length > 0 && <Disclosure summary={`Done (${finished.length})`}>{finished.map(card)}</Disclosure>}
    </div>
  );
}
