import { createClient,supabaseConfigured } from '@/lib/supabase/server';
import { loadLeagueConfig } from '@/lib/league-server';
import type { LeagueConfig } from '@/lib/league';
export type AppIdentity={userId:string;email:string};
export type AppUser=AppIdentity&{role:'admin'|'viewer';leagueId:string};
export async function getAppUser():Promise<AppIdentity|null>{
  if(!supabaseConfigured())return null;
  const supabase=await createClient();
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user)return null;
  return {userId:user.id,email:user.email??''};
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
  const supabase=await createClient();
  const {data:membership,error}=await supabase.from('fm_memberships').select('league_id,role').eq('user_id',user.userId).eq('league_id',cfg.id).maybeSingle();
  if(error)throw new Error('Membership unavailable');
  if(!membership||!['admin','viewer'].includes(membership.role))return Response.json({error:'Lega non disponibile.'},{status:404,headers});
  return {user:{...user,role:membership.role,leagueId:membership.league_id},cfg};
}
