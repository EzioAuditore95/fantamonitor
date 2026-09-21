// One row of fm_round_schedule, as /api/schedule returns it.
export type ScheduleRow={round:number;serie_a_round:number;start_at:string|null;source:string;source_url:string|null;updated_at:string};

export function formatRemaining(ms:number){
  const total=Math.max(0,Math.floor(ms/1000));
  const days=Math.floor(total/86400);
  const hours=Math.floor((total%86400)/3600);
  const minutes=Math.floor((total%3600)/60);
  const seconds=total%60;
  if(days>0)return `${days}g ${String(hours).padStart(2,'0')}h ${String(minutes).padStart(2,'0')}m ${String(seconds).padStart(2,'0')}s`;
  return `${String(hours).padStart(2,'0')}h ${String(minutes).padStart(2,'0')}m ${String(seconds).padStart(2,'0')}s`;
}

// The same countdown without the seconds, for a caller whose clock ticks once a minute:
// showing seconds that only move in steps of sixty would look broken.
export function formatRemainingCoarse(ms:number){
  const total=Math.max(0,Math.floor(ms/60000));
  const days=Math.floor(total/1440);
  const hours=Math.floor((total%1440)/60);
  const minutes=total%60;
  if(days>0)return `${days}g ${hours}h ${minutes}m`;
  if(hours>0)return `${hours}h ${minutes}m`;
  return `${minutes} min`;
}

export function formatKickoff(value:string){
  return new Intl.DateTimeFormat('it-IT',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}).format(new Date(value));
}

// The next round still to start. What the banner counts down to.
export function nextKickoff(rows:readonly ScheduleRow[],now:number):ScheduleRow|null{
  return rows.filter(r=>r.start_at&&Date.parse(r.start_at)>now).sort((a,b)=>Date.parse(a.start_at!)-Date.parse(b.start_at!))[0]??null;
}

// The kickoff of one named round, which is not the same question: while a round is under
// way it has already started, so nextKickoff points at the one after it.
export function kickoffFor(rows:readonly ScheduleRow[],round:number):ScheduleRow|null{
  return rows.find(r=>r.round===round&&r.start_at)??null;
}
