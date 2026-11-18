import { supabase } from '../../config/supabase.js';
import { ApiError } from '../../utils/ApiError.js';
import { unwrap } from '../../utils/db.js';
import { pageMeta, pageRange } from '../../utils/pagination.js';
import { created, ok } from '../../utils/response.js';
import { RECHARGE_FIELDS } from '../../services/fields.js';
import { getMeterUuid } from '../../services/meter.service.js';

const RECHARGE_WITH_RELATIONS = [
  RECHARGE_FIELDS,
  'meter:meters!inner(meter_id)',
  'consumer:consumers(id, name, phone)',
  'processed_by_admin:admins(id, name)',
].join(', ');

// GET /admin/recharges
export async function listRecharges(req, res) {
  const query = req.valid.query;
  const { from, to } = pageRange(query);

  let request = supabase
    .from('recharges')
    .select(RECHARGE_WITH_RELATIONS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (query.status) request = request.eq('status', query.status);
  if (query.method) request = request.eq('method', query.method);
  if (query.source) request = request.eq('source', query.source);
  if (query.meter_id) request = request.eq('meter.meter_id', query.meter_id);
  if (query.from) request = request.gte('created_at', query.from.toISOString());
  if (query.to) request = request.lt('created_at', query.to.toISOString());

  const result = await request;

  ok(res, unwrap(result), pageMeta(query, result.count));
}

// POST /admin/recharges   (admin top-up, credited immediately)
export async function createRecharge(req, res) {
  const body = req.valid.body;
  const meterUuid = await getMeterUuid(body.meter_id);

  const result = unwrap(
    await supabase.rpc('admin_recharge', {
      p_meter_uuid: meterUuid,
      p_amount: body.amount,
      p_method: body.method,
      p_reference: body.transaction_ref ?? null,
      p_note: body.note ?? null,
      p_admin_id: req.admin.id,
    }),
  );

  created(res, { meter_id: body.meter_id, ...result });
}

// PATCH /admin/recharges/:id/approve
export async function approveRecharge(req, res) {
  const result = unwrap(
    await supabase.rpc('approve_recharge', {
      p_recharge_id: req.valid.params.id,
      p_admin_id: req.admin.id,
    }),
  );

  ok(res, result);
}

// PATCH /admin/recharges/:id/reject
export async function rejectRecharge(req, res) {
  const { id } = req.valid.params;

  const recharge = unwrap(
    await supabase
      .from('recharges')
      .update({
        status: 'rejected',
        reject_reason: req.valid.body.reason ?? null,
        processed_by: req.admin.id,
        processed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select(RECHARGE_FIELDS)
      .maybeSingle(),
  );

  if (!recharge) {
    const exists = unwrap(await supabase.from('recharges').select('id').eq('id', id).maybeSingle());
    throw exists ? ApiError.conflict('Recharge has already been processed') : ApiError.notFound('Recharge not found');
  }

  ok(res, recharge);
}
