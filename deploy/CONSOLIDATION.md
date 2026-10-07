# Consolidamento — 7 ottobre 2026

## Codice e verifiche

- La sessione restituisce soltanto l'identità. Il ruolo e `leagueId` vengono letti dalla
  membership della lega richiesta; `canManage` e tutte le API usano quel ruolo.
- Test delle API: admin in A/viewer in B, ordine invertito e ruoli scambiati; lettura
  consentita in entrambe, 403 prima di chiamare il connettore per il viewer, 404 senza
  membership. Test PostgreSQL indipendenti verificano RLS e RPC anche con ruoli invertiti.
- Le preview rifiutano configurazioni Supabase non esplicitamente isolate e bloccano
  connettore, configurazione credenziali e cron anche se ricevono variabili produttive.
- TypeScript, lint, test JavaScript, connettore, prototipo Python e build locale superati.
  Il Python del sistema non era disponibile: usato il runtime incluso nell'app.

## Servizi verificati

- Supabase `fantamonitor` sano. Una lega attiva; nessun utente con ruoli diversi tra leghe.
- Scheduler Railway: sospensione disabilitata, filtri di deploy corretti, deployment
  riuscito; `/health` risponde 200. Anche il connettore risponde 200 su `/health`.
- Ultimi cinque checkpoint della giornata 2 riusciti; watchdog attivo.
- Prossimo checkpoint: giornata 3, T-24h, **9 ottobre 2026 alle 15:00 Europe/Rome**,
  con retry cinque minuti dopo. La sua esecuzione resta da verificare dopo quell'orario.

## Attività in corso o pendenti

- Rotazione coordinata delle chiavi: materiale generato, migrazione dei soli digest
  verificata in PGlite. Stato dei singoli passaggi in `SECRETS.md`.
- I valori privati/superflui su Vercel sono stati svuotati tramite API. La cancellazione
  delle voci richiede dashboard o CLI autenticata; l'API installata offre solo modifica.
- Provisioning del database preview sospeso: `get_cost` del connettore Supabase risulta
  non disponibile. Nessuna risorsa a pagamento creata senza il preventivo richiesto.
- Rotazioni delle chiavi privilegiate Supabase e password database richiedono strumenti
  di gestione non disponibili nel connettore; non dichiarate completate.
- Rilascio del codice, CI remota e collaudo autenticato saranno registrati dopo verifica.

Nessun monitor ricorrente creato. Nessun calendario o regolamento modificato.
