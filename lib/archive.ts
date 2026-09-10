import { env } from 'cloudflare:workers';
import { snapshotSchema,normalize,canonical,identityKey,type Snapshot } from './model';
export function initialArchive(){
  const raw=(env as unknown as {INITIAL_ARCHIVE_JSON?:string}).INITIAL_ARCHIVE_JSON;
  if(!raw)return {snapshots:[] as Snapshot[],events:[] as Array<{team_key:string;round:number;source_label:string;source_time_text:string;source_url:string}>};
  const parsed=JSON.parse(raw);
  return {snapshots:(parsed.snapshots as unknown[]).map(s=>normalize(snapshotSchema.parse(s))),events:parsed.events??[]};
}
function db():D1Database {if(!env.DB)throw new Error('Storage unavailable');return env.DB;}
export async function listSnapshots():Promise<Snapshot[]>{
  const result=await db().prepare('SELECT body FROM observations WHERE league=? ORDER BY observed_at DESC LIMIT 10000').bind('chefantavitae10').all<{body:string}>();
  const map=new Map(initialArchive().snapshots.map(s=>[identityKey(s),s]));
  for(const row of result.results){const s=snapshotSchema.parse(JSON.parse(row.body));map.set(identityKey(s),normalize(s));}
  return [...map.values()].sort((a,b)=>a.observed_at.localeCompare(b.observed_at));
}
export async function importSnapshots(input:unknown,user:string){
  const raw=Array.isArray(input)?input:[input];
  if(!raw.length||raw.length>100)throw new Error('Importa da 1 a 100 letture per volta.');
  const samples=raw.map(s=>normalize(snapshotSchema.parse(s)));
  const existing=new Map((await listSnapshots()).map(s=>[identityKey(s),s]));
  const additions:Snapshot[]=[];
  for(const s of samples){
    const key=identityKey(s),previous=existing.get(key);
    if(previous){if(canonical(previous)!==canonical(s))throw new Error('Una lettura alla stessa data contiene dati diversi. Nessun dato è stato sostituito.');}
    else {existing.set(key,s);additions.push(s);}
  }
  const statements=[];
  for(const s of additions){
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(s)));
    const id=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
    statements.push(db().prepare(`INSERT INTO observations
      (id,league,season,competition,round,observed_at,imported_at,imported_by,body)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(id,s.league,s.season,s.competition_id,s.round,s.observed_at,new Date().toISOString(),user,canonical(s)));
  }
  if(statements.length)await db().batch(statements);
  return {imported:additions.length,duplicates:samples.length-additions.length};
}
