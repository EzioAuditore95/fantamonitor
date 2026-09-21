'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// The tabs the bottom nav can ask for. Validating against this list is not decoration:
// the value is interpolated into a CSS selector below, and a raw query parameter there
// would be a selector injection.
const TABS=['home','monitor','penalties','history','competition'];

export default function TabQueryBridge(){
  const pathname=usePathname();
  useEffect(()=>{
    if(!/^\/l\/[^/]+\/?$/.test(pathname))return;
    const requested=new URLSearchParams(window.location.search).get('tab');
    if(!requested||!TABS.includes(requested))return;
    let attempts=0;
    const open=()=>{
      attempts++;
      // Hydration decides when the buttons exist, so this retries rather than assuming.
      const target=document.querySelector<HTMLButtonElement>(`.main-tabs button[data-tab="${requested}"]`);
      if(target){target.click();window.history.replaceState({},'',window.location.pathname);return;}
      if(attempts<12)window.setTimeout(open,50);
    };
    open();
  },[pathname]);
  return null;
}
