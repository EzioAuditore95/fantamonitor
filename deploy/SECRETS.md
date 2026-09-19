# Bonifica dei segreti su Vercel

Rilevazione del 19/09/2026. L'ambiente **Production** della web app contiene 22 variabili;
il codice ne legge **cinque**. Le altre diciassette non sono lette da nulla, ma stanno
nell'ambiente di esecuzione di un'applicazione esposta su internet.

Non esiste alcuna integrazione Supabase attiva sul progetto (`vercel integration ls` →
*No resources found*): sono state aggiunte a mano e **non verranno ricreate** se rimosse.

## Cosa legge davvero la web app

Verificato con `grep -rhoE "process\.env\.[A-Z_0-9]+" app lib proxy.ts next.config.ts`:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
FANTAMONITOR_CONNECTOR_URL
FANTAMONITOR_CONNECTOR_SECRET
FM_CREDENTIAL_PUBLIC_KEY
```

Tutto il resto è rimuovibile senza toccare il codice.

## 1. Urgente — la chiave privata non deve stare qui

`FM_CREDENTIAL_PRIVATE_KEY` è presente in **Production e in Preview**.

È la metà che apre le credenziali Fantacalcio, e la ragione per cui la coppia è asimmetrica
è esattamente che la web app non ce l'abbia: è la superficie esposta a internet che accetta
input utente, e una sua compromissione non deve rivelare nulla. Con la privata nello stesso
ambiente quella garanzia non esiste.

1. Rimuoverla da `production` e da `preview`.
2. **Ruotare la coppia**, perché una chiave che è stata in un posto che non la richiedeva ha
   provenienza incerta: genera (procedura in [README.md](README.md)), imposta la pubblica su
   Vercel e la privata **solo** sul connettore Railway, ridistribuisci entrambi.
3. Il testo cifrato già in `fm_league_credentials` diventa illeggibile: l'amministratore
   ricollega l'account dal dialog. Il salvataggio azzera `last_verified_at`, quindi le leghe
   non ancora ricollegate si riconoscono a colpo d'occhio.

## 2. Togliere e basta — non sono segreti

Valori pubblici per progetto o semplici coordinate. Nessuna rotazione, nessuna conseguenza.

| Variabile | Perché è innocua |
|---|---|
| `SUPABASE_URL` | l'URL del progetto, pubblico |
| `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY` | chiavi anonime, pensate per stare nel browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem, e superata da `PUBLISHABLE_KEY` |
| `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_DATABASE` | coordinate, non credenziali |
| `CONNECTOR_URL` | un URL; la app usa `FANTAMONITOR_CONNECTOR_URL` |

## 3. Togliere **e** ruotare

Qui rimuovere non basta: essere state a lungo dove non servivano non le rende compromesse,
ma ne rende la provenienza incerta. Nessuna è letta dalla web app, quindi **la rimozione non
rompe niente**; è la rotazione che ha conseguenze, indicate qui sotto.

| Variabile | Cosa dà | Cosa si rompe ruotandola |
|---|---|---|
| `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | service-role: **scavalca ogni policy RLS** | nulla in questo progetto: nessun componente la usa |
| `SUPABASE_JWT_SECRET` | permette di **firmare qualsiasi JWT** del progetto | **tutte le sessioni attive cadono**: gli utenti rifanno l'accesso |
| `POSTGRES_PASSWORD`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING` | connessione diretta al database, fuori dalla RLS | il link della CLI (`supabase/.temp/`) va rifatto con `supabase link` |
| `EVENT_SCHEDULER_SECRET` | il bearer con cui pg_cron fa scattare i checkpoint | va aggiornato **in tre posti**: Vault (`fm_event_scheduler_secret`), servizio scheduler su Railway, e qui. Finché non coincidono, `/run` risponde 401 |

`FANTACALCIO_USERNAME` e `FANTACALCIO_PASSWORD` erano in questo elenco: risultano già rimosse.
La password di Fantacalcio esiste ora **solo** cifrata in `fm_league_credentials`.

## Ordine consigliato

1. La chiave privata (sezione 1), subito. È l'unica che invalida una garanzia di progetto.
2. La sezione 2, quando capita: nessun rischio in nessuna direzione.
3. La sezione 3 **lontano da una giornata di campionato**. `EVENT_SCHEDULER_SECRET` per
   ultima, e verificando subito dopo che la catena risponda:
   ```sh
   curl -X POST "$SCHEDULER_URL/run" -H "Authorization: Bearer <nuovo>"
   # atteso: {"status":"complete","result":{"status":"no_due_checkpoint"}}
   ```

## Preview

`preview` contiene `FM_CREDENTIAL_PRIVATE_KEY`, `EVENT_SCHEDULER_SECRET`,
`FANTAMONITOR_CONNECTOR_SECRET` e `CONNECTOR_URL`. I deployment di anteprima sono
raggiungibili da internet: vale lo stesso ragionamento della produzione, e la chiave privata
va tolta anche da lì.
