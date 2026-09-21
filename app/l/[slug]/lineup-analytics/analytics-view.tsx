'use client';

import { useEffect,useMemo,useState } from 'react';
import { ArrowLeft,BarChart3,Repeat2,Users,Shirt,Layers3,TriangleAlert,UserRound } from 'lucide-react';
import { initials,type Archive } from '@/lib/model';
import { teamColor,teamNames,type LeagueConfig } from '@/lib/league';
import type { PerformancePayload } from '@/lib/performance';
import { computeLineupAnalytics } from '@/lib/lineup-analytics';
import { seasonPerformance } from '@/lib/lineup-performance';
import { scoringFor,type PlayerRound } from '@/lib/player-performance';
import styles from './page.module.css';

function pct(v:number|null){return v==null?'—':`${Math.round(v*100)}%`;}
function num(v:number|null,digits=1){return v==null?'—':new Intl.NumberFormat('it-IT',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(v);}
function Crest({cfg,name}:{cfg:LeagueConfig;name:string}){return <span className="crest" style={{backgroundColor:teamColor(cfg,name)}}>{initials(name)}</span>}

export default function AnalyticsView({config}:{config:LeagueConfig}){
  const cfg=config,base=`/l/${cfg.slug}`;
  const [archive,setArchive]=useState<Archive|null>(null),[performance,setPerformance]=useState<PerformancePayload|null>(null);
  const [grades,setGrades]=useState<{grades:Record<string,{player_id:number;state:PlayerRound['state'];grade:number|null;events:number[]}[]>;players:{id:number;role:string|null}[]}|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let active=true;(async()=>{try{const [a,p]=await Promise.all([fetch(`/api/archive?league=${encodeURIComponent(cfg.slug)}`,{cache:'no-store'}),fetch(`/api/performance?league=${encodeURIComponent(cfg.slug)}`,{cache:'no-store'})]);const ad=await a.json() as Archive&{error?:string};const pd=await p.json() as PerformancePayload&{error?:string};if(!a.ok)throw new Error(ad.error||'Archivio non disponibile.');if(active){setArchive(ad);if(p.ok)setPerformance(pd);
   const g=await fetch(`/api/players?league=${encodeURIComponent(cfg.slug)}`,{cache:'no-store'});
   if(g.ok&&active)setGrades(await g.json());}}catch(e){if(active)setError(e instanceof Error?e.message:'Analisi non disponibili.');}finally{if(active)setLoading(false);}})();return()=>{active=false};},[cfg.slug]);
  const rows=useMemo(()=>archive?computeLineupAnalytics(teamNames(cfg),archive,performance):[],[cfg,archive,performance]);
  // The grades are keyed by Serie A round; seasonPerformance is the only place that translates.
  const yields=useMemo(()=>{
    if(!archive||!grades)return null;
    const roles=new Map(grades.players.map(p=>[p.id,p.role]));
    const byRound=new Map<number,Map<number,PlayerRound>>();
    for(const [round,list] of Object.entries(grades.grades))byRound.set(Number(round),new Map(list.map(r=>
      [r.player_id,{player_id:r.player_id,round:Number(round),state:r.state,grade:r.grade,events:r.events,role:roles.get(r.player_id)??null}])));
    return seasonPerformance(cfg,teamNames(cfg),archive,byRound,performance,scoringFor(cfg)).season;
  },[cfg,archive,grades,performance]);
  const yieldFor=(team:string)=>yields?.find(y=>y.team===team)??null;
  const withData=rows.filter(r=>r.rounds>0);
  const mostStable=[...withData].filter(r=>r.continuity!=null).sort((a,b)=>(b.continuity??0)-(a.continuity??0))[0];
  const mostRotating=[...withData].filter(r=>r.avgChanges!=null).sort((a,b)=>(b.avgChanges??0)-(a.avgChanges??0))[0];
  const mostFlexible=[...withData].sort((a,b)=>b.moduleDiversity-a.moduleDiversity)[0];
  const deepest=[...withData].sort((a,b)=>b.uniqueStarters-a.uniqueStarters)[0];

  return <div className="app-shell"><header className="topbar"><a href={base} className="brand"><span className="brand-mark">FM</span>FANTAMONITOR</a><div style={{display:'flex',gap:8}}><a href={`${base}/players`} className="btn"><UserRound/>Calciatori</a><a href={`${base}/stats`} className="btn"><BarChart3/>Statistiche</a><a href={base} className="btn"><ArrowLeft/>Dashboard</a></div></header><main className={styles.main}>
    <div className="page-heading"><div><div className="eyebrow">{String(cfg.rules.season_label??cfg.season)}</div><h1>Scelte & continuità</h1><div className="sync-note">Moduli, rotazioni e gerarchie ricavate dagli snapshot reali della lega</div></div></div>
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
          <div className={styles.teamHead}><Crest cfg={cfg} name={team.name}/><div><strong>{team.name}</strong><span>{team.rounds} giornate con formazione leggibile</span></div></div>
          <div className={styles.metrics}><div><span>Modulo preferito</span><strong>{team.favoriteModule??'—'}</strong><small>{pct(team.favoriteModuleShare)} degli schieramenti</small></div><div><span>Continuità XI</span><strong>{pct(team.continuity)}</strong><small>{team.avgChanges==null?'—':`${num(team.avgChanges)} cambi medi`}</small></div><div><span>Titolari diversi</span><strong>{team.uniqueStarters}</strong><small>{team.moduleDiversity} moduli usati</small></div></div>
          <div className={styles.block}><span className={styles.kicker}>GERARCHIE</span>{team.topStarters.length?team.topStarters.map((p,i)=>{const y=yieldFor(team.name)?.topStarters.find(t=>t.name.toLowerCase()===p.name.toLowerCase());return <div className={styles.playerRow} key={`${p.name}-${i}`}><span>{i+1}</span><strong>{p.name}</strong><small>{p.role??'—'} · {p.starts}/{team.rounds} titolarità{y?` · ${num(y.average)} FP medi`:''}</small></div>}):<p className={styles.muted}>Dati giocatori non disponibili.</p>}</div>
          <div className={styles.block}><span className={styles.kicker}>MODULI</span>{team.modules.map(m=><div className={styles.moduleRow} key={m.module}><strong>{m.module}</strong><div><i style={{width:`${Math.max(4,m.share*100)}%`}}/></div><span>{m.uses}</span><small>{m.avgFantasy==null?'':`${num(m.avgFantasy)} FP medi`}</small></div>)}</div>
          {(()=>{const y=yieldFor(team.name);if(!y||!y.rounds)return null;return <div className={styles.block}><span className={styles.kicker}>PANCHINA</span>
            <div className={styles.metrics}><div><span>Punti schierati</span><strong>{num(y.fieldedPoints,1)}</strong><small>{num(y.averageFielded,1)} a giornata</small></div><div><span>Rimasti in panchina</span><strong>{num(y.benchPoints,1)}</strong><small>su {y.rounds} giornate</small></div><div><span>Senza voto</span><strong>{y.unrated}</strong><small>titolari non votati</small></div></div>
            {y.regrets.length?y.regrets.slice(0,3).map(r=><div className={styles.playerRow} key={`${r.round}-${r.name}`}><span><UserRound size={12}/></span><strong>{r.name}</strong><small>{r.round}ª · {num(r.points,1)} FP in panchina · +{num(r.gap,1)} sul peggiore in campo</small></div>):<p className={styles.muted}>Nessuna panchina ha reso più di chi ha giocato.</p>}
          </div>})()}
        </article>)}</section>
      </>}
      <section className={styles.note}>{yields
        ?<><strong>Da dove vengono questi numeri</strong><p>I fantapunti sono calcolati sui voti pubblicati da Fantacalcio per ogni calciatore schierato, con le regole di questa lega. Il totale ufficiale di una giornata resta quello della lega: le sostituzioni automatiche non vengono simulate. <a href={`${base}/players`}>Scheda dei calciatori →</a></p></>
        :<><strong>Voti dei calciatori non ancora disponibili</strong><p>Punti lasciati in panchina e rendimento dei singoli compaiono quando le giornate di Serie A sono state importate. FANTAMONITOR non li stima.</p></>}</section>
    </>}
  </main></div>;
}
