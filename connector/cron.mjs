import crypto from 'node:crypto';

const supabaseUrl=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const supabaseKey=process.env.SUPABASE_PUBLISHABLE_KEY||'';
const autoSyncSecret=process.env.AUTO_SYNC_DB_SECRET||'';
const connectorSecret=process.env.FANTAMONITOR_CONNECTOR_SECRET||'';
const connectorUrl=(process.env.CONNECTOR_URL||'https://fantamonitor-connector-production.up.railway.app').replace(/\/$/,'');
const telegramBotToken=process.env.TELEGRAM_BOT_TOKEN||'';
const telegramChatId=process.env.TELEGRAM_CHAT_ID||'';
const telegramThreadId=process.env.TELEGRAM_THREAD_ID||'';

function requireConfig(){
  const missing=[];
  for(const [name,value] of Object.entries({SUPABASE_URL:supabaseUrl,SUPABASE_PUBLISHABLE_KEY:supabaseKey,AUTO_SYNC_DB_SECRET:autoSyncSecret,FANTAMONITOR_CONNECTOR_SECRET:connectorSecret,TELEGRAM_BOT_TOKEN:telegramBotToken,TELEGRAM_CHAT_ID:telegramChatId}))if(!value)missing.push(name);
  if(missing.length)throw new Error(`cron_missing_config:${missing.join(',')}`);
}

async function rpc(name,args){
  const r=await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:supabaseKey,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
  const text=await r.text();
  if(!r.ok)throw new Error(`supabase_${name}_${r.status}:${text.slice(0,180)}`);
  if(!text)return null;
  try{return JSON.parse(text);}catch{return text;}
}

async function capture(round){
  const body=JSON.stringify({round});
  const timestamp=String(Date.now());
  const signature=crypto.createHmac('sha256',connectorSecret).update(`${timestamp}.${body}`).digest('hex');
  const r=await fetch(`${connectorUrl}/sync`,{method:'POST',headers:{'content-type':'application/json','x-fm-timestamp':timestamp,'x-fm-signature':signature},body,signal:AbortSignal.timeout(90000)});
  const text=await r.text();
  let data=null;try{data=JSON.parse(text);}catch{}
  if(!r.ok||!data?.snapshot)throw new Error(`connector_sync_${r.status}:${String(data?.error||text).slice(0,180)}`);
  return data.snapshot;
}

function checkpointCopy(checkpoint){
  return ({
    'T-24h':'Promemoria iniziale: manca ancora tempo, ma queste squadre non risultano aver inserito la formazione.',
    'T-12h':'Promemoria: queste squadre risultano ancora senza formazione.',
    'T-1h':'Manca 1 ora: controllare le squadre ancora senza formazione.',
    'T-15m':'Ultimo avviso: mancano 15 minuti alla scadenza.',
    'T+5m':'Scadenza superata: situazione finale rilevata.'
  })[checkpoint]||'Stato aggiornato.';
}

function buildMessage(snapshot,checkpoint){
  const missing=snapshot.teams.filter(t=>!t.present).map(t=>t.name);
  const lines=[`FANTAMONITOR — Giornata ${snapshot.round}`,checkpointCopy(checkpoint),`Formazioni inserite: ${snapshot.inserted}/${snapshot.expected_total}`,''];
  if(!missing.length)lines.push(checkpoint==='T+5m'?'Situazione finale: tutte le squadre hanno inserito la formazione.':'Tutte le squadre hanno inserito la formazione.');
  else lines.push(`Squadre senza formazione (${missing.length}):`,...missing.map(n=>`• ${n}`));
  lines.push('',`Aggiornato: ${new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}).format(new Date(snapshot.observed_at))}`);
  return lines.join('\n');
}

const keyboard={inline_keyboard:[[{text:'Aggiorna stato',callback_data:'status'},{text:'Sincronizza ora',callback_data:'sync'}],[{text:'Statistiche',url:'https://fantamonitor-production.up.railway.app/stats'},{text:'Apri FANTAMONITOR',url:'https://fantamonitor-production.up.railway.app'}]]};

async function telegramApi(method,payload){
  const r=await fetch(`https://api.telegram.org/bot${telegramBotToken}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
  const text=await r.text();let data=null;try{data=JSON.parse(text);}catch{}
  if(!r.ok||!data?.ok)throw new Error(`telegram_${method}_${r.status}:${String(data?.description||text).slice(0,180)}`);
  return data.result;
}

async function publish(snapshot,checkpoint){
  const state=await rpc('fm_get_telegram_message',{access_key:autoSyncSecret,day:snapshot.round});
  const missing=snapshot.expected_total-snapshot.inserted;
  if(missing===0&&!state&&checkpoint!=='T+5m')return {status:'silent_complete'};
  const text=buildMessage(snapshot,checkpoint);
  if(state?.message_id&&String(state.chat_id)===String(telegramChatId)){
    try{
      await telegramApi('editMessageText',{chat_id:telegramChatId,message_id:Number(state.message_id),text,reply_markup:keyboard,disable_web_page_preview:true});
      await rpc('fm_upsert_telegram_message',{access_key:autoSyncSecret,day:snapshot.round,target_chat_id:String(telegramChatId),telegram_message_id:Number(state.message_id),checkpoint_name:checkpoint});
      return {status:'edited',messageId:Number(state.message_id)};
    }catch(e){
      if(String(e).includes('message is not modified'))return {status:'unchanged',messageId:Number(state.message_id)};
      console.warn('telegram_edit_failed',{error:String(e)});
    }
  }
  const payload={chat_id:telegramChatId,text,reply_markup:keyboard,disable_web_page_preview:true};
  if(telegramThreadId){const id=Number(telegramThreadId);if(Number.isInteger(id)&&id>0)payload.message_thread_id=id;}
  const message=await telegramApi('sendMessage',payload);
  await rpc('fm_upsert_telegram_message',{access_key:autoSyncSecret,day:snapshot.round,target_chat_id:String(telegramChatId),telegram_message_id:Number(message.message_id),checkpoint_name:checkpoint});
  return {status:'sent',messageId:Number(message.message_id)};
}

async function main(){
  requireConfig();
  const claim=await rpc('fm_claim_due_auto_sync',{access_key:autoSyncSecret});
  if(!claim){console.info('cron_no_due_checkpoint');return;}
  const round=Number(claim.round),checkpoint=String(claim.checkpoint);
  try{
    const snapshot=await capture(round);
    const telegram=await publish(snapshot,checkpoint);
    const result=await rpc('fm_complete_auto_sync',{access_key:autoSyncSecret,day:round,checkpoint_name:checkpoint,sample:snapshot});
    console.info('cron_auto_sync_complete',{round,checkpoint,inserted:snapshot.inserted,telegram:telegram.status,result});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    await rpc('fm_fail_auto_sync',{access_key:autoSyncSecret,day:round,checkpoint_name:checkpoint,error_text:message}).catch(()=>{});
    throw error;
  }
}

main().catch(error=>{console.error('cron_auto_sync_failed',{error:error instanceof Error?error.message:String(error)});process.exitCode=1;});
