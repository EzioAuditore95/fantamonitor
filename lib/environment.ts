type Environment=Record<string,string|undefined>;
export function isPreview(env:Environment=process.env){return env.VERCEL_ENV==='preview';}
export function supabaseEnvironmentConfigured(env:Environment=process.env){
 const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return false;
 if(!isPreview(env))return true;
 const preview=env.FM_PREVIEW_SUPABASE_PROJECT_REF,production=env.FM_PRODUCTION_SUPABASE_PROJECT_REF;
 if(!preview||!production||preview===production)return false;
 try{return new URL(url).origin===`https://${preview}.supabase.co`;}catch{return false;}
}
