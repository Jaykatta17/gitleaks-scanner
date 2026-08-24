import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import env from '../config/env.js';
import { User } from '../models/user.model.js';
import { PasswordResetToken } from '../models/passwordResetToken.model.js';
import { authenticateLdapUser, isLdapEnabled } from '../services/ldap.service.js';
import { recordAudit } from '../services/audit.service.js';
import { enqueueEmail } from '../queues/index.js';
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  createOpaqueToken,
  hashToken,
} from '../services/token.service.js';
import { asyncHandler, unauthorized, badRequest, forbidden, notFound } from '../utils/errors.js';

authenticator.options = { window: 1 };

const requestContextOf = (req) => ({
  ip: req.ip,
  userAgent: req.get('user-agent') || '',
  requestId: req.id,
  method: req.method,
  path: req.originalUrl.split('?')[0],
});

const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.isProd,
  sameSite: env.isProd ? 'strict' : 'lax',
  path: '/api/v1/auth',
  maxAge: env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
});

const sessionResponse = async (user, req, res) => {
  const accessToken = signAccessToken(user);
  const refresh = await issueRefreshToken(user, { userAgent: req.get('user-agent') || '', ip: req.ip });
  res.cookie('refresh_token', refresh.token, refreshCookieOptions());
  return {
    accessToken,
    refreshToken: refresh.token,
    expiresIn: env.jwt.accessTtl,
    user: user.toJSON(),
  };
};

const registerFailedAttempt = async (user, req, reason) => {
  user.failedLoginAttempts += 1;
  let locked = false;
  if (user.failedLoginAttempts >= env.security.maxFailedLogins) {
    user.lockedUntil = new Date(Date.now() + env.security.lockoutMinutes * 60_000);
    user.failedLoginAttempts = 0;
    locked = true;
  }
  await user.save();
  await recordAudit({
    action: locked ? 'auth.account.locked' : 'auth.login.failed',
    category: 'authentication',
    outcome: 'failure',
    actor: user,
    context: requestContextOf(req),
    message: locked
      ? `Account ${user.username} locked for ${env.security.lockoutMinutes} minutes after repeated failures`
      : `Failed sign-in for ${user.username}: ${reason}`,
    metadata: { reason, attempts: user.failedLoginAttempts },
  });
  if (locked) {
    void enqueueEmail({
      template: 'securityAlert',
      to: user.email,
      data: {
        title: 'Account temporarily locked',
        summary: `Your account was locked after ${env.security.maxFailedLogins} failed sign-in attempts.`,
        details: { Username: user.username, 'Locked until': user.lockedUntil.toISOString(), 'Source IP': req.ip },
      },
    });
  }
  return locked;
};

/** Local password login, LDAP login, and the MFA challenge, behind one endpoint. */
export const login = asyncHandler(async (req, res) => {
  const { username, password, provider, mfaCode } = req.body;
  const context = requestContextOf(req);
  let user = await User.findOne({ username }).select('+passwordHash +passwordHistory +mfa.secret +mfa.recoveryCodes');

  const wantsLdap = provider === 'ldap' || (provider === 'auto' && (user?.authProvider === 'ldap' || (!user && isLdapEnabled())));

  if (wantsLdap) {
    if (!isLdapEnabled()) throw badRequest('Directory authentication is not configured');
    const profile = await authenticateLdapUser(username, password);
    if (!profile) {
      if (user) await registerFailedAttempt(user, req, 'ldap_bind_rejected');
      else
        await recordAudit({
          action: 'auth.login.failed',
          category: 'authentication',
          outcome: 'failure',
          actor: { username },
          context,
          message: `Failed LDAP sign-in for unknown principal ${username}`,
          metadata: { reason: 'ldap_bind_rejected' },
        });
      throw unauthorized('Invalid credentials');
    }

    // Just-in-time provisioning keeps the directory as the source of truth.
    if (!user) {
      user = await User.create({
        username: profile.username,
        email: profile.email || `${profile.username}@${new URL(env.publicUrl).hostname}`,
        displayName: profile.displayName,
        department: profile.department,
        authProvider: 'ldap',
        ldapDn: profile.dn,
        role: profile.role,
        status: 'active',
      });
      await recordAudit({
        action: 'user.provisioned',
        category: 'user_management',
        outcome: 'success',
        actor: user,
        target: { type: 'user', id: user._id, name: user.username },
        context,
        message: `LDAP user ${user.username} provisioned on first sign-in with role ${user.role}`,
        metadata: { dn: profile.dn, groups: profile.groups?.length ?? 0 },
      });
    } else {
      const previousRole = user.role;
      user.displayName = profile.displayName || user.displayName;
      user.email = profile.email || user.email;
      user.department = profile.department || user.department;
      user.ldapDn = profile.dn;
      user.authProvider = 'ldap';
      if (profile.role && profile.role !== previousRole) {
        user.role = profile.role;
        await recordAudit({
          action: 'user.role.changed',
          category: 'user_management',
          outcome: 'success',
          actor: { username: 'system', displayName: 'Directory sync' },
          target: { type: 'user', id: user._id, name: user.username },
          context,
          message: `Role for ${user.username} synced from directory: ${previousRole} -> ${profile.role}`,
          metadata: { previousRole, newRole: profile.role },
        });
      }
    }
  } else {
    if (!user || !user.passwordHash) {
      // Constant-ish work regardless of account existence keeps enumeration hard.
      await new Promise((resolve) => setTimeout(resolve, 120));
      await recordAudit({
        action: 'auth.login.failed',
        category: 'authentication',
        outcome: 'failure',
        actor: { username },
        context,
        message: `Failed sign-in for unknown user ${username}`,
        metadata: { reason: 'unknown_user' },
      });
      throw unauthorized('Invalid credentials');
    }
    if (user.isLocked) {
      await recordAudit({
        action: 'auth.login.blocked',
        category: 'authentication',
        outcome: 'denied',
        actor: user,
        context,
        message: `Sign-in blocked: ${user.username} is locked until ${user.lockedUntil.toISOString()}`,
      });
      throw forbidden('Account is temporarily locked. Try again later.');
    }
    const ok = await user.verifyPassword(password);
    if (!ok) {
      const locked = await registerFailedAttempt(user, req, 'bad_password');
      throw locked ? forbidden('Account locked after repeated failed attempts') : unauthorized('Invalid credentials');
    }
  }

  if (user.status !== 'active') {
    await recordAudit({
      action: 'auth.login.blocked',
      category: 'authentication',
      outcome: 'denied',
      actor: user,
      context,
      message: `Sign-in blocked: account ${user.username} is ${user.status}`,
    });
    throw forbidden(`Account is ${user.status}`);
  }

  if (user.mfa?.enabled) {
    if (!mfaCode) {
      await recordAudit({
        action: 'auth.mfa.challenged',
        category: 'authentication',
        outcome: 'success',
        actor: user,
        context,
        message: `MFA challenge issued to ${user.username}`,
      });
      return res.status(200).json({ mfaRequired: true, username: user.username });
    }
    const normalized = mfaCode.trim().toUpperCase();
    const recoveryHashes = user.mfa.recoveryCodes || [];
    const recoveryIndex = recoveryHashes.indexOf(hashToken(normalized));
    const totpValid = /^\d{6}$/.test(mfaCode) && authenticator.verify({ token: mfaCode, secret: user.mfa.secret });
    if (!totpValid && recoveryIndex === -1) {
      await registerFailedAttempt(user, req, 'bad_mfa_code');
      throw unauthorized('Invalid verification code', 'invalid_mfa');
    }
    if (recoveryIndex !== -1) {
      recoveryHashes.splice(recoveryIndex, 1);
      user.mfa.recoveryCodes = recoveryHashes;
      await recordAudit({
        action: 'auth.mfa.recovery_used',
        category: 'authentication',
        outcome: 'success',
        actor: user,
        context,
        message: `${user.username} signed in with a recovery code (${recoveryHashes.length} left)`,
      });
    }
  } else if (env.security.requireMfaForAdmins && user.role === 'admin') {
    return res.status(200).json({ mfaEnrollmentRequired: true, username: user.username });
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  user.lastLoginIp = req.ip;
  await user.save();

  const session = await sessionResponse(user, req, res);
  await recordAudit({
    action: 'auth.login.success',
    category: 'authentication',
    outcome: 'success',
    actor: user,
    context,
    message: `${user.username} signed in via ${user.authProvider}`,
    metadata: { mfaUsed: Boolean(user.mfa?.enabled), provider: user.authProvider },
  });
  return res.json(session);
});

export const refresh = asyncHandler(async (req, res) => {
  const raw = req.body?.refreshToken || req.cookies?.refresh_token;
  if (!raw) throw unauthorized('Missing refresh token', 'missing_refresh');

  const payload = jwt.decode(raw);
  if (!payload?.sub) throw unauthorized('Invalid refresh token', 'invalid_refresh');
  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') throw unauthorized('Session is no longer valid', 'invalid_refresh');

  let next;
  try {
    next = await rotateRefreshToken(raw, user, { userAgent: req.get('user-agent') || '', ip: req.ip });
  } catch (error) {
    if (error.code === 'refresh_replay') {
      await revokeAllForUser(user._id);
      await recordAudit({
        action: 'auth.refresh.replay',
        category: 'authentication',
        outcome: 'failure',
        actor: user,
        context: requestContextOf(req),
        message: `Refresh token replay detected for ${user.username}; all sessions revoked`,
      });
      res.clearCookie('refresh_token', { path: '/api/v1/auth' });
      throw unauthorized('Session revoked for security reasons', 'refresh_replay');
    }
    throw unauthorized('Invalid refresh token', 'invalid_refresh');
  }

  res.cookie('refresh_token', next.token, refreshCookieOptions());
  res.json({
    accessToken: signAccessToken(user),
    refreshToken: next.token,
    expiresIn: env.jwt.accessTtl,
    user: user.toJSON(),
  });
});

export const logout = asyncHandler(async (req, res) => {
  const raw = req.body?.refreshToken || req.cookies?.refresh_token;
  await revokeRefreshToken(raw);
  res.clearCookie('refresh_token', { path: '/api/v1/auth' });
  await recordAudit({
    action: 'auth.logout',
    category: 'authentication',
    outcome: 'success',
    actor: req.user || { username: 'anonymous' },
    context: requestContextOf(req),
    message: `${req.user?.username || 'anonymous'} signed out`,
  });
  res.status(204).end();
});

export const logoutAll = asyncHandler(async (req, res) => {
  const revoked = await revokeAllForUser(req.user._id);
  res.clearCookie('refresh_token', { path: '/api/v1/auth' });
  await recordAudit({
    action: 'auth.logout.all',
    category: 'authentication',
    outcome: 'success',
    actor: req.user,
    context: requestContextOf(req),
    message: `${req.user.username} revoked all active sessions`,
    metadata: { revoked },
  });
  res.json({ revoked });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toJSON(), capabilities: capabilitiesFor(req.user.role) });
});

export const capabilitiesFor = (role) => ({
  canManageUsers: role === 'admin',
  canManageProjects: ['admin', 'security_analyst'].includes(role),
  canRunScans: ['admin', 'security_analyst', 'developer'].includes(role),
  canTriageFindings: ['admin', 'security_analyst'].includes(role),
  canViewAudit: ['admin', 'security_analyst'].includes(role),
  canEditSettings: role === 'admin',
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  // Always the same response: the endpoint must not confirm which addresses exist.
  if (user && user.authProvider === 'local' && user.status === 'active') {
    const { raw, hash } = createOpaqueToken();
    await PasswordResetToken.create({
      tokenHash: hash,
      user: user._id,
      expiresAt: new Date(Date.now() + env.security.resetTokenMinutes * 60_000),
      requestedIp: req.ip,
    });
    void enqueueEmail({
      template: 'passwordReset',
      to: user.email,
      data: {
        username: user.username,
        token: raw,
        expiresInMinutes: env.security.resetTokenMinutes,
        requestedAt: new Date().toISOString(),
        ip: req.ip,
      },
    });
  }
  await recordAudit({
    action: 'auth.password.reset_requested',
    category: 'authentication',
    outcome: 'success',
    actor: user || { username: email },
    context: requestContextOf(req),
    message: `Password reset requested for ${email}`,
    metadata: { accountExists: Boolean(user), provider: user?.authProvider },
  });
  res.json({ message: 'If the address matches an account, a reset link has been sent.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const record = await PasswordResetToken.findOne({ tokenHash: hashToken(token), usedAt: null });
  if (!record || record.expiresAt < new Date()) throw badRequest('Reset link is invalid or has expired');

  const user = await User.findById(record.user).select('+passwordHash +passwordHistory');
  if (!user) throw notFound('Account not found');
  if (await user.isPasswordReused(password)) throw badRequest('Choose a password you have not used recently');

  await user.setPassword(password);
  await user.save();
  record.usedAt = new Date();
  await record.save();
  await revokeAllForUser(user._id);

  void enqueueEmail({
    template: 'passwordChanged',
    to: user.email,
    data: { username: user.username, changedAt: new Date().toISOString(), ip: req.ip },
  });
  await recordAudit({
    action: 'auth.password.reset',
    category: 'authentication',
    outcome: 'success',
    actor: user,
    target: { type: 'user', id: user._id, name: user.username },
    context: requestContextOf(req),
    message: `Password reset completed for ${user.username}; all sessions revoked`,
  });
  res.json({ message: 'Password updated. Please sign in with your new password.' });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+passwordHash +passwordHistory');
  if (user.authProvider !== 'local') throw badRequest('Directory accounts must change their password in the directory');
  if (!(await user.verifyPassword(currentPassword))) throw unauthorized('Current password is incorrect');
  if (await user.isPasswordReused(newPassword)) throw badRequest('Choose a password you have not used recently');

  await user.setPassword(newPassword);
  await user.save();
  await revokeAllForUser(user._id);
  void enqueueEmail({
    template: 'passwordChanged',
    to: user.email,
    data: { username: user.username, changedAt: new Date().toISOString(), ip: req.ip },
  });
  await recordAudit({
    action: 'auth.password.changed',
    category: 'authentication',
    outcome: 'success',
    actor: user,
    target: { type: 'user', id: user._id, name: user.username },
    context: requestContextOf(req),
    message: `${user.username} changed their password`,
  });
  res.json({ message: 'Password changed. Other sessions have been signed out.' });
});

export const startMfaEnrollment = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+mfa.pendingSecret');
  const secret = authenticator.generateSecret();
  user.mfa.pendingSecret = secret;
  await user.save();
  const otpauth = authenticator.keyuri(user.username, env.security.mfaIssuer, secret);
  res.json({ secret, otpauth, qrDataUrl: await QRCode.toDataURL(otpauth, { margin: 1, width: 240 }) });
});

export const confirmMfaEnrollment = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+mfa.pendingSecret +mfa.secret +mfa.recoveryCodes');
  if (!user.mfa.pendingSecret) throw badRequest('Start enrollment before confirming');
  if (!authenticator.verify({ token: req.body.code, secret: user.mfa.pendingSecret })) {
    throw badRequest('That code did not match. Check your device clock and try again.');
  }
  const recoveryCodes = Array.from({ length: 8 }, () =>
    crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-'),
  );
  user.mfa.secret = user.mfa.pendingSecret;
  user.mfa.pendingSecret = undefined;
  user.mfa.enabled = true;
  user.mfa.enrolledAt = new Date();
  user.mfa.recoveryCodes = recoveryCodes.map(hashToken);
  await user.save();
  await recordAudit({
    action: 'auth.mfa.enabled',
    category: 'authentication',
    outcome: 'success',
    actor: user,
    target: { type: 'user', id: user._id, name: user.username },
    context: requestContextOf(req),
    message: `${user.username} enabled multi-factor authentication`,
  });
  // Shown exactly once — only hashes are stored.
  res.json({ recoveryCodes });
});

export const disableMfa = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash +mfa.secret +mfa.recoveryCodes');
  if (user.authProvider === 'local' && !(await user.verifyPassword(req.body.currentPassword || ''))) {
    throw unauthorized('Password confirmation is required to disable MFA');
  }
  user.mfa = { enabled: false, secret: undefined, pendingSecret: undefined, recoveryCodes: [], enrolledAt: undefined };
  await user.save();
  await recordAudit({
    action: 'auth.mfa.disabled',
    category: 'authentication',
    outcome: 'success',
    actor: user,
    target: { type: 'user', id: user._id, name: user.username },
    context: requestContextOf(req),
    message: `${user.username} disabled multi-factor authentication`,
  });
  res.json({ message: 'Multi-factor authentication disabled' });
});
