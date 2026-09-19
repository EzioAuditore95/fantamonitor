import http from 'node:http';
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { appUrl,autoSyncSecret,port,publicUrl,secret,secretFingerprint,sign,supabaseKey,supabaseUrl,telegramBotToken,telegramWebhookSecret } from './lib/config.mjs';
import { rpc,withKey } from './lib/rpc.mjs';
import { credentialsConfigured } from './lib/credentials.mjs';
import { leagueBySlug,leagueForChat,loadLeagues } from './lib/leagues.mjs';
import { capture,captureCompetition,checkCredentials } from './lib/capture.mjs';
import { browserStats } from './lib/browser.mjs';
import { buildMissingMessage,buildNextMessage,buildTelegramMessage,notifyAdmin,publishTelegramStatus,telegramApi } from './lib/telegram.mjs';

const githubJwks=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
function auth(req,raw){
  const ts=req.headers['x-fm-timestamp']||'',sig=req.headers['x-fm-signature']||'';
  const age=Math.abs(Date.now()-Number(ts));
  return secret&&/^\d+$/.test(ts)&&age<120000&&sig.length===64&&crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(sign(ts,raw)));
}
function signedJson(res,status,body,ts){const raw=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-fm-signature':sign(ts,raw)});res.end(raw);}
function plainJson(res,status,body){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));}

async function requireLeague(slug){
  const league=leagueBySlug(String(slug||''),await loadLeagues());
  if(!league)throw new Error('unknown_league');
  return league;
}
async function verifyGithubAction(req){
  const header=String(req.headers.authorization||'');
  if(!header.startsWith('Bearer '))throw new Error('oidc_missing');
  const {payload}=await jwtVerify(header.slice(7),githubJwks,{issuer:'https://token.actions.githubusercontent.com',audience:'fantamonitor-auto-sync'});
  if(payload.repository!=='EzioAuditore95/fantamonitor'||payload.ref!=='refs/heads/main')throw new Error('oidc_scope');
  if(!String(payload.workflow_ref||'').includes('/.github/workflows/auto-sync.yml@refs/heads/main'))throw new Error('oidc_workflow');
}

async function currentRound(league){
  const day=Number(await rpc('fm_current_round_for_bot',withKey({league:league.id})));
  if(!Number.isInteger(day)||day<1||day>league.roundCount)throw new Error('current_round_unavailable');
  return day;
}
async function executeTelegramAction(league,action){
  const round=await currentRound(league);
  const snapshot=await capture(league,round);
  if(action==='sync')await rpc('fm_bot_import_snapshot',withKey({sample:snapshot}));
  const published=await publishTelegramStatus(league,snapshot,'LIVE',{force:true});
  return {round,snapshot,published};
}
async function sendNext(league,chatId){
  const info=await rpc('fm_next_round_for_bot',withKey({league:league.id}));
  await telegramApi('sendMessage',{chat_id:chatId,text:buildNextMessage(info),reply_markup:{inline_keyboard:[[{text:'Apri FANTAMONITOR',url:`${appUrl}/l/${league.slug}`}]]}});
}
function chatIdOf(update){
  return update.callback_query?.message?.chat?.id ?? update.message?.chat?.id ?? update.channel_post?.chat?.id ?? null;
}
async function handleTelegramUpdate(update){
  // An unknown chat is ignored: this is where a message could land in another league's
  // channel, the worst failure this product can have.
  const league=leagueForChat(chatIdOf(update),await loadLeagues());
  if(!league)return;
  const callback=update.callback_query;
  if(callback){
    try{
      if(callback.data==='next'){await telegramApi('answerCallbackQuery',{callback_query_id:callback.id,text:'Calendario aggiornato'});await sendNext(league,callback.message.chat.id);return;}
      await telegramApi('answerCallbackQuery',{callback_query_id:callback.id,text:callback.data==='sync'?'Sincronizzazione avviata':'Aggiornamento avviato'});
      await executeTelegramAction(league,callback.data==='sync'?'sync':'status');
    }catch(e){console.error('telegram_callback_failed',{league:league.slug,error:String(e)});await notifyAdmin(league,String(e));}
    return;
  }
  const msg=update.message||update.channel_post;
  const text=String(msg?.text||'').split('@')[0].trim().toLowerCase();
  if(!['/status','/missing','/next','/sync','/stats','/help'].includes(text))return;
  if(text==='/help'){await telegramApi('sendMessage',{chat_id:msg.chat.id,text:'Comandi disponibili:\n/status — stato attuale\n/missing — sole squadre mancanti\n/next — prossima giornata e orario\n/sync — forza lettura e salvataggio\n/stats — apre le statistiche web\n/help — mostra i comandi'});return;}
  if(text==='/next'){await sendNext(league,msg.chat.id);return;}
  if(text==='/stats'){await telegramApi('sendMessage',{chat_id:msg.chat.id,text:`Statistiche ${league.name}`,reply_markup:{inline_keyboard:[[{text:'Apri statistiche',url:`${appUrl}/l/${league.slug}/stats`}]]}});return;}
  try{
    if(text==='/missing'){
      const snapshot=await capture(league,await currentRound(league));
      await publishTelegramStatus(league,snapshot,'LIVE',{force:true});
      if(String(msg.chat.id)!==String(league.telegramChatId))await telegramApi('sendMessage',{chat_id:msg.chat.id,text:buildMissingMessage(snapshot)});
      return;
    }
    const result=await executeTelegramAction(league,text==='/sync'?'sync':'status');
    if(String(msg.chat.id)!==String(league.telegramChatId))await telegramApi('sendMessage',{chat_id:msg.chat.id,text:buildTelegramMessage(result.snapshot,'LIVE')});
  }catch(e){console.error('telegram_command_failed',{league:league.slug,error:String(e)});await notifyAdmin(league,String(e));}
}
async function configureTelegramWebhook(){
  if(!telegramBotToken)return;
  await telegramApi('setWebhook',{url:`${publicUrl}/telegram/webhook`,secret_token:telegramWebhookSecret,allowed_updates:['message','channel_post','callback_query'],drop_pending_updates:false});
  await telegramApi('setMyCommands',{commands:[
    {command:'status',description:'Stato attuale delle formazioni'},{command:'missing',description:'Solo le squadre mancanti'},
    {command:'next',description:'Prossima giornata e orario'},{command:'sync',description:'Forza lettura e salvataggio'},
    {command:'stats',description:'Apri le statistiche'},{command:'help',description:'Mostra i comandi'}]});
}

// The claim now carries its league: two leagues can have simultaneous checkpoints.
async function runAutoSync(){
  const claim=await rpc('fm_claim_due_auto_sync',withKey({}));
  if(!claim)return {status:'no_due_checkpoint'};
  const leagues=await loadLeagues({force:true});
  const league=leagues.find(l=>l.id===claim.league_id);
  const round=Number(claim.round),checkpoint=String(claim.checkpoint);
  if(!league){await rpc('fm_fail_auto_sync',withKey({league:claim.league_id,day:round,checkpoint_name:checkpoint,error_text:'unknown_league'})).catch(()=>{});return {status:'unknown_league'};}
  try{
    const snapshot=await capture(league,round);
    const result=await rpc('fm_complete_auto_sync',withKey({day:round,checkpoint_name:checkpoint,sample:snapshot}));
    let telegram={status:'skipped'};
    try{telegram=await publishTelegramStatus(league,snapshot,checkpoint);}
    catch(e){console.error('telegram_notification_failed',{league:league.slug,round,checkpoint,error:String(e)});}
    return {status:'completed',league:league.slug,round,checkpoint,result,telegram};
  }catch(error){
    const message=error instanceof Error?error.message:'auto_sync_failed';
    await rpc('fm_fail_auto_sync',withKey({league:league.id,day:round,checkpoint_name:checkpoint,error_text:message})).catch(()=>{});
    await notifyAdmin(league,`Auto-sync fallito (giornata ${round}, ${checkpoint}): ${message}`);
    throw error;
  }
}

const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  if(req.method==='GET'&&req.url==='/health')return plainJson(res,200,{ok:true,...browserStats()});
  if(req.method==='POST'&&req.url==='/telegram/webhook'){
    if(!telegramWebhookSecret||String(req.headers['x-telegram-bot-api-secret-token']||'')!==telegramWebhookSecret)return plainJson(res,401,{error:'unauthorized'});
    let update;try{update=JSON.parse(raw||'{}');}catch{return plainJson(res,400,{error:'invalid_json'});}
    plainJson(res,200,{ok:true});
    handleTelegramUpdate(update).catch(e=>console.error('telegram_webhook_failed',{error:String(e)}));
    return;
  }
  for(const [path,handler] of [
    ['/sync',async body=>{const league=await requireLeague(body.league);return {snapshot:await capture(league,Number(body.round))};}],
    ['/competition',async body=>{const league=await requireLeague(body.league);return {competition:await captureCompetition(league)};}],
    ['/credential-check',async body=>{const league=await requireLeague(body.league);return await checkCredentials(league);}],
  ]){
    if(req.method!=='POST'||req.url!==path)continue;
    const ts=String(req.headers['x-fm-timestamp']||Date.now());
    if(!auth(req,raw))return signedJson(res,401,{error:'unauthorized'},ts);
    try{return signedJson(res,200,await handler(JSON.parse(raw||'{}')),ts);}
    catch(error){
      const code=error instanceof Error?error.message:'connector_failed';
      console.error('connector_failed',{path,code,secretFingerprint});
      return signedJson(res,code==='connector_auth_failed'?401:code==='unknown_league'?404:502,{error:code},ts);
    }
  }
  if(req.method==='POST'&&req.url==='/auto-sync'){
    try{
      // Due chiamanti legittimi: GitHub Actions con un token OIDC, e lo scheduler con la
      // stessa firma HMAC che protegge già /sync. Nessun tipo di autenticazione nuovo.
      if(req.headers['x-fm-signature']){ if(!auth(req,raw))throw new Error('unauthorized'); }
      else await verifyGithubAction(req);
      return plainJson(res,200,await runAutoSync());
    }
    catch(error){const code=error instanceof Error?error.message:'auto_sync_failed';console.error('auto_sync_failed',{code});
      return plainJson(res,code.startsWith('oidc_')||code==='unauthorized'?401:502,{error:code});}
  }
  return plainJson(res,404,{error:'not_found'});
});
server.listen(port,()=>{
  console.log(`connector listening on ${port}`,{secretFingerprint,hasSecret:Boolean(secret),
    autoSyncConfigured:Boolean(autoSyncSecret&&supabaseUrl&&supabaseKey),
    credentialKeyConfigured:credentialsConfigured(),
    telegramConfigured:Boolean(telegramBotToken)});
  loadLeagues().then(list=>console.log('leagues_loaded',{count:list.length,slugs:list.map(l=>l.slug)})).catch(e=>console.error('leagues_load_failed',{error:String(e)}));
  configureTelegramWebhook().catch(e=>console.error('telegram_webhook_setup_failed',{error:String(e)}));
});
