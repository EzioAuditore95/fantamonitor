import { TEAM_NAMES,type Archive,type Snapshot } from './model';
import type { MatchResult,PerformancePayload } from './performance';

type PlayerRef={id?:string|number;name:string;role?:string};
export type ModuleStat={module:string;uses:number;share:number;avgFantasy:number|null};
export type PlayerUsage={name:string;role?:string;starts:number;startRate:number};
export type TeamLineupAnalytics={
  name:string;
  rounds:number;
  completeLineups:number;
  favoriteModule:string|null;
  favoriteModuleShare:number;
  moduleDiversity:number;
  modules:ModuleStat[];
  uniqueStarters:number;
  continuity:number|null;
  avgChanges:number|null;
  mostUsed:PlayerUsage|null;
  topStarters:PlayerUsage[];
};

function normalizeModule(value?:string){
  const raw=String(value??'').trim();
  const digits=raw.replace(/\D/g,'');
  if(digits.length===3||digits.length===4)return digits.split('').join('-');
  return raw||null;
}
function playerKey(p:PlayerRef){return String(p.id??p.name).trim().toLowerCase();}
function latestByRound(snapshots:Snapshot[]){
  const map=new Map<number,Snapshot>();
  for(const s of [...snapshots].sort((a,b)=>a.observed_at.localeCompare(b.observed_at)))map.set(s.round,s);
  return map;
}
function fantasyFor(match:MatchResult,name:string){
  if(match.home===name)return match.homeFantasy;
  if(match.away===name)return match.awayFantasy;
  return null;
}

export function computeLineupAnalytics(archive:Archive,performance?:PerformancePayload|null):TeamLineupAnalytics[]{
  const latest=latestByRound(archive.snapshots);
  const matches=performance?.matches??[];
  return TEAM_NAMES.map(name=>{
    const lineups:[number,NonNullable<Snapshot['teams'][number]['formation']>][]=[];
    for(const [round,s] of [...latest.entries()].sort((a,b)=>a[0]-b[0])){
      const team=s.teams.find(t=>t.name===name);
      if(team?.present&&team.formation?.starters?.length)lineups.push([round,team.formation]);
    }
    const playerCounts=new Map<string,{player:PlayerRef;starts:number}>();
    const moduleCounts=new Map<string,{uses:number;fantasy:number[]}>();
    let overlapSum=0,changesSum=0,transitions=0,completeLineups=0;
    let prev:Set<string>|null=null;
    for(const [round,formation] of lineups){
      const starters=formation.starters??[];
      if(starters.length===11)completeLineups++;
      const keys=new Set(starters.map(playerKey));
      for(const p of starters){const key=playerKey(p);const current=playerCounts.get(key);if(current)current.starts++;else playerCounts.set(key,{player:p,starts:1});}
      const module=normalizeModule(formation.module);
      if(module){const current=moduleCounts.get(module)??{uses:0,fantasy:[]};current.uses++;const match=matches.find(m=>m.round===round&&(m.home===name||m.away===name));const fp=match?fantasyFor(match,name):null;if(fp!=null)current.fantasy.push(fp);moduleCounts.set(module,current);}
      if(prev){let overlap=0;for(const key of keys)if(prev.has(key))overlap++;overlapSum+=overlap/Math.max(1,Math.min(11,prev.size,keys.size));changesSum+=Math.max(0,keys.size-overlap);transitions++;}
      prev=keys;
    }
    const rounds=lineups.length;
    const modules=[...moduleCounts.entries()].map(([module,x])=>({module,uses:x.uses,share:rounds?x.uses/rounds:0,avgFantasy:x.fantasy.length?x.fantasy.reduce((a,b)=>a+b,0)/x.fantasy.length:null})).sort((a,b)=>b.uses-a.uses||a.module.localeCompare(b.module));
    const topStarters=[...playerCounts.values()].map(x=>({name:x.player.name,role:x.player.role,starts:x.starts,startRate:rounds?x.starts/rounds:0})).sort((a,b)=>b.starts-a.starts||a.name.localeCompare(b.name));
    return {
      name,rounds,completeLineups,
      favoriteModule:modules[0]?.module??null,
      favoriteModuleShare:modules[0]?.share??0,
      moduleDiversity:modules.length,
      modules,
      uniqueStarters:playerCounts.size,
      continuity:transitions?overlapSum/transitions:null,
      avgChanges:transitions?changesSum/transitions:null,
      mostUsed:topStarters[0]??null,
      topStarters:topStarters.slice(0,5),
    };
  });
}
