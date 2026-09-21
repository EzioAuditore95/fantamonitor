'use client';

import { useEffect,useMemo,useState } from 'react';
import { ArrowLeft,BarChart3,Crown,Repeat2,Star,TriangleAlert,UserRound } from 'lucide-react';
import { Sheet,SheetContent } from '@/components/ui/sheet';
import { type Archive } from '@/lib/model';
import { teamColor,type LeagueConfig } from '@/lib/league';
import { fantasyPoints,scoringFor,totalsFor,type PlayerRound } from '@/lib/player-performance';
import { SERIE_A_CHAMPIONSHIP } from '@/lib/serie-a-events';
import styles from './page.module.css';

type GradeRow={player_id:number;state:PlayerRound['state'];grade:number|null;events:number[]};
type Payload={season:string;rounds:number[];players:{id:number;role:string|null}[];grades:Record<string,GradeRow[]>;error?:string};
type Identity={id:number;name:string;team:string;starts:number;benched:number};

const num=(v:number|null,digits=2)=>v==null?'—':new Intl.NumberFormat('it-IT',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(v);
const ROLE_LABEL:Record<string,string>={P:'Portiere',D:'Difensore',C:'Centrocampista',A:'Attaccante'};
// The championship's own artwork, indexed by the same player id everything else here is keyed by.
const face=(id:number)=>`https://content.fantacalcio.it/web/campioncini/${SERIE_A_CHAMPIONSHIP}/card/${id}.png`;

export default function PlayersView({config}:{config:LeagueConfig}){
  const cfg=config,base=`/l/${cfg.slug}`,scoring=useMemo(()=>scoringFor(cfg),[cfg]);
  const [archive,setArchive]=useState<Archive|null>(null),[payload,setPayload]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[open,setOpen]=useState<number|null>(null);
  const [role,setRole]=useState('all');
  useEffect(()=>{let active=true;(async()=>{
    try{
      const [a,p]=await Promise.all([fetch(`/api/archive?league=${encodeURIComponent(cfg.slug)}`,{cache:'no-store'}),
        fetch(`/api/players?league=${encodeURIComponent(cfg.slug)}`,{cache:'no-store'})]);
      const ad=await a.json() as Archive&{error?:string},pd=await p.json() as Payload;
      if(!a.ok)throw new Error(ad.error||'Archivio non disponibile.');
      if(!p.ok)throw new Error(pd.error||'Voti non disponibili.');
      if(active){setArchive(ad);setPayload(pd);}
    }catch(e){if(active)setError(e instanceof Error?e.message:'Dati non disponibili.');}
    finally{if(active)setLoading(false);}
  })();return()=>{active=false};},[cfg.slug]);

  // Names and colours come from the lineups we archived, the grades from the championship: the
  // identity of a player in this league is whose shirt he wore, and only the archive knows that.
  const identities=useMemo(()=>{
    const map=new Map<number,Identity>();
    if(!archive)return map;
    const latest=new Map<number,Archive['snapshots'][number]>();
    for(const s of [...archive.snapshots].sort((a,b)=>a.observed_at.localeCompare(b.observed_at)))latest.set(s.round,s);
    for(const snapshot of latest.values())for(const team of snapshot.teams){
      const formation=team.formation;if(!formation?.starters?.length)continue;
      const add=(list:{id?:string|number;name:string}[]|undefined,field:'starts'|'benched')=>{
        for(const player of list??[]){
          const id=Number(player.id);if(!Number.isInteger(id)||id<=0)continue;
          const current=map.get(id)??{id,name:player.name,team:team.name,starts:0,benched:0};
          current[field]++;current.name=player.name;current.team=team.name;map.set(id,current);
        }
      };
      add(formation.starters,'starts');add(formation.bench,'benched');
    }
    return map;
  },[archive]);

  const roles=useMemo(()=>new Map((payload?.players??[]).map(p=>[p.id,p.role])),[payload]);
  const rows=useMemo(()=>{
    const out:PlayerRound[]=[];
    for(const [round,list] of Object.entries(payload?.grades??{}))for(const row of list)
      out.push({player_id:row.player_id,round:Number(round),state:row.state,grade:row.grade,events:row.events,role:roles.get(row.player_id)??null});
    return out;
  },[payload,roles]);
  const totals=useMemo(()=>totalsFor(rows,scoring).map(t=>({...t,identity:identities.get(t.player_id)}))
    .filter(t=>t.identity).sort((a,b)=>b.points-a.points),[rows,scoring,identities]);
  const visible=totals.filter(t=>role==='all'||roles.get(t.player_id)===role);
  const best=totals[0],bestAverage=[...totals].filter(t=>t.appearances>=2).sort((a,b)=>(b.fantasyGrade??0)-(a.fantasyGrade??0))[0];
  const mostUsed=[...totals].sort((a,b)=>(b.identity!.starts)-(a.identity!.starts))[0];
  const detail=open==null?null:totals.find(t=>t.player_id===open);
  const detailRounds=open==null?[]:rows.filter(r=>r.player_id===open).sort((a,b)=>a.round-b.round);

  return <div className="app-shell">
    <header className="topbar"><a href={base} className="brand"><span className="brand-mark">FM</span>FANTAMONITOR</a>
      <div style={{display:'flex',gap:8}}><a href={`${base}/stats`} className="btn"><BarChart3/>Statistiche</a><a href={base} className="btn"><ArrowLeft/>Dashboard</a></div></header>
    <main className={styles.main}>
      <div className="page-heading"><div><div className="eyebrow">{String(cfg.rules.season_label??cfg.season)}</div><h1>Calciatori</h1>
        <div className="sync-note">Voti e fantapunti dei calciatori schierati in questa lega, giornata per giornata</div></div></div>
      {loading&&<section className="panel"><p>Caricamento voti…</p></section>}
      {error&&<div role="alert" className="error-banner"><TriangleAlert size={20}/><span>{error}</span></div>}
      {!loading&&!error&&(!totals.length
        ?<section className="panel"><p>Nessun voto ancora disponibile: servono formazioni archiviate e almeno una giornata di Serie A importata.</p></section>
        :<>
        <section className={styles.heroGrid}>
          <article className={styles.heroCard}><Star/><span>Più fantapunti</span><strong>{best?.identity?.name??'—'}</strong><small>{num(best?.points??null,1)} punti · {best?.identity?.team}</small></article>
          <article className={styles.heroCard}><Crown/><span>Miglior fantamedia</span><strong>{bestAverage?.identity?.name??'—'}</strong><small>{num(bestAverage?.fantasyGrade??null)} su {bestAverage?.appearances} presenze</small></article>
          <article className={styles.heroCard}><Repeat2/><span>Più schierato</span><strong>{mostUsed?.identity?.name??'—'}</strong><small>{mostUsed?.identity?.starts} titolarità</small></article>
          <article className={styles.heroCard}><UserRound/><span>Calciatori letti</span><strong>{totals.length}</strong><small>su {payload?.rounds.length??0} giornate di lega</small></article>
        </section>
        <section className={styles.filters} role="group" aria-label="Filtro per ruolo">
          {[['all','Tutti'],['P','Portieri'],['D','Difensori'],['C','Centrocampisti'],['A','Attaccanti']].map(([key,label])=>
            <button key={key} type="button" className={`${styles.filter} ${role===key?styles.filterOn:''}`} aria-pressed={role===key} onClick={()=>setRole(key)}>{label}</button>)}
        </section>
        <section className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Calciatore</th><th>Squadra</th><th>Pres.</th><th>MV</th><th>FM</th><th>Punti</th><th>Andamento</th></tr></thead>
            <tbody>{visible.map(player=>{
              const series=rows.filter(r=>r.player_id===player.player_id).sort((a,b)=>a.round-b.round);
              const max=Math.max(...series.map(r=>fantasyPoints(r,scoring)??0),1);
              return <tr key={player.player_id} onClick={()=>setOpen(player.player_id)} tabIndex={0}
                onKeyDown={e=>{if(e.key==='Enter')setOpen(player.player_id)}} className={styles.row}>
                <td><div className={styles.player}><img src={face(player.player_id)} alt="" loading="lazy" onError={e=>{e.currentTarget.style.visibility='hidden'}}/>
                  <div><strong>{player.identity!.name}</strong><small>{ROLE_LABEL[roles.get(player.player_id)??'']??'—'}</small></div></div></td>
                <td><span className={styles.team}><i style={{backgroundColor:teamColor(cfg,player.identity!.team)}}/>{player.identity!.team}</span></td>
                <td>{player.appearances}</td><td>{num(player.grade)}</td><td>{num(player.fantasyGrade)}</td>
                <td><strong>{num(player.points,1)}</strong></td>
                <td><div className={styles.spark}>{series.map(r=>{const p=fantasyPoints(r,scoring);
                  return <i key={r.round} title={`Giornata ${r.round}: ${p==null?'senza voto':num(p,1)}`}
                    className={p==null?styles.sparkEmpty:''} style={{height:`${Math.max(3,((p??0)/max)*26)}px`}}/>})}</div></td>
              </tr>})}</tbody>
          </table>
        </section>
      </>)}
    </main>
    <Sheet open={open!=null} onOpenChange={o=>{if(!o)setOpen(null)}}>
      <SheetContent side="right" className={styles.sheet}>
        {detail&&<>
          <div className={styles.sheetHead}><img src={face(detail.player_id)} alt="" onError={e=>{e.currentTarget.style.visibility='hidden'}}/>
            <div><strong>{detail.identity!.name}</strong><span>{ROLE_LABEL[roles.get(detail.player_id)??'']??'—'} · {detail.identity!.team}</span></div></div>
          <div className={styles.sheetStats}>
            <div><span>Presenze</span><strong>{detail.appearances}</strong></div>
            <div><span>Media voto</span><strong>{num(detail.grade)}</strong></div>
            <div><span>Fantamedia</span><strong>{num(detail.fantasyGrade)}</strong></div>
            <div><span>Fantapunti</span><strong>{num(detail.points,1)}</strong></div>
          </div>
          <div className={styles.sheetStats}>
            <div><span>Gol</span><strong>{detail.goals}</strong></div><div><span>Assist</span><strong>{detail.assists}</strong></div>
            <div><span>Ammonizioni</span><strong>{detail.yellow}</strong></div><div><span>Espulsioni</span><strong>{detail.red}</strong></div>
          </div>
          <table className={styles.sheetTable}>
            <thead><tr><th>Giornata</th><th>Voto</th><th>Bonus</th><th>Fantavoto</th></tr></thead>
            <tbody>{detailRounds.map(entry=>{
              const points=fantasyPoints(entry,scoring);
              const bonus=points==null||entry.grade==null?null:Math.round((points-entry.grade)*100)/100;
              return <tr key={entry.round}><td>{entry.round-cfg.serieAOffset}ª</td>
                <td>{entry.state==='graded'?num(entry.grade,1):entry.state==='no_vote'?'s.v.':'—'}</td>
                <td>{bonus==null?'—':`${bonus>0?'+':''}${num(bonus,1)}`}</td>
                <td><strong>{points==null?'—':num(points,1)}</strong></td></tr>})}</tbody>
          </table>
          <p className={styles.sheetNote}>Le giornate sono quelle della lega; i voti sono della redazione Fantacalcio.</p>
        </>}
      </SheetContent>
    </Sheet>
  </div>;
}
