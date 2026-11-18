import { ApiError } from '../utils/ApiError.js';

// Validates req.params / req.query / req.body with zod schemas.
// Parsed values are stored in req.valid.{params,query,body}.
export function validate(schemas) {
  return (req, res, next) => {
    req.valid = {};

    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;

      const result = schemas[part].safeParse(req[part] ?? {});

      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          field: issue.path.join('.') || part,
          message: issue.message,
        }));

        throw ApiError.unprocessable('Validation failed', details);
      }

      req.valid[part] = result.data;
    }

    next();
  };
}
