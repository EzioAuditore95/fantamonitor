import { rpc,withKey } from './rpc.mjs';
import { open } from './credentials.mjs';
import { sessionTtlMs } from './config.mjs';

let cache={at:0,leagues:[]};
const TTL=60_000;
export async function loadLeagues({force=false}={}){
  if(!force&&Date.now()-cache.at<TTL&&cache.leagues.length)return cache.leagues;
  const leagues=await rpc('fm_leagues_for_bot',withKey({}))??[];
  cache={at:Date.now(),leagues};
  return leagues;
}
export const forgetLeagues=()=>{cache={at:0,leagues:[]};};

// Pure on purpose: this is where a message could end up in the wrong channel.
export function leagueForChat(chatId,leagues){
  if(chatId==null)return null;
  const wanted=String(chatId);
  return leagues.find(l=>[l.telegramChatId,l.telegramAdminChatId].some(id=>id!=null&&String(id)===wanted))??null;
}
export function leagueBySlug(slug,leagues){return leagues.find(l=>l.slug===slug)??null;}

// Do not trust the TTL alone: Fantacalcio can invalidate a session at any moment, so this
// is a shortcut, not a guarantee — the fallback is always a full login.
export function shouldReuseSession(record,now=Date.now(),ttlMs=sessionTtlMs){
  if(!record?.sessionState)return false;
  if(record.sessionExpiresAt&&Date.parse(record.sessionExpiresAt)<=now)return false;
  if(record.storedAt&&now-Date.parse(record.storedAt)>ttlMs)return false;
  return true;
}
export async function credentialsFor(league){
  const record=await rpc('fm_league_credentials_for_bot',withKey({league:league.id}));
  if(!record)return {password:null,sessionState:null,record:null};
  let password=null,sessionState=null;
  if(record.payload){try{password=JSON.parse(open(record.payload));}catch{throw new Error('connector_credential_unreadable');}}
  if(record.sessionState&&shouldReuseSession(record)){try{sessionState=JSON.parse(open(record.sessionState));}catch{sessionState=null;}}
  return {password,sessionState,record};
}
export async function storeSession(league,sealedState,expiresAt){
  await rpc('fm_store_league_session',withKey({league:league.id,sealed:sealedState,expires_at:expiresAt}));
}
export async function recordCredentialCheck(league,outcome){
  await rpc('fm_record_credential_check',withKey({league:league.id,outcome})).catch(()=>{});
}
