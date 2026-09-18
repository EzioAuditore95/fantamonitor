import { autoSyncSecret,supabaseKey,supabaseUrl } from './config.mjs';
export async function rpc(name,args){
  if(!supabaseUrl||!supabaseKey||!autoSyncSecret)throw new Error('auto_sync_not_configured');
  const response=await fetch(`${supabaseUrl.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{
    method:'POST',headers:{apikey:supabaseKey,'content-type':'application/json'},
    body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
  const text=await response.text();
  if(!response.ok)throw new Error(`rpc_${name}_http_${response.status}:${text.slice(0,160)}`);
  if(!text)return null;
  try{return JSON.parse(text);}catch{return text;}
}
// L'access_key è lo stesso per tutte le leghe: autentica il connettore, non la lega.
export const withKey=args=>({access_key:autoSyncSecret,...args});
