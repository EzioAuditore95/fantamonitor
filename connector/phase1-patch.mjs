import { EventEmitter } from 'node:events';
const originalFetch=globalThis.fetch.bind(globalThis);
const ASSET_BASE='https://d2lhpso9w1g8dk.cloudfront.net/web/risorse';
function asset(kind,file){return typeof file==='string'&&file.trim()?`${ASSET_BASE}/${kind}_2026/${file.trim()}`:undefined;}
function roleName(value){const raw=Array.isArray(value)?value[0]:value;if(typeof raw==='string'&&raw.trim())return raw.trim();return ({1:'P',2:'D',3:'C',4:'A'})[Number(raw)];}
function player(p){if(!p||typeof p!=='object')return null;const name=typeof p.plyr==='string'?p.plyr.trim():'';const id=Number(p.pid);if(!name||!Number.isInteger(id))return null;return {id,name,role:roleName(p.role)};}
function enrichTeam(t){if(!t||typeof t!=='object')return t;return {...t,manager:typeof t.nu==='string'?t.nu:undefined,budget:Number.isFinite(Number(t.crs))?Number(t.crs):undefined,crest:asset('squadra',t.l),kit:asset('maglietta',t.ms)};}
function teamEndpoint(url){return /\/onboarding\/v1\/league\/(?:competition\/)?teams(?:\?|$)/.test(url)||/\/onboarding\/v1\/league\/teams\/my(?:\?|$)/.test(url);}
function enrichPayload(url,j){
 if(/\/onboarding\/v1\/league\/(?:competition\/)?teams(?:\?|$)/.test(url)){if(Array.isArray(j?.data))j.data=j.data.map(enrichTeam);return j;}
 if(/\/onboarding\/v1\/league\/teams\/my(?:\?|$)/.test(url))return enrichTeam(j);
 if(/\/gaming\/v1\/teamLineup\/visualizza\//.test(url)&&j?.teamLineupDto){
   const dto=j.teamLineupDto,info=Array.isArray(j.lineUpInfo)?j.lineUpInfo:[];
   const byId=new Map(info.map(x=>[Number(x.pid),x]));
   const resolve=ids=>(Array.isArray(ids)?ids:[]).map(id=>player(byId.get(Number(id)))).filter(Boolean);
   dto.module=typeof dto.mdl==='string'?dto.mdl:undefined;
   dto.startersPlayers=resolve(dto.starts);
   dto.benchPlayers=resolve(dto.bench);
   dto.rosterPlayers=info.map(player).filter(Boolean);
   return j;
 }
 return j;
}
const originalEmit=EventEmitter.prototype.emit;
EventEmitter.prototype.emit=function(event,...args){
 if(event==='response'){
   const response=args[0];
   try{
     const url=response?.url?.();
     if(url&&teamEndpoint(url)&&typeof response.json==='function'&&!response.__fmPhase1Patched){
       const originalJson=response.json.bind(response);
       Object.defineProperty(response,'__fmPhase1Patched',{value:true});
       Object.defineProperty(response,'json',{configurable:true,value:async()=>enrichPayload(url,await originalJson())});
     }
   }catch{}
 }
 return originalEmit.call(this,event,...args);
};
globalThis.fetch=async function(input,init){
 const response=await originalFetch(input,init);
 const url=typeof input==='string'?input:input instanceof URL?input.href:input?.url||response.url;
 if(!/apileague\.fantacalcio\.it/.test(url))return response;
 if(!(teamEndpoint(url)||/\/gaming\/v1\/teamLineup\/visualizza\//.test(url)))return response;
 const type=response.headers.get('content-type')||'';if(!type.includes('json'))return response;
 try{const text=await response.text();const json=enrichPayload(url,JSON.parse(text));const headers=new Headers(response.headers);headers.delete('content-length');return new Response(JSON.stringify(json),{status:response.status,statusText:response.statusText,headers});}catch{return response;}
};
