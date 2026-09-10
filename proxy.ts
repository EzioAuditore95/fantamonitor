import { createServerClient } from '@supabase/ssr';
import { NextResponse,type NextRequest } from 'next/server';
export async function proxy(request:NextRequest){
  let response=NextResponse.next({request});
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)return response;
  const supabase=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{
    cookies:{getAll(){return request.cookies.getAll();},setAll(values){
      values.forEach(({name,value})=>request.cookies.set(name,value));response=NextResponse.next({request});
      values.forEach(({name,value,options})=>response.cookies.set(name,value,options));
    }},
  });
  // Validate against Auth; never authorize from client-supplied session claims alone.
  await supabase.auth.getUser();
  response.headers.set('Cache-Control','private, no-store');
  return response;
}
export const config={matcher:['/','/login','/api/:path*']};
