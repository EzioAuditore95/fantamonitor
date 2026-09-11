import { chromium } from 'playwright';
const username=process.env.FANTACALCIO_USERNAME||'';
const password=process.env.FANTACALCIO_PASSWORD||'';
const league='chefantavitae10',competition='337500';
function shape(v,d=0){if(d>2)return Array.isArray(v)?`array(${v.length})`:typeof v;if(Array.isArray(v))return {type:'array',length:v.length,sample:v.length?shape(v[0],d+1):null};if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).slice(0,50))o[k]=shape(v[k],d+1);return o;}return typeof v;}
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const seen=[];
page.on('response',async r=>{const u=r.url();if(!u.includes('fantacalcio.it')||r.status()!==200)return;const ct=(await r.allHeaders())['content-type']||'';if(!ct.includes('json'))return;try{seen.push({url:u,shape:shape(await r.json())});}catch{}});
try{
 await page.goto('https://leghe.fantacalcio.it/login',{waitUntil:'domcontentloaded',timeout:20000});
 await page.locator('input[placeholder="Username"],input[autocomplete="username"]').first().fill(username);
 await page.locator('input[placeholder="Password"],input[autocomplete="current-password"]').first().fill(password);
 await page.getByRole('button',{name:'LOGIN'}).click();
 await Promise.race([page.waitForURL(u=>!/\/login(?:\/|$)/i.test(new URL(u).pathname),{timeout:15000}),page.waitForTimeout(3000)]);
 const root=`https://leghe.fantacalcio.it/${league}/view/competition/${competition}`;
 await page.goto(root,{waitUntil:'networkidle',timeout:30000});
 await page.waitForTimeout(1500);
 const links=await page.locator('a[href]').evaluateAll(as=>as.map(a=>({text:(a.textContent||'').trim().replace(/\s+/g,' '),href:a.href})).filter(x=>x.href.includes('/view/competition/')));
 console.log('PHASE2_LINKS',JSON.stringify(links.slice(0,120)));
 console.log('PHASE2_RESPONSES_START');
 for(const x of seen){if(/competition|calendar|class|match|result|standing|score|fixture|game|round/i.test(x.url))console.log(JSON.stringify(x));}
 console.log('PHASE2_RESPONSES_END');
}finally{await browser.close();}
