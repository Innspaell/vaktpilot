-- Hvem som er med når vaktplanen lages automatisk (f.eks. ikke ledelse).
alter table employees add column if not exists auto_plan boolean not null default true;
