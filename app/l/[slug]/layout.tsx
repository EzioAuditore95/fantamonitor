import type { ReactNode } from 'react';
import { notFound,redirect } from 'next/navigation';
import { getAppUser } from '@/app/auth';
import { loadLeagueConfig } from '@/lib/league-server';
import { supabaseConfigured } from '@/lib/supabase/server';
export const dynamic='force-dynamic';
// Il guard vive qui, così /stats e /lineup-analytics sono autenticate come la dashboard.
export default async function LeagueLayout({children,params}:{children:ReactNode;params:Promise<{slug:string}>}){
  if(!supabaseConfigured())return <main className="login-shell"><h1>FANTAMONITOR</h1><p>Configurazione del servizio in corso. La dashboard sarà disponibile al termine dell’attivazione.</p></main>;
  const user=await getAppUser();if(!user)redirect('/login');
  const {slug}=await params;
  if(!await loadLeagueConfig(slug))notFound();
  return <>{children}</>;
}
export async function generateMetadata({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params;
  const cfg=await loadLeagueConfig(slug);
  return {title:cfg?`FANTAMONITOR · ${cfg.name}`:'FANTAMONITOR'};
}
