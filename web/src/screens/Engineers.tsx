import { useLaunchRequests, useNow, useReferrals, useSettings, useUpdateReferral } from '../data/hooks';
import type { LaunchRequest, Referral, ReferralPatch } from '../data/types';
import {
  NOTE_MAX, PICK_LABEL, STATUS_LABEL, STEPS, followUpDue, followUpMessage, groupByJob, isDone, nextStep, notesSentThisWeek, sortGroups,
  type JobGroup,
} from '../lib/referrals';
import { tierLabel } from '../lib/tiers';
import { localDay } from '../lib/time';
import { safeHref } from '../lib/url';
import { Badge, Button, Card, CardHead, CopyButton, Disclosure, Empty, ErrorDetail, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

const STATUS_TONE = { drafted: 'accent', sent: 'muted', accepted: 'warn', replied: 'accent', referred: 'accent', closed: 'muted' } as const;

/** Where this engineer is in drafted → sent → accepted → replied → referred, and the one button for the next step. */
function EngineerBlock({ r, today, busy, onPatch }: { r: Referral; today: string; busy: boolean; onPatch: (p: ReferralPatch) => void }) {
  const due = followUpDue(r, today);
  const step = nextStep(r, today);
  const who = `${r.name} (${r.company})`;
  const profile = safeHref(r.profile_url);
  return (
    <div className="contact engineer">
      <p className="contact-name">
        {r.name}{r.title && <span className="muted small"> · {r.title}</span>}{' '}
        <Badge tone={r.pick === 'other' ? 'muted' : 'accent'}>{PICK_LABEL[r.pick]}</Badge>{' '}
        <Badge tone={due ? 'warn' : STATUS_TONE[r.status]}>{due ? 'Follow up' : STATUS_LABEL[r.status]}</Badge>
      </p>
      {r.why && <p className="muted small">{r.why}</p>}
      {step && <p className={`small${due ? ' warn' : ''}`}>{step}</p>}
      <ol className="steps" aria-label={`Progress with ${r.name}`}>
        {STEPS.map((s) => (
          <li key={s} data-done={STEPS.indexOf(s) <= STEPS.indexOf(r.status) && r.status !== 'closed' ? '' : undefined}>{STATUS_LABEL[s]}</li>
        ))}
      </ol>

      {r.status === 'drafted' && (
        <>
          <pre className="draft-body">{r.note}</pre>
          <p className="muted small">{r.note.length}/{NOTE_MAX} characters</p>
        </>
      )}
      {due && (
        <Disclosure summary="Follow-up message" open>
          <pre className="draft-body">{followUpMessage(r)}</pre>
          <CopyButton text={followUpMessage(r)} label="Copy follow-up" />
        </Disclosure>
      )}
      {r.status !== 'drafted' && <Disclosure summary="Connection note"><pre className="draft-body">{r.note}</pre></Disclosure>}

      <div className="row-actions">
        {r.status === 'drafted' && <CopyButton text={r.note} label="Copy note" variant="ghost" />}
        {profile && <ExternalLink className="btn" href={profile}>Open profile</ExternalLink>}
        {r.status === 'drafted' && (
          <Button variant="primary" aria-label={`Sent: ${who}`} disabled={busy} onClick={() => onPatch({ status: 'sent', sent_on: today })}>Sent</Button>
        )}
        {r.status === 'sent' && (
          <Button variant="primary" aria-label={`Accepted: ${who}`} disabled={busy} onClick={() => onPatch({ status: 'accepted', accepted_on: today })}>Accepted</Button>
        )}
        {due && (
          <Button variant="primary" aria-label={`Followed up: ${who}`} disabled={busy} onClick={() => onPatch({ followed_up_on: today })}>Followed up</Button>
        )}
        {(r.status === 'sent' || r.status === 'accepted') && (
          <Button variant={due ? 'quiet' : r.status === 'accepted' ? 'primary' : 'quiet'} aria-label={`Replied: ${who}`} disabled={busy}
            onClick={() => onPatch({ status: 'replied', replied_on: today, ...(r.accepted_on ? {} : { accepted_on: today }) })}>Replied</Button>
        )}
        {r.status === 'replied' && (
          <Button variant="primary" aria-label={`Referred: ${who}`} disabled={busy} onClick={() => onPatch({ status: 'referred', referred_on: today })}>Referred me</Button>
        )}
        {r.status !== 'closed' && r.status !== 'referred' && (
          <Button variant="quiet" aria-label={`${r.status === 'drafted' ? 'Skip' : 'Close'}: ${who}`} disabled={busy}
            onClick={() => onPatch({ status: 'closed' })}>{r.status === 'drafted' ? 'Skip' : 'Close'}</Button>
        )}
        {r.status === 'closed' && (
          <Button variant="quiet" aria-label={`Reopen: ${who}`} disabled={busy}
            onClick={() => onPatch({ status: r.replied_on ? 'replied' : r.accepted_on ? 'accepted' : r.sent_on ? 'sent' : 'drafted' })}>Reopen</Button>
        )}
      </div>
    </div>
  );
}

function JobCard({ g, today, busy, onPatch }: { g: JobGroup; today: string; busy: boolean; onPatch: (id: string, p: ReferralPatch) => void }) {
  const id = `eng-${g.key}`;
  return (
    <Card aria-labelledby={id}>
      <CardHead id={id} title={g.company}>{g.tier && <Badge tone={g.tier === 'reach' ? 'accent' : 'muted'}>{tierLabel(g.tier)}</Badge>}</CardHead>
      <p className="muted small">
        {g.role ?? 'Role not saved'}
        {safeHref(g.job_url) && <> · <ExternalLink href={g.job_url}>Posting</ExternalLink></>}
      </p>
      {g.refs.map((r) => <EngineerBlock key={r.id} r={r} today={today} busy={busy} onPatch={(p) => onPatch(r.id, p)} />)}
    </Card>
  );
}

/** Find engineers runs still waiting on the Mac, or that failed, so a click never seems to vanish. */
function Pending({ requests, saved }: { requests: LaunchRequest[]; saved: Set<string> }) {
  const open = requests.filter((r) => r.kind === 'find_engineers' && !saved.has(r.id) && !r.payload.skipped
    && (r.status !== 'launched' || Date.now() - Date.parse(r.created_at) < 3_600_000));
  if (open.length === 0) return null;
  return (
    <Card aria-labelledby="eng-pending-h">
      <CardHead id="eng-pending-h" title="Searching" />
      <ul>
        {open.map((r) => (
          <li key={r.id} className="app-row">
            <span className="job-title">{String(r.payload.company ?? 'Unknown company')}</span>
            {typeof r.payload.role === 'string' && <span className="small">{r.payload.role}</span>}
            <span className="muted small">{r.status === 'queued' ? 'Queued for Mac' : r.status === 'failed' ? 'Launch failed' : 'Opened on Mac'}</span>
            {r.status === 'failed' && r.error && <ErrorDetail error={r.error} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function Engineers() {
  const now = useNow();
  const today = localDay(now);
  const refs = useReferrals();
  const settings = useSettings();
  const requests = useLaunchRequests();
  const update = useUpdateReferral();
  const list = refs.data ?? [];
  const target = settings.data?.weekly_engineer_target ?? 10;
  const week = notesSentThisWeek(list, today);
  const groups = sortGroups(groupByJob(list), today);
  const active = groups.filter((g) => !isDone(g));
  const done = groups.filter(isDone);
  const saved = new Set(list.map((r) => r.request_id).filter((x): x is string => !!x));
  const patch = (id: string, p: ReferralPatch) => update.mutate({ id, patch: p });

  return (
    <div className="screen">
      <header className="screen-head"><h1>Engineers</h1></header>

      <Card data-primary aria-labelledby="eng-week-h">
        <CardHead id="eng-week-h" title="Notes this week" />
        <p className="big-num"><b>{week}</b><span className="muted">of {target}</span></p>
        <div className="bar" role="progressbar" aria-label="LinkedIn notes sent this week" aria-valuemin={0} aria-valuemax={target} aria-valuenow={week}>
          <span style={{ width: `${Math.min(100, (week / Math.max(1, target)) * 100)}%` }} />
        </div>
        <p className="muted small">
          For Reach roles, ask an engineer before you apply: tap <b>Find engineers</b> on a job in Jobs or on an application in
          Applications. Claude ranks ex-Apple engineers first, then CMU alumni, then the same team.
        </p>
      </Card>

      {update.isError && <p role="alert" className="error small">Couldn't save. Try again.</p>}
      <Pending requests={requests.data ?? []} saved={saved} />

      {refs.isPending ? (
        <Skeleton label="Loading engineers" />
      ) : refs.isError ? (
        <LoadError what="engineers" onRetry={() => void refs.refetch()} />
      ) : groups.length === 0 ? (
        <Empty>No engineers yet.</Empty>
      ) : (
        active.map((g) => <JobCard key={g.key} g={g} today={today} busy={update.isPending} onPatch={patch} />)
      )}
      {done.length > 0 && (
        <Disclosure summary={`Done (${done.length})`}>
          {done.map((g) => <JobCard key={g.key} g={g} today={today} busy={update.isPending} onPatch={patch} />)}
        </Disclosure>
      )}
    </div>
  );
}
