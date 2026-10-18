export type Rating = 'nailed' | 'struggled' | 'help';
export type Slot = 'new' | 'review' | 'mystery' | 'spot';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type Level = 'locked' | 'available' | 'learning' | 'practicing' | 'solid' | 'mastered';
export type Stage = 'applied' | 'oa' | 'interview' | 'offer' | 'closed' | 'other';
export type IdeaStatus = 'todo' | 'today' | 'in_progress' | 'done' | 'dropped';
export type PostingStatus = 'new' | 'seen' | 'dismissed' | 'outreach' | 'applied';
export type OutreachStatus = 'queued' | 'drafted' | 'sent' | 'replied' | 'closed';
export type LaunchStatus = 'queued' | 'launched' | 'failed';
export type LaunchKind = 'outreach' | 'suggest_ideas' | 'work_on_idea' | 'mock_interview' | 'tailor_resume';
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
}
export type SettingsPatch = Partial<
  Pick<Settings, 'nudge_times' | 'daily_lc_count' | 'weekly_app_target' | 'resume_root' | 'app_url' | 'lc_focus_topic' | 'lc_focus_since' | 'day_one' | 'weekly_email_target'>
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
  /** Follow-ups sent so far (migration 0006; reads as 0 before it is applied). */
  followups: number;
  created_at: string;
}
export type OutreachPatch = Partial<Pick<Outreach, 'status' | 'sent_on' | 'follow_up_on' | 'followups'>>;
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
