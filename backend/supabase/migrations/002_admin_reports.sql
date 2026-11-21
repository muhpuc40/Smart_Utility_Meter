-- =====================================================================
--  MIGRATION 002: admin panel reports
--  Run once in Supabase SQL Editor (already included in schema.sql)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Admin report: per-day usage, billing and recharges (all meters)
-- Days without activity are included with zeros.
-- ---------------------------------------------------------------------

create or replace function public.system_daily_report(
  p_from  timestamptz,
  p_to    timestamptz,
  p_tz    text default 'Asia/Dhaka'
)
returns table (
  day         date,
  energy_kwh  numeric,
  water_l     numeric,
  billed      numeric,
  recharged   numeric,
  recharges   bigint
)
language sql
stable
set search_path = public
as $$
  with days as (
    select generate_series(
      (p_from at time zone p_tz)::date,
      ((p_to - interval '1 microsecond') at time zone p_tz)::date,
      interval '1 day'
    )::date as day
  ),
  usage as (
    select (created_at at time zone p_tz)::date as day,
           sum(energy_kwh) as energy, sum(water_l) as water, sum(total_cost) as cost
    from readings
    where created_at >= p_from and created_at < p_to
    group by 1
  ),
  credits as (
    select (processed_at at time zone p_tz)::date as day,
           sum(amount) as amount, count(*) as total
    from recharges
    where status = 'approved' and processed_at >= p_from and processed_at < p_to
    group by 1
  )
  select
    d.day,
    round(coalesce(u.energy, 0), 4),
    round(coalesce(u.water, 0), 3),
    round(coalesce(u.cost, 0), 2),
    coalesce(c.amount, 0),
    coalesce(c.total, 0)
  from days d
  left join usage u on u.day = d.day
  left join credits c on c.day = d.day
  order by d.day;
$$;


-- ---------------------------------------------------------------------
-- Admin report: meters with the highest billing in a period
-- ---------------------------------------------------------------------

create or replace function public.top_meters(
  p_from   timestamptz,
  p_to     timestamptz,
  p_limit  integer default 5
)
returns table (
  meter_id       text,
  consumer_id    uuid,
  consumer_name  text,
  energy_kwh     numeric,
  water_l        numeric,
  billed         numeric
)
language sql
stable
set search_path = public
as $$
  select
    m.meter_id,
    c.id,
    c.name,
    round(sum(r.energy_kwh), 4),
    round(sum(r.water_l), 3),
    round(sum(r.total_cost), 2)
  from readings r
  join meters m on m.id = r.meter_uuid
  join consumers c on c.id = m.consumer_id
  where r.created_at >= p_from and r.created_at < p_to
  group by m.meter_id, c.id, c.name
  order by 6 desc
  limit p_limit;
$$;


-- Only the backend (service_role) may call these
revoke execute on function public.system_daily_report(timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.top_meters(timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.system_daily_report(timestamptz, timestamptz, text) to service_role;
grant execute on function public.top_meters(timestamptz, timestamptz, integer) to service_role;
