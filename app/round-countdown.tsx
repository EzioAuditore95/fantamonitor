'use client';
import { useEffect,useMemo,useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock3 } from 'lucide-react';

type ScheduleRow={round:number;serie_a_round:number;start_at:string|null;source:string;source_url:string|null;updated_at:string};
type ScheduleResponse={schedule?:ScheduleRow[];error?:string};

function formatRemaining(ms:number){
  const total=Math.max(0,Math.floor(ms/1000));
  const days=Math.floor(total/86400);
  const hours=Math.floor((total%86400)/3600);
  const minutes=Math.floor((total%3600)/60);
  const seconds=total%60;
  if(days>0)return `${days}g ${String(hours).padStart(2,'0')}h ${String(minutes).padStart(2,'0')}m ${String(seconds).padStart(2,'0')}s`;
  return `${String(hours).padStart(2,'0')}h ${String(minutes).padStart(2,'0')}m ${String(seconds).padStart(2,'0')}s`;
}

function formatKickoff(value:string){
  return new Intl.DateTimeFormat('it-IT',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}).format(new Date(value));
}

export default function RoundCountdown(){
  const [rows,setRows]=useState<ScheduleRow[]>([]);
  const [now,setNow]=useState(()=>Date.now());
  const [target,setTarget]=useState<Element|null>(null);
  useEffect(()=>{
    setTarget(document.querySelector('.league-banner'));
    let active=true;
    fetch('/api/schedule',{cache:'no-store'}).then(async r=>{const body=await r.json() as ScheduleResponse;if(active&&r.ok)setRows(body.schedule??[]);}).catch(()=>{});
    const tick=setInterval(()=>setNow(Date.now()),1000);
    return()=>{active=false;clearInterval(tick)};
  },[]);
  const next=useMemo(()=>rows.filter(r=>r.start_at&&Date.parse(r.start_at)>now).sort((a,b)=>Date.parse(a.start_at!)-Date.parse(b.start_at!))[0]??null,[rows,now]);
  if(!target||!next?.start_at)return null;
  const remaining=Date.parse(next.start_at)-now;
  return createPortal(<div className="round-countdown" title={`Serie A ${next.serie_a_round}ª giornata · ${formatKickoff(next.start_at)}`}>
    <span className="round-countdown__icon"><Clock3 size={17}/></span>
    <span className="round-countdown__content">
      <span className="round-countdown__label">Giornata {next.round} · inizio tra</span>
      <strong className="round-countdown__value">{formatRemaining(remaining)}</strong>
      <span className="round-countdown__date">{formatKickoff(next.start_at)}</span>
    </span>
  </div>,target);
}
