import { createClient,supabaseConfigured } from '@/lib/supabase/server';
export type AppUser={userId:string;email:string;role:'admin'|'viewer'};
export async function getAppUser():Promise<AppUser|null>{
  if(!supabaseConfigured())return null;
  const supabase=await createClient();
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user)return null;
  const {data:membership,error:dbError}=await supabase.from('fm_members').select('role').eq('user_id',user.id).maybeSingle();
  if(dbError)throw new Error('Membership unavailable');
  if(!membership||!['admin','viewer'].includes(membership.role))return null;
  return {userId:user.id,email:user.email??'',role:membership.role};
}
