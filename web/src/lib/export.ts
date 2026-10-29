import type { DataApi } from '../data/api';
import type { Application, Commit, Idea, Outreach, Problem, Project, Solve, TopicState } from '../data/types';
import { mergedProfile } from './profile';

/** Before every row the app can read. */
const EPOCH = '1970-01-01T00:00:00Z';

const countBy = <T>(list: T[], key: (x: T) => string | null | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of list) {
    const k = key(x) ?? 'unknown';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

/** Totals at the top of the file, so it reads without scrolling through every row. */
export function exportSummary(d: {
  solves: Solve[]; problems: Problem[]; topicStates: TopicState[]; applications: Application[]; outreach: Outreach[];
  projects: Project[]; commits: Commit[]; ideas: Idea[];
}) {
  const bySlug = new Map(d.problems.map((p) => [p.slug, p]));
  const solved = [...new Set(d.solves.map((s) => s.slug))];
  return {
    leetcode: {
      solved: solved.length,
      submissions: d.solves.length,
      by_difficulty: countBy(solved, (slug) => bySlug.get(slug)?.difficulty),
      by_topic: countBy(solved, (slug) => bySlug.get(slug)?.topic),
      topic_levels: Object.fromEntries(d.topicStates.map((t) => [t.topic, t.level])),
    },
    applications: {
      total: d.applications.length,
      by_stage: countBy(d.applications, (a) => a.stage),
      by_status: countBy(d.applications, (a) => a.status),
    },
    outreach: {
      total: d.outreach.length,
      sent: d.outreach.filter((o) => o.sent_on).length,
      by_status: countBy(d.outreach, (o) => o.status),
    },
    projects: d.projects.map((p) => ({
      id: p.id, name: p.name, repo: p.repo, active: p.active,
      commits: d.commits.filter((c) => c.project_id === p.id).length,
      ideas: countBy(d.ideas.filter((i) => i.project_id === p.id), (i) => i.status),
    })),
  };
}

/** Everything Lock In stores for the signed-in user, as one JSON-ready object. */
export async function buildExport(api: DataApi, now: Date) {
  const [
    settings, problems, topics, topicStates, problemStates, solves, projects, commits, ideas, applications, postings,
    outreach, contacts, launchRequests, syncStatus, stories, prepSessions, prepItems, prepProgress, companyPrep, events, referrals,
  ] = await Promise.all([
    api.getSettings(), api.listProblems(), api.listTopics(), api.listTopicStates(), api.listProblemStates(), api.listSolves(),
    api.listProjects(), api.listCommits(EPOCH), api.listIdeas(), api.listApplications(), api.listPostings(EPOCH),
    api.listOutreach(), api.listContacts(), api.listLaunchRequests(), api.listSyncStatus(), api.listStories(),
    api.listPrepSessions(EPOCH.slice(0, 10)), api.listPrepItems(), api.listPrepProgress(), api.listCompanyPrep(), api.listEvents(),
    api.listReferrals(),
  ]);
  const root = settings.resume_root.replace(/\/$/, '');
  const profile = mergedProfile(settings.profile);
  return {
    exported_at: now.toISOString(),
    format: 'lock-in-export/1',
    summary: exportSummary({ solves, problems, topicStates, applications, outreach, projects, commits, ideas }),
    profile,
    links: {
      github: profile.github || null,
      linkedin: profile.linkedin || null,
      portfolio: profile.portfolio || null,
      leetcode: settings.lc_username ? `https://leetcode.com/u/${settings.lc_username}/` : null,
      projects: projects.filter((p) => p.repo).map((p) => ({ name: p.name, url: `https://github.com/${p.repo}` })),
    },
    settings,
    resumes: {
      note: 'The PDFs live on the Mac; these are their paths.',
      base: `${root}/Base_Resume/Adam_Kuhn_Resume.pdf`,
      tailored: outreach.filter((o) => o.resume_path).map((o) => ({ company: o.company, role: o.role, path: o.resume_path, created_at: o.created_at })),
    },
    leetcode: { solves, problem_states: problemStates, topic_states: topicStates, topics, problems },
    applications,
    postings,
    outreach: { cards: outreach, contacts, engineers: referrals },
    projects: { projects, commits, ideas },
    prep: { stories, sessions: prepSessions, items: prepItems, progress: prepProgress, companies: companyPrep },
    calendar: events,
    launch_requests: launchRequests,
    sync_status: syncStatus,
  };
}

export const exportFilename = (now: Date) => `lock-in-export-${now.toISOString().slice(0, 10)}.json`;

/** Saves the export as a JSON file through the browser's download. */
export function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
