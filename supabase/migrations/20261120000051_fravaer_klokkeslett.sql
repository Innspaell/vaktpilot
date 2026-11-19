-- Fravær deler av dagen: fra og til klokkeslett (f.eks. legetime). partial_hours regnes ut fra dem.
alter table absence_requests add column if not exists from_time time;
alter table absence_requests add column if not exists to_time time;
alter table absence_requests drop constraint if exists absence_requests_times_check;
alter table absence_requests add constraint absence_requests_times_check
  check ((from_time is null and to_time is null) or (from_time is not null and to_time is not null and to_time > from_time and from_date = to_date));
