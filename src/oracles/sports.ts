import { config } from '../config';

interface Match {
  id: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  date: string;
}

export async function getMatch(matchId: number): Promise<Match | null> {
  if (!config.oracles.apiFootballKey) return null;

  try {
    const res = await fetch(`https://v3.football.api-sports.io/fixtures?id=${matchId}`, {
      headers: { 'x-apisports-key': config.oracles.apiFootballKey },
    });
    const data = await res.json();
    const fixture = data.response?.[0];
    if (!fixture) return null;

    return {
      id: fixture.fixture.id,
      homeTeam: fixture.teams.home.name,
      awayTeam: fixture.teams.away.name,
      homeScore: fixture.goals.home,
      awayScore: fixture.goals.away,
      status: fixture.fixture.status.short,
      date: fixture.fixture.date,
    };
  } catch {
    return null;
  }
}

export async function searchFixtures(team: string, date?: string): Promise<Match[]> {
  if (!config.oracles.apiFootballKey) return [];

  try {
    const searchDate = date || new Date().toISOString().split('T')[0];
    const res = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${searchDate}&search=${encodeURIComponent(team)}`,
      { headers: { 'x-apisports-key': config.oracles.apiFootballKey } }
    );
    const data = await res.json();
    return (data.response || []).map((f: any) => ({
      id: f.fixture.id,
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      homeScore: f.goals.home,
      awayScore: f.goals.away,
      status: f.fixture.status.short,
      date: f.fixture.date,
    }));
  } catch {
    return [];
  }
}

export interface SportsMarketData {
  matchId: number;
  team: string;
  outcome: 'win' | 'draw' | 'not_lose';
}

export function resolveSportsMarket(match: Match, data: SportsMarketData): boolean | null {
  if (!['FT', 'AET', 'PEN'].includes(match.status)) return null; // Not finished

  const isHome = match.homeTeam.toLowerCase().includes(data.team.toLowerCase());
  const teamScore = isHome ? match.homeScore! : match.awayScore!;
  const oppScore = isHome ? match.awayScore! : match.homeScore!;

  switch (data.outcome) {
    case 'win': return teamScore > oppScore;
    case 'draw': return teamScore === oppScore;
    case 'not_lose': return teamScore >= oppScore;
    default: return null;
  }
}
