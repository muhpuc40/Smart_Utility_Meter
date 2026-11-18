import { supabase } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { unwrap } from '../utils/db.js';
import { deviceKeyMatches } from '../utils/security.js';

// ESP32 authentication: meter_id in the URL + device key.
// The key is read from the X-Device-Key header or the ?key= query
// parameter (the SIM900A sends it in the query string).
export async function requireDevice(req, res, next) {
  const meterId = String(req.params.meterId || '').toUpperCase();
  const key = req.get('x-device-key') || req.query.key;

  if (!key || typeof key !== 'string') {
    throw ApiError.unauthorized('Device key required');
  }

  const meter = unwrap(
    await supabase
      .from('meters')
      .select('id, meter_id, device_key_hash')
      .eq('meter_id', meterId)
      .maybeSingle(),
  );

  if (!meter || !deviceKeyMatches(key, meter.device_key_hash)) {
    throw ApiError.unauthorized('Invalid meter ID or device key');
  }

  req.meter = { id: meter.id, meter_id: meter.meter_id };
  next();
}
