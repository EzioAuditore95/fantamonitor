import { createClient } from './supabase/server';
import {snapshotSchema,normalize,canonical,type Snapshot} from './model';
export function initialArchive(){return {events:[]};}
export async function listSnapshots():Promise<Snapshot[]>{
 const client=await createClient();const rows:Snapshot[]=[];
 for(let offset=0;;offset+=500){const {data,error}=await client.from('fm_observations').select('body').order('observed_at').order('id').range(offset,offset+499);if(error)throw new Error('Archive unavailable');
 rows.push(...data.map(r=>normalize(snapshotSchema.parse(r.body))));if(data.length<500)break;}
 return rows;
}
export async function listEvents(){const client=await createClient();const {data,error}=await client.from('fm_source_events').select('body').order('id');if(error)throw new Error('Events unavailable');return data.map(r=>r.body);}
export async function importSnapshots(input:unknown,_user:string){
 const raw=Array.isArray(input)?input:[input];if(!raw.length||raw.length>100)throw new Error('Importa da 1 a 100 letture per volta.');
 const samples=raw.map(s=>normalize(snapshotSchema.parse(s)));
 const records=await Promise.all(samples.map(async s=>{const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(s)));return {id:Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join(''),body:s};}));
 const client=await createClient();const {data,error}=await client.rpc('fm_import_observations',{records});
 if(error){if(error.message.includes('observation_conflict'))throw new Error('Una lettura alla stessa data contiene dati diversi. Nessun dato è stato sostituito.');throw new Error('Import failed');}
 return data as {imported:number;duplicates:number};
}
