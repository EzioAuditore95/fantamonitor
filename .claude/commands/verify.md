---
description: Esegue la pipeline di validazione completa (identica alla CI) e riporta il primo fallimento
---

Esegui la validazione locale nello stesso ordine di `.github/workflows/ci.yml`.
Fermati al primo passo che fallisce e riporta l'output rilevante — non proseguire
a cascata.

1. `npm ci` (solo se `node_modules/` è assente o `package-lock.json` è cambiato)
2. `npx tsc --noEmit`
3. `node --test prototype/tests/collector.test.mjs`
4. `npm test` — include `tests/penalties.test.mjs` (regole di dominio) e
   `tests/postgres.test.mjs` (migrazioni + RLS in PGlite)
5. `cd prototype && python -m unittest discover -s tests -v`
6. `npm run build`

Poi riferisci in modo sintetico:

- esito di ogni passo (eseguito / saltato / fallito);
- se un test di `tests/penalties.test.mjs` fallisce, ricorda che quei test codificano
  la regola gettoni/penalità: il difetto è quasi sempre nel codice, non nel test;
- se `tests/postgres.test.mjs` fallisce, indica quale migrazione e quale statement,
  usando il `console.error` con `position`/`where`/`detail` che il test già stampa.

Non modificare file per far passare la pipeline a meno che non sia stato chiesto:
prima riporta la diagnosi.

$ARGUMENTS
