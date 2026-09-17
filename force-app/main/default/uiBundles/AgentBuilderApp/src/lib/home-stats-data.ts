import { apexFetch } from './apex-client';

/** Talks to AgentHomeStatsRestService.cls — activity per day and per agent
 *  across automation runs AND chat turns, org-wide, in the user's
 *  timezone. One request instead of paging runs and sessions client-side. */
const HOME_STATS_BASE = '/services/apexrest/agent-builder/home-stats';

export interface HomeDayCount {
  /** yyyy-MM-dd in the running user's timezone */
  day: string;
  runsOk: number;
  runsFailed: number;
  runsOther: number;
  turnsOk: number;
  turnsFailed: number;
}

export interface HomeAgentCount {
  apiName: string;
  name: string;
  runsToday: number;
  runsFailedToday: number;
  turnsToday: number;
  turnsFailedToday: number;
  /** over the whole window */
  tokensIn: number;
  tokensOut: number;
}

export interface HomeStats {
  days: number;
  byDay: HomeDayCount[];
  byAgent: HomeAgentCount[];
  runs: number;
  runsFailed: number;
  turns: number;
  turnsFailed: number;
  tokensIn: number;
  tokensOut: number;
  generatedAt: string;
}

export async function loadHomeStats(days = 7): Promise<HomeStats> {
  return apexFetch<HomeStats>(`${HOME_STATS_BASE}?days=${days}`, { method: 'GET' });
}
