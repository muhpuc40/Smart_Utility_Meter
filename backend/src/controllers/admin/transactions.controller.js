import { supabase } from '../../config/supabase.js';
import { unwrap } from '../../utils/db.js';
import { pageMeta, pageRange } from '../../utils/pagination.js';
import { ok } from '../../utils/response.js';
import { TRANSACTION_FIELDS } from '../../services/fields.js';

// GET /admin/transactions
export async function listTransactions(req, res) {
  const query = req.valid.query;
  const { from, to } = pageRange(query);

  let request = supabase
    .from('transactions')
    .select(`${TRANSACTION_FIELDS}, meter:meters!inner(meter_id), created_by_admin:admins(id, name)`, {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (query.type) request = request.eq('type', query.type);
  if (query.meter_id) request = request.eq('meter.meter_id', query.meter_id);
  if (query.from) request = request.gte('created_at', query.from.toISOString());
  if (query.to) request = request.lt('created_at', query.to.toISOString());

  const result = await request;

  ok(res, unwrap(result), pageMeta(query, result.count));
}
