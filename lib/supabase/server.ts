import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
export function supabaseConfigured(){return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);}
export async function createClient(){
  const store=await cookies();
  if(!supabaseConfigured())throw new Error('Supabase configuration missing');
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{
    cookies:{getAll(){return store.getAll();},setAll(values){try{values.forEach(({name,value,options})=>store.set(name,value,options));}catch{/* Server components cannot write; proxy refreshes cookies. */}}},
  });
}
