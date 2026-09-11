'use client';

import { useEffect,useMemo,useState } from 'react';
import { CalendarDays,Clock3,Trophy,TriangleAlert } from 'lucide-react';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import styles from './competition-panel.module.css';

type Match={homeId:number;awayId:number;home:string;away:string;homeFantasy:number|null;awayFantasy:number|null;homeStandingPoints:number|null;awayStandingPoints:number|null;homeGoals:number|null;awayGoals:number|null;result:string|null;resultSR:string|null};
type Round={round:number;championshipRound:number;calculated:boolean;matches:Match[]};
type Standing={name:string;played:number;wins:number;draws:number;losses:number;goalsFor:number;goalsAgainst:number;points:number;fantasyTotal:number};
type Payload={source:string;fetchedAt:string;calendar:Round[];standings:Standing[];warnings:string[];error?:string};

export default function CompetitionPanel(){
  const [data,setData]=useState<Payload|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[round,setRound]=useState('1');
  useEffect(()=>{let active=true;(async()=>{try{const res=await fetch('/api/performance',{cache:'no-store'});const body=await res.json() as Payload;if(!res.ok)throw new Error(body.error||'Dati competitivi non disponibili.');if(!active)return;setData(body);const calculated=body.calendar.filter(x=>x.calculated);const next=body.calendar.find(x=>!x.calculated);setRound(String(next?.round??calculated.at(-1)?.round??1));}catch(e){if(active)setError(e instanceof Error?e.message:'Dati competitivi non disponibili.');}finally{if(active)setLoading(false);}})();return()=>{active=false};},[]);
  const current=useMemo(()=>data?.calendar.find(x=>x.round===Number(round)),[data,round]);
  const calculated=data?.calendar.filter(x=>x.calculated).length??0;
  const hasStandings=(data?.standings??[]).some(x=>x.played>0);
  if(loading)return <section className="panel"><p>Caricamento calendario ufficiale…</p></section>;
  if(error)return <div className="error-banner"><TriangleAlert size={20}/><span>{error}</span></div>;
  if(!data)return null;
  return <>
    <div className="page-heading"><div><div className="eyebrow">CheFantaVitaE10 · Classic</div><h1>Competizione Serie A</h1><div className="sync-note"><Clock3/>Aggiornato {new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'}).format(new Date(data.fetchedAt))}</div></div><Trophy size={35} className="muted"/></div>
    <div className={styles.metrics}><div className={styles.metric}><strong>10</strong><span>Squadre</span></div><div className={styles.metric}><strong>35</strong><span>Giornate</span></div><div className={styles.metric}><strong>{calculated}</strong><span>Calcolate</span></div></div>
    <section className={`panel ${styles.roundPanel}`}><div className={styles.roundHead}><div><span className="eyebrow">Calendario ufficiale</span><h2>Giornata {current?.round??round}</h2>{current&&<p>Serie A · giornata {current.championshipRound}</p>}</div><Select value={round} onValueChange={setRound}><SelectTrigger className={styles.selector}><SelectValue/></SelectTrigger><SelectContent>{data.calendar.map(r=><SelectItem key={r.round} value={String(r.round)}>Giornata {r.round}</SelectItem>)}</SelectContent></Select></div>
      <div className={styles.matches}>{current?.matches.map((m,i)=><article className={styles.match} key={`${m.homeId}-${m.awayId}-${i}`}><div className={styles.team}><strong>{m.home}</strong>{current.calculated&&m.homeFantasy!=null?<span>{m.homeFantasy.toFixed(1)} FP</span>:null}</div><div className={styles.score}>{current.calculated&&m.homeGoals!=null&&m.awayGoals!=null?<><strong>{m.homeGoals}–{m.awayGoals}</strong><small>Finale</small></>:<><strong>VS</strong><small>Da giocare</small></>}</div><div className={`${styles.team} ${styles.away}`}><strong>{m.away}</strong>{current.calculated&&m.awayFantasy!=null?<span>{m.awayFantasy.toFixed(1)} FP</span>:null}</div></article>)}</div>
    </section>
    <section className={`panel ${styles.standings}`}><div className="panel-head"><div><span className="eyebrow">Classifica</span><h2>Andamento lega</h2></div><CalendarDays size={20}/></div>{hasStandings?<div className={styles.tableWrap}><table><thead><tr><th>#</th><th>Squadra</th><th>G</th><th>V</th><th>N</th><th>P</th><th>GF</th><th>GS</th><th>Pt</th><th>FP</th></tr></thead><tbody>{data.standings.map((t,i)=><tr key={t.name}><td>{i+1}</td><td><strong>{t.name}</strong></td><td>{t.played}</td><td>{t.wins}</td><td>{t.draws}</td><td>{t.losses}</td><td>{t.goalsFor}</td><td>{t.goalsAgainst}</td><td><strong>{t.points}</strong></td><td>{t.fantasyTotal.toFixed(1)}</td></tr>)}</tbody></table></div>:<div className={styles.empty}><Trophy/><strong>Classifica non ancora avviata</strong><p>Il calendario è già sincronizzato. La classifica comparirà automaticamente dopo il primo calcolo ufficiale della lega.</p></div>}</section>
    {data.warnings.map((w,i)=><p className="footnote" key={i}>{w}</p>)}
  </>;
}
