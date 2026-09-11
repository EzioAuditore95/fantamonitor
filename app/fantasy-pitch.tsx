'use client';

import type { TeamSnapshot } from '@/lib/model';
import styles from './fantasy-pitch.module.css';

type Player=NonNullable<NonNullable<TeamSnapshot['formation']>['starters']>[number];
type PositionedPlayer=Player&{x:number;y:number;depth:number};

type Props={
  module?:string;
  starters?:Player[];
  kitUrl?:string;
  teamName?:string;
};

const roleOrder=['P','D','C','A'];
const roleLabel:Record<string,string>={P:'P',D:'D',C:'C',A:'A'};

function parseModule(module?:string){
  const digits=String(module??'').replace(/\D/g,'').split('').map(Number).filter(n=>Number.isInteger(n)&&n>0);
  return digits.length>=3?digits.slice(0,3):[4,4,2];
}

function distribute(count:number){
  if(count<=0)return [];
  if(count===1)return [50];
  const inset=count>=5?9:count===4?13:count===3?20:27;
  const span=100-inset*2;
  return Array.from({length:count},(_,i)=>inset+(span*i)/(count-1));
}

function perspectiveX(x:number,y:number){
  const scale=.58+.42*(y/100);
  return 50+(x-50)*scale;
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
  const byRole={
    D:remaining.filter(p=>normalizeRole(p.role)==='D'),
    C:remaining.filter(p=>normalizeRole(p.role)==='C'),
    A:remaining.filter(p=>normalizeRole(p.role)==='A'),
  };
  const used=new Set<Player>([goalkeeper,...byRole.D,...byRole.C,...byRole.A]);
  const leftovers=remaining.filter(p=>!used.has(p));
  const fill=(items:Player[],count:number)=>{
    const result=[...items];
    while(result.length<count&&leftovers.length)result.push(leftovers.shift()!);
    return result;
  };
  const defenders=fill(byRole.D,expectedD);
  const midfielders=fill(byRole.C,expectedC);
  const attackers=fill(byRole.A,expectedA);
  while(leftovers.length)midfielders.push(leftovers.shift()!);

  const rows:[Player[],number,number][]=[[[goalkeeper],12,0],[defenders,34,1],[midfielders,59,2],[attackers,83,3]];
  return rows.flatMap(([players,y,depth])=>distribute(players.length).map((x,i)=>({...players[i],x:perspectiveX(x,y),y,depth})));
}

function displayName(name:string){return String(name||'').trim().toUpperCase();}

function FallbackShirt({role}:{role?:string}){
  const isKeeper=normalizeRole(role)==='P';
  return <svg viewBox="0 0 100 100" aria-hidden="true" className={styles.fallbackShirt}>
    <path d="M20 20 36 10h28l16 10 17 7-8 22-13-5v46H24V44l-13 5-8-22 17-7Z" fill={isKeeper?'#36caa4':'#132c55'} stroke="#a7ddff" strokeWidth="2" strokeLinejoin="round"/>
    {!isKeeper&&<path d="M46 11h9l-3 79h-9Z" fill="#35d4bd" opacity=".9"/>}
    <path d="M36 10h28l-6 13H42Z" fill={isKeeper?'#123b46':'#71dff2'} opacity=".95"/>
  </svg>;
}

function PitchPlayer({player,kitUrl}:{player:PositionedPlayer;kitUrl?:string}){
  return <div className={styles.player} style={{left:`${player.x}%`,top:`${player.y}%`,'--depth':player.depth} as React.CSSProperties}>
    <div className={styles.shirtWrap}>
      {kitUrl?<img src={kitUrl} alt="" className={styles.shirt}/>:<FallbackShirt role={player.role}/>} 
    </div>
    <div className={styles.name} title={displayName(player.name)}>{displayName(player.name)}</div>
  </div>;
}

export default function FantasyPitch({module,starters=[],kitUrl,teamName}:Props){
  const players=layout(starters,module);
  const formatted=/^\d{3,4}$/.test(String(module??''))?String(module).split('').join('-'):module;
  return <section className={styles.card}>
    <div className={styles.header}>
      <div><span>FORMAZIONE TITOLARE</span><strong>{formatted||'Modulo'}</strong></div>
      <small>{players.length?`${players.length} TITOLARI`:'NON DISPONIBILE'}</small>
    </div>
    {!players.length?<div className={styles.empty}>Schieramento non disponibile per questa giornata.</div>:<div className={styles.stage} aria-label={`Formazione titolare ${teamName??''}`}>
      <div className={styles.glow}/>
      <div className={styles.pitchPlane} aria-hidden="true">
        <div className={styles.pitchOutline}/>
        <div className={styles.midline}/>
        <div className={styles.centerCircle}/>
        <div className={`${styles.area} ${styles.topArea}`}/>
        <div className={`${styles.smallArea} ${styles.topSmall}`}/>
        <div className={`${styles.area} ${styles.bottomArea}`}/>
        <div className={`${styles.smallArea} ${styles.bottomSmall}`}/>
      </div>
      <div className={styles.players}>{players.map((p,i)=><PitchPlayer key={`${String(p.id??p.name)}-${i}`} player={p} kitUrl={kitUrl}/>)}</div>
    </div>}
  </section>;
}
