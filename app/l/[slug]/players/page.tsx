import { notFound } from 'next/navigation';
import { loadLeagueConfig } from '@/lib/league-server';
import PlayersView from './players-view';
export const dynamic='force-dynamic';
export default async function PlayersPage({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params;
  const cfg=await loadLeagueConfig(slug);if(!cfg)notFound();
  return <PlayersView config={cfg}/>;
}
