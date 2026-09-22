'use client';
import { useEffect,useState } from 'react';
import type { PlayerGrades } from '@/lib/home-players';

type IdleWindow=Window&{
  requestIdleCallback?:(callback:()=>void,options?:{timeout:number})=>number;
  cancelIdleCallback?:(handle:number)=>void;
};

export type PlayerGradesState={grades:PlayerGrades|null;loading:boolean;error:boolean};

// The heaviest thing the Home tab can ask for: every player the league fields, every round it
// has lineups for. So it asks **once**, after the page has painted, and never again — pointedly
// outside the sixty-second archive poll, because nothing it feeds (season averages, points left
// on the bench) changes from one minute to the next. Everything it feeds renders without it.
export function usePlayerGrades(slug:string):PlayerGradesState{
  const [state,setState]=useState<PlayerGradesState>({grades:null,loading:true,error:false});
  useEffect(()=>{
    let active=true;
    const run=()=>{
      fetch(`/api/players?league=${encodeURIComponent(slug)}`,{cache:'no-store'})
        .then(async response=>{
          const body=await response.json() as PlayerGrades;
          if(active)setState({grades:response.ok?body:null,loading:false,error:!response.ok});
        })
        .catch(()=>{if(active)setState({grades:null,loading:false,error:true})});
    };
    const idleWindow=window as IdleWindow;
    // Idle time if the browser offers it, a short delay otherwise: either way the first paint
    // is not waiting on this request.
    const idle=idleWindow.requestIdleCallback?.(run,{timeout:3000});
    const timer=idle===undefined?window.setTimeout(run,400):undefined;
    return()=>{
      active=false;
      if(idle!==undefined)idleWindow.cancelIdleCallback?.(idle);
      if(timer!==undefined)window.clearTimeout(timer);
    };
  },[slug]);
  return state;
}
