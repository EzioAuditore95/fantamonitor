'use client';

import { usePathname } from 'next/navigation';
import { Activity,BarChart3,Coins,History,Home,Trophy } from 'lucide-react';
import styles from './global-bottom-nav.module.css';

// Two labels each, swapped by media query: the long one does not fit a phone, and this
// bar is the only navigation on /stats, /players and /lineup-analytics.
const items=[
  {label:'Home',short:'Home',suffix:'?tab=home',icon:Home,key:'home'},
  {label:'Formazioni',short:'Monitor',suffix:'?tab=monitor',icon:Activity,key:'monitor'},
  {label:'Gettoni e penalità',short:'Gettoni',suffix:'?tab=penalties',icon:Coins,key:'penalties'},
  {label:'Storico',short:'Storico',suffix:'?tab=history',icon:History,key:'history'},
  {label:'Competizione',short:'Trofei',suffix:'?tab=competition',icon:Trophy,key:'competition'},
  {label:'Statistiche',short:'Statistiche',suffix:'/stats',icon:BarChart3,key:'stats'},
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
      <span className={styles.long}>{item.label}</span>
      <span className={styles.short}>{item.short}</span>
    </a>})}
  </nav>;
}
