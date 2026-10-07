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
- PR [#5](https://github.com/EzioAuditore95/fantamonitor/pull/5) integrata. CI sul commit
  `dd6eb05eae3412ab95ae611c2e98d1cfa02021c8`
  [riuscita](https://github.com/EzioAuditore95/fantamonitor/actions/runs/37617235776).
- Registro operativo e timestamp migrazione aggiornati in `52268e4`: CI
  [riuscita](https://github.com/EzioAuditore95/fantamonitor/actions/runs/37618656925),
  deployment Vercel pronto.

## Servizi verificati

- Supabase `fantamonitor` sano. Una lega attiva; nessun utente con ruoli diversi tra leghe.
- Scheduler Railway: sospensione disabilitata, filtri di deploy corretti, deployment
  riuscito; `/health` risponde 200. Anche il connettore risponde 200 su `/health`.
- Produzione Vercel `fantamonitor.vercel.app`: nuovo commit pronto, pagina HTTP 200.
- Collaudo Vault → scheduler → connettore: HTTP 200, `no_due_checkpoint`; nessuna
  acquisizione o pubblicazione Telegram provocata da questa chiamata.
- Richieste senza credenziali a scheduler, connettore e cron: HTTP 401. Digest Vault,
  auto-sync e cron corrispondono alla rotazione; chiavi errate rifiutate dalle RPC.
- Ricollegamento admin con RSA versione 3 seguito da una nuova sessione e acquisizione
  della giornata 3, salvata il 7 ottobre alle 12:01:33 UTC. Auto-sync riattivato.
- Preview `fantamonitor-hu2dh1cul-ezioauditore-95.vercel.app`: HTTP 200 con configurazione
  incompleta, senza form di login. Test automatici verificano blocchi di cron e connettore.
- Ultimi cinque checkpoint della giornata 2 riusciti; watchdog attivo.
- Prossimo checkpoint: giornata 3, T-24h, **9 ottobre 2026 alle 15:00 Europe/Rome**,
  con retry cinque minuti dopo. La sua esecuzione resta da verificare dopo quell'orario.
  Sono presenti esattamente un job principale e un retry attivi, oltre al watchdog.

## Attività in corso o pendenti

- RSA versione 3, HMAC, bearer scheduler/Vault, chiavi auto-sync e cron distribuiti;
  migrazione dei digest applicata come `20261007115128_rotate_connector_and_cron_keys`.
  Auto-sync sospeso durante il ricollegamento e ripristinato dopo login/acquisizione.
  Conferma visiva di archivio, voti e nuova consegna Telegram ancora pendente.
- I valori privati/superflui su Vercel sono stati svuotati tramite API. La cancellazione
  delle voci richiede dashboard o CLI autenticata; l'API installata offre solo modifica.
- Provisioning del database preview sospeso: `get_cost` del connettore Supabase risulta
  non disponibile. Nessuna risorsa a pagamento creata senza il preventivo richiesto.
- Rotazioni delle chiavi privilegiate Supabase e password database richiedono strumenti
  di gestione non disponibili nel connettore; non dichiarate completate.
- L'API Railway rifiuta il collegamento di `railway.scheduler.json` perché deprecato.
  Sospensione e filtri sono stati corretti direttamente sul servizio; il file conserva
  i parametri di riferimento, senza dichiararlo collegato.

Nessun monitor ricorrente creato. Nessun calendario o regolamento modificato.
