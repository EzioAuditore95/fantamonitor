'use client';
import { useEffect,useMemo,useState } from 'react';
import { CheckCircle2,ChevronRight,Clock3,Coins,Flame,Info,Snowflake,Star,Swords,TrendingUp,Trophy,TriangleAlert,UserRound } from 'lucide-react';
import Crest from './crest';
import { useRoundSchedule } from './round-schedule-provider';
import { usePlayerGrades } from './use-player-grades';
import { displayDate,type Archive } from '@/lib/model';
import { periodForRound,teamNames,type LeagueConfig } from '@/lib/league';
import { euro,teamBalance } from '@/lib/penalties';
import { computePerformance,type TeamPerformance } from '@/lib/performance';
import { formatKickoff,formatRemainingCoarse,kickoffFor } from '@/lib/round-schedule';
import { readStoredTeam,storedTeamKey } from '@/lib/stored-team';
import { characterOf,competitionFrom,fixtureFor,hasResults,headToHead,lineupStateFor,missingLineups,outcomeOf,roundFor,roundHighlights,standingFor } from '@/lib/home-view';
import { MIN_ROUNDS_FOR_PROBABILITY,roundedSplit,winProbability } from '@/lib/win-probability';
import { gradesByRound,rosterOf,topFantasyAverages,type TopPlayer } from '@/lib/home-players';
import { seasonPerformance } from '@/lib/lineup-performance';
import styles from './home-panel.module.css';

const HOUR=3_600_000;
const fp=(value:number|null)=>value==null?'—':value.toFixed(1);

function LineupBadge({present,label}:{present:boolean|undefined;label:string}){
  const tone=present===undefined?styles.stateUnknown:present?styles.stateOk:styles.stateWait;
  const Icon=present===undefined?Info:present?CheckCircle2:Clock3;
  return <span className={`${styles.state} ${tone}`}><Icon size={15}/><span className={styles.stateWho}>{label}</span>
    <strong>{present===undefined?'nessuna lettura':present?'inserita':'non inserita'}</strong></span>;
}

function TopThree({title,players,loading}:{title:string;players:TopPlayer[];loading:boolean}){
  return <div className={styles.topSide}>
    <span className={styles.topTitle}>{title}</span>
    {players.length
      ?players.map(p=><span key={p.id} className={styles.topRow}>
        <small>{p.role??'—'}</small><span className={styles.topName}>{p.name}</span><strong>{p.fantasyGrade.toFixed(2)}</strong>
      </span>)
      :<span className={styles.topEmpty}>{loading?'…':'dati non disponibili'}</span>}
  </div>;
}

export default function HomePanel({config,data,round,now,onNavigate,base}:{
  config:LeagueConfig;data:Archive|null;round:number;now:number;onNavigate:(view:string)=>void;base:string;
}){
  const cfg=config,TEAM_NAMES=useMemo(()=>teamNames(cfg),[cfg]);
  // undefined until localStorage has been read: rendering the picker before that would make
  // it blink for everyone who has already chosen.
  const [team,setTeam]=useState<string|null|undefined>(undefined);
  useEffect(()=>{
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try{setTeam(readStoredTeam(cfg,window.localStorage.getItem(storedTeamKey(cfg.slug))))}catch{setTeam(null)}
  },[cfg]);
  const choose=(name:string|null)=>{
    setTeam(name);
    // A private window, or site data turned off, throws here. The choice still holds for
    // this visit: it is a convenience, not state the page depends on.
    try{if(name)window.localStorage.setItem(storedTeamKey(cfg.slug),name);else window.localStorage.removeItem(storedTeamKey(cfg.slug))}catch{}
  };

  const {rows:schedule}=useRoundSchedule();
  const snapshots=useMemo(()=>data?.snapshots??[],[data]);
  const competition=useMemo(()=>competitionFrom(snapshots),[snapshots]);
  const current=useMemo(()=>{
    const sorted=snapshots.filter(s=>s.round===round).sort((a,b)=>a.observed_at.localeCompare(b.observed_at));
    return sorted[sorted.length-1];
  },[snapshots,round]);
  const performance=useMemo(()=>competition?computePerformance(TEAM_NAMES,competition):[],[TEAM_NAMES,competition]);
  const perfOf=(name:string|null)=>performance.find((t:TeamPerformance)=>t.name===name)??null;

  const fixture=useMemo(()=>fixtureFor(competition,round,team??null),[competition,round,team]);
  const entry=roundFor(competition,round);
  const outcome=outcomeOf(fixture);
  const kickoff=kickoffFor(schedule,round)?.start_at??null;
  const toKickoff=kickoff?Date.parse(kickoff)-now:null;
  const missing=missingLineups(current);
  const mine=lineupStateFor(current,team??null);
  const theirs=lineupStateFor(current,fixture?.opponent??null);
  const stale=current&&now-Date.parse(current.observed_at)>15*60*1000;

  const myPerf=perfOf(team??null),oppPerf=perfOf(fixture?.opponent??null);
  const odds=myPerf&&oppPerf?winProbability(myPerf,oppPerf,performance):null;
  const split=odds?roundedSplit(odds):null;
  const standing=standingFor(competition,team??null);
  const h2h=headToHead(competition,team??null,fixture?.opponent??null);
  const highlights=roundHighlights(competition,round);
  const character=characterOf(performance,team??null);

  // Deferred, fetched once: see use-player-grades. Everything below renders without it.
  const {grades,loading:gradesLoading}=usePlayerGrades(cfg.slug);
  const opponent=fixture?.opponent??null;
  const myTop=useMemo(()=>topFantasyAverages(rosterOf(snapshots,team??null),grades),[snapshots,team,grades]);
  const oppTop=useMemo(()=>topFantasyAverages(rosterOf(snapshots,opponent),grades),[snapshots,opponent,grades]);
  const bench=useMemo(()=>{
    if(!grades||!team||!data)return null;
    return seasonPerformance(cfg,[team],data,gradesByRound(grades),competition).season[0]??null;
  },[cfg,team,data,grades,competition]);
  const tokens=team?teamBalance(cfg,team,periodForRound(cfg,round).key,data?.reviews??[]):null;

  const urgency=!current?styles.urgencyCalm
    :!missing.length?styles.urgencyCalm
    :toKickoff!=null&&toKickoff<2*HOUR?styles.urgencyLate
    :toKickoff!=null&&toKickoff<24*HOUR?styles.urgencyWarn:styles.urgencyCalm;

  return <div className={styles.home}>
    {team===undefined?null:team===null
      ?<section className={styles.picker}>
        <span className={styles.eyebrow}>{cfg.name}</span>
        <h1>Quale squadra è la tua?</h1>
        <p>Serve solo a te: la scelta resta su questo dispositivo e non viene condivisa con la lega.</p>
        <div className={styles.pickerGrid}>{TEAM_NAMES.map(name=>
          <button key={name} className={styles.pickerTeam} onClick={()=>choose(name)}>
            <Crest cfg={cfg} name={name} url={current?.teams.find(t=>t.name===name)?.crest_url}/>
            <span>{name}</span>
          </button>)}</div>
      </section>
      :<section className={styles.hero}>
        <div className={styles.heroTop}>
          <span className={styles.eyebrow}>La tua giornata {round}{entry?` · Serie A ${entry.championshipRound}`:''}</span>
          <button className={styles.change} onClick={()=>choose(null)}>Cambia</button>
        </div>
        <div className={styles.heroMain}>
        {fixture
          ?<div className={styles.duel}>
            <div className={styles.duelSide}><Crest cfg={cfg} name={fixture.team} url={current?.teams.find(t=>t.name===fixture.team)?.crest_url}/><span className={styles.duelName}>{fixture.team}</span></div>
            <div className={styles.duelVs}>
              {outcome?<><strong className={styles[`outcome${outcome}`]}>{fixture.goals}–{fixture.opponentGoals}</strong><small>{fp(fixture.fantasy)} · {fp(fixture.opponentFantasy)} FP</small></>
                :<><strong>VS</strong><small>{fixture.home?'in casa':'in trasferta'}</small></>}
            </div>
            <div className={`${styles.duelSide} ${styles.duelAway}`}><Crest cfg={cfg} name={fixture.opponent} url={current?.teams.find(t=>t.name===fixture.opponent)?.crest_url}/><span className={styles.duelName}>{fixture.opponent}</span></div>
          </div>
          :<div className={styles.empty}>
            <Trophy size={22}/>
            <strong>Calendario non ancora in archivio</strong>
            <p>La giornata {round} comparirà qui appena una sincronizzazione porta il calendario ufficiale.</p>
            <button className={styles.link} onClick={()=>onNavigate('competition')}>Vai alle competizioni<ChevronRight size={14}/></button>
          </div>}
        {h2h&&<p className={styles.h2h}><Swords size={14}/>
          <span>Scontri diretti <strong>{h2h.wins}V</strong> <strong>{h2h.draws}N</strong> <strong>{h2h.losses}P</strong></span>
          {h2h.last&&<small>ultima {h2h.last.goals}–{h2h.last.opponentGoals}{h2h.last.fantasy!=null&&h2h.last.opponentFantasy!=null?` (${fp(h2h.last.fantasy)} a ${fp(h2h.last.opponentFantasy)})`:''}</small>}
        </p>}
        {/* Without a fixture there is still the one state that is always worth knowing. */}
        <div className={`${styles.lineupState} ${fixture?'':styles.lineupStateSolo}`}>
          <LineupBadge present={mine} label="La tua"/>
          {fixture&&<LineupBadge present={theirs} label="La sua"/>}
        </div>
        {current&&<p className={styles.stateTime}>Ultima osservazione {displayDate(current.observed_at)}{stale?' · da aggiornare':''}</p>}
        {/* A result outranks the clock: a calculated round never shows a countdown, whatever
            the calendar row says about its kickoff. */}
        {kickoff&&<p className={styles.kickoff}><Clock3 size={15}/>{!outcome&&toKickoff!=null&&toKickoff>0
          ?<>Inizio tra <strong>{formatRemainingCoarse(toKickoff)}</strong> · {formatKickoff(kickoff)}</>
          :<>{outcome?'Giornata conclusa':'Formazioni chiuse · risultati in arrivo'} · {formatKickoff(kickoff)}</>}</p>}
        {fixture&&(myTop.length||oppTop.length||gradesLoading)&&<div className={styles.top}>
          <span className={styles.topKicker}><Star size={12}/>Migliori per fantamedia</span>
          <div className={styles.topGrid}>
            <TopThree title={fixture.team} players={myTop} loading={gradesLoading}/>
            <TopThree title={fixture.opponent} players={oppTop} loading={gradesLoading}/>
          </div>
        </div>}
        </div>
        {fixture&&!outcome&&<div className={styles.odds}>
          {split&&odds
            ?<><div className={styles.oddsBar} role="img" aria-label={`Stima: ${split.win}% vittoria, ${split.draw}% pareggio, ${split.loss}% sconfitta`}>
              <span className={styles.oddsWin} style={{width:`${split.win}%`}}/>
              <span className={styles.oddsDraw} style={{width:`${split.draw}%`}}/>
              <span className={styles.oddsLoss} style={{width:`${split.loss}%`}}/>
            </div>
            <div className={styles.oddsFigures}>
              <span className={styles.oddsWin}><strong>{split.win}%</strong>vittoria</span>
              <span className={styles.oddsDraw}><strong>{split.draw}%</strong>pareggio</span>
              <span className={styles.oddsLoss}><strong>{split.loss}%</strong>sconfitta</span>
            </div>
            <p className={styles.oddsNote}>Stima, non previsione · media e variabilità dei fantapunti su {odds.rounds} giornate, pareggio entro ±4 FP.</p></>
            :<p className={styles.oddsNote}>Stima disponibile dalla {MIN_ROUNDS_FOR_PROBABILITY}ª giornata giocata da entrambe le squadre.</p>}
        </div>}
      </section>}

    <section className={`${styles.urgency} ${urgency}`}>
      {current
        ?<><div className={styles.urgencyHead}>
          <strong className={styles.urgencyCount}>{current.inserted}<span>/{current.expected_total}</span></strong>
          <span>{missing.length?`${missing.length===1?'manca una formazione':`mancano ${missing.length} formazioni`}`:'tutte le formazioni sono inserite'}</span>
        </div>
        {missing.length>0&&<div className={styles.urgencyList}>{missing.map(name=>
          <span key={name} className={`${styles.urgencyChip} ${name===fixture?.opponent?styles.urgencyOpponent:''}`}>
            <Crest cfg={cfg} name={name} url={current.teams.find(t=>t.name===name)?.crest_url}/>{name}
          </span>)}</div>}
        <button className={styles.link} onClick={()=>onNavigate('monitor')}>Apri il monitor formazioni<ChevronRight size={14}/></button></>
        :<div className={styles.empty}>
          <TriangleAlert size={22}/>
          <strong>Nessuna lettura per la giornata {round}</strong>
          <p>Le osservazioni compaiono qui appena la lega viene sincronizzata.</p>
          <button className={styles.link} onClick={()=>onNavigate('monitor')}>Apri il monitor formazioni<ChevronRight size={14}/></button>
        </div>}
    </section>

    {entry?.calculated&&<section className={styles.recap}>
      <div className={styles.recapHead}><span className={styles.eyebrow}>Giornata {entry.round} · risultati</span>
        {highlights.best&&<p className={styles.highlights}>
          <span className={styles.highBest}><Flame size={13}/>{highlights.best.team} <strong>{fp(highlights.best.fantasy)}</strong></span>
          {highlights.worst&&highlights.worst.team!==highlights.best.team&&<span className={styles.highWorst}><Snowflake size={13}/>{highlights.worst.team} <strong>{fp(highlights.worst.fantasy)}</strong></span>}
        </p>}
      </div>
      {entry.matches.map((m,i)=><div className={`${styles.recapMatch} ${m.home===team||m.away===team?styles.recapMine:''}`} key={`${m.home}-${m.away}-${i}`}>
        <span className={styles.recapTeam}>{m.home}</span>
        <span className={styles.recapResult}>{m.homeGoals??'–'}<i>–</i>{m.awayGoals??'–'}</span>
        <span className={`${styles.recapTeam} ${styles.recapAway}`}>{m.away}</span>
        <small className={styles.recapFp}>{fp(m.homeFantasy)} · {fp(m.awayFantasy)}</small>
      </div>)}
      <button className={styles.link} onClick={()=>onNavigate('competition')}>Classifica e coppe<ChevronRight size={14}/></button>
    </section>}

    {bench&&bench.rounds>0&&<section className={styles.bench}>
      <div className={styles.recapHead}><span className={styles.eyebrow}>Quanto hai lasciato in panchina</span></div>
      <div className={styles.benchFigures}>
        <span><strong>{fp(bench.benchPoints)}</strong>punti in panchina</span>
        <span><strong>{fp(bench.fieldedPoints)}</strong>punti schierati</span>
        <span><strong>{bench.rounds}</strong>giornate lette</span>
      </div>
      {bench.regrets.length
        ?<div className={styles.regrets}>{bench.regrets.slice(0,2).map(r=>
          <span key={`${r.round}-${r.name}`} className={styles.regret}><UserRound size={13}/>
            <strong>{r.name}</strong><small>{r.round}ª · {fp(r.points)} FP in panchina, +{fp(r.gap)} sul peggiore in campo</small>
          </span>)}</div>
        :<p className={styles.benchNote}>Nessuna panchina ha reso più di chi è sceso in campo.</p>}
      <button className={styles.link} onClick={()=>window.location.assign(`${base}/lineup-analytics`)}>Scelte e continuità<ChevronRight size={14}/></button>
    </section>}

    {team&&<section className={styles.status}>
      {hasResults(competition)&&standing
        ?<><button className={styles.statusTile} onClick={()=>onNavigate('competition')}>
          <Trophy size={16}/><strong className={styles.statusValue}>{standing.position}º</strong><span>{standing.row.points} punti</span>
        </button>
        <button className={styles.statusTile} onClick={()=>window.location.assign(`${base}/stats`)}>
          <TrendingUp size={16}/><span className={styles.statusForm}>{(myPerf?.recentForm??[]).map((r,i)=>
            <i key={i} className={styles[`form${r}`]}>{r==='W'?'V':r==='D'?'N':'P'}</i>)}</span><span>forma recente</span>
        </button>
        <button className={styles.statusTile} onClick={()=>window.location.assign(`${base}/stats`)}>
          <TrendingUp size={16}/><strong className={styles.statusValue}>{fp(myPerf?.fantasyAverage??null)}</strong><span>FP medi</span>
        </button></>
        :<p className={styles.statusNote}>Classifica, forma e media fantapunti compariranno qui dopo il primo calcolo ufficiale della lega.</p>}
      {character&&<button className={styles.character} onClick={()=>window.location.assign(`${base}/stats`)}>
        <span className={styles.characterLabel}>{character.label}</span>
        <span>{character.fantasyRank}ª per fantapunti, {character.pointsRank}ª in classifica</span>
      </button>}
      {tokens&&<button className={styles.statusTile} onClick={()=>onNavigate('penalties')}>
        <Coins size={16}/><strong className={styles.statusValue}>{tokens.remaining}</strong>
        <span>{tokens.penalty?`gettone · ${euro(tokens.penalty)} dovuti`:`gettone · ${periodForRound(cfg,round).label.toLowerCase()}`}</span>
      </button>}
    </section>}

    {competition&&<p className={styles.footnote}>Dati di competizione aggiornati al {displayDate(competition.fetchedAt)}.</p>}
  </div>;
}
