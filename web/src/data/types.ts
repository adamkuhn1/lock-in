import type { Profile } from '../lib/profile';
export type Rating = 'nailed' | 'struggled' | 'help';
export type Slot = 'new' | 'review' | 'mystery' | 'spot';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type Level = 'locked' | 'available' | 'learning' | 'practicing' | 'solid' | 'mastered';
export type Stage = 'applied' | 'oa' | 'interview' | 'offer' | 'closed' | 'other';
export type IdeaStatus = 'todo' | 'today' | 'in_progress' | 'done' | 'dropped';
export type PostingStatus = 'new' | 'seen' | 'dismissed' | 'outreach' | 'applied' | 'filtered';
/** reach = top startups, FAANG, Apple; volume = big new-grad programs; midwest = Midwest/Chicago (worker/config/companies.yaml). */
export type Tier = 'reach' | 'volume' | 'midwest';
/** filtered_reason on a posting Adam restored from Filtered; the worker won't file it away again. */
export const KEPT = 'Kept by Adam';
export type OutreachStatus = 'queued' | 'drafted' | 'sent' | 'replied' | 'closed';
export type LaunchStatus = 'queued' | 'launched' | 'failed';
export type LaunchKind = 'outreach' | 'suggest_ideas' | 'work_on_idea' | 'mock_interview' | 'tailor_resume' | 'best_fit' | 'report' | 'find_engineers'
  | 'teach_item' | 'check_module' | 'review_module';
export type Confidence = 'verified' | 'pattern' | 'guess';

export interface Settings {
  nudge_times: string[];
  daily_lc_count: number;
  weekly_app_target: number;
  ntfy_topic: string | null;
  resume_root: string;
  sheet_id: string | null;
  lc_username: string;
  lc_started_on: string | null;
  lc_focus_topic: string | null;
  lc_focus_since: string | null;
  app_url: string | null;
  day_one: string;
  weekly_email_target: number;
  /** LinkedIn notes to engineers per week (migration 0011; reads as 10 before it). */
  weekly_engineer_target?: number;
  /** Phone alert for each new reach or Midwest posting (migration 0011). */
  job_alerts?: boolean;
  /** Daily study time in minutes, split between interview prep and learning tracks (migration 0012; 180 before it). */
  study_minutes?: number;
  /** Percent of study_minutes for learning tracks; the rest is LeetCode + Prep (migration 0012; 30 before it). */
  learn_split?: number;
  /** Adam's profile, edited on Me (migration 0008). Absent before the migration. */
  profile?: Profile;
}
export type SettingsPatch = Partial<
  Pick<Settings, 'nudge_times' | 'daily_lc_count' | 'weekly_app_target' | 'resume_root' | 'app_url' | 'lc_focus_topic' | 'lc_focus_since' | 'day_one' | 'weekly_email_target' | 'weekly_engineer_target' | 'job_alerts' | 'study_minutes' | 'learn_split' | 'profile'>
>;

export interface SetItem { slug: string; slot: Slot; order: number; done: boolean }
export interface DailySet { day: string; focus: string; mixed_day: boolean; items: SetItem[] }

export interface Problem {
  slug: string;
  lc_id: number | null;
  title: string;
  difficulty: Difficulty;
  topic: string;
  lists: string[];
  paid_only: boolean;
  ac_rate: number | null;
  target_minutes: number | null;
  neetcode_link: string | null;
}
export interface Topic { name: string; ord: number; tier: number; prereqs: string[]; lc_tags: string[] }
export interface TopicState { topic: string; level: Level }
export interface ProblemState {
  slug: string;
  state: 'new' | 'learning' | 'reviewing' | 'retained' | 'parked';
  interval_days: number;
  due_on: string | null;
  lapses: number;
}
export interface Solve {
  id: number;
  slug: string;
  title: string;
  accepted_at: string;
  rating: Rating | null;
  rated_at: string | null;
  applied_at?: string | null; // set once the worker has counted this solve; absent = unapplied
  slot: Slot | null;
  note: string | null;
}

export interface Project { id: string; name: string; repo: string | null; local_path: string | null; active: boolean }
export type NewProject = Omit<Project, 'active'>;
export type ProjectPatch = Partial<Pick<Project, 'repo' | 'local_path'>>;
export interface Commit { sha: string; project_id: string; message: string; committed_at: string }
export interface Idea {
  id: string;
  project_id: string;
  text: string;
  size: 'S' | 'M';
  status: IdeaStatus;
  source: 'me' | 'claude';
  position: number;
  today_on: string | null;
  done_at: string | null;
  started_at: string | null;
  created_at: string;
}
export interface NewIdea { project_id: string; text: string; size: 'S' | 'M'; position: number }
export type IdeaPatch = Partial<Pick<Idea, 'status' | 'position' | 'today_on' | 'done_at' | 'text' | 'started_at'>>;

export interface Application {
  id: number;
  company: string;
  role: string | null;
  track: string | null;
  term: string | null;
  location: string | null;
  status: string | null;
  stage: Stage;
  priority: string | null;
  applied_on: string | null;
  /** 1-based row in the Sheet, set by the worker's sync (null/absent until then). */
  sheet_row?: number | null;
  /** Set by the worker's Sheet sync from the company and location (migration 0011). */
  tier?: Tier | null;
}
export interface MarkAppliedInput { posting_id?: string; outreach_id?: string; force?: boolean }
export interface UndoAppliedInput { company: string; role: string | null; sheet_row?: number | null }
export interface Posting {
  id: string;
  company: string;
  title: string;
  location: string | null;
  url: string | null;
  term: string | null;
  posted_at: string | null;
  tier: Tier | null;
  starred: boolean;
  status: PostingStatus;
  found_at: string;
  /** Best fit shortlist rank from Find best fits (1 = best); null or missing = not on it (migration 0009). */
  fit_rank?: number | null;
  /** Claude's one line on why it fits. */
  fit_reason?: string | null;
  /** 'claude' when Claude found it on the web rather than the job scanner. */
  found_by?: string | null;
  /** Why the worker filed it away (status 'filtered'), e.g. "Needs 3+ years of experience" (migration 0011). */
  filtered_reason?: string | null;
}
export interface Outreach {
  id: string;
  job_url: string;
  company: string | null;
  role: string | null;
  resume_path: string | null;
  status: OutreachStatus;
  sent_on: string | null;
  follow_up_on: string | null;
  /** Follow-ups sent so far (migration 0006; reads as 0 before it is applied). */
  followups: number;
  created_at: string;
  /** Copied from the posting when queued, otherwise set by the worker (migration 0011). */
  tier?: Tier | null;
  /** When the recruiter replied (migration 0011). Older replied cards have none. */
  replied_on?: string | null;
}
export type OutreachPatch = Partial<Pick<Outreach, 'status' | 'sent_on' | 'follow_up_on' | 'followups' | 'replied_on'>>;
export interface Contact {
  id: string;
  outreach_id: string;
  name: string;
  title: string | null;
  linkedin_url: string | null;
  email_guess: string | null;
  email_confidence: Confidence | null;
  why: string | null;
  draft_subject: string | null;
  draft_body: string | null;
}
export type ReferralStatus = 'drafted' | 'sent' | 'accepted' | 'replied' | 'referred' | 'closed';
/** Why Claude picked this engineer, in rank order: ex-Apple, Central Michigan alumni, same team or stack. */
export type ReferralPick = 'ex_apple' | 'cmu' | 'team' | 'other';
/** One engineer Claude suggested for a job, with the LinkedIn note Adam sends himself (migration 0011). */
export interface Referral {
  id: string;
  request_id: string | null;
  posting_id: string | null;
  job_url: string | null;
  company: string;
  role: string | null;
  tier: Tier | null;
  name: string;
  title: string | null;
  profile_url: string | null;
  pick: ReferralPick;
  why: string | null;
  note: string;
  status: ReferralStatus;
  sent_on: string | null;
  accepted_on: string | null;
  followed_up_on: string | null;
  replied_on: string | null;
  referred_on: string | null;
  created_at: string;
}
export type ReferralPatch = Partial<Pick<Referral, 'status' | 'sent_on' | 'accepted_on' | 'followed_up_on' | 'replied_on' | 'referred_on'>>;
/** What Find engineers needs: a posting from Jobs, or just the company and role of an application. */
export interface FindEngineersInput { posting_id?: string | null; job_url?: string | null; company: string; role?: string | null; tier?: Tier | null }

export interface LaunchRequest {
  id: string;
  kind: LaunchKind;
  payload: Record<string, unknown>;
  status: LaunchStatus;
  error: string | null;
  created_at: string;
}
export interface SyncStatus { source: string; last_ok_at: string | null; last_error: string | null; consecutive_failures: number }
export type SyncResult = { status: 'ok'; added: number } | { status: 'skipped' } | { status: 'error'; message: string };

export const STORY_TAGS = ['leadership', 'conflict', 'failure', 'impact', 'teamwork'] as const;
export type StoryTag = (typeof STORY_TAGS)[number];
export interface Story { id: string; title: string; tags: StoryTag[]; situation: string; task: string; action: string; result: string; last_practiced_on: string | null; created_at: string }
export type StoryInput = Pick<Story, 'title' | 'tags' | 'situation' | 'task' | 'action' | 'result'>;
export type StoryPatch = Partial<StoryInput & { last_practiced_on: string | null }>;
export type PrepKind = 'oa' | 'mock' | 'study' | 'story';
export interface PrepSession { id: string; kind: PrepKind; minutes: number | null; note: string | null; company: string | null; story_id: string | null; happened_on: string; created_at: string }
export type NewPrepSession = Pick<PrepSession, 'kind' | 'happened_on'> & Partial<Pick<PrepSession, 'minutes' | 'note' | 'company' | 'story_id'>>;
export type PrepTrack = 'system_design' | 'cs';
export interface PrepItem { id: string; track: PrepTrack; title: string; ord: number }
export type PrepStatus = 'learning' | 'solid';
export interface PrepProgress { item_id: string; status: PrepStatus }
export interface CompanyPrep { id: string; company: string; notes: string; links: string; interview_on: string | null; created_at: string }
export type CompanyPrepInput = Pick<CompanyPrep, 'company' | 'notes' | 'links' | 'interview_on'>;
export type EventKind = 'app_open' | 'deadline' | 'oa' | 'interview' | 'other';
export interface CalEvent { id: string; title: string; kind: EventKind; on_date: string; at_time: string | null; company: string | null; url: string | null; created_at: string }
export type NewCalEvent = Pick<CalEvent, 'title' | 'kind' | 'on_date'> & Partial<Pick<CalEvent, 'at_time' | 'company' | 'url'>>;

export type LearnTrack = 'cs' | 'math' | 'founder';
/** watch: free video course · do: practice · build: applied project · check: quiz, explain-it-back or honor checkoff */
export type LearnType = 'watch' | 'do' | 'build' | 'check';
export type LearnStatus = 'not_started' | 'in_progress' | 'done';
/** Learning tracks content (migration 0012), from shared/learning.json. Nothing is locked; ord is the recommended order. */
export interface LearnModule { id: string; track: LearnTrack; ord: number; title: string; summary: string }
export interface LearnItem {
  id: string; module_id: string; ord: number; type: LearnType; title: string; url: string | null; hours: number;
  project: string | null; check_kind: 'quiz' | 'explain' | 'honor' | null; details: string;
}
export interface LearnProgress { item_id: string; status: LearnStatus; rating: Rating | null; notes: string; started_on: string | null; done_on: string | null }
export type LearnProgressPatch = Partial<Omit<LearnProgress, 'item_id'>>;
export interface LearnModuleState { module_id: string; done_on: string }
export interface LearnCheck { id: string; module_id: string; kind: 'check' | 'review'; score: number; total: number; rating: Rating; summary: string; taken_on: string }
