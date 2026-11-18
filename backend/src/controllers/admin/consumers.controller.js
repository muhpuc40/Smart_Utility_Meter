import { supabase } from '../../config/supabase.js';
import { unwrap } from '../../utils/db.js';
import { pageMeta, pageRange } from '../../utils/pagination.js';
import { created, message, ok } from '../../utils/response.js';
import { generateDeviceKey, hashDeviceKey, hashPassword } from '../../utils/security.js';
import { CONSUMER_FIELDS, METER_FIELDS } from '../../services/fields.js';
import { getMeterStatus, withOnline } from '../../services/meter.service.js';

const CONSUMER_WITH_METER = `${CONSUMER_FIELDS}, meter:meters!inner(${METER_FIELDS})`;

async function findConsumer(id) {
  const consumer = unwrap(
    await supabase.from('consumers').select(CONSUMER_WITH_METER).eq('id', id).maybeSingle(),
    'Consumer not found',
  );

  return { ...consumer, meter: withOnline(consumer.meter) };
}

// GET /admin/consumers
export async function listConsumers(req, res) {
  const query = req.valid.query;
  const { from, to } = pageRange(query);

  let request = supabase
    .from('consumers')
    .select(CONSUMER_WITH_METER, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (query.status) request = request.eq('status', query.status);
  if (query.meter_id) request = request.eq('meter.meter_id', query.meter_id);

  if (query.search) {
    // Characters that would break the PostgREST "or" filter syntax are removed
    const term = query.search.replace(/[,()*%\\]/g, ' ').trim();

    if (term) {
      request = request.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
    }
  }

  const result = await request;
  const consumers = unwrap(result).map((c) => ({ ...c, meter: withOnline(c.meter) }));

  ok(res, consumers, pageMeta(query, result.count));
}

// POST /admin/consumers
// Creates the consumer and its meter. The device key is returned ONCE.
export async function createConsumer(req, res) {
  const body = req.valid.body;
  const deviceKey = generateDeviceKey();

  const result = unwrap(
    await supabase.rpc('create_consumer_with_meter', {
      p_name: body.name,
      p_phone: body.phone,
      p_email: body.email ?? null,
      p_address: body.address ?? null,
      p_password_hash: await hashPassword(body.password),
      p_meter_id: body.meter_id ?? null,
      p_device_key_hash: hashDeviceKey(deviceKey),
      p_admin_id: req.admin.id,
    }),
  );

  const consumer = await findConsumer(result.consumer_id);

  created(res, {
    consumer,
    device: {
      meter_id: result.meter_id,
      device_key: deviceKey,
      note: 'Put METER_ID and DEVICE_KEY in the ESP32 code. The key is shown only once.',
    },
  });
}

// GET /admin/consumers/:id
export async function getConsumer(req, res) {
  const consumer = await findConsumer(req.valid.params.id);
  const status = await getMeterStatus(consumer.meter.id);

  ok(res, { ...consumer, meter: { ...consumer.meter, relay: status.relay, state: status.state } });
}

// PATCH /admin/consumers/:id
export async function updateConsumer(req, res) {
  const { id } = req.valid.params;

  unwrap(
    await supabase.from('consumers').update(req.valid.body).eq('id', id).select('id').maybeSingle(),
    'Consumer not found',
  );

  ok(res, await findConsumer(id));
}

// PATCH /admin/consumers/:id/status
export async function setConsumerStatus(req, res) {
  const { id } = req.valid.params;

  unwrap(
    await supabase
      .from('consumers')
      .update({ status: req.valid.body.status })
      .eq('id', id)
      .select('id')
      .maybeSingle(),
    'Consumer not found',
  );

  ok(res, await findConsumer(id));
}

// POST /admin/consumers/:id/reset-password
export async function resetConsumerPassword(req, res) {
  unwrap(
    await supabase
      .from('consumers')
      .update({ password_hash: await hashPassword(req.valid.body.password) })
      .eq('id', req.valid.params.id)
      .select('id')
      .maybeSingle(),
    'Consumer not found',
  );

  message(res, 'Consumer password reset');
}

// DELETE /admin/consumers/:id  (also deletes the meter, readings and recharges)
export async function deleteConsumer(req, res) {
  unwrap(
    await supabase.from('consumers').delete().eq('id', req.valid.params.id).select('id').maybeSingle(),
    'Consumer not found',
  );

  message(res, 'Consumer and meter deleted');
}
