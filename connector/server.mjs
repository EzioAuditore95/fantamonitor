import http from 'node:http';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const port=Number(process.env.PORT||8080);
const secret=process.env.FANTAMONITOR_CONNECTOR_SECRET||'';
const username=process.env.FANTACALCIO_USERNAME||'';
const password=process.env.FANTACALCIO_PASSWORD||'';
const supabaseUrl=process.env.SUPABASE_URL||'';
const supabaseKey=process.env.SUPABASE_PUBLISHABLE_KEY||'';
const autoSyncSecret=process.env.AUTO_SYNC_DB_SECRET||'';
const telegramBotToken=process.env.TELEGRAM_BOT_TOKEN||'';
const telegramChatId=process.env.TELEGRAM_CHAT_ID||'';
const telegramThreadId=process.env.TELEGRAM_THREAD_ID||'';
const telegramAdminChatId=process.env.TELEGRAM_ADMIN_CHAT_ID||'';
const publicUrl=(process.env.CONNECTOR_PUBLIC_URL||'https://fantamonitor-connector-production.up.railway.app').replace(/\/$/,'');
const telegramWebhookSecret=telegramBotToken?crypto.createHash('sha256').update(telegramBotToken).digest('hex').slice(0,48):'';
const league='chefantavitae10',competition='337500';
const teams=['AC Idovalproico','Atletico Fontanelle','FC LBVLA','FC SEMINI','FC Villaggio Mau Mau','FDS Sballo','I PIPPISTRELLI','Pro Spritz','Real Hasbulla','Salamandre'];
const secretFingerprint=crypto.createHash('sha256').update(secret).digest('hex').slice(0,12);
const githubJwks=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
const sign=(timestamp,body)=>crypto.createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');

function auth(req,raw){const ts=req.headers['x-fm-timestamp']||'',sig=req.headers['x-fm-signature']||'';const age=Math.abs(Date.now()-Number(ts));return secret&&/^\d+$/.test(ts)&&age<120000&&sig.length===64&&crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(sign(ts,raw)));}
function signedJson(res,status,body,ts){const raw=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-fm-signature':sign(ts,raw)});res.end(raw);}
function plainJson(res,status,body){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));}
function findTeamObjects(value,out=[]){if(Array.isArray(value)){for(const item of value)findTeamObjects(item,out);return out;}if(!value||typeof value!=='object')return out;const name=typeof value.n==='string'?value.n:typeof value.name==='string'?value.name:typeof value.nome==='string'?value.nome:'';const id=Number(value.id??value.teamId??value.tid);if(name&&Number.isInteger(id)&&id>0)out.push({name:name.trim(),id});for(const child of Object.values(value))findTeamObjects(child,out);return out;}

async function loginAndOpen(page,round){
  await page.goto('https://leghe.fantacalcio.it/login',{waitUntil:'domcontentloaded',timeout:20000});
  await page.locator('input[placeholder="Username"],input[autocomplete="username"]').first().fill(username);
  await page.locator('input[placeholder="Password"],input[autocomplete="current-password"]').first().fill(password);
  await page.getByRole('button',{name:'LOGIN'}).click();
  await Promise.race([page.waitForURL(u=>!/\/login(?:\/|$)/i.test(new URL(u).pathname),{timeout:15000}),page.waitForTimeout(3000)]);
  await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{});
  const baseUrl=`https://leghe.fantacalcio.it/${league}/view/competition/${competition}/manage-lineups/${round}`;
  await page.goto(baseUrl,{waitUntil:'networkidle',timeout:30000});
  const currentUrl=page.url();const loginForm=await page.locator('input[autocomplete="username"]:visible,input[placeholder="Username"]:visible').count()>0;
  console.info('fantacalcio_login_state',{round,currentUrl,loginForm,title:await page.title()});
  if(/\/login(?:\/|$)/i.test(currentUrl)||loginForm)throw new Error('connector_auth_failed');
  const match=currentUrl.match(/\/manage-lineups\/(\d+)/i);if((match?Number(match[1]):null)!==round)throw new Error('connector_round_unavailable');return {baseUrl,currentUrl};
}
async function getContext(round){
  const browser=await chromium.launch({headless:true});const page=await browser.newPage();let competitionTeamsPayload=null;
  const listener=async response=>{if(/\/onboarding\/v1\/league\/competition\/teams/.test(response.url())&&response.status()===200){try{competitionTeamsPayload=await response.json();}catch{}}};page.on('response',listener);
  try{const cdp=await page.context().newCDPSession(page);await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});const reqPromise=page.waitForRequest(r=>/\/gaming\/v1\/teamLineup\/visualizza\//.test(r.url()),{timeout:20000});const {baseUrl}=await loginAndOpen(page,round);const firstReq=await reqPromise;if(!competitionTeamsPayload)throw new Error('connector_team_list_missing');const map=new Map();for(const x of findTeamObjects(competitionTeamsPayload))if(!map.has(x.name))map.set(x.name,x.id);const teamIds=teams.map(name=>({name,id:map.get(name)}));if(teamIds.some(t=>!Number.isInteger(t.id)))throw new Error('connector_team_mapping_failed');const captured=await firstReq.allHeaders();const headers={};for(const [k,v] of Object.entries(captured)){const l=k.toLowerCase();if(!k.startsWith(':')&&!['host','content-length','connection','accept-encoding'].includes(l)&&!l.startsWith('sec-fetch-'))headers[k]=v;}return {browser,page,listener,baseUrl,teamIds,headers};}catch(e){page.off('response',listener);await browser.close();throw e;}
}
async function fetchLineups(round){const ctx=await getContext(round);try{return await Promise.all(ctx.teamIds.map(async team=>{const url=`https://apileague.fantacalcio.it/gaming/v1/teamLineup/visualizza/A/${competition}/${team.id}/${round}`;const r=await fetch(url,{headers:ctx.headers,signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`connector_lineup_http_${r.status}`);let payload;try{payload=await r.json();}catch{throw new Error('connector_lineup_invalid_json');}return {team,dto:payload?.teamLineupDto??null};}));}finally{ctx.page.off('response',ctx.listener);await ctx.browser.close();}}
function toTeamStatus(item,round){const dto=item.dto;if(dto!=null&&typeof dto!=='object')throw new Error('connector_lineup_invalid_payload');if(dto&&Number(dto.tid)!==item.team.id)throw new Error('connector_lineup_team_mismatch');if(dto&&Number(dto.mday)!==round)throw new Error('connector_lineup_round_mismatch');const present=Boolean(dto&&Number(dto.mday)===round&&typeof dto.ldate==='string'&&dto.ldate.length>0);return {team_key:item.team.name,name:item.team.name,present,source_status:present?'check-circle':'Non inserita'};}
async function capture(round){if(!username||!password)throw new Error('connector_credentials_missing');const started=Date.now();const items=await fetchLineups(round);const teamsData=items.map(x=>toTeamStatus(x,round));if(teamsData.length!==teams.length)throw new Error('connector_incomplete_teams');const snapshot={schema_version:1,league,season:'2026-2027',competition_id:competition,round,observed_at:new Date().toISOString(),source:'authenticated_ui',source_url:`https://leghe.fantacalcio.it/${league}/view/competition/${competition}/manage-lineups/${round}`,expected_total:teams.length,inserted:teamsData.filter(t=>t.present).length,teams:teamsData};console.info('fantacalcio_capture_complete',{round,inserted:snapshot.inserted,durationMs:Date.now()-started});return snapshot;}

async function verifyGithubAction(req){const header=String(req.headers.authorization||'');if(!header.startsWith('Bearer '))throw new Error('oidc_missing');const token=header.slice(7);const {payload}=await jwtVerify(token,githubJwks,{issuer:'https://token.actions.githubusercontent.com',audience:'fantamonitor-auto-sync'});if(payload.repository!=='EzioAuditore95/fantamonitor'||payload.ref!=='refs/heads/main')throw new Error('oidc_scope');if(typeof payload.workflow_ref!=='string'||!payload.workflow_ref.includes('/.github/workflows/auto-sync.yml@refs/heads/main'))throw new Error('oidc_workflow');return payload;}
async function rpc(name,args){if(!supabaseUrl||!supabaseKey||!autoSyncSecret)throw new Error('auto_sync_not_configured');const response=await fetch(`${supabaseUrl.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:supabaseKey,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});const text=await response.text();if(!response.ok)throw new Error(`supabase_${name}_${response.status}:${text.slice(0,180)}`);if(!text)return null;try{return JSON.parse(text);}catch{return text;}}

function checkpointCopy(checkpoint){return ({'T-24h':'Promemoria iniziale: manca ancora tempo, ma queste squadre non risultano aver inserito la formazione.','T-12h':'Promemoria: queste squadre risultano ancora senza formazione.','T-1h':'Manca 1 ora: controllare le squadre ancora senza formazione.','T-15m':'Ultimo avviso: mancano 15 minuti alla scadenza.','T+5m':'Scadenza superata: situazione finale rilevata.'})[checkpoint]||'Stato aggiornato.';}
function buildTelegramMessage(snapshot,checkpoint='LIVE'){
  const missing=snapshot.teams.filter(t=>!t.present).map(t=>t.name);const summary=`Formazioni inserite: ${snapshot.inserted}/${snapshot.expected_total}`;const lines=[`FANTAMONITOR — Giornata ${snapshot.round}`,checkpoint==='LIVE'?'Aggiornamento manuale':checkpointCopy(checkpoint),summary,''];
  if(!missing.length)lines.push(checkpoint==='T+5m'?'Situazione finale: tutte le squadre hanno inserito la formazione.':'Tutte le squadre hanno inserito la formazione.');else lines.push(`Squadre senza formazione (${missing.length}):`,...missing.map(n=>`• ${n}`));
  lines.push('',`Aggiornato: ${new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}).format(new Date(snapshot.observed_at))}`);return lines.join('\n');
}
const telegramKeyboard={inline_keyboard:[[{text:'Aggiorna stato',callback_data:'status'},{text:'Sincronizza ora',callback_data:'sync'}],[{text:'Apri FANTAMONITOR',url:'https://fantamonitor-production.up.railway.app'}]]};
async function telegramApi(method,payload){if(!telegramBotToken)throw new Error('telegram_not_configured');const r=await fetch(`https://api.telegram.org/bot${telegramBotToken}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});const text=await r.text();let data=null;try{data=JSON.parse(text);}catch{}if(!r.ok||!data?.ok)throw new Error(`telegram_${method}_${r.status}:${String(data?.description||text).slice(0,180)}`);return data.result;}
async function notifyAdmin(text){if(!telegramAdminChatId)return;await telegramApi('sendMessage',{chat_id:telegramAdminChatId,text:`FANTAMONITOR — errore tecnico\n${text}`}).catch(()=>{});}
async function publishTelegramStatus(snapshot,checkpoint,{force=false}={}){
  if(!telegramBotToken||!telegramChatId)return {status:'skipped'};const missing=snapshot.expected_total-snapshot.inserted;const state=await rpc('fm_get_telegram_message',{access_key:autoSyncSecret,day:snapshot.round});
  if(missing===0&&!force&&!state&&checkpoint!=='T+5m')return {status:'silent_complete'};
  const payload={chat_id:telegramChatId,text:buildTelegramMessage(snapshot,checkpoint),reply_markup:telegramKeyboard,disable_web_page_preview:true};if(telegramThreadId){const x=Number(telegramThreadId);if(Number.isInteger(x)&&x>0)payload.message_thread_id=x;}
  if(state?.message_id&&String(state.chat_id)===String(telegramChatId)){
    try{await telegramApi('editMessageText',{chat_id:telegramChatId,message_id:Number(state.message_id),text:payload.text,reply_markup:telegramKeyboard,disable_web_page_preview:true});await rpc('fm_upsert_telegram_message',{access_key:autoSyncSecret,day:snapshot.round,target_chat_id:String(telegramChatId),telegram_message_id:Number(state.message_id),checkpoint_name:checkpoint});return {status:'edited',messageId:Number(state.message_id)};}catch(e){if(String(e).includes('message is not modified'))return {status:'unchanged',messageId:Number(state.message_id)};}
  }
  const message=await telegramApi('sendMessage',payload);await rpc('fm_upsert_telegram_message',{access_key:autoSyncSecret,day:snapshot.round,target_chat_id:String(telegramChatId),telegram_message_id:Number(message.message_id),checkpoint_name:checkpoint});return {status:'sent',messageId:Number(message.message_id)};
}
async function currentRound(){const day=Number(await rpc('fm_current_round_for_bot',{access_key:autoSyncSecret}));if(!Number.isInteger(day)||day<1||day>35)throw new Error('current_round_unavailable');return day;}
function telegramUpdateAuthorized(update){const ids=[];if(update.callback_query?.message?.chat?.id!=null)ids.push(String(update.callback_query.message.chat.id));for(const k of ['message','channel_post'])if(update[k]?.chat?.id!=null)ids.push(String(update[k].chat.id));return ids.some(id=>id===String(telegramChatId)||telegramAdminChatId&&id===String(telegramAdminChatId));}
async function executeTelegramAction(action){const round=await currentRound();const snapshot=await capture(round);if(action==='sync')await rpc('fm_bot_import_snapshot',{access_key:autoSyncSecret,sample:snapshot});const published=await publishTelegramStatus(snapshot,'LIVE',{force:true});return {round,snapshot,published};}
async function handleTelegramUpdate(update){
  if(!telegramUpdateAuthorized(update))return;
  const callback=update.callback_query;if(callback){try{await telegramApi('answerCallbackQuery',{callback_query_id:callback.id,text:callback.data==='sync'?'Sincronizzazione avviata':'Aggiornamento avviato'});await executeTelegramAction(callback.data==='sync'?'sync':'status');}catch(e){console.error('telegram_callback_failed',{error:String(e)});await notifyAdmin(String(e));}return;}
  const msg=update.message||update.channel_post;const text=String(msg?.text||'').split('@')[0].trim().toLowerCase();if(!['/status','/sync','/help'].includes(text))return;
  if(text==='/help'){await telegramApi('sendMessage',{chat_id:msg.chat.id,text:'Comandi disponibili:\n/status — legge lo stato attuale\n/sync — forza lettura e salvataggio\n/help — mostra i comandi'});return;}
  try{const result=await executeTelegramAction(text==='/sync'?'sync':'status');if(String(msg.chat.id)!==String(telegramChatId))await telegramApi('sendMessage',{chat_id:msg.chat.id,text:buildTelegramMessage(result.snapshot,'LIVE')});}catch(e){console.error('telegram_command_failed',{error:String(e)});await notifyAdmin(String(e));}
}
async function configureTelegramWebhook(){if(!telegramBotToken||!telegramChatId)return;await telegramApi('setWebhook',{url:`${publicUrl}/telegram/webhook`,secret_token:telegramWebhookSecret,allowed_updates:['message','channel_post','callback_query'],drop_pending_updates:false});await telegramApi('setMyCommands',{commands:[{command:'status',description:'Stato formazioni'},{command:'sync',description:'Forza sincronizzazione'},{command:'help',description:'Comandi disponibili'}]}).catch(()=>{});console.info('telegram_webhook_configured',{url:`${publicUrl}/telegram/webhook`});}

async function runAutoSync(){
  const claim=await rpc('fm_claim_due_auto_sync',{access_key:autoSyncSecret});if(!claim)return {status:'no_due_checkpoint'};const round=Number(claim.round),checkpoint=String(claim.checkpoint);
  try{const snapshot=await capture(round);const result=await rpc('fm_complete_auto_sync',{access_key:autoSyncSecret,day:round,checkpoint_name:checkpoint,sample:snapshot});let telegram={status:'skipped'};try{telegram=await publishTelegramStatus(snapshot,checkpoint);}catch(e){console.error('telegram_notification_failed',{round,checkpoint,error:String(e)});await notifyAdmin(`Giornata ${round} ${checkpoint}: ${String(e)}`);}console.info('auto_sync_complete',{round,checkpoint,inserted:snapshot.inserted,telegram:telegram.status});return {status:'success',round,checkpoint,telegram:telegram.status,result};}
  catch(error){const message=error instanceof Error?error.message:'auto_sync_failed';await rpc('fm_fail_auto_sync',{access_key:autoSyncSecret,day:round,checkpoint_name:checkpoint,error_text:message}).catch(()=>{});await notifyAdmin(`Auto-sync fallito: ${message}`);throw error;}
}

const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  if(req.method==='POST'&&req.url==='/telegram/webhook'){
    if(!telegramWebhookSecret||String(req.headers['x-telegram-bot-api-secret-token']||'')!==telegramWebhookSecret)return plainJson(res,401,{error:'unauthorized'});
    let update;try{update=JSON.parse(raw||'{}');}catch{return plainJson(res,400,{error:'invalid_json'});}plainJson(res,200,{ok:true});handleTelegramUpdate(update).catch(async e=>{console.error('telegram_webhook_failed',{error:String(e)});await notifyAdmin(String(e));});return;
  }
  if(req.method==='POST'&&req.url==='/sync'){
    const ts=String(req.headers['x-fm-timestamp']||Date.now());if(!auth(req,raw))return signedJson(res,401,{error:'unauthorized'},ts);
    try{const round=Number(JSON.parse(raw).round);if(!Number.isInteger(round)||round<1||round>35)throw new Error('invalid_round');return signedJson(res,200,{snapshot:await capture(round)},ts);}catch(error){const code=error instanceof Error?error.message:'connector_failed';console.error('connector_failed',{code,secretFingerprint});return signedJson(res,code==='connector_auth_failed'?401:502,{error:code},ts);}
  }
  if(req.method==='POST'&&req.url==='/auto-sync'){
    try{await verifyGithubAction(req);return plainJson(res,200,await runAutoSync());}catch(error){const code=error instanceof Error?error.message:'auto_sync_failed';console.error('auto_sync_failed',{code});return plainJson(res,code.startsWith('oidc_')?401:502,{error:code});}
  }
  return plainJson(res,404,{error:'not_found'});
});
server.listen(port,()=>{console.log(`connector listening on ${port}`,{secretFingerprint,hasSecret:Boolean(secret),autoSyncConfigured:Boolean(autoSyncSecret&&supabaseUrl&&supabaseKey),telegramConfigured:Boolean(telegramBotToken&&telegramChatId),telegramAdminConfigured:Boolean(telegramAdminChatId)});configureTelegramWebhook().catch(async e=>{console.error('telegram_webhook_config_failed',{error:String(e)});await notifyAdmin(String(e));});});
