import { badRequest } from '../utils/errors.js';

/** Validates and REPLACES req[source] with the parsed value, so handlers only ever see clean input. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || source,
      message: issue.message,
      code: issue.code,
    }));
    return next(badRequest('Request validation failed', details));
  }
  if (source === 'query') req.validatedQuery = result.data;
  else req[source] = result.data;
  return next();
};

export const validateBody = (schema) => validate(schema, 'body');
export const validateQuery = (schema) => validate(schema, 'query');
export const validateParams = (schema) => validate(schema, 'params');
