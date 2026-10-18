import { ExternalLink as ExternalIcon, FileText, Mail } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useNow, useOutreach, usePostings, useQueueOutreach, useQueueTailor, useSetPostingStatus, useUndoApplied } from '../data/hooks';
import type { Posting, PostingStatus } from '../data/types';
import { NO_FILTERS, filterPostings, sortPostings, termsOf, topLocations, type JobFilters } from '../lib/jobs';
import { relativeTime } from '../lib/time';
import { safeHref } from '../lib/url';
import { IApplied } from '../ui/IApplied';
import { Button, Card, CardHead, Chip, Disclosure, Empty, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

function JobRow({ p, now, busy, queued, onOpen, onCold, onTailor, onDismiss, onApplied }: {
  p: Posting; now: Date; busy: boolean; queued: boolean; onOpen?: () => void; onApplied: () => void;
  onCold: (href: string) => void; onTailor: (href: string) => void; onDismiss: () => void;
}) {
  const href = safeHref(p.url);
  const meta = [p.tier && `Tier ${p.tier}`, p.location, p.term, relativeTime(p.posted_at ?? p.found_at, now)].filter(Boolean).join(' · ');
  return (
    <li className="job">
      <div>
        <p className="job-title">
          {p.starred && <><span aria-hidden="true">⭐ </span><span className="sr-only">Starred: </span></>}
          {p.company} · {p.title}
        </p>
        <p className="muted small">{meta}</p>
        {!href && p.url && <p className="muted small">Link: {p.url}</p>}
      </div>
      <div className="row-actions">
        <Button className="job-cold" disabled={!href || busy || queued} onClick={() => { if (href) onCold(href); }}><Mail size={18} aria-hidden />Cold email</Button>
        <Button className="job-tailor" disabled={!href || busy || queued} onClick={() => { if (href) onTailor(href); }}><FileText size={18} aria-hidden />Tailor resume</Button>
        {href && <ExternalLink className="btn" href={href} onClick={onOpen}><ExternalIcon size={16} aria-hidden />Open</ExternalLink>}
        <IApplied input={{ posting_id: p.id }} company={p.company} role={p.title} applied={p.status === 'applied'} onApplied={onApplied} />
        {queued && <span className="muted small">Already queued</span>}
        <Button variant="muted" aria-label={`Dismiss ${p.company} ${p.title}`} onClick={onDismiss}>Dismiss</Button>
      </div>
    </li>
  );
}

export default function Jobs() {
  const now = useNow();
  const postings = usePostings();
  const setStatus = useSetPostingStatus();
  const queue = useQueueOutreach();
  const tailor = useQueueTailor();
  const outreach = useOutreach();
  const navigate = useNavigate();
  const [f, setF] = useState<JobFilters>(NO_FILTERS);
  const [dismissed, setDismissed] = useState<{ p: Posting; prev: PostingStatus } | null>(null);
  const [applied, setApplied] = useState<{ p: Posting; prev: PostingStatus } | null>(null);
  const unapply = useUndoApplied();

  const all = postings.data ?? [];
  const fresh = all.filter((p) => p.status === 'new');
  const inbox = sortPostings(filterPostings(fresh, f));
  const opened = sortPostings(all.filter((p) => p.status === 'seen'));
  const terms = termsOf(fresh);
  const places = topLocations(fresh);
  const filtering = f.starred || f.topTier || f.track !== null || f.term !== null || f.location !== null;
  const toggle = <K extends keyof JobFilters>(k: K, v: JobFilters[K]) => setF({ ...f, [k]: f[k] === v ? NO_FILTERS[k] : v });

  // Wait for the posting to leave the inbox before navigating, so coming back can't queue a second outreach for it.
  const queuedUrls = new Set((outreach.data ?? []).filter((o) => o.status === 'queued').map((o) => o.job_url));
  const startOutreach = async (p: Posting, href: string, mode: 'cold' | 'tailor') => {
    try {
      await (mode === 'tailor' ? tailor : queue).mutateAsync({ job_url: href, company: p.company, role: p.title });
      await setStatus.mutateAsync({ id: p.id, status: 'outreach' });
      navigate('/hunt/outreach');
    } catch {
      // The alert below shows the failure.
    }
  };
  const dismiss = (p: Posting) =>
    setStatus.mutate({ id: p.id, status: 'dismissed' }, { onSuccess: () => { setApplied(null); setDismissed({ p, prev: p.status }); } });
  const undoDismiss = () => {
    if (!dismissed) return;
    setStatus.mutate({ id: dismissed.p.id, status: dismissed.prev }, { onSuccess: () => setDismissed(null) });
  };
  // The row leaves the inbox once it's applied, so its Undo lives here: delete today's Sheet row, then restore the posting.
  const undoApplied = async () => {
    if (!applied) return;
    try {
      await unapply.mutateAsync({ company: applied.p.company, role: applied.p.title });
      await setStatus.mutateAsync({ id: applied.p.id, status: applied.prev });
      setApplied(null);
    } catch {
      // unapply's message shows below.
    }
  };
  const row = (p: Posting, markSeen: boolean) => (
    <JobRow key={p.id} p={p} now={now} busy={queue.isPending || tailor.isPending || setStatus.isPending}
      queued={!!p.url && queuedUrls.has(safeHref(p.url) ?? p.url)}
      onOpen={markSeen ? () => setStatus.mutate({ id: p.id, status: 'seen' }) : undefined}
      onCold={(href) => void startOutreach(p, href, 'cold')}
      onTailor={(href) => void startOutreach(p, href, 'tailor')}
      onDismiss={() => dismiss(p)}
      onApplied={() => { setDismissed(null); setApplied({ p, prev: p.status }); }} />
  );

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Jobs</h1>
        {fresh.length > 0 && <span className="count">{fresh.length} new</span>}
      </header>

      <div className="chips" role="group" aria-label="Filters">
        <Chip pressed={f.topTier} onToggle={() => setF({ ...f, topTier: !f.topTier })}>Tier A</Chip>
        <Chip pressed={f.starred} onToggle={() => setF({ ...f, starred: !f.starred })}>⭐ Starred</Chip>
        <Chip pressed={f.track === 'internship'} onToggle={() => toggle('track', 'internship')}>Internship</Chip>
        <Chip pressed={f.track === 'new_grad'} onToggle={() => toggle('track', 'new_grad')}>New grad</Chip>
      </div>
      {(terms.length > 0 || places.length > 0) && (
        <Disclosure summary="More filters">
          <div className="chips" role="group" aria-label="Term and location">
            {terms.map((t) => <Chip key={t} pressed={f.term === t} onToggle={() => toggle('term', t)}>{t}</Chip>)}
            {places.map((l) => <Chip key={l} pressed={f.location === l} onToggle={() => toggle('location', l)}>{l}</Chip>)}
          </div>
        </Disclosure>
      )}

      {(queue.isError || tailor.isError || setStatus.isError) && <p role="alert" className="error small">Couldn't save. Try again.</p>}
      {unapply.isError && <p role="alert" className="error small">{unapply.error.message}</p>}
      <div role="status" className="undo">
        {dismissed && (<>
          <span className="small">Dismissed {dismissed.p.company}</span>
          <Button variant="quiet" disabled={setStatus.isPending} onClick={undoDismiss}>Undo</Button>
        </>)}
        {applied && (<>
          <span className="small">Added {applied.p.company} to your Sheet</span>
          <Button variant="quiet" disabled={unapply.isPending || setStatus.isPending} onClick={() => void undoApplied()}>
            {unapply.isPending ? 'Undoing…' : 'Undo'}
          </Button>
        </>)}
      </div>

      <Card data-primary aria-labelledby="inbox-h">
        <CardHead id="inbox-h" title="Inbox" />
        {postings.isPending ? (
          <Skeleton label="Loading postings" />
        ) : postings.isError ? (
          <LoadError what="postings" onRetry={() => void postings.refetch()} />
        ) : inbox.length === 0 ? (
          filtering ? (
            <div className="stack">
              <Empty>Nothing matches these filters.</Empty>
              <div><Button onClick={() => setF(NO_FILTERS)}>Clear filters</Button></div>
            </div>
          ) : (
            <Empty>Inbox zero.</Empty>
          )
        ) : (
          <ul>{inbox.map((p) => row(p, true))}</ul>
        )}
      </Card>

      {opened.length > 0 && (
        <Disclosure summary={`Opened (${opened.length})`}>
          <ul>{opened.map((p) => row(p, false))}</ul>
        </Disclosure>
      )}
    </div>
  );
}
