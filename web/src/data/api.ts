import type {
  Application, Commit, Contact, DailySet, Idea, IdeaPatch, LaunchKind, LaunchRequest, NewIdea, NewProject, Outreach,
  OutreachPatch, Posting, PostingStatus, Problem, ProblemState, Project, Rating, Settings, SettingsPatch, Solve,
  SyncResult, SyncStatus, Topic, TopicState,
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
}

/** The worker applied the solve before the rating landed; the rating can no longer change it. */
export class AlreadyCountedError extends Error {
  constructor() {
    super('Already counted');
    this.name = 'AlreadyCountedError';
  }
}
