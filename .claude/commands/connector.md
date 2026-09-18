---
description: Diagnosi del connettore Railway (HMAC, login Fantacalcio, auto-sync, Telegram)
---

Contesto per intervenire su `connector/` o su un errore della catena di sincronizzazione.

**Composizione del servizio** — `connector/package.json` avvia `node server.mjs`: un solo
deployment, nessun monkey-patch. Il connettore **non contiene costanti di lega**: legge
`fm_leagues_for_bot` all'avvio e tiene le leghe attive in cache per 60 s.

- `server.mjs` — solo HTTP e routing: `POST /sync`, `/competition`, `/credential-check`
  (tutte HMAC), `POST /auto-sync` (OIDC GitHub), `POST /telegram/webhook`, `GET /health`.
- `lib/leagues.mjs` — directory delle leghe, `leagueForChat` (`chat_id → lega`),
  credenziali, `shouldReuseSession`.
- `lib/capture.mjs` — sessione riusata, login solo come fallback, cattura e competizione.
  Importa Playwright: **non importarlo dai test**.
- `lib/snapshot.mjs`, `lib/telegram.mjs`, `lib/concurrency.mjs`, `lib/fantacalcio.mjs` —
  senza Playwright, coperti da `connector/tests/connector.test.mjs` in CI.
- `lib/browser.mjs` — un Chromium riusato, mutex per lega, tetto di `CONNECTOR_MAX_CONTEXTS`.
- `lib/credentials.mjs` — apre le buste sigillate dalla web app; qui vive la chiave privata.

**Catena lato app**: `lib/sync.ts` e `app/api/performance/route.ts` firmano
`${timestamp}.${body}` con `FANTAMONITOR_CONNECTOR_SECRET`, verificano la firma della
risposta con `timingSafeEqual`, finestra 120 s, tetto 512 KB.

**Mappa dei codici d'errore** (compaiono nei log come `connector_*`):

| Codice | Significato |
|---|---|
| `connector_credentials_missing` | nessuna credenziale collegata per quella lega in `fm_league_credentials` |
| `connector_credential_key_missing` / `connector_credential_malformed` | manca `FM_CREDENTIAL_PRIVATE_KEY`, o la busta è stata sigillata con un'altra chiave |
| `unknown_league` | lo slug richiesto non è fra le leghe attive (404) |
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
   payload: aggiorna gli estrattori in `connector/lib/fantacalcio.mjs`, mai lo schema
   Zod per "farlo passare".
3. Se un messaggio Telegram è finito nel canale sbagliato, guarda `leagueForChat`: una
   chat sconosciuta deve essere ignorata, mai attribuita a una lega qualsiasi.
4. Ricorda che `/api/performance` degrada sull'ultimo snapshot archiviato con
   `competition`: un dato vecchio con warning non è un bug.

Non eseguire chiamate reali al connettore di produzione né lanciare l'auto-sync senza
richiesta esplicita.

$ARGUMENTS
