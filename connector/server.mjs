import http from 'node:http';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const port = Number(process.env.PORT || 8080);
const secret = process.env.FANTAMONITOR_CONNECTOR_SECRET || '';
const username = process.env.FANTACALCIO_USERNAME || '';
const password = process.env.FANTACALCIO_PASSWORD || '';
const league = 'chefantavitae10', competition = '337500';
const teams = ['AC Idovalproico','Atletico Fontanelle','FC LBVLA','FC SEMINI','FC Villaggio Mau Mau','FDS Sballo','I PIPPISTRELLI','Pro Spritz','Real Hasbulla','Salamandre'];
const sign = (timestamp, body) => crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
function auth(req, raw) { const ts=req.headers['x-fm-timestamp']||'', sig=req.headers['x-fm-signature']||''; const age=Math.abs(Date.now()-Number(ts)); return secret && /^\d+$/.test(ts) && age<120000 && sig.length===64 && crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(sign(ts,raw))); }
function json(res,status,body,ts) { const raw=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-fm-signature':sign(ts,raw)});res.end(raw); }
async function capture(round) {
  if (!username || !password) throw new Error('connector_credentials_missing');
  const browser=await chromium.launch({headless:true}); const page=await browser.newPage();
  try {
    await page.goto('https://leghe.fantacalcio.it/login',{waitUntil:'domcontentloaded',timeout:20000});
    await page.locator('input[placeholder="Username"],input[autocomplete="username"]').first().fill(username);
    await page.locator('input[placeholder="Password"],input[autocomplete="current-password"]').first().fill(password);
    await page.getByRole('button',{name:'LOGIN'}).click(); await page.waitForLoadState('domcontentloaded');
    const url=`https://leghe.fantacalcio.it/${league}/view/competition/${competition}/manage-lineups/${round}`;
    await page.goto(url,{waitUntil:'networkidle',timeout:30000});
    const text=await page.locator('body').innerText(); if(/Sessione scaduta|Inserisci le tue credenziali/i.test(text)) throw new Error('connector_auth_failed');
    const teamsData=await page.evaluate((names)=>names.map(name=>{const row=[...document.querySelectorAll('*')].find(el=>el.textContent?.trim()===name);const container=row?.closest('button,li,[role="button"],tr,div');const value=container?.textContent||'';const present=!/non inserita/i.test(value)&&/check|inserita|[1-9]-[1-9]/i.test(value);return {team_key:name,name,present,source_status:present?'check-circle':'Non inserita'};}),teams);
    if(teamsData.some(t=>typeof t.present!=='boolean')) throw new Error('connector_incomplete_teams');
    const observed_at=new Date().toISOString(); return {schema_version:1,league,season:'2026-2027',competition_id:competition,round,observed_at,source:'authenticated_ui',source_url:url,expected_total:10,inserted:teamsData.filter(t=>t.present).length,teams:teamsData};
  } finally { await browser.close(); }
}
const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;if(req.method!=='POST'||req.url!=='/sync')return json(res,404,{error:'not_found'},String(Date.now()));const ts=String(req.headers['x-fm-timestamp']||Date.now());if(!auth(req,raw))return json(res,401,{error:'unauthorized'},ts);try{const round=Number(JSON.parse(raw).round);if(!Number.isInteger(round)||round<1||round>35)throw new Error('invalid_round');return json(res,200,{snapshot:await capture(round)},ts);}catch(error){const code=error instanceof Error?error.message:'connector_failed';return json(res,code==='connector_auth_failed'?401:502,{error:code},ts);}});server.listen(port,()=>console.log(`connector listening on ${port}`));
