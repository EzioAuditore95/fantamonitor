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

Il deploy della sola dashboard richiede Vercel + Supabase. Il connettore che acquisisce
i dati da Fantacalcio è un servizio separato, ospitato su Railway, ed è operativo.
L'adapter storico `prototype/collector.mjs` dipendeva da un ambiente browser assistito e
non è più la fonte della sincronizzazione: resta nel repo come riferimento.

### Servizio connettore

Immagine `connector/Dockerfile`, basata su quella ufficiale Playwright. L'avvio è
`npm start`, cioè `node server.mjs`: **un solo deployment**. I due monkey-patch caricati con
`--import` sono stati rimossi — non potevano funzionare con più leghe, perché il loro unico
contesto era la stringa dell'URL della richiesta. Le stesse trasformazioni ora sono funzioni
esplicite in `connector/lib/fantacalcio.mjs`, applicate dal chiamante che sa di quale lega
si tratta.

Il connettore **non contiene più costanti di lega**: all'avvio legge `fm_leagues_for_bot` e
tiene in cache le leghe attive per 60 s. Slug, competizione, stagione, squadre, numero di
giornate e canali Telegram vengono da lì.

| File | Ruolo |
|---|---|
| `lib/config.mjs` | soli segreti di infrastruttura, nessuna lega |
| `lib/leagues.mjs` | directory delle leghe, `chat_id → lega`, credenziali, TTL sessione |
| `lib/credentials.mjs` | apre le buste sigillate dalla web app; qui vive la chiave privata |
| `lib/browser.mjs` | un solo Chromium riusato, mutex per lega e tetto globale di contesti |
| `lib/capture.mjs` | sessione, login di fallback, cattura formazioni e competizione |
| `lib/snapshot.mjs` | forma dello snapshot e classifica — senza Playwright, quindi testabili |
| `lib/telegram.mjs` | testi, tastiera e pubblicazione per lega |
| `lib/concurrency.mjs` | limitatore e mutex per chiave |

Rotte esposte:

| Rotta | Autenticazione | Uso |
|---|---|---|
| `POST /sync` | HMAC-SHA256 su `${timestamp}.${body}`, finestra 120 s | body `{league, round}`, lettura di una giornata |
| `POST /competition` | come sopra | body `{league}`, calendario e classifica per `/api/performance` |
| `POST /credential-check` | come sopra | body `{league}`, solo login: nessuna cattura |
| `POST /auto-sync` | token OIDC GitHub Actions, pinnato su repository, `refs/heads/main` e workflow | esegue il checkpoint dovuto |
| `POST /telegram/webhook` | `x-telegram-bot-api-secret-token` | comandi `/status`, `/missing`, `/next`, `/sync`, `/stats`, `/help` |
| `GET /health` | nessuna | stato della coda dei contesti |

Variabili d'ambiente: `FANTAMONITOR_CONNECTOR_SECRET`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `AUTO_SYNC_DB_SECRET`, `FM_CREDENTIAL_PRIVATE_KEY`,
`TELEGRAM_BOT_TOKEN`, più le opzionali `CONNECTOR_PUBLIC_URL`, `FANTAMONITOR_PUBLIC_URL`,
`CONNECTOR_MAX_CONTEXTS` (default 2) e `CONNECTOR_SESSION_TTL_MS` (default 12 h).
**`FANTACALCIO_USERNAME`, `FANTACALCIO_PASSWORD`, `TELEGRAM_CHAT_ID`, `TELEGRAM_THREAD_ID` e
`TELEGRAM_ADMIN_CHAT_ID` non servono più**: le credenziali stanno cifrate per lega in
`fm_league_credentials` e i canali Telegram nelle colonne di `fm_leagues`. Vanno rimosse da
Railway dopo il deploy.

Il segreto HMAC deve coincidere con `FANTAMONITOR_CONNECTOR_SECRET` sulla web app;
`AUTO_SYNC_DB_SECRET` è la chiave in chiaro di cui la migrazione conserva solo il digest.

### Un bot Telegram per tutte le leghe

Un bot ha un solo webhook, ma quel webhook riceve gli update di **tutte** le chat in cui il
bot si trova: basta mappare `chat_id → lega`, ed è quello che fa `leagueForChat`. Una chat
sconosciuta viene ignorata invece che indovinata — è il punto in cui un messaggio potrebbe
finire nel canale della lega sbagliata. Limiti accettati: un nome, un `setMyCommands`,
nessun branding per lega e un rate limit condiviso.

### Sessione Playwright

Prima si lanciava un browser nuovo e si rifaceva il login a ogni operazione, e un auto-sync
ne faceva due. Ora il browser è uno solo e riusato, e ogni lega ha un `storageState` cifrato
in `fm_league_credentials.session_state`, non su disco: i container Railway sono effimeri.

La sessione salvata è una scorciatoia, non una garanzia: si prova a navigare direttamente
sulla pagina, e se compare il muro di login si rifà l'accesso completo e si salva lo stato
nuovo. Il TTL di 12 h serve solo a rinfrescare in anticipo — Fantacalcio può invalidare la
sessione in qualsiasi momento.

Con 2–3 leghe bastano un mutex per lega (due richieste sulla stessa lega non devono fare due
login) e un tetto di 2 contesti simultanei. Un contesto Chromium costa 50–80 MB: **la memoria
del container è il limite di scala reale, non la CPU.**

### Pianificazione dei checkpoint

**Lo scheduler vive dentro il database, non su GitHub Actions.** La catena reale è:

```
pg_cron (job fm_evt_<lega>_r<n>_<checkpoint>_main / _retry)
  → public.fm_fire_scheduler_event()
  → legge dal Vault: fm_event_scheduler_url, fm_event_scheduler_secret
  → net.http_post  <url>/run   Authorization: Bearer <secret>
  → il servizio scheduler su Railway, che esegue il claim
  → public.fm_schedule_next_event() prenota il checkpoint successivo
```

`fm_next_checkpoint_watchdog` (`17 */6 * * *`) è la rete di sicurezza che ripianifica.

> **Non eliminare il servizio scheduler su Railway.** È lui a esporre il `POST /run` che
> pg_cron chiama: senza, i job continuerebbero a scattare, `net.http_post` incasserebbe 404
> e l'auto-sync morirebbe **in silenzio**, senza errori e senza messaggi Telegram. Una
> versione precedente di questa pagina diceva il contrario: era sbagliata.

`fm_schedule_next_event` prenota il prossimo checkpoint **di ogni lega attiva** con
`auto_sync_enabled`, e mette la lega nel nome del job: senza, due leghe con lo stesso calcio
d'inizio si sovrascriverebbero la voce cron a vicenda. `fm_claim_due_auto_sync` restituisce
anche la lega, e i vincoli di unicità includono `league_id`, quindi checkpoint simultanei su
leghe diverse non si bloccano.

`connector/scheduler-server.mjs` è un **guscio sottile**, 45 righe: verifica il bearer in
tempo costante, firma un corpo vuoto con lo stesso HMAC che protegge `/sync` e inoltra a
`POST /auto-sync` del connettore, con un singolo volo per non sovrapporsi al retry che
pg_cron prenota cinque minuti dopo. Il claim, la cattura e la pubblicazione Telegram vivono
in un posto solo. `cron.mjs` non esiste più: era in gran parte una copia di `server.mjs` e
produceva snapshot privi del blocco `competition`.

`/auto-sync` accetta quindi **due chiamanti**: GitHub Actions con un token OIDC, e lo
scheduler con la firma HMAC. Nessun tipo di autenticazione nuovo rispetto a prima.

Variabili del servizio scheduler: `EVENT_SCHEDULER_SECRET` (lo stesso valore che sta nel
Vault come `fm_event_scheduler_secret`), `FANTAMONITOR_CONNECTOR_SECRET` e `CONNECTOR_URL`.
Esiste anche il workflow `auto-sync.yml`, manuale (`workflow_dispatch`).

Gli orari di inizio giornata vivono in `fm_round_schedule`: le righe future restano a
`NULL` finché la Lega non pubblica gli orari ufficiali, e un checkpoint senza orario non
viene pianificato.

### Web app su Railway

Railway può anche ospitare la stessa web app al posto di Vercel usando
`deploy/railway.web.json` e `deploy/Dockerfile.web`. Impostare le due variabili Supabase
sia nella build sia nel runtime e configurare un dominio HTTPS del servizio.
Questa configurazione ospita la web app, non il connettore automatico.

## Credenziali Fantacalcio per lega

Ogni lega collega il proprio account amministratore di `leghe.fantacalcio.it` dal dialog
**Account Fantacalcio** nel banner della dashboard. Il segreto viaggia in una busta ibrida
(AES-256-GCM con chiave casuale per messaggio, sigillata con RSA-OAEP-SHA256 a 3072 bit) e
viene scritto in `fm_league_credentials`, una tabella **senza policy RLS e senza grant per
`authenticated`**: il ciphertext non è rileggibile dall'app, nemmeno da chi lo ha scritto.

La coppia di chiavi è asimmetrica apposta: la web app è la superficie esposta a internet che
accetta input utente, e ha **solo** la chiave pubblica. Una sua compromissione non rivela
alcuna credenziale.

### Generare la coppia

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out fm-credential.key
openssl pkey -in fm-credential.key -pubout -out fm-credential.pub
base64 -i fm-credential.pub | tr -d '\n'   # → FM_CREDENTIAL_PUBLIC_KEY  (web app)
base64 -i fm-credential.key | tr -d '\n'   # → FM_CREDENTIAL_PRIVATE_KEY (solo connettore)
```

- `FM_CREDENTIAL_PUBLIC_KEY` va su Vercel (o sul servizio web di Railway).
- `FM_CREDENTIAL_PRIVATE_KEY` va **solo** sul servizio connettore su Railway.
- I due file locali vanno distrutti dopo aver impostato le variabili: non finiscono nel repo
  e non esistono copie di backup della chiave privata oltre alla variabile Railway.

### Rotazione

Da fare almeno a fine stagione, e subito se si sospetta una fuga:

1. genera una nuova coppia con il comando sopra;
2. aggiorna `FM_CREDENTIAL_PUBLIC_KEY` sulla web app;
3. chiedi a ogni amministratore di ricollegare il proprio account dal dialog — il salvataggio
   azzera `last_verified_at`, quindi le leghe non ancora ricollegate sono visibili a colpo d'occhio;
4. aggiorna `FM_CREDENTIAL_PRIVATE_KEY` sul connettore e rimuovi la chiave vecchia.

Il campo **Alzare `FM_CREDENTIAL_KEY_VERSION` sulla web app** insieme alla chiave pubblica (1 → 2 → …):
è ciò che fa comparire nel dialog l'avviso "cifrate con una chiave precedente" per le leghe
non ancora ricollegate, invece di lasciarlo scoprire alla prima cattura fallita.

### Rischio da dichiarare

La pagina letta dal connettore è `manage-lineups`, cioè la sezione **Admin** della lega: una
sessione compromessa può **modificare** le formazioni altrui, non solo leggerle, e con N leghe
collegate il danno si moltiplica. Per questo il dialog propone come prima opzione la
**sessione** (`storageState`) invece della password: si revoca con un logout su Fantacalcio,
scade da sola e non lascia in giro una password. L'accesso automatizzato è inoltre
verosimilmente contrario ai termini d'uso di Fantacalcio e non prevede un percorso per la 2FA.

Nei log non compaiono mai il testo in chiaro né lo `storageState`: solo
`credential_sealed {league, mode, usernameFingerprint}`, con il fingerprint a 12 esadecimali,
la stessa convenzione di `secretFingerprint` in `lib/sync.ts`.

## Passaggio al multi-lega

Le sei migrazioni dopo `202609110001` portano lo schema da una lega cablata a N leghe.
**L'ordine conta**, e un passaggio fuori sequenza lascia il sistema a metà.

| # | Migrazione | Cosa fa |
|---|---|---|
| 1 | `20260916134143_reconcile_bot_rpcs` | trascrive in repo le RPC del bot create a mano in produzione |
| 2 | `20260917000001_multi_league` | `fm_leagues`, `league_id` ovunque, RLS per lega, RPC parametriche |
| 3 | `20260917000002_league_credentials` | credenziali cifrate per lega |
| 4 | `20260918000001_connector_league_directory` | directory delle leghe per il connettore |
| 5 | `20260918000002_fail_auto_sync_league` | `fm_fail_auto_sync` con la lega esplicita |

La numero 2 è quella che tocca dati veri: riscrive vincoli di unicità, chiavi primarie e
policy. Comincia con un blocco di asserzioni che **interrompe tutto** se in
`fm_observations`, `fm_lineup_reviews` o `fm_source_events` esiste una riga che non
appartiene a `chefantavitae10`: se si ferma lì, non è un difetto della migrazione, è un dato
inatteso da guardare prima di proseguire. Fare un backup prima resta la regola.

### Sequenza di rilascio

1. **Migrazioni** nell'ordine sopra. La lega esistente viene seedata dalla migrazione 2 con
   `auto_sync_enabled = true`, quindi l'auto-sync continua a comportarsi come prima.
2. **Popolare i canali Telegram** della lega esistente, *prima* di ridistribuire il
   connettore: ora vivono in `fm_leagues`, non più nelle variabili Railway.
   ```sql
   update public.fm_leagues set telegram_chat_id='…', telegram_thread_id='…',
          telegram_admin_chat_id='…' where slug='chefantavitae10';
   ```
   Saltare questo passo non rompe la sincronizzazione, ma zittisce Telegram.
3. **Generare la coppia di chiavi** (vedi sopra) e impostare `FM_CREDENTIAL_PUBLIC_KEY`
   sulla web app, `FM_CREDENTIAL_PRIVATE_KEY` sul connettore.
4. **Ridistribuire la web app.** Gli URL passano da `/` a `/l/{slug}`; `/` reindirizza, quindi
   i segnalibri continuano a funzionare.
5. **Ridistribuire il connettore** e poi rimuovere da Railway `FANTACALCIO_USERNAME`,
   `FANTACALCIO_PASSWORD`, `TELEGRAM_CHAT_ID`, `TELEGRAM_THREAD_ID` e
   `TELEGRAM_ADMIN_CHAT_ID`: non vengono più lette.
6. **Lasciare in piedi il servizio scheduler**, che riceve le chiamate di pg_cron. Vedi il
   riquadro nella sezione "Pianificazione dei checkpoint".
7. **Ricollegare l'account Fantacalcio** dal dialog nel banner, poi premere
   *Verifica connessione*. Finché non lo si fa, ogni cattura fallisce con
   `connector_credentials_missing` — è il prezzo di non custodire più una password in chiaro
   in una variabile d'ambiente.

## Aggiungere una lega

1. Invita i partecipanti su Supabase Auth: il seed si ferma se un'email non esiste ancora.
2. Copia [`supabase/seeds/new-league.sql`](../supabase/seeds/new-league.sql), modifica il
   blocco `parametri` in cima ed eseguilo. Crea lega, squadre, calendario e membership in
   una transazione, e rifiuta di procedere se la lega esiste già, se le squadre sono meno di
   due o in numero dispari, o se un'email non è registrata.
3. L'amministratore della nuova lega collega il proprio account dal dialog e verifica.
4. Una sincronizzazione manuale dalla dashboard sulla giornata corrente.
5. Solo dopo che la cattura è riuscita: `update public.fm_leagues set auto_sync_enabled=true
   where slug='…';` e, se serve, popola gli orari in `fm_round_schedule`.

### Verifica di accettazione

Il vero collaudo del multi-lega è la seconda lega. Da controllare:

- [ ] `/l/{slug}` della nuova lega mostra il suo nome, il suo numero di squadre e il suo
      selettore di giornate; il banner mostra lo switcher solo a chi appartiene a più leghe.
- [ ] Il calcolo di gettoni e penalità usa i parametri della nuova lega, non quelli dell'altra.
- [ ] `/api/archive?league={slug}` non restituisce **nemmeno una riga** dell'altra lega, e
      risponde 404 a un membro che non vi appartiene.
- [ ] Il countdown usa il calendario della lega giusta.
- [ ] Il messaggio Telegram arriva nel canale di quella lega, e un comando inviato da una
      chat sconosciuta viene ignorato.
- [ ] Due checkpoint simultanei su leghe diverse non si bloccano a vicenda.

Controllo di isolamento, da eseguire come `service_role`:

```sql
select l.slug, count(o.id) as osservazioni, count(distinct o.round) as giornate
from public.fm_leagues l left join public.fm_observations o on o.league_id=l.id
group by l.slug order by l.slug;

-- Deve restituire zero righe: nessuna osservazione il cui corpo contraddica la propria lega.
select o.id, l.slug, o.body->>'league' as body_league
from public.fm_observations o join public.fm_leagues l on l.id=o.league_id
where o.body->>'league' is distinct from l.slug;
```

## Segreti

L'inventario dell'ambiente Vercel e il piano di bonifica sono in
[SECRETS.md](SECRETS.md): la web app legge cinque variabili, le altre diciassette sono
residui, e alcune vanno ruotate oltre che rimosse.

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
