import {createClient} from '@/lib/supabase/server';
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin)return new Response('Forbidden',{status:403});
 const client=await createClient();await client.auth.signOut();return Response.redirect(new URL('/login',request.url),303);
}
