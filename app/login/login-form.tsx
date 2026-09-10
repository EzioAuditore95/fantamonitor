'use client';
import {useState} from 'react';
import {createClient} from '@/lib/supabase/client';
import {Input} from '@/components/ui/input';
export default function LoginForm(){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <form className="review-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');const f=new FormData(e.currentTarget);try{
   const client=createClient();const {error:authError}=await client.auth.signInWithPassword({email:String(f.get('email')),password:String(f.get('password'))});
   if(authError)throw new Error('Accesso non riuscito. Verifica email e password.');
   const r=await fetch('/api/archive',{cache:'no-store'});if(r.status===401||r.status===403){await client.auth.signOut();throw new Error('Questo account non è abilitato alla lega.');}if(!r.ok)throw new Error('Servizio temporaneamente non disponibile. Riprova.');
   window.location.assign('/');
 }catch(e){setError(e instanceof Error?e.message:'Accesso non riuscito.');setBusy(false);}}}>
 <label>Email<Input name="email" type="email" autoComplete="username" required disabled={busy}/></label><label>Password<Input name="password" type="password" autoComplete="current-password" required disabled={busy}/></label>{error&&<p role="alert" className="import-error">{error}</p>}<button className="btn primary" disabled={busy}>{busy?'Accesso…':'Accedi'}</button></form>;
}
