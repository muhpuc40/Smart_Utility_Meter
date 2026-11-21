import { supabase } from '../../config/supabase.js';
import { env } from '../../config/env.js';
import { unwrap } from '../../utils/db.js';
import { ok } from '../../utils/response.js';
import { resolveRange } from '../../services/meter.service.js';

function total(rows, field, decimals) {
  const value = rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
  return Number(value.toFixed(decimals));
}

// GET /admin/reports/daily?from=&to=   (default: last 30 days)
export async function getDailyReport(req, res) {
  const range = resolveRange(req.valid.query);

  const days = unwrap(
    await supabase.rpc('system_daily_report', {
      p_from: range.from,
      p_to: range.to,
      p_tz: env.timezone,
    }),
  );

  ok(res, {
    from: range.from,
    to: range.to,
    totals: {
      energy_kwh: total(days, 'energy_kwh', 4),
      water_l: total(days, 'water_l', 3),
      billed: total(days, 'billed', 2),
      recharged: total(days, 'recharged', 2),
      recharges: total(days, 'recharges', 0),
    },
    daily: days,
  });
}

// GET /admin/reports/top-meters?from=&to=&limit=
export async function getTopMeters(req, res) {
  const range = resolveRange(req.valid.query);

  const meters = unwrap(
    await supabase.rpc('top_meters', {
      p_from: range.from,
      p_to: range.to,
      p_limit: req.valid.query.limit,
    }),
  );

  ok(res, meters);
}
