import { z } from 'zod';
import { requireLeagueMember } from '@/app/auth';
import { createClient } from '@/lib/supabase/server';
import { credentialsConfigured,fingerprint,seal } from '@/lib/credentials';
import { checkConnectorCredentials } from '@/lib/sync';
const headers={'Cache-Control':'private, no-store'};
const MAX_BODY=131_072;
const inputSchema=z.discriminatedUnion('mode',[
  z.object({mode:z.literal('password'),username:z.string().trim().min(3).max(200),password:z.string().min(1).max(200)}).strict(),
  z.object({mode:z.literal('session'),storageState:z.string().min(2).max(120_000)}).strict(),
]);

export async function GET(request:Request){
  const ctx=await requireLeagueMember(new URL(request.url).searchParams.get('league'));
  if(ctx instanceof Response)return ctx;
  const {cfg}=ctx;
  try{
    const client=await createClient();
    const {data,error}=await client.rpc('fm_league_credential_status',{league:cfg.id});
    if(error)throw error;
    return Response.json({...(data as object),encryptionReady:credentialsConfigured()},{headers});
  }catch(e){console.error('credential_status_failed',e instanceof Error?e.message:'unknown');
    return Response.json({error:'Stato delle credenziali non disponibile.'},{status:503,headers});}
}

export async function PUT(request:Request){
  // Connection check: the connector only logs in, it captures nothing.
  const ctx=await requireLeagueMember(new URL(request.url).searchParams.get('league'));
  if(ctx instanceof Response)return ctx;
  const {user,cfg}=ctx;
  if(user.role!=='admin')return Response.json({error:'Operazione riservata all’amministratore.'},{status:403,headers});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Origine non autorizzata.'},{status:403,headers});
  try{return Response.json(await checkConnectorCredentials(cfg),{headers});}
  catch(e){
    const message=e instanceof Error?e.message:'';
    console.error('credential_check_failed',message);
    if(message.includes('connector_auth_failed'))return Response.json({error:'Fantacalcio ha rifiutato le credenziali.'},{status:502,headers});
    if(message.includes('connector_credentials_missing'))return Response.json({error:'Nessuna credenziale collegata.'},{status:409,headers});
    return Response.json({error:'Verifica non riuscita: il connettore non ha risposto.'},{status:502,headers});
  }
}

export async function POST(request:Request){
  const ctx=await requireLeagueMember(new URL(request.url).searchParams.get('league'));
  if(ctx instanceof Response)return ctx;
  const {user,cfg}=ctx;
  if(user.role!=='admin')return Response.json({error:'Operazione riservata all’amministratore.'},{status:403,headers});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Origine non autorizzata.'},{status:403,headers});
  if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Formato JSON richiesto.'},{status:415,headers});
  if(!credentialsConfigured())return Response.json({error:'Cifratura non configurata: manca la chiave pubblica.'},{status:503,headers});
  try{
    const reader=request.body?.getReader();if(!reader)return Response.json({error:'Credenziali assenti.'},{status:400,headers});
    let size=0;const chunks:Uint8Array[]=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BODY){await reader.cancel();return Response.json({error:'Credenziali troppo grandi.'},{status:413,headers});}chunks.push(value);}
    const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
    const input=inputSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    let sealed:string,expiresAt:string|null=null;
    if(input.mode==='password'){
      sealed=seal(JSON.stringify({u:input.username,p:input.password}));
      // Never the username in clear text: same convention as secretFingerprint in lib/sync.ts.
      console.info('credential_sealed',{league:cfg.slug,mode:'password',usernameFingerprint:await fingerprint(input.username)});
    }else{
      try{JSON.parse(input.storageState);}catch{return Response.json({error:'La sessione non contiene JSON valido.'},{status:422,headers});}
      sealed=seal(input.storageState);
      // A Fantacalcio session expires on its own: past 12h the connector logs in again.
      expiresAt=new Date(Date.now()+12*60*60*1000).toISOString();
      console.info('credential_sealed',{league:cfg.slug,mode:'session',bytes:input.storageState.length});
    }
    const client=await createClient();
    const {error}=await client.rpc('fm_set_league_credentials',{league:cfg.id,mode:input.mode,sealed,version:1,expires_at:expiresAt});
    if(error)throw error;
    return Response.json({status:'saved'},{headers});
  }catch(e){
    if(e instanceof z.ZodError)return Response.json({error:'Credenziali non valide.'},{status:422,headers});
    if(e instanceof SyntaxError)return Response.json({error:'JSON non valido.'},{status:400,headers});
    console.error('credential_save_failed',e instanceof Error?e.message:'unknown');
    return Response.json({error:'Salvataggio non riuscito.'},{status:503,headers});
  }
}
