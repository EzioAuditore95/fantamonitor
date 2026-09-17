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
```

Pipeline di validazione completa (identica a `.github/workflows/ci.yml`):

```bash
npm ci && npx tsc --noEmit && npm run lint && node --test prototype/tests/collector.test.mjs && npm test && (cd prototype && python -m unittest discover -s tests -v) && npm run build
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
             ├─ app/auth.ts         getAppUser() → {userId,email,role}
             ├─ app/api/*/route.ts  archive · reviews · sync · schedule · performance · auth/logout
             └─ lib/*               modello Zod, regole penalità, calcoli, client Supabase
                        │
                        ▼
              Supabase (Postgres + Auth + RLS)
              tabelle fm_*  ·  RPC fm_import_observations / fm_save_review / fm_*_auto_sync
                        ▲
                        │  (auto-sync: Supabase REST + chiave SHA-256)
              Connettore Railway (connector/, Node + Playwright)
                        │  HMAC-SHA256 bidirezionale
                        ▼
              leghe.fantacalcio.it / apileague.fantacalcio.it
```

### Livelli

- **`app/`** — pagine RSC + componenti client densi. `page.tsx` (dashboard), `stats/`,
  `lineup-analytics/`, `login/`. La UI è a tab (`Dashboard`) più due route secondarie
  con `global-bottom-nav` e `tab-query-bridge` per il ritorno alla tab richiesta.
- **`lib/`** — logica pura e accesso dati:
  - `league.ts` — `LeagueConfig` e la preset `CHEFANTAVITAE10`: squadre, colori, giornate,
    periodi, gettoni gratuiti e importo della penale. **Unica sorgente delle costanti di lega.**
  - `model.ts` — `makeSnapshotSchema(cfg)` = contratto di una lettura; `canonical()`.
    `snapshotSchema` / `TEAM_NAMES` restano come derivati dalla preset.
  - `penalties.ts` — regola gettoni/penalità e `makeReviewInputSchema(cfg)`, entrambe
    parametriche sulla `LeagueConfig`.
  - `archive.ts` / `reviews.ts` — letture paginate (500/pagina) e scritture via RPC.
  - `sync.ts` — chiamate firmate al connettore.
  - `performance.ts` / `lineup-analytics.ts` — calcoli puri, nessun I/O.
- **`supabase/migrations/`** — sorgente di verità dello schema. Le RPC replicano in SQL
  la validazione fatta in Zod.
- **`connector/`** — servizio Node separato (deploy Railway) che fa login su Fantacalcio
  con Playwright, cattura formazioni e competizione, notifica su Telegram ed esegue
  l'auto-sync a checkpoint. Ha un proprio `package.json`; non fa parte della build Next.
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
- Ogni tabella `fm_*` ha RLS: lettura ai membri, scrittura solo tramite RPC
  `security definer` che ricontrollano `fm_is_admin()`.
- Traffico app ⇄ connettore firmato **in entrambe le direzioni** con HMAC-SHA256 su
  `${timestamp}.${body}`, confronto con `timingSafeEqual`, finestra 120 s, risposta
  limitata a 512 KB. Non sostituire con confronti `===`.
- `/auto-sync` sul connettore accetta solo un **OIDC token GitHub Actions** verificato
  su repo, ref e workflow. `fm_auto_sync_authorized` confronta il **digest SHA-256** della
  chiave: il testo in chiaro esiste solo nelle variabili Railway.
- Messaggi d'errore verso l'utente: in italiano, senza dettagli tecnici. La diagnostica
  va in `console.error` con codice breve (es. `archive_read_failed`) e, per il
  connettore, `secretFingerprint` (12 hex) — **mai il segreto**.
- `.env*` è ignorato (eccetto `.env.example`). Credenziali Fantacalcio e token Telegram
  vivono solo su Railway.

## Convenzioni di codice

- **Stile denso deliberato**: in `app/` e `lib/` funzioni e componenti stanno su una riga,
  senza spazi attorno agli operatori, import raggruppati. Non riformattare i file
  esistenti: uniformarsi. `components/ui/` e `lib/utils.ts` seguono invece la
  formattazione originale shadcn/Prettier.
- **Italiano per l'utente, inglese per il codice**: identificatori, chiavi di log e
  commenti in inglese; label, testi UI e messaggi d'errore in italiano (apostrofo
  tipografico `’`). Date e valute con `Intl.*` e `timeZone: 'Europe/Rome'`.
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
| Elenco delle 10 squadre | `lib/league.ts` (`CHEFANTAVITAE10.teams`), `connector/server.mjs`, `connector/phase2-patch.mjs`, `prototype/collector.mjs`, SQL `fm_valid_team()` |
| Intervallo giornate 1–35 | `lib/league.ts` (`roundCount`), entrambe le migrazioni, `connector/server.mjs` |
| Pattern `source_url` della lega | `lib/league.ts` (`leaguePath`), `fm_import_observations`, `fm_save_review`, `fm_complete_auto_sync`, `fm_bot_import_snapshot` (regex SQL) |
| Scope lega/stagione/competizione | `lib/league.ts`, `fm_import_observations`, `fm_complete_auto_sync`, `fm_bot_import_snapshot`, `connector/*` |

## Storia della piattaforma

Il progetto è nato su OpenAI Sites + Cloudflare D1. Quel livello (Drizzle su D1, plugin
Vite `sites-*`, `wrangler`, `vinext`) è stato **rimosso dal repo**: l'unica persistenza è
Supabase e l'unica build è quella di Next. Se un documento o una risposta fa riferimento a
`db/`, `drizzle/`, `vite.config.ts` o `npm run install:ci`, sta descrivendo uno stato
superato — la storia git li conserva, il repo no.

## Trappole note

- `proxy.ts` è il middleware di Next 16 (esporta `proxy`, non `middleware`) e copre solo
  `/`, `/login`, `/api/*`. Nuove route protette vanno aggiunte al `matcher`.
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
- L'endpoint `/competition` del connettore **non** è in `server.mjs`: lo aggiunge
  `phase2-patch.mjs`, caricato con `--import` da `connector/package.json`. Allo stesso
  modo `phase1-patch.mjs` arricchisce le risposte dell'API Fantacalcio via monkey-patch
  di `fetch` e `Object.entries`. Leggere entrambi prima di modificare il connettore.
- `/api/performance` degrada: se il connettore non risponde usa l'ultimo snapshot
  archiviato che contenga `competition`, aggiungendo un warning esplicito.
- `tests/postgres.test.mjs` esegue le migrazioni in PGlite con ruoli e `auth.uid()`
  simulati: **ogni nuova migrazione deve poter girare lì**, quindi niente costrutti
  esclusivi di Supabase non emulabili. Usa `prototype/tests/fixture.json` come snapshot valido.
- Dentro `lib/` gli import **di valore** fra moduli usano l'estensione `.ts` esplicita
  (`from './league.ts'`): `node --experimental-strip-types` gira in ESM e non riscrive le
  estensioni, quindi senza di essa i test falliscono con `ERR_MODULE_NOT_FOUND`. Da qui
  `allowImportingTsExtensions` in `tsconfig.json`. Gli import da `app/` restano `@/lib/...`.
- L'id di `fm_observations` è calcolato con **due algoritmi divergenti**: `lib/archive.ts`
  usa `canonical()` (chiavi ordinate da JS), mentre `fm_complete_auto_sync` e
  `fm_bot_import_snapshot` usano `digest(sample::text)` (ordinamento di Postgres). Lo stesso
  snapshot importato dalla UI e dal bot ottiene due id diversi: non corrompe nulla solo
  perché la deduplica è su `(round, observed_at)`. Difetto noto, non correggerlo di sfuggita.
- `.github/workflows/auto-sync.yml` è `workflow_dispatch` (nessun cron). Il pinning
  `EzioAuditore95/fantamonitor` + `refs/heads/main` è verificato lato connettore.
- Dati reali (`lib/data/`, `prototype/data/`) sono fuori dal repo: non ricrearli né
  committare esempi con nomi o risultati veri.

## Cosa chiedere prima di fare

- Applicare migrazioni o eseguire scritture sul progetto Supabase reale.
- Modificare la regola gettoni/penalità, l'elenco squadre o lo scope lega/stagione.
- Ruotare segreti, toccare le variabili Railway/Vercel, lanciare `auto-sync` in produzione.
- Commit o push: il repo ha un remote pubblico su GitHub.
