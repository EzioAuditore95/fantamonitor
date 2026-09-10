import { z } from 'zod';
export const TEAM_NAMES = ['AC Idovalproico','Atletico Fontanelle','FC LBVLA','FC SEMINI','FC Villaggio Mau Mau','FDS Sballo','I PIPPISTRELLI','Pro Spritz','Real Hasbulla','Salamandre'];
export const TEAM_COLORS = ['#b6a1f7','#efa88d','#8bb8f6','#e4bc6e','#91cdd0','#afbcf3','#d4ee8a','#f0a0b8','#c3e878','#b9a6ec'];
export const snapshotSchema = z.object({
  schema_version: z.literal(1), league:z.literal('chefantavitae10'),
  season:z.literal('2026-2027'), competition_id:z.literal('337500'),
  round:z.number().int().min(1).max(35), observed_at:z.string().datetime({offset:true}),
  source:z.literal('authenticated_ui'),source_url:z.string().url(),
  expected_total:z.literal(10),inserted:z.number().int().min(0).max(10),
  teams:z.array(z.object({team_key:z.string(),name:z.string(),present:z.boolean(),source_status:z.enum(['check-circle','Non inserita'])}).strict()).length(10),
}).strict().superRefine((s,ctx)=>{
  const bad=(message:string)=>ctx.addIssue({code:z.ZodIssueCode.custom,message});
  const url=new URL(s.source_url);
  if(url.origin!=='https://leghe.fantacalcio.it'||url.pathname!==`/${s.league}/view/competition/${s.competition_id}/manage-lineups/${s.round}`)bad('La pagina sorgente non corrisponde alla giornata.');
  if(new Set(s.teams.map(t=>t.team_key)).size!==10)bad('Sono presenti squadre duplicate.');
  for(const t of s.teams){
    if(!TEAM_NAMES.includes(t.name)||t.team_key!==t.name)bad('Elenco squadre diverso da quello della lega.');
    if(t.source_status!==(t.present?'check-circle':'Non inserita'))bad('Indicatore di formazione incoerente.');
  }
  if(s.teams.filter(t=>t.present).length!==s.inserted)bad('Il conteggio non coincide con le squadre.');
  if(Date.parse(s.observed_at)>Date.now()+60000)bad('La lettura ha una data futura.');
});
export type Snapshot=z.infer<typeof snapshotSchema>;
export type Archive={snapshots:Snapshot[]; events:{team_key:string;round:number;source_label:string;source_time_text:string;source_url:string}[]};
export function normalize(s:Snapshot):Snapshot{return {...s,observed_at:new Date(s.observed_at).toISOString(),teams:[...s.teams].sort((a,b)=>a.team_key.localeCompare(b.team_key))};}
export function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const identityKey=(s:Snapshot)=>`${s.round}:${s.observed_at}`;
export function latestByRound(snapshots:Snapshot[]):Map<number,Snapshot>{const m=new Map<number,Snapshot>();for(const s of [...snapshots].sort((a,b)=>a.observed_at.localeCompare(b.observed_at)))m.set(s.round,s);return m;}
export function initials(name:string){return name.split(' ').filter(x=>!['FC','AC','I'].includes(x)).slice(0,2).map(x=>x[0]).join('');}
export function displayDate(date:string){return new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}).format(new Date(date));}
