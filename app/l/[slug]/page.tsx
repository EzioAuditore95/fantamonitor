import Dashboard from '@/app/dashboard';
import RoundCountdown from '@/app/round-countdown';
import { notFound } from 'next/navigation';
import { listMyLeagues,loadLeagueConfig } from '@/lib/league-server';
export const dynamic='force-dynamic';
export default async function LeagueHome({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params;
  const cfg=await loadLeagueConfig(slug);if(!cfg)notFound();
  return <><Dashboard config={cfg} leagues={await listMyLeagues()}/><RoundCountdown config={cfg}/></>;
}
