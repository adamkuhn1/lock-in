import { ClipboardPen, ExternalLink as ExternalIcon, FileText, Mail, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  useLaunchRequests, useNow, useOutreach, usePostings, useQueueOutreach, useQueueTailor, useRequestLaunch, useSetPostingStatus, useUndoApplied,
} from '../data/hooks';
import type { Posting, PostingStatus } from '../data/types';
import { launchState } from '../lib/ideas';
import { NO_FILTERS, capPerCompany, filterPostings, isBestFit, sortByFit, sortPostings, termsOf, topLocations, type JobFilters } from '../lib/jobs';
import { relativeTime } from '../lib/time';
import { safeHref } from '../lib/url';
import { IApplied } from '../ui/IApplied';
import { Badge, Button, Card, CardHead, Chip, Disclosure, Empty, ErrorDetail, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

const PER_COMPANY = 3; // inbox rows per company before "Show N more"

function JobRow({ p, now, busy, queued, onOpen, onCold, onTailor, onFill, onDismiss, onApplied }: {
  p: Posting; now: Date; busy: boolean; queued: boolean; onOpen?: () => void; onApplied: () => void;
  onCold: (href: string) => void; onTailor: (href: string) => void; onFill: (href: string) => void; onDismiss: () => void;
}) {
  const href = safeHref(p.url);
  const meta = [p.tier && `Tier ${p.tier}`, p.location, p.term, relativeTime(p.posted_at ?? p.found_at, now)].filter(Boolean).join(' · ');
  return (
    <li className="job">
      <div>
        <p className="job-title">
          {p.starred && <><span aria-hidden="true">⭐ </span><span className="sr-only">Starred: </span></>}
          {p.company} · {p.title}
          {p.fit_rank != null && <> <Badge tone="accent">Best fit #{p.fit_rank}</Badge></>}
          {p.found_by === 'claude' && <> <Badge>Found by Claude</Badge></>}
          {p.status === 'seen' && <> <span className="badge badge-muted">Opened</span></>}
        </p>
        <p className="muted small">{meta}</p>
        {p.fit_reason && <p className="small job-why">{p.fit_reason}</p>}
        {!href && p.url && <p className="muted small">Link: {p.url}</p>}
      </div>
      <div className="row-actions">
        <Button className="job-cold" disabled={!href || busy || queued} onClick={() => { if (href) onCold(href); }}><Mail size={18} aria-hidden />Cold email</Button>
        <Button className="job-tailor" disabled={!href || busy || queued} onClick={() => { if (href) onTailor(href); }}><FileText size={18} aria-hidden />Tailor resume</Button>
        <Button className="job-fill" disabled={!href || busy || queued} onClick={() => { if (href) onFill(href); }}><ClipboardPen size={18} aria-hidden />Tailor resume &amp; fill application</Button>
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
  const requests = useLaunchRequests();
  const launch = useRequestLaunch();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const all = postings.data ?? [];
  const fresh = all.filter((p) => p.status === 'new');
  // Opening a link isn't acting on it: an opened posting stays in the inbox (tagged Opened) until it's applied, emailed or dismissed.
  const open = all.filter((p) => p.status === 'new' || p.status === 'seen');
  const matching = filterPostings(open, f);
  const inbox = f.bestFit ? sortByFit(matching) : sortPostings(matching);
  // The shortlist is short and ranked, so it's never capped; the full inbox shows a few rows per company.
  const items = f.bestFit ? inbox.map((p) => ({ kind: 'posting' as const, p })) : capPerCompany(inbox, PER_COMPANY, expanded);
  const bestFits = open.filter(isBestFit).length;
  const fit = launchState(requests.data ?? [], (r) => r.kind === 'best_fit', now);
  const terms = termsOf(open);
  const places = topLocations(open);
  const filtering = f.bestFit || f.starred || f.topTier || f.track !== null || f.term !== null || f.location !== null;
  const toggle = <K extends keyof JobFilters>(k: K, v: JobFilters[K]) => setF({ ...f, [k]: f[k] === v ? NO_FILTERS[k] : v });

  // Wait for the posting to leave the inbox before navigating, so coming back can't queue a second outreach for it.
  const queuedUrls = new Set((outreach.data ?? []).filter((o) => o.status === 'queued').map((o) => o.job_url));
  const startOutreach = async (p: Posting, href: string, mode: 'cold' | 'tailor' | 'fill') => {
    try {
      const job = { job_url: href, company: p.company, role: p.title };
      await (mode === 'cold' ? queue.mutateAsync(job) : tailor.mutateAsync(mode === 'fill' ? { ...job, fill: true } : job));
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
  const row = (p: Posting) => (
    <JobRow key={p.id} p={p} now={now} busy={queue.isPending || tailor.isPending || setStatus.isPending}
      queued={!!p.url && queuedUrls.has(safeHref(p.url) ?? p.url)}
      onOpen={p.status === 'new' ? () => setStatus.mutate({ id: p.id, status: 'seen' }) : undefined}
      onCold={(href) => void startOutreach(p, href, 'cold')}
      onTailor={(href) => void startOutreach(p, href, 'tailor')}
      onFill={(href) => void startOutreach(p, href, 'fill')}
      onDismiss={() => dismiss(p)}
      onApplied={() => { setDismissed(null); setApplied({ p, prev: p.status }); }} />
  );

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Jobs</h1>
        {fresh.length > 0 && <span className="count">{fresh.length} new</span>}
      </header>

      <div className="best-fit">
        <Button disabled={fit.kind === 'queued' || launch.isPending || open.length === 0}
          onClick={() => launch.mutate({ kind: 'best_fit', payload: {} }, { onSuccess: () => setF({ ...NO_FILTERS, bestFit: true }) })}>
          <Sparkles size={18} aria-hidden />
          {fit.kind === 'queued' ? 'Queued for Mac' : fit.kind === 'failed' ? 'Try again' : 'Find best fits'}
        </Button>
        <span className="muted small">
          {fit.kind === 'launched' ? 'Opened on Mac. Picks show up under Best fit when Claude saves them.'
            : 'Claude reads your resume, applications and this inbox, then checks the web for more.'}
        </span>
      </div>
      {fit.kind === 'failed' && <ErrorDetail error={fit.error} />}
      {launch.isError && <p role="alert" className="error small">Couldn't queue it. Try again.</p>}

      <div className="chips" role="group" aria-label="Filters">
        <Chip pressed={f.bestFit} onToggle={() => setF({ ...f, bestFit: !f.bestFit })}>Best fit{bestFits > 0 && ` (${bestFits})`}</Chip>
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
              <Empty>{f.bestFit && bestFits === 0 ? 'No best fits yet. Tap Find best fits to have Claude build the list.' : 'Nothing matches these filters.'}</Empty>
              <div><Button onClick={() => setF(NO_FILTERS)}>Clear filters</Button></div>
            </div>
          ) : (
            <Empty>Inbox zero.</Empty>
          )
        ) : (
          <ul>
            {items.map((it) => it.kind === 'posting' ? row(it.p) : (
              <li key={`more-${it.company}`} className="job-more">
                <Button variant="quiet" onClick={() => setExpanded(new Set([...expanded, it.company]))}>
                  Show {it.count} more from {it.company}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
