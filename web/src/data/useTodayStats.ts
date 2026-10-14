import { useMemo } from 'react';
import { activeStreak, dayActivity, dayLine, dayN, heatmapWeeks, type DayActivity } from '../lib/activity';
import { appliedThisWeek, funnel, type FunnelRow } from '../lib/funnel';
import { sentThisWeek } from '../lib/outreach';
import { planDay } from '../lib/time';
import { buildTodayItems } from '../lib/today';
import {
  useApplications, useCommits, useDailySet, useNow, useOutreach, usePrepSessions, useProblemMap, useSettings, useSolves,
} from './hooks';

export interface TodayStats {
  day: string; dateLine: string; n: number; streak: number; days: DayActivity[]; weeks: (DayActivity | null)[][];
  lcDone: number; lcTotal: number; appsWeek: number; appTarget: number; emailsWeek: number; emailTarget: number; funnel: FunnelRow[];
}

export function useTodayStats(): { state: 'loading' | 'error' | 'ready'; retry: () => void; stats: TodayStats | null } {
  const now = useNow();
  const day = planDay(now);
  const settings = useSettings();
  const set = useDailySet(day);
  const solves = useSolves();
  const problems = useProblemMap();
  const commits = useCommits();
  const apps = useApplications();
  const outreach = useOutreach();
  const prep = usePrepSessions();
  const dateLine = dayLine(now);
  const stats = useMemo((): TodayStats | null => {
    const s = settings.data;
    if (!s) return null;
    const days = dayActivity({
      solves: solves.data ?? [], applications: apps.data ?? [], outreach: outreach.data ?? [],
      commits: commits.data ?? [], prep: prep.data ?? [],
    }, s.day_one, day);
    const items = set.data ? buildTodayItems(set.data, solves.data ?? [], problems, day) : [];
    return {
      day, dateLine, n: dayN(s.day_one, day), streak: activeStreak(days, day), days, weeks: heatmapWeeks(days),
      lcDone: items.filter((i) => i.done).length, lcTotal: items.length,
      appsWeek: appliedThisWeek(apps.data ?? [], day), appTarget: s.weekly_app_target,
      emailsWeek: sentThisWeek(outreach.data ?? [], day), emailTarget: s.weekly_email_target,
      funnel: funnel(apps.data ?? []),
    };
  }, [settings.data, solves.data, apps.data, outreach.data, commits.data, prep.data, set.data, problems, day, dateLine]);
  return {
    state: settings.isPending ? 'loading' : settings.isError ? 'error' : 'ready',
    retry: () => void settings.refetch(),
    stats,
  };
}
