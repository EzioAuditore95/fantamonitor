'use client';
import { useEffect,useMemo,useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock3 } from 'lucide-react';
import { formatKickoff,formatRemaining,nextKickoff } from '@/lib/round-schedule';
import { useRoundSchedule } from '@/app/round-schedule-provider';

export default function RoundCountdown(){
  const {rows}=useRoundSchedule();
  const [now,setNow]=useState(()=>Date.now());
  const [target,setTarget]=useState<Element|null>(null);
  useEffect(()=>{
    // The portal host only exists after hydration: reading it during render would
    // make the server and client markup disagree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(document.querySelector('.league-banner'));
    // The banner shows seconds, so this one ticks every second. It is the only such timer
    // on the page: a tick inside Dashboard would re-render the teams table and the 350
    // buttons of the history matrix along with it.
    const tick=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(tick);
  },[]);
  const next=useMemo(()=>nextKickoff(rows,now),[rows,now]);
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
