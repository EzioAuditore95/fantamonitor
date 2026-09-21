import { z } from 'zod';
import { readGrade,roundIsFinal } from './serie-a-events.ts';

// Reading of the public live feed. Pure: no fetch, no database, so the whole translation from
// their document to our payload is exercised by the fixtures in tests/fixtures/serie-a/.
//
// These schemas are deliberately NOT `.strict()`, unlike every other input in the app. The rule
// exists for documents we define, where an unexpected key means a bug or an attack; this one is
// written by someone else, and a field they add one Saturday would otherwise stop every import
// mid-season. Unknown keys are dropped, the fields we read are validated.
const playerSchema=z.object({
  id:z.number().int().positive(),id_s:z.number().int().nonnegative(),
  n:z.string().min(1).max(80),r:z.string().max(4).optional(),
  v:z.number(),sto:z.number().int(),
  bm:z.array(z.number().int()).optional(),min:z.array(z.number().int()).optional(),
  pp:z.number().int().optional(),sp:z.number().int().optional(),id_sos:z.number().int().optional(),
  t:z.number().int().optional(),i:z.number().int().optional(),
});
const matchSchema=z.object({
  id:z.number().int().positive(),sto:z.number().int(),
  id_a:z.number().int().positive(),id_b:z.number().int().positive(),
  n_a:z.string().min(1).max(60),n_b:z.string().min(1).max(60),
  g_a:z.number().int().nullish(),g_b:z.number().int().nullish(),d:z.string().nullish(),
});
export const liveRoundSchema=z.object({data:z.object({pl:z.array(playerSchema),inc:z.array(matchSchema)})});

const ROLES=new Set(['P','D','C','A']);
// Their timestamps carry no zone and are UTC: a 16:30 kick-off is the 18:30 of an August
// Saturday in Italy. Appending the Z is the whole conversion, and getting it wrong would move
// every deadline by two hours.
const kickoff=(value?:string|null)=>value&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)?`${value}Z`:null;

export type SerieARoundPayload={
  season:string;round:number;final:boolean;
  teams:{id:number;name:string}[];
  players:{id:number;name:string;role:string|null;team_id:number}[];
  matches:{match_id:number;home_team_id:number;away_team_id:number;home_goals:number|null;away_goals:number|null;kickoff:string|null;status:number}[];
  grades:{player_id:number;team_id:number;state:string;grade:number|null;events:number[];minutes:number[];status:number;presence_odds:number|null;raw:Record<string,unknown>}[];
};

export function parseLiveRound(input:unknown,season:string,round:number):SerieARoundPayload{
  const {data}=liveRoundSchema.parse(input);
  const teams=new Map<number,string>();
  for(const m of data.inc){teams.set(m.id_a,m.n_a);teams.set(m.id_b,m.n_b);}
  // A player whose match has not kicked off has no state to record: the feed marks him as if he
  // had not played, which is true only once the match is over. Silence is the honest reading.
  const played=data.pl.filter(p=>p.sto!==0);
  return {
    season,round,final:roundIsFinal(data.inc),
    teams:[...teams].map(([id,name])=>({id,name})),
    players:played.map(p=>({id:p.id,name:p.n,role:p.r&&ROLES.has(p.r)?p.r:null,team_id:p.id_s})),
    matches:data.inc.map(m=>({match_id:m.id,home_team_id:m.id_a,away_team_id:m.id_b,
      home_goals:m.g_a??null,away_goals:m.g_b??null,kickoff:kickoff(m.d),status:m.sto})),
    grades:played.map(p=>{
      const grade=readGrade(p.v);
      return {player_id:p.id,team_id:p.id_s,
        state:grade?.kind==='graded'?'graded':grade?.kind==='no_vote'?'no_vote':'did_not_play',
        grade:grade?.kind==='graded'?grade.value:null,
        events:p.bm??[],minutes:p.min??[],status:p.sto,presence_odds:p.pp??null,
        // Only what the columns do not already carry: keeping the whole row would double the
        // payload to store the same numbers twice.
        raw:{t:p.t,i:p.i,sp:p.sp,id_sos:p.id_sos}};
    }),
  };
}

// The feed publishes a round's fixtures before anyone plays them: ten matches with `sto` 0 and
// an empty player list. There is nothing to grade yet, and since rounds are published in order
// this is where a run ends — not an error, just the future.
export const roundHasStarted=(payload:SerieARoundPayload)=>payload.grades.length>0;

// fm_leagues says '2026-2027', the source says '2026-27'. Two vocabularies, translated at the
// border rather than merged: fm_serie_a_* stores the source's, and only this function knows both.
export function sourceSeason(season:string):string{
  if(/^\d{4}-\d{2}$/.test(season))return season;
  const match=season.match(/^(\d{4})-(\d{4})$/);
  if(!match)throw new Error('Stagione non riconosciuta.');
  return `${match[1]}-${match[2].slice(2)}`;
}

// The unattended run has no league to read the season from: it has no session, so fm_leagues is
// behind RLS. The championship calendar settles it instead — a Serie A season opens in August and
// closes in May, so July is the border and no configuration is needed to know which one we are in.
export function currentSourceSeason(now=new Date()):string{
  const year=now.getUTCFullYear(),start=now.getUTCMonth()>=6?year:year-1;
  return `${start}-${String((start+1)%100).padStart(2,'0')}`;
}

// What is still worth asking the source for: everything not already settled. A round stays in
// the list while it is being played, and leaves it for good the moment it is final.
export function pendingRounds(stored:readonly {round:number;final:boolean}[],lastRound=38):number[] {
  const settled=new Set(stored.filter(r=>r.final).map(r=>r.round));
  const out=[];
  for(let round=1;round<=lastRound;round++)if(!settled.has(round))out.push(round);
  return out;
}
