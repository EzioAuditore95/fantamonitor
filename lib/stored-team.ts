import { teamNames,type LeagueConfig } from './league.ts';

// The viewer's own team is a per-device preference, not a membership: fm_memberships knows
// who belongs to a league, never which of its teams is theirs. Keeping it in the browser
// asks nothing of the schema and nothing of the user beyond one tap.
export const storedTeamKey=(slug:string)=>`fm:team:${slug}`;

// A stored name is only worth as much as the league it is read against: a team renamed in
// fm_league_teams would otherwise leave a ghost on screen, or match nothing at all. Anything
// that is not a current team name reads as no choice, which puts the picker back.
export function readStoredTeam(cfg:LeagueConfig,raw:string|null|undefined):string|null{
  if(!raw)return null;
  return teamNames(cfg).includes(raw)?raw:null;
}
