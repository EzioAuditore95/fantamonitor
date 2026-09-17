import { notFound } from 'next/navigation';
import { loadLeagueConfig } from '@/lib/league-server';
import StatsView from './stats-view';
export const dynamic='force-dynamic';
export default async function StatsPage({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params;
  const cfg=await loadLeagueConfig(slug);if(!cfg)notFound();
  return <StatsView config={cfg}/>;
}
