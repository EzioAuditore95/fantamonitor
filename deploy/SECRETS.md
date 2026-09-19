# Bonifica dei segreti su Vercel

Rilevazione del 19/09/2026: l'ambiente **Production** conteneva 22 variabili e il codice ne
legge cinque. **Bonifica eseguita lo stesso giorno**: le diciassette non lette sono state
rimosse e la produzione è stata ridistribuita — togliere una variabile non la toglie
dall'istanza già in esecuzione, serve un redeploy.

Stato attuale: `production` ha **solo le cinque lette**; `preview` ne ha tre.
**Le rotazioni elencate sotto restano da fare**: come avverte Vercel stesso, *removing this
variable does not revoke the credential*. Rimuovere riduce l'esposizione, non annulla il
fatto che quelle chiavi siano state dove non servivano.

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

~~1. Rimuoverla da `production` e da `preview`.~~ **Fatto il 19/09**, con redeploy.
~~2. Ruotare la coppia.~~ **Fatta il 19/09**: coppia RSA-3072 nuova, pubblica su Vercel,
privata solo sul connettore, entrambi ridistribuiti. Verificato che la busta nuova **non**
si apre con la chiave vecchia.
~~3. Il testo cifrato diventa illeggibile.~~ Azzerato *prima* di sostituire le chiavi, così
non è mai esistito uno stato "collegato ma illeggibile" che mentisse nell'interfaccia:
`key_version` è a 2 e lo stato è "non collegato" finché l'amministratore non ricollega.

**Limite noto**: `POST /api/credentials` scrive sempre `version: 1`, quindi `key_version` non
traccia davvero le rotazioni — il 2 attuale è stato scritto a mano. Se le rotazioni
diventeranno frequenti, la versione va presa dalla configurazione invece che dal codice.

## 2. Rimosse — non erano segreti

Valori pubblici per progetto o semplici coordinate. Nessuna rotazione, nessuna conseguenza.

| Variabile | Perché è innocua |
|---|---|
| `SUPABASE_URL` | l'URL del progetto, pubblico |
| `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY` | chiavi anonime, pensate per stare nel browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem, e superata da `PUBLISHABLE_KEY` |
| `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_DATABASE` | coordinate, non credenziali |
| `CONNECTOR_URL` | un URL; la app usa `FANTAMONITOR_CONNECTOR_URL` |

## 3. Rimosse, ma **da ruotare**

Rimosse da Vercel il 19/09, **ma non ancora ruotate**. Essere state a lungo dove non
servivano non le rende compromesse, ma ne rende la provenienza incerta. La rimozione non ha
rotto niente — nessuna era letta dalla web app; è la rotazione ad avere conseguenze.

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

La chiave privata è stata tolta anche da `preview`. Restano `EVENT_SCHEDULER_SECRET`,
`FANTAMONITOR_CONNECTOR_SECRET` e `CONNECTOR_URL`.

`EVENT_SCHEDULER_SECRET` **non serve in preview**: i due posti che devono coincidere sono il
Vault e lo scheduler su Railway. Va tolta. `FANTAMONITOR_CONNECTOR_SECRET` serve solo se si
vuole che un deployment di anteprima parli col connettore di produzione — il che è una
domanda a sé, perché significa che un'anteprima può far partire catture reali.
