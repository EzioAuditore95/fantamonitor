import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
import { getAppUser } from '@/app/auth';
import { listSnapshots } from '@/lib/archive';
import { competitionSchema } from '@/lib/model';

const headers={'Cache-Control':'private, no-store'};
const MAX_RESPONSE=524_288;
function secret(){return process.env.FANTAMONITOR_CONNECTOR_SECRET??'';}
function signature(timestamp:string,body:string){return createHmac('sha256',secret()).update(`${timestamp}.${body}`).digest('hex');}
function fingerprint(){return createHash('sha256').update(secret()).digest('hex').slice(0,12);}
async function archivedFallback(){try{const snapshots=await listSnapshots();const last=[...snapshots].reverse().find(s=>s.competition)?.competition;if(!last)return null;return {...last,warnings:[...last.warnings,'Dati mostrati dall’ultimo snapshot archiviato: aggiornamento live non disponibile.']};}catch{return null;}}

export async function GET(){
  const user=await getAppUser();
  if(!user)return Response.json({error:'Accesso richiesto.'},{status:401,headers});
  const endpoint=process.env.FANTAMONITOR_CONNECTOR_URL;
  if(!endpoint||!secret()){const fallback=await archivedFallback();return fallback?Response.json(fallback,{headers}):Response.json({error:'Connettore non configurato.'},{status:503,headers});}
  try{
    const timestamp=String(Date.now()),body='{}';
    const response=await fetch(endpoint.replace(/\/$/,'')+'/competition',{method:'POST',headers:{'content-type':'application/json','x-fm-timestamp':timestamp,'x-fm-signature':signature(timestamp,body)},body,cache:'no-store',signal:AbortSignal.timeout(35_000)});
    const text=await response.text();
    if(text.length>MAX_RESPONSE)throw new Error('competition_response_too_large');
    if(!response.ok){console.error('competition_connector_rejected',{status:response.status,fingerprint:fingerprint()});throw new Error(`competition_http_${response.status}`);}
    const returned=response.headers.get('x-fm-signature')??'',expected=signature(timestamp,text);
    if(!returned||returned.length!==expected.length||!timingSafeEqual(Buffer.from(returned),Buffer.from(expected)))throw new Error('competition_signature_invalid');
    const payload=JSON.parse(text) as {competition?:unknown};
    return Response.json(competitionSchema.parse(payload.competition),{headers});
  }catch(error){console.error('performance_fetch_failed',error instanceof Error?error.message:error);const fallback=await archivedFallback();return fallback?Response.json(fallback,{headers}):Response.json({error:'Dati competitivi non disponibili dal connettore Fantacalcio.'},{status:502,headers});}
}
