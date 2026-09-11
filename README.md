# FANTAMONITOR — deploy Next.js / Supabase

Dashboard della lega con gettoni, penalità e layout mobile.

Istruzioni operative: [deploy/README.md](deploy/README.md).

Questo branch è la migrazione dal runtime Sites a Vercel e Supabase.
La sincronizzazione automatica Fantacalcio su Railway non è ancora implementata.

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
