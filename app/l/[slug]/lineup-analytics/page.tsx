import { notFound } from 'next/navigation';
import { loadLeagueConfig } from '@/lib/league-server';
import AnalyticsView from './analytics-view';
export const dynamic='force-dynamic';
export default async function LineupAnalyticsPage({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params;
  const cfg=await loadLeagueConfig(slug);if(!cfg)notFound();
  return <AnalyticsView config={cfg}/>;
}
