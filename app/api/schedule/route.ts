import { getAppUser } from '@/app/auth';
import { createClient } from '@/lib/supabase/server';

const headers={'Cache-Control':'private, no-store'};

export async function GET(){
  const user=await getAppUser();
  if(!user)return Response.json({error:'Accesso richiesto.'},{status:401,headers});
  try{
    const client=await createClient();
    const [{data:schedule,error:scheduleError},{data:runs,error:runsError}]=await Promise.all([
      client.from('fm_round_schedule').select('round,serie_a_round,start_at,source,source_url,updated_at').order('round'),
      client.from('fm_auto_sync_runs').select('round,checkpoint,scheduled_at,executed_at,status,attempt_count,error').order('scheduled_at',{ascending:false}).limit(30),
    ]);
    if(scheduleError||runsError)throw scheduleError??runsError;
    return Response.json({schedule:schedule??[],runs:runs??[]},{headers});
  }catch(e){
    console.error('schedule_read_failed',e instanceof Error?e.message:'unknown');
    return Response.json({error:'Calendario non disponibile.'},{status:503,headers});
  }
}
