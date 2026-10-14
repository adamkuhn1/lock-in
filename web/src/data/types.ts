export type Rating = 'nailed' | 'struggled' | 'help';
export type Slot = 'new' | 'review' | 'mystery' | 'spot';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type Level = 'locked' | 'available' | 'learning' | 'practicing' | 'solid' | 'mastered';
export type Stage = 'applied' | 'oa' | 'interview' | 'offer' | 'closed' | 'other';
export type IdeaStatus = 'todo' | 'today' | 'done' | 'dropped';
export type PostingStatus = 'new' | 'seen' | 'dismissed' | 'outreach';
export type OutreachStatus = 'queued' | 'drafted' | 'sent' | 'replied' | 'closed';
export type LaunchStatus = 'queued' | 'launched' | 'failed';
export type LaunchKind = 'outreach' | 'suggest_ideas';
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
}
export type SettingsPatch = Partial<
  Pick<Settings, 'nudge_times' | 'daily_lc_count' | 'weekly_app_target' | 'resume_root' | 'app_url' | 'lc_focus_topic' | 'lc_focus_since'>
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

export interface Project { id: string; name: string; repo: string; local_path: string | null; active: boolean }
export type NewProject = Omit<Project, 'active'>;
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
  created_at: string;
}
export interface NewIdea { project_id: string; text: string; size: 'S' | 'M'; position: number }
export type IdeaPatch = Partial<Pick<Idea, 'status' | 'position' | 'today_on' | 'done_at' | 'text'>>;

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
}
export interface Posting {
  id: string;
  company: string;
  title: string;
  location: string | null;
  url: string | null;
  term: string | null;
  posted_at: string | null;
  tier: string | null;
  starred: boolean;
  status: PostingStatus;
  found_at: string;
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
  created_at: string;
}
export type OutreachPatch = Partial<Pick<Outreach, 'status' | 'sent_on' | 'follow_up_on'>>;
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
