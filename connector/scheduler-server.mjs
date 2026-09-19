import http from 'node:http';
import { bearerMatches,signedRequest } from './lib/scheduler.mjs';

// A thin shell, deliberately. pg_cron calls POST /run through pg_net; this forwards the
// request to the connector's /auto-sync and relays the answer. It used to spawn cron.mjs,
// which was largely a copy of server.mjs and produced snapshots without the competition
// block; the claim, the capture and the Telegram publishing now live in one place only.
const port=Number(process.env.PORT||8080);
const eventSecret=process.env.EVENT_SCHEDULER_SECRET||'';
const connectorSecret=process.env.FANTAMONITOR_CONNECTOR_SECRET||'';
const connectorUrl=(process.env.CONNECTOR_URL||process.env.CONNECTOR_PUBLIC_URL||'https://fantamonitor-connector-production.up.railway.app').replace(/\/$/,'');
let running=false;

function json(res,status,body){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));}

async function triggerAutoSync(){
  if(!connectorSecret)throw new Error('scheduler_secret_missing');
  const {timestamp,body,signature}=signedRequest(connectorSecret);
  const response=await fetch(`${connectorUrl}/auto-sync`,{method:'POST',
    headers:{'content-type':'application/json','x-fm-timestamp':timestamp,'x-fm-signature':signature},
    body,signal:AbortSignal.timeout(120000)});
  const text=await response.text();
  if(!response.ok)throw new Error(`connector_http_${response.status}:${text.slice(0,300)}`);
  try{return JSON.parse(text);}catch{return {raw:text.slice(0,300)};}
}

const server=http.createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,running});
  if(req.method!=='POST'||req.url!=='/run')return json(res,404,{error:'not_found'});
  if(!bearerMatches(req.headers.authorization,eventSecret))return json(res,401,{error:'unauthorized'});
  // Single flight: pg_cron books a main job and a retry five minutes later, and a slow
  // capture must not end up running twice at once.
  if(running)return json(res,202,{status:'already_running'});
  running=true;
  try{
    const result=await triggerAutoSync();
    console.info('scheduler_run_complete',result);
    return json(res,200,{status:'complete',result});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    console.error('event_scheduler_failed',{error:message});
    return json(res,500,{error:message});
  }finally{running=false;}
});
server.listen(port,()=>console.log(`event scheduler listening on ${port}`,{connectorUrl,hasEventSecret:Boolean(eventSecret),hasConnectorSecret:Boolean(connectorSecret)}));
