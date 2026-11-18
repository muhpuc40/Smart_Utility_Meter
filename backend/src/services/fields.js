// Column lists returned by the API. Password and device key hashes are never selected.

export const ADMIN_FIELDS = 'id, name, email, is_active, created_at, updated_at';

export const CONSUMER_FIELDS = 'id, name, phone, email, address, status, created_at, updated_at';

export const METER_FIELDS = [
  'id', 'meter_id', 'status', 'balance',
  'total_energy_kwh', 'total_water_l', 'total_energy_cost', 'total_water_cost',
  'last_voltage', 'last_current', 'last_power', 'last_frequency', 'last_pf', 'last_flow_rate',
  'last_seen_at', 'created_at', 'updated_at',
].join(', ');

export const READING_FIELDS = [
  'id', 'voltage', 'current', 'power', 'frequency', 'pf', 'flow_rate',
  'energy_kwh', 'water_l', 'energy_cost', 'water_cost', 'total_cost', 'balance_after', 'created_at',
].join(', ');

export const RECHARGE_FIELDS = [
  'id', 'amount', 'method', 'transaction_ref', 'status', 'source',
  'note', 'reject_reason', 'processed_at', 'created_at',
].join(', ');

export const TRANSACTION_FIELDS = 'id, type, amount, balance_before, balance_after, recharge_id, note, created_at';

export const TARIFF_FIELDS = 'electricity_rate, water_rate, min_balance, updated_at';
