import type { Competition,Snapshot } from './model.ts';
import { classifyTeam,type TeamPerformance } from './performance.ts';

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

export type HeadToHead={played:number;wins:number;draws:number;losses:number;
  last:{round:number;goals:number;opponentGoals:number;fantasy:number|null;opponentFantasy:number|null}|null};

// Every meeting between two teams this season, from the point of view of the first. Reads
// `matches`, which holds the results already calculated — the calendar's future rounds carry
// no goals and would count as draws if they slipped in.
export function headToHead(competition:Competition|null,team:string|null,opponent:string|null):HeadToHead|null{
  if(!competition||!team||!opponent||team===opponent)return null;
  const met=competition.matches
    .filter(m=>(m.home===team&&m.away===opponent)||(m.home===opponent&&m.away===team))
    .sort((a,b)=>a.round-b.round)
    .map(m=>{const home=m.home===team;return {round:m.round,
      goals:home?m.homeGoals:m.awayGoals,opponentGoals:home?m.awayGoals:m.homeGoals,
      fantasy:home?m.homeFantasy:m.awayFantasy,opponentFantasy:home?m.awayFantasy:m.homeFantasy};});
  if(!met.length)return null;
  return {
    played:met.length,
    wins:met.filter(m=>m.goals>m.opponentGoals).length,
    draws:met.filter(m=>m.goals===m.opponentGoals).length,
    losses:met.filter(m=>m.goals<m.opponentGoals).length,
    last:met[met.length-1],
  };
}

export type RoundHighlight={team:string;fantasy:number};

// Best and worst fantasy score of one round. Null when the round has not been calculated, or
// when the payload carries no fantasy figures: a round of nulls has no best.
export function roundHighlights(competition:Competition|null,round:number):{best:RoundHighlight|null;worst:RoundHighlight|null}{
  const entry=roundFor(competition,round);
  if(!entry?.calculated)return {best:null,worst:null};
  const scores=entry.matches.flatMap(m=>[
    ...(m.homeFantasy==null?[]:[{team:m.home,fantasy:m.homeFantasy}]),
    ...(m.awayFantasy==null?[]:[{team:m.away,fantasy:m.awayFantasy}]),
  ]);
  if(!scores.length)return {best:null,worst:null};
  return {
    best:scores.reduce((top,s)=>s.fantasy>top.fantasy?s:top),
    worst:scores.reduce((low,s)=>s.fantasy<low.fantasy?s:low),
  };
}

export type Character={label:string;fantasyRank:number;pointsRank:number;gap:number};

// What the league already says about a team, in one line: the label /stats computes, plus the
// distance between what it produces and what it collects. `gap` is positive when the table is
// kinder than the fantasy points — the number that makes "cinica" or "sfortunata" mean something.
export function characterOf(performance:readonly TeamPerformance[],team:string|null):Character|null{
  const played=performance.filter(t=>t.played>0);
  const me=played.find(t=>t.name===team);
  if(!me||played.length<2)return null;
  const rank=(key:'fantasyAverage'|'points')=>[...played].sort((a,b)=>b[key]-a[key]).findIndex(t=>t.name===team)+1;
  const fantasyRank=rank('fantasyAverage'),pointsRank=rank('points');
  return {label:classifyTeam(me,played),fantasyRank,pointsRank,gap:fantasyRank-pointsRank};
}
