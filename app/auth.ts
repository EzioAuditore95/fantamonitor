import { createClient,supabaseConfigured } from '@/lib/supabase/server';
export type AppUser={userId:string;email:string;role:'admin'|'viewer';leagueId:string};
export async function getAppUser():Promise<AppUser|null>{
  if(!supabaseConfigured())return null;
  const supabase=await createClient();
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user)return null;
  // Una membership per lega: finché l'app è a lega singola si usa la prima, ordinata
  // in modo stabile. La risoluzione per slug arriva con le route /l/[slug].
  const {data:memberships,error:dbError}=await supabase.from('fm_memberships').select('league_id,role').eq('user_id',user.id).order('league_id').limit(1);
  if(dbError)throw new Error('Membership unavailable');
  const membership=memberships?.[0];
  if(!membership||!['admin','viewer'].includes(membership.role))return null;
  return {userId:user.id,email:user.email??'',role:membership.role,leagueId:membership.league_id};
}
