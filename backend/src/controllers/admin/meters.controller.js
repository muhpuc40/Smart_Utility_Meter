import { supabase } from '../../config/supabase.js';
import { unwrap } from '../../utils/db.js';
import { pageMeta, pageRange } from '../../utils/pagination.js';
import { ok } from '../../utils/response.js';
import { generateDeviceKey, hashDeviceKey } from '../../utils/security.js';
import { METER_FIELDS } from '../../services/fields.js';
import {
  getMeterStatus,
  getMeterUuid,
  getUsageSummary,
  listReadings,
  onlineCutoff,
  withOnline,
} from '../../services/meter.service.js';

const METER_WITH_CONSUMER = `${METER_FIELDS}, consumer:consumers(id, name, phone, status)`;

async function findMeter(meterId) {
  const meter = unwrap(
    await supabase.from('meters').select(METER_WITH_CONSUMER).eq('meter_id', meterId).maybeSingle(),
    'Meter not found',
  );

  const status = await getMeterStatus(meter.id);

  return { ...withOnline(meter), relay: status.relay, state: status.state };
}

// GET /admin/meters
export async function listMeters(req, res) {
  const query = req.valid.query;
  const { from, to } = pageRange(query);

  let request = supabase
    .from('meters')
    .select(METER_WITH_CONSUMER, { count: 'exact' })
    .order('meter_id')
    .range(from, to);

  if (query.status) request = request.eq('status', query.status);

  if (query.search) {
    const term = query.search.replace(/[,()*%\\]/g, ' ').trim();
    if (term) request = request.ilike('meter_id', `%${term}%`);
  }

  if (query.online === 'true') {
    request = request.gte('last_seen_at', onlineCutoff());
  }
  else if (query.online === 'false') {
    request = request.or(`last_seen_at.is.null,last_seen_at.lt.${onlineCutoff()}`);
  }

  const result = await request;

  ok(res, unwrap(result).map(withOnline), pageMeta(query, result.count));
}

// GET /admin/meters/:meterId
export async function getMeter(req, res) {
  ok(res, await findMeter(req.valid.params.meterId));
}

// PATCH /admin/meters/:meterId/status   (disabled = relay forced OFF)
export async function setMeterStatus(req, res) {
  const { meterId } = req.valid.params;

  unwrap(
    await supabase
      .from('meters')
      .update({ status: req.valid.body.status })
      .eq('meter_id', meterId)
      .select('id')
      .maybeSingle(),
    'Meter not found',
  );

  ok(res, await findMeter(meterId));
}

// POST /admin/meters/:meterId/regenerate-key
// Old key stops working immediately. Re-flash the ESP32 with the new key.
export async function regenerateDeviceKey(req, res) {
  const { meterId } = req.valid.params;
  const deviceKey = generateDeviceKey();

  unwrap(
    await supabase
      .from('meters')
      .update({ device_key_hash: hashDeviceKey(deviceKey) })
      .eq('meter_id', meterId)
      .select('id')
      .maybeSingle(),
    'Meter not found',
  );

  ok(res, {
    meter_id: meterId,
    device_key: deviceKey,
    note: 'Update DEVICE_KEY in the ESP32 code. The key is shown only once.',
  });
}

// GET /admin/meters/:meterId/readings
export async function getMeterReadings(req, res) {
  const meterUuid = await getMeterUuid(req.valid.params.meterId);
  const { data, meta } = await listReadings(meterUuid, req.valid.query);

  ok(res, data, meta);
}

// GET /admin/meters/:meterId/usage
export async function getMeterUsage(req, res) {
  const meterUuid = await getMeterUuid(req.valid.params.meterId);

  ok(res, await getUsageSummary(meterUuid, req.valid.query));
}

// POST /admin/meters/:meterId/adjust
export async function adjustMeterBalance(req, res) {
  const meterUuid = await getMeterUuid(req.valid.params.meterId);
  const { amount, note } = req.valid.body;

  const result = unwrap(
    await supabase.rpc('adjust_balance', {
      p_meter_uuid: meterUuid,
      p_amount: amount,
      p_note: note,
      p_admin_id: req.admin.id,
    }),
  );

  ok(res, result);
}
