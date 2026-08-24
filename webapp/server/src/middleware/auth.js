import { User } from '../models/user.model.js';
import { verifyAccessToken } from '../services/token.service.js';
import { unauthorized, forbidden } from '../utils/errors.js';
import { recordAudit } from '../services/audit.service.js';

const extractToken = (req) => {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  if (req.cookies?.access_token) return req.cookies.access_token;
  return null;
};

/** Verifies the access token and loads the live user record (so disabled accounts lose access at once). */
export const authenticate = async (req, _res, next) => {
  try {
    const token = extractToken(req);
    if (!token) throw unauthorized('Missing access token', 'missing_token');

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (error) {
      throw unauthorized(
        error.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token',
        error.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token',
      );
    }

    const user = await User.findById(payload.sub);
    if (!user) throw unauthorized('Account no longer exists', 'account_missing');
    if (user.status !== 'active') throw forbidden('Account is not active');
    if (user.passwordChangedAt && payload.iat * 1000 < user.passwordChangedAt.getTime() - 1000) {
      throw unauthorized('Credentials changed, please sign in again', 'token_stale');
    }

    req.user = user;
    req.authPayload = payload;
    next();
  } catch (error) {
    next(error);
  }
};

/** Attaches req.user when a valid token is present, but never rejects the request. */
export const optionalAuthenticate = async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = await User.findById(payload.sub);
  } catch {
    req.user = undefined;
  }
  return next();
};

export const requireRole = (...roles) => {
  const allowed = roles.flat();
  return async (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (allowed.includes(req.user.role)) return next();
    await recordAudit({
      action: 'authz.denied',
      category: 'authorization',
      outcome: 'denied',
      actor: req.user,
      context: { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id, method: req.method, path: req.path },
      message: `${req.user.username} was denied ${req.method} ${req.originalUrl}`,
      metadata: { requiredRoles: allowed, actualRole: req.user.role },
    });
    return next(forbidden(`This action requires one of: ${allowed.join(', ')}`));
  };
};

export const ROLE_GROUPS = {
  admins: ['admin'],
  scanOperators: ['admin', 'security_analyst', 'developer'],
  triagers: ['admin', 'security_analyst'],
  everyone: ['admin', 'security_analyst', 'developer', 'viewer'],
};
