import { z } from 'zod';
import {
  amount,
  atLeastOneField,
  dateRange,
  optionalEmail,
  optionalText,
  pagination,
  password,
  rechargeMethod,
} from './common.js';

export const consumerLogin = z.object({
  identifier: z.string().trim().min(3, 'Phone number or meter ID is required'),
  password: z.string().min(1, 'Password is required'),
});

export const updateProfile = atLeastOneField(
  z.object({
    name: z.string().trim().min(2).max(100).optional(),
    email: optionalEmail.optional(),
    address: optionalText(300).optional(),
  }),
);

export const changePassword = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: password,
});

export const usageQuery = z.object({
  ...dateRange,
});

export const readingsQuery = z.object({
  ...pagination,
  ...dateRange,
});

export const createRecharge = z.object({
  amount,
  method: rechargeMethod.exclude(['cash']),
  transaction_ref: z.string().trim().min(4, 'Transaction ID is required').max(100),
  note: optionalText(300).optional(),
});

export const listRecharges = z.object({
  ...pagination,
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

export const listTransactions = z.object({
  ...pagination,
  ...dateRange,
});
