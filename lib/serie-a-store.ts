import { createClient } from './supabase/server';
import { liveRoundUrl } from './serie-a-events.ts';
import { parseLiveRound,pendingRounds,roundHasStarted,type SerieARoundPayload } from './serie-a.ts';
import type { PlayerRound } from './player-performance.ts';
import { parseSeasonStats,seasonStatsUrl,type SeasonTotals } from './serie-a-history.ts';

// Ingestion of the public live feed: the only I/O of this feature. No credentials, no connector,
// no Playwright — the bucket is public, so a failure here can never cost anything but the data.
const FETCH_TIMEOUT=15_000;
// One call catches up at most this many rounds. A cold start in May needs several runs, and that
// is better than one request that dies halfway through a Vercel function's budget.
const MAX_ROUNDS_PER_RUN=8;

export type RoundOutcome={round:number;status:'imported'|'already_final'|'not_published'|'not_started';final?:boolean;grades?:number};

// Without a session the table is unreadable — the read policy is for `authenticated` — so the
// unattended run asks the same key for the same answer instead of the read policy opening to anon.
export async function storedRounds(season:string,accessKey?:string):Promise<{round:number;final:boolean}[]>{
  const client=await createClient();
  if(accessKey){
    const {data,error}=await client.rpc('fm_serie_a_rounds_for_import',{access_key:accessKey,season});
    if(error)throw new Error(/unauthorized/.test(error.message)?'serie_a_unauthorized':'Serie A rounds unavailable');
    return (data??[]) as {round:number;final:boolean}[];
  }
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

// The key is the door for the caller that has no session; a logged-in admin passes none and is
// recognised by the RPC itself. Neither branch is decided here: the database is the authority.
export async function importRound(payload:SerieARoundPayload,accessKey?:string):Promise<RoundOutcome>{
  const client=await createClient();
  const {data,error}=await client.rpc('fm_import_serie_a_round',accessKey?{payload,access_key:accessKey}:{payload});
  // Settled rounds are refused by design, and racing two syncs is the ordinary way to meet that
  // refusal: it is an outcome to report, not a failure to raise.
  if(error?.message.includes('round_already_final'))return {round:payload.round,status:'already_final'};
  if(error){console.error('serie_a_import_failed',{round:payload.round,message:error.message});
    throw new Error(/unauthorized|admin_required/.test(error.message)?'serie_a_unauthorized':'serie_a_import_failed');}
  const result=data as {grades:number;final:boolean};
  return {round:payload.round,status:'imported',final:result.final,grades:result.grades};
}

// Rounds are published in order, so the first one the source has not published ends the run.
export async function syncSerieA(season:string,accessKey?:string):Promise<{rounds:RoundOutcome[];remaining:number}>{
  const pending=pendingRounds(await storedRounds(season,accessKey));
  const rounds:RoundOutcome[]=[];
  for(const round of pending.slice(0,MAX_ROUNDS_PER_RUN)){
    const raw=await fetchLiveRound(round);
    if(!raw){rounds.push({round,status:'not_published'});return {rounds,remaining:0};}
    const payload=parseLiveRound(raw,season,round);
    // A round whose fixtures are out but which nobody has played yet ends the run: the database
    // refuses a round with no grades, and it is right to — there is nothing in it.
    if(!roundHasStarted(payload)){rounds.push({round,status:'not_started'});return {rounds,remaining:0};}
    rounds.push(await importRound(payload,accessKey));
  }
  return {rounds,remaining:Math.max(0,pending.length-rounds.length)};
}

// Grades for the rounds a league actually needs, indexed by Serie A round and then by player.
// Roles live on the player, not on the grade, and lineup scoring needs them for the clean sheet:
// two queries and a join here beat an embedded select whose shape PostgREST decides.
export async function gradesByRound(season:string,rounds:readonly number[]):Promise<Map<number,Map<number,PlayerRound>>>{
  const out=new Map<number,Map<number,PlayerRound>>();
  if(!rounds.length)return out;
  const client=await createClient();
  const {data:players,error:playersError}=await client.from('fm_serie_a_players').select('id,role');
  if(playersError)throw new Error('Serie A players unavailable');
  const roles=new Map((players??[]).map(p=>[p.id as number,(p.role??null) as string|null]));
  for(let offset=0;;offset+=500){
    const {data,error}=await client.from('fm_serie_a_grades').select('round,player_id,state,grade,events')
      .eq('season',season).in('round',[...rounds]).order('round').order('player_id').range(offset,offset+499);
    if(error)throw new Error('Serie A grades unavailable');
    for(const row of data??[]){
      const byPlayer=out.get(row.round as number)??new Map<number,PlayerRound>();
      byPlayer.set(row.player_id as number,{player_id:row.player_id as number,round:row.round as number,
        state:row.state as PlayerRound['state'],grade:row.grade==null?null:Number(row.grade),
        events:(row.events??[]) as number[],role:roles.get(row.player_id as number)??null});
      out.set(row.round as number,byPlayer);
    }
    if(!data||data.length<500)break;
  }
  return out;
}

// --- past seasons ---------------------------------------------------------------------------
// Two megabytes of HTML per season, read once and thrown away: only the parsed rows are stored.
export async function importSeason(season:string):Promise<{season:string;players:number}|null>{
  const response=await fetch(seasonStatsUrl(season),{cache:'no-store',
    headers:{'user-agent':'FANTAMONITOR/1.0 (+private league dashboard)'},signal:AbortSignal.timeout(30_000)});
  if(response.status===404)return null;
  if(!response.ok)throw new Error(`serie_a_history_http_${response.status}`);
  const players=parseSeasonStats(await response.text());
  // Zero rows from a page that answered 200 means the page changed shape, not that Serie A was
  // not played: importing that would quietly empty a season that is already stored.
  if(!players.length)throw new Error('serie_a_history_empty');
  const client=await createClient();
  const {data,error}=await client.rpc('fm_import_serie_a_season',{payload:{season,players}});
  if(error){console.error('serie_a_history_failed',{season,message:error.message});
    throw new Error(/season_is_live/.test(error.message)?'serie_a_history_live':
      /unauthorized/.test(error.message)?'serie_a_unauthorized':'serie_a_history_failed');}
  return data as {season:string;players:number};
}

export type StoredSeason=Pick<SeasonTotals,'player_id'|'name'|'team'|'played'|'grade'|'fantasyGrade'|'goals'|'assists'>&{season:string};
export async function historyFor(playerIds:readonly number[]):Promise<StoredSeason[]>{
  if(!playerIds.length)return [];
  const client=await createClient();
  const out:StoredSeason[]=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await client.from('fm_serie_a_season_totals')
      .select('season,player_id,name,team,played,grade,fantasy_grade,goals,assists')
      .in('player_id',[...playerIds]).order('season',{ascending:false}).range(offset,offset+499);
    if(error)throw new Error('Serie A history unavailable');
    for(const row of data??[])out.push({season:row.season as string,player_id:row.player_id as number,
      name:row.name as string,team:(row.team??null) as string|null,played:row.played as number|null,
      grade:row.grade==null?null:Number(row.grade),fantasyGrade:row.fantasy_grade==null?null:Number(row.fantasy_grade),
      goals:row.goals as number|null,assists:row.assists as number|null});
    if(!data||data.length<500)break;
  }
  return out;
}
