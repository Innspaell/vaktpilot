# Vaktpilot

Vaktplan, bemanning og timer for små bedrifter. Eies og driftes av InnSpæll AS. Én installasjon betjener flere bedrifter.

## Teknologi

Next.js 15 (App Router) · TypeScript · Supabase (Postgres, innlogging, Row Level Security) · Tailwind 4 · Vercel.

## Struktur

| Mappe | Innhold |
| --- | --- |
| `supabase/migrations` | Databasen: tabeller, tilgangsregler (RLS), funksjoner for stempling og vakttildeling |
| `supabase/tests` | Databasetester mot lokal Postgres |
| `src/lib/time.ts` | Tid i Europe/Oslo: vakter over midnatt, sommer- og vintertid |
| `src/lib/holidays.ts` | Norske helligdager og høytidsaftener |
| `src/lib/staffing.ts` | Bemanning per tidsrom mot behov |
| `src/lib/warnings.ts` | Advarsler om hviletid og lange dager (stopper ikke) |
| `src/app/(app)` | Sidene i appen |

## Kom i gang

1. Lag et Supabase-prosjekt i EU-region og kjør migreringen i `supabase/migrations`.
2. Kopier `.env.example` til `.env.local` og fyll inn URL og publishable key.
3. Under Authentication → URL Configuration: legg til `https://<domenet>/auth/callback` som redirect-adresse.
4. Logg inn én gang, og gjør deg selv til plattformadmin i SQL-editoren:
   `insert into platform_admins (user_id) select id from auth.users where email = '<din e-post>';`
5. Opprett bedriften under «Ny bedrift», legg inn daglig leder som ansatt og gi hen administratortilgang.

## Tester

```bash
npm test                 # beregninger (Vitest)
# databasetester, krever lokal Postgres 16:
psql -d vp -f supabase/tests/supabase_stub.sql
psql -d vp -f supabase/migrations/20261109000001_grunnmur.sql
psql -d vp -f supabase/tests/rls_test.sql
```

## Status

Ferdig: database for alle faser, innlogging med e-postlenke, bedriftsvalg, ansattregister med avtaler og arbeidsroller, innstillinger, dashbord for administrator og ansatt, stempling.

Neste: vaktplan med kalender og bemanningsbehov, påmelding til ledige vakter, manuell timeregistrering og godkjenning, CSV-eksport.
