import { appUrl,telegramBotToken } from './config.mjs';
import { rpc,withKey } from './rpc.mjs';

// A single bot serves N leagues: its webhook receives updates from every chat it belongs
// to, so mapping chat_id → league is enough. The texts stay pure and testable here.
export function checkpointCopy(checkpoint){return ({'T-24h':'Promemoria iniziale: manca ancora tempo, ma queste squadre non risultano aver inserito la formazione.','T-12h':'Promemoria: queste squadre risultano ancora senza formazione.','T-1h':'Manca 1 ora: controllare le squadre ancora senza formazione.','T-15m':'Ultimo avviso: mancano 15 minuti alla scadenza.','T+5m':'Scadenza superata: situazione finale rilevata.'})[checkpoint]||'Stato aggiornato.';}
export function buildTelegramMessage(snapshot,checkpoint='LIVE'){
  const missing=snapshot.teams.filter(t=>!t.present).map(t=>t.name);const summary=`Formazioni inserite: ${snapshot.inserted}/${snapshot.expected_total}`;const lines=[`FANTAMONITOR — Giornata ${snapshot.round}`,checkpoint==='LIVE'?'Aggiornamento manuale':checkpointCopy(checkpoint),summary,''];
  if(!missing.length)lines.push(checkpoint==='T+5m'?'Situazione finale: tutte le squadre hanno inserito la formazione.':'Tutte le squadre hanno inserito la formazione.');else lines.push(`Squadre senza formazione (${missing.length}):`,...missing.map(n=>`• ${n}`));
  lines.push('',`Aggiornato: ${new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}).format(new Date(snapshot.observed_at))}`);return lines.join('\n');
}
export function buildMissingMessage(snapshot){const missing=snapshot.teams.filter(t=>!t.present).map(t=>t.name);return missing.length?`Giornata ${snapshot.round} — senza formazione (${missing.length})\n${missing.map(n=>`• ${n}`).join('\n')}`:`Giornata ${snapshot.round} — nessuna squadra mancante.`;}
export function buildNextMessage(info){if(!info?.start_at)return 'Nessuna prossima giornata disponibile nel calendario.';const when=new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(info.start_at));return `Prossima giornata monitorata: ${info.round}\nInizio: ${when}`;}

export const keyboardFor=league=>({inline_keyboard:[
  [{text:'Aggiorna stato',callback_data:'status'},{text:'Sincronizza ora',callback_data:'sync'}],
  [{text:'Prossima giornata',callback_data:'next'},{text:'Statistiche',url:`${appUrl}/l/${league.slug}/stats`}],
  [{text:'Apri FANTAMONITOR',url:`${appUrl}/l/${league.slug}`}]]});

export async function telegramApi(method,payload){
  if(!telegramBotToken)throw new Error('telegram_not_configured');
  const response=await fetch(`https://api.telegram.org/bot${telegramBotToken}/${method}`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
  const text=await response.text();
  let body;try{body=JSON.parse(text);}catch{throw new Error(`telegram_${method}_invalid_json`);}
  if(!response.ok||body?.ok===false)throw new Error(`telegram_${method}_failed:${String(body?.description||response.status).slice(0,120)}`);
  return body.result;
}
export async function notifyAdmin(league,text){
  if(!league?.telegramAdminChatId)return;
  await telegramApi('sendMessage',{chat_id:league.telegramAdminChatId,text:`FANTAMONITOR — errore tecnico (${league.slug})\n${text}`}).catch(()=>{});
}
export async function publishTelegramStatus(league,snapshot,checkpoint,{force=false}={}){
  const chatId=league.telegramChatId;
  if(!telegramBotToken||!chatId)return {status:'skipped'};
  const keyboard=keyboardFor(league);
  const missing=snapshot.expected_total-snapshot.inserted;
  const state=await rpc('fm_get_telegram_message',withKey({league:league.id,day:snapshot.round}));
  if(missing===0&&!force&&!state&&checkpoint!=='T+5m')return {status:'silent_complete'};
  const payload={chat_id:chatId,text:buildTelegramMessage(snapshot,checkpoint),reply_markup:keyboard,disable_web_page_preview:true};
  if(league.telegramThreadId){const x=Number(league.telegramThreadId);if(Number.isInteger(x)&&x>0)payload.message_thread_id=x;}
  const remember=messageId=>rpc('fm_upsert_telegram_message',withKey({league:league.id,day:snapshot.round,target_chat_id:String(chatId),telegram_message_id:Number(messageId),checkpoint_name:checkpoint}));
  if(state?.message_id&&String(state.chat_id)===String(chatId)){
    try{
      await telegramApi('editMessageText',{chat_id:chatId,message_id:Number(state.message_id),text:payload.text,reply_markup:keyboard,disable_web_page_preview:true});
      await remember(state.message_id);
      return {status:'edited',messageId:Number(state.message_id)};
    }catch(e){console.error('telegram_edit_failed',{league:league.slug,round:snapshot.round,error:String(e)});}
  }
  const message=await telegramApi('sendMessage',payload);
  await remember(message.message_id);
  return {status:'sent',messageId:Number(message.message_id)};
}
