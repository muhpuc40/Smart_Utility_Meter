import { supabase } from '../config/supabase.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { unwrap } from '../utils/db.js';
import { pageMeta, pageRange } from '../utils/pagination.js';
import { READING_FIELDS, TARIFF_FIELDS, TRANSACTION_FIELDS } from './fields.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;

// ------------------------------------------------------------
// Online status
// ------------------------------------------------------------

export function onlineCutoff() {
  return new Date(Date.now() - env.meterOnlineSeconds * 1000).toISOString();
}

export function isOnline(lastSeenAt) {
  return Boolean(lastSeenAt) && new Date(lastSeenAt).toISOString() >= onlineCutoff();
}

export function withOnline(meter) {
  return meter ? { ...meter, online: isOnline(meter.last_seen_at) } : meter;
}

// ------------------------------------------------------------
// Lookups
// ------------------------------------------------------------

// meter_id (e.g. MTR-0001) -> internal uuid
export async function getMeterUuid(meterId) {
  const meter = unwrap(
    await supabase.from('meters').select('id').eq('meter_id', meterId).maybeSingle(),
    'Meter not found',
  );

  return meter.id;
}

// { meter_id, relay, state, balance }
export async function getMeterStatus(meterUuid) {
  return unwrap(await supabase.rpc('meter_status_payload', { p_meter_uuid: meterUuid }));
}

export async function getTariff() {
  return unwrap(
    await supabase.from('tariff').select(TARIFF_FIELDS).eq('id', 1).single(),
  );
}

// ------------------------------------------------------------
// Date range (default: last 30 days)
// ------------------------------------------------------------

export function resolveRange({ from, to }) {
  const end = to ?? new Date();
  const start = from ?? new Date(end.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);

  if (start >= end) {
    throw ApiError.unprocessable('"from" must be earlier than "to"');
  }

  return { from: start.toISOString(), to: end.toISOString() };
}

// ------------------------------------------------------------
// Usage + readings
// ------------------------------------------------------------

function sum(rows, field, decimals) {
  const total = rows.reduce((acc, row) => acc + Number(row[field] || 0), 0);
  return Number(total.toFixed(decimals));
}

export async function getUsageSummary(meterUuid, query) {
  const range = resolveRange(query);

  const days = unwrap(
    await supabase.rpc('usage_daily', {
      p_meter_uuid: meterUuid,
      p_from: range.from,
      p_to: range.to,
      p_tz: env.timezone,
    }),
  );

  return {
    from: range.from,
    to: range.to,
    totals: {
      energy_kwh: sum(days, 'energy_kwh', 4),
      water_l: sum(days, 'water_l', 3),
      energy_cost: sum(days, 'energy_cost', 2),
      water_cost: sum(days, 'water_cost', 2),
      total_cost: sum(days, 'total_cost', 2),
    },
    daily: days,
  };
}

export async function listReadings(meterUuid, query) {
  const range = resolveRange(query);
  const { from, to } = pageRange(query);

  const result = await supabase
    .from('readings')
    .select(READING_FIELDS, { count: 'exact' })
    .eq('meter_uuid', meterUuid)
    .gte('created_at', range.from)
    .lt('created_at', range.to)
    .order('created_at', { ascending: false })
    .range(from, to);

  return { data: unwrap(result), meta: pageMeta(query, result.count) };
}

export async function listMeterTransactions(meterUuid, query) {
  const { from, to } = pageRange(query);

  let request = supabase
    .from('transactions')
    .select(TRANSACTION_FIELDS, { count: 'exact' })
    .eq('meter_uuid', meterUuid)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (query.from) request = request.gte('created_at', query.from.toISOString());
  if (query.to) request = request.lt('created_at', query.to.toISOString());

  const result = await request;

  return { data: unwrap(result), meta: pageMeta(query, result.count) };
}
