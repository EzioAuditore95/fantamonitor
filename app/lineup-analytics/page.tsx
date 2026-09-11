'use client';

import { useEffect,useMemo,useState } from 'react';
import { ArrowLeft,BarChart3,Repeat2,Users,Shirt,Layers3,TriangleAlert } from 'lucide-react';
import { TEAM_COLORS,TEAM_NAMES,initials,type Archive } from '@/lib/model';
import type { PerformancePayload } from '@/lib/performance';
import { computeLineupAnalytics } from '@/lib/lineup-analytics';
import styles from './page.module.css';

function pct(v:number|null){return v==null?'—':`${Math.round(v*100)}%`;}
function num(v:number|null,digits=1){return v==null?'—':new Intl.NumberFormat('it-IT',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(v);}
function Crest({name}:{name:string}){return <span className="crest" style={{backgroundColor:TEAM_COLORS[TEAM_NAMES.indexOf(name)]}}>{initials(name)}</span>}

export default function LineupAnalyticsPage(){
  const [archive,setArchive]=useState<Archive|null>(null),[performance,setPerformance]=useState<PerformancePayload|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let active=true;(async()=>{try{const [a,p]=await Promise.all([fetch('/api/archive',{cache:'no-store'}),fetch('/api/performance',{cache:'no-store'})]);const ad=await a.json() as Archive&{error?:string};const pd=await p.json() as PerformancePayload&{error?:string};if(!a.ok)throw new Error(ad.error||'Archivio non disponibile.');if(active){setArchive(ad);if(p.ok)setPerformance(pd);}}catch(e){if(active)setError(e instanceof Error?e.message:'Analisi non disponibili.');}finally{if(active)setLoading(false);}})();return()=>{active=false};},[]);
  const rows=useMemo(()=>archive?computeLineupAnalytics(archive,performance):[],[archive,performance]);
  const withData=rows.filter(r=>r.rounds>0);
  const mostStable=[...withData].filter(r=>r.continuity!=null).sort((a,b)=>(b.continuity??0)-(a.continuity??0))[0];
  const mostRotating=[...withData].filter(r=>r.avgChanges!=null).sort((a,b)=>(b.avgChanges??0)-(a.avgChanges??0))[0];
  const mostFlexible=[...withData].sort((a,b)=>b.moduleDiversity-a.moduleDiversity)[0];
  const deepest=[...withData].sort((a,b)=>b.uniqueStarters-a.uniqueStarters)[0];

  return <div className="app-shell"><header className="topbar"><a href="/" className="brand"><span className="brand-mark">FM</span>FANTAMONITOR</a><div style={{display:'flex',gap:8}}><a href="/stats" className="btn"><BarChart3/>Statistiche</a><a href="/" className="btn"><ArrowLeft/>Dashboard</a></div></header><main className={styles.main}>
    <div className="page-heading"><div><div className="eyebrow">Fase 3 · analisi formazioni</div><h1>Scelte & continuità</h1><div className="sync-note">Moduli, rotazioni e gerarchie ricavate dagli snapshot reali della lega</div></div></div>
    {loading&&<section className="panel"><p>Calcolo analisi…</p></section>}
    {error&&<div role="alert" className="error-banner"><TriangleAlert size={20}/><span>{error}</span></div>}
    {!loading&&!error&&<>
      {!withData.length?<section className="panel"><p>Non ci sono ancora abbastanza formazioni archiviate per calcolare le analisi.</p></section>:<>
        <section className={styles.heroGrid}>
          <article className={styles.heroCard}><Repeat2/><span>Più stabile</span><strong>{mostStable?.name??'—'}</strong><small>{pct(mostStable?.continuity??null)} di titolari confermati mediamente</small></article>
          <article className={styles.heroCard}><Users/><span>Più rotazioni</span><strong>{mostRotating?.name??'—'}</strong><small>{num(mostRotating?.avgChanges??null)} cambi medi a giornata</small></article>
          <article className={styles.heroCard}><Layers3/><span>Più flessibile</span><strong>{mostFlexible?.name??'—'}</strong><small>{mostFlexible?.moduleDiversity??0} moduli diversi</small></article>
          <article className={styles.heroCard}><Shirt/><span>Rosa più utilizzata</span><strong>{deepest?.name??'—'}</strong><small>{deepest?.uniqueStarters??0} giocatori schierati titolari</small></article>
        </section>
        <section className={styles.grid}>{withData.map(team=><article className={styles.teamCard} key={team.name}>
          <div className={styles.teamHead}><Crest name={team.name}/><div><strong>{team.name}</strong><span>{team.rounds} giornate con formazione leggibile</span></div></div>
          <div className={styles.metrics}><div><span>Modulo preferito</span><strong>{team.favoriteModule??'—'}</strong><small>{pct(team.favoriteModuleShare)} degli schieramenti</small></div><div><span>Continuità XI</span><strong>{pct(team.continuity)}</strong><small>{team.avgChanges==null?'—':`${num(team.avgChanges)} cambi medi`}</small></div><div><span>Titolari diversi</span><strong>{team.uniqueStarters}</strong><small>{team.moduleDiversity} moduli usati</small></div></div>
          <div className={styles.block}><span className={styles.kicker}>GERARCHIE</span>{team.topStarters.length?team.topStarters.map((p,i)=><div className={styles.playerRow} key={`${p.name}-${i}`}><span>{i+1}</span><strong>{p.name}</strong><small>{p.role??'—'} · {p.starts}/{team.rounds} titolarità</small></div>):<p className={styles.muted}>Dati giocatori non disponibili.</p>}</div>
          <div className={styles.block}><span className={styles.kicker}>MODULI</span>{team.modules.map(m=><div className={styles.moduleRow} key={m.module}><strong>{m.module}</strong><div><i style={{width:`${Math.max(4,m.share*100)}%`}}/></div><span>{m.uses}</span><small>{m.avgFantasy==null?'':`${num(m.avgFantasy)} FP medi`}</small></div>)}</div>
        </article>)}</section>
      </>}
      <section className={styles.note}><strong>Metriche non ancora disponibili</strong><p>Punti lasciati in panchina, scelta peggiore/migliore del singolo e rendimento dei panchinari richiedono i voti/fantapunti individuali dei calciatori. FANTAMONITOR non li stima finché non vengono acquisiti dalla fonte.</p></section>
    </>}
  </main></div>;
}
