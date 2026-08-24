export class AppError extends Error {
  constructor(message, { status = 500, code = 'internal_error', details, expose } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose ?? status < 500;
  }
}

export const badRequest = (message, details) => new AppError(message, { status: 400, code: 'bad_request', details });
export const unauthorized = (message = 'Authentication required', code = 'unauthorized') =>
  new AppError(message, { status: 401, code });
export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(message, { status: 403, code: 'forbidden' });
export const notFound = (message = 'Resource not found') => new AppError(message, { status: 404, code: 'not_found' });
export const conflict = (message, details) => new AppError(message, { status: 409, code: 'conflict', details });
export const tooManyRequests = (message = 'Too many requests') =>
  new AppError(message, { status: 429, code: 'rate_limited' });
export const serviceUnavailable = (message, details) =>
  new AppError(message, { status: 503, code: 'service_unavailable', details });

/** Wraps an async route handler so rejections reach the Express error pipeline. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export default AppError;
