import { supabase } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { unwrap } from '../utils/db.js';
import { verifyToken } from '../utils/security.js';

function readToken(req, role) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw ApiError.unauthorized('Missing Bearer token');
  }

  let payload;

  try {
    payload = verifyToken(token);
  }
  catch {
    throw ApiError.unauthorized('Invalid or expired token');
  }

  if (payload.role !== role) {
    throw ApiError.forbidden(`This endpoint requires a ${role} token`);
  }

  return payload;
}

export async function requireAdmin(req, res, next) {
  const payload = readToken(req, 'admin');

  const admin = unwrap(
    await supabase
      .from('admins')
      .select('id, name, email, is_active')
      .eq('id', payload.sub)
      .maybeSingle(),
  );

  if (!admin || !admin.is_active) {
    throw ApiError.unauthorized('Admin account not found or inactive');
  }

  req.admin = admin;
  next();
}

export async function requireConsumer(req, res, next) {
  const payload = readToken(req, 'consumer');

  const consumer = unwrap(
    await supabase
      .from('consumers')
      .select('id, name, phone, status, meter:meters(id, meter_id)')
      .eq('id', payload.sub)
      .maybeSingle(),
  );

  if (!consumer) {
    throw ApiError.unauthorized('Consumer account not found');
  }

  if (consumer.status !== 'active') {
    throw ApiError.forbidden('Account suspended. Contact the administrator.');
  }

  req.consumer = consumer;
  next();
}
