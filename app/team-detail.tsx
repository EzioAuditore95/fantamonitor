'use client';
import type { TeamSnapshot, Snapshot } from '@/lib/model';
import { displayDate } from '@/lib/model';
import FantasyPitch from './fantasy-pitch';
import { CheckCircle2, Clock3, Info, ShieldCheck, Shirt, UserRound } from 'lucide-react';

type EventRow={team_key:string;round:number;source_label:string;source_time_text:string;source_url:string};
type Player=NonNullable<NonNullable<TeamSnapshot['formation']>['roster']>[number];

const roleOrder=['P','D','C','A'] as const;
const roleLabels:Record<string,string>={P:'Portieri',D:'Difensori',C:'Centrocampisti',A:'Attaccanti'};

function statusLabel(present:boolean|undefined){return present===undefined?'Nessuna lettura':present?'Formazione inserita':'Formazione non inserita'}
function StatusPill({present}:{present:boolean|undefined}){return <span className={'team-detail-status '+(present===undefined?'unknown':present?'present':'absent')}>{present===undefined?<Info/>:present?<CheckCircle2/>:<Clock3/>}{statusLabel(present)}</span>}
function byRole(players:Player[]|undefined,role:string){return (players??[]).filter(p=>p.role===role)}

function PlayerChip({player,compact=false}:{player:Player;compact?:boolean}){
  return <div className={'player-chip '+(compact?'compact':'')}><span className="player-role">{player.role||'–'}</span><span className="player-name">{player.name}</span></div>
}

function Roster({players}:{players:Player[]}){
  return <section className="team-detail-section"><div className="section-heading"><div><span className="section-kicker">ROSA</span><h3>{players.length} giocatori</h3></div></div><div className="roster-groups">{roleOrder.map(role=>{const items=byRole(players,role);if(!items.length)return null;return <div className="roster-group" key={role}><div className="roster-group-head"><span className={'role-dot role-'+role.toLowerCase()}>{role}</span><strong>{roleLabels[role]}</strong><small>{items.length}</small></div><div className="roster-grid">{items.map(p=><div className="roster-player" key={String(p.id??p.name)}><span className={'role-dot role-'+role.toLowerCase()}>{role}</span><strong>{p.name}</strong></div>)}</div></div>})}</div></section>
}

export default function TeamDetail({team,round,readings,events}:{team?:TeamSnapshot;round:number;readings:Snapshot[];events:EventRow[]}){
  if(!team)return <div className="team-empty">Dati squadra non disponibili.</div>;
  return <div className="team-detail">
    <section className="team-identity-card">
      <div className="team-identity-main">
        <div className="team-detail-crest">{team.crest_url?<img src={team.crest_url} alt={`Stemma ${team.name}`}/>:<ShieldCheck/>}</div>
        <div className="team-identity-copy"><span className="section-kicker">Giornata {round}</span><h2>{team.name}</h2>{team.manager&&<p><UserRound/> {team.manager}</p>}</div>
      </div>
      <StatusPill present={team.present}/>
      {team.kit_url&&<div className="team-kit"><Shirt/><img src={team.kit_url} alt={`Maglia ${team.name}`}/></div>}
    </section>

    <FantasyPitch module={team.formation?.module} starters={team.formation?.starters??[]} kitUrl={team.kit_url} teamName={team.name}/>

    {!!team.formation?.bench?.length&&<section className="team-detail-section"><div className="section-heading"><div><span className="section-kicker">PANCHINA</span><h3>{team.formation.bench.length} giocatori</h3></div></div><div className="bench-scroll">{team.formation.bench.map(p=><PlayerChip compact key={String(p.id??p.name)} player={p}/>)}</div></section>}

    {!!team.formation?.roster?.length&&<Roster players={team.formation.roster}/>} 

    <section className="team-detail-section compact-section"><div className="section-heading"><div><span className="section-kicker">ATTIVITÀ</span><h3>Stato giornata</h3></div></div><div className="activity-list">{!readings.length?<div className="team-empty">Nessuna osservazione per questa giornata.</div>:[...readings].reverse().slice(0,4).map(s=>{const t=s.teams.find(x=>x.name===team.name);return <div className="activity-row" key={s.observed_at}><div><strong>{t?.present?'Formazione presente':'Formazione non presente'}</strong><span>{displayDate(s.observed_at)}</span></div></div>})}</div>{events.length>0&&<div className="source-log"><span className="section-kicker">LOG DI INVIO</span>{events.map((e,i)=><a key={i} href={e.source_url} target="_blank" rel="noreferrer"><strong>{e.source_label}</strong><span>{e.source_time_text}</span></a>)}</div>}</section>
  </div>
}
