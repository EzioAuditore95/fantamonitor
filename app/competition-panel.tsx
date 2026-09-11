'use client';

import { useEffect,useMemo,useState } from 'react';
import { CalendarDays,Clock3,Crown,Flag,Medal,Trophy,TriangleAlert } from 'lucide-react';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { TEAM_NAMES,type Archive } from '@/lib/model';
import { balances } from '@/lib/penalties';
import styles from './competition-panel.module.css';

type Match={homeId:number;awayId:number;home:string;away:string;homeFantasy:number|null;awayFantasy:number|null;homeStandingPoints:number|null;awayStandingPoints:number|null;homeGoals:number|null;awayGoals:number|null;result:string|null;resultSR:string|null};
type Round={round:number;championshipRound:number;calculated:boolean;matches:Match[]};
type Standing={name:string;played:number;wins:number;draws:number;losses:number;goalsFor:number;goalsAgainst:number;points:number;fantasyTotal:number};
type Payload={source:string;fetchedAt:string;calendar:Round[];standings:Standing[];warnings:string[];error?:string};

const FIRST_HALF_END=16;
const FORMULA_ONE_BASE=70;

function standingsThrough(calendar:Round[],throughRound:number):Standing[]{
  const rows=new Map<string,Standing>(TEAM_NAMES.map(name=>[name,{name,played:0,wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,points:0,fantasyTotal:0}]));
  for(const round of calendar){
    if(round.round>throughRound||!round.calculated)continue;
    for(const m of round.matches){
      const h=rows.get(m.home),a=rows.get(m.away);if(!h||!a)continue;
      h.played++;a.played++;
      h.points+=m.homeStandingPoints??0;a.points+=m.awayStandingPoints??0;
      h.fantasyTotal+=m.homeFantasy??0;a.fantasyTotal+=m.awayFantasy??0;
      if(m.homeGoals!=null&&m.awayGoals!=null){
        h.goalsFor+=m.homeGoals;h.goalsAgainst+=m.awayGoals;a.goalsFor+=m.awayGoals;a.goalsAgainst+=m.homeGoals;
        if(m.homeGoals>m.awayGoals){h.wins++;a.losses++;}else if(m.homeGoals<m.awayGoals){a.wins++;h.losses++;}else{h.draws++;a.draws++;}
      }
    }
  }
  return [...rows.values()].sort((a,b)=>b.points-a.points||(b.goalsFor-b.goalsAgainst)-(a.goalsFor-a.goalsAgainst)||b.fantasyTotal-a.fantasyTotal);
}

export default function CompetitionPanel(){
  const [data,setData]=useState<Payload|null>(null),[archive,setArchive]=useState<Archive|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[round,setRound]=useState('1');
  useEffect(()=>{let active=true;(async()=>{try{const [res,archiveRes]=await Promise.all([fetch('/api/performance',{cache:'no-store'}),fetch('/api/archive',{cache:'no-store'})]);const body=await res.json() as Payload;const archiveBody=await archiveRes.json() as Archive;if(!res.ok)throw new Error(body.error||'Dati competitivi non disponibili.');if(!active)return;setData(body);if(archiveRes.ok)setArchive(archiveBody);const calculated=body.calendar.filter(x=>x.calculated);const next=body.calendar.find(x=>!x.calculated);setRound(String(next?.round??calculated.at(-1)?.round??1));}catch(e){if(active)setError(e instanceof Error?e.message:'Dati competitivi non disponibili.');}finally{if(active)setLoading(false);}})();return()=>{active=false};},[]);
  const current=useMemo(()=>data?.calendar.find(x=>x.round===Number(round)),[data,round]);
  const calculated=data?.calendar.filter(x=>x.calculated).length??0;
  const hasStandings=(data?.standings??[]).some(x=>x.played>0);
  const firstHalfCalculated=data?.calendar.filter(x=>x.round<=FIRST_HALF_END&&x.calculated).length??0;
  const qualificationLocked=firstHalfCalculated>=FIRST_HALF_END;
  const euroStanding=useMemo(()=>data?standingsThrough(data.calendar,FIRST_HALF_END):[],[data]);
  const champions=euroStanding.slice(0,5),europa=euroStanding.slice(5,10);
  const trackedFines=archive?balances([...TEAM_NAMES],'complessivo',archive.reviews??[]).reduce((sum,x)=>sum+x.penalty,0):0;
  const formulaOnePot=FORMULA_ONE_BASE+trackedFines;
  if(loading)return <section className="panel"><p>Caricamento calendario ufficiale…</p></section>;
  if(error)return <div className="error-banner"><TriangleAlert size={20}/><span>{error}</span></div>;
  if(!data)return null;
  return <>
    <div className="page-heading"><div><div className="eyebrow">CheFantaVitaE10 · Competizioni</div><h1>Competizioni della lega</h1><div className="sync-note"><Clock3/>Aggiornato {new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'}).format(new Date(data.fetchedAt))}</div></div><Trophy size={35} className="muted"/></div>
    <div className={styles.competitionNav} aria-label="Competizioni attive"><div className={`${styles.competitionCard} ${styles.activeCompetition}`}><Trophy/><div><strong>Campionato</strong><span>Competizione principale</span></div></div><div className={styles.competitionCard}><Crown/><div><strong>Coppe Europee</strong><span>Champions + Europa League</span></div></div><div className={styles.competitionCard}><Flag/><div><strong>Formula 1</strong><span>Late season · eliminazione</span></div></div></div>
    <div className={styles.metrics}><div className={styles.metric}><strong>10</strong><span>Squadre</span></div><div className={styles.metric}><strong>35</strong><span>Giornate</span></div><div className={styles.metric}><strong>{calculated}</strong><span>Calcolate</span></div></div>
    <section className={`panel ${styles.roundPanel}`}><div className={styles.roundHead}><div><span className="eyebrow">Campionato · calendario ufficiale</span><h2>Giornata {current?.round??round}</h2>{current&&<p>Serie A · giornata {current.championshipRound}</p>}</div><Select value={round} onValueChange={setRound}><SelectTrigger className={styles.selector}><SelectValue/></SelectTrigger><SelectContent>{data.calendar.map(r=><SelectItem key={r.round} value={String(r.round)}>Giornata {r.round}</SelectItem>)}</SelectContent></Select></div>
      <div className={styles.matches}>{current?.matches.map((m,i)=><article className={styles.match} key={`${m.homeId}-${m.awayId}-${i}`}><div className={styles.team}><strong>{m.home}</strong>{current.calculated&&m.homeFantasy!=null?<span>{m.homeFantasy.toFixed(1)} FP</span>:null}</div><div className={styles.score}>{current.calculated&&m.homeGoals!=null&&m.awayGoals!=null?<><strong>{m.homeGoals}–{m.awayGoals}</strong><small>Finale</small></>:<><strong>VS</strong><small>Da giocare</small></>}</div><div className={`${styles.team} ${styles.away}`}><strong>{m.away}</strong>{current.calculated&&m.awayFantasy!=null?<span>{m.awayFantasy.toFixed(1)} FP</span>:null}</div></article>)}</div>
    </section>
    <section className={`panel ${styles.standings}`}><div className="panel-head"><div><span className="eyebrow">Campionato</span><h2>Classifica</h2></div><CalendarDays size={20}/></div>{hasStandings?<div className={styles.tableWrap}><table><thead><tr><th>#</th><th>Squadra</th><th>G</th><th>V</th><th>N</th><th>P</th><th>GF</th><th>GS</th><th>Pt</th><th>FP</th></tr></thead><tbody>{data.standings.map((t,i)=><tr key={t.name}><td>{i+1}</td><td><strong>{t.name}</strong></td><td>{t.played}</td><td>{t.wins}</td><td>{t.draws}</td><td>{t.losses}</td><td>{t.goalsFor}</td><td>{t.goalsAgainst}</td><td><strong>{t.points}</strong></td><td>{t.fantasyTotal.toFixed(1)}</td></tr>)}</tbody></table></div>:<div className={styles.empty}><Trophy/><strong>Classifica non ancora avviata</strong><p>Il calendario è già sincronizzato. La classifica comparirà automaticamente dopo il primo calcolo ufficiale della lega.</p></div>}</section>

    <section className={`panel ${styles.europePanel}`}><div className={styles.sectionTitle}><div><span className="eyebrow">Coppe Europee</span><h2>{qualificationLocked?'Qualificate definite':'Proiezione qualificazione'}</h2><p>La qualificazione viene determinata dalla classifica del Campionato al termine della giornata {FIRST_HALF_END}, ultima giornata del girone di andata.</p></div><Medal size={22}/></div>
      {!euroStanding.some(t=>t.played)?<div className={styles.empty}><Crown/><strong>Qualificazione non ancora disponibile</strong><p>Le posizioni europee compariranno non appena il Campionato avrà risultati calcolati.</p></div>:<div className={styles.europeGrid}>
        <div className={styles.euroLeague}><div className={styles.euroHead}><Crown/><div><strong>Champions</strong><span>Prime 5 del Campionato</span></div></div>{champions.map((t,i)=><div className={styles.qualifier} key={t.name}><span>{i+1}</span><strong>{t.name}</strong><small>{t.points} pt</small></div>)}</div>
        <div className={styles.euroLeague}><div className={styles.euroHead}><Trophy/><div><strong>Europa League</strong><span>Ultime 5 del Campionato</span></div></div>{europa.map((t,i)=><div className={styles.qualifier} key={t.name}><span>{i+6}</span><strong>{t.name}</strong><small>{t.points} pt</small></div>)}</div>
      </div>}
      <div className={styles.lockNote}>{qualificationLocked?'Classifica qualificazione congelata alla fine del girone di andata.':`${firstHalfCalculated}/${FIRST_HALF_END} giornate dell’andata calcolate · graduatoria provvisoria.`}</div>
    </section>

    <section className={`panel ${styles.formulaPanel}`}><div className={styles.sectionTitle}><div><span className="eyebrow">Formula 1</span><h2>Competizione a eliminazione</h2><p>Competizione prevista nella parte finale del Campionato. Il regolamento disponibile non definisce ancora il meccanismo preciso di eliminazione.</p></div><Flag size={22}/></div><div className={styles.formulaMetrics}><div><span>Montepremi base</span><strong>70 €</strong></div><div><span>Multe formazione tracciate</span><strong>{trackedFines} €</strong></div><div><span>Montepremi monitorato</span><strong>{formulaOnePot} €</strong></div></div><p className={styles.formulaNote}>Il totale mostra 70 € + le penalità economiche per formazioni non inserite registrate in FANTAMONITOR. Eventuali altre multe della lega non presenti nell’archivio non vengono stimate.</p></section>
    {data.warnings.map((w,i)=><p className="footnote" key={i}>{w}</p>)}
  </>;
}
