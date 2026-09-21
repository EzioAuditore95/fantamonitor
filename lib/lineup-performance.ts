import { fantasyPoints,type PlayerRound,type Scoring,CLASSIC_SCORING } from './player-performance.ts';
import type { Archive,Snapshot } from './model';
import type { MatchResult,PerformancePayload } from './performance';
import type { LeagueConfig } from './league.ts';

// Where the archive meets the championship: the lineups we have been capturing for weeks, priced
// with the grades the feed publishes. Pure, no I/O.
//
// What this module deliberately does NOT do is recompute a team's official fantasy total. That
// number needs Fantacalcio's substitution engine — module changes included — and measuring the
// obvious model against ten real results showed why: same-role substitutes in bench order, plus a
// clean sheet, reproduces four of ten exactly and falls one to three points short on the rest.
// The official total is already archived with the competition, so it is read, not recomputed, and
// the difference from the fielded eleven is reported as what the substitutions were worth.

export type PlayerRef={id?:string|number;name:string;role?:string};
export type PlayerLine={id:number|null;name:string;role:string|null;state:PlayerRound['state']|'unknown';points:number|null};
export type TeamRound={team:string;round:number;module:string|null;
  starters:PlayerLine[];bench:PlayerLine[];
  rated:number;unrated:number;fieldedPoints:number;
  benchPoints:number;bestBench:PlayerLine|null;
  official:number|null;substitutionGain:number|null};

const numericId=(player:PlayerRef)=>{const id=Number(player.id);return Number.isInteger(id)&&id>0?id:null;};
const round2=(n:number)=>Math.round(n*100)/100;

function line(player:PlayerRef,grades:ReadonlyMap<number,PlayerRound>,scoring:Scoring):PlayerLine{
  const id=numericId(player),row=id==null?undefined:grades.get(id);
  // A player with no row at all is not a player who did not play: the round may simply not be
  // imported yet, and calling that a zero would invent a performance.
  if(!row)return {id,name:player.name,role:player.role??null,state:'unknown',points:null};
  return {id,name:player.name,role:player.role??row.role??null,state:row.state,points:fantasyPoints(row,scoring)};
}
const sum=(lines:PlayerLine[])=>round2(lines.reduce((total,l)=>total+(l.points??0),0));

export function teamRound(team:string,round:number,formation:NonNullable<Snapshot['teams'][number]['formation']>,
  grades:ReadonlyMap<number,PlayerRound>,scoring:Scoring=CLASSIC_SCORING,official:number|null=null):TeamRound{
  const starters=(formation.starters??[]).map(p=>line(p,grades,scoring));
  const bench=(formation.bench??[]).map(p=>line(p,grades,scoring));
  const fieldedPoints=sum(starters);
  const rated=starters.filter(l=>l.points!=null).length;
  const scoredBench=bench.filter(l=>l.points!=null);
  return {team,round,module:formation.module??null,starters,bench,
    rated,unrated:starters.length-rated,fieldedPoints,
    benchPoints:sum(scoredBench),
    bestBench:scoredBench.length?scoredBench.reduce((best,l)=>l.points!>best.points!?l:best):null,
    official,substitutionGain:official==null?null:round2(official-fieldedPoints)};
}

const officialFor=(matches:readonly MatchResult[],team:string,round:number)=>{
  const match=matches.find(m=>m.round===round&&(m.home===team||m.away===team));
  if(!match)return null;
  const value=match.home===team?match.homeFantasy:match.awayFantasy;
  return typeof value==='number'?value:null;
};
// The last reading of a round is the one that counts: an earlier capture may have caught a lineup
// half filled in. Same rule as lineup-analytics, and for the same reason.
function latestByRound(snapshots:readonly Snapshot[]){
  const map=new Map<number,Snapshot>();
  for(const s of [...snapshots].sort((a,b)=>a.observed_at.localeCompare(b.observed_at)))map.set(s.round,s);
  return map;
}

export type TeamSeason={team:string;rounds:number;fieldedPoints:number;benchPoints:number;
  averageFielded:number|null;unrated:number;
  topStarters:{id:number|null;name:string;starts:number;points:number;average:number}[];
  regrets:{round:number;name:string;points:number;gap:number}[]};

// `grades` is indexed by Serie A round, not by league round: the two differ by serieAOffset, and
// this is the one place that translation happens.
export function seasonPerformance(cfg:LeagueConfig,teams:readonly string[],archive:Archive,
  gradesByRound:ReadonlyMap<number,ReadonlyMap<number,PlayerRound>>,
  performance?:PerformancePayload|null,scoring:Scoring=CLASSIC_SCORING):{rounds:TeamRound[];season:TeamSeason[]}{
  const latest=latestByRound(archive.snapshots),rounds:TeamRound[]=[];
  for(const [round,snapshot] of [...latest.entries()].sort((a,b)=>a[0]-b[0])){
    const grades=gradesByRound.get(round+cfg.serieAOffset);
    if(!grades)continue;
    for(const team of teams){
      const entry=snapshot.teams.find(t=>t.name===team);
      if(!entry?.formation?.starters?.length)continue;
      rounds.push(teamRound(team,round,entry.formation,grades,scoring,officialFor(performance?.matches??[],team,round)));
    }
  }
  const season=teams.map(team=>{
    const own=rounds.filter(r=>r.team===team);
    const starts=new Map<string,{id:number|null;name:string;starts:number;points:number}>();
    for(const entry of own)for(const player of entry.starters){
      const key=String(player.id??player.name).toLowerCase();
      const current=starts.get(key)??{id:player.id,name:player.name,starts:0,points:0};
      current.starts++;current.points=round2(current.points+(player.points??0));starts.set(key,current);
    }
    // The regret is only a regret when someone on the bench beat someone on the pitch: a bench
    // full of points behind an eleven that scored more is a bench that was right to sit.
    const regrets=own.flatMap(entry=>{
      const worst=entry.starters.filter(l=>l.points!=null).reduce<PlayerLine|null>((low,l)=>low&&low.points!<=l.points!?low:l,null);
      if(!entry.bestBench||!worst||entry.bestBench.points!<=worst.points!)return [];
      return [{round:entry.round,name:entry.bestBench.name,points:entry.bestBench.points!,gap:round2(entry.bestBench.points!-worst.points!)}];
    }).sort((a,b)=>b.gap-a.gap);
    const fielded=round2(own.reduce((total,r)=>total+r.fieldedPoints,0));
    return {team,rounds:own.length,fieldedPoints:fielded,
      benchPoints:round2(own.reduce((total,r)=>total+r.benchPoints,0)),
      averageFielded:own.length?round2(fielded/own.length):null,
      unrated:own.reduce((total,r)=>total+r.unrated,0),
      topStarters:[...starts.values()].sort((a,b)=>b.starts-a.starts||b.points-a.points).slice(0,5)
        .map(p=>({...p,average:round2(p.points/p.starts)})),
      regrets:regrets.slice(0,5)};
  });
  return {rounds,season};
}
