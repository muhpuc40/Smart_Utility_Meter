import { z } from 'zod';

// PZEM live values: number, or null when the sensor could not be read
const live = z.number().finite().nullable().default(null);

// Running counters: never negative
const counter = z.number().finite().min(0).nullable().default(null);

// Body sent by the ESP32 every minute
export const consumption = z.object({
  voltage: live,        // V
  current: live,        // A
  power: live,          // W
  frequency: live,      // Hz
  pf: live,
  flow_rate: live,      // L/min
  energy_kwh: counter,  // PZEM energy counter (kWh)
  water_l: counter,     // device total water counter (L)
});
