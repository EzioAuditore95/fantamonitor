'use client';
import { createContext,useContext,useEffect,useState,type ReactNode } from 'react';
import type { ScheduleRow } from '@/lib/round-schedule';

type State={rows:ScheduleRow[];loading:boolean;error:boolean};
const RoundScheduleContext=createContext<State>({rows:[],loading:false,error:false});

// The calendar is read once per league and shared: the banner counts down to the next
// round, the Home tab needs the kickoff of the round it is showing, and neither should
// pay for a second request. Deliberately no timer — the time is not part of this data,
// and a tick here would re-render every consumer.
export function RoundScheduleProvider({slug,children}:{slug:string;children:ReactNode}){
  const [state,setState]=useState<State>({rows:[],loading:true,error:false});
  useEffect(()=>{
    let active=true;
    // Resetting on a slug change is the point: the previous league's calendar must not be
    // read as this one's for the length of a request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({rows:[],loading:true,error:false});
    fetch(`/api/schedule?league=${encodeURIComponent(slug)}`,{cache:'no-store'})
      .then(async response=>{
        const body=await response.json() as {schedule?:ScheduleRow[]};
        if(!active)return;
        setState(response.ok?{rows:body.schedule??[],loading:false,error:false}:{rows:[],loading:false,error:true});
      })
      .catch(()=>{if(active)setState({rows:[],loading:false,error:true})});
    return()=>{active=false};
  },[slug]);
  return <RoundScheduleContext.Provider value={state}>{children}</RoundScheduleContext.Provider>;
}

export const useRoundSchedule=()=>useContext(RoundScheduleContext);
