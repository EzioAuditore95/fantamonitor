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
async function capture(round) {
  if (!username || !password) throw new Error('connector_credentials_missing');
  const browser=await chromium.launch({headless:true}); const page=await browser.newPage();
  try {
    await page.goto('https://leghe.fantacalcio.it/login',{waitUntil:'domcontentloaded',timeout:20000});
    await page.locator('input[placeholder="Username"],input[autocomplete="username"]').first().fill(username);
    await page.locator('input[placeholder="Password"],input[autocomplete="current-password"]').first().fill(password);
    await page.getByRole('button',{name:'LOGIN'}).click();
    // The login is handled asynchronously by the site.  Do not navigate to
    // the league until the redirect/cookies have settled.
    await Promise.race([
      page.waitForURL(u => !/\/login(?:\/|$)/i.test(new URL(u).pathname), { timeout: 15000 }),
      page.waitForTimeout(3000),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const url=`https://leghe.fantacalcio.it/${league}/view/competition/${competition}/manage-lineups/${round}`;
    await page.goto(url,{waitUntil:'networkidle',timeout:30000});
    const currentUrl = page.url();
    const loginForm = await page.locator('input[autocomplete="username"]:visible,input[placeholder="Username"]:visible').count() > 0;
    console.info('fantacalcio_login_state', { currentUrl, loginForm, title: await page.title() });
    if (/\/login(?:\/|$)/i.test(currentUrl) || loginForm) throw new Error('connector_auth_failed');
    const teamsData=await page.evaluate((names)=>names.map(name=>{
      const exact=[...document.querySelectorAll('*')].find(el=>el.children.length===0&&el.textContent?.trim()===name);
      const candidates=[]; let node=exact;
      for(let i=0;node&&i<7;i++,node=node.parentElement){
        const text=(node.innerText||node.textContent||'').replace(/\s+/g,' ').trim();
        if(text.includes(name)&&text.length<1200) candidates.push(node);
      }
      const negative=/non\s*(inserita|consegnata)|mancante|assente|nessuna formazione/i;
      const positive=/(inserita|consegnata|inviata|check|success|submitted|done|circle-check|fa-check|text-success|text-green|green)/i;
      const container=candidates.find(el=>positive.test(`${el.innerText||''} ${el.className||''} ${el.innerHTML||''}`)&&!negative.test(el.innerText||''))||candidates[candidates.length-1];
      const value=(container?.innerText||container?.textContent||'').replace(/\s+/g,' ').trim();
      const markup=`${container?.className||''} ${container?.innerHTML||''}`;
      const present=!negative.test(value)&&positive.test(`${value} ${markup}`);
      return {team_key:name,name,present,source_status:present?'Inserita':'Non inserita'};
    }),teams);
    if(teamsData.some(t=>typeof t.present!=='boolean')) throw new Error('connector_incomplete_teams');
    const observed_at=new Date().toISOString(); return {schema_version:1,league,season:'2026-2027',competition_id:competition,round,observed_at,source:'authenticated_ui',source_url:url,expected_total:10,inserted:teamsData.filter(t=>t.present).length,teams:teamsData};
  } finally { await browser.close(); }
}
const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;if(req.method!=='POST'||req.url!=='/sync')return json(res,404,{error:'not_found'},String(Date.now()));const ts=String(req.headers['x-fm-timestamp']||Date.now());if(!auth(req,raw)){console.error('hmac_rejected',{secretFingerprint,hasSecret:Boolean(secret),timestampPresent:Boolean(req.headers['x-fm-timestamp']),signaturePresent:Boolean(req.headers['x-fm-signature'])});return json(res,401,{error:'unauthorized'},ts);}try{const round=Number(JSON.parse(raw).round);if(!Number.isInteger(round)||round<1||round>35)throw new Error('invalid_round');return json(res,200,{snapshot:await capture(round)},ts);}catch(error){const code=error instanceof Error?error.message:'connector_failed';console.error('connector_failed',{code,secretFingerprint});return json(res,code==='connector_auth_failed'?401:502,{error:code},ts);}});server.listen(port,()=>console.log(`connector listening on ${port}`,{secretFingerprint,hasSecret:Boolean(secret)}));
