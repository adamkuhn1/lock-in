import type {
  Application, CalEvent, Commit, CompanyPrep, CompanyPrepInput, Contact, DailySet, Idea, IdeaPatch, LaunchKind, LaunchRequest,
  NewCalEvent, NewIdea, NewPrepSession, NewProject, Outreach, OutreachPatch, Posting, PostingStatus, PrepItem, PrepProgress,
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
  listOutreach(): Promise<Outreach[]>;
  listContacts(): Promise<Contact[]>;
  queueOutreach(i: { job_url: string; company?: string | null; role?: string | null }): Promise<Outreach>;
  updateOutreach(id: string, patch: OutreachPatch): Promise<void>;
  requestLaunch(kind: LaunchKind, payload: Record<string, unknown>): Promise<void>;
  listLaunchRequests(): Promise<LaunchRequest[]>;
  listSyncStatus(): Promise<SyncStatus[]>;
  syncLeetCode(): Promise<SyncResult>;
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
