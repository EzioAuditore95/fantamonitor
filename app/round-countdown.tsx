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
  const style:React.CSSProperties={display:'flex',alignItems:'center',gap:10,marginLeft:'auto',padding:'8px 12px',border:'1px solid rgba(255,255,255,.16)',borderRadius:12,background:'rgba(255,255,255,.06)',minWidth:220};
  const iconStyle:React.CSSProperties={width:30,height:30,borderRadius:9,display:'grid',placeItems:'center',background:'rgba(255,255,255,.08)',flex:'0 0 auto'};
  return createPortal(<div style={style} title={`Serie A ${next.serie_a_round}ª giornata · ${formatKickoff(next.start_at)}`}>
    <span style={iconStyle}><Clock3 size={16}/></span>
    <span style={{display:'flex',flexDirection:'column',lineHeight:1.15}}>
      <span style={{fontSize:11,opacity:.72,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em'}}>Giornata {next.round} · inizio tra</span>
      <strong style={{fontSize:16,fontVariantNumeric:'tabular-nums'}}>{formatRemaining(remaining)}</strong>
      <span style={{fontSize:11,opacity:.72}}>{formatKickoff(next.start_at)}</span>
    </span>
  </div>,target);
}
