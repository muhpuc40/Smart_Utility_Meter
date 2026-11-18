import { supabase } from '../../config/supabase.js';
import { ApiError } from '../../utils/ApiError.js';
import { unwrap } from '../../utils/db.js';
import { message, ok } from '../../utils/response.js';
import { hashPassword, signToken, verifyPassword } from '../../utils/security.js';

// POST /admin/auth/login
export async function login(req, res) {
  const { email, password } = req.valid.body;

  const admin = unwrap(
    await supabase
      .from('admins')
      .select('id, name, email, password_hash, is_active')
      .eq('email', email)
      .maybeSingle(),
  );

  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (!admin.is_active) {
    throw ApiError.forbidden('Admin account is inactive');
  }

  ok(res, {
    token: signToken(admin.id, 'admin'),
    admin: { id: admin.id, name: admin.name, email: admin.email },
  });
}

// GET /admin/auth/me
export function me(req, res) {
  ok(res, req.admin);
}

// PATCH /admin/auth/password
export async function changePassword(req, res) {
  const { current_password, new_password } = req.valid.body;

  const admin = unwrap(
    await supabase.from('admins').select('password_hash').eq('id', req.admin.id).single(),
  );

  if (!(await verifyPassword(current_password, admin.password_hash))) {
    throw ApiError.unauthorized('Current password is incorrect');
  }

  unwrap(
    await supabase
      .from('admins')
      .update({ password_hash: await hashPassword(new_password) })
      .eq('id', req.admin.id),
  );

  message(res, 'Password changed');
}
