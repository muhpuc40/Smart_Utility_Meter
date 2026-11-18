import { supabase } from '../../config/supabase.js';
import { ApiError } from '../../utils/ApiError.js';
import { unwrap } from '../../utils/db.js';
import { message, ok } from '../../utils/response.js';
import { hashPassword, verifyPassword } from '../../utils/security.js';
import { CONSUMER_FIELDS, METER_FIELDS } from '../../services/fields.js';
import {
  getMeterStatus,
  getTariff,
  getUsageSummary,
  isOnline,
  listMeterTransactions,
  listReadings,
  withOnline,
} from '../../services/meter.service.js';

// GET /consumer/profile
export async function getProfile(req, res) {
  const consumer = unwrap(
    await supabase
      .from('consumers')
      .select(`${CONSUMER_FIELDS}, meter:meters!inner(${METER_FIELDS})`)
      .eq('id', req.consumer.id)
      .single(),
  );

  const [status, tariff] = await Promise.all([getMeterStatus(consumer.meter.id), getTariff()]);

  ok(res, {
    ...consumer,
    meter: { ...withOnline(consumer.meter), relay: status.relay, state: status.state },
    tariff,
  });
}

// PATCH /consumer/profile   (phone and meter can only be changed by admin)
export async function updateProfile(req, res) {
  const consumer = unwrap(
    await supabase
      .from('consumers')
      .update(req.valid.body)
      .eq('id', req.consumer.id)
      .select(CONSUMER_FIELDS)
      .single(),
  );

  ok(res, consumer);
}

// PATCH /consumer/password
export async function changePassword(req, res) {
  const { current_password, new_password } = req.valid.body;

  const consumer = unwrap(
    await supabase.from('consumers').select('password_hash').eq('id', req.consumer.id).single(),
  );

  if (!(await verifyPassword(current_password, consumer.password_hash))) {
    throw ApiError.unauthorized('Current password is incorrect');
  }

  unwrap(
    await supabase
      .from('consumers')
      .update({ password_hash: await hashPassword(new_password) })
      .eq('id', req.consumer.id),
  );

  message(res, 'Password changed');
}

// GET /consumer/balance
export async function getBalance(req, res) {
  const meterUuid = req.consumer.meter.id;

  const [status, meter] = await Promise.all([
    getMeterStatus(meterUuid),
    supabase.from('meters').select('last_seen_at').eq('id', meterUuid).single().then(unwrap),
  ]);

  ok(res, {
    ...status,
    last_seen_at: meter.last_seen_at,
    online: isOnline(meter.last_seen_at),
  });
}

// GET /consumer/usage/summary
export async function getUsage(req, res) {
  ok(res, await getUsageSummary(req.consumer.meter.id, req.valid.query));
}

// GET /consumer/usage/readings
export async function getReadings(req, res) {
  const { data, meta } = await listReadings(req.consumer.meter.id, req.valid.query);
  ok(res, data, meta);
}

// GET /consumer/transactions
export async function getTransactions(req, res) {
  const { data, meta } = await listMeterTransactions(req.consumer.meter.id, req.valid.query);
  ok(res, data, meta);
}
