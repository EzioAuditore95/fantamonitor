'use client';

import { usePathname } from 'next/navigation';
import { Activity,BarChart3,Coins,History,Trophy } from 'lucide-react';
import styles from './global-bottom-nav.module.css';

const items=[
  {label:'Formazioni',href:'/?tab=monitor',icon:Activity,key:'monitor'},
  {label:'Gettoni e penalità',href:'/?tab=penalties',icon:Coins,key:'penalties'},
  {label:'Storico',href:'/?tab=history',icon:History,key:'history'},
  {label:'Competizione',href:'/?tab=competition',icon:Trophy,key:'competition'},
  {label:'Statistiche',href:'/stats',icon:BarChart3,key:'stats'},
];

export default function GlobalBottomNav(){
  const pathname=usePathname();
  if(pathname==='/')return null;
  const active=pathname.startsWith('/stats')||pathname.startsWith('/lineup-analytics')?'stats':'';
  return <nav className={styles.nav} aria-label="Navigazione principale">
    {items.map(item=>{const Icon=item.icon;return <a key={item.key} href={item.href} className={`${styles.item} ${active===item.key?styles.active:''}`} aria-current={active===item.key?'page':undefined}>
      <Icon/>
      <span>{item.label}</span>
    </a>})}
  </nav>;
}
