import mongoose from 'mongoose';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { AppError } from '../utils/errors.js';

export const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.originalUrl}`, requestId: req.id },
  });
};

const translate = (error) => {
  if (error instanceof AppError) return error;
  if (error instanceof mongoose.Error.ValidationError) {
    return new AppError('Validation failed', {
      status: 400,
      code: 'validation_error',
      details: Object.values(error.errors).map((issue) => ({ field: issue.path, message: issue.message })),
    });
  }
  if (error instanceof mongoose.Error.CastError) {
    return new AppError(`Invalid value for ${error.path}`, { status: 400, code: 'invalid_id' });
  }
  if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern || {})[0] || 'value';
    return new AppError(`A record with that ${field} already exists`, { status: 409, code: 'duplicate_key' });
  }
  if (error?.type === 'entity.too.large') {
    return new AppError('Request payload too large', { status: 413, code: 'payload_too_large' });
  }
  return new AppError(error.message || 'Unexpected error', { status: error.status || 500, code: 'internal_error', expose: false });
};

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
export const errorHandler = (error, req, res, _next) => {
  const appError = translate(error);
  const payload = {
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : 'An unexpected error occurred',
      requestId: req.id,
      ...(appError.details ? { details: appError.details } : {}),
    },
  };
  if (!appError.expose || appError.status >= 500) {
    logger.error('request failed', {
      event: 'http.error',
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: appError.status,
      error: error.message,
      stack: env.isProd ? undefined : error.stack,
    });
  }
  if (!env.isProd && appError.status >= 500) payload.error.stack = error.stack;
  res.status(appError.status).json(payload);
};

export default errorHandler;
