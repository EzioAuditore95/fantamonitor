import type { Snapshot } from './model.ts';
import { CLASSIC_SCORING,totalsFor,type PlayerRound,type Scoring } from './player-performance.ts';

// The shape /api/players returns. Grades are keyed by **Serie A** round, not league round:
// the translation is serieAOffset and it happens in lineup-performance, not here.
export type GradeRow={player_id:number;state:PlayerRound['state'];grade:number|null;events:number[]};
export type PlayerGrades={season:string;rounds:number[];players:{id:number;role:string|null}[];grades:Record<string,GradeRow[]>};

const rolesOf=(payload:PlayerGrades)=>new Map(payload.players.map(p=>[p.id,p.role]));

const toRound=(row:GradeRow,round:number,role:string|null):PlayerRound=>
  ({player_id:row.player_id,round,state:row.state,grade:row.grade,events:row.events,role});

// Every rated appearance, flat, for totalsFor.
export function playerRounds(payload:PlayerGrades|null):PlayerRound[]{
  if(!payload)return [];
  const roles=rolesOf(payload);
  return Object.entries(payload.grades).flatMap(([round,rows])=>
    rows.map(row=>toRound(row,Number(round),roles.get(row.player_id)??null)));
}

// The same rows indexed the way seasonPerformance wants them: Serie A round → player id → row.
export function gradesByRound(payload:PlayerGrades|null):Map<number,Map<number,PlayerRound>>{
  const byRound=new Map<number,Map<number,PlayerRound>>();
  if(!payload)return byRound;
  const roles=rolesOf(payload);
  for(const [round,rows] of Object.entries(payload.grades))
    byRound.set(Number(round),new Map(rows.map(row=>[row.player_id,toRound(row,Number(round),roles.get(row.player_id)??null)])));
  return byRound;
}

export type RosterPlayer={id:number;name:string;role:string|null};

// A team's squad as of its most recent readable lineup. Rosters move with the market, so the
// newest reading wins and older ones are not merged into it — a player sold in January should
// not keep appearing among the team's best.
export function rosterOf(snapshots:readonly Snapshot[],team:string|null):RosterPlayer[]{
  if(!team)return [];
  for(const snapshot of [...snapshots].sort((a,b)=>b.observed_at.localeCompare(a.observed_at))){
    const formation=snapshot.teams.find(t=>t.name===team)?.formation;
    const listed=[...(formation?.roster??[]),...(formation?.starters??[]),...(formation?.bench??[])];
    if(!listed.length)continue;
    const seen=new Map<number,RosterPlayer>();
    for(const player of listed){
      const id=Number(player.id);
      if(!Number.isInteger(id)||id<=0||seen.has(id))continue;
      seen.set(id,{id,name:player.name,role:player.role??null});
    }
    if(seen.size)return [...seen.values()];
  }
  return [];
}

export type TopPlayer={id:number;name:string;role:string|null;fantasyGrade:number;appearances:number};

// Two rated appearances before a player can top a list: one 9 in one outing is not a season,
// and the whole point of an average is that it averages something.
export const MIN_APPEARANCES_FOR_TOP=2;

// Best of a squad by fantasy average — voto plus bonus and malus, the number that decides a
// lineup's points, not the bare grade.
export function topFantasyAverages(roster:readonly RosterPlayer[],payload:PlayerGrades|null,
  limit=3,minAppearances=MIN_APPEARANCES_FOR_TOP,scoring:Scoring=CLASSIC_SCORING):TopPlayer[]{
  if(!roster.length||!payload)return [];
  const ours=new Set(roster.map(p=>p.id));
  const totals=totalsFor(playerRounds(payload).filter(row=>ours.has(row.player_id)),scoring);
  const named=new Map(roster.map(p=>[p.id,p]));
  return totals
    .filter(t=>t.fantasyGrade!=null&&t.appearances>=minAppearances)
    .sort((a,b)=>b.fantasyGrade!-a.fantasyGrade!||b.appearances-a.appearances)
    .slice(0,limit)
    .map(t=>({id:t.player_id,name:named.get(t.player_id)?.name??'—',role:named.get(t.player_id)?.role??null,
      fantasyGrade:t.fantasyGrade!,appearances:t.appearances}));
}
