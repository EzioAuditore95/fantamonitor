---
description: Diagnosi del connettore Railway (HMAC, login Fantacalcio, auto-sync, Telegram)
---

Contesto per intervenire su `connector/` o su un errore della catena di sincronizzazione.

**Composizione del servizio** — `connector/package.json` avvia
`node --import ./phase1-patch.mjs --import ./phase2-patch.mjs server.mjs`:

- `server.mjs` — rotte `POST /sync` (HMAC), `POST /auto-sync` (OIDC GitHub),
  `POST /telegram/webhook`; login Playwright, cattura formazioni, notifiche Telegram.
- `phase1-patch.mjs` — monkey-patch di `fetch`/`Object.entries` per arricchire le
  risposte `apileague.fantacalcio.it` (manager, budget, stemma, maglia, giocatori).
- `phase2-patch.mjs` — aggiunge la rotta `POST /competition` (calendario, risultati,
  classifica) intercettando `http.createServer`.
- `cron.mjs` + `scheduler-server.mjs` — esecuzione a checkpoint, avviata da fuori.

**Catena lato app**: `lib/sync.ts` e `app/api/performance/route.ts` firmano
`${timestamp}.${body}` con `FANTAMONITOR_CONNECTOR_SECRET`, verificano la firma della
risposta con `timingSafeEqual`, finestra 120 s, tetto 512 KB.

**Mappa dei codici d'errore** (compaiono nei log come `connector_*`):

| Codice | Significato |
|---|---|
| `connector_credentials_missing` | mancano `FANTACALCIO_USERNAME` / `PASSWORD` su Railway |
| `connector_auth_failed` | login rifiutato o sessione scaduta → 401 verso l'app |
| `connector_round_unavailable` | la giornata richiesta non è aperta su Fantacalcio |
| `connector_team_list_missing` / `connector_team_mapping_failed` | cambiata la risposta `onboarding/v1/league/competition/teams` |
| `connector_lineup_*` | risposta `teamLineup/visualizza` non conforme (id, giornata, JSON) |
| `Firma del connettore non valida` | segreti disallineati tra app e Railway |
| `oidc_*` | token GitHub Actions fuori scope (repo, ref o workflow) |

Procedura di diagnosi:

1. Confronta i `secretFingerprint` (12 hex) nei log dell'app e del connettore: se
   differiscono, il problema è la configurazione, non il codice.
2. Se l'errore è `connector_team_*` o `connector_lineup_*`, Fantacalcio ha cambiato
   payload: aggiorna gli estrattori in `server.mjs` / `phase1-patch.mjs`, mai lo schema
   Zod per "farlo passare".
3. Ricorda che `/api/performance` degrada sull'ultimo snapshot archiviato con
   `competition`: un dato vecchio con warning non è un bug.

Non eseguire chiamate reali al connettore di produzione né lanciare l'auto-sync senza
richiesta esplicita.

$ARGUMENTS
