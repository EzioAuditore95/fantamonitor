'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const labels:Record<string,string>={
  monitor:'Formazioni',
  penalties:'Gettoni e penalità',
  history:'Storico',
  competition:'Competizione',
};

export default function TabQueryBridge(){
  const pathname=usePathname();
  useEffect(()=>{
    if(pathname!=='/')return;
    const requested=new URLSearchParams(window.location.search).get('tab');
    const label=requested?labels[requested]:undefined;
    if(!label)return;
    let attempts=0;
    const open=()=>{
      attempts++;
      const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('.main-tabs button'));
      const target=buttons.find(button=>button.textContent?.trim().includes(label));
      if(target){target.click();window.history.replaceState({},'',window.location.pathname);return;}
      if(attempts<12)window.setTimeout(open,50);
    };
    open();
  },[pathname]);
  return null;
}
