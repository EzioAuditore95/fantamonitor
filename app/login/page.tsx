import LoginForm from './login-form';
import { supabaseConfigured } from '@/lib/supabase/server';
export const dynamic='force-dynamic';
export default function Login(){return <main className="login-shell"><div className="brand-mark">FM</div><h1>Accedi a FANTAMONITOR</h1><p>Usa l’account abilitato alla lega CheFantaVitaE10.</p>{supabaseConfigured()?<LoginForm/>:<p>Configurazione del servizio in corso.</p>}</main>;}
