import { BookOpen, ChevronRight, Download, FileText, Share2, Sparkles } from 'lucide-react';
import { Fragment, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApi } from '../data/context';
import { useApplications, useLaunchRequests, useNow, useOutreach, useRequestLaunch, useSettings, useSolves, useStories, useSyncStatus, useUpdateSettings } from '../data/hooks';
import type { Outreach } from '../data/types';
import { useTodayStats } from '../data/useTodayStats';
import { buildExport, downloadJson, exportFilename } from '../lib/export';
import { launchState } from '../lib/ideas';
import { PROFILE_DEFAULTS, mergedProfile, type Profile, type ProfileField } from '../lib/profile';
import { seasonRecord } from '../lib/record';
import { anyStale } from '../lib/sync';
import { shortDate } from '../lib/time';
import { safeHref } from '../lib/url';
import { StatTile } from '../ui/StatTile';
import { Button, Card, CardHead, CopyButton, Empty, ErrorDetail, Skeleton } from '../ui/primitives';

const FIELD_LABEL: Record<ProfileField, string> = {
  name: 'Name', school: 'School', degree: 'Degree', grad: 'Graduating', grad_late: 'Latest graduation date',
  experience: 'Experience', targets: 'Looking for', locations: 'Preferred locations', notes: 'Notes for Claude',
  application: 'Application answers', github: 'GitHub', linkedin: 'LinkedIn', portfolio: 'Portfolio',
};
const LINK_FIELDS = ['github', 'linkedin', 'portfolio'] as const;
const LINK_HINT: Record<(typeof LINK_FIELDS)[number], string> = {
  github: 'https://github.com/you', linkedin: 'https://linkedin.com/in/you', portfolio: 'https://your-site.com',
};
/** A link as typed, with https:// added when the scheme is missing. Null when it isn't a web address. */
export const linkHref = (v: string) => safeHref(/^https?:\/\//i.test(v) ? v : `https://${v}`);
/** The questions application forms ask that the resume can't answer. Blank → Claude leaves them for Adam. */
const APPLICATION_HINT = 'Work authorization, sponsorship, mailing address, earliest start date, open to relocation, how you heard about jobs. Claude uses these to fill in applications; anything missing is left blank for you.';
const FIELD_ORDER: ProfileField[] = ['name', 'school', 'degree', 'grad', 'grad_late', 'experience', 'targets', 'locations', 'github', 'linkedin', 'portfolio', 'notes', 'application'];

/** Who Adam is. Tailor resume and Cold email (including their fit check) read this. */
function ProfileCard() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [draft, setDraft] = useState<Profile | null>(null);
  if (settings.isPending) return <Card><Skeleton label="Loading profile" /></Card>;
  const saved = settings.data?.profile ?? {};
  const p = mergedProfile(saved);
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    // Store only what Adam typed; blanks fall back to the defaults.
    const clean = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, (v ?? '').trim()]).filter(([, v]) => v));
    update.mutate({ profile: clean }, { onSuccess: () => setDraft(null) });
  };
  return (
    <Card data-primary aria-labelledby="profile-h">
      <CardHead id="profile-h" title={p.name}>
        {!draft && <Button variant="quiet" onClick={() => setDraft({ ...saved })}>Edit</Button>}
      </CardHead>
      {draft ? (
        <form className="stack" onSubmit={save}>
          {FIELD_ORDER.map((k) => (
            <label key={k} className="field">
              <span>{FIELD_LABEL[k]}</span>
              {k === 'application' ? (
                <textarea rows={4} value={draft[k] ?? ''} placeholder={APPLICATION_HINT} maxLength={1000}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              ) : k === 'notes' || k === 'targets' ? (
                <textarea rows={2} value={draft[k] ?? ''} placeholder={PROFILE_DEFAULTS[k]} maxLength={300}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              ) : (
                <input value={draft[k] ?? ''} placeholder={(LINK_HINT as Record<string, string>)[k] ?? PROFILE_DEFAULTS[k]} maxLength={150}
                  inputMode={(LINK_FIELDS as readonly string[]).includes(k) ? 'url' : undefined}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              )}
            </label>
          ))}
          <p className="muted small">Leave a field blank to keep the default shown. Tailor resume and Cold email use this, including the fit check. Fill application also uses Application answers.</p>
          <div className="row-actions">
            <Button type="submit" variant="primary" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save'}</Button>
            <Button variant="quiet" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
          {update.isError && <p role="alert" className="error small">Couldn't save. Try again.</p>}
        </form>
      ) : (
        <dl className="profile">
          <dt>School</dt><dd>{p.school}</dd>
          <dt>Degree</dt><dd>{p.degree}</dd>
          <dt>Graduating</dt><dd>{p.grad}{p.grad_late && p.grad_late !== p.grad && <span className="muted"> (can move to {p.grad_late})</span>}</dd>
          {p.experience && <><dt>Experience</dt><dd>{p.experience}</dd></>}
          <dt>Looking for</dt><dd>{p.targets}</dd>
          {p.locations && <><dt>Prefers</dt><dd>{p.locations}</dd></>}
          {LINK_FIELDS.filter((k) => p[k]).map((k) => {
            const href = linkHref(p[k]);
            return <Fragment key={k}><dt>{FIELD_LABEL[k]}</dt><dd>{href ? <a href={href} target="_blank" rel="noreferrer">{p[k]}</a> : p[k]}</dd></Fragment>;
          })}
          {p.application && <><dt>Application answers</dt><dd>{p.application}</dd></>}
        </dl>
      )}
    </Card>
  );
}

function SeasonRecordCard() {
  const { stats } = useTodayStats();
  const apps = useApplications();
  const solves = useSolves();
  const outreach = useOutreach();
  if (!stats) return <Card><Skeleton label="Loading season record" /></Card>;
  const r = seasonRecord(stats.days, apps.data ?? [], solves.data ?? [], outreach.data ?? []);
  return (
    <section className="record" aria-labelledby="record-h">
      <h2 id="record-h">Season record</h2>
      <div className="record-grid">
        <StatTile label="Longest streak" value={r.longestStreak}><span className="muted small stat-sub">days in a row · now {stats.streak}</span></StatTile>
        <StatTile label="Active days" value={r.activeDays}><span className="muted small stat-sub">of {stats.n}</span></StatTile>
        <StatTile label="Applications" value={r.applications}>
          {r.bestWeek && <span className="muted small stat-sub">best week {r.bestWeek.count} (from {shortDate(r.bestWeek.start)})</span>}
        </StatTile>
        <StatTile label="LeetCode solved" value={r.solved} />
        <StatTile label="Emails sent" value={r.emails} />
        <StatTile label="Interviews" value={r.interviews}><span className="muted small stat-sub">{r.offers} {r.offers === 1 ? 'offer' : 'offers'}</span></StatTile>
      </div>
    </section>
  );
}

const isBase = (path: string) => /\/Base_Resume\//.test(path);

/** Tailored resumes: outreach cards whose resume Claude saved into its own folder (not the base). */
export function tailoredResumes(list: Outreach[]): Outreach[] {
  return list.filter((o) => o.resume_path && !isBase(o.resume_path)).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function ResumeHub() {
  const settings = useSettings();
  const outreach = useOutreach();
  const apps = useApplications();
  const n = (s: string | null) => (s ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  const inSheet = new Set((apps.data ?? []).map((a) => `${n(a.company)}|${n(a.role)}`));
  const base = `${(settings.data?.resume_root ?? '~/Desktop/Adam_Kuhn_Resumes').replace(/\/$/, '')}/Base_Resume/Adam_Kuhn_Resume.pdf`;
  const tailored = tailoredResumes(outreach.data ?? []);
  return (
    <Card aria-labelledby="resumes-h">
      <CardHead id="resumes-h" title="Resumes" />
      <div className="resume-row">
        <span><FileText size={16} aria-hidden /> Base resume</span>
        <span className="muted small resume-path">{base}</span>
        <CopyButton text={base} label="Copy path" />
      </div>
      {outreach.isPending ? <Skeleton label="Loading resumes" /> : tailored.length === 0 ? (
        <Empty>No tailored resumes yet. Tailor resume on a job makes one.</Empty>
      ) : (
        <ul className="list">
          {tailored.map((o) => {
            const applied = !!o.company && inSheet.has(`${n(o.company)}|${n(o.role)}`);
            return (
              <li key={o.id} className="resume-row">
                <span><b>{o.company ?? 'Unknown company'}</b>{o.role && <span className="small"> · {o.role}</span>}</span>
                <span className="muted small">{shortDate(o.created_at.slice(0, 10))}{applied ? ' · Applied ✓' : ''}</span>
                <span className="muted small resume-path">{o.resume_path}</span>
                <CopyButton text={o.resume_path!} label="Copy path" />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Download everything as JSON, or have Claude on the Mac turn it into a visual PDF report. */
function ExportCard() {
  const api = useApi();
  const requests = useLaunchRequests();
  const launch = useRequestLaunch();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const report = launchState(requests.data ?? [], (r) => r.kind === 'report', useNow());
  const download = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const now = new Date();
      downloadJson(await buildExport(api, now), exportFilename(now));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card aria-labelledby="export-h">
      <CardHead id="export-h" title="Your data" />
      <p className="muted small">Everything Lock In has on you: LeetCode, applications, outreach, projects and commits, prep, calendar, profile, links and resume paths.</p>
      <div className="row-actions">
        <Button onClick={download} disabled={busy}><Download size={18} aria-hidden /> {busy ? 'Gathering…' : 'Download data'}</Button>
        <Button variant="primary" disabled={report.kind === 'queued' || launch.isPending}
          onClick={() => launch.mutate({ kind: 'report', payload: {} })}>
          <Sparkles size={18} aria-hidden />
          {report.kind === 'queued' ? 'Queued for Mac' : report.kind === 'failed' ? 'Try again' : 'Make PDF report'}
        </Button>
      </div>
      <p className="muted small" role="status">
        {report.kind === 'launched' ? 'Opened on Mac. Claude saves the PDF to your resume folder under Reports and opens it.'
          : 'Claude on your Mac turns all of it, plus your resume, into a visual season report.'}
      </p>
      {report.kind === 'failed' && <ErrorDetail error={report.error} />}
      {failed && <p role="alert" className="error small">Couldn't gather your data. Try again.</p>}
      {launch.isError && <p role="alert" className="error small">Couldn't queue it. Try again.</p>}
    </Card>
  );
}

export default function Me() {
  const now = useNow();
  const stale = anyStale(useSyncStatus().data ?? [], now);
  const stories = useStories();
  const count = stories.data?.length;
  return (
    <div className="screen">
      <header className="screen-head"><h1>Me</h1></header>
      <ProfileCard />
      <SeasonRecordCard />
      <ResumeHub />
      <ExportCard />
      <nav className="links" aria-label="More">
        <Link className="row-link" to="/grind/prep">
          <span><BookOpen size={18} aria-hidden /> Story bank{count !== undefined && <span className="muted"> · {count} {count === 1 ? 'story' : 'stories'}</span>}</span>
          <ChevronRight size={18} aria-hidden />
        </Link>
        <Link className="row-link" to="/me/share"><span><Share2 size={18} aria-hidden /> Share today's card</span><ChevronRight size={18} aria-hidden /></Link>
        <Link className="row-link" to="/me/settings">
          <span>Settings{stale && <span className="sr-only"> (a sync is stale)</span>}</span>
          <span>{stale && <span className="dot" aria-hidden />}<ChevronRight size={18} aria-hidden /></span>
        </Link>
      </nav>
    </div>
  );
}
