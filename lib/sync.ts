import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
import { snapshotSchema,competitionSchema,normalize,type Competition } from './model';
import { importSnapshots } from './archive';

const MAX_RESPONSE=524_288;
function secret(){return process.env.FANTAMONITOR_CONNECTOR_SECRET??'';}
function endpoint(){return (process.env.FANTAMONITOR_CONNECTOR_URL??'').replace(/\/$/,'');}
function secretFingerprint(){return createHash('sha256').update(secret()).digest('hex').slice(0,12);}
function signature(timestamp:string,body:string){return createHmac('sha256',secret()).update(`${timestamp}.${body}`).digest('hex');}
async function connectorRequest(path:string,input:unknown,timeout:number){
  if(!endpoint()||!secret())throw new Error('Connettore non configurato.');
  const timestamp=String(Date.now()),body=JSON.stringify(input);
  const response=await fetch(endpoint()+path,{method:'POST',headers:{'content-type':'application/json','x-fm-timestamp':timestamp,'x-fm-signature':signature(timestamp,body)},body,cache:'no-store',signal:AbortSignal.timeout(timeout)});
  const text=await response.text();if(text.length>MAX_RESPONSE)throw new Error('Risposta del connettore troppo grande.');
  if(!response.ok){if(response.status===401){let code='';try{code=String((JSON.parse(text) as {error?:unknown}).error??'');}catch{}console.error('connector_rejected',{path,status:response.status,code,secretFingerprint:secretFingerprint()});if(code==='connector_auth_failed')throw new Error('Credenziali Fantacalcio rifiutate dal connettore.');throw new Error('Autenticazione del connettore rifiutata.');}const detail=text.replace(/[\r\n]+/g,' ').slice(0,160);throw new Error(`Connettore non disponibile (${response.status})${detail?`: ${detail}`:'.'}`);}
  const returned=response.headers.get('x-fm-signature')??'',expected=signature(timestamp,text);if(!returned||returned.length!==expected.length||!timingSafeEqual(Buffer.from(returned),Buffer.from(expected)))throw new Error('Firma del connettore non valida.');
  return JSON.parse(text) as Record<string,unknown>;
}
async function competitionFromConnector():Promise<Competition|null>{try{const payload=await connectorRequest('/competition',{},35_000);return competitionSchema.parse(payload.competition);}catch(error){console.error('competition_snapshot_failed',error instanceof Error?error.message:error);return null;}}

export async function syncFromConnector(userId:string,round:number){
  if(!Number.isInteger(round)||round<1||round>35)throw new Error('Giornata non valida.');
  console.info('connector_request',{endpoint:endpoint(),secretFingerprint:secretFingerprint()});
  const payload=await connectorRequest('/sync',{round},30_000);
  const base=snapshotSchema.parse(payload.snapshot);
  const competition=await competitionFromConnector();
  const snapshot=normalize(snapshotSchema.parse(competition?{...base,competition}:base));
  return {...(await importSnapshots(snapshot,userId)),round:snapshot.round,observedAt:snapshot.observed_at,competitionCaptured:Boolean(competition)};
}
