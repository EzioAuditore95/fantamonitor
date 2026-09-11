import './phase1-patch.mjs';
import { chromium } from 'playwright';
const username=process.env.FANTACALCIO_USERNAME||'',password=process.env.FANTACALCIO_PASSWORD||'';
const supabaseUrl=(process.env.SUPABASE_URL||'').replace(/\/$/,''),supabaseKey=process.env.SUPABASE_PUBLISHABLE_KEY||'',autoSyncSecret=process.env.AUTO_SYNC_DB_SECRET||'';
const league='chefantavitae10',competition='337500',round=1;
const names=['AC Idovalproico','Atletico Fontanelle','FC LBVLA','FC SEMINI','FC Villaggio Mau Mau','FDS Sballo','I PIPPISTRELLI','Pro Spritz','Real Hasbulla','Salamandre'];
function p(x){return x&&typeof x==='object'?{id:x.id,name:x.name,role:x.role}:null;}
const browser=await chromium.launch({headless:true});const page=await browser.newPage();let teamsPayload=null;
const listener=async r=>{if(/\/onboarding\/v1\/league\/competition\/teams/.test(r.url())&&r.status()===200){try{teamsPayload=await r.json();}catch{}}};page.on('response',listener);
try{
 await page.goto('https://leghe.fantacalcio.it/login',{waitUntil:'domcontentloaded',timeout:20000});
 await page.locator('input[placeholder="Username"],input[autocomplete="username"]').first().fill(username);
 await page.locator('input[placeholder="Password"],input[autocomplete="current-password"]').first().fill(password);
 await page.getByRole('button',{name:'LOGIN'}).click();
 await Promise.race([page.waitForURL(u=>!/\/login(?:\/|$)/i.test(new URL(u).pathname),{timeout:15000}),page.waitForTimeout(3000)]);
 const reqPromise=page.waitForRequest(r=>/\/gaming\/v1\/teamLineup\/visualizza\//.test(r.url()),{timeout:20000});
 await page.goto(`https://leghe.fantacalcio.it/${league}/view/competition/${competition}/manage-lineups/${round}`,{waitUntil:'networkidle',timeout:30000});
 const first=await reqPromise;const headers={};for(const [k,v] of Object.entries(await first.allHeaders())){const l=k.toLowerCase();if(!k.startsWith(':')&&!['host','content-length','connection','accept-encoding'].includes(l)&&!l.startsWith('sec-fetch-'))headers[k]=v;}
 const byName=new Map((teamsPayload?.data||[]).map(t=>[t.n,t]));
 const teams=[];
 for(const name of names){const meta=byName.get(name);if(!meta)throw new Error(`phase1_seed_team_missing:${name}`);const r=await fetch(`https://apileague.fantacalcio.it/gaming/v1/teamLineup/visualizza/A/${competition}/${meta.id}/${round}`,{headers});if(!r.ok)throw new Error(`phase1_seed_lineup_${r.status}`);const payload=await r.json(),dto=payload.teamLineupDto||null;const present=Boolean(dto&&dto.mday===round&&dto.ldate);const formation=dto?{module:dto.module,starters:(dto.startersPlayers||[]).map(p),bench:(dto.benchPlayers||[]).map(p),roster:(dto.rosterPlayers||[]).map(p)}:undefined;teams.push({team_key:name,name,present,source_status:present?'check-circle':'Non inserita',team_id:meta.id,manager:meta.manager,budget:meta.budget,crest_url:meta.crest,kit_url:meta.kit,formation});}
 const snapshot={schema_version:1,league,season:'2026-2027',competition_id:competition,round,observed_at:new Date().toISOString(),source:'authenticated_ui',source_url:`https://leghe.fantacalcio.it/${league}/view/competition/${competition}/manage-lineups/${round}`,expected_total:10,inserted:teams.filter(t=>t.present).length,teams};
 const rr=await fetch(`${supabaseUrl}/rest/v1/rpc/fm_bot_import_snapshot`,{method:'POST',headers:{apikey:supabaseKey,'content-type':'application/json'},body:JSON.stringify({access_key:autoSyncSecret,sample:snapshot})});const text=await rr.text();if(!rr.ok)throw new Error(`phase1_seed_supabase_${rr.status}:${text.slice(0,200)}`);console.log('PHASE1_SEED_COMPLETE',JSON.stringify({inserted:snapshot.inserted,enriched:teams.filter(t=>t.manager&&t.crest_url&&t.formation?.starters?.length).length}));
}finally{page.off('response',listener);await browser.close();}
