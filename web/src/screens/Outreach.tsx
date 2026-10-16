import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  useApplications, useContacts, useLaunchRequests, useNow, useOutreach, useQueueOutreach, useRequestLaunch, useUpdateOutreach,
} from '../data/hooks';
import type { Contact, Outreach as OutreachRow } from '../data/types';
import { FOLLOW_UP_RETRY_DAYS, PHASE_LABEL, followUpDraft, followUpLabel, followUpOn, isPlainEmail, latestRequest, mailtoHref, outreachPhase, sortOutreach, type Phase } from '../lib/outreach';
import { copyPrompt } from '../lib/outreachPrompt';
import { addDays, localDay } from '../lib/time';
import { hostOf, isJobUrl, safeHref } from '../lib/url';
import { IApplied } from '../ui/IApplied';
import { Badge, Button, Card, CardHead, CopyButton, Disclosure, Empty, ErrorDetail, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

const TONE: Record<Phase['kind'], 'accent' | 'warn' | 'danger' | 'muted'> = {
  not_queued: 'warn', queued: 'muted', on_mac: 'muted', failed: 'danger', drafted: 'accent', resume_ready: 'accent',
  sent: 'muted', due: 'warn', replied: 'accent', closed: 'muted',
};
const CONFIDENCE_TONE = { verified: 'accent', pattern: 'muted', guess: 'warn' } as const;

function ContactBlock({ c, o, name, followUp, original }: { c: Contact; o: OutreachRow; name: string; followUp: boolean; original: boolean }) {
  const plain = !!c.email_guess && isPlainEmail(c.email_guess);
  const fu = followUp ? followUpDraft(o, c) : null;
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
      {original && plain && (
        <div className="row-actions">
          <a className="btn" aria-label={`Open in Outlook: ${c.name} (${name})`}
            href={mailtoHref(c.email_guess!, c.draft_subject ?? '', c.draft_body ?? '')}>Open in Outlook</a>
        </div>
      )}
      {fu && plain && (
        <div className="row-actions">
          <a className="btn btn-primary" aria-label={`Open follow-up in Outlook: ${c.name} (${name})`}
            href={mailtoHref(c.email_guess!, fu.subject, fu.body)}>Open follow-up</a>
        </div>
      )}
      {fu && (
        <Disclosure summary="Follow-up draft">
          <p><b>{fu.subject}</b></p>
          <pre className="draft-body">{fu.body}</pre>
          <div className="row-actions">
            <CopyButton text={fu.subject} label="Copy subject" />
            <CopyButton text={fu.body} label="Copy body" />
          </div>
        </Disclosure>
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

function OutreachCard({ o, phase, today, contacts, prompt, busy, applied, contactsLoaded, onSent, onFollowedUp, onReplied, onClose, onReopen, onRetry }: {
  o: OutreachRow; phase: Phase; today: string; contacts: Contact[]; prompt: () => string; busy: boolean; contactsLoaded: boolean; applied: boolean;
  onSent: () => void; onFollowedUp: () => void; onReplied: () => void; onClose: () => void; onReopen: () => void; onRetry: () => void;
}) {
  const headId = `out-${o.id}`;
  const waiting = phase.kind === 'queued' || phase.kind === 'on_mac' || phase.kind === 'failed' || phase.kind === 'not_queued';
  const label = followUpLabel(o, today);
  const name = o.company ?? hostOf(o.job_url);
  // Anything not yet sent can be dropped. Safe mid-run: the worker only moves `queued` rows to `drafted`, so a closed row stays closed.
  const discardable = waiting || phase.kind === 'drafted' || phase.kind === 'resume_ready';
  const firstFollowUp = phase.kind === 'due' && o.followups === 0;
  const closeSuggested = phase.kind === 'due' && o.followups >= 1;
  return (
    <Card aria-labelledby={headId}>
      <CardHead id={headId} title={o.company ?? hostOf(o.job_url)}>
        <Badge tone={TONE[phase.kind]}>{PHASE_LABEL[phase.kind]}</Badge>
      </CardHead>
      {(o.role || label) && (
        <p className="muted small">
          {o.role}{o.role && label && ' · '}{label && <span className={phase.kind === 'due' ? 'warn' : undefined}>{label}</span>}
        </p>
      )}
      {phase.kind === 'failed' && <ErrorDetail error={phase.error} />}
      <div className="row-actions">
        {(phase.kind === 'failed' || phase.kind === 'not_queued') && <Button onClick={onRetry} disabled={busy}>Try again</Button>}
        {waiting && <PromptButton build={prompt} />}
        {phase.kind === 'drafted' && <Button variant="primary" onClick={onSent} disabled={busy}>Sent</Button>}
        {firstFollowUp && <Button variant="primary" aria-label={`Follow-up sent: ${name}`} onClick={onFollowedUp} disabled={busy}>Follow-up sent</Button>}
        {(phase.kind === 'sent' || phase.kind === 'due') && (
          <>
            <Button variant={firstFollowUp ? 'quiet' : 'primary'} aria-label={`Replied: ${name}`} onClick={onReplied} disabled={busy}>Replied</Button>
            <Button variant={closeSuggested ? 'primary' : 'quiet'} aria-label={`Close: ${name}`} onClick={onClose} disabled={busy}>Close</Button>
          </>
        )}
        {discardable && <Button variant="quiet" aria-label={`Discard: ${name}`} onClick={onClose} disabled={busy}>Discard</Button>}
        {phase.kind === 'closed' && <Button variant="quiet" aria-label={`Reopen: ${name}`} onClick={onReopen} disabled={busy || !contactsLoaded}>Reopen</Button>}
        <ExternalLink className="btn btn-quiet" href={o.job_url}>Posting</ExternalLink>
        {safeHref(o.job_url) && <IApplied input={{ outreach_id: o.id }} company={name} role={o.role} applied={applied} />}
      </div>
      {o.resume_path && <p className="muted small resume-path">Resume: {o.resume_path}</p>}
      {phase.kind === 'resume_ready' && contacts.length === 0 && <p className="muted small">No recruiter found yet.</p>}
      {contacts.map((c) => <ContactBlock key={c.id} c={c} o={o} name={name} followUp={firstFollowUp} original={phase.kind !== 'sent' && phase.kind !== 'due'} />)}
    </Card>
  );
}

export default function Outreach() {
  const now = useNow();
  const today = localDay(now);
  const outreach = useOutreach();
  const contacts = useContacts();
  const apps = useApplications();
  const requests = useLaunchRequests();
  const queue = useQueueOutreach();
  const update = useUpdateOutreach();
  const launch = useRequestLaunch();
  const [url, setUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const reqs = requests.data ?? [];
  // Same normalization as /api/sheet's norm (trim, lowercase, collapse whitespace).
  const n = (s: string | null) => (s ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  const key = (company: string | null, role: string | null) => `${n(company)}|${n(role)}`;
  const inSheet = new Set((apps.data ?? []).map((a) => key(a.company, a.role)));
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
    <OutreachCard key={o.id} o={o} today={today} phase={outreachPhase(o, reqs, today)}
      contacts={(contacts.data ?? []).filter((c) => c.outreach_id === o.id)}
      prompt={() => copyPrompt(o)} busy={update.isPending || launch.isPending} contactsLoaded={contacts.isSuccess} applied={!!o.company && inSheet.has(key(o.company, o.role))}
      onSent={() => update.mutate({ id: o.id, patch: { status: 'sent', sent_on: today, follow_up_on: followUpOn(today), followups: 0 } })}
      onFollowedUp={() => update.mutate({ id: o.id, patch: { followups: o.followups + 1, follow_up_on: addDays(today, FOLLOW_UP_RETRY_DAYS) } })}
      onReplied={() => update.mutate({ id: o.id, patch: { status: 'replied' } })}
      onClose={() => update.mutate({ id: o.id, patch: { status: 'closed' } })}
      onReopen={() => update.mutate({ id: o.id, patch: { status: o.sent_on !== null ? 'sent' : (contacts.data ?? []).some((c) => c.outreach_id === o.id) ? 'drafted' : 'queued' } })}
      onRetry={() => launch.mutate({
        kind: latestRequest(o, reqs)?.kind ?? 'outreach', payload: { outreach_id: o.id, job_url: o.job_url },
      })} />
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
