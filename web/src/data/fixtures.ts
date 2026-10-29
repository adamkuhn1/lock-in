import learning from '../../../shared/learning.json';
import prepItems from '../../../shared/prep_items.json';
import { addDays, localDay, planDay } from '../lib/time';
import type {
  Application, CalEvent, LearnCheck, LearnItem, LearnModule, LearnModuleState, LearnProgress, LearnTrack, LearnType, Commit, CompanyPrep, Contact, DailySet, Difficulty, Idea, LaunchRequest, Level, Outreach, Posting,
  PrepItem, PrepProgress, PrepSession, Problem, ProblemState, Project, Rating, Referral, ReferralPick, Settings, Solve, Stage, Story, SyncStatus, Tier,
  Topic, TopicState,
} from './types';

export interface DemoDb {
  settings: Settings;
  dailySet: DailySet;
  problems: Problem[];
  topics: Topic[];
  topicStates: TopicState[];
  problemStates: ProblemState[];
  solves: Solve[];
  projects: Project[];
  commits: Commit[];
  ideas: Idea[];
  applications: Application[];
  postings: Posting[];
  outreach: Outreach[];
  contacts: Contact[];
  referrals: Referral[];
  learnModules: LearnModule[];
  learnItems: LearnItem[];
  learnProgress: LearnProgress[];
  learnStates: LearnModuleState[];
  learnChecks: LearnCheck[];
  launchRequests: LaunchRequest[];
  syncStatus: SyncStatus[];
  stories: Story[];
  prepSessions: PrepSession[];
  prepItems: PrepItem[];
  prepProgress: PrepProgress[];
  companyPrep: CompanyPrep[];
  events: CalEvent[];
}

const TOPICS: [string, number, string[]][] = [
  ['Arrays & Hashing', 0, []], ['Two Pointers', 1, ['Arrays & Hashing']], ['Stack', 1, ['Arrays & Hashing']],
  ['Binary Search', 2, ['Two Pointers']], ['Sliding Window', 2, ['Two Pointers']], ['Linked List', 2, ['Two Pointers']],
  ['Trees', 3, ['Linked List', 'Binary Search']], ['Tries', 4, ['Trees']], ['Heap / Priority Queue', 4, ['Trees']],
  ['Backtracking', 4, ['Trees']], ['Graphs', 5, ['Backtracking']], ['1-D Dynamic Programming', 5, ['Backtracking']],
  ['Intervals', 5, ['Heap / Priority Queue']], ['Greedy', 5, ['Heap / Priority Queue']],
  ['Advanced Graphs', 6, ['Heap / Priority Queue', 'Graphs']], ['2-D Dynamic Programming', 6, ['Graphs', '1-D Dynamic Programming']],
  ['Bit Manipulation', 6, ['1-D Dynamic Programming']], ['Math & Geometry', 7, ['2-D Dynamic Programming', 'Bit Manipulation']],
];
const LEVELS: Record<string, Level> = {
  'Arrays & Hashing': 'solid', 'Two Pointers': 'practicing', Stack: 'practicing', 'Binary Search': 'available',
  'Sliding Window': 'learning', 'Linked List': 'available',
};
const PROBLEMS: [string, string, Difficulty, string, number][] = [
  ['two-sum', 'Two Sum', 'Easy', 'Arrays & Hashing', 1],
  ['valid-anagram', 'Valid Anagram', 'Easy', 'Arrays & Hashing', 242],
  ['group-anagrams', 'Group Anagrams', 'Medium', 'Arrays & Hashing', 49],
  ['top-k-frequent-elements', 'Top K Frequent Elements', 'Medium', 'Arrays & Hashing', 347],
  ['product-of-array-except-self', 'Product of Array Except Self', 'Medium', 'Arrays & Hashing', 238],
  ['valid-palindrome', 'Valid Palindrome', 'Easy', 'Two Pointers', 125],
  ['3sum', '3Sum', 'Medium', 'Two Pointers', 15],
  ['container-with-most-water', 'Container With Most Water', 'Medium', 'Two Pointers', 11],
  ['valid-parentheses', 'Valid Parentheses', 'Easy', 'Stack', 20],
  ['daily-temperatures', 'Daily Temperatures', 'Medium', 'Stack', 739],
  ['best-time-to-buy-and-sell-stock', 'Best Time to Buy and Sell Stock', 'Easy', 'Sliding Window', 121],
  ['contains-duplicate-ii', 'Contains Duplicate II', 'Easy', 'Sliding Window', 219],
  ['longest-substring-without-repeating-characters', 'Longest Substring Without Repeating Characters', 'Medium', 'Sliding Window', 3],
  ['longest-repeating-character-replacement', 'Longest Repeating Character Replacement', 'Medium', 'Sliding Window', 424],
  ['permutation-in-string', 'Permutation in String', 'Medium', 'Sliding Window', 567],
  ['minimum-window-substring', 'Minimum Window Substring', 'Hard', 'Sliding Window', 76],
];
const HISTORY: [number, string, Rating][] = [
  [1, 'valid-anagram', 'nailed'], [1, 'group-anagrams', 'struggled'], [2, '3sum', 'struggled'], [2, 'valid-palindrome', 'nailed'],
  [3, 'container-with-most-water', 'help'], [4, 'valid-parentheses', 'nailed'], [5, 'top-k-frequent-elements', 'nailed'],
  [5, 'product-of-array-except-self', 'struggled'], [6, 'two-sum', 'nailed'], [8, 'group-anagrams', 'nailed'],
  [9, 'valid-anagram', 'nailed'], [10, '3sum', 'help'], [11, 'two-sum', 'struggled'], [13, 'valid-palindrome', 'nailed'],
  [16, 'contains-duplicate-ii', 'nailed'], [20, 'top-k-frequent-elements', 'struggled'], [24, 'valid-parentheses', 'struggled'],
  [30, 'product-of-array-except-self', 'help'], [45, 'container-with-most-water', 'struggled'],
];
const APPS: [string, string, Stage, string, number][] = [
  ['Stripe', 'Software Engineer Intern, Winter 2027', 'oa', 'OA invited', 9],
  ['Ramp', 'Software Engineer Intern', 'applied', 'Submitted', 1],
  ['Figma', 'Software Engineer Intern, Spring 2027', 'applied', 'Submitted', 2],
  ['Datadog', 'Software Engineer Intern', 'interview', 'Interview - R1', 14],
  ['Ford', 'Software Engineering Co-op, Winter 2027', 'applied', 'Submitted', 0],
  ['GM', 'Software Developer Intern', 'applied', 'Submitted', 2],
  ['Rocket Companies', 'Software Engineer Intern', 'closed', 'Rejected', 20],
  ['Amazon', 'SDE Intern 2027', 'oa', 'OA - HackerRank', 6],
  ['Duolingo', 'Software Engineer Intern', 'applied', 'Submitted', 4],
  ['Notion', 'Software Engineer, New Grad', 'applied', 'Submitted', 8],
  ['Robinhood', 'Software Engineer Intern', 'closed', 'Rejected', 18],
  ['Palantir', 'Forward Deployed SWE Intern', 'interview', 'Final round', 12],
  ['Cloudflare', 'Software Engineer Intern', 'applied', 'Submitted', 3],
  ['Stryker', 'Software Engineering Co-op', 'applied', 'Submitted', 10],
  ['Capital One', 'Technology Internship Program', 'applied', 'Submitted', 16],
  ["Domino's", 'Software Engineer Intern', 'applied', 'Submitted', 5],
  ['Plaid', 'Software Engineer Intern', 'applied', 'Submitted', 11],
  ['Ally', 'Technology Intern', 'closed', 'No response', 25],
  ['Coinbase', 'Software Engineer Intern', 'closed', 'Rejected after OA', 15],
  ['Whoop', 'Software Engineer Co-op', 'applied', 'Submitted', 1],
  ['Epic Games', 'Software Engineer Intern', 'applied', 'Submitted', 22],
];
const POSTINGS: [string, string, string, string, string | null, boolean, Tier, number][] = [
  ['p1', 'Stripe', 'Software Engineer Intern, Winter 2027', 'Chicago, IL', 'Winter 2027', true, 'reach', 2],
  ['p2', 'Ford', 'Software Engineering Co-op', 'Dearborn, MI', 'Winter 2027', true, 'midwest', 5],
  ['p3', 'Ramp', 'Software Engineer, New Grad', 'New York, NY', null, false, 'reach', 8],
  ['p4', 'Cloudflare', 'Software Engineer Intern', 'Remote - US', 'Summer 2027', false, 'volume', 20],
  ['p5', 'Duolingo', 'Software Engineer Intern', 'Pittsburgh, PA', 'Summer 2027', false, 'reach', 26],
  ['p6', 'Rocket Companies', 'Software Engineer Intern', 'Detroit, MI', 'Spring 2027', true, 'midwest', 30],
  ['p7', 'Datadog', 'Software Engineer, Early Career', 'New York, NY; Boston, MA', null, false, 'volume', 40],
  ['p8', 'Robinhood', 'Software Engineer Intern', 'Menlo Park, CA', 'Summer 2027', false, 'volume', 50],
];

/** Demo tiers, as the worker's Sheet sync would set them from worker/config/companies.yaml. */
const APP_TIER: Record<string, Tier> = {
  Stripe: 'reach', Ramp: 'reach', Figma: 'reach', Amazon: 'reach', Duolingo: 'reach', Palantir: 'reach', Plaid: 'reach', Coinbase: 'reach',
  Ford: 'midwest', GM: 'midwest', 'Rocket Companies': 'midwest', Stryker: 'midwest', "Domino's": 'midwest', Ally: 'midwest',
};

type RawItem = { id: string; type: string; title: string; url: string | null; hours: number; project?: string | null; check?: string | null; details?: string };
/** The real tracks from shared/learning.json, shaped like the learn_modules / learn_items rows the worker writes. */
export function learningContent(): { modules: LearnModule[]; items: LearnItem[] } {
  const modules: LearnModule[] = [];
  const items: LearnItem[] = [];
  for (const t of learning.tracks) {
    for (const m of t.modules) {
      modules.push({ id: m.id, track: t.id as LearnTrack, ord: m.ord, title: m.title, summary: m.summary ?? '' });
      (m.items as RawItem[]).forEach((it, i) => items.push({
        id: it.id, module_id: m.id, ord: i + 1, type: it.type as LearnType, title: it.title, url: it.url ?? null, hours: it.hours,
        project: it.type === 'build' ? it.project ?? null : null, check_kind: (it.check ?? null) as LearnItem['check_kind'], details: it.details ?? '',
      }));
    }
  }
  return { modules, items };
}

/** Demo Best fit shortlist: what a Find best fits run saves. */
const BEST_FIT: Record<string, Partial<Posting>> = {
  p3: { fit_rank: 1, fit_reason: 'New-grad fintech role in NYC; React + TypeScript match his projects.' },
  p2: { fit_rank: 3, fit_reason: 'Winter co-op in Michigan, close to school; open to 2027 grads.' },
};

export function createFixtures(now: Date): DemoDb {
  const day = planDay(now);
  const today = localDay(now);
  const at = (daysAgo: number) => `${addDays(today, -daysAgo)}T18:00:00Z`; // 14:00 EDT / 13:00 EST that day
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const ref = (id: string, request_id: string, company: string, role: string, posting_id: string | null, name: string, title: string,
    pick: ReferralPick, why: string, note: string, over: Partial<Referral>): Referral => ({
    id, request_id, company, role, posting_id, job_url: null, tier: APP_TIER[company] ?? 'reach', name, title, pick, why, note,
    profile_url: `https://www.linkedin.com/in/example-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    status: 'drafted', sent_on: null, accepted_on: null, followed_up_on: null, replied_on: null, referred_on: null, created_at: now.toISOString(), ...over,
  });
  let solveId = 1;
  const solve = (slug: string, accepted_at: string, rating: Rating | null): Solve => ({
    id: solveId++, slug, title: PROBLEMS.find((p) => p[0] === slug)![1], accepted_at, rating,
    rated_at: rating ? accepted_at : null, applied_at: accepted_at, slot: null, note: null,
  });

  return {
    settings: {
      nudge_times: ['10:00', '18:00', '22:00'], daily_lc_count: 6, weekly_app_target: 25, ntfy_topic: null,
      resume_root: '~/Desktop/Adam_Kuhn_Resumes', sheet_id: 'demo-sheet-id', lc_username: 'adamkuhn',
      lc_started_on: addDays(day, -11), lc_focus_topic: 'Sliding Window', lc_focus_since: addDays(day, -3), app_url: null,
      day_one: addDays(day, -20), weekly_email_target: 10, weekly_engineer_target: 10, job_alerts: false,
    },
    dailySet: {
      day, focus: 'Sliding Window', mixed_day: false,
      items: [
        { slug: 'two-sum', slot: 'review', order: 0, done: true },
        { slug: 'best-time-to-buy-and-sell-stock', slot: 'new', order: 1, done: false },
        { slug: 'contains-duplicate-ii', slot: 'new', order: 2, done: false },
        { slug: 'longest-substring-without-repeating-characters', slot: 'new', order: 3, done: false },
        { slug: 'daily-temperatures', slot: 'mystery', order: 4, done: false },
        { slug: 'permutation-in-string', slot: 'new', order: 5, done: false },
      ],
    },
    problems: PROBLEMS.map(([slug, title, difficulty, topic, lc_id]) => ({
      slug, title, difficulty, topic, lc_id, lists: ['nc150'], paid_only: false, ac_rate: 50, target_minutes: null, neetcode_link: null,
    })),
    topics: TOPICS.map(([name, tier, prereqs], i) => ({ name, tier, prereqs, ord: i + 1, lc_tags: [] })),
    topicStates: TOPICS.map(([name]) => ({ topic: name, level: LEVELS[name] ?? 'locked' })),
    problemStates: [
      { slug: 'valid-anagram', state: 'reviewing', interval_days: 3, due_on: day, lapses: 0 },
      { slug: 'group-anagrams', state: 'learning', interval_days: 1, due_on: addDays(day, -1), lapses: 1 },
      { slug: '3sum', state: 'reviewing', interval_days: 3, due_on: addDays(day, 3), lapses: 1 },
      { slug: 'container-with-most-water', state: 'learning', interval_days: 1, due_on: addDays(day, 5), lapses: 2 },
      { slug: 'two-sum', state: 'reviewing', interval_days: 7, due_on: addDays(day, 7), lapses: 0 },
    ],
    solves: [
      { ...solve('best-time-to-buy-and-sell-stock', minsAgo(1), null), applied_at: null },
      { ...solve('two-sum', minsAgo(2), 'nailed'), applied_at: null },
      ...HISTORY.map(([d, slug, rating]) => solve(slug, at(d), rating)),
      solve('contains-duplicate-ii', at(7), null), // applied but never rated: too late to rate
    ],
    projects: [
      { id: '27b', name: '27B', repo: 'adamkuhn1/27b', local_path: '~/Developer/27b', active: true },
      { id: 'showboat', name: 'Showboat', repo: 'adamkuhn1/showboat', local_path: '~/Developer/showboat', active: true },
      { id: 'lego', name: 'LEGO', repo: null, local_path: '~/Developer/lego', active: true },
    ],
    commits: [
      ...[1, 2, 4, 7, 9, 15].map((d, i) => ({ sha: `27b${i}`, project_id: '27b', message: ['Add city search', 'Fix map zoom', 'Cache tiles', 'Add tests for routing', 'Refactor store', 'Initial map view'][i], committed_at: at(d) })),
      ...[3, 10, 20].map((d, i) => ({ sha: `sb${i}`, project_id: 'showboat', message: ['Polish landing page', 'Add auth', 'Scaffold app'][i], committed_at: at(d) })),
    ],
    ideas: [
      { id: 'i1', project_id: '27b', text: 'Add Chicago to the city picker', size: 'S', status: 'today', source: 'me', position: 0, today_on: day, done_at: null, started_at: null, created_at: hoursAgo(200) },
      { id: 'i2', project_id: '27b', text: 'Cache weather API responses', size: 'S', status: 'todo', source: 'me', position: 1, today_on: null, done_at: null, started_at: null, created_at: hoursAgo(190) },
      { id: 'i3', project_id: '27b', text: 'Add README screenshots', size: 'S', status: 'todo', source: 'claude', position: 2, today_on: null, done_at: null, started_at: null, created_at: hoursAgo(100) },
      { id: 'i4', project_id: '27b', text: 'Offline mode for saved trips', size: 'M', status: 'todo', source: 'claude', position: 3, today_on: null, done_at: null, started_at: null, created_at: hoursAgo(100) },
      { id: 'i5', project_id: 'showboat', text: 'Add loading skeletons to the feed', size: 'S', status: 'todo', source: 'me', position: 0, today_on: null, done_at: null, started_at: null, created_at: hoursAgo(300) },
      { id: 'i6', project_id: 'showboat', text: 'Fix nav overlap on small phones', size: 'S', status: 'todo', source: 'me', position: 1, today_on: null, done_at: null, started_at: null, created_at: hoursAgo(250) },
      { id: 'i7', project_id: 'showboat', text: 'End-to-end test for sign-up', size: 'M', status: 'done', source: 'me', position: 2, today_on: addDays(day, -3), done_at: hoursAgo(70), started_at: null, created_at: hoursAgo(400) },
    ],
    applications: APPS.map(([company, role, stage, status, d], id) => ({
      id: id + 1, company, role, stage, status, track: role.includes('New Grad') ? 'New grad' : 'Internship', term: null,
      location: null, priority: null, applied_on: addDays(today, -d), tier: APP_TIER[company] ?? 'volume',
    })),
    postings: [
      ...POSTINGS.map(([id, company, title, location, term, starred, tier, h]) => ({
        id, company, title, location, term, starred, tier, status: 'new' as const, posted_at: hoursAgo(h), found_at: hoursAgo(h),
        url: `https://boards.greenhouse.io/${company.toLowerCase().replace(/[^a-z]/g, '')}/jobs/${4000000 + h}`,
        ...BEST_FIT[id],
      })),
      {
        id: 'p9', company: 'Lakeshore Labs', title: 'Software Engineer, New Grad 2027', location: 'Chicago, IL', term: null, starred: true,
        tier: 'midwest' as const, status: 'new' as const, posted_at: null, found_at: hoursAgo(1), url: 'https://jobs.ashbyhq.com/lakeshorelabs/2027-new-grad',
        fit_rank: 2, fit_reason: 'Found on their careers page: TypeScript + Postgres backend, Chicago, 2027 grads.', found_by: 'claude',
      },
      {
        id: 'p10', company: 'Anduril', title: 'Software Engineer, New Grad', location: 'Costa Mesa, CA', term: null, starred: false,
        tier: 'reach' as const, status: 'filtered' as const, posted_at: hoursAgo(12), found_at: hoursAgo(11),
        url: 'https://boards.greenhouse.io/andurilindustries/jobs/4000012', filtered_reason: 'Needs 2+ years of experience',
      },
      {
        id: 'p11', company: 'Notion', title: 'Software Engineer, New Grad 2026', location: 'San Francisco, CA', term: null, starred: false,
        tier: 'volume' as const, status: 'filtered' as const, posted_at: hoursAgo(30), found_at: hoursAgo(30),
        url: 'https://jobs.ashbyhq.com/notion/2026', filtered_reason: "Title doesn't fit (filters.yaml)",
      },
    ],
    outreach: [
      { id: 'o2', job_url: 'https://jobs.ashbyhq.com/ramp/7d1c', company: 'Ramp', role: 'Software Engineer Intern', resume_path: null, status: 'queued', sent_on: null, follow_up_on: null, followups: 0, created_at: minsAgo(5), tier: 'reach', replied_on: null },
      { id: 'o3', job_url: 'https://jobs.lever.co/datadog/1', company: 'Datadog', role: 'Software Engineer Intern', resume_path: null, status: 'sent', sent_on: day, follow_up_on: addDays(day, 1), followups: 0, created_at: hoursAgo(30), tier: 'volume', replied_on: null },
      { id: 'o4', job_url: 'https://jobs.lever.co/palantir/2', company: 'Palantir', role: 'FDSE Intern', resume_path: null, status: 'sent', sent_on: day, follow_up_on: addDays(day, 6), followups: 0, created_at: hoursAgo(50), tier: 'reach', replied_on: null },
      { id: 'o5', job_url: 'https://jobs.lever.co/figma/3', company: 'Figma', role: 'Software Engineer Intern', resume_path: null, status: 'sent', sent_on: addDays(day, -5), follow_up_on: day, followups: 0, created_at: hoursAgo(130), tier: 'reach', replied_on: null },
      { id: 'o6', job_url: 'https://capitalone.wd12.myworkdayjobs.com/Capital_One/job/1', company: 'Capital One', role: 'Technology Internship Program', resume_path: null, status: 'replied', sent_on: addDays(day, -12), follow_up_on: addDays(day, -7), followups: 0, created_at: hoursAgo(300), tier: 'volume', replied_on: addDays(day, -9) },
      { id: 'o1', job_url: 'https://boards.greenhouse.io/stripe/jobs/4000002', company: 'Stripe', role: 'Software Engineer Intern, Winter 2027', resume_path: '/Users/adamk/Desktop/Adam_Kuhn_Resumes/Stripe_SWE_Intern_2027/Adam_Kuhn_Resume.pdf', status: 'drafted', sent_on: null, follow_up_on: null, followups: 0, created_at: hoursAgo(26), tier: 'reach', replied_on: null },
    ],
    referrals: [
      ref('f1', 'rq-stripe', 'Stripe', 'Software Engineer Intern, Winter 2027', 'p1', 'Maya Chen', 'Software Engineer, Payments', 'ex_apple',
        'Snippet: "Software Engineer at Stripe · Previously Apple (Apple Pay)".',
        "Hi Maya, I was a SWE intern at Apple this summer and saw you moved from Apple Pay to Stripe Payments. I just applied to the Software Engineer Intern, Winter 2027 role. Would you be open to referring me? Thanks! Adam",
        { status: 'accepted', sent_on: addDays(day, -6), accepted_on: addDays(day, -3), created_at: hoursAgo(160) }),
      ref('f2', 'rq-stripe', 'Stripe', 'Software Engineer Intern, Winter 2027', 'p1', 'Jordan Fields', 'Software Engineer', 'cmu',
        'Snippet: "Central Michigan University · Software Engineer at Stripe".',
        "Hi Jordan, fellow CMU Chippewa here! I was a SWE intern at Apple this summer and just applied to Stripe's Software Engineer Intern, Winter 2027 role. Could I ask you one quick question about the team? Thanks, Adam",
        { status: 'sent', sent_on: addDays(day, -2), created_at: hoursAgo(160) }),
      ref('f3', 'rq-ramp', 'Ramp', 'Software Engineer, New Grad', 'p3', 'Ava Park', 'Software Engineer, Card Platform', 'ex_apple',
        'Snippet: "Ramp · Apple (Wallet) 2021-2024".',
        "Hi Ava, I was a SWE intern at Apple this summer and noticed you were on Wallet before Ramp. I'm applying to Ramp's Software Engineer, New Grad role. Would you be open to referring me? Thanks! Adam",
        { created_at: minsAgo(40) }),
      ref('f4', 'rq-ramp', 'Ramp', 'Software Engineer, New Grad', 'p3', 'Leo Brandt', 'Backend Engineer', 'team',
        'Works on the Bill Pay team named in the posting (engineering blog post).',
        "Hi Leo, I was a SWE intern at Apple this summer and just read your Bill Pay post. I'm applying to Ramp's Software Engineer, New Grad role. Could I ask one quick question about the team? Thanks, Adam",
        { created_at: minsAgo(40) }),
      ref('f5', 'rq-figma', 'Figma', 'Software Engineer Intern, Spring 2027', null, 'Nina Shah', 'Software Engineer', 'ex_apple',
        'Snippet: "Figma · ex-Apple (Xcode)".',
        "Hi Nina, I was a SWE intern at Apple this summer and saw you came to Figma from the Xcode team. I applied to the Software Engineer Intern, Spring 2027 role. Would you be open to referring me? Thanks! Adam",
        { status: 'referred', sent_on: addDays(day, -10), accepted_on: addDays(day, -9), followed_up_on: addDays(day, -6), replied_on: addDays(day, -5), referred_on: addDays(day, -4), created_at: hoursAgo(260) }),
      ref('f6', 'rq-palantir', 'Palantir', 'Forward Deployed SWE Intern', null, 'Chris Moreno', 'Forward Deployed Engineer', 'team',
        'Forward Deployed Engineer, same org as the role (conference talk).',
        "Hi Chris, I was a SWE intern at Apple this summer and I'm in the running for Palantir's Forward Deployed SWE Intern role. Could I ask you one quick question about the work? Thanks, Adam",
        { status: 'closed', sent_on: addDays(day, -14), created_at: hoursAgo(350) }),
    ],
    contacts: [
      {
        id: 'c1', outreach_id: 'o1', name: 'Dana Reyes', title: 'University Recruiter', linkedin_url: 'https://www.linkedin.com/in/example-dana',
        email_guess: 'dreyes@stripe.com', email_confidence: 'pattern', why: 'Runs early-career hiring for Payments; pattern from a public talk page.',
        draft_subject: 'CMU student, Winter 2027 SWE intern',
        draft_body: "Hi Dana,\n\nI saw your post about Stripe's Winter 2027 intern class and applied to the Software Engineer Intern role. I'm a CS student at Central Michigan University graduating May 2027 (flexible through December).\n\nI built 27B, a trip planner that caches map tiles offline and handles 2k daily users. Payments reliability is the kind of problem I want to work on next.\n\nWould you be open to a 15-minute chat, or pointing me to the right recruiter for Payments?\n\nThanks,\nAdam",
      },
      {
        id: 'c2', outreach_id: 'o1', name: 'Marcus Lee', title: 'Software Engineer, Payments', linkedin_url: 'https://www.linkedin.com/in/example-marcus',
        email_guess: 'mlee@stripe.com', email_confidence: 'guess', why: 'Michigan alum on the team named in the posting.',
        draft_subject: 'Fellow Michigander, Payments intern question',
        draft_body: "Hi Marcus,\n\nI'm a CS student at Central Michigan University and noticed you went to school in Michigan too. I applied to Stripe's Winter 2027 SWE intern role on Payments.\n\nMy project 27B taught me a lot about caching and failure modes. I'd love to hear what the team's first month looks like for interns.\n\nWould you have 15 minutes in the next couple of weeks?\n\nThanks,\nAdam",
      },
      {
        id: 'c3', outreach_id: 'o5', name: 'Priya Nair', title: 'University Recruiter', linkedin_url: null,
        email_guess: 'pnair@figma.com', email_confidence: 'pattern', why: null,
        draft_subject: 'CMU student, Figma SWE intern', draft_body: "Hi Priya,\n\nI applied to Figma's Software Engineer Intern role and would love to chat.\n\nThanks,\nAdam",
      },
    ],
    ...(() => {
      const { modules, items } = learningContent();
      const first = (mod: string, type: LearnType) => items.find((i) => i.module_id === mod && i.type === type)?.id;
      const prog = (id: string | undefined, over: Partial<LearnProgress>): LearnProgress[] =>
        id ? [{ item_id: id, status: 'done', rating: null, notes: '', started_on: addDays(day, -6), done_on: addDays(day, -2), ...over }] : [];
      const math1 = modules.find((m) => m.track === 'math' && m.ord === 1)?.id ?? 'math-1';
      return {
        learnModules: modules, learnItems: items,
        learnProgress: [
          ...prog(first('cs-1', 'watch'), { rating: 'nailed', notes: `${addDays(day, -2)}: clock and registers clicked` }),
          ...prog(first('cs-1', 'do'), { status: 'in_progress', done_on: null, started_on: addDays(day, -1) }),
          ...items.filter((i) => i.module_id === math1).flatMap((i) => prog(i.id, { rating: 'struggled', started_on: addDays(day, -20), done_on: addDays(day, -12) })),
        ],
        learnStates: [{ module_id: math1, done_on: addDays(day, -10) }],
        learnChecks: [{ id: 'lc1', module_id: math1, kind: 'check' as const, score: 4, total: 6, rating: 'struggled' as const,
          summary: 'Chain rule solid; shaky on partial derivatives.', taken_on: addDays(day, -10) }],
      };
    })(),
    launchRequests: [
      { id: 'rq-ramp', kind: 'find_engineers', payload: { posting_id: 'p3', company: 'Ramp', role: 'Software Engineer, New Grad', tier: 'reach' }, status: 'launched', error: null, created_at: minsAgo(45) },
      { id: 'r1', kind: 'outreach', payload: { outreach_id: 'o2', job_url: 'https://jobs.ashbyhq.com/ramp/7d1c' }, status: 'queued', error: null, created_at: minsAgo(5) },
    ],
    syncStatus: [
      { source: 'leetcode', last_ok_at: minsAgo(12), last_error: null, consecutive_failures: 0 },
      { source: 'github', last_ok_at: minsAgo(12), last_error: null, consecutive_failures: 0 },
      { source: 'sheet', last_ok_at: hoursAgo(3), last_error: 'TransportError: timed out', consecutive_failures: 6 },
      { source: 'jobs', last_ok_at: minsAgo(12), last_error: null, consecutive_failures: 0 },
    ],
    stories: [
      { id: 's1', title: 'Shipped 27B to 2k users', tags: ['impact', 'leadership'], situation: 'Class project that grew', task: 'Keep it fast as usage grew', action: 'Added tile caching and load tests', result: 'p95 load 3.1s → 0.9s', last_practiced_on: addDays(day, -2), created_at: hoursAgo(500) },
      { id: 's2', title: 'Group project conflict', tags: ['conflict', 'teamwork'], situation: 'Two teammates disagreed on stack', task: 'Unblock the team', action: 'Ran a 1-hour spike on both options', result: 'Picked one with data; shipped on time', last_practiced_on: null, created_at: hoursAgo(400) },
    ],
    prepSessions: [
      { id: 'ps1', kind: 'oa', minutes: 45, note: 'HackerRank practice set', company: 'Amazon', story_id: null, happened_on: addDays(day, -1), created_at: hoursAgo(28) },
      { id: 'ps2', kind: 'mock', minutes: 30, note: 'Behavioral with Claude', company: null, story_id: null, happened_on: addDays(day, -3), created_at: hoursAgo(75) },
    ],
    prepItems: prepItems as PrepItem[],
    prepProgress: [{ item_id: 'sd-url-shortener', status: 'solid' }, { item_id: 'cs-http', status: 'learning' }],
    companyPrep: [
      { id: 'cp1', company: 'Datadog', notes: 'R2 is system design lite: metrics pipeline.', links: 'https://www.datadoghq.com/careers/', interview_on: addDays(day, 3), created_at: hoursAgo(100) },
    ],
    events: [
      { id: 'e1', title: 'Amazon OA due', kind: 'oa', on_date: addDays(day, 2), at_time: null, company: 'Amazon', url: null, created_at: hoursAgo(20) },
      { id: 'e2', title: 'Career fair', kind: 'other', on_date: addDays(day, 9), at_time: '10:00:00', company: null, url: null, created_at: hoursAgo(20) },
      { id: 'e3', title: 'Microsoft Explore deadline', kind: 'deadline', on_date: addDays(day, 16), at_time: null, company: 'Microsoft', url: null, created_at: hoursAgo(20) },
    ],
  };
}
