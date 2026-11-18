import { supabase } from '../../config/supabase.js';
import { ApiError } from '../../utils/ApiError.js';
import { unwrap } from '../../utils/db.js';
import { ok } from '../../utils/response.js';
import { signToken, verifyPassword } from '../../utils/security.js';
import { normalizePhone } from '../../validators/common.js';

const LOGIN_FIELDS = 'id, name, phone, email, status, password_hash, meter:meters!inner(meter_id)';

// identifier = phone number (01XXXXXXXXX) or meter ID (MTR-0001)
async function findByIdentifier(identifier) {
  const phone = normalizePhone(identifier);

  const request = /^01[3-9]\d{8}$/.test(phone)
    ? supabase.from('consumers').select(LOGIN_FIELDS).eq('phone', phone)
    : supabase.from('consumers').select(LOGIN_FIELDS).eq('meter.meter_id', identifier.toUpperCase());

  return unwrap(await request.maybeSingle());
}

// POST /consumer/auth/login
export async function login(req, res) {
  const { identifier, password } = req.valid.body;

  const consumer = await findByIdentifier(identifier);

  if (!consumer || !(await verifyPassword(password, consumer.password_hash))) {
    throw ApiError.unauthorized('Invalid phone/meter ID or password');
  }

  if (consumer.status !== 'active') {
    throw ApiError.forbidden('Account suspended. Contact the administrator.');
  }

  ok(res, {
    token: signToken(consumer.id, 'consumer'),
    consumer: {
      id: consumer.id,
      name: consumer.name,
      phone: consumer.phone,
      email: consumer.email,
      meter_id: consumer.meter.meter_id,
    },
  });
}
