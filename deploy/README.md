# Deploy FANTAMONITOR

Questo branch migra la web app a Next.js + Supabase. La versione Sites esistente
rimane operativa fino al completamento del trasferimento e della verifica dei dati.

## 1. Supabase

Usare un progetto dedicato, con regione UE. Applicare una sola volta
`supabase/migrations/202609100001_fantamonitor.sql` tramite migrazione o SQL editor.
La migrazione crea le tabelle `fm_*` e le funzioni transazionali. Tutte le tabelle
hanno RLS: solo i membri leggono i dati e solo gli amministratori possono usare
le RPC di scrittura. Non configurare la service-role key nella web app.

Creare l'account del proprietario in Authentication / Users con email e password;
disabilitare le registrazioni pubbliche se non necessarie. Recuperare il vero UUID
creato e abilitare l'utente:

```sql
insert into public.fm_members (user_id,role)
values ('UUID_EFFETTIVO_DA_AUTH_USERS','admin');
```

Per un partecipante usare `viewer`. L'app autentica la password tramite Supabase;
non esiste auto-promozione del primo utente né fiducia negli header di Sites.

## 2. Vercel

Importare `EzioAuditore95/fantamonitor`, selezionando il branch `deploy/vercel-supabase`
per il primo deploy. Root directory: radice. Framework: Next.js. Node: 22.
La configurazione `vercel.json` usa `npm ci` e `npm run build`.

Configurare prima della build:

- `NEXT_PUBLIC_SUPABASE_URL`: URL del progetto effettivo.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: chiave pubblicabile del progetto.

Queste sono credenziali pubbliche di connessione; i dati sono protetti da Auth e RLS.
Non usare chiavi service-role o secret al loro posto. Allineare i valori in tutti
gli ambienti che devono leggere lo stesso progetto; anteprime con dati di test
possono invece usare un progetto Supabase separato.

Impostare in Supabase Auth l'URL del sito Vercel finale. L'accesso attuale usa
email/password e non richiede un callback OAuth. Cambiare le variabili NEXT_PUBLIC
richiede una nuova build. Una build senza variabili mostra lo stato di configurazione
incompleta, senza esporre la dashboard.

## 3. Trasferimento storico

Prima del passaggio definitivo esportare da Sites le osservazioni e tutte le revisioni
`lineup_reviews` e salvare a parte il seed `INITIAL_ARCHIVE_JSON` già usato dal sito.
Il normale export JSON della dashboard include soltanto osservazioni: non basta
per preservare le revisioni delle penalità e i log iniziali.

- Osservazioni: importare come admin dal frontend; il batch RPC è atomico e deduplicato.
- Revisioni: migrare tutte le righe nella tabella `fm_lineup_reviews`, preservando UUID,
  squadra, giornata, revisione, `recorded_at` e body JSON. Il vecchio attore Sites non
  è un UUID Supabase: conservarlo nel backup di migrazione; non inventare una mappatura.
- Log iniziali: trasferire i body nella tabella `fm_source_events`, con ID stabili.

Confrontare conteggi, ultime revisioni e totali per squadra/girone prima del passaggio.
Nessun dato reale è incluso in questo branch pubblico.

## 4. Railway

Il connettore incluso in `prototype/collector.mjs` dipende ancora dall'ambiente
browser assistito. NON è un worker autonomo: non viene avviato un cron che simulerebbe
una sincronizzazione. Il deploy della dashboard richiede soltanto Vercel + Supabase.
Il worker Fantacalcio su Railway resta una fase separata con login, rinnovo sessione,
lettura strutturata e prova effettiva prima dell'attivazione.

Railway può anche ospitare la stessa web app al posto di Vercel usando
`deploy/railway.web.json` e `deploy/Dockerfile.web`. Impostare le due variabili Supabase
sia nella build sia nel runtime e configurare un dominio HTTPS del servizio.
Questa configurazione ospita la web app, non il connettore automatico.

## Verifiche

```sh
npm ci
npm run typecheck
npm test
npm run build
```

I test PostgreSQL eseguono la migrazione in un database PGlite isolato e verificano
RLS, privilegi, deduplicazione, rollback e revisioni. La validazione finale sul progetto
Supabase reale e sull'URL ospitato avviene dopo aver configurato account e ambiente.
