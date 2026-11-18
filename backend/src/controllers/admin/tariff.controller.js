import { supabase } from '../../config/supabase.js';
import { unwrap } from '../../utils/db.js';
import { ok } from '../../utils/response.js';
import { TARIFF_FIELDS } from '../../services/fields.js';
import { getTariff } from '../../services/meter.service.js';

// GET /admin/tariff
export async function showTariff(req, res) {
  ok(res, await getTariff());
}

// PUT /admin/tariff
export async function updateTariff(req, res) {
  const tariff = unwrap(
    await supabase
      .from('tariff')
      .update({ ...req.valid.body, updated_by: req.admin.id })
      .eq('id', 1)
      .select(TARIFF_FIELDS)
      .single(),
  );

  ok(res, tariff);
}
