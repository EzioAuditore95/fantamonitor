import { z } from 'zod';
import { requireLeagueMember } from '@/app/auth';
import { sourceSeason } from '@/lib/serie-a';
import { previousSeasons } from '@/lib/serie-a-history';
import { importSeason } from '@/lib/serie-a-store';
const headers={'Cache-Control':'private, no-store'};
const inputSchema=z.object({league:z.string().min(1),seasons:z.array(z.string().regex(/^\d{4}-\d{2}$/)).max(10).optional()}).strict();

// Past seasons, imported by hand. Unlike the rounds, there is nothing to keep up with: a finished
// season does not change, so this runs once and has no schedule behind it.
export async function POST(request:Request){
  let input:z.infer<typeof inputSchema>;
  try{input=inputSchema.parse(await request.json());}
  catch{return Response.json({error:'Richiesta non valida.'},{status:422,headers});}
  const ctx=await requireLeagueMember(input.league);
  if(ctx instanceof Response)return ctx;
  if(ctx.user.role!=='admin')return Response.json({error:'Operazione riservata all’amministratore.'},{status:403,headers});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Origine non autorizzata.'},{status:403,headers});
  if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Formato JSON richiesto.'},{status:415,headers});
  const seasons=input.seasons??previousSeasons(sourceSeason(ctx.cfg.season));
  const imported:{season:string;players:number|null;skipped?:string}[]=[];
  try{
    for(const season of seasons){
      // The source stops somewhere in the last decade; asking beyond it is not a failure.
      const result=await importSeason(season);
      imported.push(result?{season,players:result.players}:{season,players:null,skipped:'non_pubblicata'});
    }
    return Response.json({seasons:imported},{headers});
  }catch(e){
    const message=e instanceof Error?e.message:'unknown';
    if(message==='serie_a_history_live')return Response.json({error:'Quella stagione è ancora in corso: i suoi voti arrivano giornata per giornata.',seasons:imported},{status:409,headers});
    if(message==='serie_a_history_empty')return Response.json({error:'La pagina delle statistiche di Fantacalcio è cambiata: nessuna stagione è stata importata.',seasons:imported},{status:502,headers});
    console.error('serie_a_history_route_failed',message);
    return Response.json({error:'Importazione dello storico non riuscita.',seasons:imported},{status:502,headers});
  }
}
