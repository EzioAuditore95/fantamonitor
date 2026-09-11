import http from 'node:http';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const port = Number(process.env.PORT || 8080);
const secret = process.env.FANTAMONITOR_CONNECTOR_SECRET || '';
const username = process.env.FANTACALCIO_USERNAME || '';
const password = process.env.FANTACALCIO_PASSWORD || '';
const league = 'chefantavitae10', competition = '337500';
const teams = ['AC Idovalproico','Atletico Fontanelle','FC LBVLA','FC SEMINI','FC Villaggio Mau Mau','FDS Sballo','I PIPPISTRELLI','Pro Spritz','Real Hasbulla','Salamandre'];
const secretFingerprint = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 12);
const sign = (timestamp, body) => crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
function auth(req, raw) { const ts=req.headers['x-fm-timestamp']||'', sig=req.headers['x-fm-signature']||''; const age=Math.abs(Date.now()-Number(ts)); return secret && /^\d+$/.test(ts) && age<120000 && sig.length===64 && crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(sign(ts,raw))); }
function json(res,status,body,ts) { const raw=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-fm-signature':sign(ts,raw)});res.end(raw); }
function findTeamObjects(value,out=[]) { if (Array.isArray(value)) { for (const item of value) findTeamObjects(item,out); return out; } if (!value || typeof value!=='object') return out; const name=typeof value.n==='string'?value.n:typeof value.name==='string'?value.name:typeof value.nome==='string'?value.nome:''; const id=Number(value.id??value.teamId??value.tid); if (name && Number.isInteger(id) && id>0) out.push({name:name.trim(),id}); for (const child of Object.values(value)) findTeamObjects(child,out); return out; }
function validateLineup(team,round,payload) { const dto=payload?.teamLineupDto; if (dto!=null && typeof dto!=='object') throw new Error('connector_lineup_invalid_payload'); if (dto && Number(dto.tid)!==team.id) throw new Error('connector_lineup_team_mismatch'); if (dto && Number(dto.mday)!==round) throw new Error('connector_lineup_round_mismatch'); const starts=dto?.starts; if (dto && starts!=null && !Array.isArray(starts)) throw new Error('connector_lineup_invalid_starts'); const present=Array.isArray(starts)&&starts.length===11; return {team_key:team.name,name:team.name,present,source_status:present?'Inserita':'Non inserita'}; }

async function capture(round) {
  if (!username || !password) throw new Error('connector_credentials_missing');
  const started=Date.now(); const browser=await chromium.launch({headless:true}); const page=await browser.newPage(); let competitionTeamsPayload=null;
  const responseListener=async response=>{ if (/\/onboarding\/v1\/league\/competition\/teams/.test(response.url())&&response.status()===200) { try { competitionTeamsPayload=await response.json(); } catch {} } };
  page.on('response',responseListener);
  try {
    const cdp=await page.context().newCDPSession(page); await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await page.goto('https://leghe.fantacalcio.it/login',{waitUntil:'domcontentloaded',timeout:20000});
    await page.locator('input[placeholder="Username"],input[autocomplete="username"]').first().fill(username);
    await page.locator('input[placeholder="Password"],input[autocomplete="current-password"]').first().fill(password);
    await page.getByRole('button',{name:'LOGIN'}).click();
    await Promise.race([page.waitForURL(u=>!/\/login(?:\/|$)/i.test(new URL(u).pathname),{timeout:15000}),page.waitForTimeout(3000)]);
    await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{});
    const baseUrl=`https://leghe.fantacalcio.it/${league}/view/competition/${competition}/manage-lineups/${round}`;
    const firstApiRequestPromise=page.waitForRequest(r=>/\/gaming\/v1\/teamLineup\/visualizza\//.test(r.url()),{timeout:20000});
    await page.goto(baseUrl,{waitUntil:'networkidle',timeout:30000});
    const firstApiRequest=await firstApiRequestPromise; const currentUrl=page.url();
    const loginForm=await page.locator('input[autocomplete="username"]:visible,input[placeholder="Username"]:visible').count()>0;
    console.info('fantacalcio_login_state',{currentUrl,loginForm,title:await page.title()});
    if (/\/login(?:\/|$)/i.test(currentUrl)||loginForm) throw new Error('connector_auth_failed');
    if (!competitionTeamsPayload) throw new Error('connector_team_list_missing');
    const discovered=findTeamObjects(competitionTeamsPayload); const uniqueByName=new Map(); for (const item of discovered) if (!uniqueByName.has(item.name)) uniqueByName.set(item.name,item.id);
    const teamIds=teams.map(name=>({name,id:uniqueByName.get(name)}));
    if (teamIds.some(t=>!Number.isInteger(t.id))) { console.error('connector_team_mapping_failed',{expected:teams,discovered:[...uniqueByName.entries()]}); throw new Error('connector_team_mapping_failed'); }
    const capturedHeaders=await firstApiRequest.allHeaders(); const apiHeaders={};
    for (const [key,value] of Object.entries(capturedHeaders)) { const lower=key.toLowerCase(); if (!key.startsWith(':') && !['host','content-length','connection','accept-encoding'].includes(lower) && !lower.startsWith('sec-fetch-')) apiHeaders[key]=value; }
    const teamsData=await Promise.all(teamIds.map(async team=>{ const apiUrl=`https://apileague.fantacalcio.it/gaming/v1/teamLineup/visualizza/A/${competition}/${team.id}/${round}`; const response=await fetch(apiUrl,{headers:apiHeaders,signal:AbortSignal.timeout(10000)}); if (!response.ok) throw new Error(`connector_lineup_http_${response.status}`); let payload; try { payload=await response.json(); } catch { throw new Error('connector_lineup_invalid_json'); } return validateLineup(team,round,payload); }));
    const observed_at=new Date().toISOString(); const snapshot={schema_version:1,league,season:'2026-2027',competition_id:competition,round,observed_at,source:'authenticated_api',source_url:baseUrl,expected_total:teams.length,inserted:teamsData.filter(t=>t.present).length,teams:teamsData};
    console.info('fantacalcio_capture_complete',{round,inserted:snapshot.inserted,durationMs:Date.now()-started}); return snapshot;
  } finally { page.off('response',responseListener); await browser.close(); }
}

const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;if(req.method!=='POST'||req.url!=='/sync')return json(res,404,{error:'not_found'},String(Date.now()));const ts=String(req.headers['x-fm-timestamp']||Date.now());if(!auth(req,raw)){console.error('hmac_rejected',{secretFingerprint,hasSecret:Boolean(secret),timestampPresent:Boolean(req.headers['x-fm-timestamp']),signaturePresent:Boolean(req.headers['x-fm-signature'])});return json(res,401,{error:'unauthorized'},ts);}try{const round=Number(JSON.parse(raw).round);if(!Number.isInteger(round)||round<1||round>35)throw new Error('invalid_round');return json(res,200,{snapshot:await capture(round)},ts);}catch(error){const code=error instanceof Error?error.message:'connector_failed';console.error('connector_failed',{code,secretFingerprint});return json(res,code==='connector_auth_failed'?401:502,{error:code},ts);}});
server.listen(port,()=>{ console.log(`connector listening on ${port}`,{secretFingerprint,hasSecret:Boolean(secret)}); capture(1).then(snapshot=>console.info('fantacalcio_startup_probe '+JSON.stringify({round:snapshot.round,inserted:snapshot.inserted,teams:snapshot.teams}))).catch(error=>console.error('fantacalcio_startup_probe_failed',{code:error instanceof Error?error.message:String(error)})); });
