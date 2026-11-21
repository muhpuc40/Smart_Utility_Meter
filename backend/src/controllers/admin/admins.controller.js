import { supabase } from '../../config/supabase.js';
import { ApiError } from '../../utils/ApiError.js';
import { unwrap } from '../../utils/db.js';
import { created, ok } from '../../utils/response.js';
import { hashPassword } from '../../utils/security.js';
import { ADMIN_FIELDS } from '../../services/fields.js';

// GET /admin/admins
export async function listAdmins(req, res) {
  const admins = unwrap(
    await supabase.from('admins').select(ADMIN_FIELDS).order('created_at'),
  );

  ok(res, admins);
}

// POST /admin/admins
export async function createAdmin(req, res) {
  const { name, email, password } = req.valid.body;

  const admin = unwrap(
    await supabase
      .from('admins')
      .insert({ name, email, password_hash: await hashPassword(password) })
      .select(ADMIN_FIELDS)
      .single(),
  );

  created(res, admin);
}

// POST /admin/admins/:id/reset-password
export async function resetAdminPassword(req, res) {
  unwrap(
    await supabase
      .from('admins')
      .update({ password_hash: await hashPassword(req.valid.body.password) })
      .eq('id', req.valid.params.id)
      .select('id')
      .maybeSingle(),
    'Admin not found',
  );

  res.json({ success: true, message: 'Admin password reset' });
}

// PATCH /admin/admins/:id
export async function updateAdmin(req, res) {
  const { id } = req.valid.params;
  const changes = req.valid.body;

  if (id === req.admin.id && changes.is_active === false) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }

  const admin = unwrap(
    await supabase.from('admins').update(changes).eq('id', id).select(ADMIN_FIELDS).maybeSingle(),
    'Admin not found',
  );

  ok(res, admin);
}
