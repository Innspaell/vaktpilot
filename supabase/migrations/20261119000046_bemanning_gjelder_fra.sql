-- Fast bemanningsbehov kan gjelde fra og/eller til en dato (f.eks. nye ansatte fra 1. desember).
alter table staffing_templates add column if not exists valid_from date;
alter table staffing_templates add column if not exists valid_to date;
alter table staffing_templates drop constraint if exists staffing_templates_period;
alter table staffing_templates add constraint staffing_templates_period check (valid_from is null or valid_to is null or valid_to >= valid_from);
