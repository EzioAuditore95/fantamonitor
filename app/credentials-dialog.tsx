'use client';
import { useCallback,useEffect,useState } from 'react';
import { KeyRound,ShieldCheck,ShieldAlert } from 'lucide-react';
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Tabs,TabsList,TabsTrigger,TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { displayDate } from '@/lib/model';
import type { LeagueConfig } from '@/lib/league';

type Status={configured?:boolean;hasSession?:boolean;sessionExpiresAt?:string|null;keyVersion?:number;
 updatedAt?:string|null;lastVerifiedAt?:string|null;lastVerifiedStatus?:string|null;encryptionReady?:boolean;error?:string};

export default function CredentialsDialog({config,canManage}:{config:LeagueConfig;canManage:boolean}){
  const [open,setOpen]=useState(false),[status,setStatus]=useState<Status|null>(null);
  const [mode,setMode]=useState('session'),[saving,setSaving]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[storageState,setStorageState]=useState('');
  const read=useCallback(()=>fetch(`/api/credentials?league=${encodeURIComponent(config.slug)}`,{cache:'no-store'}).then(r=>r.json() as Promise<Status>),[config.slug]);
  const load=useCallback(async()=>{try{setStatus(await read());}catch{setStatus({error:'Stato non disponibile.'});}},[read]);
  useEffect(()=>{
    let active=true;
    read().then(body=>{if(active)setStatus(body);}).catch(()=>{if(active)setStatus({error:'Stato non disponibile.'});});
    return()=>{active=false};
  },[read]);
  const connected=Boolean(status?.configured||status?.hasSession);
  async function save(){
    setSaving(true);setError('');setDone('');
    try{
      const body=mode==='session'?{mode:'session',storageState}:{mode:'password',username,password};
      const response=await fetch(`/api/credentials?league=${encodeURIComponent(config.slug)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json() as {error?:string};
      if(!response.ok)throw new Error(result.error??'Salvataggio non riuscito.');
      // Nulla torna indietro in chiaro: i campi si svuotano e resta solo lo stato.
      setPassword('');setStorageState('');setDone('Credenziali salvate e cifrate.');await load();
    }catch(e){setError(e instanceof Error?e.message:'Salvataggio non riuscito.');}finally{setSaving(false);}
  }
  if(!canManage)return null;
  return <>
    <button className="credential-chip" onClick={()=>{setOpen(true);setError('');setDone('');}} aria-label="Account Fantacalcio collegato alla lega">
      {connected?<ShieldCheck size={15}/>:<ShieldAlert size={15}/>}
      <span>{connected?'Account collegato':'Collega account'}</span>
    </button>
    <Dialog open={open} onOpenChange={v=>{if(!saving)setOpen(v)}}><DialogContent className="review-dialog">
      <DialogHeader><DialogTitle>Account Fantacalcio della lega</DialogTitle>
      <DialogDescription>Serve un account amministratore della lega su leghe.fantacalcio.it: il connettore legge la pagina di gestione formazioni, che richiede quel ruolo.</DialogDescription></DialogHeader>
      <div className="credential-state">
        <p><strong>{connected?'Collegato':'Non collegato'}</strong>{status?.hasSession?' · sessione attiva':status?.configured?' · password memorizzata':''}</p>
        {status?.sessionExpiresAt&&<p className="muted">Sessione valida fino al {displayDate(status.sessionExpiresAt)}.</p>}
        <p className="muted">{status?.lastVerifiedAt?`Ultima verifica: ${displayDate(status.lastVerifiedAt)} · ${status.lastVerifiedStatus}`:'Mai verificato dal connettore.'}</p>
        {status&&status.encryptionReady===false&&<p role="alert" className="import-error">Cifratura non configurata: manca <code>FM_CREDENTIAL_PUBLIC_KEY</code>.</p>}
      </div>
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList className="period-tabs" aria-label="Modo di collegamento">
          <TabsTrigger value="session">Sessione</TabsTrigger><TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>
        <TabsContent value="session">
          <p className="import-note">Consigliato. Incolla lo <code>storageState</code> di una sessione già autenticata: si revoca con un logout su Fantacalcio, scade da sola e nessuno custodisce la tua password.</p>
          <label>Sessione (JSON)<Textarea value={storageState} rows={5} disabled={saving} onChange={e=>setStorageState(e.target.value)} placeholder='{"cookies":[…],"origins":[…]}'/></label>
        </TabsContent>
        <TabsContent value="password">
          <p className="import-note">Più comodo, ma il connettore custodisce una password di Fantacalcio. È cifrata con una chiave pubblica: solo il connettore può aprirla, e non è più rileggibile da qui.</p>
          <label>Username<Input value={username} autoComplete="off" disabled={saving} onChange={e=>setUsername(e.target.value)}/></label>
          <label>Password<Input type="password" value={password} autoComplete="off" disabled={saving} onChange={e=>setPassword(e.target.value)}/></label>
        </TabsContent>
      </Tabs>
      {error&&<p role="alert" className="import-error">{error}</p>}
      {done&&<p className="import-note">{done}</p>}
      <p className="footnote">L’accesso automatizzato è verosimilmente contrario ai termini d’uso di Fantacalcio e non prevede un percorso per l’autenticazione a due fattori. Chi collega l’account se ne assume il rischio.</p>
      <button className="btn primary" disabled={saving||(mode==='session'?!storageState.trim():!username.trim()||!password)} onClick={save}><KeyRound/>{saving?'Salvataggio…':'Salva e cifra'}</button>
    </DialogContent></Dialog>
  </>;
}
