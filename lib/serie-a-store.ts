import { createClient } from './supabase/server';
import { liveRoundUrl } from './serie-a-events.ts';
import { parseLiveRound,pendingRounds,type SerieARoundPayload } from './serie-a.ts';

// Ingestion of the public live feed: the only I/O of this feature. No credentials, no connector,
// no Playwright — the bucket is public, so a failure here can never cost anything but the data.
const FETCH_TIMEOUT=15_000;
// One call catches up at most this many rounds. A cold start in May needs several runs, and that
// is better than one request that dies halfway through a Vercel function's budget.
const MAX_ROUNDS_PER_RUN=8;

export type RoundOutcome={round:number;status:'imported'|'already_final'|'not_published';final?:boolean;grades?:number};

export async function storedRounds(season:string):Promise<{round:number;final:boolean}[]>{
  const client=await createClient();
  const {data,error}=await client.from('fm_serie_a_rounds').select('round,final').eq('season',season).order('round');
  if(error)throw new Error('Serie A rounds unavailable');
  return data??[];
}

// Null when the source has not published that round yet: unpublished rounds answer 403, not 404.
export async function fetchLiveRound(round:number):Promise<unknown|null>{
  const response=await fetch(liveRoundUrl(round),{cache:'no-store',signal:AbortSignal.timeout(FETCH_TIMEOUT)});
  if(response.status===403||response.status===404)return null;
  if(!response.ok)throw new Error(`serie_a_http_${response.status}`);
  return await response.json();
}

export async function importRound(payload:SerieARoundPayload):Promise<RoundOutcome>{
  const client=await createClient();
  const {data,error}=await client.rpc('fm_import_serie_a_round',{payload});
  // Settled rounds are refused by design, and racing two syncs is the ordinary way to meet that
  // refusal: it is an outcome to report, not a failure to raise.
  if(error?.message.includes('round_already_final'))return {round:payload.round,status:'already_final'};
  if(error){console.error('serie_a_import_failed',{round:payload.round,message:error.message});throw new Error('serie_a_import_failed');}
  const result=data as {grades:number;final:boolean};
  return {round:payload.round,status:'imported',final:result.final,grades:result.grades};
}

// Rounds are published in order, so the first one the source has not published ends the run.
export async function syncSerieA(season:string):Promise<{rounds:RoundOutcome[];remaining:number}>{
  const pending=pendingRounds(await storedRounds(season));
  const rounds:RoundOutcome[]=[];
  for(const round of pending.slice(0,MAX_ROUNDS_PER_RUN)){
    const raw=await fetchLiveRound(round);
    if(!raw){rounds.push({round,status:'not_published'});return {rounds,remaining:0};}
    rounds.push(await importRound(parseLiveRound(raw,season,round)));
  }
  return {rounds,remaining:Math.max(0,pending.length-rounds.length)};
}
