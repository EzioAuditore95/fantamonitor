import type { Competition,Snapshot } from './model.ts';

export type CompetitionRound=Competition['calendar'][number];
export type Standing=Competition['standings'][number];

// The Home tab reads the competition out of the archive it already has rather than asking
// /api/performance for it: that endpoint drives a Playwright capture on the connector, and
// the Home tab is the landing of every visit. Same expression the route uses as its own
// fallback, so the two never disagree about which snapshot is the freshest one.
export function competitionFrom(snapshots:readonly Snapshot[]):Competition|null{
  return [...snapshots].reverse().find(s=>s.competition)?.competition??null;
}

export function roundFor(competition:Competition|null,round:number):CompetitionRound|null{
  return competition?.calendar.find(r=>r.round===round)??null;
}

export type Fixture={
  round:number;championshipRound:number;calculated:boolean;
  team:string;opponent:string;home:boolean;
  fantasy:number|null;opponentFantasy:number|null;
  goals:number|null;opponentGoals:number|null;
};

// One team's side of its fixture, so the caller never has to ask again whether it is the
// home or the away name.
export function fixtureFor(competition:Competition|null,round:number,team:string|null):Fixture|null{
  const entry=roundFor(competition,round);
  const match=entry?.matches.find(m=>m.home===team||m.away===team);
  if(!entry||!match||!team)return null;
  const home=match.home===team;
  return {
    round:entry.round,championshipRound:entry.championshipRound,calculated:entry.calculated,
    team,opponent:home?match.away:match.home,home,
    fantasy:home?match.homeFantasy:match.awayFantasy,
    opponentFantasy:home?match.awayFantasy:match.homeFantasy,
    goals:home?match.homeGoals:match.awayGoals,
    opponentGoals:home?match.awayGoals:match.homeGoals,
  };
}

// Null while the round has no result yet, so a caller cannot read "0-0" into a fixture that
// has not been played.
export function outcomeOf(fixture:Fixture|null):'W'|'D'|'L'|null{
  if(!fixture?.calculated||fixture.goals==null||fixture.opponentGoals==null)return null;
  return fixture.goals>fixture.opponentGoals?'W':fixture.goals===fixture.opponentGoals?'D':'L';
}

// A raw observation is never accounting proof — these are the teams a reading found without
// a lineup, which is what the urgency block is about, not what the penalties tab charges.
export function missingLineups(snapshot:Snapshot|undefined):string[]{
  return snapshot?snapshot.teams.filter(t=>!t.present).map(t=>t.name):[];
}

// Tri-valued on purpose: false is "the reading found no lineup", undefined is "no reading".
export function lineupStateFor(snapshot:Snapshot|undefined,team:string|null):boolean|undefined{
  if(!snapshot||!team)return undefined;
  return snapshot.teams.find(t=>t.name===team)?.present;
}

// The payload arrives already ordered by the league's own tie-breaks, so the position is the
// index — recomputing it here would be a second, quietly different ranking.
export function standingFor(competition:Competition|null,team:string|null):{position:number;row:Standing}|null{
  if(!competition||!team)return null;
  const index=competition.standings.findIndex(row=>row.name===team);
  if(index<0)return null;
  return {position:index+1,row:competition.standings[index]};
}

export const hasResults=(competition:Competition|null)=>!!competition?.standings.some(row=>row.played>0);
