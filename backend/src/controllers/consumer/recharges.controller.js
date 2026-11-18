import { supabase } from '../../config/supabase.js';
import { env } from '../../config/env.js';
import { unwrap } from '../../utils/db.js';
import { pageMeta, pageRange } from '../../utils/pagination.js';
import { created, ok } from '../../utils/response.js';
import { RECHARGE_FIELDS } from '../../services/fields.js';

// POST /consumer/recharges
// Saved as "pending" until an admin approves it
// (or credited immediately when AUTO_APPROVE_RECHARGE=true).
export async function createRecharge(req, res) {
  const { amount, method, transaction_ref, note } = req.valid.body;

  const recharge = unwrap(
    await supabase
      .from('recharges')
      .insert({
        meter_uuid: req.consumer.meter.id,
        consumer_id: req.consumer.id,
        amount,
        method,
        transaction_ref,
        note: note ?? null,
        source: 'consumer',
      })
      .select(RECHARGE_FIELDS)
      .single(),
  );

  if (!env.autoApproveRecharge) {
    return created(res, recharge);
  }

  const result = unwrap(
    await supabase.rpc('approve_recharge', { p_recharge_id: recharge.id, p_admin_id: null }),
  );

  created(res, { ...recharge, status: 'approved', balance_after: result.balance_after });
}

// GET /consumer/recharges
export async function listRecharges(req, res) {
  const query = req.valid.query;
  const { from, to } = pageRange(query);

  let request = supabase
    .from('recharges')
    .select(RECHARGE_FIELDS, { count: 'exact' })
    .eq('consumer_id', req.consumer.id)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (query.status) request = request.eq('status', query.status);

  const result = await request;

  ok(res, unwrap(result), pageMeta(query, result.count));
}
