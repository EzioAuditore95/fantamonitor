import { chromium } from 'playwright';
import { maxBrowserContexts } from './config.mjs';
import { createKeyedMutex,createLimiter } from './concurrency.mjs';

// Un solo browser per processo, riusato. Prima se ne lanciava uno nuovo a ogni operazione,
// e un auto-sync ne faceva due: con N leghe e 5 checkpoint diventava insostenibile.
let launching=null;
async function browser(){
  if(!launching)launching=chromium.launch({headless:true}).catch(e=>{launching=null;throw e;});
  return launching;
}
const limiter=createLimiter(maxBrowserContexts);
const perLeague=createKeyedMutex();

// Mutex per lega: due richieste sulla stessa lega non devono fare due login.
// Limite globale: la memoria del container è il vincolo, non la CPU.
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
