'use client';

import { useEffect,useMemo,useState } from 'react';
import { ArrowLeft,BarChart3,Clock3,TriangleAlert } from 'lucide-react';
import { TEAM_NAMES,type Archive,type Snapshot } from '@/lib/model';

type ScheduleRow={round:number;start_at:string|null};
type ScheduleResponse={schedule:ScheduleRow[];error?:string};

type TeamStat={
  name:string;
  observedRounds:number;
  finalMissing:number;
  firstObservedPresent:number;
  missingNearDeadline:number;
  samplesNearDeadline:number;
  avgFirstPresenceMinutes:number|null;
};

function latestByRound(snapshots:Snapshot[]){
  const map=new Map<number,Snapshot>();
  for(const snapshot of [...snapshots].sort((a,b)=>a.observed_at.localeCompare(b.observed_at)))map.set(snapshot.round,snapshot);
  return map;
}

function formatMinutes(value:number|null){
  if(value===null)return '—';
  if(value>=60)return `${(value/60).toFixed(value>=120?0:1)} h`;
  if(value<=-60)return `${(Math.abs(value)/60).toFixed(Math.abs(value)>=120?0:1)} h dopo`;
  if(value<0)return `${Math.abs(Math.round(value))} min dopo`;
  return `${Math.round(value)} min prima`;
}

export default function StatsPage(){
  const [archive,setArchive]=useState<Archive|null>(null);
  const [schedule,setSchedule]=useState<ScheduleRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const [archiveRes,scheduleRes]=await Promise.all([
          fetch('/api/archive',{cache:'no-store'}),
          fetch('/api/schedule',{cache:'no-store'}),
        ]);
        const archiveData=await archiveRes.json() as Archive & {error?:string};
        const scheduleData=await scheduleRes.json() as ScheduleResponse;
        if(!archiveRes.ok)throw new Error(archiveData.error||'Archivio non disponibile.');
        if(!scheduleRes.ok)throw new Error(scheduleData.error||'Calendario non disponibile.');
        if(active){setArchive(archiveData);setSchedule(scheduleData.schedule??[]);}
      }catch(e){if(active)setError(e instanceof Error?e.message:'Statistiche non disponibili.');}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false};
  },[]);

  const stats=useMemo<TeamStat[]>(()=>{
    if(!archive)return [];
    const byRound=new Map<number,Snapshot[]>();
    for(const s of archive.snapshots){const list=byRound.get(s.round)??[];list.push(s);byRound.set(s.round,list);}
    for(const list of byRound.values())list.sort((a,b)=>a.observed_at.localeCompare(b.observed_at));
    const starts=new Map(schedule.filter(x=>x.start_at).map(x=>[x.round,Date.parse(x.start_at as string)]));

    return TEAM_NAMES.map(name=>{
      let observedRounds=0,finalMissing=0,firstObservedPresent=0,missingNearDeadline=0,samplesNearDeadline=0;
      const firstPresenceLead:number[]=[];
      for(const [round,readings] of byRound){
        if(!readings.length)continue;
        observedRounds++;
        const latest=readings[readings.length-1].teams.find(t=>t.name===name);
        if(latest&&!latest.present)finalMissing++;
        const firstPresent=readings.find(s=>s.teams.find(t=>t.name===name)?.present);
        if(firstPresent){
          firstObservedPresent++;
          const start=starts.get(round);
          if(start!=null)firstPresenceLead.push((start-Date.parse(firstPresent.observed_at))/60000);
        }
        const start=starts.get(round);
        if(start!=null){
          const target=start-15*60*1000;
          const candidate=readings.reduce<Snapshot|null>((best,s)=>{
            const delta=Math.abs(Date.parse(s.observed_at)-target);
            if(delta>10*60*1000)return best;
            return !best||delta<Math.abs(Date.parse(best.observed_at)-target)?s:best;
          },null);
          if(candidate){samplesNearDeadline++;if(!candidate.teams.find(t=>t.name===name)?.present)missingNearDeadline++;}
        }
      }
      return {name,observedRounds,finalMissing,firstObservedPresent,missingNearDeadline,samplesNearDeadline,avgFirstPresenceMinutes:firstPresenceLead.length?firstPresenceLead.reduce((a,b)=>a+b,0)/firstPresenceLead.length:null};
    });
  },[archive,schedule]);

  const latest=useMemo(()=>archive?latestByRound(archive.snapshots):new Map<number,Snapshot>(),[archive]);
  const monitoredRounds=latest.size;
  const totalReads=archive?.snapshots.length??0;
  const finalMissingEvents=stats.reduce((sum,s)=>sum+s.finalMissing,0);

  return <div className="app-shell">
    <header className="topbar"><a href="/" className="brand" aria-label="FANTAMONITOR home"><span className="brand-mark">FM</span>FANTAMONITOR</a><a href="/" className="btn"><ArrowLeft/>Dashboard</a></header>
    <main style={{maxWidth:1180,margin:'0 auto',padding:'24px 16px 48px'}}>
      <div className="page-heading"><div><div className="eyebrow">Stagione 2026 / 27</div><h1>Statistiche formazioni</h1><div className="sync-note"><BarChart3/>Metriche costruite sulle osservazioni archiviate da FANTAMONITOR</div></div></div>
      {loading&&<section className="panel"><p>Caricamento statistiche…</p></section>}
      {error&&<div role="alert" className="error-banner"><TriangleAlert size={20}/><span>{error}</span></div>}
      {!loading&&!error&&archive&&<>
        <section className="scoreboard" aria-label="Riepilogo statistico">
          <div className="score-main"><div className="score-label"><span className="eyebrow">Copertura dati</span></div><div className="score-number"><strong>{monitoredRounds}</strong><span>/ 35</span></div><p className="score-caption">giornate con almeno una osservazione</p></div>
          <div className="score-aside"><div className="aside-row"><BarChart3/><div><strong>{totalReads} letture archiviate</strong><p>Ogni lettura rappresenta uno stato osservato, non l’orario esatto di consegna.</p></div></div><div className="aside-row"><Clock3/><div><strong>{finalMissingEvents} assenze nell’ultima lettura</strong><p>Conteggio cumulativo squadra-giornata sull’ultima osservazione disponibile.</p></div></div></div>
        </section>
        <section className="panel" style={{marginTop:20,overflowX:'auto'}}>
          <div className="panel-head"><div><h2>Andamento per squadra</h2><small>La “prima presenza” indica la prima lettura in cui la formazione risulta presente; non coincide necessariamente con l’invio reale.</small></div></div>
          <table className="team-table" style={{width:'100%'}}>
            <thead><tr><th>Squadra</th><th>Giornate osservate</th><th>Assente ultima lettura</th><th>Presente alla prima lettura</th><th>Assente ~T-15m</th><th>Prima presenza osservata media</th></tr></thead>
            <tbody>{stats.map(s=><tr key={s.name}><td><strong>{s.name}</strong></td><td>{s.observedRounds}</td><td>{s.finalMissing}</td><td>{s.firstObservedPresent}/{s.observedRounds}</td><td>{s.samplesNearDeadline?`${s.missingNearDeadline}/${s.samplesNearDeadline}`:'—'}</td><td>{formatMinutes(s.avgFirstPresenceMinutes)}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="panel" style={{marginTop:20}}><h2>Interpretazione</h2><p>Le statistiche descrivono ciò che FANTAMONITOR ha osservato ai vari controlli. Quando una formazione compare per la prima volta tra due letture, il sistema può collocare solo l’intervallo in cui è diventata visibile, non il timestamp esatto dell’invio su Fantacalcio.</p></section>
      </>}
    </main>
  </div>;
}
