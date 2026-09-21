import { credentialsFor,recordCredentialCheck,storeSession } from './leagues.mjs';
import { seal,usernameFingerprint } from './credentials.mjs';
import { withLeagueContext } from './browser.mjs';
import { sessionTtlMs } from './config.mjs';
import { rpc,withKey } from './rpc.mjs';
import { enrichLineup,enrichTeam,findTeamObjects } from './fantacalcio.mjs';
import { competitionFrom,dashboardUrl,manageLineupsUrl,snapshotFor,toTeamStatus } from './snapshot.mjs';
export { dashboardUrl,manageLineupsUrl,snapshotFor } from './snapshot.mjs';

const ORIGIN='https://leghe.fantacalcio.it';

async function atLoginWall(page){
  if(/\/login(?:\/|$)/i.test(new URL(page.url()).pathname))return true;
  return await page.locator('input[autocomplete="username"]:visible,input[placeholder="Username"]:visible').count()>0;
}
async function submitLogin(page,account){
  await page.goto(`${ORIGIN}/login`,{waitUntil:'domcontentloaded',timeout:20000});
  await page.locator('input[placeholder="Username"],input[autocomplete="username"]').first().fill(account.u);
  await page.locator('input[placeholder="Password"],input[autocomplete="current-password"]').first().fill(account.p);
  await page.getByRole('button',{name:'LOGIN'}).click();
  await Promise.race([page.waitForURL(u=>!/\/login(?:\/|$)/i.test(new URL(u).pathname),{timeout:15000}),page.waitForTimeout(3000)]);
  await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{});
}
// The stored session is tried first; a full login is the fallback, not the rule.
// The TTL alone is not trusted: Fantacalcio can invalidate a session at any moment.
async function reachAuthenticated(page,league,target,creds){
  await page.goto(target,{waitUntil:'networkidle',timeout:30000});
  if(!await atLoginWall(page))return {relogged:false};
  if(!creds.password)throw new Error('connector_credentials_missing');
  console.info('fantacalcio_session_stale',{league:league.slug,usernameFingerprint:usernameFingerprint(creds.password.u)});
  await submitLogin(page,creds.password);
  await page.goto(target,{waitUntil:'networkidle',timeout:30000});
  if(await atLoginWall(page))throw new Error('connector_auth_failed');
  return {relogged:true};
}
async function persistSession(league,context){
  try{
    const state=await context.storageState();
    await storeSession(league,seal(JSON.stringify(state)),new Date(Date.now()+sessionTtlMs).toISOString());
  }catch(e){console.error('session_persist_failed',{league:league.slug,error:String(e)});}
}

async function gather(league,round){
  const creds=await credentialsFor(league);
  return withLeagueContext(league.id,creds.sessionState,async context=>{
    const page=await context.newPage();
    let teamsPayload=null;
    const listener=async response=>{if(/\/onboarding\/v1\/league\/competition\/teams/.test(response.url())&&response.status()===200){try{teamsPayload=await response.json();}catch{}}};
    page.on('response',listener);
    try{
      const cdp=await page.context().newCDPSession(page);
      await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
      const firstRequest=page.waitForRequest(r=>/\/gaming\/v1\/teamLineup\/visualizza\//.test(r.url()),{timeout:45000});
      const {relogged}=await reachAuthenticated(page,league,manageLineupsUrl(league,round),creds);
      const match=page.url().match(/\/manage-lineups\/(\d+)/i);
      if((match?Number(match[1]):null)!==round)throw new Error('connector_round_unavailable');
      const request=await firstRequest;
      if(!teamsPayload)throw new Error('connector_team_list_missing');
      const found=new Map();
      for(const item of findTeamObjects(teamsPayload))if(!found.has(item.name))found.set(item.name,item);
      const roster=league.teams.map(name=>{const item=found.get(name);return {name,id:item?.id,meta:item?.raw?enrichTeam(item.raw):undefined};});
      if(roster.some(t=>!Number.isInteger(t.id)))throw new Error('connector_team_mapping_failed');
      const captured=await request.allHeaders();
      const headers={};
      for(const [k,v] of Object.entries(captured)){const l=k.toLowerCase();
        if(!k.startsWith(':')&&!['host','content-length','connection','accept-encoding'].includes(l)&&!l.startsWith('sec-fetch-'))headers[k]=v;}
      if(relogged)await persistSession(league,context);
      // Persisting the team id removes a failure mode: it is otherwise rediscovered every capture.
      await rpc('fm_store_league_team_ids',withKey({league:league.id,mapping:Object.fromEntries(roster.map(t=>[t.name,t.id]))})).catch(()=>{});
      return {roster,headers};
    }finally{page.off('response',listener);}
  });
}

export async function capture(league,round){
  if(!Number.isInteger(round)||round<1||round>league.roundCount)throw new Error('invalid_round');
  const started=Date.now();
  const {roster,headers}=await gather(league,round);
  const items=await Promise.all(roster.map(async team=>{
    const url=`https://apileague.fantacalcio.it/gaming/v1/teamLineup/visualizza/A/${league.competitionId}/${team.id}/${round}`;
    const response=await fetch(url,{headers,signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(`connector_lineup_http_${response.status}`);
    let payload;try{payload=enrichLineup(await response.json());}catch{throw new Error('connector_lineup_invalid_json');}
    return {team,dto:payload?.teamLineupDto??null};
  }));
  // Temporaneo, per capire quale campo distingue una formazione confermata da una riportata in
  // automatico: solo i campi scalari del DTO, mai i giocatori. Da togliere appena la regola è
  // scritta — vedi la voce "Una formazione sono undici nomi" in CLAUDE.md.
  for(const {team,dto} of items){
    if(!dto)continue;
    const scalars=Object.fromEntries(Object.entries(dto).filter(([,v])=>v===null||['string','number','boolean'].includes(typeof v)));
    const arrays=Object.fromEntries(Object.entries(dto).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]));
    console.info('lineup_dto_shape',{round,team:team.id,scalars,arrays});
  }
  const teamsData=items.map(x=>toTeamStatus(x,round));
  if(teamsData.length!==league.teams.length)throw new Error('connector_incomplete_teams');
  const snapshot=snapshotFor(league,round,teamsData);
  console.info('fantacalcio_capture_complete',{league:league.slug,round,inserted:snapshot.inserted,durationMs:Date.now()-started});
  return snapshot;
}

// Login only, no capture: this is what the "check connection" button needs.
export async function checkCredentials(league){
  try{
    const creds=await credentialsFor(league);
    const outcome=await withLeagueContext(league.id,creds.sessionState,async context=>{
      const page=await context.newPage();
      const {relogged}=await reachAuthenticated(page,league,dashboardUrl(league),creds);
      if(relogged)await persistSession(league,context);
      return relogged?'relogged':'session_reused';
    });
    await recordCredentialCheck(league,'ok');
    return {status:'ok',detail:outcome};
  }catch(error){
    const code=error instanceof Error?error.message:'connector_failed';
    await recordCredentialCheck(league,code==='connector_auth_failed'||code==='connector_credentials_missing'?'auth_failed':'error');
    throw error;
  }
}

// Cached per league rather than once: with several leagues a global cache would serve the
// wrong league's data. That is precisely why the phase2 monkey-patch could not scale.
const competitionCache=new Map();
const COMPETITION_TTL=60_000;
export async function captureCompetition(league){
  const cached=competitionCache.get(league.id);
  if(cached&&Date.now()-cached.at<COMPETITION_TTL)return cached.data;
  const creds=await credentialsFor(league);
  const data=await withLeagueContext(league.id,creds.sessionState,async context=>{
    const page=await context.newPage();
    let calendar=null,teamsPayload=null;
    const listener=async r=>{if(r.status()!==200)return;const u=r.url();try{
      if(/\/onboarding\/v1\/league\/competition\/calendar\//.test(u))calendar=await r.json();
      if(/\/onboarding\/v1\/league\/competition\/teams/.test(u))teamsPayload=await r.json();
    }catch{}};
    page.on('response',listener);
    try{
      const {relogged}=await reachAuthenticated(page,league,dashboardUrl(league),creds);
      if(relogged)await persistSession(league,context);
      return competitionFrom(league,calendar,teamsPayload);
    }finally{page.off('response',listener);}
  });
  competitionCache.set(league.id,{at:Date.now(),data});
  return data;
}
