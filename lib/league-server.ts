import { cache } from 'react';
import { createClient } from './supabase/server';
import { leagueConfigFromRows,type LeagueConfig,type LeagueRow,type LeagueTeamRow } from './league.ts';
const COLUMNS='id,slug,name,season,competition_id,round_count,serie_a_offset,period_mode,first_half_end,free_tokens,penalty_amount,rules,updated_at';
// RLS already restricts fm_leagues to the user's leagues: one that is not theirs comes back empty.
export async function listMyLeagues():Promise<{id:string;slug:string;name:string}[]>{
 const client=await createClient();
 const {data,error}=await client.from('fm_leagues').select('id,slug,name').order('name');
 if(error)throw new Error('Leagues unavailable');
 return data??[];
}
// cache(): the layout and the page of one request share a single read.
export const loadLeagueConfig=cache(async function loadLeagueConfig(slug:string):Promise<LeagueConfig|null>{
 const client=await createClient();
 const {data:row,error}=await client.from('fm_leagues').select(COLUMNS).eq('slug',slug).maybeSingle();
 if(error)throw new Error('League unavailable');
 if(!row)return null;
 const {data:teams,error:teamsError}=await client.from('fm_league_teams').select('name,position,color,fantacalcio_team_id').eq('league_id',row.id).order('position');
 if(teamsError)throw new Error('League unavailable');
 return leagueConfigFromRows(row as LeagueRow,(teams??[]) as LeagueTeamRow[]);
});
