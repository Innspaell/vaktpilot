#!/usr/bin/env bash
# Databasetester: alle migreringer mot en tom Postgres med en enkel etterligning av Supabase, deretter tilgangstestene.
# Bruk: PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=... scripts/db-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
P="psql -q -v ON_ERROR_STOP=1"
$P -d postgres -c "drop database if exists vp" -c "create database vp" >/dev/null
$P -d vp -f supabase/tests/supabase_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do
  # Lagring (storage) og faste jobber (pg_cron) finnes bare hos Supabase
  if ! $P -d vp -f "$f" >/dev/null 2>/tmp/mig.err; then
    case "$f" in *logo*|*faste_jobber*|*lagring*) ;; *) echo "MIGRERING FEILET: $f"; cat /tmp/mig.err; exit 1 ;; esac
  fi
done
out=$(psql -d vp -f supabase/tests/rls_test.sql 2>&1 | tail -5)
echo "$out"
grep -q "ALLE DATABASETESTER OK" <<<"$out"
