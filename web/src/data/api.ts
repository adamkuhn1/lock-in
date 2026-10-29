import type {
  Application, CalEvent, Commit, CompanyPrep, CompanyPrepInput, Contact, DailySet, Idea, IdeaPatch, LaunchKind, LaunchRequest,
  FindEngineersInput, MarkAppliedInput, Referral, ReferralPatch, Tier, UndoAppliedInput, NewCalEvent, NewIdea, NewPrepSession, NewProject, Outreach, OutreachPatch, Posting, PostingStatus, PrepItem, PrepProgress,
  PrepSession, PrepStatus, Problem, ProblemState, Project, ProjectPatch, Rating, Settings, SettingsPatch, Solve, Story,
  StoryInput, StoryPatch, SyncResult, SyncStatus, Topic, TopicState,
} from './types';

export interface DataApi {
  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<void>;
  getDailySet(day: string): Promise<DailySet | null>;
  listProblems(): Promise<Problem[]>;
  listTopics(): Promise<Topic[]>;
  listTopicStates(): Promise<TopicState[]>;
  listProblemStates(): Promise<ProblemState[]>;
  listSolves(): Promise<Solve[]>;
  rateSolve(id: number, rating: Rating, at: Date): Promise<void>;
  listProjects(): Promise<Project[]>;
  addProject(p: NewProject): Promise<void>;
  setProjectActive(id: string, active: boolean): Promise<void>;
  listCommits(sinceIso: string): Promise<Commit[]>;
  listIdeas(): Promise<Idea[]>;
  addIdea(i: NewIdea): Promise<void>;
  updateIdea(id: string, patch: IdeaPatch): Promise<void>;
  listApplications(): Promise<Application[]>;
  listPostings(sinceIso: string): Promise<Posting[]>;
  setPostingStatus(id: string, status: PostingStatus): Promise<void>;
  /** Back to the inbox from Filtered, marked so the worker's next scan leaves it there (worker/lockin_worker/jobs.py KEPT). */
  restorePosting(id: string): Promise<void>;
  listOutreach(): Promise<Outreach[]>;
  listContacts(): Promise<Contact[]>;
  queueOutreach(i: { job_url: string; company?: string | null; role?: string | null; tier?: Tier | null }): Promise<Outreach>;
  /** Like queueOutreach, but the Mac tailors a resume copy first, then drafts the recruiter email. */
  /** With fill, Claude also fills in the application in Chrome and leaves it for Adam to submit. */
  queueTailor(i: { job_url: string; company?: string | null; role?: string | null; fill?: boolean; tier?: Tier | null }): Promise<Outreach>;
  /** Engineers Claude found for a job, each with a LinkedIn note (empty before migration 0011). */
  listReferrals(): Promise<Referral[]>;
  updateReferral(id: string, patch: ReferralPatch): Promise<void>;
  /** Queues Find engineers on the Mac for a posting, or for an application's company and role. */
  findEngineers(i: FindEngineersInput): Promise<void>;
  updateOutreach(id: string, patch: OutreachPatch): Promise<void>;
  requestLaunch(kind: LaunchKind, payload: Record<string, unknown>): Promise<void>;
  listLaunchRequests(): Promise<LaunchRequest[]>;
  listSyncStatus(): Promise<SyncStatus[]>;
  syncLeetCode(): Promise<SyncResult>;
  /** The Sheet's Status dropdown options ([] when it has none). */
  sheetStatuses(): Promise<string[]>;
  /**
   * Writes the Status cell in the Sheet, then the app row. Sends company/role/sheet_row too, because the worker's
   * sync re-inserts rows (new ids). Throws Error with a short user-facing message.
   */
  setApplicationStatus(app: Pick<Application, 'id' | 'company' | 'role' | 'sheet_row'>, status: string): Promise<void>;
  /** Appends a row to the Sheet. {duplicate: true} means the job is already there and nothing was written. */
  markApplied(i: MarkAppliedInput): Promise<{ duplicate?: true }>;
  /** Undoes I applied: deletes the Sheet row, only while it's still Applied and dated today. */
  undoApplied(i: UndoAppliedInput): Promise<void>;
  updateProject(id: string, patch: ProjectPatch): Promise<void>;
  listStories(): Promise<Story[]>;
  addStory(s: StoryInput): Promise<void>;
  updateStory(id: string, patch: StoryPatch): Promise<void>;
  deleteStory(id: string): Promise<void>;
  listPrepSessions(sinceDay: string): Promise<PrepSession[]>;
  addPrepSession(s: NewPrepSession): Promise<void>;
  listPrepItems(): Promise<PrepItem[]>;
  listPrepProgress(): Promise<PrepProgress[]>;
  setPrepProgress(itemId: string, status: PrepStatus | null): Promise<void>; // null deletes the row
  listCompanyPrep(): Promise<CompanyPrep[]>;
  saveCompanyPrep(p: CompanyPrepInput): Promise<void>; // upsert on (owner, company)
  listEvents(): Promise<CalEvent[]>;
  addEvent(e: NewCalEvent): Promise<void>;
  deleteEvent(id: string): Promise<void>;
}

/** The worker applied the solve before the rating landed; the rating can no longer change it. */
export class AlreadyCountedError extends Error {
  constructor() {
    super('Already counted');
    this.name = 'AlreadyCountedError';
  }
}
