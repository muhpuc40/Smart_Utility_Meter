import { z } from 'zod';

export const RECHARGE_METHODS = ['bkash', 'nagad', 'rocket', 'upay', 'card', 'bank', 'cash', 'other'];

// Accepts 01XXXXXXXXX, 8801XXXXXXXXX or +8801XXXXXXXXX -> stored as 01XXXXXXXXX
export function normalizePhone(value) {
  return String(value).replace(/[\s-]/g, '').replace(/^\+?88(?=01)/, '');
}

export const phone = z
  .string()
  .trim()
  .transform(normalizePhone)
  .pipe(z.string().regex(/^01[3-9]\d{8}$/, 'Must be a valid Bangladeshi mobile number (01XXXXXXXXX)'));

export const password = z
  .string()
  .min(6, 'Password must be at least 6 characters')
  .max(72, 'Password must be at most 72 characters');

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Invalid email address'));

// Optional email: "" or null clears it
export const optionalEmail = z
  .union([email, z.literal(''), z.null()])
  .transform((value) => value || null);

export const optionalText = (max) =>
  z.union([z.string().trim().max(max), z.null()]).transform((value) => value || null);

export const meterId = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,32}$/, 'Meter ID: 3-32 characters, letters, numbers, - or _');

export const amount = z.coerce
  .number()
  .positive('Amount must be greater than 0')
  .max(1000000, 'Amount is too large')
  .transform((value) => Math.round(value * 100) / 100);

export const rechargeMethod = z.enum(RECHARGE_METHODS);

export const idParams = z.object({ id: z.uuid('Invalid ID') });

export const meterParams = z.object({ meterId });

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const dateRange = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

export function atLeastOneField(schema) {
  return schema.refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
}
