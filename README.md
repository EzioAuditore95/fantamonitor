# FANTAMONITOR — deploy Next.js / Supabase

Dashboard privata delle leghe con monitor formazioni, gettoni, penalità e layout mobile.

Next.js 16 / React 19 / TypeScript; Supabase gestisce Auth, PostgreSQL e isolamento RLS.
La Home mostra la propria partita, le consegne, il countdown, gli scontri diretti e il
rendimento dei calciatori. Le viste dedicate offrono competizione, statistiche, voti e
analisi delle formazioni e della panchina. Le probabilità sono stime sui risultati archiviati.

La sessione identifica l'utente; il ruolo viene risolto **nella lega richiesta**, anche
quando un utente è amministratore in una lega e partecipante in un'altra.

Istruzioni operative: [deploy/README.md](deploy/README.md).
Stato del consolidamento: [deploy/CONSOLIDATION.md](deploy/CONSOLIDATION.md).

La migrazione dal runtime Sites a Vercel e Supabase è completata: la persistenza è
Supabase e la build è quella di Next.

La sincronizzazione automatica è attiva. Un connettore su Railway accede a Fantacalcio
con una sessione autenticata e acquisisce la giornata ai checkpoint `T-24h`, `T-12h`,
`T-1h`, `T-15m` e `T+5m` rispetto al calcio d'inizio, letto dal calendario in
`fm_round_schedule`. Ogni esecuzione è registrata in `fm_auto_sync_runs`, che impedisce
esecuzioni doppie sullo stesso checkpoint, e pubblica lo stato delle formazioni su
Telegram. La lettura manuale dalla dashboard resta disponibile all'amministratore.

La pianificazione vive in Supabase (`pg_cron` → Vault/`pg_net` → scheduler Railway →
connettore). Lo scheduler resta sempre attivo; GitHub Actions offre soltanto l'avvio manuale.
Le preview richiedono un database di test distinto, disabilitano connettore e cron e
mostrano configurazione incompleta finché il progetto di test non è collegato.

## Gettoni e penalità

Ogni squadra ha un gettone non trasferibile per ciascun girone di Serie A:
andata (Serie A 1–19, lega 1–16 perché la competizione inizia alla 4ª), ritorno
(Serie A 20–38, lega 17–35). La prima omissione di ciascun girone è gratuita;
le successive costano 5 €: `max(0, omissioni_verificate - 1) * 5` per girone.
Il complessivo somma gli importi calcolati separatamente; non permette di spostare gettoni.

Le osservazioni admin presenti/assenti non generano addebiti. Gli esiti `delivered`,
`missed` e `unverified` sono registrati dopo verifica amministrativa in
`POST /api/reviews`, con scadenza trascorsa per gli esiti definitivi, fonte,
motivazione e revisione attesa. La fonte deve appartenere alla giornata di questa lega.
La registrazione è una dichiarazione dell’amministratore, non una verifica automatica del log.
La vista indica quanti esiti sono stati verificati; residui e importi sono riferiti
al registro e restano parziali finché mancano esiti. Le giornate future sono incluse
nel denominatore della copertura e non vengono classificate come omissioni.

Ogni correzione aggiunge una revisione immutabile su PostgreSQL. Un vincolo univoco impedisce
scritture concorrenti sulla stessa revisione. La ripetizione di una richiesta già
salvata è idempotente. I calcoli usano l'ultima revisione per squadra/giornata e
assegnano il gettone alla prima omissione in ordine di giornata, anche con inserimenti
retroattivi. Il registro visualizza lo storico delle revisioni. Non gestisce incassi.

Su mobile, riepiloghi e squadre diventano schede; lo storico presenta una giornata
selezionabile al posto della matrice a 35 colonne. Controlli e dialoghi sono adattati
al touch. Test della regola: `node --experimental-strip-types --test tests/penalties.test.mjs`.
