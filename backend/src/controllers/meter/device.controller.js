import { supabase } from '../../config/supabase.js';
import { unwrap } from '../../utils/db.js';

// Responses to the ESP32 are flat and small so the SIM900A can read
// them in one AT+HTTPREAD:
//   {"meter_id":"MTR-0001","relay":"on","state":"active","balance":120.5}

// GET /consumer/meter/:meterId/balance?key=DEVICE_KEY
export async function getDeviceBalance(req, res) {
  const status = unwrap(await supabase.rpc('touch_meter', { p_meter_uuid: req.meter.id }));

  res.json(status);
}

// POST /consumer/meter/:meterId/consumption?key=DEVICE_KEY
export async function postConsumption(req, res) {
  const body = req.valid.body;

  const result = unwrap(
    await supabase.rpc('record_consumption', {
      p_meter_uuid: req.meter.id,
      p_voltage: body.voltage,
      p_current: body.current,
      p_power: body.power,
      p_frequency: body.frequency,
      p_pf: body.pf,
      p_flow_rate: body.flow_rate,
      p_energy_counter: body.energy_kwh,
      p_water_counter: body.water_l,
    }),
  );

  res.json(result);
}
