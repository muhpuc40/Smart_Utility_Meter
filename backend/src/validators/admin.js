import { z } from 'zod';
import {
  amount,
  atLeastOneField,
  dateRange,
  email,
  meterId,
  optionalEmail,
  optionalText,
  pagination,
  password,
  phone,
  rechargeMethod,
} from './common.js';

// ------------------------------------------------------------
// Auth
// ------------------------------------------------------------

export const adminLogin = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

export const changePassword = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: password,
});

// ------------------------------------------------------------
// Admin users
// ------------------------------------------------------------

export const createAdmin = z.object({
  name: z.string().trim().min(2).max(100),
  email,
  password,
});

export const updateAdmin = atLeastOneField(
  z.object({
    name: z.string().trim().min(2).max(100).optional(),
    is_active: z.boolean().optional(),
  }),
);

// ------------------------------------------------------------
// Consumers
// ------------------------------------------------------------

export const listConsumers = z.object({
  ...pagination,
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  meter_id: meterId.optional(),
});

export const createConsumer = z.object({
  name: z.string().trim().min(2).max(100),
  phone,
  email: optionalEmail.optional(),
  address: optionalText(300).optional(),
  password,
  meter_id: meterId.optional(),   // auto-generated (MTR-0001...) when omitted
});

export const updateConsumer = atLeastOneField(
  z.object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: phone.optional(),
    email: optionalEmail.optional(),
    address: optionalText(300).optional(),
  }),
);

export const consumerStatus = z.object({
  status: z.enum(['active', 'suspended']),
});

export const resetPassword = z.object({
  password,
});

// ------------------------------------------------------------
// Meters
// ------------------------------------------------------------

export const listMeters = z.object({
  ...pagination,
  search: z.string().trim().max(32).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  online: z.enum(['true', 'false']).optional(),
  max_balance: z.coerce.number().min(0).optional(),   // low-balance filter (Tk)
});

export const meterStatus = z.object({
  status: z.enum(['active', 'disabled']),
});

export const adjustBalance = z.object({
  amount: z.coerce
    .number()
    .refine((value) => value !== 0, 'Amount cannot be 0')
    .refine((value) => Math.abs(value) <= 1000000, 'Amount is too large')
    .transform((value) => Math.round(value * 100) / 100),
  note: z.string().trim().min(3, 'Note is required').max(300),
});

export const readingsQuery = z.object({
  ...pagination,
  ...dateRange,
});

export const usageQuery = z.object({
  ...dateRange,
});

// ------------------------------------------------------------
// Tariff
// ------------------------------------------------------------

export const updateTariff = atLeastOneField(
  z.object({
    electricity_rate: z.coerce.number().min(0).max(10000).optional(),   // Tk per kWh
    water_rate: z.coerce.number().min(0).max(10000).optional(),         // Tk per 1000 L
    min_balance: z.coerce.number().min(0).max(10000).optional(),        // Tk
  }),
);

// ------------------------------------------------------------
// Recharges + transactions
// ------------------------------------------------------------

export const listRecharges = z.object({
  ...pagination,
  ...dateRange,
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  method: rechargeMethod.optional(),
  source: z.enum(['consumer', 'admin']).optional(),
  meter_id: meterId.optional(),
});

export const adminRecharge = z.object({
  meter_id: meterId,
  amount,
  method: rechargeMethod.default('cash'),
  transaction_ref: optionalText(100).optional(),
  note: optionalText(300).optional(),
});

export const rejectRecharge = z.object({
  reason: optionalText(300).optional(),
});

// ------------------------------------------------------------
// Reports
// ------------------------------------------------------------

export const dailyReport = z.object({
  ...dateRange,
});

export const topMeters = z.object({
  ...dateRange,
  limit: z.coerce.number().int().min(1).max(50).default(5),
});

export const listTransactions = z.object({
  ...pagination,
  ...dateRange,
  type: z.enum(['recharge', 'adjustment']).optional(),
  meter_id: meterId.optional(),
});
