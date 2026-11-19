-- Ny tilgang: leder (driver hverdagen, men ikke innstillinger, tilganger, lønnskjøring eller abonnement).
-- Egen migrering fordi en ny enum-verdi må være lagret før den kan brukes.
alter type access_role add value if not exists 'manager';
