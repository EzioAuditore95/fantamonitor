import { z } from 'zod';
import { AGGREGATE_PERIOD,findPeriod,leaguePath,periodForRound,type LeagueConfig } from './league.ts';

// Chiave di un periodo della lega, oppure AGGREGATE_PERIOD per l'intera stagione.
export type Period = string;
export function makeReviewInputSchema(cfg:LeagueConfig){
  const prefix=leaguePath(cfg);
  return z.object({
    team: z.string().min(1), round: z.number().int().min(1).max(cfg.roundCount),
    status: z.enum(['delivered','missed','unverified']),
    deadline: z.string().datetime({offset:true}).nullable(),
    note: z.string().trim().min(10,'Descrivi l’evidenza verificata (almeno 10 caratteri).').max(2000),
    source_url: z.string().url(), expected_revision: z.number().int().min(0),
  }).strict().superRefine((r,ctx)=>{
    if(r.status!=='unverified' && (!r.deadline || Date.parse(r.deadline)>Date.now()))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Un esito definitivo richiede una scadenza già trascorsa.'});
    const u=new URL(r.source_url);
    if(u.origin!=='https://leghe.fantacalcio.it' || u.username || u.password ||
      ![`${prefix}round/${r.round}`,`${prefix}manage-lineups/${r.round}`].includes(u.pathname))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'La fonte deve corrispondere alla giornata della lega: usa il tabellino o la gestione formazioni.'});
  });
}
export type ReviewInput = z.infer<ReturnType<typeof makeReviewInputSchema>>;
export type Review = Omit<ReviewInput,'expected_revision'> & {id:string;revision:number;recorded_at:string};
export const serieARound=(cfg:LeagueConfig,round:number)=>{periodForRound(cfg,round);return round+cfg.serieAOffset;};
export const reviewKey=(team:string,round:number)=>`${team}:${round}`;
export function latestReviews(reviews:Review[]):Map<string,Review>{
  const result=new Map<string,Review>();
  for(const r of reviews){const key=reviewKey(r.team,r.round);if(!result.has(key)||result.get(key)!.revision<r.revision)result.set(key,r);}
  return result;
}
export function teamBalance(cfg:LeagueConfig,team:string,period:string,reviews:Review[]){
  const latest=latestReviews(reviews);
  const rounds=findPeriod(cfg,period).rounds;
  const known=rounds.map(round=>latest.get(reviewKey(team,round))).filter((r):r is Review=>!!r&&r.status!=='unverified');
  // Il gettone copre l'omissione più antica del periodo, anche con inserimenti retroattivi.
  const missed=known.filter(r=>r.status==='missed').sort((a,b)=>a.round-b.round);
  return {team,period,missed:missed.length,verified:known.length,total:rounds.length,
    remaining:Math.max(0,cfg.freeTokens-missed.length),used:Math.min(cfg.freeTokens,missed.length),
    penalty:Math.max(0,missed.length-cfg.freeTokens)*cfg.penaltyAmount,
    entries:missed.map((r,i)=>({...r,charge:i<cfg.freeTokens?0:cfg.penaltyAmount,token:i<cfg.freeTokens})),
  };
}
export function balances(cfg:LeagueConfig,teams:string[],period:Period,reviews:Review[]){
  return teams.map(team=>{
    const periods=Object.fromEntries(cfg.periods.map(p=>[p.key,teamBalance(cfg,team,p.key,reviews)]));
    const selected=period===AGGREGATE_PERIOD?cfg.periods.map(p=>periods[p.key]):[periods[findPeriod(cfg,period).key]];
    return {team,periods,missed:selected.reduce((n,h)=>n+h.missed,0),
      penalty:selected.reduce((n,h)=>n+h.penalty,0),used:selected.reduce((n,h)=>n+h.used,0),
      verified:selected.reduce((n,h)=>n+h.verified,0),total:selected.reduce((n,h)=>n+h.total,0)};
  });
}
export const euro=(value:number)=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(value);
