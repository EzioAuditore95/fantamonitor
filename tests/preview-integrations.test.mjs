import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {CHEFANTAVITAE10} from '../lib/league.ts';
register('./helpers/auth-loader.mjs',import.meta.url,{data:{mockConnector:false}});
const {checkConnectorCredentials,syncFromConnector}=await import('../lib/sync.ts');
const {credentialsConfigured}=await import('../lib/credentials.ts');
const cron=await import('../app/api/serie-a/cron/route.ts');
test('preview blocks connector, credential setup and cron even when production variables leak in',async()=>{
 const saved={VERCEL_ENV:process.env.VERCEL_ENV,FANTAMONITOR_CONNECTOR_URL:process.env.FANTAMONITOR_CONNECTOR_URL,FANTAMONITOR_CONNECTOR_SECRET:process.env.FANTAMONITOR_CONNECTOR_SECRET,FM_CREDENTIAL_PUBLIC_KEY:process.env.FM_CREDENTIAL_PUBLIC_KEY};
 const originalFetch=globalThis.fetch;let calls=0;
 try{
  Object.assign(process.env,{VERCEL_ENV:'preview',FANTAMONITOR_CONNECTOR_URL:'https://connector.example.test',FANTAMONITOR_CONNECTOR_SECRET:'test-secret',FM_CREDENTIAL_PUBLIC_KEY:'test-public-key'});
  globalThis.fetch=async()=>{calls++;throw new Error('preview contacted production');};
  const cfg=CHEFANTAVITAE10;
  await assert.rejects(checkConnectorCredentials(cfg),/anteprime/);
  await assert.rejects(syncFromConnector(cfg,1),/anteprime/);
  assert.equal(credentialsConfigured(),false);
  const response=await cron.GET(new Request('https://preview.example.test/api/serie-a/cron',{headers:{authorization:'Bearer test-secret'}}));
  assert.equal(response.status,403);assert.equal(calls,0);
 }finally{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
