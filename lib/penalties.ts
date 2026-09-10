import { z } from 'zod';

export type Half = 'andata' | 'ritorno';
export type Period = Half | 'complessivo';
export const HALVES: Half[] = ['andata', 'ritorno'];
export const HALF_LABEL: Record<Half, string> = {andata:'Andata', ritorno:'Ritorno'};
export const HALF_ROUNDS: Record<Half, number[]> = {
  andata: Array.from({length:16}, (_,i)=>i+1),
  ritorno: Array.from({length:19}, (_,i)=>i+17),
};
export const reviewInputSchema = z.object({
  team: z.string().min(1), round: z.number().int().min(1).max(35),
  status: z.enum(['delivered','missed','unverified']),
  deadline: z.string().datetime({offset:true}).nullable(),
  note: z.string().trim().min(10,'Descrivi l’evidenza verificata (almeno 10 caratteri).').max(2000),
  source_url: z.string().url(), expected_revision: z.number().int().min(0),
}).strict().superRefine((r,ctx)=>{
  if(r.status!=='unverified' && (!r.deadline || Date.parse(r.deadline)>Date.now()))
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Un esito definitivo richiede una scadenza già trascorsa.'});
  const u=new URL(r.source_url);
  const prefix='/chefantavitae10/view/competition/337500/';
  if(u.origin!=='https://leghe.fantacalcio.it' || u.username || u.password ||
    ![`${prefix}round/${r.round}`,`${prefix}manage-lineups/${r.round}`].includes(u.pathname))
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'La fonte deve corrispondere alla giornata della lega: usa il tabellino o la gestione formazioni.'});
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;
export type Review = Omit<ReviewInput,'expected_revision'> & {id:string;revision:number;recorded_at:string};
export function halfForRound(round:number):Half {
  if(!Number.isInteger(round)||round<1||round>35)throw new Error('Giornata di lega non valida.');
  return round<=16?'andata':'ritorno';
}
export const serieARound=(round:number)=>{halfForRound(round);return round+3;};
export const reviewKey=(team:string,round:number)=>`${team}:${round}`;
export function latestReviews(reviews:Review[]):Map<string,Review>{
  const result=new Map<string,Review>();
  for(const r of reviews){const key=reviewKey(r.team,r.round);if(!result.has(key)||result.get(key)!.revision<r.revision)result.set(key,r);}
  return result;
}
export function teamBalance(team:string,half:Half,reviews:Review[]){
  const latest=latestReviews(reviews);
  const rounds=HALF_ROUNDS[half];
  const known=rounds.map(round=>latest.get(reviewKey(team,round))).filter((r):r is Review=>!!r&&r.status!=='unverified');
  const missed=known.filter(r=>r.status==='missed').sort((a,b)=>a.round-b.round);
  return {team,half,missed:missed.length,verified:known.length,total:rounds.length,
    remaining:missed.length?0:1,used:missed.length?1:0,penalty:Math.max(0,missed.length-1)*5,
    entries:missed.map((r,i)=>({...r,charge:i===0?0:5,token:i===0})),
  };
}
export function balances(teams:string[],period:Period,reviews:Review[]){
  return teams.map(team=>{
    const andata=teamBalance(team,'andata',reviews),ritorno=teamBalance(team,'ritorno',reviews);
    const selected=period==='complessivo'?[andata,ritorno]:[period==='andata'?andata:ritorno];
    return {team,andata,ritorno,missed:selected.reduce((n,h)=>n+h.missed,0),
      penalty:selected.reduce((n,h)=>n+h.penalty,0),used:selected.reduce((n,h)=>n+h.used,0),
      verified:selected.reduce((n,h)=>n+h.verified,0),total:selected.reduce((n,h)=>n+h.total,0)};
  });
}
export const euro=(value:number)=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(value);
