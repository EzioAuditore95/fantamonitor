import { currentSourceSeason } from '@/lib/serie-a';
import { syncSerieA } from '@/lib/serie-a-store';
const headers={'Cache-Control':'private, no-store'};

// The scheduled half of the Serie A import. Vercel sends `Authorization: Bearer ${CRON_SECRET}`
// with every cron invocation, and that is the key the database checks: nothing is compared here,
// so there is no second definition of who may write and no constant-time comparison to get wrong.
// The season comes from the calendar because this caller has no session and therefore no league.
export async function GET(request:Request){
  const key=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim()??'';
  if(!key)return Response.json({error:'Chiave richiesta.'},{status:401,headers});
  try{
    return Response.json(await syncSerieA(currentSourceSeason(),key),{headers});
  }catch(e){
    const message=e instanceof Error?e.message:'unknown';
    if(message==='serie_a_unauthorized')return Response.json({error:'Chiave non valida.'},{status:403,headers});
    console.error('serie_a_cron_failed',message);
    return Response.json({error:'Aggiornamento dei voti non riuscito.'},{status:502,headers});
  }
}
