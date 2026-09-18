import { chromium } from 'playwright';
import { maxBrowserContexts } from './config.mjs';
import { createKeyedMutex,createLimiter } from './concurrency.mjs';

// One browser per process, reused. It used to launch a new one per operation, and an
// auto-sync did that twice: with N leagues and 5 checkpoints that stopped being viable.
let launching=null;
async function browser(){
  if(!launching)launching=chromium.launch({headless:true}).catch(e=>{launching=null;throw e;});
  return launching;
}
const limiter=createLimiter(maxBrowserContexts);
const perLeague=createKeyedMutex();

// Per-league mutex: two requests on the same league must not trigger two logins.
// Global cap: container memory is the constraint here, not CPU.
export function withLeagueContext(leagueId,storageState,fn){
  return perLeague.run(leagueId,()=>limiter.run(async()=>{
    const instance=await browser();
    const context=await instance.newContext(storageState?{storageState}:{});
    try{return await fn(context);}finally{await context.close().catch(()=>{});}
  }));
}
export async function closeBrowser(){
  if(!launching)return;
  const instance=await launching.catch(()=>null);
  launching=null;
  await instance?.close().catch(()=>{});
}
export const browserStats=()=>({active:limiter.active,queued:limiter.queued,leagues:perLeague.size});
