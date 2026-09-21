import { z,ZodError } from 'zod';
import { requireLeagueMember } from '@/app/auth';
import { pendingRounds,sourceSeason } from '@/lib/serie-a';
import { storedRounds,syncSerieA } from '@/lib/serie-a-store';
const headers={'Cache-Control':'private, no-store'};
const inputSchema=z.object({league:z.string().min(1)}).strict();

// The league is asked for only to resolve the season and the membership: what this route writes
// belongs to Serie A, and a member of any league reads the same rows afterwards.
export async function GET(request:Request){
  const ctx=await requireLeagueMember(new URL(request.url).searchParams.get('league'));
  if(ctx instanceof Response)return ctx;
  try{
    const season=sourceSeason(ctx.cfg.season);
    const stored=await storedRounds(season);
    return Response.json({season,rounds:stored,pending:pendingRounds(stored).length,canManage:ctx.user.role==='admin'},{headers});
  }catch(e){console.error('serie_a_state_failed',e instanceof Error?e.message:'unknown');
    return Response.json({error:'Stato dei voti non disponibile.'},{status:503,headers});}
}

export async function POST(request:Request){
  let input:z.infer<typeof inputSchema>;
  try{input=inputSchema.parse(await request.json());}
  catch{return Response.json({error:'Richiesta non valida.'},{status:422,headers});}
  const ctx=await requireLeagueMember(input.league);
  if(ctx instanceof Response)return ctx;
  if(ctx.user.role!=='admin')return Response.json({error:'Operazione riservata all’amministratore.'},{status:403,headers});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Origine non autorizzata.'},{status:403,headers});
  if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Formato JSON richiesto.'},{status:415,headers});
  try{
    return Response.json(await syncSerieA(sourceSeason(ctx.cfg.season)),{headers});
  }catch(e){
    // A feed that changed shape is not a transient failure, and saying so saves an hour of
    // looking at the database: the import writes nothing until the whole round is understood.
    if(e instanceof ZodError){console.error('serie_a_feed_changed',e.issues[0]?.path.join('.'));
      return Response.json({error:'Il formato dei voti di Fantacalcio è cambiato: nessun dato è stato importato.'},{status:502,headers});}
    console.error('serie_a_sync_failed',e instanceof Error?e.message:'unknown');
    return Response.json({error:'Aggiornamento dei voti non riuscito.'},{status:502,headers});
  }
}
