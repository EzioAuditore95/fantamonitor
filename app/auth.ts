import { createClient,supabaseConfigured } from '@/lib/supabase/server';
import { loadLeagueConfig } from '@/lib/league-server';
import type { LeagueConfig } from '@/lib/league';
export type AppUser={userId:string;email:string;role:'admin'|'viewer';leagueId:string};
export async function getAppUser():Promise<AppUser|null>{
  if(!supabaseConfigured())return null;
  const supabase=await createClient();
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user)return null;
  // One membership per league: while the app is single-league it takes the first, in a
  // stable order. Resolution by slug arrives with the /l/[slug] routes.
  const {data:memberships,error:dbError}=await supabase.from('fm_memberships').select('league_id,role').eq('user_id',user.id).order('league_id').limit(1);
  if(dbError)throw new Error('Membership unavailable');
  const membership=memberships?.[0];
  if(!membership||!['admin','viewer'].includes(membership.role))return null;
  return {userId:user.id,email:user.email??'',role:membership.role,leagueId:membership.league_id};
}

const headers={'Cache-Control':'private, no-store'};
// Concentrates the checks every route would otherwise repeat: session, membership of the
// requested league, unknown league. Returns a Response to be handed back as is.
export async function requireLeagueMember(slug:string|null):Promise<{user:AppUser;cfg:LeagueConfig}|Response>{
  const user=await getAppUser();
  if(!user)return Response.json({error:'Accesso richiesto.'},{status:401,headers});
  if(!slug)return Response.json({error:'Lega non indicata.'},{status:400,headers});
  const cfg=await loadLeagueConfig(slug);
  if(!cfg)return Response.json({error:'Lega non disponibile.'},{status:404,headers});
  return {user,cfg};
}
