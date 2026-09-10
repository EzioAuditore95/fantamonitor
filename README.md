# FANTAMONITOR

Web app per monitorare le formazioni di una lega privata: situazione per giornata,
registro delle osservazioni, matrice squadre × giornate, dettaglio squadra e import/export JSON.

## Stato del progetto

- Web app React / TypeScript, Vinext, Cloudflare Workers e D1.
- Accesso alla versione ospitata tramite ChatGPT, limitato dal servizio al proprietario.
- Osservazioni persistenti importate via JSON, validate e deduplicate.
- Connettore browser assistito incluso in `prototype/collector.mjs`.
- L'esecuzione autonoma su GitHub Actions e la raccolta automatica di log, scadenze,
  punteggi e risultati non sono implementate. Il pulsante Rileggi dati rilegge l'archivio.
- Gli abbinamenti della prima giornata sono un'istantanea del 9 settembre 2026.

## Dati e riservatezza

Il repository contiene il codice, la configurazione della lega e fixture sintetiche
per i test. Le osservazioni reali, il database SQLite e i log acquisiti sono esclusi
da Git. `INITIAL_ARCHIVE_JSON` è un valore server riservato della versione ospitata;
non contiene password o cookie. I nuovi import vengono salvati su D1.

Senza archivio iniziale e senza importazioni, l'app mostra correttamente uno stato vuoto.
Le fixture di test non attestano il comportamento dei partecipanti.

## Sviluppo

Richiede Node 22.13+ e Python 3.11+ per i test del prototipo.

```sh
npm ci
npm run db:generate
npm run build
npx tsc --noEmit
node --test prototype/tests/collector.test.mjs
cd prototype
python3 -m unittest discover -s tests -v
```

Le migrazioni in `drizzle/` vengono applicate alla pubblicazione. Non modificarne
retroattivamente una già applicata. Il sito usa la binding logica `DB`.
L'autenticazione e i dati non sono compatibili con un hosting puramente statico:
questo progetto non è distribuibile direttamente su GitHub Pages.

## API

`GET /api/archive`: letture archiviate e log iniziali. Richiede identità autenticata.
`POST /api/archive`: una lettura o array di letture (max 100; 256 KiB totali),
Content-Type `application/json`, stessa origine e identità autenticata.
Tutto il batch viene validato prima del salvataggio. Le scritture D1 sono atomiche.
Un conflitto di contenuto allo stesso istante non sovrascrive lo storico.
Il formato è descritto e validato in `lib/model.ts`.

## Interpretazione

Presenza nel riepilogo, autore e puntualità sono fatti diversi. Non viene certificata
un'omissione senza scadenza e log attribuito. Il timestamp di acquisizione non è
quello di invio. I dati obsoleti e gli errori vengono segnalati senza inventare assenze.

## Struttura

- `app/dashboard.tsx`: interfaccia responsive e dettaglio delle squadre.
- `app/api/archive/route.ts`: autenticazione e API import/export.
- `lib/archive.ts`: archivio iniziale server e letture D1.
- `lib/model.ts`: schema di validazione e funzioni pure.
- `db/schema.ts`, `drizzle/`: schema e migrazioni.
- `prototype/`: parser assistito e registro SQLite originali, con test sintetici.

La pubblicazione Sites è gestita separatamente. Un push su GitHub non aggiorna
automaticamente il sito ospitato. La CI esegue compilazione e controlli del codice.

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

Ogni correzione aggiunge una revisione immutabile su D1. Un vincolo univoco impedisce
scritture concorrenti sulla stessa revisione. La ripetizione di una richiesta già
salvata è idempotente. I calcoli usano l'ultima revisione per squadra/giornata e
assegnano il gettone alla prima omissione in ordine di giornata, anche con inserimenti
retroattivi. Il registro visualizza lo storico delle revisioni. Non gestisce incassi.

Su mobile, riepiloghi e squadre diventano schede; lo storico presenta una giornata
selezionabile al posto della matrice a 35 colonne. Controlli e dialoghi sono adattati
al touch. Test della regola: `node --experimental-strip-types --test tests/penalties.test.mjs`.
