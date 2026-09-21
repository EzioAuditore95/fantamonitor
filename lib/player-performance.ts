import { ASSIST_CODES,CLASSIC_BONUS,EVENT } from './serie-a-events.ts';
import type { LeagueConfig } from './league.ts';

// Fantasy scoring of a Serie A grade. Pure, like penalties.ts: no I/O, and parametric on the
// league, because the weights are a rule a league may change and not a property of the feed.
export type Scoring={weights:Readonly<Record<number,number>>;cleanSheet:number};
// Classic as Fantacalcio publishes it, plus the one bonus that has no event behind it: a clean
// sheet is not in `bm`, so it is read off the absence of conceded goals rather than looked up.
export const CLASSIC_SCORING:Scoring={weights:CLASSIC_BONUS,cleanSheet:0};

// `rules` is the league's free-form jsonb, the same place the labels and the prize pot live.
// An unreadable or absent `scoring` is not an error: it means this league scores Classic.
export function scoringFor(cfg:LeagueConfig):Scoring{
  const declared=cfg.rules?.scoring as {weights?:Record<string,number>;cleanSheet?:number}|undefined;
  if(!declared||typeof declared!=='object')return CLASSIC_SCORING;
  const overrides=Object.entries(declared.weights??{}).filter(([code,value])=>Number.isInteger(Number(code))&&Number.isFinite(value));
  return {weights:overrides.length?{...CLASSIC_BONUS,...Object.fromEntries(overrides.map(([c,v])=>[Number(c),v]))}:CLASSIC_BONUS,
    cleanSheet:Number.isFinite(declared.cleanSheet)?Number(declared.cleanSheet):0};
}

export type PlayerRound={player_id:number;round:number;state:'graded'|'no_vote'|'did_not_play';
  grade:number|null;events:readonly number[];role?:string|null};

const round2=(n:number)=>Math.round(n*100)/100;
const count=(events:readonly number[],code:number)=>events.reduce((n,c)=>n+(c===code?1:0),0);
const countAny=(events:readonly number[],codes:readonly number[])=>events.reduce((n,c)=>n+(codes.includes(c)?1:0),0);
// A goalkeeper keeps a clean sheet when he was rated and conceded nothing: the feed has no event
// for it, only one `concededGoal` per goal, so the absence of those is the whole evidence.
export const keptCleanSheet=(row:PlayerRound)=>row.state==='graded'&&row.role==='P'&&count(row.events,EVENT.concededGoal)===0;

export function bonusFor(row:PlayerRound,scoring:Scoring=CLASSIC_SCORING):number{
  const fromEvents=row.events.reduce((sum,code)=>sum+(scoring.weights[code]??0),0);
  return round2(fromEvents+(keptCleanSheet(row)?scoring.cleanSheet:0));
}
// Null, never zero: a player who was not rated did not score zero points, he has no score at all,
// and averaging a zero in would punish whoever fielded him exactly as a bad game would.
export function fantasyPoints(row:PlayerRound,scoring:Scoring=CLASSIC_SCORING):number|null{
  return row.state==='graded'&&row.grade!=null?round2(row.grade+bonusFor(row,scoring)):null;
}

export type PlayerTotals={player_id:number;appearances:number;played:number;
  grade:number|null;fantasyGrade:number|null;points:number;
  goals:number;assists:number;conceded:number;ownGoals:number;cleanSheets:number;
  penaltiesScored:number;penaltiesMissed:number;penaltiesSaved:number;yellow:number;red:number};

const empty=(player_id:number):PlayerTotals=>({player_id,appearances:0,played:0,grade:null,fantasyGrade:null,points:0,
  goals:0,assists:0,conceded:0,ownGoals:0,cleanSheets:0,penaltiesScored:0,penaltiesMissed:0,penaltiesSaved:0,yellow:0,red:0});

// Season totals per player. `appearances` counts the rounds he was rated — the site's "partite a
// voto", the divisor of both averages — while `played` also counts the ones he came on too late
// to be rated, where a card still counts and no average does.
export function totalsFor(rows:readonly PlayerRound[],scoring:Scoring=CLASSIC_SCORING):PlayerTotals[]{
  const byPlayer=new Map<number,PlayerTotals&{gradeSum:number;fantasySum:number}>();
  for(const row of rows){
    if(row.state==='did_not_play')continue;
    const totals=byPlayer.get(row.player_id)??{...empty(row.player_id),gradeSum:0,fantasySum:0};
    totals.played++;
    totals.goals+=count(row.events,EVENT.goal)+count(row.events,EVENT.penaltyScored);
    totals.assists+=countAny(row.events,ASSIST_CODES);
    totals.conceded+=count(row.events,EVENT.concededGoal);
    totals.ownGoals+=count(row.events,EVENT.ownGoal);
    totals.penaltiesScored+=count(row.events,EVENT.penaltyScored);
    totals.penaltiesMissed+=count(row.events,EVENT.penaltyMissed);
    totals.penaltiesSaved+=count(row.events,EVENT.penaltySaved);
    totals.yellow+=count(row.events,EVENT.yellowCard);
    totals.red+=count(row.events,EVENT.redCard);
    const points=fantasyPoints(row,scoring);
    if(points!=null&&row.grade!=null){
      totals.appearances++;totals.gradeSum+=row.grade;totals.fantasySum+=points;totals.points+=points;
      if(keptCleanSheet(row))totals.cleanSheets++;
    }
    byPlayer.set(row.player_id,totals);
  }
  return [...byPlayer.values()].map(({gradeSum,fantasySum,...totals})=>({...totals,
    grade:totals.appearances?round2(gradeSum/totals.appearances):null,
    fantasyGrade:totals.appearances?round2(fantasySum/totals.appearances):null,
    points:round2(totals.points)}));
}
