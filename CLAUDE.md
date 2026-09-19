# FANTAMONITOR

Dashboard privata della lega Fantacalcio **CheFantaVitaE10** (10 squadre, stagione
2026-2027, competizione `337500`): monitoraggio formazioni inserite, registro
gettoni/penalità, storico letture, statistiche e dati di competizione.

Accesso riservato ai membri: non esiste area pubblica.

## Stack e comandi

Node **>= 22.13** (in CI: 22). Nessun `node_modules` committato.

```bash
npm ci               # install (usa .npmrc: no audit/fund/notifier)
npm run dev          # next dev
npm run build        # next build --webpack
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # node --experimental-strip-types --test tests/*.test.mjs
node --test connector/tests/*.test.mjs   # connettore (funzioni pure, niente Playwright)
```

Pipeline di validazione completa (identica a `.github/workflows/ci.yml`):

```bash
npm ci && npx tsc --noEmit && npm run lint && node --test prototype/tests/collector.test.mjs && npm test && node --test connector/tests/*.test.mjs && (cd prototype && python -m unittest discover -s tests -v) && npm run build
```

- Next.js 16.2.6 (App Router) · React 19.2 · TypeScript strict · Tailwind 4 ·
  shadcn/ui (style `new-york`) · Zod 3 · lucide-react · recharts.
- Alias percorsi: `@/*` → radice del repo.
- Deploy web: Vercel (`vercel.json`) o Railway (`deploy/Dockerfile.web`, `deploy/railway.web.json`).
  Istruzioni operative complete: [deploy/README.md](deploy/README.md).

## Architettura

```
Browser ──► Next.js App Router (app/)
             ├─ proxy.ts            middleware Next 16: rinnova i cookie Supabase
             ├─ app/auth.ts         getAppUser() · requireLeagueMember(slug)
             ├─ app/l/[slug]/*      dashboard, stats, lineup-analytics della lega
             ├─ app/api/*/route.ts  archive · reviews · sync · schedule · performance · auth/logout
             └─ lib/*               modello Zod, regole penalità, calcoli, client Supabase
                        │
                        ▼
              Supabase (Postgres + Auth + RLS)
              fm_leagues / fm_league_teams / fm_memberships = configurazione e scope
              tabelle fm_* con league_id  ·  RPC fm_import_observations / fm_save_review / fm_*_auto_sync
                        ▲
                        │  (auto-sync: Supabase REST + chiave SHA-256)
              Connettore Railway (connector/, Node + Playwright)
                        │  HMAC-SHA256 bidirezionale
                        ▼
              leghe.fantacalcio.it / apileague.fantacalcio.it
```

### Livelli

- **`app/`** — pagine RSC + componenti client densi. `app/l/[slug]/` contiene dashboard,
  `stats/` e `lineup-analytics/` della lega; `app/page.tsx` reindirizza alla lega dell'utente
  (o mostra il selettore). La `LeagueConfig` arriva ai componenti client **come prop da RSC**,
  non da un context né da un endpoint. La UI è a tab (`Dashboard`) più due route secondarie
  con `global-bottom-nav` e `tab-query-bridge` per il ritorno alla tab richiesta.
- Ogni route API prende la lega da `?league=<slug>` (`/api/sync` dal body) e la risolve con
  `requireLeagueMember`, che concentra 401 / 403 / 404.
- **`lib/`** — logica pura e accesso dati:
  - `league.ts` — `LeagueConfig` e la preset `CHEFANTAVITAE10`: squadre, colori, giornate,
    periodi, gettoni gratuiti e importo della penale. **Unica sorgente delle costanti di lega.**
  - `model.ts` — `makeSnapshotSchema(cfg)` = contratto di una lettura; `canonical()`.
    `snapshotSchema` / `TEAM_NAMES` restano come derivati dalla preset.
  - `penalties.ts` — regola gettoni/penalità e `makeReviewInputSchema(cfg)`, entrambe
    parametriche sulla `LeagueConfig`.
  - `archive.ts` / `reviews.ts` — letture paginate (500/pagina) e scritture via RPC.
  - `sync.ts` — chiamate firmate al connettore.
  - `credentials.ts` — busta ibrida AES-256-GCM + RSA-OAEP (`v1.<chiave>.<iv>.<tag>.<dati>`).
    `open()` sta qui solo per tenere il formato in un posto e per il test di andata e
    ritorno: **la web app non deve mai chiamarla con una chiave reale.**
  - `performance.ts` / `lineup-analytics.ts` — calcoli puri, nessun I/O.
- **`supabase/migrations/`** — sorgente di verità dello schema. Le RPC leggono i limiti da
  `fm_leagues` e replicano in SQL la validazione fatta in Zod; `lib/league.ts` legge la
  stessa riga tramite `leagueConfigFromRows`.
- **`supabase/seeds/`** — `new-league.sql` aggiunge una lega con squadre, calendario e
  membership. **Le leghe si creano da qui, non da una schermata**: lo schema è multi-tenant,
  la UI no. Le credenziali non passano mai da SQL: le collega l'admin dal dialog.
- **`connector/`** — servizio Node separato (deploy Railway) che fa login su Fantacalcio
  con Playwright, cattura formazioni e competizione, notifica su Telegram ed esegue
  l'auto-sync a checkpoint. Ha un proprio `package.json`; non fa parte della build Next.
  **Non contiene costanti di lega**: le legge da `fm_leagues_for_bot` con cache di 60 s.
  `connector/lib/*.mjs` separa ciò che tocca Playwright da ciò che non lo tocca —
  `snapshot.mjs`, `telegram.mjs`, `leagues.mjs`, `concurrency.mjs`, `scheduler.mjs` e
  `fantacalcio.mjs` sono testabili senza browser, ed è ciò che `connector/tests/` esercita in CI.
  `scheduler-server.mjs` è un secondo deployment minimo: riceve il `POST /run` di pg_cron e
  lo inoltra a `/auto-sync` del connettore. Non duplica nulla: 45 righe, nessuna dipendenza.
- **`prototype/`** — adapter browser assistito (`collector.mjs`) e archivio evidenze
  Python (`monitor.py`). Fase storica, **ma i suoi test girano in CI**: non rimuoverla
  senza aggiornare `ci.yml`.

## Regole di dominio (non modificare senza richiesta esplicita)

I valori qui sotto sono quelli della preset `CHEFANTAVITAE10` in `lib/league.ts`: la regola
è parametrica, ma **per questa lega gli esiti non devono cambiare mai**.

- Giornate di **lega** 1–35 (`roundCount`); giornata Serie A = `round + serieAOffset` (3).
  Girone **andata** = round 1–16 (`firstHalfEnd`), **ritorno** = round 17–35.
- Ogni squadra ha **un gettone per periodo** (`freeTokens`): la prima omissione verificata è
  gratuita, ogni successiva costa 5 € (`penaltyAmount`) →
  `max(0, omissioni - freeTokens) * penaltyAmount`, calcolato per periodo.
  I gettoni **non** si trasferiscono tra gironi; il "complessivo" è solo la somma.
- Il gettone si assegna alla **prima omissione in ordine di giornata**, anche con
  inserimenti retroattivi (non in ordine di importazione).
- Contano solo gli esiti registrati in `POST /api/reviews` (`delivered` / `missed` /
  `unverified`). Le osservazioni grezze (`present: false`) **non** sono mai prova contabile.
- Un esito definitivo richiede scadenza **già trascorsa** e `source_url` appartenente
  alla giornata della lega (`round/{n}` o `manage-lineups/{n}`).
- Le revisioni sono **append-only**: una correzione crea la revisione successiva, il
  calcolo usa l'ultima per coppia squadra/giornata.

`tests/penalties.test.mjs` codifica ognuna di queste regole. Se una modifica rompe quei
test, la modifica è sbagliata — non il test.

## Invarianti di sicurezza

Ogni route API ripete, in quest'ordine:

1. `getAppUser()` → 401 se assente;
2. `user.role !== 'admin'` → 403 sulle scritture;
3. header `origin` === origin della richiesta → 403 (anti-CSRF);
4. `content-type: application/json` → 415;
5. lettura del body **in streaming con tetto di byte** (256 KB archivio, 16 KB review) → 413;
6. risposta sempre con `Cache-Control: private, no-store`.

Altre regole ferme:

- La web app usa **solo** la publishable key. Nessuna service-role key, mai.
- Ogni tabella `fm_*` ha RLS **per lega**: `league_id=any((select fm_my_league_ids())::uuid[])`,
  scrittura solo tramite RPC `security definer` che ricontrollano `fm_is_admin(league_id)`.
  Le versioni senza argomento di `fm_is_member` / `fm_is_admin` sono state eliminate apposta:
  come overload avrebbero lasciato compilare una policy che apre tutte le leghe.
- Traffico app ⇄ connettore firmato **in entrambe le direzioni** con HMAC-SHA256 su
  `${timestamp}.${body}`, confronto con `timingSafeEqual`, finestra 120 s, risposta
  limitata a 512 KB. Non sostituire con confronti `===`.
- `/auto-sync` sul connettore accetta solo un **OIDC token GitHub Actions** verificato
  su repo, ref e workflow. `fm_auto_sync_authorized` confronta il **digest SHA-256** della
  chiave: il testo in chiaro esiste solo nelle variabili Railway.
- Messaggi d'errore verso l'utente: in italiano, senza dettagli tecnici. La diagnostica
  va in `console.error` con codice breve (es. `archive_read_failed`) e, per il
  connettore, `secretFingerprint` (12 hex) — **mai il segreto**.
- Le credenziali Fantacalcio **per lega** stanno cifrate in `fm_league_credentials`, tabella
  con RLS e **nessuna policy né grant per `authenticated`**: il ciphertext non è rileggibile
  dall'app. La web app ha solo `FM_CREDENTIAL_PUBLIC_KEY` e può soltanto sigillare; la chiave
  privata vive **solo** sul connettore. Vedi [deploy/README.md](deploy/README.md) per
  generazione e rotazione. Mai loggare il chiaro: solo `usernameFingerprint` a 12 hex.
- `.env*` è ignorato (eccetto `.env.example`). Il token Telegram vive solo su Railway.

## Convenzioni di codice

- **Stile denso deliberato**: in `app/` e `lib/` funzioni e componenti stanno su una riga,
  senza spazi attorno agli operatori, import raggruppati. Non riformattare i file
  esistenti: uniformarsi. `components/ui/` e `lib/utils.ts` seguono invece la
  formattazione originale shadcn/Prettier.
- **Italiano per l'utente, inglese per il codice**: identificatori, chiavi di log e
  commenti in inglese; label, testi UI e messaggi d'errore in italiano (apostrofo
  tipografico `’`). Date e valute con `Intl.*` e `timeZone: 'Europe/Rome'`.
  **Unica eccezione**: `supabase/seeds/new-league.sql` ha i commenti in italiano perché è un
  modulo da compilare a mano, letto insieme al runbook italiano in `deploy/README.md`. È una
  scelta, non una dimenticanza: non "correggerla".
- **Commenti rari**, solo per spiegare un vincolo non deducibile (una riga sopra il codice).
- **Validazione ai bordi**: ogni input esterno passa da uno schema Zod `.strict()`.
  Le funzioni in `performance.ts` / `lineup-analytics.ts` restano pure.
- **`components/ui/**` e `hooks/use-mobile.ts` sono vendorizzati verbatim da shadcn**
  (vedi override in `eslint.config.mjs`): non modificarli, rigenerarli dal registry.
- CSS: `app/globals.css` (token) + `app/glass.css` + `app/glass-refinement.css` per il
  tema glass globale; le route secondarie usano CSS Modules (`*.module.css`).
- Commit: soggetto imperativo in inglese, maiuscola iniziale, ~50 caratteri, senza
  prefisso di scope e senza body. Es. `Archive competition snapshots during automatic syncs`.

## Duplicazioni da tenere allineate

Queste costanti esistono in più punti **per necessità** (runtime diversi). Cambiandone
una, aggiornare tutte:

| Costante | Punti |
|---|---|
| Elenco squadre | riga `fm_league_teams` ⇄ preset `lib/league.ts`; **copia residua** in `prototype/collector.mjs` |
| Intervallo giornate | `fm_leagues.round_count` ⇄ `lib/league.ts` |
| Pattern `source_url` | `fm_leagues.slug`+`competition_id` ⇄ `leaguePath()` ⇄ `manageLineupsUrl()` |
| Scope lega/stagione/competizione | `fm_leagues` ⇄ `lib/league.ts` ⇄ `fm_leagues_for_bot` |

SQL, TypeScript e connettore non sono più copie da confrontare: leggono la **stessa riga**.
L'unica copia residua è `prototype/collector.mjs`, che è codice storico e non gira in prod.

## Storia della piattaforma

Il progetto è nato su OpenAI Sites + Cloudflare D1. Quel livello (Drizzle su D1, plugin
Vite `sites-*`, `wrangler`, `vinext`) è stato **rimosso dal repo**: l'unica persistenza è
Supabase e l'unica build è quella di Next. Se un documento o una risposta fa riferimento a
`db/`, `drizzle/`, `vite.config.ts` o `npm run install:ci`, sta descrivendo uno stato
superato — la storia git li conserva, il repo no.

## Trappole note

- `proxy.ts` è il middleware di Next 16 (esporta `proxy`, non `middleware`) e copre `/`,
  `/login`, `/l/*`, `/api/*`. Nuove route protette vanno aggiunte al `matcher`: se manca,
  i cookie Supabase smettono di rinfrescarsi e compaiono 401 sporadici dopo circa un'ora.
- `TabQueryBridge` ripristina la tab facendo **DOM scraping** sulle label italiane dei
  bottoni `.main-tabs`, ed è attivo solo su `/l/{slug}`. Da qui due vincoli: **mai mettere il
  nome della lega dentro una label di tab**, e non convertire gli `<a>` in `<Link>` — l'effect
  è agganciato a `[pathname]` e i reload completi tra route sono strutturali e voluti.
- I Server Component non possono scrivere cookie: `lib/supabase/server.ts` ignora
  l'errore di scrittura e lascia il refresh al proxy. Non "sistemare" quel `catch` vuoto.
- Senza variabili Supabase l'app **non** va in errore: `supabaseConfigured()` mostra lo
  stato di attivazione incompleta. Cambiare le `NEXT_PUBLIC_*` richiede una nuova build.
- L'import delle osservazioni è **idempotente**: l'id è lo SHA-256 della forma canonica
  (`canonical()` in `lib/model.ts`). Stessa `(round, observed_at)` con body diverso →
  `observation_conflict` e rollback dell'intero batch. Non cambiare `canonical()` senza
  considerare che invaliderebbe tutti gli id già archiviati.
- `saveReview` usa concorrenza ottimistica via `expected_revision`: un 409
  (`ReviewConflict`) significa "rileggi e riprova", non "riprova uguale".
- I due monkey-patch del connettore (`phase1-patch.mjs`, `phase2-patch.mjs`) **non esistono
  più**: patchavano `globalThis.fetch` e `Object.entries`, e il loro unico contesto era la
  stringa dell'URL, quindi con più leghe non potevano sapere di quale lega stessero
  arricchendo i dati. Le stesse trasformazioni sono ora `enrichTeam` / `enrichLineup` in
  `connector/lib/fantacalcio.mjs`, chiamate esplicitamente da `capture.mjs`.
- Un solo bot Telegram serve tutte le leghe: il suo webhook riceve gli update di ogni chat
  in cui si trova, e `leagueForChat` mappa `chat_id → lega`. **Una chat sconosciuta si
  ignora, non si indovina**: è il punto in cui un messaggio finirebbe nel canale sbagliato.
- La sessione Playwright salvata è una scorciatoia, non una garanzia: si prova a navigare
  direttamente, e al muro di login si rifà l'accesso completo. Non fidarsi del solo TTL.
- `/api/performance` degrada: se il connettore non risponde usa l'ultimo snapshot
  archiviato che contenga `competition`, aggiungendo un warning esplicito.
- `tests/postgres.test.mjs` esegue le migrazioni in PGlite con ruoli e `auth.uid()`
  simulati: **ogni nuova migrazione deve poter girare lì**, quindi niente costrutti
  esclusivi di Supabase non emulabili. Usa `prototype/tests/fixture.json` come snapshot valido.
- Nelle policy RLS il cast è obbligatorio: `any((select fm_my_league_ids()))` fa leggere al
  parser la forma sotto-query e confronta `uuid` con `uuid[]`. Serve
  `any((select fm_my_league_ids())::uuid[])`, che resta un InitPlan valutato una volta per
  query. La forma `fm_is_member(league_id)` dentro una policy sarebbe invece una sotto-query
  correlata, valutata per riga.
- `fm_default_league()` è un ponte temporaneo: risolve l'unica lega attiva e restituisce
  `null` (quindi `league_required`) appena ce ne sono due. Lo usano le RPC del bot chiamate
  senza lega e lo shim a 2 argomenti di `fm_save_review`. Va rimosso quando nessun chiamante
  userà più le firme vecchie.
- **`fm_fail_auto_sync` è l'eccezione al ponte, e per un buon motivo.** Se non riesce a
  risolvere la lega marca comunque il run come `failed`: lasciarlo `running` lo renderebbe
  irrecuperabile, perché `fm_claim_due_auto_sync` riprende soltanto i run `failed`, e quel
  round/checkpoint resterebbe bloccato per sempre. La firma a 5 argomenti con la lega è
  quella giusta, e il connettore la usa passando `claim.league_id`.
- Dentro `lib/` gli import **di valore** fra moduli usano l'estensione `.ts` esplicita
  (`from './league.ts'`): `node --experimental-strip-types` gira in ESM e non riscrive le
  estensioni, quindi senza di essa i test falliscono con `ERR_MODULE_NOT_FOUND`. Da qui
  `allowImportingTsExtensions` in `tsconfig.json`. Gli import da `app/` restano `@/lib/...`.
- L'id di `fm_observations` è calcolato con **due algoritmi divergenti**: `lib/archive.ts`
  usa `canonical()` (chiavi ordinate da JS), mentre `fm_complete_auto_sync` e
  `fm_bot_import_snapshot` usano `digest(sample::text)` (ordinamento di Postgres). Lo stesso
  snapshot importato dalla UI e dal bot ottiene due id diversi: non corrompe nulla solo
  perché la deduplica è su `(round, observed_at)`. Difetto noto, non correggerlo di sfuggita.
- **L'auto-sync in produzione è pianificato da pg_cron dentro Supabase**, non da GitHub
  Actions: `fm_fire_scheduler_event` legge URL e token dal Vault e chiama `/run` del servizio
  scheduler via pg_net, poi `fm_schedule_next_event` prenota il checkpoint dopo. Il workflow
  `auto-sync.yml` è `workflow_dispatch` ed è solo la via manuale. Non spegnere quel servizio
  Railway: l'auto-sync morirebbe in silenzio. Il pinning `EzioAuditore95/fantamonitor` +
  `refs/heads/main` è verificato lato connettore.
- La storia delle migrazioni di Supabase contiene **11 voci create fuori dal repo** (10–11/09
  più il primo scaffolding). Sono state riallineate con `supabase migration repair` il
  19/09: da lì in poi `db push` è di nuovo utilizzabile, ma quelle voci restano nella
  tabella e non hanno un file corrispondente.
- Dati reali (`lib/data/`, `prototype/data/`) sono fuori dal repo: non ricrearli né
  committare esempi con nomi o risultati veri.

## Cosa chiedere prima di fare

- Applicare migrazioni o eseguire scritture sul progetto Supabase reale.
- Modificare la regola gettoni/penalità, l'elenco squadre o lo scope lega/stagione.
- Ruotare segreti, toccare le variabili Railway/Vercel, lanciare `auto-sync` in produzione.
- Commit o push: il repo ha un remote pubblico su GitHub.
