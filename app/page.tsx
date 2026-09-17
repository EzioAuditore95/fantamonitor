import { redirect } from 'next/navigation';
import { listMyLeagues } from '@/lib/league-server';
import { createClient,supabaseConfigured } from '@/lib/supabase/server';
export const dynamic='force-dynamic';
export default async function Home(){
  if(!supabaseConfigured())return <main className="login-shell"><h1>FANTAMONITOR</h1><p>Configurazione del servizio in corso. La dashboard sarà disponibile al termine dell’attivazione.</p></main>;
  const supabase=await createClient();
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user)redirect('/login');
  // La RLS restituisce solo le leghe dell'utente: nessuna riga = account non abilitato.
  const leagues=await listMyLeagues();
  if(!leagues.length)return <main className="login-shell"><div className="brand-mark">FM</div><h1>Account non abilitato</h1><p>L’accesso è riuscito, ma questo account non appartiene ancora a nessuna lega. Chiedi all’amministratore di abilitarlo.</p><form action="/api/auth/logout" method="post"><button className="btn primary" type="submit">Esci</button></form></main>;
  if(leagues.length===1)redirect(`/l/${leagues[0].slug}`);
  return <main className="login-shell"><div className="brand-mark">FM</div><h1>Scegli la lega</h1><ul className="league-picker">{leagues.map(l=><li key={l.id}><a href={`/l/${l.slug}`}>{l.name}</a></li>)}</ul></main>;
}
