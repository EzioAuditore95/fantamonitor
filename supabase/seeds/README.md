# Seed

Lo schema è multi-tenant, la UI no: leghe e membership si creano da qui, non da una
schermata. È una scelta, non una mancanza — evita wizard, gestione membri e moderazione
in un progetto che serve due o tre leghe.

- [`new-league.sql`](new-league.sql) — aggiunge una lega con squadre, calendario e membri.
  Si modifica solo il blocco `parametri` in cima. Si ferma da solo se la lega esiste già.

Dopo il seed, l'amministratore collega l'account Fantacalcio dal dialog **Account
Fantacalcio** nel banner della dashboard: le credenziali non passano mai da SQL.
