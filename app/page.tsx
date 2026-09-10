import Dashboard from './dashboard';
import { getAppUser } from './auth';
import { redirect } from 'next/navigation';
import { supabaseConfigured } from '@/lib/supabase/server';
export const dynamic='force-dynamic';
export default async function Home(){
  if(!supabaseConfigured())return <main className="login-shell"><h1>FANTAMONITOR</h1><p>Configurazione del servizio in corso. La dashboard sarà disponibile al termine dell’attivazione.</p></main>;
  const user=await getAppUser();if(!user)redirect('/login');
  return <Dashboard/>;
}
