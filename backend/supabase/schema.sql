-- =====================================================================
--  SMART UTILITY METER - SUPABASE DATABASE SCHEMA
--  Run once in: Supabase Dashboard > SQL Editor > New query > Run
-- =====================================================================
--  Tables
--    admins        admin panel users
--    consumers     consumer accounts (created by admin)
--    meters        one meter per consumer (meter_id is hard-coded in ESP32)
--    tariff        single row: electricity + water rates
--    readings      every consumption report from a meter (billing log)
--    recharges     recharge requests and admin top-ups
--    transactions  balance ledger for recharges and admin adjustments
--
--  All billing is done here, inside database functions, so balance
--  updates are atomic (no lost or double deductions).
-- =====================================================================


-- ---------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- ADMINS
-- ---------------------------------------------------------------------

create table if not exists public.admins (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  email          text not null unique,
  password_hash  text not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create or replace trigger admins_updated_at
  before update on public.admins
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- CONSUMERS
-- ---------------------------------------------------------------------

create table if not exists public.consumers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  phone          text not null unique,
  email          text unique,
  address        text,
  password_hash  text not null,
  status         text not null default 'active'
                 check (status in ('active', 'suspended')),
  created_by     uuid references public.admins(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create or replace trigger consumers_updated_at
  before update on public.consumers
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- METERS
-- ---------------------------------------------------------------------

create sequence if not exists public.meter_number_seq start 1;

create table if not exists public.meters (
  id                  uuid primary key default gen_random_uuid(),
  meter_id            text not null unique,                 -- e.g. MTR-0001 (hard-coded in ESP32)
  consumer_id         uuid not null unique references public.consumers(id) on delete cascade,
  device_key_hash     text not null,                        -- sha256 of the ESP32 device key
  status              text not null default 'active'
                      check (status in ('active', 'disabled')),
  balance             numeric(12,4) not null default 0 check (balance >= 0),   -- Tk

  -- Last running counters received from the device (billing baseline)
  energy_counter_kwh  numeric(14,4),
  water_counter_l     numeric(16,4),

  -- Lifetime billed totals
  total_energy_kwh    numeric(14,4) not null default 0,
  total_water_l       numeric(16,4) not null default 0,
  total_energy_cost   numeric(14,4) not null default 0,
  total_water_cost    numeric(14,4) not null default 0,

  -- Last live values
  last_voltage        numeric(8,2),
  last_current        numeric(10,3),
  last_power          numeric(10,2),
  last_frequency      numeric(6,2),
  last_pf             numeric(4,2),
  last_flow_rate      numeric(10,3),
  last_seen_at        timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create or replace trigger meters_updated_at
  before update on public.meters
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- TARIFF (single row, id = 1)
-- ---------------------------------------------------------------------

create table if not exists public.tariff (
  id                smallint primary key default 1 check (id = 1),
  electricity_rate  numeric(10,4) not null default 8.0   check (electricity_rate >= 0),  -- Tk per kWh
  water_rate        numeric(10,4) not null default 18.0  check (water_rate >= 0),        -- Tk per 1000 L
  min_balance       numeric(10,4) not null default 0.01  check (min_balance >= 0),       -- Tk, relay OFF at or below
  updated_by        uuid references public.admins(id) on delete set null,
  updated_at        timestamptz not null default now()
);

create or replace trigger tariff_updated_at
  before update on public.tariff
  for each row execute function public.set_updated_at();

insert into public.tariff (id) values (1) on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- READINGS (one row per consumption report)
-- ---------------------------------------------------------------------

create table if not exists public.readings (
  id                  bigint generated always as identity primary key,
  meter_uuid          uuid not null references public.meters(id) on delete cascade,
  voltage             numeric(8,2),
  current             numeric(10,3),
  power               numeric(10,2),
  frequency           numeric(6,2),
  pf                  numeric(4,2),
  flow_rate           numeric(10,3),
  energy_counter_kwh  numeric(14,4),
  water_counter_l     numeric(16,4),
  energy_kwh          numeric(14,4) not null default 0,   -- billed in this report
  water_l             numeric(16,4) not null default 0,   -- billed in this report
  energy_cost         numeric(12,4) not null default 0,
  water_cost          numeric(12,4) not null default 0,
  total_cost          numeric(12,4) not null default 0,
  balance_after       numeric(12,4) not null,
  created_at          timestamptz not null default now()
);

create index if not exists readings_meter_time_idx
  on public.readings (meter_uuid, created_at desc);

create index if not exists readings_time_idx
  on public.readings (created_at);


-- ---------------------------------------------------------------------
-- RECHARGES
-- ---------------------------------------------------------------------

create table if not exists public.recharges (
  id               uuid primary key default gen_random_uuid(),
  meter_uuid       uuid not null references public.meters(id) on delete cascade,
  consumer_id      uuid not null references public.consumers(id) on delete cascade,
  amount           numeric(12,2) not null check (amount > 0),
  method           text not null
                   check (method in ('bkash', 'nagad', 'rocket', 'upay', 'card', 'bank', 'cash', 'other')),
  transaction_ref  text,
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected')),
  source           text not null check (source in ('consumer', 'admin')),
  note             text,
  reject_reason    text,
  processed_by     uuid references public.admins(id) on delete set null,
  processed_at     timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists recharges_status_idx on public.recharges (status, created_at desc);
create index if not exists recharges_meter_idx on public.recharges (meter_uuid, created_at desc);

-- The same payment reference cannot be used twice (rejected ones excluded)
create unique index if not exists recharges_method_ref_unique
  on public.recharges (method, lower(transaction_ref))
  where transaction_ref is not null and status <> 'rejected';


-- ---------------------------------------------------------------------
-- TRANSACTIONS (balance ledger: recharges + admin adjustments)
-- ---------------------------------------------------------------------

create table if not exists public.transactions (
  id              bigint generated always as identity primary key,
  meter_uuid      uuid not null references public.meters(id) on delete cascade,
  type            text not null check (type in ('recharge', 'adjustment')),
  amount          numeric(12,4) not null,          -- positive = credit, negative = debit
  balance_before  numeric(12,4) not null,
  balance_after   numeric(12,4) not null,
  recharge_id     uuid references public.recharges(id) on delete set null,
  note            text,
  created_by      uuid references public.admins(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists transactions_meter_idx on public.transactions (meter_uuid, created_at desc);


-- =====================================================================
-- FUNCTIONS
-- =====================================================================

-- ---------------------------------------------------------------------
-- Device payload: relay decision for one meter
--   state: active | no_balance | meter_disabled | consumer_suspended
--   relay: on only when state = active (default OFF)
-- ---------------------------------------------------------------------

create or replace function public.meter_status_payload(p_meter_uuid uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  m  meters%rowtype;
  c  consumers%rowtype;
  t  tariff%rowtype;
  v_state text;
begin
  select * into m from meters where id = p_meter_uuid;
  if not found then
    raise exception 'METER_NOT_FOUND';
  end if;

  select * into c from consumers where id = m.consumer_id;
  select * into t from tariff where id = 1;

  v_state := case
    when m.status <> 'active'      then 'meter_disabled'
    when c.status <> 'active'      then 'consumer_suspended'
    when m.balance > t.min_balance then 'active'
    else 'no_balance'
  end;

  return jsonb_build_object(
    'meter_id', m.meter_id,
    'relay',    case when v_state = 'active' then 'on' else 'off' end,
    'state',    v_state,
    'balance',  round(m.balance, 2)
  );
end;
$$;


-- ---------------------------------------------------------------------
-- Device GET balance: marks the meter as seen and returns its payload
-- ---------------------------------------------------------------------

create or replace function public.touch_meter(p_meter_uuid uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  update meters set last_seen_at = now() where id = p_meter_uuid;

  if not found then
    raise exception 'METER_NOT_FOUND';
  end if;

  return meter_status_payload(p_meter_uuid);
end;
$$;


-- ---------------------------------------------------------------------
-- Device POST consumption: bills usage and deducts balance atomically
--
-- The device sends RUNNING COUNTERS (PZEM energy counter in kWh and the
-- device's total water liters). The backend bills the difference from
-- the last counter it saw, so a retried or repeated report is never
-- billed twice. The first report only sets the baseline. A counter lower
-- than the last one means the device counter was reset.
-- ---------------------------------------------------------------------

create or replace function public.record_consumption(
  p_meter_uuid      uuid,
  p_voltage         numeric,
  p_current         numeric,
  p_power           numeric,
  p_frequency       numeric,
  p_pf              numeric,
  p_flow_rate       numeric,
  p_energy_counter  numeric,
  p_water_counter   numeric
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  m              meters%rowtype;
  t              tariff%rowtype;
  v_energy       numeric := 0;
  v_water        numeric := 0;
  v_energy_cost  numeric;
  v_water_cost   numeric;
  v_total_cost   numeric;
  v_balance      numeric;
begin
  select * into m from meters where id = p_meter_uuid for update;
  if not found then
    raise exception 'METER_NOT_FOUND';
  end if;

  select * into t from tariff where id = 1;

  if p_energy_counter is not null and m.energy_counter_kwh is not null then
    v_energy := case
      when p_energy_counter >= m.energy_counter_kwh then p_energy_counter - m.energy_counter_kwh
      else p_energy_counter
    end;
  end if;

  if p_water_counter is not null and m.water_counter_l is not null then
    v_water := case
      when p_water_counter >= m.water_counter_l then p_water_counter - m.water_counter_l
      else p_water_counter
    end;
  end if;

  v_energy_cost := round(v_energy * t.electricity_rate, 4);
  v_water_cost  := round(v_water * t.water_rate / 1000, 4);
  v_total_cost  := v_energy_cost + v_water_cost;

  v_balance := greatest(m.balance - v_total_cost, 0);

  if v_balance <= t.min_balance then
    v_balance := 0;
  end if;

  update meters set
    balance             = v_balance,
    energy_counter_kwh  = coalesce(p_energy_counter, energy_counter_kwh),
    water_counter_l     = coalesce(p_water_counter, water_counter_l),
    total_energy_kwh    = total_energy_kwh + v_energy,
    total_water_l       = total_water_l + v_water,
    total_energy_cost   = total_energy_cost + v_energy_cost,
    total_water_cost    = total_water_cost + v_water_cost,
    last_voltage        = p_voltage,
    last_current        = p_current,
    last_power          = p_power,
    last_frequency      = p_frequency,
    last_pf             = p_pf,
    last_flow_rate      = p_flow_rate,
    last_seen_at        = now()
  where id = m.id;

  insert into readings (
    meter_uuid, voltage, current, power, frequency, pf, flow_rate,
    energy_counter_kwh, water_counter_l,
    energy_kwh, water_l, energy_cost, water_cost, total_cost, balance_after
  ) values (
    m.id, p_voltage, p_current, p_power, p_frequency, p_pf, p_flow_rate,
    p_energy_counter, p_water_counter,
    v_energy, v_water, v_energy_cost, v_water_cost, v_total_cost, v_balance
  );

  return meter_status_payload(m.id) || jsonb_build_object(
    'energy_kwh', round(v_energy, 4),
    'water_l',    round(v_water, 3),
    'cost',       round(v_total_cost, 4)
  );
end;
$$;


-- ---------------------------------------------------------------------
-- Create consumer + meter in one transaction
-- meter_id is auto-generated (MTR-0001, MTR-0002, ...) when not given
-- ---------------------------------------------------------------------

create or replace function public.create_consumer_with_meter(
  p_name             text,
  p_phone            text,
  p_email            text,
  p_address          text,
  p_password_hash    text,
  p_meter_id         text,
  p_device_key_hash  text,
  p_admin_id         uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_consumer_id  uuid;
  v_meter_id     text := upper(nullif(trim(p_meter_id), ''));
begin
  if v_meter_id is null then
    loop
      v_meter_id := 'MTR-' || lpad(nextval('meter_number_seq')::text, 4, '0');
      exit when not exists (select 1 from meters where meter_id = v_meter_id);
    end loop;
  end if;

  insert into consumers (name, phone, email, address, password_hash, created_by)
  values (p_name, p_phone, p_email, p_address, p_password_hash, p_admin_id)
  returning id into v_consumer_id;

  insert into meters (meter_id, consumer_id, device_key_hash)
  values (v_meter_id, v_consumer_id, p_device_key_hash);

  return jsonb_build_object('consumer_id', v_consumer_id, 'meter_id', v_meter_id);
end;
$$;


-- ---------------------------------------------------------------------
-- Approve a pending recharge and credit the meter balance
-- ---------------------------------------------------------------------

create or replace function public.approve_recharge(p_recharge_id uuid, p_admin_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r         recharges%rowtype;
  v_before  numeric;
  v_after   numeric;
begin
  select * into r from recharges where id = p_recharge_id for update;
  if not found then
    raise exception 'RECHARGE_NOT_FOUND';
  end if;

  if r.status <> 'pending' then
    raise exception 'RECHARGE_NOT_PENDING';
  end if;

  select balance into v_before from meters where id = r.meter_uuid for update;

  update meters set balance = balance + r.amount
  where id = r.meter_uuid
  returning balance into v_after;

  update recharges set
    status       = 'approved',
    processed_by = p_admin_id,
    processed_at = now()
  where id = r.id;

  insert into transactions (meter_uuid, type, amount, balance_before, balance_after, recharge_id, note, created_by)
  values (r.meter_uuid, 'recharge', r.amount, v_before, v_after, r.id,
          concat_ws(' ', upper(r.method), r.transaction_ref), p_admin_id);

  return jsonb_build_object(
    'recharge_id',    r.id,
    'amount',         r.amount,
    'balance_before', round(v_before, 2),
    'balance_after',  round(v_after, 2)
  );
end;
$$;


-- ---------------------------------------------------------------------
-- Admin top-up: creates an approved recharge immediately
-- ---------------------------------------------------------------------

create or replace function public.admin_recharge(
  p_meter_uuid  uuid,
  p_amount      numeric,
  p_method      text,
  p_reference   text,
  p_note        text,
  p_admin_id    uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_consumer_id  uuid;
  v_recharge_id  uuid;
begin
  select consumer_id into v_consumer_id from meters where id = p_meter_uuid;
  if not found then
    raise exception 'METER_NOT_FOUND';
  end if;

  insert into recharges (meter_uuid, consumer_id, amount, method, transaction_ref, source, note)
  values (p_meter_uuid, v_consumer_id, p_amount, p_method, p_reference, 'admin', p_note)
  returning id into v_recharge_id;

  return approve_recharge(v_recharge_id, p_admin_id);
end;
$$;


-- ---------------------------------------------------------------------
-- Admin balance adjustment (positive = credit, negative = debit)
-- ---------------------------------------------------------------------

create or replace function public.adjust_balance(
  p_meter_uuid  uuid,
  p_amount      numeric,
  p_note        text,
  p_admin_id    uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_before  numeric;
  v_after   numeric;
begin
  select balance into v_before from meters where id = p_meter_uuid for update;
  if not found then
    raise exception 'METER_NOT_FOUND';
  end if;

  v_after := v_before + p_amount;

  if v_after < 0 then
    raise exception 'BALANCE_NEGATIVE';
  end if;

  update meters set balance = v_after where id = p_meter_uuid;

  insert into transactions (meter_uuid, type, amount, balance_before, balance_after, note, created_by)
  values (p_meter_uuid, 'adjustment', p_amount, v_before, v_after, p_note, p_admin_id);

  return jsonb_build_object(
    'amount',         p_amount,
    'balance_before', round(v_before, 2),
    'balance_after',  round(v_after, 2)
  );
end;
$$;


-- ---------------------------------------------------------------------
-- Daily usage for one meter (grouped by local day)
-- ---------------------------------------------------------------------

create or replace function public.usage_daily(
  p_meter_uuid  uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_tz          text default 'Asia/Dhaka'
)
returns table (
  day          date,
  energy_kwh   numeric,
  water_l      numeric,
  energy_cost  numeric,
  water_cost   numeric,
  total_cost   numeric
)
language sql
stable
set search_path = public
as $$
  select
    (created_at at time zone p_tz)::date  as day,
    round(sum(energy_kwh), 4)             as energy_kwh,
    round(sum(water_l), 3)                as water_l,
    round(sum(energy_cost), 2)            as energy_cost,
    round(sum(water_cost), 2)             as water_cost,
    round(sum(total_cost), 2)             as total_cost
  from readings
  where meter_uuid = p_meter_uuid
    and created_at >= p_from
    and created_at <  p_to
  group by 1
  order by 1;
$$;


-- ---------------------------------------------------------------------
-- Admin dashboard numbers
-- ---------------------------------------------------------------------

create or replace function public.dashboard_stats(
  p_online_seconds  integer default 180,
  p_tz              text default 'Asia/Dhaka'
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_today_start  timestamptz := date_trunc('day', now() at time zone p_tz) at time zone p_tz;
  v_min_balance  numeric;
begin
  select min_balance into v_min_balance from tariff where id = 1;

  return jsonb_build_object(
    'consumers', jsonb_build_object(
      'total',     (select count(*) from consumers),
      'active',    (select count(*) from consumers where status = 'active'),
      'suspended', (select count(*) from consumers where status = 'suspended')
    ),
    'meters', jsonb_build_object(
      'total',      (select count(*) from meters),
      'online',     (select count(*) from meters where last_seen_at > now() - make_interval(secs => p_online_seconds)),
      'disabled',   (select count(*) from meters where status = 'disabled'),
      'no_balance', (select count(*) from meters where balance <= v_min_balance)
    ),
    'total_balance',     (select coalesce(round(sum(balance), 2), 0) from meters),
    'pending_recharges', (select count(*) from recharges where status = 'pending'),
    'today', (
      select jsonb_build_object(
        'energy_kwh', coalesce(round(sum(energy_kwh), 4), 0),
        'water_l',    coalesce(round(sum(water_l), 3), 0),
        'billed',     coalesce(round(sum(total_cost), 2), 0)
      )
      from readings where created_at >= v_today_start
    ),
    'recharged_today', (
      select coalesce(sum(amount), 0) from recharges
      where status = 'approved' and processed_at >= v_today_start
    ),
    'recharged_total', (
      select coalesce(sum(amount), 0) from recharges where status = 'approved'
    )
  );
end;
$$;


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


-- =====================================================================
-- SECURITY
-- Only the backend (service_role key) may touch these tables/functions.
-- The public anon key gets nothing.
-- =====================================================================

alter table public.admins       enable row level security;
alter table public.consumers    enable row level security;
alter table public.meters       enable row level security;
alter table public.tariff       enable row level security;
alter table public.readings     enable row level security;
alter table public.recharges    enable row level security;
alter table public.transactions enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant all     on all tables    in schema public to service_role;
grant all     on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
