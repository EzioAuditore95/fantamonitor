import Dashboard from '@/app/dashboard';
import RoundCountdown from '@/app/round-countdown';
import { RoundScheduleProvider } from '@/app/round-schedule-provider';
import { notFound } from 'next/navigation';
import { listMyLeagues,loadLeagueConfig } from '@/lib/league-server';
export const dynamic='force-dynamic';
export default async function LeagueHome({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params;
  const cfg=await loadLeagueConfig(slug);if(!cfg)notFound();
  return <RoundScheduleProvider slug={cfg.slug}><Dashboard config={cfg} leagues={await listMyLeagues()}/><RoundCountdown/></RoundScheduleProvider>;
}
