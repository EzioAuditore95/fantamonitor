import { z } from 'zod';
import type { Review } from './penalties';
import { teamNames,type LeagueConfig } from './league.ts';

const playerSchema=z.object({
  id:z.union([z.string(),z.number()]).optional(),
  name:z.string().min(1),
  role:z.string().optional(),
  shirt_number:z.number().int().optional(),
  image_url:z.string().optional(),
}).strict();
const formationSchema=z.object({
  module:z.string().optional(),
  starters:z.array(playerSchema).optional(),
  bench:z.array(playerSchema).optional(),
  roster:z.array(playerSchema).optional(),
}).strict();
const teamSchema=z.object({
  team_key:z.string(),name:z.string(),present:z.boolean(),source_status:z.enum(['check-circle','Non inserita']),
  team_id:z.number().int().positive().optional(),
  manager:z.string().optional(),
  budget:z.number().optional(),
  crest_url:z.string().optional(),
  kit_url:z.string().optional(),
  formation:formationSchema.optional(),
  // Quando la piattaforma dice di aver salvato quella formazione. Serve a distinguere una
  // scelta di questa giornata da quella riportata in automatico dalla precedente.
  lineup_saved_at:z.string().optional(),
}).strict();

const competitionMatchSchema=z.object({
  homeId:z.number().int().positive(),awayId:z.number().int().positive(),home:z.string().min(1),away:z.string().min(1),
  homeFantasy:z.number().nullable(),awayFantasy:z.number().nullable(),homeStandingPoints:z.number().nullable(),awayStandingPoints:z.number().nullable(),
  homeGoals:z.number().int().nullable(),awayGoals:z.number().int().nullable(),result:z.string().nullable(),resultSR:z.string().nullable(),
}).strict();
const standingSchema=z.object({name:z.string(),played:z.number().int().min(0),wins:z.number().int().min(0),draws:z.number().int().min(0),losses:z.number().int().min(0),goalsFor:z.number().int().min(0),goalsAgainst:z.number().int().min(0),points:z.number(),fantasyTotal:z.number()}).strict();
export function makeCompetitionSchema(cfg:LeagueConfig){
  const competitionRoundSchema=z.object({round:z.number().int().min(1).max(cfg.roundCount),championshipRound:z.number().int().min(1).max(cfg.roundCount+cfg.serieAOffset),calculated:z.boolean(),matches:z.array(competitionMatchSchema).length(Math.floor(cfg.teamCount/2))}).strict();
  const resultMatchSchema=z.object({round:z.number().int().min(1).max(cfg.roundCount),home:z.string(),away:z.string(),homeGoals:z.number().int(),awayGoals:z.number().int(),homeFantasy:z.number().nullable(),awayFantasy:z.number().nullable()}).strict();
  return z.object({source:z.string().url(),fetchedAt:z.string().datetime({offset:true}),calendar:z.array(competitionRoundSchema).length(cfg.roundCount),matches:z.array(resultMatchSchema),standings:z.array(standingSchema).length(cfg.teamCount),warnings:z.array(z.string())}).strict();
}
export function makeSnapshotSchema(cfg:LeagueConfig){
  const names=new Set(teamNames(cfg));
  return z.object({
    schema_version: z.literal(1), league:z.literal(cfg.slug),
    season:z.literal(cfg.season), competition_id:z.literal(cfg.competitionId),
    round:z.number().int().min(1).max(cfg.roundCount), observed_at:z.string().datetime({offset:true}),
    source:z.literal('authenticated_ui'),source_url:z.string().url(),
    expected_total:z.literal(cfg.teamCount),inserted:z.number().int().min(0).max(cfg.teamCount),
    teams:z.array(teamSchema).length(cfg.teamCount),competition:makeCompetitionSchema(cfg).optional(),
  }).strict().superRefine((s,ctx)=>{
    const bad=(message:string)=>ctx.addIssue({code:z.ZodIssueCode.custom,message});
    const url=new URL(s.source_url);
    if(url.origin!=='https://leghe.fantacalcio.it'||url.pathname!==`/${s.league}/view/competition/${s.competition_id}/manage-lineups/${s.round}`)bad('La pagina sorgente non corrisponde alla giornata.');
    if(new Set(s.teams.map(t=>t.team_key)).size!==cfg.teamCount)bad('Sono presenti squadre duplicate.');
    for(const t of s.teams){
      if(!names.has(t.name)||t.team_key!==t.name)bad('Elenco squadre diverso da quello della lega.');
      if(t.source_status!==(t.present?'check-circle':'Non inserita'))bad('Indicatore di formazione incoerente.');
    }
    if(s.competition){
      for(const r of s.competition.calendar)for(const m of r.matches)if(!names.has(m.home)||!names.has(m.away))bad('Calendario con squadre non appartenenti alla lega.');
    }
    if(s.teams.filter(t=>t.present).length!==s.inserted)bad('Il conteggio non coincide con le squadre.');
    if(Date.parse(s.observed_at)>Date.now()+60000)bad('La lettura ha una data futura.');
  });
}
// The schema is rebuilt only when the config really changes: listSnapshots parses every
// row, and updatedAt in the key is what invalidates the cache.
const schemaCache=new Map<string,ReturnType<typeof makeSnapshotSchema>>();
export function snapshotSchemaFor(cfg:LeagueConfig){
  const key=`${cfg.id}:${cfg.updatedAt}`;
  const cached=schemaCache.get(key);if(cached)return cached;
  const schema=makeSnapshotSchema(cfg);schemaCache.set(key,schema);return schema;
}
export type Competition=z.infer<ReturnType<typeof makeCompetitionSchema>>;
export type Snapshot=z.infer<ReturnType<typeof makeSnapshotSchema>>;
export type TeamSnapshot=Snapshot['teams'][number];
export type Archive={canManage?:boolean;reviews:Review[];snapshots:Snapshot[]; events:{team_key:string;round:number;source_label:string;source_time_text:string;source_url:string}[]};
export function normalize(s:Snapshot):Snapshot{return {...s,observed_at:new Date(s.observed_at).toISOString(),teams:[...s.teams].sort((a,b)=>a.team_key.localeCompare(b.team_key))};}
export function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function latestByRound(snapshots:Snapshot[]):Map<number,Snapshot>{const m=new Map<number,Snapshot>();for(const s of [...snapshots].sort((a,b)=>a.observed_at.localeCompare(b.observed_at)))m.set(s.round,s);return m;}
export function initials(name:string){const tokens=name.split(' ').filter(x=>x.length>2);const source=tokens.length?tokens:[name];return source.slice(0,2).map(x=>x[0]).join('')||name.slice(0,2);}
export function displayDate(date:string){return new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}).format(new Date(date));}
