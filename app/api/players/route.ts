import { requireLeagueMember } from '@/app/auth';
import { listSnapshots } from '@/lib/archive';
import { gradesByRound,historyFor } from '@/lib/serie-a-store';
import { sourceSeason } from '@/lib/serie-a';
const headers={'Cache-Control':'private, no-store'};

// Grades for the players this league actually fields, and for the rounds it has lineups for.
// The whole championship is some six hundred players a round: shipping it to the browser to
// display a couple of hundred would be paying for twenty leagues we do not have.
export async function GET(request:Request){
  const ctx=await requireLeagueMember(new URL(request.url).searchParams.get('league'));
  if(ctx instanceof Response)return ctx;
  const {cfg}=ctx;
  try{
    const snapshots=await listSnapshots(cfg);
    const ours=new Set<number>(),leagueRounds=new Set<number>();
    for(const snapshot of snapshots)for(const team of snapshot.teams){
      const formation=team.formation;
      if(!formation?.starters?.length)continue;
      leagueRounds.add(snapshot.round);
      for(const player of [...(formation.starters??[]),...(formation.bench??[]),...(formation.roster??[])]){
        const id=Number(player.id);if(Number.isInteger(id)&&id>0)ours.add(id);
      }
    }
    if(!leagueRounds.size)return Response.json({season:sourceSeason(cfg.season),rounds:[],players:[],grades:{},history:[]},{headers});
    const rounds=[...leagueRounds].sort((a,b)=>a-b);
    const byRound=await gradesByRound(sourceSeason(cfg.season),rounds.map(r=>r+cfg.serieAOffset));
    const grades:Record<string,{player_id:number;state:string;grade:number|null;events:number[]}[]>={};
    const players=new Map<number,{id:number;role:string|null}>();
    for(const [serieARound,rows] of byRound){
      grades[String(serieARound)]=[...rows.values()].filter(row=>ours.has(row.player_id))
        .map(row=>{players.set(row.player_id,{id:row.player_id,role:row.role??null});
          return {player_id:row.player_id,state:row.state,grade:row.grade,events:[...row.events]};});
    }
    // Past seasons are optional furniture: a missing history must not cost the page its grades.
    const history=await historyFor([...ours]).catch(e=>{console.error('players_history_failed',e instanceof Error?e.message:'unknown');return [];});
    return Response.json({season:sourceSeason(cfg.season),rounds,players:[...players.values()],grades,history},{headers});
  }catch(e){
    console.error('players_read_failed',e instanceof Error?e.message:'unknown');
    return Response.json({error:'Voti dei calciatori non disponibili.'},{status:503,headers});
  }
}
