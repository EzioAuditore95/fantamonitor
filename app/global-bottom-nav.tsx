'use client';

import { usePathname } from 'next/navigation';
import { Activity,BarChart3,Coins,History,Trophy } from 'lucide-react';
import styles from './global-bottom-nav.module.css';

const items=[
  {label:'Formazioni',suffix:'?tab=monitor',icon:Activity,key:'monitor'},
  {label:'Gettoni e penalità',suffix:'?tab=penalties',icon:Coins,key:'penalties'},
  {label:'Storico',suffix:'?tab=history',icon:History,key:'history'},
  {label:'Competizione',suffix:'?tab=competition',icon:Trophy,key:'competition'},
  {label:'Statistiche',suffix:'/stats',icon:BarChart3,key:'stats'},
];

export default function GlobalBottomNav(){
  const pathname=usePathname();
  const league=/^\/l\/([^/]+)/.exec(pathname)?.[1];
  if(!league)return null;
  const base=`/l/${league}`;
  if(pathname===base)return null;
  const active=pathname.startsWith(`${base}/stats`)||pathname.startsWith(`${base}/lineup-analytics`)?'stats':'';
  return <nav className={styles.nav} aria-label="Navigazione principale">
    {items.map(item=>{const Icon=item.icon;return <a key={item.key} href={base+item.suffix} className={`${styles.item} ${active===item.key?styles.active:''}`} aria-current={active===item.key?'page':undefined}>
      <Icon/>
      <span>{item.label}</span>
    </a>})}
  </nav>;
}
