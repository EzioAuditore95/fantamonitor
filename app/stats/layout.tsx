import type { ReactNode } from 'react';

export default function StatsLayout({children}:{children:ReactNode}){
  return <>{children}<a href="/lineup-analytics" style={{position:'fixed',right:16,bottom:18,zIndex:70,display:'inline-flex',alignItems:'center',gap:8,padding:'11px 14px',borderRadius:999,background:'rgba(9,24,48,.94)',border:'1px solid rgba(102,203,255,.34)',boxShadow:'0 12px 30px rgba(0,0,0,.32)',color:'#fff',fontSize:13,fontWeight:750,textDecoration:'none',backdropFilter:'blur(16px)'}}>Analisi formazioni</a></>;
}
