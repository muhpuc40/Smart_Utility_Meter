import { supabase } from '../../config/supabase.js';
import { env } from '../../config/env.js';
import { unwrap } from '../../utils/db.js';
import { ok } from '../../utils/response.js';

// GET /admin/dashboard
export async function getDashboard(req, res) {
  const stats = unwrap(
    await supabase.rpc('dashboard_stats', {
      p_online_seconds: env.meterOnlineSeconds,
      p_tz: env.timezone,
    }),
  );

  ok(res, stats);
}
