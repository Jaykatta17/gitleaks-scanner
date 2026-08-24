import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { RefreshToken } from '../models/refreshToken.model.js';

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const signAccessToken = (user) =>
  jwt.sign(
    {
      sub: String(user._id),
      username: user.username,
      role: user.role,
      provider: user.authProvider,
      displayName: user.displayName,
    },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessTtl, issuer: env.jwt.issuer, audience: 'sentinel-api' },
  );

export const verifyAccessToken = (token) =>
  jwt.verify(token, env.jwt.accessSecret, { issuer: env.jwt.issuer, audience: 'sentinel-api' });

export const issueRefreshToken = async (user, { family, userAgent = '', ip = '' } = {}) => {
  const tokenFamily = family || crypto.randomUUID();
  const raw = jwt.sign({ sub: String(user._id), family: tokenFamily, jti: crypto.randomUUID() }, env.jwt.refreshSecret, {
    expiresIn: `${env.jwt.refreshTtlDays}d`,
    issuer: env.jwt.issuer,
    audience: 'sentinel-refresh',
  });
  const expiresAt = new Date(Date.now() + env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000);
  await RefreshToken.create({ tokenHash: hashToken(raw), user: user._id, family: tokenFamily, userAgent, ip, expiresAt });
  return { token: raw, family: tokenFamily, expiresAt };
};

export const verifyRefreshToken = (token) =>
  jwt.verify(token, env.jwt.refreshSecret, { issuer: env.jwt.issuer, audience: 'sentinel-refresh' });

/**
 * Rotates a refresh token. Re-use of an already-rotated token is treated as
 * theft: the whole token family is revoked (OWASP refresh-token rotation).
 */
export const rotateRefreshToken = async (rawToken, user, context = {}) => {
  const payload = verifyRefreshToken(rawToken);
  const stored = await RefreshToken.findOne({ tokenHash: hashToken(rawToken) });
  if (!stored) {
    await RefreshToken.updateMany({ family: payload.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
    const error = new Error('Refresh token replay detected');
    error.code = 'refresh_replay';
    throw error;
  }
  if (stored.revokedAt) {
    await RefreshToken.updateMany({ family: stored.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
    const error = new Error('Refresh token already used');
    error.code = 'refresh_replay';
    throw error;
  }
  const next = await issueRefreshToken(user, { family: stored.family, ...context });
  stored.revokedAt = new Date();
  stored.replacedBy = hashToken(next.token);
  await stored.save();
  return next;
};

export const revokeRefreshToken = async (rawToken) => {
  if (!rawToken) return 0;
  const result = await RefreshToken.updateOne(
    { tokenHash: hashToken(rawToken), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  return result.modifiedCount;
};

export const revokeAllForUser = async (userId) => {
  const result = await RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return result.modifiedCount;
};

export const createOpaqueToken = () => {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
};
