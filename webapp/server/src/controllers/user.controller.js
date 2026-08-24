import crypto from 'node:crypto';
import { User } from '../models/user.model.js';
import { recordAudit } from '../services/audit.service.js';
import { enqueueEmail } from '../queues/index.js';
import { revokeAllForUser } from '../services/token.service.js';
import { asyncHandler, badRequest, conflict, notFound } from '../utils/errors.js';
import { parsePagination, buildSort, paginated } from '../utils/pagination.js';

const contextOf = (req) => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
  requestId: req.id,
  method: req.method,
  path: req.originalUrl.split('?')[0],
});

export const listUsers = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || {};
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  if (query.authProvider) filter.authProvider = query.authProvider;
  if (query.q) {
    const rx = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ username: rx }, { email: rx }, { displayName: rx }, { department: rx }];
  }
  const sort = buildSort(query.sort, ['createdAt', 'username', 'displayName', 'role', 'lastLoginAt']);
  const [items, total] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    User.countDocuments(filter),
  ]);
  res.json(paginated(items.map(({ passwordHash, passwordHistory, mfa, ...rest }) => ({ ...rest, mfa: { enabled: Boolean(mfa?.enabled) } })), total, { page, limit }));
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  res.json({ user: user.toJSON() });
});

export const createUser = asyncHandler(async (req, res) => {
  const { username, email, password, authProvider, sendWelcomeEmail, ...rest } = req.body;
  if (await User.exists({ $or: [{ username }, { email }] })) throw conflict('Username or email is already in use');
  if (authProvider === 'local' && !password) throw badRequest('A password is required for local accounts');

  const user = new User({ username, email, authProvider, createdBy: req.user._id, ...rest });
  if (authProvider === 'local') {
    await user.setPassword(password);
    user.mustChangePassword = true;
  }
  await user.save();

  if (sendWelcomeEmail) {
    void enqueueEmail({
      template: 'welcome',
      to: user.email,
      data: { displayName: user.displayName, username: user.username, role: user.role, authProvider: user.authProvider },
    });
  }
  await recordAudit({
    action: 'user.created',
    category: 'user_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'user', id: user._id, name: user.username },
    context: contextOf(req),
    message: `${req.user.username} created ${user.authProvider} user ${user.username} with role ${user.role}`,
    metadata: { role: user.role, authProvider: user.authProvider },
  });
  res.status(201).json({ user: user.toJSON() });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');

  const isSelf = String(user._id) === String(req.user._id);
  if (isSelf && req.body.role && req.body.role !== user.role) throw badRequest('You cannot change your own role');
  if (isSelf && req.body.status && req.body.status !== 'active') throw badRequest('You cannot disable your own account');

  if (req.body.role && req.body.role !== user.role && user.role === 'admin') {
    const remainingAdmins = await User.countDocuments({ role: 'admin', status: 'active', _id: { $ne: user._id } });
    if (remainingAdmins === 0) throw badRequest('At least one active administrator must remain');
  }

  const before = { role: user.role, status: user.status, email: user.email };
  Object.assign(user, req.body);
  await user.save();

  if (before.role !== user.role) {
    await recordAudit({
      action: 'user.role.changed',
      category: 'user_management',
      outcome: 'success',
      actor: req.user,
      target: { type: 'user', id: user._id, name: user.username },
      context: contextOf(req),
      message: `${req.user.username} changed the role of ${user.username}: ${before.role} -> ${user.role}`,
      metadata: { previousRole: before.role, newRole: user.role },
    });
  }
  if (before.status !== user.status) {
    if (user.status !== 'active') await revokeAllForUser(user._id);
    await recordAudit({
      action: user.status === 'active' ? 'user.enabled' : 'user.disabled',
      category: 'user_management',
      outcome: 'success',
      actor: req.user,
      target: { type: 'user', id: user._id, name: user.username },
      context: contextOf(req),
      message: `${req.user.username} set ${user.username} to ${user.status}`,
      metadata: { previousStatus: before.status, newStatus: user.status },
    });
  }
  res.json({ user: user.toJSON() });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  if (String(user._id) === String(req.user._id)) throw badRequest('You cannot delete your own account');
  if (user.role === 'admin') {
    const remainingAdmins = await User.countDocuments({ role: 'admin', status: 'active', _id: { $ne: user._id } });
    if (remainingAdmins === 0) throw badRequest('At least one active administrator must remain');
  }
  await user.deleteOne();
  await revokeAllForUser(user._id);
  await recordAudit({
    action: 'user.deleted',
    category: 'user_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'user', id: user._id, name: user.username },
    context: contextOf(req),
    message: `${req.user.username} deleted user ${user.username}`,
    metadata: { role: user.role, authProvider: user.authProvider },
  });
  res.status(204).end();
});

/** Admin-initiated credential reset: issues a temporary password the user must change. */
export const resetUserPassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+passwordHash +passwordHistory');
  if (!user) throw notFound('User not found');
  if (user.authProvider !== 'local') throw badRequest('Directory accounts are managed in the directory');

  const temporary = `${crypto.randomBytes(9).toString('base64url')}Aa1!`;
  await user.setPassword(temporary);
  user.mustChangePassword = true;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();
  await revokeAllForUser(user._id);

  await recordAudit({
    action: 'user.password.reset_by_admin',
    category: 'user_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'user', id: user._id, name: user.username },
    context: contextOf(req),
    message: `${req.user.username} issued a temporary password for ${user.username}`,
  });
  // Returned once to the administrator; never emailed in clear text.
  res.json({ temporaryPassword: temporary, mustChangePassword: true });
});

export const unlockUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  user.lockedUntil = null;
  user.failedLoginAttempts = 0;
  await user.save();
  await recordAudit({
    action: 'user.unlocked',
    category: 'user_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'user', id: user._id, name: user.username },
    context: contextOf(req),
    message: `${req.user.username} unlocked ${user.username}`,
  });
  res.json({ user: user.toJSON() });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (req.body.displayName) user.displayName = req.body.displayName;
  if (req.body.department !== undefined) user.department = req.body.department;
  if (req.body.notificationPreferences) {
    user.notificationPreferences = { ...user.notificationPreferences.toObject(), ...req.body.notificationPreferences };
  }
  await user.save();
  await recordAudit({
    action: 'user.profile.updated',
    category: 'user_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'user', id: user._id, name: user.username },
    context: contextOf(req),
    message: `${user.username} updated their profile`,
  });
  res.json({ user: user.toJSON() });
});
