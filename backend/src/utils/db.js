import { ApiError } from './ApiError.js';

// Errors raised inside the SQL functions (RAISE EXCEPTION '<CODE>')
const FUNCTION_ERRORS = {
  METER_NOT_FOUND: [404, 'Meter not found'],
  RECHARGE_NOT_FOUND: [404, 'Recharge not found'],
  RECHARGE_NOT_PENDING: [409, 'Recharge has already been processed'],
  BALANCE_NEGATIVE: [422, 'Adjustment would make the balance negative'],
};

export function toApiError(error) {
  if (error.code === 'P0001' && FUNCTION_ERRORS[error.message]) {
    const [status, message] = FUNCTION_ERRORS[error.message];
    return new ApiError(status, message);
  }

  // unique_violation, e.g. "Key (phone)=(01712345678) already exists."
  if (error.code === '23505') {
    const field = /Key \((?:lower\()?([a-z_]+)/.exec(error.details || '')?.[1];
    return ApiError.conflict(field ? `${field} already exists` : 'Duplicate value');
  }

  // foreign_key_violation
  if (error.code === '23503') {
    return ApiError.conflict('Record is referenced by other data');
  }

  console.error('Database error:', error);
  return new ApiError(500, 'Database error');
}

// Unwraps a Supabase { data, error } result.
// When notFoundMessage is given, an empty result throws 404.
export function unwrap({ data, error }, notFoundMessage) {
  if (error) throw toApiError(error);

  if (notFoundMessage && (data === null || data === undefined)) {
    throw ApiError.notFound(notFoundMessage);
  }

  return data;
}
