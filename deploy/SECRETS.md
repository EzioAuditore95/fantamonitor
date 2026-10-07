# Segreti e ambienti — verifica del 7 ottobre 2026

## Inventario della web app

Produzione su Vercel usa:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
- `FANTAMONITOR_CONNECTOR_URL`, `FANTAMONITOR_CONNECTOR_SECRET`;
- `FM_CREDENTIAL_PUBLIC_KEY`, `FM_CREDENTIAL_KEY_VERSION`;
- `CRON_SECRET`.

Una preview usa soltanto il database di test e i riferimenti
`FM_PREVIEW_SUPABASE_PROJECT_REF` / `FM_PRODUCTION_SUPABASE_PROJECT_REF`.
Il primo deve corrispondere all'URL Supabase e differire dal secondo.
Connettore, cron e configurazione delle credenziali Fantacalcio sono disabilitati.

La chiave privata Fantacalcio appartiene esclusivamente al connettore Railway.
`EVENT_SCHEDULER_SECRET` appartiene al servizio scheduler e al Vault Supabase.
`AUTO_SYNC_DB_SECRET` appartiene al connettore; nel database resta soltanto il digest.
Il token Telegram resta sul connettore, mai sulla web app.

## Bonifica verificata

La rilevazione API del 7 ottobre contraddiceva la precedente nota di rimozione:
`FM_CREDENTIAL_PRIVATE_KEY` risultava ancora in produzione e preview,
insieme a variabili dello scheduler e collegamenti produttivi nella preview.

Sono stati svuotati i valori di:
- `FM_CREDENTIAL_PRIVATE_KEY` in produzione e preview;
- `EVENT_SCHEDULER_SECRET` in produzione e preview;
- `CONNECTOR_URL` e `FANTAMONITOR_CONNECTOR_SECRET` in preview.

Questo neutralizza i valori nelle nuove build, ma **non cancella le voci**
e **non modifica i deployment già pubblicati**. L'API installata non offre
cancellazione; dashboard o CLI autenticata devono eliminare le voci vuote.
La produzione è stata ridistribuita con le nuove chiavi (commit `dd6eb05`). La preview
`8323dd6` mostra configurazione incompleta e non offre accesso al database produttivo.
I vecchi deployment non devono essere promossi: conservano configurazioni precedenti.

## Rotazione coordinata

| Credenziale | Destinazioni da aggiornare insieme | Stato |
|---|---|---|
| Coppia RSA Fantacalcio | pubblica/versione Vercel; privata connettore | versione 3 distribuita; ricollegamento admin e acquisizione giornata 3 riusciti |
| HMAC | Vercel, connettore, scheduler | ruotato; inoltro scheduler/connettore HTTP 200 |
| Bearer scheduler | scheduler Railway, Vault | ruotato; chiamata dal Vault HTTP 200 |
| Chiave auto-sync | connettore, digest PostgreSQL | ruotata; migrazione applicata, inoltro senza checkpoint dovuti riuscito |
| Chiave voti Serie A | CRON_SECRET Vercel, digest PostgreSQL | ruotata e distribuita; collaudo acquisizione pendente |
| Chiavi privilegiate Supabase e password PostgreSQL | dipendenze effettivamente ancora attive | da verificare/ruotare tramite gestione Supabase |

Sequenza: scegliere una finestra senza checkpoint, sospendere l'auto-sync,
preparare tutti i valori, aggiornare servizi/Vault/digest, ridistribuire,
ricollegare Fantacalcio e verificare, poi riattivare la pianificazione.
Non stampare valori, non scriverli nel repository e non usare vecchie credenziali
durante un rollback. Le migrazioni conservano esclusivamente digest SHA-256.

## Limiti verificati

- Il connettore Supabase non espone `get_cost`: database preview non provisionato.
  Finché manca, la preview mostra configurazione incompleta e non accede alla produzione.
- Non sono disponibili operazioni per ruotare/disabilitare le chiavi API privilegiate,
  ruotare JWT o cambiare la password database. Non leggere segreti dal catalogo Auth.
  Verificare le dipendenze dal pannello Supabase prima di disabilitare chiavi legacy.
- Invalidare JWT/sessioni richiede una finestra concordata; non confondere la rimozione
  da Vercel con la revoca presso Supabase.

Gli esiti di rilascio e collaudo sono registrati in [CONSOLIDATION.md](CONSOLIDATION.md).
