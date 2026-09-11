'use client';

import type { CSSProperties } from 'react';
import type { TeamSnapshot } from '@/lib/model';
import styles from './fantasy-pitch.module.css';

type Player=NonNullable<NonNullable<TeamSnapshot['formation']>['starters']>[number];
type PositionedPlayer=Player&{x:number;y:number;depth:number};

type Props={module?:string;starters?:Player[];kitUrl?:string;teamName?:string};

const FIELD_TOP=4;
const FIELD_BOTTOM=96;
const FIELD_TOP_HALF_WIDTH=26;
const FIELD_BOTTOM_HALF_WIDTH=47;

function parseModule(module?:string){
  const digits=String(module??'').replace(/\D/g,'').split('').map(Number).filter(n=>Number.isInteger(n)&&n>0);
  return digits.length>=3?digits.slice(0,3):[4,4,2];
}
function distribute(count:number){
  if(count<=0)return [];
  if(count===1)return [50];
  const inset=count>=5?7:count===4?11:count===3?18:count===2?28:50;
  const span=100-inset*2;
  return Array.from({length:count},(_,i)=>inset+(span*i)/(count-1));
}
function fieldHalfWidth(y:number){
  const t=Math.max(0,Math.min(1,(y-FIELD_TOP)/(FIELD_BOTTOM-FIELD_TOP)));
  return FIELD_TOP_HALF_WIDTH+(FIELD_BOTTOM_HALF_WIDTH-FIELD_TOP_HALF_WIDTH)*t;
}
function perspectiveX(logicalX:number,y:number){
  const half=fieldHalfWidth(y);
  return 50+((logicalX-50)/50)*half;
}
function normalizeRole(role?:string){
  const r=String(role??'').trim().toUpperCase();
  if(r.startsWith('P'))return 'P';
  if(r.startsWith('D'))return 'D';
  if(r.startsWith('C')||r.startsWith('M'))return 'C';
  if(r.startsWith('A')||r.startsWith('F'))return 'A';
  return '';
}
function layout(starters:Player[],module?:string):PositionedPlayer[]{
  if(!starters.length)return [];
  const [expectedD,expectedC,expectedA]=parseModule(module);
  let goalkeeper=starters.find(p=>normalizeRole(p.role)==='P');
  if(!goalkeeper)goalkeeper=starters[0];
  const remaining=starters.filter(p=>p!==goalkeeper);
  const byRole={D:remaining.filter(p=>normalizeRole(p.role)==='D'),C:remaining.filter(p=>normalizeRole(p.role)==='C'),A:remaining.filter(p=>normalizeRole(p.role)==='A')};
  const used=new Set<Player>([goalkeeper,...byRole.D,...byRole.C,...byRole.A]);
  const leftovers=remaining.filter(p=>!used.has(p));
  const fill=(items:Player[],count:number)=>{const result=[...items];while(result.length<count&&leftovers.length)result.push(leftovers.shift()!);return result.slice(0,count)};
  const defenders=fill(byRole.D,expectedD);
  const midfielders=fill(byRole.C,expectedC);
  const attackers=fill(byRole.A,expectedA);
  while(leftovers.length)midfielders.push(leftovers.shift()!);
  const rows:[Player[],number,number][]=[[[goalkeeper],12,0],[defenders,33,1],[midfielders,58,2],[attackers,82,3]];
  return rows.flatMap(([players,y,depth])=>distribute(players.length).map((logicalX,i)=>({...players[i],x:perspectiveX(logicalX,y),y,depth})));
}
function displayName(name:string){return String(name||'').trim().toUpperCase();}
function FallbackShirt({role}:{role?:string}){
  const isKeeper=normalizeRole(role)==='P';
  return <svg viewBox="0 0 100 100" aria-hidden="true" className={styles.fallbackShirt}><path d="M20 20 36 10h28l16 10 17 7-8 22-13-5v46H24V44l-13 5-8-22 17-7Z" fill={isKeeper?'#36caa4':'#132c55'} stroke="#a7ddff" strokeWidth="2" strokeLinejoin="round"/>{!isKeeper&&<path d="M46 11h9l-3 79h-9Z" fill="#35d4bd" opacity=".9"/>}<path d="M36 10h28l-6 13H42Z" fill={isKeeper?'#123b46':'#71dff2'} opacity=".95"/></svg>;
}
function PitchPlayer({player,kitUrl}:{player:PositionedPlayer;kitUrl?:string}){
  const style={left:`${player.x}%`,top:`${player.y}%`,'--depth':player.depth} as CSSProperties;
  return <div className={styles.player} style={style}><div className={styles.shirtWrap}>{kitUrl?<img src={kitUrl} alt="" className={styles.shirt}/>:<FallbackShirt role={player.role}/>}</div><div className={styles.name} title={displayName(player.name)}>{displayName(player.name)}</div></div>;
}
function PitchGeometry(){return <svg className={styles.pitchSvg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
  <defs><linearGradient id="field" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0b2543"/><stop offset="58%" stopColor="#0b4056"/><stop offset="100%" stopColor="#08746f"/></linearGradient><pattern id="stripes" width="12" height="100" patternUnits="userSpaceOnUse"><rect width="6" height="100" fill="rgba(255,255,255,.018)"/></pattern></defs>
  <polygon points="24,4 76,4 97,96 3,96" fill="url(#field)" stroke="rgba(245,249,255,.98)" strokeWidth=".7" vectorEffect="non-scaling-stroke"/>
  <polygon points="24,4 76,4 97,96 3,96" fill="url(#stripes)"/>
  <line x1="13.5" y1="50" x2="86.5" y2="50" stroke="rgba(245,249,255,.98)" strokeWidth=".7" vectorEffect="non-scaling-stroke"/>
  <ellipse cx="50" cy="50" rx="11" ry="6.2" fill="none" stroke="rgba(245,249,255,.98)" strokeWidth=".7" vectorEffect="non-scaling-stroke"/>
  <polygon points="38,4 62,4 65.5,20 34.5,20" fill="none" stroke="rgba(245,249,255,.98)" strokeWidth=".7" vectorEffect="non-scaling-stroke"/>
  <polygon points="44,4 56,4 57.5,11 42.5,11" fill="none" stroke="rgba(245,249,255,.98)" strokeWidth=".7" vectorEffect="non-scaling-stroke"/>
  <polygon points="25.5,80 74.5,80 82,96 18,96" fill="none" stroke="rgba(245,249,255,.98)" strokeWidth=".7" vectorEffect="non-scaling-stroke"/>
  <polygon points="39.5,89 60.5,89 64,96 36,96" fill="none" stroke="rgba(245,249,255,.98)" strokeWidth=".7" vectorEffect="non-scaling-stroke"/>
</svg>}
export default function FantasyPitch({module,starters=[],kitUrl,teamName}:Props){
  const players=layout(starters,module);
  const formatted=/^\d{3,4}$/.test(String(module??''))?String(module).split('').join('-'):module;
  return <section className={styles.card}><div className={styles.header}><div><span>FORMAZIONE TITOLARE</span><strong>{formatted||'Modulo'}</strong></div><small>{players.length?`${players.length} TITOLARI`:'NON DISPONIBILE'}</small></div>{!players.length?<div className={styles.empty}>Schieramento non disponibile per questa giornata.</div>:<div className={styles.stage} aria-label={`Formazione titolare ${teamName??''}`}><div className={styles.glow}/><PitchGeometry/><div className={styles.players}>{players.map((p,i)=><PitchPlayer key={`${String(p.id??p.name)}-${i}`} player={p} kitUrl={kitUrl}/>)}</div></div>}</section>;
}
