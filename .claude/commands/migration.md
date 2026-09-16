---
description: Crea o rivede una migrazione Supabase rispettando RLS, grant e invarianti del progetto
---

Lavora su `supabase/migrations/`. Le migrazioni sono la sorgente di verità dello schema:
la produzione è stata migrata a mano e questi file devono restare riproducibili da zero.

Prima di scrivere:

1. Leggi `supabase/migrations/202609100001_fantamonitor.sql` (tabelle `fm_*`, RLS, RPC)
   e `202609110001_round_schedule_auto_sync.sql` (calendario + auto-sync).
2. Leggi `tests/postgres.test.mjs`: ogni migrazione deve girare in PGlite con soli
   `auth.users`, `auth.uid()` e i ruoli `anon` / `authenticated` / `service_role`.

Requisiti per ogni nuovo oggetto:

- nome con prefisso `fm_`, nello schema `public`;
- `alter table ... enable row level security` **subito dopo** la creazione;
- `revoke all ... from anon, authenticated` seguito dal solo `grant select` necessario,
  più `grant all ... to service_role`;
- policy di lettura basate su `(select public.fm_is_member())`;
- ogni scrittura passa da una funzione `security definer set search_path=''` che
  ricontrolla `public.fm_is_admin()` (o `fm_auto_sync_authorized(access_key)` per il
  connettore) e solleva un errore con codice breve e stabile — le route in `app/api/`
  fanno match su quella stringa (`observation_conflict`, `review_conflict`, `admin_required`);
- una RPC = una transazione: qualsiasi conflitto deve far rollback dell'intero batch;
- nessun segreto in chiaro nel file: solo digest SHA-256, come `fm_auto_sync_authorized`.

Se la migrazione cambia un vincolo già espresso in Zod (elenco squadre, intervallo
giornate 1–35, pattern `source_url`, scope lega/stagione/competizione), aggiorna anche
`lib/model.ts` e `lib/penalties.ts` nello stesso cambiamento, e segnalalo esplicitamente.

Dopo aver scritto: esegui `npm test` e riporta l'esito. **Non** applicare nulla al
progetto Supabase reale.

$ARGUMENTS
